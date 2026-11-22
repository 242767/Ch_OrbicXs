// Messenjer uchun qulay qatlam: bazadagi funksiyalarni chaqirish, javoblarni tekshirish, matn va fayl yordamchilari.
// Tarmoqqa chiqish faqat api.js orqali (u yerda sayt kaliti va foydalanuvchi tokeni bilan ishlanadi).
import * as api from "./api.js";

export const LIMITS = { body: 4000, title: 60, groupMax: 50, fileBytes: 10 * 1024 * 1024, imageSide: 1600, imageInputBytes: 40 * 1024 * 1024 };

// ---------------------------------------------------------------------------
// Kichik yordamchilar
// ---------------------------------------------------------------------------
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d = "") => (typeof v === "string" ? v : d);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);

/** Tasodifiy UUID (v4). randomUUID bo'lmagan eski brauzerlar uchun zaxira bilan. */
export function uuid4() {
  try {
    if (crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* zaxira usulga o'tamiz */
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
  return x.slice(0, 8) + "-" + x.slice(8, 12) + "-" + x.slice(12, 16) + "-" + x.slice(16, 20) + "-" + x.slice(20);
}

export function fmtSize(n) {
  const v = num(n, -1);
  if (v < 0) return "";
  if (v < 1024) return v + " bayt";
  if (v < 1024 * 1024) return Math.round(v / 1024) + " KB";
  return (v / (1024 * 1024)).toFixed(v < 10 * 1024 * 1024 ? 1 : 0).replace(/\.0$/, "") + " MB";
}

// ---------------------------------------------------------------------------
// Matn: server ham xuddi shu qoidalarni tekshiradi (u oxirgi hakam)
// ---------------------------------------------------------------------------
const BAD_TEXT = /[\u{1}-\u{8}\u{b}-\u{1f}\u{7f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}]/u;

/** Yuboriladigan ko'rinish: qator uzilishlari bir xil, boshi-oxiridagi bo'sh joylar olib tashlangan. */
export const cleanBody = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/^[ \t\n]+|[ \t\n]+$/g, "");

/** Xabar matni xatosi yoki "" (hammasi joyida). */
export function bodyProblem(text) {
  if ([...text].length > LIMITS.body) return "Xabar " + LIMITS.body + " belgidan oshmasin.";
  if (BAD_TEXT.test(text)) return "Xabarda ruxsat etilmagan belgilar bor.";
  return "";
}

// ---------------------------------------------------------------------------
// Fayl turlari (4-messenjer.sql dagi ox_chat_allowed_mimes bilan bir xil ro'yxat)
// ---------------------------------------------------------------------------
const MIME_EXT = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "application/pdf": "pdf", "text/plain": "txt", "text/csv": "csv", "application/rtf": "rtf",
  "application/zip": "zip", "application/x-zip-compressed": "zip",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt", "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.oasis.opendocument.text": "odt", "application/vnd.oasis.opendocument.spreadsheet": "ods", "application/vnd.oasis.opendocument.presentation": "odp",
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/ogg": "ogg", "audio/wav": "wav", "audio/webm": "weba",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
};
const EXT_MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", rtf: "application/rtf",
  zip: "application/zip", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav", weba: "audio/webm", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
};
const MIME_ALIAS = { "image/jpg": "image/jpeg", "image/pjpeg": "image/jpeg", "audio/mp3": "audio/mpeg", "audio/x-wav": "audio/wav", "audio/wave": "audio/wav", "audio/x-m4a": "audio/mp4", "text/x-csv": "text/csv", "application/csv": "text/csv" };

/** Faylning ruxsat etilgan turi (brauzer bergan tur yoki kengaytma bo'yicha) yoki "" (ruxsat yo'q). */
export function mimeOf(file) {
  let t = String((file && file.type) || "").split(";")[0].trim().toLowerCase();
  t = MIME_ALIAS[t] || t;
  if (MIME_EXT[t]) return t;
  const m = /\.([a-z0-9]{1,5})$/i.exec(String((file && file.name) || ""));
  const e = m ? EXT_MIME[m[1].toLowerCase()] : "";
  if (e && (!t || t === "application/octet-stream")) return e;
  return "";
}
export const isImageMime = (m) => /^image\//.test(m);

// ---------------------------------------------------------------------------
// Rasm: yuborishdan oldin kichraytiriladi (yo'l-yo'lakay GPS kabi yashirin ma'lumotlar ham tushib qoladi)
// ---------------------------------------------------------------------------
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close && bmp.close() };
    } catch {
      /* zaxira usuliga o'tamiz */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("decode");
  }
  return { src: img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
}

const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

