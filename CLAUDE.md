# 모바일 청첩장 (Mobile Wedding Invitation)

모바일 청첩장 웹 서버 프로젝트.

## 프로젝트 개요

하객에게 링크로 공유하는 모바일 최적화 청첩장. 신랑·신부 정보, 예식 일시/장소, 갤러리, 오시는 길(지도), 축하 메시지(방명록), 마음 전하기(계좌) 등을 담는다.

## 개발

- 작업 디렉토리: `/Users/choeyujin/GIT/청첩장`
- 권한: `.claude/settings.local.json`에서 `bypassPermissions`로 모든 명령어 자동 허용 설정됨.

## 메모

- 모바일 우선(mobile-first) 반응형 설계.
- 기술 스택: 순수 HTML/CSS/JS 정적 사이트(GitHub Pages 배포) + 축하 메시지용 Node 서버(`server.mjs`, 외부 패키지 없음).

## 축하 메시지(방명록)

- DB를 쓰지 않는다. 저장소는 구글 시트이고, GitHub Pages 에 서버가 없어서 글을 받는 창구만 구글 쪽에 둔다.
- 설정은 `assets/js/guestbook-config.js` 한 파일. 비어 있으면 자동으로 읽기 전용.
- `guestbook.js` 는 백엔드를 네 가지 중에서 고른다:
  `script`(시트에 붙인 Apps Script 웹 앱, `apps-script/Code.gs` · **권장**) → `form`(구글 폼) →
  `server`(`server.mjs` 의 `/api/guestbook`, 파일 저장) → `file`(`assets/data/guestbook.json` 읽기 전용).
- Apps Script 로 POST 할 때는 CORS preflight 를 피하려고 `text/plain;charset=utf-8` 로 보낸다(본문은 JSON 문자열). 스크립트를 고치면 **새 버전으로 재배포**해야 반영된다.
- 구글 폼 방식의 제약: 전송 응답을 읽을 수 없어(no-cors) 보낸 글은 localStorage 에 잠시 넣어 화면에 먼저 띄우고 시트에 올라오면 교체한다. 하객 본인 삭제는 불가(시트에서 행 삭제).
- **한글·이모지 깨짐 방지 규칙**(수정 시 반드시 유지, 이유는 `server.mjs` 상단 주석 참고):
  요청 본문은 청크를 다 모은 뒤 한 번에 UTF-8 디코딩 · 파일 IO에 `"utf8"` 명시 · 응답에 `charset=utf-8` ·
  저장 전 `normalize("NFC")` · 길이 제한은 `length` 가 아니라 코드포인트(`Array.from`) 기준 · 폼 전송은 `URLSearchParams`.

## 참고 지식: 주차장 데이터 출처

주차/주차장/실시간 현황(삼각지·동작대교·이촌 등) 관련 작업(수집기 수정, 새 주차장 추가, 데이터 미출력, 링크/키 연동 등) 전에 **[docs/parking-data-sources.md](docs/parking-data-sources.md)** 를 먼저 읽을 것. 주차장별 웹 출처·수집 방법·알려진 제약(IP 차단/TLS 만료/이중주차)과 과거 결정 히스토리가 정리돼 있다.
