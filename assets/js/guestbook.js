/**
 * 축하 메시지(방명록)
 *
 * 저장소는 DB가 아니다. 설정(guestbook-config.js)을 보고 아래 넷 중 하나를 고른다.
 *
 *  1) script — 구글 시트에 붙인 Apps Script 웹 앱. 읽기·쓰기·삭제를 한 주소에서 처리.
 *              webAppUrl 이 채워져 있으면 이 방식. (권장)
 *  2) form   — 구글 폼으로 쓰고, 연결된 구글 시트에서 읽는다.
 *  3) server — server.mjs 의 /api/guestbook. 로컬에서 돌릴 때 쓴다.
 *  4) file   — 아무 설정도 없으면 assets/data/guestbook.json 을 읽어 "읽기 전용".
 *
 * 구글 폼(2번) 방식의 한계:
 *  - 전송 결과를 읽을 수 없다(브라우저가 응답을 막는다). 그래서 보낸 글은 내 화면에
 *    먼저 붙여두고(localStorage), 시트에서 같은 글이 올라오면 그걸로 교체한다.
 *  - 하객이 자기 글을 지울 수 없다. 삭제는 신랑신부가 시트에서 행을 지우면 된다.
 *
 * 한글·이모지 관련 주의사항:
 *  - 글자 수는 String.length가 아니라 코드포인트(Array.from) 기준으로 센다.
 *    이모지는 서로게이트 쌍(길이 2)이라 length로 자르면 문자가 깨진다.
 *  - 폼 전송은 URLSearchParams(=UTF-8 폼 인코딩)로 보낸다.
 *  - 출력은 항상 textContent — innerHTML을 쓰지 않으므로 XSS도 함께 막힌다.
 */
