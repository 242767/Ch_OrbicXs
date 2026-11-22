// Messenjer: matn va vaqt yordamchilari (sof funksiyalar). Serverdan kelgan matn faqat matn tuguni sifatida qo'yiladi.
import { h, fmtDate } from "../dom.js";

const p2 = (n) => String(n).padStart(2, "0");
const toDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};
const keyOf = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

export function timeHM(iso) {
  const d = toDate(iso);
  return d ? p2(d.getHours()) + ":" + p2(d.getMinutes()) : "";
}
/** Kun belgisi (bir kundagi xabarlarni guruhlash uchun); noto'g'ri sana uchun 0. */
export function dayKey(iso) {
  const d = toDate(iso);
  return d ? keyOf(d) : 0;
}
function relDay(iso) {
  const k = dayKey(iso);
  if (!k) return "";
  const t = new Date();
  if (k === keyOf(t)) return "today";
  t.setDate(t.getDate() - 1);
  return k === keyOf(t) ? "yesterday" : "";
}
/** Xabarlar orasidagi kun ajratgichi: Bugun / Kecha / 19 noy. */
export function dayLabel(iso) {
  const r = relDay(iso);
  if (r === "today") return "Bugun";
  if (r === "yesterday") return "Kecha";
  return dayKey(iso) ? fmtDate(iso, { time: false }) : "";
}
/** Suhbatlar ro'yxatidagi vaqt: bugun — soat, kecha — «Kecha», boshqa — sana. */
export function listTime(iso) {
  const r = relDay(iso);
  if (r === "today") return timeHM(iso);
  if (r === "yesterday") return "Kecha";
  return dayKey(iso) ? fmtDate(iso, { time: false }) : "";
}

export const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Havolalar: faqat http/https, yangi oynada, aloqa ma'lumotisiz (noopener, noreferrer)
// ---------------------------------------------------------------------------
const URL_RE = /https?:\/\/[^\s<>"'`]+/gi;

/** Havola oxiridagi tinish belgilari (nuqta, vergul, juftsiz «)» va h.k.) havolaga kirmaydi. */
export function trimUrl(u) {
  let url = u;
  for (;;) {
    const c = url[url.length - 1];
    if (c && ".,;:!?]}»”’".includes(c)) url = url.slice(0, -1);
    else if (c === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) url = url.slice(0, -1);
    else return url;
  }
}

export function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    let href = "";
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
    } catch {
      href = "";
    }
    if (!href) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h("a", { class: "msg__link", href, target: "_blank", rel: "noopener noreferrer" }, url));
    last = m.index + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// ---------------------------------------------------------------------------
// Qisqa ko'rinish: ro'yxatdagi oxirgi xabar va javob iqtiboslari
// ---------------------------------------------------------------------------
const SYS_SHORT = { created: "Guruh yaratildi", renamed: "Guruh nomi o'zgardi", added: "Yangi a'zo qo'shildi", removed: "A'zo guruhdan chiqarildi", left: "A'zo guruhdan chiqdi" };

export function snippetOf(m) {
  if (!m) return "";
  if (m.deleted) return "Xabar o'chirilgan";
  if (m.kind === "system") return SYS_SHORT[m.meta && m.meta.event] || "Guruh yangilandi";
  if (m.kind === "image") return m.body ? "Rasm: " + oneLine(m.body) : "Rasm";
  if (m.kind === "file") return "Fayl: " + String((m.meta && m.meta.name) || "fayl");
  return oneLine(m.body);
}

/** Javob iqtibosidagi qisqa matn. */
export function quoteText(r) {
  if (!r) return "";
  if (r.deleted) return "Xabar o'chirilgan";
  if (r.kind === "image") return r.snippet ? "Rasm: " + oneLine(r.snippet) : "Rasm";
  if (r.kind === "file") return "Fayl: " + (r.name || "fayl");
  return oneLine(r.snippet);
}

/** Guruhdagi tizim xabari matni. who — kim qilgan (ism), self — shu odam o'zimizmi, names — nishon odamlar nomlari. */
export function systemText(meta, who, self, names) {
  const v = self ? "dingiz" : "di";
  const title = meta && typeof meta.title === "string" ? meta.title : "";
  switch (meta && meta.event) {
    case "created":
      return who + " guruhni yarat" + v + (title ? ": «" + title + "»" : "");
    case "renamed":
      return who + " guruh nomini o'zgartir" + v + (title ? ": «" + title + "»" : "");
    case "added":
      return who + " a'zo qo'sh" + v + (names.length ? ": " + names.join(", ") : "");
    case "removed":
      return who + " a'zoni chiqar" + v + (names.length ? ": " + names.join(", ") : "");
    case "left":
      return who + " guruhdan chiq" + (self ? "dingiz" : "di");
    default:
      return "Guruh yangilandi";
  }
}
