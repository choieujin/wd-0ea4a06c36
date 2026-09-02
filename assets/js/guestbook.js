/**
 * 축하 메시지(방명록)
 *
 * 저장은 DB가 아니라 파일이다.
 *  - 쓰기: server.mjs 의 /api/guestbook  → assets/data/guestbook.json 에 기록
 *  - 읽기: API가 있으면 API, 없으면(=GitHub Pages 같은 정적 배포) JSON 파일을 직접 읽는다.
 *    API가 없는 환경에서는 자동으로 "읽기 전용" 모드로 바뀐다.
 *
 * 한글·이모지 관련 주의사항:
 *  - 글자 수는 String.length가 아니라 코드포인트(Array.from) 기준으로 센다.
 *    이모지는 서로게이트 쌍(길이 2)이라 length로 자르면 문자가 깨진다.
 *  - 요청 헤더에 charset=utf-8 을 명시한다.
 *  - 출력은 항상 textContent — innerHTML을 쓰지 않으므로 XSS도 함께 막힌다.
 */
(function () {
  "use strict";

  var MAX_NAME = 20;
  var MAX_MESSAGE = 300;
  var PAGE_SIZE = 5;

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
    toast._timer = setTimeout(function () { t.classList.remove("is-show"); }, 2000);
  }

  /** 2026. 10. 25. 형식 */
  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ""; }
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + ". " + mm + ". " + dd + ".";
  }

  /* ---------- 상태 ---------- */

  var state = {
    api: "api/guestbook", // 별도 서버에 올렸다면 섹션의 data-api 로 덮어쓴다
    readOnly: false,      // API가 없는 정적 배포에서 true
    items: [],
    total: 0,
    shown: 0,
    sending: false
  };

  var el = {};

  /* ---------- 데이터 ---------- */

  function apiUrl(path) {
    return state.api.replace(/\/+$/, "") + (path || "");
  }

  function requestJson(url, options) {
    var opts = options || {};
    return fetch(url, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error((data && data.error) || "요청에 실패했습니다.");
          err.status = res.status;
          throw err;
        }
        if (!data) { throw new Error("응답을 읽지 못했습니다."); }
        return data;
      });
    });
  }

  /** API 우선, 실패하면 정적 JSON 파일로 폴백 */
  function loadAll() {
    return requestJson(apiUrl("?limit=100"))
      .then(function (data) {
        state.readOnly = false;
        state.items = data.items || [];
        state.total = data.total || state.items.length;
      })
      .catch(function () {
        // API 없음(정적 배포) → 파일 직접 읽기 · 읽기 전용
        return requestJson("assets/data/guestbook.json").then(function (data) {
          state.readOnly = true;
          var list = (data && data.messages) || [];
          state.items = list.slice().reverse(); // 최신순
          state.total = state.items.length;
        });
      });
  }

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
    el.count.textContent = state.items.length
      ? state.items.length + "개의 축하 메시지"
      : "";
  }

  function card(item) {
    var li = document.createElement("li");
    li.className = "gb-item";
    li.dataset.id = item.id;

    var head = document.createElement("div");
    head.className = "gb-item__head";

    var name = document.createElement("span");
    name.className = "gb-item__name";
    name.textContent = item.name; // textContent — 태그가 그대로 글자로 보인다(XSS 방지)

    var date = document.createElement("span");
    date.className = "gb-item__date";
    date.textContent = formatDate(item.createdAt);

    head.appendChild(name);
    head.appendChild(date);

    var body = document.createElement("p");
    body.className = "gb-item__body";
    body.textContent = item.message; // 줄바꿈은 CSS white-space: pre-wrap 로 살린다

    li.appendChild(head);
    li.appendChild(body);

    if (!state.readOnly) {
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

  /* ---------- 삭제 ---------- */

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
      requestJson(apiUrl("/" + encodeURIComponent(item.id)), {
        method: "DELETE",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ password: pw })
      }).then(function () {
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
    var caret = start + text.length; // UTF-16 인덱스 — 커서 위치는 length 기준이 맞다
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

    var name = el.name.value.trim();
    var message = el.message.value.trim();
    var password = el.password.value.trim();

    if (!name) { toast("이름을 입력해 주세요."); el.name.focus(); return; }
    if (!message) { toast("축하 메시지를 입력해 주세요."); el.message.focus(); return; }
    if (!/^\d{4}$/.test(password)) {
      toast("비밀번호는 숫자 4자리로 입력해 주세요.");
      el.password.focus();
      return;
    }

    state.sending = true;
    el.submit.disabled = true;
    el.submit.textContent = "남기는 중…";

    requestJson(apiUrl(""), {
      method: "POST",
      // charset 명시 — 한글/이모지가 그대로 UTF-8로 전송된다
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ name: name, message: message, password: password })
    }).then(function (data) {
      state.items.unshift(data.item);
      renderList(true);
      el.message.value = "";
      el.password.value = "";
      el.emojiPad.hidden = true;
      el.emojiBtn.setAttribute("aria-expanded", "false");
      el.emojiBtn.classList.remove("is-open");
      updateCounter();
      toast("축하 메시지를 남겼습니다. 감사합니다!");
    }).catch(function (err) {
      if (err.status === 404 || err.status === 405) {
        setReadOnly("지금은 메시지 열람만 가능합니다.");
        toast("지금은 메시지를 남길 수 없습니다.");
      } else {
        toast(err.message || "메시지를 남기지 못했습니다.");
      }
    }).then(function () {
      state.sending = false;
      el.submit.disabled = false;
      el.submit.textContent = "축하 메시지 남기기";
    });
  }

  function setReadOnly(reason) {
    state.readOnly = true;
    el.form.hidden = true;
    el.notice.textContent = reason;
    el.notice.hidden = false;
  }

  /* ---------- 초기화 ---------- */

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

    var custom = section.getAttribute("data-api");
    if (custom) { state.api = custom; }

    buildEmojiPad();
    limitInput(el.name, MAX_NAME);
    limitInput(el.message, MAX_MESSAGE);
    updateCounter();

    el.form.addEventListener("submit", submit);
    el.more.addEventListener("click", function () { renderList(false); });

    loadAll().then(function () {
      if (state.readOnly) {
        setReadOnly("메시지 열람만 가능합니다. (메시지 등록 서버 미연결)");
      }
      renderList(true);
    }).catch(function () {
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
