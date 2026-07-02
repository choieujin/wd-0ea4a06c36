#!/usr/bin/env bash
# 갤러리 빌드 스크립트
# 1) assets/gallery/ 안의 사진(jpg/jpeg/png/heic)을 WebP로 변환
#      · 촬영 방향(EXIF orientation / HEIC irot·imir)을 픽셀에 직접 구워넣음
#        → 사진이 옆으로 눕는(회전) 문제 방지
#      · 긴 변(가로·세로 중 큰 쪽) 기준 1280px로 축소 → 방향과 무관하게 일관
#      · HEIC 지원 (cwebp는 HEIC를 못 읽으므로 sips로 먼저 디코드)
# 2) assets/js/gallery-list.js 자동 생성
#
# ⚠ 방향 처리 주의:
#   sips/cwebp 는 재인코딩 시 방향 태그를 "자동 적용"하지 않는다.
#   (sips -g orientation / mdls 도 값을 잘못 보고하는 경우가 있음)
#   따라서 아래 python 헬퍼로 원본 바이트에서 실제 방향을 직접 읽어
#   sips 회전/반전(-r/-f) 옵션으로 픽셀을 바로잡은 뒤 인코딩한다.
#   PNG 중간파일에는 방향 태그가 없으므로 이중 회전도 발생하지 않는다.
#
# 사용법:
#   bash scripts/build-gallery.sh
#
# 필요 도구:
#   · sips    — macOS 기본 제공 (회전·리사이즈·HEIC 디코드)
#   · cwebp   — brew install webp (WebP 인코딩)
#   · python3 — 방향 판독 (macOS 기본 제공)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/assets/gallery"
OUT="$ROOT/assets/js/gallery-list.js"
MAX=1280   # 긴 변 최대 픽셀
Q=82       # WebP 품질(0~100)

mkdir -p "$DIR"

# ---- 1) WebP 변환 ----
if command -v cwebp >/dev/null 2>&1 && command -v sips >/dev/null 2>&1; then
  echo "→ WebP 변환 중..."
  shopt -s nullglob nocaseglob
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  for f in "$DIR"/*.jpg "$DIR"/*.jpeg "$DIR"/*.png "$DIR"/*.heic; do
    [ -e "$f" ] || continue
    base="${f%.*}"
    out="$base.webp"
    [ -f "$out" ] && continue

    # 긴 변이 MAX보다 클 때만 축소 (작은 사진을 억지로 키우지 않음)
    maxdim="$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null \
              | awk '/pixelWidth|pixelHeight/{print $2}' | sort -n | tail -1)"
    resize=()
    if [ -n "$maxdim" ] && [ "$maxdim" -gt "$MAX" ]; then
      resize=(-Z "$MAX")
    fi

    # 원본에서 실제 촬영 방향을 읽어 sips 회전/반전 옵션으로 변환.
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

    # sips로 방향 보정 + (필요 시)축소 후 PNG 중간파일 생성.
    # 방향을 픽셀에 구워넣으므로 이후 어떤 뷰어에서도 옆으로 눕지 않음.
    tmp="$tmpdir/$(basename "$base").png"
    if sips -s format png ${orient[@]+"${orient[@]}"} ${resize[@]+"${resize[@]}"} "$f" --out "$tmp" >/dev/null 2>&1; then
      cwebp -quiet -q "$Q" "$tmp" -o "$out"
      echo "   ✓ $(basename "$out")"
    else
      echo "   ✗ 변환 실패: $(basename "$f")"
    fi
  done
  shopt -u nullglob nocaseglob
else
  echo "⚠ sips/cwebp 미설치 — 원본 이미지를 그대로 사용합니다. (brew install webp 권장)"
fi

# ---- 2) gallery-list.js 생성 ----
# 공백·대소문자(.JPG 등)·한글 파일명을 정확히 보존하기 위해 python3로 생성.
# webp 버전이 있으면 같은 이름의 원본 대신 webp를 사용.
echo "→ gallery-list.js 생성 중..."
python3 - "$DIR" "$OUT" <<'PY'
import os, sys, json
d, out = sys.argv[1], sys.argv[2]
exts = (".webp", ".jpg", ".jpeg", ".png", ".heic")
files = [f for f in os.listdir(d)
         if f.lower().endswith(exts) and not f.startswith(".")]
by_base = {}
for f in files:
    base, ext = os.path.splitext(f)
    # 같은 base에 webp가 있으면 webp 우선
    if base not in by_base or ext.lower() == ".webp":
        by_base[base] = f
# HEIC/원본만 있고 webp가 없는 항목은 브라우저 호환을 위해 제외
chosen = sorted(
    (f for f in by_base.values() if f.lower().endswith((".webp", ".jpg", ".jpeg", ".png"))),
    key=lambda s: s.lower(),
)
with open(out, "w", encoding="utf-8") as fh:
    fh.write("// 자동 생성 파일 — scripts/build-gallery.sh 가 갱신합니다.\n")
    fh.write("window.GALLERY = [\n")
    for name in chosen:
        fh.write("  " + json.dumps(name, ensure_ascii=False) + ",\n")
    fh.write("];\n")
print(f"✓ 완료: {len(chosen)} 장의 사진이 등록되었습니다. → {out}")
PY
