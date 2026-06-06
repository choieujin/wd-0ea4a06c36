#!/usr/bin/env bash
# 갤러리 빌드 스크립트
# 1) assets/gallery/ 안의 사진(jpg/png)을 WebP로 변환 (cwebp 설치 시)
# 2) assets/js/gallery-list.js 자동 생성
#
# 사용법:
#   bash scripts/build-gallery.sh
#
# WebP 변환을 원하면 먼저 설치: brew install webp

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/assets/gallery"
OUT="$ROOT/assets/js/gallery-list.js"

mkdir -p "$DIR"

# ---- 1) WebP 변환 ----
if command -v cwebp >/dev/null 2>&1; then
  echo "→ WebP 변환 중..."
  shopt -s nullglob nocaseglob
  for f in "$DIR"/*.jpg "$DIR"/*.jpeg "$DIR"/*.png; do
    [ -e "$f" ] || continue
    base="${f%.*}"
    if [ ! -f "$base.webp" ]; then
      cwebp -quiet -q 82 -resize 1280 0 "$f" -o "$base.webp"
      echo "   ✓ $(basename "$base.webp")"
    fi
  done
  shopt -u nullglob nocaseglob
else
  echo "⚠ cwebp 미설치 — 원본 이미지를 그대로 사용합니다. (brew install webp 권장)"
fi

# ---- 2) gallery-list.js 생성 ----
# 공백·대소문자(.JPG 등)·한글 파일명을 정확히 보존하기 위해 python3로 생성.
# webp 버전이 있으면 같은 이름의 원본 대신 webp를 사용.
echo "→ gallery-list.js 생성 중..."
python3 - "$DIR" "$OUT" <<'PY'
import os, sys, json
d, out = sys.argv[1], sys.argv[2]
exts = (".webp", ".jpg", ".jpeg", ".png")
files = [f for f in os.listdir(d)
         if f.lower().endswith(exts) and not f.startswith(".")]
by_base = {}
for f in files:
    base, ext = os.path.splitext(f)
    # 같은 base에 webp가 있으면 webp 우선
    if base not in by_base or ext.lower() == ".webp":
        by_base[base] = f
chosen = sorted(by_base.values(), key=lambda s: s.lower())
with open(out, "w", encoding="utf-8") as fh:
    fh.write("// 자동 생성 파일 — scripts/build-gallery.sh 가 갱신합니다.\n")
    fh.write("window.GALLERY = [\n")
    for name in chosen:
        fh.write("  " + json.dumps(name, ensure_ascii=False) + ",\n")
    fh.write("];\n")
print(f"✓ 완료: {len(chosen)} 장의 사진이 등록되었습니다. → {out}")
PY
