/**
 * 축하 메시지(방명록) — 구글 시트에 붙여넣는 스크립트
 *
 * 이 스크립트를 "웹 앱"으로 배포하면 그 주소가 글을 받는 창구가 된다.
 * 메시지는 이 시트의 guestbook 탭에 한 줄씩 쌓인다. (DB 없음 · 시트가 곧 저장소)
 *
 * ══════════════════════════════════════════════════════════════════════
 *  설치 — 시트에서만 하면 된다 (폼 안 만들어도 됨)
 *
 *   ① 시트 상단 [확장 프로그램] → [Apps Script] 를 연다.
 *   ② 기본으로 적혀 있는 코드를 전부 지우고, 이 파일 내용을 통째로 붙여넣는다.
 *   ③ 저장(💾).
 *   ④ 상단 함수 목록에서 setup 을 고르고 [실행] 을 한 번 누른다.
 *      → 권한 승인 창이 뜨면: 계정 선택 → "고급" → "…(안전하지 않음)으로 이동" → 허용
 *      → 시트에 guestbook 탭이 생기면 성공.
 *   ⑤ 오른쪽 위 [배포] → [새 배포] → 톱니바퀴 ⚙ → [웹 앱] 선택
 *        • 실행 계정   : 나
 *        • 액세스 권한 : 모든 사용자     ← 하객이 로그인 없이 쓰려면 반드시 이것
 *      [배포] 를 누르면 주소가 나온다:
 *        https://script.google.com/macros/s/AKfycb....../exec
 *   ⑥ 그 주소를 assets/js/guestbook-config.js 의 webAppUrl 에 넣는다.
 *
 *  ※ 나중에 이 코드를 고치면 반드시 [배포] → [배포 관리] → 연필 ✏ →
 *     버전 "새 버전" → [배포] 를 해야 반영된다. 저장만으로는 안 바뀐다.
 * ══════════════════════════════════════════════════════════════════════
 *
 * 한글·이모지가 깨지지 않게 하는 규칙:
 *  - 저장 전 normalize("NFC") — iOS/macOS 에서 오는 자모 분리 한글을 합친다.
 *  - 길이 제한은 length 가 아니라 코드포인트(Array.from) 기준 — 이모지가 반쪽으로 안 잘린다.
 *  - 응답은 ContentService JSON(UTF-8).
 *  - 청첩장은 CORS 사전요청(preflight)을 피하려고 text/plain 으로 POST 한다.
 *    (Apps Script 는 preflight 를 처리하지 못한다. 본문 내용은 그냥 JSON 문자열이다)
 */

/* 이 스크립트가 붙어 있는 시트를 쓴다. 다른 시트를 쓰려면 여기에 시트 ID를 적는다. */
var SHEET_ID = "";
/* 메시지가 쌓일 탭 이름. 기존 탭은 건드리지 않고 이 탭만 쓴다. */
var SHEET_NAME = "guestbook";

var MAX_NAME = 20;      // 코드포인트
var MAX_MESSAGE = 300;  // 코드포인트

/* 열 순서 — 손으로 열을 옮기거나 지우지 말 것 */
var COL = { ID: 1, CREATED: 2, NAME: 3, MESSAGE: 4, PWHASH: 5 };
var HEADER = ["id", "작성시각", "이름", "축하 메시지", "pwHash"];

/* ─────────────────────────────────────────────────────────────── 설치 */

/** ④ 에서 한 번 실행하는 함수 — guestbook 탭과 머리글을 만든다. */
function setup() {
  var sh = sheet_();
  try {
    SpreadsheetApp.getActive().toast("준비 완료 — '" + sh.getName() + "' 탭에 메시지가 쌓입니다.");
  } catch (e) { /* 시트 UI 없이 실행한 경우 */ }
  return "OK: " + sh.getName();
}

function book_() {
  return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActive();
}

function sheet_() {
  var ss = book_();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { sh = ss.insertSheet(SHEET_NAME); }
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.setColumnWidth(COL.MESSAGE, 460);
    sh.hideColumns(COL.PWHASH); // 비밀번호 해시는 보이지 않게
  }
  return sh;
}

/* ─────────────────────────────────────────────────────────────── 유틸 */

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 코드포인트 기준으로 자르기 — 이모지가 중간에서 잘리지 않는다 */
function clamp_(s, n) {
  return Array.from(String(s)).slice(0, n).join("");
}

/** NFC 정규화 + 제어문자 제거(줄바꿈만 허용) */
function clean_(input, multiline) {
  var s = String(input == null ? "" : input).normalize("NFC");
  s = s.replace(/\r\n?/g, "\n");
  s = s.replace(new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]", "g"), "");
  s = multiline ? s.replace(/\n{4,}/g, "\n\n\n") : s.replace(/\n/g, " ");
  return s.replace(/[ \t]+$/gm, "").trim();
}

