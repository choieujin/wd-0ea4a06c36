// 핀터레스트 감성 데코: 이름을 글자 구슬(beads)로 흩뿌려 배치
(function () {
  "use strict";

  function renderBeads(box) {
    var text = (box.getAttribute("data-text") || "").toUpperCase();
    if (!text) return;
    var anchor = box.getAttribute("data-anchor") || "left"; // 글자가 흘러내리는 방향
    var chars = text.split("");
    // 이름 앞에 "TO ." 접두 구슬을 붙여 레퍼런스 감성 재현
    var seq = ["T", "O", "·"].concat(chars);

    var frag = document.createDocumentFragment();

    seq.forEach(function (ch, i) {
      var b = document.createElement("span");
      b.className = "bead";
      if (ch === "·") b.classList.add("bead--dot");
      b.textContent = ch === "·" ? "" : ch;

      // 사진 가장자리를 따라 살짝 흔들리는 세로 컬럼으로 배치
      var step = 29;                           // 글자 간 세로 간격(px)
      var top = i * step;
      var wobble = (Math.sin(i * 0.8) * 0.5 + 0.5) * 18; // 0~18px, 가장자리 쪽으로만
      var rot = (i % 2 === 0 ? -1 : 1) * (6 + (i % 3) * 4);

      b.style.top = top + "px";
      if (anchor === "right") {
        b.style.right = wobble + "px";
      } else {
        b.style.left = wobble + "px";
      }
      b.style.transform = "rotate(" + rot + "deg)";
      b.style.transitionDelay = (i * 45) + "ms";
      frag.appendChild(b);
    });

    box.appendChild(frag);
    // 등장 애니메이션 트리거
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { box.classList.add("is-on"); });
    });
  }

  // 페이지 곳곳에 각진 분홍 하트를 다양한 형태·크기로 흩뿌리기
  function sprinkleHearts() {
    var variants = ["v1", "v2", "v3", "v4"];
    // 표지는 이미 하트가 있으니 제외, 나머지 섹션 + 푸터에 배치
    var targets = [].slice.call(document.querySelectorAll("section:not(.cover), .footer"));
    var made = [];

    targets.forEach(function (sec) {
      var n = 2 + Math.floor(Math.random() * 2); // 섹션당 2~3개
      for (var i = 0; i < n; i++) {
        var h = document.createElement("span");
        var v = variants[Math.floor(Math.random() * variants.length)];
        h.className = "deco-heart xheart xheart--" + v;
        if (Math.random() < 0.22) h.classList.add("xheart--sky");

        var size = 9 + Math.round(Math.random() * 21); // 9~30px
        h.style.width = size + "px";
        h.style.height = size + "px";
        h.style.left = (3 + Math.random() * 90).toFixed(1) + "%";

        // 텍스트를 피해 위/아래 여백 띠 안에만 배치
        var off = 6 + Math.random() * 36;
        if (Math.random() < 0.5) h.style.top = off + "px";
        else h.style.bottom = off + "px";

        h.style.transform = "rotate(" + Math.round(Math.random() * 50 - 25) + "deg)";
        h.style.setProperty("--o", (0.5 + Math.random() * 0.4).toFixed(2));

        sec.appendChild(h);
        made.push(h);
      }
    });

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        made.forEach(function (h) { h.classList.add("is-on"); });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".beads").forEach(renderBeads);
    sprinkleHearts();
  });
})();
