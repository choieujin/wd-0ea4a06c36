// 실시간 주차 현황 위젯 — parking.json 을 읽어 렌더링.
// 데이터는 GitHub Actions(scripts/fetch-parking.mjs)가 주기적으로 갱신·커밋한다.
// data-remote(raw.githubusercontent) 를 먼저 읽어, 사이트 재배포 없이 최신 데이터를 반영한다.
// (raw 실패 시 배포본 data-src 로 폴백)
(function () {
  "use strict";
  var root = document.getElementById("parkLive");
  if (!root) return;

  var SRC = root.getAttribute("data-src") || "assets/data/parking.json";
  var REMOTE = root.getAttribute("data-remote") || "";
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
    var isLink = lot.status === "link";
    var s = STATUS[lot.status] || STATUS.unknown;
    var cls = isLink ? "is-link" : s.cls;

    // 우측: 링크 카드는 라벨, 그 외는 상태 칩
    var right = isLink
      ? '<span class="park-card__go">' + (lot.linkLabel || "바로가기 →") + '</span>'
      : '<span class="park-card__chip">' + s.label + '</span>';

    // 본문: 숫자(가용/총) 또는 안내 문구
    var showNums = lot.ok && lot.available != null && lot.total != null && (lot.status === "ok" || lot.status === "busy" || lot.status === "full");
    var body = isLink
      ? (lot.note ? '<span class="park-card__note">' + lot.note + '</span>' : '')
      : (showNums
          ? '<span class="park-card__nums"><strong>' + lot.available + '</strong> / ' + lot.total + '면</span>' +
            (lot.note ? '<span class="park-card__note">' + lot.note + '</span>' : '')
          : '<span class="park-card__nums park-card__nums--muted">' + (lot.note || "") + '</span>');

    var inner =
      '<div class="park-card__head">' +
        '<span class="park-card__name">' + lot.name + '</span>' +
        right +
      '</div>' + body;

    // 링크가 있으면 카드 전체를 탭 가능하게
    if (lot.link) {
      return (
        '<li class="park-card ' + cls + ' is-clickable">' +
          '<a class="park-card__hit" href="' + lot.link + '" target="_blank" rel="noopener">' +
            inner +
          '</a>' +
        '</li>'
      );
    }
    return '<li class="park-card ' + cls + '">' + inner + '</li>';
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

  function fetchJson(url) {
    var u = url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    return fetch(u, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  // raw(원본) 우선 → 실패 시 배포본으로 폴백
  function load() {
    var primary = REMOTE || SRC;
    fetchJson(primary).then(render).catch(function () {
      if (primary !== SRC) fetchJson(SRC).then(render).catch(fail);
      else fail();
    });
  }

  load();
  // 화면을 켜둔 하객을 위해 1분마다 자동 갱신
  setInterval(load, 60000);
})();
