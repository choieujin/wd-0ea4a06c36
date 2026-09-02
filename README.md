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
node server.mjs
# 브라우저에서 http://localhost:8765 접속
```

축하 메시지까지 실제로 남겨보려면 `server.mjs` 로 띄워야 합니다.
화면만 확인할 거라면 `python3 -m http.server 8765` 도 됩니다(이때 방명록은 읽기 전용).

---

## 폴더 구조

```
.
├── index.html                # 청첩장 본문 (모든 섹션)
├── server.mjs                # 로컬 서버 + 축하 메시지 API (Node, 외부 패키지 없음)
├── assets/
│   ├── css/style.css         # 스타일 (모바일 우선 반응형)
│   ├── js/
│   │   ├── main.js           # 캘린더·갤러리·계좌복사·D-day 동작
│   │   ├── guestbook.js      # 축하 메시지(방명록) 동작
│   │   └── gallery-list.js   # 갤러리 사진 목록 (자동 생성)
│   ├── data/
│   │   └── guestbook.json    # 축하 메시지 저장 파일 (DB 대신)
│   ├── gallery/              # 갤러리 사진 원본 (여기에 사진 넣기)
│   └── images/
│       ├── main.jpg          # 표지 대표 사진
│       └── og.jpg            # 카톡/문자 공유 미리보기 이미지
├── data/                     # 방명록 비밀번호 해시 (서버 전용 · git 제외)
└── scripts/
    └── build-gallery.sh      # 갤러리 목록 생성 + WebP 변환
```

---

## 축하 메시지 (방명록)

갤러리 아래에 하객이 축하 메시지를 남기는 섹션이 있습니다. **DB 없이 JSON 파일**에 저장합니다.

| | |
|---|---|
| 저장 파일 | `assets/data/guestbook.json` (공개 · 그대로 커밋해도 되는 파일) |
| 비밀번호 해시 | `data/guestbook-auth.json` (서버 전용 · `.gitignore` 처리됨) |
| 쓰기 | `server.mjs` 의 `POST /api/guestbook` |
| 읽기 | API가 있으면 API, 없으면 JSON 파일을 직접 읽음 |

### 두 가지 모드

**1) 서버를 띄운 경우 — 읽기 + 쓰기**

```bash
node server.mjs            # http://localhost:8765
PORT=3000 node server.mjs  # 포트 변경
```

하객이 남긴 메시지는 곧바로 `assets/data/guestbook.json` 에 기록됩니다.

**2) GitHub Pages 처럼 정적으로만 배포한 경우 — 읽기 전용**

Pages 에는 API가 없으므로 `/api/guestbook` 요청이 404가 되고, `guestbook.js` 가 자동으로
읽기 전용으로 전환합니다. 입력 폼이 숨겨지고 "메시지 열람만 가능합니다" 안내가 뜹니다.
**즉, Pages 주소만으로는 하객이 메시지를 남길 수 없습니다.** 남기게 하려면 둘 중 하나가 필요합니다.

- `server.mjs` 를 어딘가(집 PC + 터널, Render, Fly.io 등)에 띄우고,
  `index.html` 의 방명록 섹션에 API 주소를 적어줍니다.
  ```html
  <section class="guestbook ..." id="guestbook" data-api="https://내주소/api/guestbook">
  ```
  (서버가 CORS 를 허용하므로 다른 도메인에 올려도 동작합니다.)
- 또는 서버를 잠깐 로컬에서 돌려 메시지를 받은 뒤,
  갱신된 `assets/data/guestbook.json` 을 커밋·푸시해 Pages 에 반영합니다.
  이 경우 Pages 방문자는 메시지를 **읽기만** 합니다.

### 메시지 삭제

- 작성자: 글 쓸 때 정한 숫자 4자리 비밀번호로 본인 글 삭제 (`삭제` 버튼)
- 관리자: 서버를 `GUESTBOOK_ADMIN_KEY=원하는키 node server.mjs` 로 띄우면
  그 키를 비밀번호 자리에 넣어 아무 글이나 삭제할 수 있습니다.
- 손으로 지워도 됩니다 — `assets/data/guestbook.json` 에서 해당 항목을 지우면 끝입니다.

### 한글·이모지가 깨지지 않게 하는 규칙

수정할 일이 있다면 아래를 유지해 주세요. (자세한 이유는 `server.mjs` 상단 주석)

- 요청 본문은 청크를 다 모은 뒤 **한 번에** UTF-8 디코딩 (중간에 자르면 한글이 깨짐)
- 파일 읽기/쓰기 시 `"utf8"` 명시, 응답 헤더에 `charset=utf-8` 명시
- 저장 전 `normalize("NFC")` — iOS/macOS 에서 오는 자모 분리 한글을 합침
- 글자 수 제한은 `length` 가 아니라 **코드포인트**(`Array.from`) 기준 — 이모지가 반쪽으로 잘리지 않음

---

## 자주 바꾸는 내용 위치

| 항목 | 위치 |
|---|---|
| 인사말 | `index.html` — `.greeting__text` |
| 예식 일시/장소 | `index.html` — `.cover`, `.calendar` / `main.js`의 `WEDDING` 값 |
| 계좌번호 | `index.html` — `.acc-item`의 `data-account` |
| 교통·주차 안내 | `index.html` — `.location` 의 `.info-block` |
| 지도 검색어 | `main.js` — `PLACE_QUERY` |
| 축하 메시지 문구·이모지 목록 | `assets/js/guestbook.js` — `EMOJIS`, `MAX_MESSAGE` |
| 표지/색상 톤 | `assets/css/style.css` — `:root` 변수 |

---

## 참고

- **이미지 최적화:** `brew install webp` 후 `build-gallery.sh`를 실행하면 사진을 WebP로 변환해 용량을 크게 줄여줍니다(모바일 로딩 속도 개선).
- **주소 변경:** 레포 이름을 바꾸면 공개 주소도 바뀝니다 (`gh repo rename <새이름>`).
- **공개 범위:** 무료 GitHub Pages는 public 레포에서만 동작합니다. 사이트 접속자는 누구나 사진·계좌를 볼 수 있으니 주소 공유에 유의하세요.
