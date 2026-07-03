#!/usr/bin/env bash
# 범용 이미지 → WebP 변환 스크립트
#
# 지정한 디렉토리(기본: assets/images/story) 안의 사진(jpg/jpeg/png/heic)을
# WebP로 변환한다. gallery-list.js 같은 목록 파일은 생성하지 않는다
# (story·childhood 사진은 index.html에 직접 하드코딩되어 있으므로).
#
#   · 촬영 방향(EXIF orientation / HEIC irot·imir)을 픽셀에 직접 구워넣음
#     → 사진이 옆으로 눕는(회전) 문제 방지
#   · 긴 변 기준 1280px로 축소 (작은 사진은 억지로 키우지 않음)
#   · HEIC 지원 (cwebp는 HEIC를 못 읽으므로 sips로 먼저 디코드)
#   · 이미 .webp가 있으면 건너뜀 (FORCE=1 로 재생성)
#
# ⚠ 방향 처리는 build-gallery.sh 와 동일한 방식(원본 바이트에서 실제 방향을
#   읽어 sips 회전/반전으로 픽셀 보정)을 사용한다.
#
# 사용법:
#   bash scripts/build-images.sh                       # assets/images/story 변환
#   bash scripts/build-images.sh assets/images/childhood
#   FORCE=1 bash scripts/build-images.sh assets/images/story   # webp 재생성
#
# 필요 도구: sips(macOS 기본) · cwebp(brew install webp) · python3

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${1:-assets/images/story}"
# 상대경로면 ROOT 기준으로 해석
case "$DIR" in
  /*) : ;;
  *)  DIR="$ROOT/$DIR" ;;
esac
MAX="${MAX:-1280}"   # 긴 변 최대 픽셀
Q="${Q:-82}"         # WebP 품질(0~100)
FORCE="${FORCE:-0}"

if [ ! -d "$DIR" ]; then
  echo "✗ 디렉토리를 찾을 수 없습니다: $DIR" >&2
  exit 1
fi

if ! command -v cwebp >/dev/null 2>&1 || ! command -v sips >/dev/null 2>&1; then
  echo "✗ sips/cwebp 필요 — brew install webp 후 다시 실행하세요." >&2
  exit 1
fi

echo "→ WebP 변환: $DIR  (긴 변 ${MAX}px, 품질 ${Q}, FORCE=${FORCE})"
shopt -s nullglob nocaseglob
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

count=0
for f in "$DIR"/*.jpg "$DIR"/*.jpeg "$DIR"/*.png "$DIR"/*.heic; do
  [ -e "$f" ] || continue
  base="${f%.*}"
  out="$base.webp"
  if [ -f "$out" ] && [ "$FORCE" != "1" ]; then
    continue
  fi

  # 긴 변이 MAX보다 클 때만 축소
  maxdim="$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null \
            | awk '/pixelWidth|pixelHeight/{print $2}' | sort -n | tail -1)"
  resize=()
  if [ -n "$maxdim" ] && [ "$maxdim" -gt "$MAX" ]; then
    resize=(-Z "$MAX")
  fi

  # 원본 바이트에서 실제 촬영 방향을 읽어 sips 회전/반전 옵션으로 변환.
  orient_ops="$(python3 - "$f" <<'PY'
import sys, struct

def jpeg_orientation(data):
    if data[:2] != b'\xff\xd8':
        return None
    i = 2
    while i < len(data) - 1:
        if data[i] != 0xFF:
            i += 1; continue
        m = data[i + 1]
        if m == 0xE1:  # APP1 (Exif)
            l = struct.unpack('>H', data[i + 2:i + 4])[0]
            seg = data[i + 4:i + 2 + l]
            if seg[:6] == b'Exif\x00\x00':
                t = seg[6:]
                bo = '<' if t[:2] == b'II' else '>'
                off = struct.unpack(bo + 'I', t[4:8])[0]
                n = struct.unpack(bo + 'H', t[off:off + 2])[0]
                for k in range(n):
                    e = off + 2 + k * 12
                    if struct.unpack(bo + 'H', t[e:e + 2])[0] == 0x0112:
                        return struct.unpack(bo + 'H', t[e + 8:e + 10])[0]
            return None
        if m in (0xD8, 0xD9) or 0xD0 <= m <= 0xD7:
            i += 2; continue
        i += 2 + struct.unpack('>H', data[i + 2:i + 4])[0]
    return None

# EXIF orientation → sips 옵션 (sips -r 은 시계방향 회전)
EXIF_OPS = {
    1: [], 2: ['-f', 'horizontal'], 3: ['-r', '180'], 4: ['-f', 'vertical'],
    5: ['-f', 'horizontal', '-r', '270'], 6: ['-r', '90'],
    7: ['-f', 'horizontal', '-r', '90'], 8: ['-r', '270'],
}

path = sys.argv[1]
data = open(path, 'rb').read()
ops = []
if data[:2] == b'\xff\xd8':                       # JPEG
    ops = EXIF_OPS.get(jpeg_orientation(data) or 1, [])
else:                                             # HEIC/HEIF (ISOBMFF)
    p = data.find(b'imir')                        # 반전 먼저
    if p != -1:
        ops += ['-f', 'vertical' if data[p + 4] & 1 else 'horizontal']
    p = data.find(b'irot')                        # irot = 반시계 90° 단위
    if p != -1:
        ops += {1: ['-r', '270'], 2: ['-r', '180'], 3: ['-r', '90']}.get(data[p + 4] & 3, [])
print(' '.join(ops))
PY
)"
  read -r -a orient <<< "$orient_ops"

  # sips로 방향 보정 + (필요 시)축소 후 PNG 중간파일 생성 → cwebp 인코딩
  tmp="$tmpdir/$(basename "$base").png"
  if sips -s format png ${orient[@]+"${orient[@]}"} ${resize[@]+"${resize[@]}"} "$f" --out "$tmp" >/dev/null 2>&1; then
    cwebp -quiet -q "$Q" "$tmp" -o "$out"
    osz="$(du -h "$f" | cut -f1 | tr -d ' ')"
    wsz="$(du -h "$out" | cut -f1 | tr -d ' ')"
    echo "   ✓ $(basename "$out")  (${osz} → ${wsz})"
    count=$((count + 1))
  else
    echo "   ✗ 변환 실패: $(basename "$f")"
  fi
done
shopt -u nullglob nocaseglob

echo "✓ 완료: ${count} 장 변환 → $DIR"
