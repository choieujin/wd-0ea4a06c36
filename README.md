# 모바일 청첩장

순수 HTML/CSS/JS로 만든 정적 사이트이며 GitHub Pages로 배포됩니다.

---

## 변경사항 반영 방법

### 1. 코드·내용 수정 → 푸시만 하면 됩니다 ✅

`main` 브랜치에 푸시하면 GitHub Pages가 **자동으로 다시 빌드·배포**합니다. (약 1분)

```bash
git add .
git commit -m "수정 내용"
git push
```

표지 교체, 글자/색 수정, 계좌번호 변경, 안내문 수정 등은 전부 **푸시만** 하면 반영됩니다.

### 2. 갤러리 사진 추가/삭제/교체 → 빌드 한 번 필요 ⚠️

갤러리는 `assets/js/gallery-list.js`(사진 파일명 목록)를 보고 그립니다. 이 목록은 자동으로 갱신되지 않으므로, **사진을 바꿀 때만** 빌드 스크립트를 한 번 돌려야 합니다.

```bash
# 1) assets/gallery/ 에 사진을 넣거나 빼고
bash scripts/build-gallery.sh    # gallery-list.js 자동 갱신 (+ cwebp 있으면 WebP 변환)

# 2) 평소처럼 배포
git add .
git commit -m "사진 업데이트"
git push
```

### 정리

| 작업 | 빌드 필요? | 명령 |
|---|---|---|
| 글자·색·계좌·안내 등 수정 | ❌ | `add → commit → push` |
| 표지(main.jpg) 교체 | ❌ | 같은 파일명으로 덮어쓰고 push |
| **갤러리 사진 추가/삭제/교체** | ✅ | `build-gallery.sh` → `add → commit → push` |

---

## 로컬에서 미리보기

```bash
python3 -m http.server 8765
# 브라우저에서 http://localhost:8765 접속
```

---

## 폴더 구조

```
.
├── index.html                # 청첩장 본문 (모든 섹션)
├── assets/
│   ├── css/style.css         # 스타일 (모바일 우선 반응형)
│   ├── js/
│   │   ├── main.js           # 캘린더·갤러리·계좌복사·D-day 동작
│   │   └── gallery-list.js   # 갤러리 사진 목록 (자동 생성)
│   ├── gallery/              # 갤러리 사진 원본 (여기에 사진 넣기)
│   └── images/
│       ├── main.jpg          # 표지 대표 사진
│       └── og.jpg            # 카톡/문자 공유 미리보기 이미지
└── scripts/
    └── build-gallery.sh      # 갤러리 목록 생성 + WebP 변환
```

---

## 자주 바꾸는 내용 위치

| 항목 | 위치 |
|---|---|
| 인사말 | `index.html` — `.greeting__text` |
| 예식 일시/장소 | `index.html` — `.cover`, `.calendar` / `main.js`의 `WEDDING` 값 |
| 계좌번호 | `index.html` — `.acc-item`의 `data-account` |
| 교통·주차 안내 | `index.html` — `.location` 의 `.info-block` |
| 지도 검색어 | `main.js` — `PLACE_QUERY` |
| 표지/색상 톤 | `assets/css/style.css` — `:root` 변수 |

---

## 참고

- **이미지 최적화:** `brew install webp` 후 `build-gallery.sh`를 실행하면 사진을 WebP로 변환해 용량을 크게 줄여줍니다(모바일 로딩 속도 개선).
- **주소 변경:** 레포 이름을 바꾸면 공개 주소도 바뀝니다 (`gh repo rename <새이름>`).
- **공개 범위:** 무료 GitHub Pages는 public 레포에서만 동작합니다. 사이트 접속자는 누구나 사진·계좌를 볼 수 있으니 주소 공유에 유의하세요.
