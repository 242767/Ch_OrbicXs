// DOM yordamchilari. Bu saytda innerHTML ISHLATILMAYDI: serverdan kelgan har qanday matn
// (ism, tavsif, jurnal) faqat matn tuguni sifatida qo'yiladi, shuning uchun u kod bo'lib ishlay olmaydi.

const SVG_NS = "http://www.w3.org/2000/svg";

// Atribut emas, xossa sifatida qo'yiladigan nomlar
const PROPS = new Set(["value", "checked", "selected", "disabled", "hidden", "readOnly", "required", "open", "indeterminate"]);

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "dataset") for (const d of Object.keys(v)) el.dataset[d] = v[d];
      else if (k === "style") Object.assign(el.style, v); // CSSOM orqali: CSP ning style-src qoidasiga zid emas
      else if (k.length > 2 && k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "for") el.htmlFor = v;
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  add(el, kids);
  return el;
}

export function add(parent, kids) {
  for (const k of kids) {
    if (k === undefined || k === null || k === false || k === true) continue;
    if (Array.isArray(k)) add(parent, k);
    else if (k instanceof Node) parent.append(k);
    else parent.append(document.createTextNode(String(k)));
  }
  return parent;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

// ---------------------------------------------------------------------------
// Ikonkalar (oddiy chiziqli; har biri createElementNS bilan quriladi)
// ["c", cx, cy, r] — doira, ["r", x, y, w, h, rx] — to'rtburchak, qolgani — path
// ---------------------------------------------------------------------------
const ICONS = {
  users: ["M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2", ["c", 10, 7, 4], "M21 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", ["c", 12, 7, 4]],
  log: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8", "M10 9H8"],
  search: [["c", 11, 11, 8], "M21 21l-4.35-4.35"],
  plus: ["M12 5v14", "M5 12h14"],
  edit: ["M12 20h9", "M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z"],
  ban: [["c", 12, 12, 10], "M4.93 4.93l14.14 14.14"],
  unlock: ["M22 11.08V12a10 10 0 1 1-5.93-9.14", "M22 4L12 14.01l-3-3"],
  key: [["c", 7.5, 15.5, 5.5], "M21 2l-9.6 9.6", "M15.5 7.5l3 3L22 7l-3-3"],
  trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M10 11v6", "M14 11v6"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", ["c", 12, 12, 3]],
  eyeoff: ["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94", "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19", "M14.12 14.12a3 3 0 1 1-4.24-4.24", "M1 1l22 22"],
  copy: [["r", 9, 9, 13, 13, 2], "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
  check: ["M20 6L9 17l-5-5"],
  x: ["M18 6L6 18", "M6 6l12 12"],
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "M16 17l5-5-5-5", "M21 12H9"],
  alert: ["M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z", "M12 9v4", "M12 17h.01"],
  info: [["c", 12, 12, 10], "M12 16v-4", "M12 8h.01"],
  up: ["M6 15l6-6 6 6"],
  shield: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  phone: [["r", 5, 2, 14, 20, 2], "M12 18h.01"],
  monitor: [["r", 2, 3, 20, 14, 2], "M8 21h8", "M12 17v4"],
  refresh: ["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10", "M1 14l4.64 4.36A9 9 0 0 0 20.49 15"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  clip: ["M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"],
  file: ["M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M13 2v7h7"],
  back: ["M15 18l-6-6 6-6"],
  more: [["c", 12, 12, 1], ["c", 19, 12, 1], ["c", 5, 12, 1]],
  reply: ["M9 14L4 9l5-5", "M20 20v-7a4 4 0 0 0-4-4H4"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  image: [["r", 3, 3, 18, 18, 2], ["c", 8.5, 8.5, 1.5], "M21 15l-5-5L5 21"],
  down: ["M12 5v14", "M19 12l-7 7-7-7"],
  userplus: ["M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", ["c", 8.5, 7, 4], "M20 8v6", "M23 11h-6"],
  clock: [["c", 12, 12, 10], "M12 6v6l4 2"],
};

export function icon(name, cls = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", ("ico " + cls).trim());
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const part of ICONS[name] || []) {
    let node;
    if (typeof part === "string") {
      node = document.createElementNS(SVG_NS, "path");
      node.setAttribute("d", part);
    } else if (part[0] === "c") {
      node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", part[1]);
      node.setAttribute("cy", part[2]);
      node.setAttribute("r", part[3]);
    } else {
      node = document.createElementNS(SVG_NS, "rect");
      node.setAttribute("x", part[1]);
      node.setAttribute("y", part[2]);
      node.setAttribute("width", part[3]);
      node.setAttribute("height", part[4]);
      node.setAttribute("rx", part[5]);
    }
    svg.append(node);
  }
  return svg;
}

// SVG elementi yaratish (kirish oynasidagi orbitalar uchun)
export function svg(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k of Object.keys(attrs || {})) el.setAttribute(k, String(attrs[k]));
  for (const c of kids) if (c) el.append(c);
  return el;
}

// ---------------------------------------------------------------------------
// Matn va sana
// ---------------------------------------------------------------------------
const MONTHS = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];
const p2 = (n) => String(n).padStart(2, "0");

export function fmtDate(iso, { time = true } = {}) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "—";
  let s = d.getDate() + " " + MONTHS[d.getMonth()];
  if (d.getFullYear() !== new Date().getFullYear()) s += " " + d.getFullYear();
  if (time) s += ", " + p2(d.getHours()) + ":" + p2(d.getMinutes());
  return s;
}

export function relTime(iso) {
  const t = new Date(iso).getTime();
  if (!iso || Number.isNaN(t)) return "";
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return "hozirgina";
  if (s < 3600) return Math.floor(s / 60) + " daqiqa oldin";
  if (s < 86400) return Math.floor(s / 3600) + " soat oldin";
  if (s < 7 * 86400) return Math.floor(s / 86400) + " kun oldin";
  return fmtDate(iso, { time: false });
}

export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = [...parts[0]][0];
  const last = parts.length > 1 ? [...parts[parts.length - 1]][0] : "";
  return (first + last).toLocaleUpperCase();
}

export const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

let seq = 0;
export const nextId = (prefix = "f") => prefix + ++seq;

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* zaxira usulga o'tamiz */
  }
  const ta = h("textarea", { class: "sr", readOnly: true, tabindex: "-1", "aria-hidden": "true" });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}
