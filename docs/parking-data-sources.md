# 주차장 데이터 출처 & 결정 히스토리

청첩장(용산가족공원 예식) "실시간 주차 현황" 위젯이 다루는 주차장과 각 데이터 출처, 그리고 그렇게 결정한 이유를 기록한다.
새 주차장 추가·수집 복구·API 연동 전 **여기서 출처와 알려진 제약, 과거 결정을 먼저 확인**한다.

## 관련 파일

| 역할 | 파일 |
|------|------|
| 수집기 (Node, 무의존, Actions 실행) | `scripts/fetch-parking.mjs` |
| 출력 데이터 | `assets/data/parking.json` |
| 프론트 위젯 | `assets/js/parking.js` |
| 위젯 마운트 | `index.html`의 `#parkLive` (`data-src` + `data-remote`) |
| 갱신 크론 | `.github/workflows/parking.yml` (상시 15분: `7,22,37,52 * * * *`) |
| 배포 | `.github/workflows/deploy-pages.yml` (GitHub Actions Pages) |

**데이터 흐름:** 크론 → `fetch-parking.mjs` → `parking.json` 커밋(`[skip ci]`, 배포 안 함) → 프론트가 `data-remote`(raw.githubusercontent) 최신본 먼저 읽고 실패 시 배포본 `data-src` 폴백. 데이터 갱신에 Pages 재배포 불필요.

## 주차장별 출처 (요청했던 전체)

### 1. 삼각지역 임시주차장 — ⚠️ 자동 수집 불가 → 링크 카드
- **운영:** 용산구(시설관리) · **웹:** https://www.yong-san.or.kr/site/main/parking/infos
- **형식:** HTML 테이블 `<th>삼각지</th><td>총면수</td><td>현재</td><td class="last">가용</td>`
- **제약:** yong-san.or.kr이 **데이터센터/해외 IP를 404 차단**. GitHub Actions 러너 불가, 프록시 6종(codetabs·allorigins raw/get·thingproxy·jina) 전부 실패. **국내(한국) IP만 200.**
- **살리려면:** 국내 IP 장비(집 PC/라즈베리파이/국내 VPS) cron으로 긁어 `parking.json` push. Actions로는 불가.
- 위치: 전쟁기념관·대절버스 인근.

### 2. 이촌1·2·3 주차장 — ✅ 자동 수집 (한강공원)
- **운영:** 서울시 한강사업본부 · **웹:** https://ihangangpark.kr/parking/region/region6
- **형식:** HTML 테이블. 열 = `주차장명 | 주소 | 길찾기 | 주차가능대수(가용) | 주차구획수(계)(총) | 면적(m²)`
- **노하우:** TLS 인증서 만료 → `node:https` + `rejectUnauthorized:false`; 301 수동 추적; `Accept-Encoding: identity`(gzip 회피).
- **데이터 특성:** **이중주차 가능** → 가용>총이 정상. "가용>총" 모순 가드를 두지 말 것. (예: 이촌1 가용 66/총 32)
- 좌표: 이촌1(37.5180507,126.992249) · 이촌2(37.5157374,126.982601) · 이촌3(37.5175315,126.9704918)

### 3. 동작대교 / 동작대교(위) 공영주차장 — 🔜 미구현 (API 키 대기)
- **운영:** 서울시(시영) · **웹:** https://parking.seoul.go.kr
- **실시간 API:** 열린데이터광장 **OA-21709** "서울시 시영주차장 실시간 주차대수 정보"(~5분 지연). 구 OA-13122는 실시간 컬럼 삭제 — 쓰지 말 것.
- **호출:** `http://openapi.seoul.go.kr:8088/{SEOUL_API_KEY}/json/GetParkingInfo/1/1000/` (서비스명/필드 `TPKCT`,`NOW_PRK_VHCL_CNT` 등은 발급 문서 기준 조정).
- **상태:** `SEOUL_API_KEY` 미발급이라 수집기에서 제외됨. 키 발급 → 레포 Secrets 등록 → `fetchDongjak` 복원. 공식 API라 IP 차단 없음(러너 OK 예상).

### 4. 동작주차공원 공영주차장 — 🔜 미구현 (구영)
- **운영:** 동작구(구영) · **웹:** parking.seoul.go.kr
- **제약:** 구영이라 시영 실시간 API(OA-21709)에 없을 수 있음. parking.seoul.go.kr 내부 endpoint 역이용 필요 가능. 미조사.

## `parking.json` lot 스키마
`{ id, name, note, status, link, linkLabel?, total, available, ok }`
- `status`: `ok`(여유)·`busy`(가용<10%)·`full`(만차)·`link`(자동수집 불가→링크)·`pending`(연동 대기)·`error`·`unknown`
- `link`: 각 카드는 **데이터 원본 사이트**로 연결(지도 아님).

## 결정 히스토리 (왜 이렇게 됐나)

| 결정 | 이유 |
|------|------|
| 삼각지 = 링크 카드 | 원본이 러너·프록시 IP를 404 차단. 국내 IP만 가능 → 자동수집 포기. |
| 이촌 모순 가드 제거 | 이중주차라 가용>총이 정상. 가드가 잘못된 "확인 불가"를 유발했음. |
| 카드 링크 = 원본 데이터 사이트 | 지도(네이버맵)가 아니라 실시간 현황 원본 사이트로 연결하라는 요청. |
| 동작대교 수집기에서 제외 | API 키 미발급. 키 나오면 재추가. |
| Pages를 Actions 배포로 전환 | legacy 브랜치 빌드가 반복적으로 errored/전파 지연 → `deploy-pages.yml`로 결정적 배포. |
| parking.json 커밋은 `[skip ci]` + 배포 안 함 | 프론트가 raw.githubusercontent 최신본을 직접 읽어 Pages 배포 한도(429) 소모 회피. |
| 크론 = `7,22,37,52`분 | 정각은 전세계 예약작업 몰려 지연/생략 → off-peak 분으로 배치. |

## 새 주차장 추가 체크리스트
1. 이 문서 표에 출처/제약 먼저 추가.
2. 출처가 데이터센터 IP를 차단하는지 **러너에서** 실제 확인(로컬만으로 판단 금지 — 삼각지 사례).
3. TLS/리다이렉트/인코딩 이슈는 `getText`/`httpsGetInsecure` 패턴 재사용.
4. 값이 상식과 어긋나면(가용>총 등) 데이터 특성(이중주차 등)인지 먼저 의심.
5. `link`는 지도가 아니라 실시간 데이터 원본 사이트로.
