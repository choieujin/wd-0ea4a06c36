---
name: parking-sources
description: 청첩장 "실시간 주차 현황" 기능의 주차장 목록과 각 주차장의 웹 데이터 출처·수집 방법·특이사항 레퍼런스. 주차/parking/주차장/실시간 현황/삼각지/동작대교/이촌/한강공원 주차 관련 작업(수집기 수정, 새 주차장 추가, 데이터가 안 나옴, 링크 변경, API 키 연동 등)을 할 때 반드시 먼저 이 스킬을 읽어 출처와 알려진 제약(IP 차단, TLS 만료, 이중주차)을 파악할 것.
---

# 주차장 데이터 출처 레퍼런스

청첩장(용산가족공원 예식)의 "실시간 주차 현황" 위젯이 다루는 주차장과 각 데이터 출처를 정리한다.
새 주차장을 추가하거나 기존 수집이 깨졌을 때, **먼저 이 표로 출처와 알려진 제약을 확인**한 뒤 코드를 건드린다.

## 관련 파일 (구현 위치)

| 역할 | 파일 |
|------|------|
| 수집기 (Node, 무의존, Actions에서 실행) | `scripts/fetch-parking.mjs` |
| 출력 데이터 | `assets/data/parking.json` |
| 프론트 위젯 (데이터 읽어 렌더) | `assets/js/parking.js` |
| 위젯 마운트 지점 | `index.html`의 `#parkLive` (`data-src` + `data-remote`) |
| 갱신 크론 | `.github/workflows/parking.yml` (상시 15분: `7,22,37,52 * * * *`) |
| 배포 | `.github/workflows/deploy-pages.yml` (GitHub Actions Pages) |

**데이터 흐름:** 크론이 `fetch-parking.mjs` 실행 → `parking.json` 커밋(`[skip ci]`, 배포 안 함) → 프론트가 `data-remote`(raw.githubusercontent) 최신본을 먼저 읽고 실패 시 배포본 `data-src`로 폴백. 그래서 데이터 갱신에 Pages 재배포가 불필요.

## 주차장 목록 (사용자가 요청한 전체)

### 1. 삼각지역 임시주차장 — ⚠️ 자동 수집 불가 (링크 카드)
- **운영:** 용산구 (시설관리)
- **웹 출처:** https://www.yong-san.or.kr/site/main/parking/infos
- **데이터 형식:** HTML 테이블 행 `<th>삼각지</th><td>총면수</td><td>현재</td><td class="last">가용</td>`
- **제약(중요):** yong-san.or.kr이 **데이터센터/해외 IP를 404로 차단**. GitHub Actions 러너에서 수집 불가. 프록시 6종(codetabs, allorigins raw/get, thingproxy, jina) **전부 실패** 검증됨. **국내(한국) IP에서만 200.**
- **현재 처리:** 자동 수집 포기 → `status: "link"` 카드로 원본 사이트 링크만 제공.
- **살리려면:** 국내 IP에서 스크래퍼를 돌려(집 PC/라즈베리파이/국내 VPS cron) `parking.json`에 push하는 방법뿐. Actions로는 구조적으로 불가.
- 위치 메모: 전쟁기념관·대절버스 인근.

### 2. 이촌1·2·3 주차장 — ✅ 자동 수집 (한강공원)
- **운영:** 서울시 한강사업본부
- **웹 출처:** https://ihangangpark.kr/parking/region/region6
- **데이터 형식:** HTML 테이블. 열 순서 = `주차장명 | 주소 | 길찾기 | 주차가능대수(가용) | 주차구획수(계)(총) | 면적(m²)`
- **제약/노하우:**
  - **TLS 인증서 만료** → `node:https` + `rejectUnauthorized:false`로 우회 (undici/fetch로는 우회가 까다로워 `httpsGetInsecure` 사용).
  - **301 리다이렉트를 자동으로 안 따라감** → 수동 추적.
  - `Accept-Encoding: identity`로 gzip 회피(node:https는 자동 해제 안 함).
  - **이중주차 가능** → 가용 대수가 총 주차면수를 초과할 수 있음(정상). 그래서 "가용>총" 모순 가드를 두지 말 것. 예: 이촌1 가용 66 / 총 32.
- 좌표: 이촌1(37.5180507, 126.992249) · 이촌2(37.5157374, 126.982601) · 이촌3(37.5175315, 126.9704918)

### 3. 동작대교 공영주차장 / 동작대교(위) 공영주차장 — 🔜 미구현 (API 키 대기)
- **운영:** 서울시 (시영)
- **웹 출처:** https://parking.seoul.go.kr (서울특별시 주차정보안내시스템)
- **실시간 API:** 서울 열린데이터광장 **OA-21709** "서울시 시영주차장 실시간 주차대수 정보" (약 5분 지연). 구 OA-13122는 실시간 컬럼이 삭제됨 — 쓰지 말 것.
- **호출:** `http://openapi.seoul.go.kr:8088/{SEOUL_API_KEY}/json/GetParkingInfo/1/1000/` — 서비스명/필드명(`TPKCT`, `NOW_PRK_VHCL_CNT` 등)은 발급 문서에 맞춰 조정 필요.
- **현재 상태:** `SEOUL_API_KEY` 미발급이라 수집기에서 제외됨. 키 발급 후 재추가 가능 (레포 Settings → Secrets에 `SEOUL_API_KEY` 등록 → `fetchDongjak` 복원).
- 참고: 공식 API라 IP 차단 없음 → 러너에서 안정적으로 동작 예상.

### 4. 동작주차공원 공영주차장 — 🔜 미구현 (구영)
- **운영:** 동작구 (구영)
- **웹 출처:** parking.seoul.go.kr
- **제약:** 구영이라 서울시 시영 실시간 API(OA-21709)에 **없을 수 있음**. parking.seoul.go.kr 내부 endpoint를 역이용해야 할 가능성. 미조사.

## 데이터 스키마 (`parking.json`의 lot 객체)

```
{ id, name, note, status, link, linkLabel?, total, available, ok }
```
- `status`: `"ok"`(여유) · `"busy"`(혼잡, 가용<10%) · `"full"`(만차) · `"link"`(자동수집 불가→링크) · `"pending"`(연동 대기) · `"error"`(수집 실패) · `"unknown"`
- `link`: 각 카드는 해당 주차장의 **데이터 원본 사이트**로 연결 (지도 링크 아님).

## 새 주차장 추가 시 체크리스트
1. 이 표에 출처/제약을 먼저 추가한다.
2. 출처가 **데이터센터 IP를 차단하는지** 러너에서 실제로 확인(로컬만으로 판단 금지 — 삼각지 사례).
3. TLS/리다이렉트/인코딩 등 접속 이슈는 `getText`/`httpsGetInsecure` 패턴 재사용.
4. 값이 상식과 어긋나면(가용>총 등) 데이터 특성(이중주차 등)인지 먼저 의심.
5. `link`는 지도가 아니라 실시간 데이터 원본 사이트로.