/** Rasm faylini yuborishga tayyorlaydi: {blob, mime, w, h}. Animatsiyali GIF o'zgartirilmaydi. */
async function prepareImage(file, mime) {
  let dec;
  try {
    dec = await decodeImage(file);
  } catch {
    throw Object.assign(new Error("Rasmni o'qib bo'lmadi. Fayl buzilgan yoki rasm emas."), { code: "bad_image" });
  }
  try {
    const { w, h } = dec;
    if (!(w > 0 && h > 0)) throw Object.assign(new Error("Rasmni o'qib bo'lmadi."), { code: "bad_image" });
    if (mime === "image/gif") return { blob: file, mime, w, h };
    const scale = Math.min(1, LIMITS.imageSide / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { blob: file, mime, w, h };
    ctx.drawImage(dec.src, 0, 0, cw, ch);
    const out = mime === "image/png" || mime === "image/webp" ? mime : "image/jpeg";
    const blob = await toBlob(canvas, out, 0.86);
    // Qayta kodlash ishlamasa yoki kichraymagan rasm kattalashib ketsa — asl nusxa yuboriladi
    if (!blob || blob.type !== out || (scale === 1 && blob.size >= file.size)) return { blob: file, mime, w, h };
    return { blob, mime: out, w: cw, h: ch };
  } finally {
    dec.done();
  }
}

/**
 * Yuboriladigan faylni tekshiradi va tayyorlaydi.
 * Natija: {blob, mime, name, size, w, h, kind:'image'|'file'}. Xatoda matnli Error tashlaydi.
 */
export async function prepareAttachment(file) {
  const mime = mimeOf(file);
  if (!mime) throw Object.assign(new Error("Bu turdagi faylni yuborib bo'lmaydi. Rasm, PDF, hujjat, jadval, arxiv, audio yoki video yuboring."), { code: "bad_type" });
  if (!(file.size > 0)) throw Object.assign(new Error("Fayl bo'sh."), { code: "empty_file" });
  const name = String(file.name || "fayl").slice(0, 120) || "fayl";
  if (isImageMime(mime)) {
    if (file.size > LIMITS.imageInputBytes) throw Object.assign(new Error("Rasm juda katta (" + fmtSize(file.size) + "). Kichikroq rasm tanlang."), { code: "too_large" });
    const p = await prepareImage(file, mime);
    if (p.blob.size > LIMITS.fileBytes) throw Object.assign(new Error("Rasm hajmi 10 MB dan oshmasin (hozir " + fmtSize(p.blob.size) + ")."), { code: "too_large" });
    // Kengaytma kichraytirilgan turga mos bo'lsin (masalan, HEIC emas, JPEG yuboriladi)
    return { blob: p.blob, mime: p.mime, name, size: p.blob.size, w: p.w, h: p.h, kind: "image" };
  }
  if (file.size > LIMITS.fileBytes) throw Object.assign(new Error("Fayl hajmi 10 MB dan oshmasin (hozir " + fmtSize(file.size) + ")."), { code: "too_large" });
  return { blob: file, mime, name, size: file.size, w: 0, h: 0, kind: "file" };
}

// ---------------------------------------------------------------------------
// Javoblarni tekshirish: kutilmagan shakl bo'lsa, ekran buzilmaydi
// ---------------------------------------------------------------------------
const KINDS = new Set(["text", "image", "file", "system"]);

export function normMsg(m) {
  const x = obj(m);
  const r = x.reply && typeof x.reply === "object" ? x.reply : null;
  return {
    seq: num(x.seq),
    rev: num(x.rev),
    sender: str(x.sender),
    kind: KINDS.has(x.kind) ? x.kind : "text",
    body: str(x.body),
    meta: obj(x.meta),
    reply: r ? { seq: num(r.seq), sender: str(r.sender), kind: KINDS.has(r.kind) ? r.kind : "text", snippet: str(r.snippet), name: str(r.name), deleted: r.deleted === true } : null,
    at: str(x.at),
    deleted: x.deleted === true,
  };
}

function normPack(j) {
  const x = obj(j);
  const c = obj(x.conv);
  const people = {};
  for (const [id, p] of Object.entries(obj(x.people))) people[id] = { login: str(obj(p).login), name: str(obj(p).name) };
  return {
    conv: { id: str(c.id), kind: c.kind === "group" ? "group" : "direct", title: str(c.title), rev: num(c.rev), role: c.role === "owner" ? "owner" : "member", readSeq: num(c.read_seq), joinedSeq: num(c.joined_seq) },
    members: arr(x.members).map((m) => ({ id: str(obj(m).id), login: str(obj(m).login), name: str(obj(m).name), role: obj(m).role === "owner" ? "owner" : "member", readSeq: num(obj(m).read_seq), available: obj(m).available !== false })),
    people,
    messages: arr(x.messages).map(normMsg),
    hasMore: x.has_more === true,
  };
}

function normItem(it) {
  const x = obj(it);
  const p = x.peer && typeof x.peer === "object" ? x.peer : null;
  const last = x.last && typeof x.last === "object" ? normMsg(x.last) : null;
  return {
    id: str(x.id),
    kind: x.kind === "group" ? "group" : "direct",
    title: str(x.title),
    role: x.role === "owner" ? "owner" : "member",
    rev: num(x.rev),
    lastAt: str(x.last_at) || str(x.created_at),
    unread: Math.max(0, num(x.unread)),
    readSeq: num(x.read_seq),
    peerReadSeq: num(x.peer_read_seq),
    memberCount: num(x.member_count),
    peer: p ? { id: str(p.id), login: str(p.login), name: str(p.name), available: p.available !== false } : null,
    last,
  };
}

// ---------------------------------------------------------------------------
// Funksiyalar
// ---------------------------------------------------------------------------
export async function directory(q) {
  const t = String(q || "").trim();
  const j = obj(await api.rpc("ox_chat_directory", t ? { p_q: t } : {}));
  return arr(j.people).map((p) => ({ id: str(obj(p).id), login: str(obj(p).login), name: str(obj(p).name) }));
}

export async function listChats() {
  const j = obj(await api.rpc("ox_chat_list"));
  return { unread: Math.max(0, num(j.unread_total)), items: arr(j.items).map(normItem).filter((i) => i.id) };
}

export async function unreadTotal() {
  return Math.max(0, num(obj(await api.rpc("ox_chat_unread")).unread_total));
}

export async function openDm(userId) {
  const j = obj(await api.rpc("ox_chat_open_dm", { p_user: userId }));
  return { id: str(j.id), created: j.created === true };
}

export async function createGroup(title, memberIds) {
  const j = obj(await api.rpc("ox_chat_create_group", { p_title: title, p_members: memberIds }));
  return { id: str(j.id) };
}

export const history = async (conv, before) => normPack(await api.rpc("ox_chat_history", before ? { p_conv: conv, p_before: before, p_limit: 40 } : { p_conv: conv, p_limit: 40 }));
export const delta = async (conv, afterRev) => normPack(await api.rpc("ox_chat_delta", { p_conv: conv, p_after_rev: afterRev }));

/** Xabar yuboradi. nonce — shu xabarga xos kod: tarmoq uzilib qayta yuborilsa, xabar ikki marta chiqmaydi. */
export async function send(conv, { body = "", meta = null, reply = null, nonce }) {
  const args = { p_conv: conv, p_body: body, p_nonce: nonce };
  if (meta) args.p_meta = meta;
  if (reply) args.p_reply = reply;
  const j = obj(await api.rpc("ox_chat_send", args, { ms: 30000 }));
  return { message: normMsg(j.message), duplicate: j.duplicate === true };
}

/** O'z xabarini o'chiradi. Fayl bo'lsa, uni ombordan ham o'chiradi (omborni faqat brauzer o'chira oladi). Natija: fayl o'chirilmagan bo'lsa — true. */
export async function removeMessage(conv, seq) {
  const j = obj(await api.rpc("ox_chat_delete", { p_conv: conv, p_seq: seq }));
  const path = str(j.path);
  let fileLeft = false;
  if (path) {
    try {
      await api.fileRemove(path);
    } catch (e) {
      if (e && e.fatal) throw e;
      fileLeft = true; // xabar o'chdi, fayl ombordagi izi qoldi — foydalanuvchiga ko'rsatilmaydi, lekin yashirin qolmaydi
    }
  }
  return { fileLeft };
}

export async function markRead(conv, seq) {
  const j = obj(await api.rpc("ox_chat_mark_read", { p_conv: conv, p_seq: seq }));
  return { readSeq: num(j.read_seq), unread: Math.max(0, num(j.unread_total)) };
}

export const renameGroup = (conv, title) => api.rpc("ox_chat_group_rename", { p_conv: conv, p_title: title });
export const addMembers = (conv, ids) => api.rpc("ox_chat_group_add", { p_conv: conv, p_users: ids });
export const removeMember = (conv, id) => api.rpc("ox_chat_group_remove", { p_conv: conv, p_user: id });
export const leaveGroup = (conv) => api.rpc("ox_chat_leave", { p_conv: conv });

/** Faylni «ox-chat» omboriga yuklaydi (xabar hali yuborilmaydi). Natija: xabarga qo'shiladigan meta ({path, name, w, h}). */
export async function uploadAttachment(conv, att) {
  const path = conv + "/" + uuid4() + "." + MIME_EXT[att.mime];
  await api.fileUpload(path, att.blob, att.mime);
  const meta = { path, name: att.name };
  if (att.kind === "image" && att.w > 0 && att.h > 0) {
    meta.w = att.w;
    meta.h = att.h;
  }
  return meta;
}

/** Yuklangan, lekin xabarga biriktirilmagan faylni ombordan olib tashlaydi (xato bo'lsa ham jim). */
export const discardUpload = (path) => api.fileRemove(path).catch(() => {});

/** Faylni yuklab olib, brauzerdan «saqlash»ni boshlaydi (hech qachon sahifada ochilmaydi). */
export async function saveFile(path, name) {
  const blob = await api.fileDownload(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = String(name || "fayl").replace(/[\\/\n\r\t]+/g, "_");
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Rasm uchun vaqtinchalik manzil (blob:). Chaqiruvchi uni revoke qilishi shart. */
export async function imageUrl(path) {
  const blob = await api.fileDownload(path);
  return URL.createObjectURL(blob);
}