function digest_(pw, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ":" + String(pw).normalize("NFC"),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}

function makePwHash_(pw) {
  var salt = Utilities.getUuid().replace(/-/g, "");
  return "sha256$" + salt + "$" + digest_(pw, salt);
}

function checkPw_(pw, stored) {
  var parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "sha256") { return false; }
  return digest_(pw, parts[1]) === parts[2];
}

function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) { return []; }
  return sh.getRange(2, 1, last - 1, HEADER.length).getValues();
}

function isoOf_(v) {
  if (v instanceof Date) { return v.toISOString(); }
  return String(v == null ? "" : v);
}

function publicItem_(row) {
  return {
    id: String(row[COL.ID - 1]),
    name: String(row[COL.NAME - 1]),
    message: String(row[COL.MESSAGE - 1]),
    createdAt: isoOf_(row[COL.CREATED - 1])
  };
}

/* ──────────────────────────────────────────────────────── 읽기 (GET) */

function doGet(e) {
  try {
    var items = rows_(sheet_()).map(publicItem_).reverse(); // 최신순
    return json_({ items: items, total: items.length });
  } catch (err) {
    return json_({ error: "목록을 불러오지 못했습니다: " + err.message });
  }
}

/* ─────────────────────────────────────────────── 쓰기·삭제 (POST) */

function doPost(e) {
  var body;
  try {
    // text/plain 으로 오지만 내용은 JSON 문자열이다.
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (err) {
    return json_({ error: "요청 형식이 올바르지 않습니다." });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // 동시에 들어온 요청이 서로 덮어쓰지 않게
  } catch (err) {
    return json_({ error: "잠시 후 다시 시도해 주세요." });
  }

  try {
    return body.action === "delete" ? remove_(body) : create_(body);
  } catch (err) {
    return json_({ error: "처리 중 오류가 발생했습니다: " + err.message });
  } finally {
    lock.releaseLock();
  }
}

function create_(body) {
  var name = clamp_(clean_(body.name, false), MAX_NAME);
  var message = clamp_(clean_(body.message, true), MAX_MESSAGE);
  var password = String(body.password == null ? "" : body.password);

  // 이름과 비밀번호는 선택 사항이다. 청첩장 폼은 메시지만 받는다.
  // (비밀번호를 받지 않으면 하객이 자기 글을 지울 수 없고, 시트에서 행을 지우면 된다)
  if (!message) { return json_({ error: "축하 메시지를 입력해 주세요." }); }
  if (password && !/^\d{4}$/.test(password)) {
    return json_({ error: "비밀번호는 숫자 4자리로 입력해 주세요." });
  }

  var sh = sheet_();
  var all = rows_(sh);

  // 전송 버튼 중복 클릭 방지 — 1분 안에 똑같은 글이 또 오면 막는다.
  // (이름을 받지 않으므로 서로 다른 하객이 같은 문구를 쓰는 것은 막지 않는다)
  var cutoff = Date.now() - 60 * 1000;
  var dup = all.some(function (r) {
    if (String(r[COL.MESSAGE - 1]) !== message) { return false; }
    if (String(r[COL.NAME - 1]) !== name) { return false; }
    var t = Date.parse(isoOf_(r[COL.CREATED - 1]));
    return isNaN(t) ? false : t >= cutoff;
  });
  if (dup) { return json_({ error: "이미 등록된 메시지입니다." }); }

  var maxId = all.reduce(function (acc, r) {
    return Math.max(acc, Number(r[COL.ID - 1]) || 0);
  }, 0);

  var item = {
    id: String(maxId + 1),
    createdAt: new Date().toISOString(),
    name: name,
    message: message
  };

  sh.appendRow([item.id, item.createdAt, item.name, item.message, password ? makePwHash_(password) : ""]);
  return json_({ item: item });
}

function remove_(body) {
  var id = String(body.id == null ? "" : body.id);
  var password = String(body.password == null ? "" : body.password);

  var sh = sheet_();
  var all = rows_(sh);
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][COL.ID - 1]) !== id) { continue; }
    var stored = String(all[i][COL.PWHASH - 1] || "");
    if (!stored) {
      return json_({ error: "이 메시지는 삭제할 수 없습니다." });
    }
    if (!checkPw_(password, stored)) {
      return json_({ error: "비밀번호가 일치하지 않습니다." });
    }
    sh.deleteRow(i + 2); // +2 = 머리글 1행 + 0-based 보정
    return json_({ ok: true });
  }
  return json_({ error: "메시지를 찾을 수 없습니다." });
}
