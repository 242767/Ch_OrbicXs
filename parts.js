// Bir necha ekranda ishlatiladigan matnlar va kichik qismlar: rol/holat teglari, avatar-halqa, ogohlantirish matnlari.
import { h, initials } from "./dom.js";

export const ROLE = { admin: "Administrator", user: "Foydalanuvchi" };
export const STATUS = { active: "Faol", blocked: "Bloklangan" };
export const PERM = { messenger: "Messenjer", social: "Ijtimoiy tarmoq", media: "Media" };
export const PERM_KEYS = ["messenger", "social", "media"];

// Ism va tavsifdagi ko'rinmas yoki bo'sh ko'rinadigan belgilar (NBSP, kengaytirilgan probellar, to'ldirgichlar, yo'nalish va teg belgilari).
// To'plam 1-asos.sql (ox_accounts_*_chk) va ox-api (index.ts) bilan bir xil; server va baza baribir qayta tekshiradi.
// ZWJ/ZWNJ va emoji variant belgilari (U+FE0E/F) ataylab ruxsat: ular emoji va ba'zi yozuvlarga kerak.
const BAD_NAME = /[\x01-\x1f\x7f-\xa0\xad\u{34f}\u{61c}\u{115f}-\u{1160}\u{1680}\u{17b4}-\u{17b5}\u{180b}-\u{180f}\u{2000}-\u{200b}\u{200e}-\u{200f}\u{2028}-\u{202f}\u{205f}-\u{206f}\u{2800}\u{3000}\u{3164}\u{fe00}-\u{fe0d}\u{feff}\u{ffa0}\u{fff9}-\u{fffc}\u{1d173}-\u{1d17a}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;
const BAD_BIO = /[\x01-\x09\x0b-\x1f\x7f-\xa0\xad\u{34f}\u{61c}\u{115f}-\u{1160}\u{1680}\u{17b4}-\u{17b5}\u{180b}-\u{180f}\u{2000}-\u{200b}\u{200e}-\u{200f}\u{2028}-\u{202f}\u{205f}-\u{206f}\u{2800}\u{3000}\u{3164}\u{fe00}-\u{fe0d}\u{feff}\u{ffa0}\u{fff9}-\u{fffc}\u{1d173}-\u{1d17a}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;
const NAME_VISIBLE = /[^ \u{200c}\u{200d}\u{fe0e}\u{fe0f}]/u;
const ODD_SPACES = /[\xa0\u{1680}\u{2000}-\u{200a}\u{202f}\u{205f}\u{3000}]/gu;

/** Ism: odatiy bo'lmagan probellar oddiy probelga almashadi, ketma-ket probellar bittaga qisqaradi. */
export const cleanName = (s) => String(s).normalize("NFC").replace(ODD_SPACES, " ").replace(/ {2,}/g, " ").trim();
/** Tavsif: faqat odatiy bo'lmagan probellar almashadi (qator uzilishlari saqlanadi). */
export const cleanBio = (s) => String(s).normalize("NFC").replace(ODD_SPACES, " ");

/** Ism xatosi matni yoki "" (hammasi joyida). Server va baza qoidalari bilan bir xil. */
export function nameProblem(name) {
  const n = [...name].length;
  if (n < 1 || n > 60) return "Ism 1–60 belgidan iborat bo'lsin.";
  if (BAD_NAME.test(name)) return "Ismda ko'rinmas yoki boshqaruv belgilari bo'lmasin.";
  if (!NAME_VISIBLE.test(name)) return "Ismda kamida bitta ko'rinadigan belgi bo'lsin.";
  return "";
}

/** Tavsif xatosi matni yoki "". */
export function bioProblem(text) {
  if ([...text].length > 300) return "Tavsif 300 belgidan oshmasin.";
  if (BAD_BIO.test(text)) return "Tavsifda ko'rinmas yoki boshqaruv belgilari bo'lmasin.";
  return "";
}

// Funksiya qaytaradigan warnings kodlari (amal bajarilgan, lekin qo'shimcha qadam bajarilmagan)
export const WARNINGS = {
  ban_failed: "Hisob bazada bloklandi, lekin Supabase Auth'da bloklash bajarilmadi. Qayta bloklashga urinib ko'ring.",
  sessions_not_revoked: "Ochiq seanslarni yopib bo'lmadi: ular taxminan 1 soatgacha amal qilishi mumkin.",
  audit_failed: "Amal bajarildi, lekin jurnalga yozib bo'lmadi.",
  flag_not_cleared: "Parol almashtirildi, lekin «parolni almashtirsin» belgisi olinmadi. Administratorga xabar bering.",
};
export const warningTexts = (list) => (Array.isArray(list) ? list : []).map((c) => WARNINGS[c] || "Qo'shimcha ogohlantirish: " + c);

// Jurnal hodisalari
export const EVENTS = {
  "account.create": "Hisob yaratildi",
  "account.update": "Hisob tahrirlandi",
  "account.block": "Hisob bloklandi",
  "account.unblock": "Blok olib tashlandi",
  "account.delete": "Hisob o'chirildi",
  "account.bootstrap_admin": "Birinchi administrator qo'shildi",
  "password.reset": "Parol tiklandi",
  "password.change": "Parol almashtirildi",
  "password.change_failed": "Parol almashtirilmadi (joriy parol noto'g'ri)",
  "mfa.enrolled": "2FA qurilmasi ulandi",
  "mfa.removed": "2FA qurilmasi olib tashlandi",
  "account.reset_mfa": "2FA tiklandi (administrator tomonidan)",
  "session.revoke": "Seans yopildi",
};

// Seans qatoridagi brauzer qatoridan odam o'qiydigan nom: «Chrome, Windows». Qator aniq bo'lmasa — «Noma'lum qurilma».
export function deviceLabel(ua) {
  const s = String(ua || "");
  if (!s.trim()) return "Noma'lum qurilma";
  let browser = "Brauzer";
  if (/Edg(?:e|A|iOS)?\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/SamsungBrowser\//.test(s)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(s)) browser = "Firefox";
  else if (/CriOS\/|Chrome\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = "Safari";
  let os = "";
  if (/Windows/.test(s)) os = "Windows";
  else if (/Android/.test(s)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(s)) os = "iOS";
  else if (/Mac OS X|Macintosh/.test(s)) os = "macOS";
  else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Linux|X11/.test(s)) os = "Linux";
  return os ? browser + ", " + os : browser;
}
export const deviceIcon = (ua) => (/Android|iPhone|iPad|iPod|Mobile/.test(String(ua || "")) ? "phone" : "monitor");

export function avatar(account, { size = "", pending = false } = {}) {
  const kind = account.status === "blocked" ? " av--blocked" : account.role === "admin" ? " av--admin" : "";
  return h("span", { class: "av" + kind + (size ? " av--" + size : ""), "aria-hidden": "true" }, initials(account.display_name), pending ? h("span", { class: "av__pending" }) : null);
}

export function roleTag(role) {
  return h("span", { class: "tag " + (role === "admin" ? "tag--admin" : "tag--user") }, h("span", { class: "tag__ring" }), ROLE[role] || role);
}

export function statusTag(status) {
  const blocked = status === "blocked";
  return h("span", { class: "tag " + (blocked ? "tag--blocked" : "tag--active") }, h("span", { class: blocked ? "tag__ring" : "tag__dot" }), STATUS[status] || status);
}

export function permChips(perms) {
  const list = Array.isArray(perms) ? perms : [];
  if (!list.length) return h("span", { class: "perm" }, "Ruxsatlar yo'q");
  return list.map((p) => h("span", { class: "perm" }, PERM[p] || p));
}
