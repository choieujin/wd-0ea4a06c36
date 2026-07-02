#!/usr/bin/env node
// 실시간 주차 현황 수집기 — GitHub Actions에서 주기 실행되어 assets/data/parking.json 을 갱신한다.
// 소스별로 독립 실패 처리(하나가 죽어도 나머지는 갱신). 결과는 프론트(assets/js/parking.js)가 읽는다.
//
// 소스
//   삼각지  : 용산구 시설관리 (HTML 테이블 파싱)           — 인증키 불필요
//   이촌1~3 : 한강사업본부 ihangangpark.kr (HTML 파싱)      — 인증키 불필요, TLS 인증서 만료 → 검증 우회
//   동작대교: 서울시 시영주차장 실시간 API (OA-21709)        — SEOUL_API_KEY 필요, 없으면 pending 유지

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "assets", "data", "parking.json");
const TIMEOUT = 20000;

// KST ISO 문자열 (Actions 러너는 UTC)
function nowKstISO() {
  const d = new Date();
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  return kst.toISOString().replace("Z", "+09:00");
}

async function getText(url, { insecure = false } = {}) {
  // 인증서 만료 사이트(한강)를 위한 우회
  if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (wedding-parking-bot)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
    if (insecure) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}

const toInt = (s) => {
  const n = parseInt(String(s).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// available/total → 상태 코드
function statusOf(available, total) {
  if (available == null || total == null || total <= 0) return "unknown";
  const ratio = available / total;
  if (available <= 0) return "full";
  if (ratio < 0.1) return "busy";
  return "ok";
}

// ── 삼각지 (용산구) ─────────────────────────────────────────────
// <tr><th>삼각지</th><td>총면수</td><td>현재</td><td class="last">가용</td></tr>
async function fetchSamgakji() {
  const html = await getText("https://www.yong-san.or.kr/site/main/parking/infos");
  const m = html.match(
    /<th>\s*삼각지\s*<\/th>\s*<td>\s*([\d,]+)\s*<\/td>\s*<td>\s*([\d,]+)\s*<\/td>\s*<td[^>]*>\s*([\d,]+)\s*<\/td>/
  );
  if (!m) throw new Error("삼각지 행 파싱 실패");
  const total = toInt(m[1]);
  const available = toInt(m[3]);
  return { total, available };
}

// ── 이촌1~3 (한강사업본부) ──────────────────────────────────────
// 열: 주차장명 | 주소 | 길찾기 | 주차가능대수(가용) | 주차구획수(계)(총) | 면적
async function fetchIchon() {
  const html = await getText("https://ihangangpark.kr/parking/region/region6", { insecure: true });
  const out = {};
  for (const name of ["이촌1주차장", "이촌2주차장", "이촌3주차장"]) {
    // 행 블록 추출 후 숫자 셀만 순서대로 수집
    const rowRe = new RegExp(`<span>\\s*${name}\\s*</span>[\\s\\S]*?</tr>`);
    const row = html.match(rowRe);
    if (!row) { out[name] = null; continue; }
    const cells = [...row[0].matchAll(/<span[^>]*>\s*([\d,]+)\s*<\/span>/g)].map((x) => toInt(x[1]));
    // cells: [가용, 총구획, 면적] (첫 매치는 이름 span 이후 숫자만 잡힘)
    const available = cells[0] ?? null;
    const total = cells[1] ?? null;
    out[name] = { available, total };
  }
  return out;
}

// ── 동작대교 (서울시 시영 실시간 API, OA-21709) ─────────────────
// 키가 있어야 활성화. 없으면 null 반환 → pending 유지.
async function fetchDongjak() {
  const KEY = process.env.SEOUL_API_KEY;
  if (!KEY) return null;
  // 실시간 주차대수 서비스명은 발급 문서에 맞춰 조정 필요 (자리만 확보)
  const url = `http://openapi.seoul.go.kr:8088/${KEY}/json/GetParkingInfo/1/1000/`;
  const txt = await getText(url);
  const data = JSON.parse(txt);
  const rows = data?.GetParkingInfo?.row || [];
  const pick = (kw) => rows.find((r) => (r.PKLT_NM || r.PARKING_NAME || "").includes(kw));
  const map = (r) => r && {
    total: toInt(r.TPKCT ?? r.TOTAL),
    available: (() => {
      const t = toInt(r.TPKCT ?? r.TOTAL);
      const now = toInt(r.NOW_PRK_VHCL_CNT ?? r.CUR_PARKING);
      return t != null && now != null ? Math.max(t - now, 0) : null;
    })(),
  };
  return { 동작대교: map(pick("동작대교")), 동작주차공원: map(pick("동작주차공원")) };
}

// ── 조립 ────────────────────────────────────────────────────────
const lots = [];
const errors = [];

async function tryFetch(label, fn) {
  const start = Date.now();
  try {
    const r = await fn();
    console.log(`  ✓ ${label} (${Date.now() - start}ms)`);
    return r;
  } catch (e) {
    console.log(`  ✗ ${label}: ${e.message} (${Date.now() - start}ms)`);
    errors.push(`${label}: ${e.message}`);
    return null;
  }
}

const t0 = Date.now();

const [samgakji, ichon, dongjak] = await Promise.all([
  tryFetch("삼각지", fetchSamgakji),
  tryFetch("이촌", fetchIchon),
  tryFetch("동작대교(API)", fetchDongjak),
]);

// 삼각지
lots.push({
  id: "samgakji",
  name: "삼각지역 임시주차장",
  note: "전쟁기념관·대절버스 인근",
  ...(samgakji
    ? { total: samgakji.total, available: samgakji.available, status: statusOf(samgakji.available, samgakji.total), ok: true }
    : { total: null, available: null, status: "error", ok: false }),
});

// 동작대교 (API 키 없으면 pending)
const dj = dongjak?.동작대교;
lots.push({
  id: "dongjak",
  name: "동작대교 공영주차장",
  note: dongjak ? "" : "실시간 연동 준비중 (API 키 발급 후 활성화)",
  ...(dj
    ? { total: dj.total, available: dj.available, status: statusOf(dj.available, dj.total), ok: true }
    : { total: null, available: null, status: "pending", ok: false }),
});

// 이촌1~3
for (const [name, key] of [["이촌1주차장", "ichon1"], ["이촌2주차장", "ichon2"], ["이촌3주차장", "ichon3"]]) {
  const v = ichon?.[name];
  const sane = v && v.available != null && v.total != null && v.available <= v.total;
  lots.push({
    id: key,
    name,
    note: "한강공원",
    ...(v && v.available != null
      ? { total: v.total, available: v.available, status: sane ? statusOf(v.available, v.total) : "unknown", ok: true }
      : { total: null, available: null, status: "error", ok: false }),
  });
}

const payload = {
  updatedAt: nowKstISO(),
  elapsedMs: Date.now() - t0,
  errors,
  lots,
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`\n총 ${payload.elapsedMs}ms · ${lots.length}개 주차장 · 오류 ${errors.length}건`);
console.log(`→ ${OUT}`);
