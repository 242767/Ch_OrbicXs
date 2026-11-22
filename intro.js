// Kirish va xabar ekranlari uchun umumiy ramka: logotip va uning atrofida aylanuvchi orbitalar.
import { h, svg } from "../dom.js";

// Logotip — halqa va uning yonidagi sayyora. Shu g'oya davom ettirilgan: logotip markazida bir necha halqa,
// ularda sekin aylanuvchi nuqtalar (har bir nuqta — platformadagi bitta odam).
function orbitsArt() {
  const rings = [74, 132, 214, 326, 480];
  const dot = (cls, r, deg, size) => {
    const a = (deg * Math.PI) / 180;
    return svg("circle", { class: "o-dot o-dot--" + cls, cx: (600 + r * Math.cos(a)).toFixed(1), cy: (600 + r * Math.sin(a)).toFixed(1), r: size });
  };
  return h(
    "div",
    { class: "orbits", "aria-hidden": "true" },
    svg(
      "svg",
      { viewBox: "0 0 1200 1200", focusable: "false" },
      ...rings.map((r) => svg("circle", { class: "o-ring", cx: 600, cy: 600, r })),
      svg("g", { class: "o-spin" }, dot("gold", 132, -35, 6), dot("dim", 132, 150, 3)),
      svg("g", { class: "o-spin o-spin--b" }, dot("dawn", 214, 20, 5), dot("violet", 214, 200, 4)),
      svg("g", { class: "o-spin o-spin--c" }, dot("violet", 326, 70, 5), dot("gold", 326, 250, 3), dot("dim", 480, 130, 4)),
    ),
  );
}

export function introFrame(children, { plain = false } = {}) {
  return h(
    "main",
    { class: "intro" + (plain ? " intro--plain" : ""), id: "main", tabindex: "-1" },
    h("div", { class: "intro__col" }, h("div", { class: "intro__logo" }, orbitsArt(), h("img", { src: "icon-192.png", alt: "", width: 84, height: 84 })), children),
  );
}
