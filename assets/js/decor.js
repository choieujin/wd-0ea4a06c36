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

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".beads").forEach(renderBeads);
  });
})();