(function () {
  "use strict";

  var CFG = window.GUESTBOOK || {};

  var MAX_NAME = 20;
  var MAX_MESSAGE = 300;
  var PAGE_SIZE = 5;

  /**
   * 이름·비밀번호 칸이 없을 때 서버로 대신 보낼 값.
   *
   * 시트에 붙여둔 스크립트가 예전 버전이면 이름·비밀번호를 "필수"로 검사한다.
   * 빈 값을 보내면 "이름을 입력해 주세요" 로 거부되므로, 통과할 수 있는 값을 채워 보낸다.
   * 이 이름은 화면에 표시하지 않는다(익명 취급). 비밀번호는 아무도 모르는 난수라
   * 사실상 본인 삭제가 불가한 것과 같다 — 삭제는 시트에서 행을 지우면 된다.
   */
  var ANON_NAME = "하객";
  function randomPin() { return String(Math.floor(1000 + Math.random() * 9000)); }

  /* 보낸 글을 내 화면에 붙여두는 시간 — 시트에 반영되기까지의 지연을 가린다 */
  var PENDING_KEY = "guestbook:pending";
  var PENDING_TTL_MS = 6 * 60 * 60 * 1000;

  /* 자주 쓰는 축하 이모지 (커서 위치에 삽입) */
  var EMOJIS = [
    "🎉", "🎊", "💐", "💍", "👰", "🤵", "💒", "🥂",
    "❤️", "💕", "💖", "💝", "🌸", "🌷", "🌹", "✨",
    "🥰", "😊", "😍", "🤗", "👏", "🙌", "🎁", "🕊️"
  ];

  /* ---------- 유틸 ---------- */

  /** 코드포인트 배열 (이모지 1글자 = 1개) */
  function chars(s) { return Array.from(String(s == null ? "" : s)); }
  function cpLength(s) { return chars(s).length; }
  function cpSlice(s, n) { return chars(s).slice(0, n).join(""); }

  function $(id) { return document.getElementById(id); }

  function toast(msg) {
    var t = $("toast");
    if (!t) { return; }
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { t.classList.remove("is-show"); }, 2200);
  }

  /**
   * 날짜 표시. 시트에서 오는 값이 제각각이라 넉넉하게 받아준다.
   *  - ISO 문자열            2026-10-25T06:00:00.000Z
   *  - gviz 날짜             Date(2026,9,25,15,0,0)   ← 월이 0부터
   *  - 구글 폼 타임스탬프    2026. 10. 25 오후 3:00:00
   */
  function formatDate(value) {
    var s = String(value == null ? "" : value).trim();
    if (!s) { return ""; }

    var gviz = s.match(/^Date\((\d+),(\d+),(\d+)/);
    if (gviz) {
      return pad(gviz[1], 4) + ". " + pad(Number(gviz[2]) + 1, 2) + ". " + pad(gviz[3], 2) + ".";
    }

    var d = new Date(s);
    if (!isNaN(d.getTime())) {
      return d.getFullYear() + ". " + pad(d.getMonth() + 1, 2) + ". " + pad(d.getDate(), 2) + ".";
    }

    // "2026. 10. 25 오후 3:00:00" 처럼 Date가 못 읽는 형식 — 숫자만 뽑는다
    var m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? m[1] + ". " + pad(m[2], 2) + ". " + pad(m[3], 2) + "." : "";
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) { s = "0" + s; }
    return s;
  }

  function fetchText(url) {
    return fetch(url, { credentials: "omit" }).then(function (res) {
      if (!res.ok) {
        var err = new Error("불러오지 못했습니다.");
        err.status = res.status;
        throw err;
      }
      return res.text();
    });
  }

  function fetchJson(url, options) {
    return fetch(url, options || {}).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && data.error) || "요청에 실패했습니다.");
          err.status = res.status;
          throw err;
        }
        if (!data) { throw new Error("응답을 읽지 못했습니다."); }
        if (data.error) {
          // 서버가 이유를 알려준 거절 — 그대로 사용자에게 보여준다
          throw Object.assign(new Error(data.error), { fromServer: true });
        }
        return data;
      });
    });
  }

  /* ---------- CSV 파서 (따옴표 안의 쉼표·줄바꿈까지 처리) ---------- */

  function parseCsv(text) {
    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;

    for (var i = 0; i < text.length; i++) {
      var c = text[i];

      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } // "" → 따옴표 한 개
          else { quoted = false; }
        } else {
          field += c;
        }
        continue;
      }

      if (c === '"') { quoted = true; }
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") { i++; }
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ""; }); });
  }

  /**
   * 머리글에서 이름·메시지 열이 몇 번째인지 찾는다.
   * 폼 질문 문구를 바꿔도 웬만하면 따라간다. 못 찾으면 순서(0=시각,1=이름,2=메시지)로.
   */
  function mapColumns(header) {
    var idx = { createdAt: -1, name: -1, message: -1 };
    header.forEach(function (raw, i) {
      var h = String(raw).replace(/\s/g, "");
      if (idx.createdAt < 0 && /타임스탬프|timestamp|시각|날짜/i.test(h)) { idx.createdAt = i; }
      else if (idx.name < 0 && /이름|성함|name|보내는/i.test(h)) { idx.name = i; }
      else if (idx.message < 0 && /메시지|메세지|축하|내용|message/i.test(h)) { idx.message = i; }
    });
    if (idx.createdAt < 0) { idx.createdAt = 0; }
    if (idx.name < 0) { idx.name = 1; }
    if (idx.message < 0) { idx.message = 2; }
    return idx;
  }

  function rowsToItems(rows) {
    if (!rows.length) { return []; }
    var idx = mapColumns(rows[0]);
    var items = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i];
      var name = String(r[idx.name] == null ? "" : r[idx.name]).trim();
      var message = String(r[idx.message] == null ? "" : r[idx.message]).trim();
      if (!name && !message) { continue; }
      items.push({
        id: "r" + i,
        name: name,   // 비어 있으면 카드에 이름 줄을 그리지 않는다
        message: message,
        createdAt: r[idx.createdAt]
      });
    }
    return items.reverse(); // 최신순
  }

  /* ---------- 내가 방금 보낸 글 (시트 반영 지연 가리기) ---------- */

  function loadPending() {
    var raw;
    try { raw = localStorage.getItem(PENDING_KEY); } catch (e) { return []; }
    var list;
    try { list = JSON.parse(raw || "[]"); } catch (e) { return []; }
    if (!Array.isArray(list)) { return []; }
    var now = Date.now();
    return list.filter(function (p) { return p && now - (p.savedAt || 0) < PENDING_TTL_MS; });
  }

  function savePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) { /* 사파리 시크릿 모드 등 */ }
  }

  function addPending(item) {
    var list = loadPending();
    list.push({ name: item.name, message: item.message, createdAt: item.createdAt, savedAt: Date.now() });
    savePending(list);
  }

  var keyOf = function (m) { return String(m.name).trim() + "\n" + String(m.message).trim(); };

  /** 시트에서 온 목록 + 아직 안 올라온 내 글 */
  function mergePending(items) {
    var seen = {};
    items.forEach(function (m) { seen[keyOf(m)] = true; });

    var pending = loadPending();
    var left = pending.filter(function (p) { return !seen[keyOf(p)]; });
    if (left.length !== pending.length) { savePending(left); } // 올라온 건 정리

    var mine = left.map(function (p, i) {
      return { id: "p" + i, name: p.name, message: p.message, createdAt: p.createdAt, pending: true };
    }).reverse();

    return mine.concat(items);
  }

  /* ---------- 백엔드 ---------- */

  /**
   * 0) 구글 시트에 붙인 Apps Script 웹 앱 (권장)
   *    읽기·쓰기·삭제를 한 주소에서 다 처리한다.
   */
  var WebApp = {
    name: "script",
    canWrite: true,
    canDelete: true,

    list: function () {
      return fetchJson(CFG.webAppUrl, { credentials: "omit" })
        .then(function (data) { return mergePending(data.items || []); })
        .catch(function (err) {
          var mine = mergePending([]);
          if (mine.length) { return mine; } // 못 읽어도 내가 쓴 글은 보여준다
          throw err;
        });
    },

    /** preflight 를 피하려고 text/plain 으로 보낸다. 내용은 JSON 문자열. */
    post: function (payload) {
      return fetchJson(CFG.webAppUrl, {
        method: "POST",
        credentials: "omit",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
    },

    create: function (payload) {
      var optimistic = {
        id: "p" + Date.now(),
        name: payload.name,
        message: payload.message,
        createdAt: new Date().toISOString(),
        pending: true
      };
      return this.post({
        action: "create",
        name: payload.name,
        message: payload.message,
        password: payload.password
      }).then(function (data) {
        return data.item || optimistic;
      }).catch(function (err) {
        // 스크립트가 돌려준 거절 사유는 그대로 알린다
        if (err.fromServer) { throw err; }
        // 응답을 못 읽은 경우(네트워크·CORS) — 글은 들어갔을 가능성이 높다.
        // 화면에 먼저 띄워두고 다음 조회 때 시트 글로 교체한다.
        addPending(optimistic);
        return optimistic;
      });
    },

    remove: function (id, password) {
      return this.post({ action: "delete", id: id, password: password });
    }
  };

  /** 1) 구글 폼(쓰기) + 구글 시트(읽기) */
  var FormSheet = {
    name: "form",
    canWrite: true,
    canDelete: false,

    list: function () {
      return this.readSheet()
        .then(rowsToItems)
        .then(mergePending)
        .catch(function (err) {
          // 시트를 못 읽어도 내가 쓴 글은 보여준다
          var mine = mergePending([]);
          if (mine.length) { return mine; }
          throw err;
        });
    },

    readSheet: function () {
      // 웹에 게시한 CSV 주소가 있으면 그쪽을 우선 (가장 확실하게 열린다)
      if (CFG.csvUrl) {
        return fetchText(CFG.csvUrl).then(parseCsv);
      }
      if (!CFG.sheetId) { return Promise.reject(new Error("시트가 설정되지 않았습니다.")); }

      var url = "https://docs.google.com/spreadsheets/d/" + encodeURIComponent(CFG.sheetId) +
                "/gviz/tq?tqx=out:json&headers=1";
      if (CFG.sheetName) { url += "&sheet=" + encodeURIComponent(CFG.sheetName); }

      return fetchText(url).then(function (text) {
        // 응답이 google.visualization.Query.setResponse({...}); 로 감싸져 온다
        var start = text.indexOf("{");
        var end = text.lastIndexOf("}");
        if (start < 0 || end < 0) { throw new Error("시트 응답을 읽지 못했습니다."); }
        var data = JSON.parse(text.slice(start, end + 1));
        var table = data.table || {};
        var header = (table.cols || []).map(function (c) { return (c && (c.label || c.id)) || ""; });
        var rows = (table.rows || []).map(function (r) {
          return (r.c || []).map(function (cell) {
            if (!cell) { return ""; }
            // 날짜 칸은 표시용 문자열(f)이 더 읽기 좋다
            return cell.f != null ? cell.f : (cell.v == null ? "" : cell.v);
          });
        });
        return [header].concat(rows);
      });
    },

    create: function (payload) {
      var body = new URLSearchParams();
      body.append(CFG.fields.name, payload.name);
      body.append(CFG.fields.message, payload.message);

      var item = {
        id: "p" + Date.now(),
        name: payload.name,
        message: payload.message,
        createdAt: new Date().toISOString(),
        pending: true
      };

      // no-cors: 전송은 되지만 응답은 못 읽는다. 구글 폼이 CORS를 열어주지 않기 때문.
      return fetch(CFG.formAction, { method: "POST", mode: "no-cors", body: body })
        .then(function () {
          addPending(item);
          return item;
        });
    },

    remove: function () {
      return Promise.reject(new Error("이 방식에서는 삭제할 수 없습니다."));
    }
  };

  /** 2) server.mjs 의 파일 기반 API */
  var ServerApi = {
    name: "server",
    canWrite: true,
    canDelete: true,
    base: "api/guestbook",

    list: function () {
      return fetchJson(this.base + "?limit=100").then(function (data) { return data.items || []; });
    },
    create: function (payload) {
      return fetchJson(this.base, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload)
      }).then(function (data) { return data.item; });
    },
    remove: function (id, password) {
      return fetchJson(this.base + "/" + encodeURIComponent(id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ password: password })
      });
    }
  };

  /** 3) 아무 설정도 없을 때 — 저장된 파일을 읽기만 */
  var StaticFile = {
    name: "file",
    canWrite: false,
    canDelete: false,
    list: function () {
      return fetchJson("assets/data/guestbook.json").then(function (data) {
        return ((data && data.messages) || []).slice().reverse();
      });
    },
    create: function () { return Promise.reject(new Error("메시지를 남길 수 없습니다.")); },
    remove: function () { return Promise.reject(new Error("삭제할 수 없습니다.")); }
  };

  function hasFormConfig() {
    return Boolean(CFG.formAction && CFG.fields && CFG.fields.name && CFG.fields.message);
  }

  /* ---------- 상태 ---------- */

  var state = { backend: StaticFile, canDelete: false, items: [], shown: 0, sending: false };
  var el = {};

  /* ---------- 렌더 ---------- */

  function renderList(reset) {
    if (reset) { state.shown = 0; }
    if (state.shown === 0) { el.list.textContent = ""; }

    var next = state.items.slice(state.shown, state.shown + PAGE_SIZE);
    next.forEach(function (item) { el.list.appendChild(card(item)); });
    state.shown += next.length;

    el.empty.hidden = state.items.length > 0;
    el.more.hidden = state.shown >= state.items.length;
    if (!el.more.hidden) {
      el.more.textContent = "더보기 (" + (state.items.length - state.shown) + ")";
    }
    el.count.textContent = state.items.length ? state.items.length + "개의 축하 메시지" : "";
  }

  function card(item) {
    var li = document.createElement("li");
    li.className = "gb-item" + (item.pending ? " is-pending" : "");

    var head = document.createElement("div");
    head.className = "gb-item__head";

    // 이름은 받지 않지만, 예전에 이름과 함께 올라온 글은 그대로 보여준다
    if (item.name && item.name !== ANON_NAME) {
      var name = document.createElement("span");
      name.className = "gb-item__name";
      name.textContent = item.name; // textContent — 태그가 그대로 글자로 보인다(XSS 방지)
      head.appendChild(name);
    }

    var date = document.createElement("span");
    date.className = "gb-item__date";
    date.textContent = item.pending ? "방금 전 · 곧 반영됩니다" : formatDate(item.createdAt);
    head.appendChild(date);

    var body = document.createElement("p");
    body.className = "gb-item__body";
    body.textContent = item.message; // 줄바꿈은 CSS white-space: pre-wrap 로 살린다

    li.appendChild(head);
    li.appendChild(body);

    if (state.canDelete && !item.pending) {
      var del = document.createElement("button");
      del.type = "button";
      del.className = "gb-item__del";
      del.textContent = "삭제";
      del.setAttribute("aria-label", item.name + "님의 메시지 삭제");
      del.addEventListener("click", function () { openDelete(li, item); });
      li.appendChild(del);
    }
    return li;
  }

  /* ---------- 삭제 (server 모드에서만) ---------- */

  function openDelete(li, item) {
    if (li.querySelector(".gb-confirm")) { return; }

    var box = document.createElement("div");
    box.className = "gb-confirm";

    var input = document.createElement("input");
    input.type = "password";
    input.className = "gb-input gb-input--pw";
    input.inputMode = "numeric";
    input.maxLength = 4;
    input.placeholder = "비밀번호 4자리";
    input.setAttribute("aria-label", "삭제 비밀번호");

    var ok = document.createElement("button");
    ok.type = "button";
    ok.className = "gb-confirm__ok";
    ok.textContent = "확인";

    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "gb-confirm__cancel";
    cancel.textContent = "취소";

    cancel.addEventListener("click", function () { box.remove(); });
    ok.addEventListener("click", function () {
      var pw = input.value.trim();
      if (!pw) { toast("비밀번호를 입력해 주세요."); input.focus(); return; }
      ok.disabled = true;
      state.backend.remove(item.id, pw).then(function () {
        state.items = state.items.filter(function (m) { return m.id !== item.id; });
        renderList(true);
        toast("메시지를 삭제했습니다.");
      }).catch(function (err) {
        ok.disabled = false;
        toast(err.message || "삭제하지 못했습니다.");
      });
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); ok.click(); }
    });

    box.appendChild(input);
    box.appendChild(ok);
    box.appendChild(cancel);
    li.appendChild(box);
    input.focus();
  }

  /* ---------- 이모지 ---------- */

  function buildEmojiPad() {
    EMOJIS.forEach(function (emoji) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "gb-emoji__item";
      b.textContent = emoji;
      b.setAttribute("aria-label", "이모지 " + emoji + " 넣기");
      b.addEventListener("click", function () { insertAtCursor(el.message, emoji); });
      el.emojiPad.appendChild(b);
    });

    el.emojiBtn.addEventListener("click", function () {
      var open = el.emojiPad.hidden;
      el.emojiPad.hidden = !open;
      el.emojiBtn.setAttribute("aria-expanded", String(open));
      el.emojiBtn.classList.toggle("is-open", open);
    });
  }

  /** 커서 위치에 삽입 — 코드포인트 기준으로 길이를 확인한다 */
  function insertAtCursor(textarea, text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var value = textarea.value;
    var next = value.slice(0, start) + text + value.slice(end);

    if (cpLength(next) > MAX_MESSAGE) {
      toast("메시지는 " + MAX_MESSAGE + "자까지 쓸 수 있어요.");
      return;
    }
    textarea.value = next;
    var caret = start + text.length; // 커서 위치는 UTF-16 인덱스 기준이 맞다
    textarea.setSelectionRange(caret, caret);
    textarea.focus();
    updateCounter();
  }

  /* ---------- 폼 ---------- */

  function updateCounter() {
    var n = cpLength(el.message.value);
    el.charCount.textContent = n + " / " + MAX_MESSAGE;
    el.charCount.classList.toggle("is-full", n >= MAX_MESSAGE);
  }

  /** maxlength 는 이모지를 2글자로 세므로 직접 자른다 */
  function limitInput(input, max) {
    input.addEventListener("input", function () {
      if (cpLength(input.value) > max) {
        var caret = input.selectionStart;
        input.value = cpSlice(input.value, max);
        try { input.setSelectionRange(caret - 1, caret - 1); } catch (e) { /* noop */ }
      }
      if (input === el.message) { updateCounter(); }
    });
  }

  function submit(e) {
    e.preventDefault();
    if (state.sending) { return; }

    var name = el.name ? el.name.value.trim() : ANON_NAME;
    var message = el.message.value.trim();
    var password = el.password ? el.password.value.trim() : randomPin();

    if (el.name && !name) { toast("이름을 입력해 주세요."); el.name.focus(); return; }
    if (!message) { toast("축하 메시지를 입력해 주세요."); el.message.focus(); return; }
    if (el.password && !/^\d{4}$/.test(password)) {
      toast("비밀번호는 숫자 4자리로 입력해 주세요.");
      el.password.focus();
      return;
    }

    state.sending = true;
    el.submit.disabled = true;
    el.submit.textContent = "남기는 중…";

    state.backend.create({ name: name, message: message, password: password })
      .then(function (item) {
        state.items.unshift(item);
        renderList(true);
        el.message.value = "";
        if (el.password) { el.password.value = ""; }
        el.emojiPad.hidden = true;
        el.emojiBtn.setAttribute("aria-expanded", "false");
        el.emojiBtn.classList.remove("is-open");
        updateCounter();
        toast("축하 메시지를 남겼습니다. 감사합니다!");
      })
      .catch(function (err) {
        toast(err.message || "메시지를 남기지 못했습니다.");
      })
      .then(function () {
        state.sending = false;
        el.submit.disabled = false;
        el.submit.textContent = "축하 메시지 남기기";
      });
  }

  function applyBackendUi() {
    var b = state.backend;

    el.form.hidden = !b.canWrite;
    if (!b.canWrite) {
      el.notice.textContent = "지금은 메시지 열람만 가능합니다.";
      el.notice.hidden = false;
      el.empty.textContent = "아직 등록된 축하 메시지가 없습니다.";
      return;
    }
    el.notice.hidden = true;

    // 삭제는 비밀번호를 받을 때만 가능하다. 지금 폼은 비밀번호를 받지 않으므로
    // 하객이 직접 지울 수 없고, 신랑·신부가 시트에서 행을 지우면 된다.
    state.canDelete = b.canDelete && Boolean(el.password);
    if (el.hint) {
      el.hint.textContent = state.canDelete
        ? "비밀번호는 내가 쓴 메시지를 지울 때 사용합니다."
        : "남겨주신 메시지는 신랑·신부에게 그대로 전달됩니다.";
    }
  }

  /* ---------- 초기화 ---------- */

  /** 스크립트 주소 → 폼 설정 → 로컬 API → 읽기 전용 파일 순으로 고른다 */
  function pickBackend() {
    if (CFG.webAppUrl) { return Promise.resolve(WebApp); }
    if (hasFormConfig()) { return Promise.resolve(FormSheet); }
    return ServerApi.list()
      .then(function () { return ServerApi; })
      .catch(function () { return StaticFile; });
  }

  function init() {
    var section = $("guestbook");
    if (!section) { return; }

    el.form = $("gbForm");
    el.name = $("gbName");
    el.password = $("gbPw");
    el.message = $("gbMsg");
    el.charCount = $("gbCharCount");
    el.submit = $("gbSubmit");
    el.emojiBtn = $("gbEmojiBtn");
    el.emojiPad = $("gbEmojiPad");
    el.list = $("gbList");
    el.empty = $("gbEmpty");
    el.more = $("gbMore");
    el.count = $("gbCount");
    el.notice = $("gbNotice");
    el.hint = $("gbHint");

    buildEmojiPad();
    if (el.name) { limitInput(el.name, MAX_NAME); }
    limitInput(el.message, MAX_MESSAGE);
    updateCounter();

    el.form.addEventListener("submit", submit);
    el.more.addEventListener("click", function () { renderList(false); });

    pickBackend().then(function (backend) {
      state.backend = backend;
      applyBackendUi();
      return backend.list();
    }).then(function (items) {
      state.items = items || [];
      renderList(true);
    }).catch(function () {
      state.items = [];
      renderList(true);
      el.empty.textContent = "축하 메시지를 불러오지 못했습니다.";
      el.empty.hidden = false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
