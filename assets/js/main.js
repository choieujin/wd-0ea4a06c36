(function () {
  "use strict";

  var WEDDING = new Date(2026, 9, 25, 15, 0, 0); // 2026-10-25 15:00
  var MEET_DATE = new Date(2022, 3, 23); // 처음 만난 날 2022-04-23 (만난 날을 1일째로 카운트)
  var PLACE_QUERY = "용산가족공원";

  /* ---------- 함께한 날수 ---------- */
  function initTogether() {
    var el = document.getElementById("togetherDays");
    if (!el) return;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(MEET_DATE.getFullYear(), MEET_DATE.getMonth(), MEET_DATE.getDate());
    var days = Math.floor((today - start) / 86400000) + 1; // 만난 날 포함
    if (days > 0) el.textContent = String(days);
  }

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-visible");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Calendar ---------- */
  function initCalendar() {
    var grid = document.getElementById("calendar");
    if (!grid) return;
    var y = WEDDING.getFullYear(), m = WEDDING.getMonth(), day = WEDDING.getDate();
    var heads = ["일", "월", "화", "수", "목", "금", "토"];
    var html = "";
    heads.forEach(function (h, i) {
      html += '<div class="cal-head' + (i === 0 ? " sun" : "") + '">' + h + "</div>";
    });
    var first = new Date(y, m, 1).getDay();
    var last = new Date(y, m + 1, 0).getDate();
    for (var i = 0; i < first; i++) html += '<div class="cal-cell empty">·</div>';
    for (var d = 1; d <= last; d++) {
      var dow = new Date(y, m, d).getDay();
      var cls = "cal-cell" + (dow === 0 ? " sun" : "") + (d === day ? " is-wedding" : "");
      html += '<div class="' + cls + '">' + d + "</div>";
    }
    grid.innerHTML = html;

    var dd = document.getElementById("dday");
    if (dd) {
      var today = new Date(); today.setHours(0, 0, 0, 0);
      var target = new Date(y, m, day); target.setHours(0, 0, 0, 0);
      var diff = Math.round((target - today) / 86400000);
      if (diff > 0) dd.textContent = "박종현 · 최유진의 결혼식이 " + diff + "일 남았습니다.";
      else if (diff === 0) dd.textContent = "오늘은 박종현 · 최유진의 결혼식입니다.";
      else dd.textContent = "함께해 주셔서 감사합니다.";
    }
  }

  /* ---------- Gallery + Lightbox ---------- */
  function initGallery() {
    var grid = document.getElementById("galleryGrid");
    var empty = document.getElementById("galleryEmpty");
    var list = (window.GALLERY || []);
    if (!grid) return;
    if (!list.length) { return; }
    if (empty) empty.classList.add("is-hidden");

    function srcOf(name) { return "assets/gallery/" + encodeURIComponent(name); }

    list.forEach(function (name, idx) {
      var img = document.createElement("img");
      img.src = srcOf(name);
      img.alt = "웨딩 사진 " + (idx + 1);
      img.loading = "lazy";
      img.addEventListener("click", function () { openLightbox(idx); });
      grid.appendChild(img);
    });

    var lb = document.getElementById("lightbox");
    var lbImg = document.getElementById("lbImg");
    var cur = 0;

    function show(i) {
      cur = (i + list.length) % list.length;
      lbImg.src = srcOf(list[cur]);
    }
    function openLightbox(i) { show(i); lb.hidden = false; document.body.style.overflow = "hidden"; }
    function close() { lb.hidden = true; document.body.style.overflow = ""; }

    document.getElementById("lbClose").addEventListener("click", close);
    document.getElementById("lbPrev").addEventListener("click", function () { show(cur - 1); });
    document.getElementById("lbNext").addEventListener("click", function () { show(cur + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) close(); });
    document.addEventListener("keydown", function (e) {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") show(cur - 1);
      if (e.key === "ArrowRight") show(cur + 1);
    });
  }

  /* ---------- Maps ---------- */
  function initMaps() {
    var q = encodeURIComponent(PLACE_QUERY);
    var set = function (id, url) { var el = document.getElementById(id); if (el) el.href = url; };
    set("mapNaver", "https://map.naver.com/p/search/" + q);
    set("mapKakao", "https://map.kakao.com/?q=" + q);
    set("mapGoogle", "https://www.google.com/maps/search/?api=1&query=" + q);
  }

  /* ---------- Copy (accounts + share) ---------- */
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error("execCommand copy failed"));
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // 클립보드 API 시도 → 실패(권한/iframe 등) 시 구형 방식으로 폴백
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-show"); }, 1800);
  }

  function initCopy() {
    document.querySelectorAll(".acc-copy").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var li = btn.closest(".acc-item");
        var acc = li.getAttribute("data-account");
        var bank = li.getAttribute("data-bank");
        if (!acc) return;
        copyText(acc).then(function () {
          toast(bank + " 계좌번호가 복사되었습니다.");
        }).catch(function () {
          toast("복사에 실패했습니다.");
        });
      });
    });

    var share = document.getElementById("shareLink");
    if (share) {
      share.addEventListener("click", function () {
        var url = window.location.href;
        if (navigator.share) {
          navigator.share({ title: "박종현 ♥ 최유진 결혼합니다", url: url }).catch(function () {});
          return;
        }
        copyText(url).then(function () { toast("청첩장 링크가 복사되었습니다."); })
          .catch(function () { toast("복사에 실패했습니다."); });
      });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initReveal();
    initTogether();
    initCalendar();
    initGallery();
    initMaps();
    initCopy();
  });
})();
