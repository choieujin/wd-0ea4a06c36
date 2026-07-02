// 실시간 주차 현황 위젯 — assets/data/parking.json 을 읽어 렌더링.
// 데이터는 GitHub Actions(scripts/fetch-parking.mjs)가 주기적으로 갱신한다.
(function () {
  "use strict";
  var root = document.getElementById("parkLive");
  if (!root) return;

  var SRC = root.getAttribute("data-src") || "assets/data/parking.json";
  var listEl = document.getElementById("parkList");
  var updEl = document.getElementById("parkUpdated");

  var STATUS = {
    ok:      { label: "여유",     cls: "is-ok" },
    busy:    { label: "혼잡",     cls: "is-busy" },
    full:    { label: "만차",     cls: "is-full" },
    unknown: { label: "확인 불가", cls: "is-unknown" },
    pending: { label: "준비중",   cls: "is-pending" },
    error:   { label: "정보 없음", cls: "is-unknown" }
  };

  function relTime(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var min = Math.floor((Date.now() - t) / 60000);
    if (min < 1) return "방금 전";
    if (min < 60) return min + "분 전";
    var h = Math.floor(min / 60);
    if (h < 24) return h + "시간 전";
    return Math.floor(h / 24) + "일 전";
  }

  function card(lot) {
    // 링크 카드 (자동 수집 불가 → 하객이 직접 확인)
    if (lot.status === "link" && lot.link) {
      return (
        '<li class="park-card is-link">' +
          '<div class="park-card__head">' +
            '<span class="park-card__name">' + lot.name + '</span>' +
            '<a class="park-card__link" href="' + lot.link + '" target="_blank" rel="noopener">' + (lot.linkLabel || "확인 →") + '</a>' +
          '</div>' +
          (lot.note ? '<span class="park-card__note">' + lot.note + '</span>' : '') +
        '</li>'
      );
    }
    var s = STATUS[lot.status] || STATUS.unknown;
    var showNums = lot.ok && lot.available != null && lot.total != null && (lot.status === "ok" || lot.status === "busy" || lot.status === "full");
    var nums = showNums
      ? '<span class="park-card__nums"><strong>' + lot.available + '</strong> / ' + lot.total + '면</span>'
      : '<span class="park-card__nums park-card__nums--muted">' + (lot.note || "") + '</span>';
    return (
      '<li class="park-card ' + s.cls + '">' +
        '<div class="park-card__head">' +
          '<span class="park-card__name">' + lot.name + '</span>' +
          '<span class="park-card__chip">' + s.label + '</span>' +
        '</div>' +
        nums +
        (showNums && lot.note ? '<span class="park-card__note">' + lot.note + '</span>' : '') +
      '</li>'
    );
  }

  function render(data) {
    if (!data || !data.lots) { fail(); return; }
    listEl.innerHTML = data.lots.map(card).join("");
    var rt = relTime(data.updatedAt);
    var stale = /일 전|시간 전/.test(rt);
    updEl.innerHTML = (stale ? "⚠ " : "") + "업데이트: " + (rt || "-");
    updEl.classList.toggle("is-stale", stale);
  }

  function fail() {
    listEl.innerHTML = '<li class="park-card is-unknown"><div class="park-card__head"><span class="park-card__name">주차 현황을 불러오지 못했어요</span></div><span class="park-card__nums park-card__nums--muted">잠시 후 다시 시도해 주세요.</span></li>';
    updEl.textContent = "";
  }

  function load() {
    fetch(SRC + "?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(render)
      .catch(fail);
  }

  load();
  // 화면을 켜둔 하객을 위해 1분마다 자동 갱신
  setInterval(load, 60000);
})();
