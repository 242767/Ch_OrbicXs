// Bildirishnomalar (brauzer tomoni): xizmat ishchisi (sw.js), ruxsat, push-obuna va serverga ulash, ovozsiz suhbatlar.
//
// Maxfiylik: bu modul ham, push-xizmati (Google/Apple/Mozilla) ham xabar matnini ko'rmaydi. Turtki matnsiz keladi, bildirishnoma matni
// har doim umumiy «Yangi xabar». Kim, qaysi suhbatdan, nima yozgani faqat sahifa ochilganda, foydalanuvchining o'z tokeni bilan olinadi.
import * as api from "./api.js";
import { deviceLabel } from "./parts.js";

const FLAG_KEY = "ox.push.v1"; // {uid, sid, at}: bu brauzer shu hisob uchun bildirishnomani yoqqan (qayta kirganda jim tiklash uchun)
const HINT_KEY = "ox.push.hint.v1"; // {uid}: «bildirishnomani yoqing» eslatmasi yopilgan
const DAY = 24 * 3600 * 1000;

const DENIED_TEXT =
  "Brauzer bu sayt uchun bildirishnomalarni bloklagan. Manzil satridagi qulf (yoki sozlamalar) belgisini bosing, «Bildirishnomalar»ni «Ruxsat berish»ga o'zgartiring va sahifani yangilang.";

export const SUPPORT_TEXT = {
  insecure: "Bildirishnomalar faqat himoyalangan (https) manzilda ishlaydi.",
  ios_install:
    "iPhone va iPad'da bildirishnoma faqat sayt Bosh ekranga qo'shilgandagina ishlaydi. Safari'da «Ulashish» tugmasini bosing, «Bosh ekranga qo'shish»ni tanlang, so'ng OrbicXs'ni Bosh ekrandagi belgisidan oching va shu yerga qaytib keling. (iOS 16.4 yoki yangisi kerak.)",
  no_push: "Bu brauzer bildirishnomalarni qo'llab-quvvatlamaydi. Chrome, Edge, Firefox yoki Safari'ning yangi versiyasidan foydalaning (iPhone uchun iOS 16.4 yoki yangisi kerak).",
};

// ---------------------------------------------------------------------------
// Kichik yordamchilar
// ---------------------------------------------------------------------------
function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    const o = raw ? JSON.parse(raw) : null;
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}
function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* xotira yopiq bo'lsa, jim tiklash ishlamaydi, qolgani ishlayveradi */
  }
}
function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* e'tibor berilmaydi */
  }
}

const err = (code, message) => new api.ApiError(code, message, 0);
const hasMessenger = (account) => !!account && Array.isArray(account.permissions) && account.permissions.includes("messenger");

function withTimeout(promise, ms, make) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(make()), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Qo'llab-quvvatlash va ruxsat
// ---------------------------------------------------------------------------
export function isStandalone() {
  try {
    return navigator.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches);
  } catch {
    return false;
  }
}

/** {ok: true} yoki {ok: false, reason: "insecure" | "ios_install" | "no_push"} */
export function supportInfo() {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, reason: ios && !isStandalone() ? "ios_install" : "no_push" };
  }
  return { ok: true, reason: "" };
}

/** "default" | "granted" | "denied" | "unsupported" */
export function permission() {
  try {
    return "Notification" in window ? Notification.permission : "unsupported";
  } catch {
    return "unsupported";
  }
}

const myLabel = () => deviceLabel(navigator.userAgent) + (isStandalone() ? " (ilova)" : "");

// Holat o'zgarganda (yoqildi, o'chirildi, ruxsat o'zgardi) kabinet va eslatma yangilansin
const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* bitta tinglovchining xatosi boshqalarga xalaqit bermasin */
    }
  }
}

// ---------------------------------------------------------------------------
// Xizmat ishchisi va server kaliti
// ---------------------------------------------------------------------------
let regP = null;
/** sw.js ni ro'yxatdan o'tkazadi va u faollashguncha kutadi. */
export function register() {
  if (!regP) {
    const p = navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" }).then(() => navigator.serviceWorker.ready);
    regP = withTimeout(p, 15000, () => err("sw_failed", "Xizmat ishchisi ishga tushmadi. Sahifani yangilab, qayta urinib ko'ring."));
    regP.catch(() => {
      regP = null;
    });
  }
  return regP;
}

function b64urlToBytes(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]{80,100}$/.test(s)) return null;
  try {
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
    const out = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
    // Ochiq kalit: siqilmagan P-256 nuqtasi, 65 bayt, 0x04 bilan boshlanadi
    return out.length === 65 && out[0] === 4 ? out : null;
  } catch {
    return null;
  }
}

// Server funksiyasi eski bo'lsa (bildirishnoma amallarini tanimasa), aniq xabar beramiz
function pushErr(e) {
  if (e && !e.fatal && e.code === "unknown_action") {
    return new api.ApiError("push_old_fn", "Server funksiyasi (ox-api) eskirgan: bildirishnomalar uchun uni 4-bosqich versiyasi bilan almashtiring (qo'llanma, «Bildirishnomalar» bo'limi).", 404);
  }
  return e;
}

let keyP = null;
/** Server ochiq (VAPID) kaliti: obuna shu kalitga bog'lanadi. Sahifa yuklangandan keyin bir marta olinadi. */
export function vapidKey() {
  if (!keyP) {
    keyP = api
      .call("push_key")
      .then((d) => {
        const k = b64urlToBytes(d && d.public_key);
        if (!k) throw err("push_key_invalid", "Serverdan noto'g'ri bildirishnoma kaliti keldi. Funksiyani qayta joylang.");
        return k;
      })
      .catch((e) => {
        keyP = null;
        throw pushErr(e);
      });
  }
  return keyP;
}

/** Bosishdan oldin tayyorlab qo'yish: iOS ruxsat so'rovidan keyin obunani kutmasdan qilishni talab qiladi. */
export function prepare() {
  if (!supportInfo().ok) return Promise.resolve(false);
  return Promise.all([register(), vapidKey()]).then(
    () => true,
    () => false,
  );
}

function sameKey(buf, bytes) {
  if (!buf) return false;
  const a = new Uint8Array(buf);
  if (a.length !== bytes.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
  return true;
}

/** Shu brauzerning push-obunasi yoki null. */
export async function localSubscription() {
  if (!supportInfo().ok) return null;
  try {
    const reg = await register();
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

// Shu brauzerdagi obunani server kaliti bilan moslab oladi (eskirgan kalitli obuna bo'lsa, almashtiradi)
async function ensureSubscription(reg, key) {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) {
    try {
      await sub.unsubscribe();
    } catch {
      /* e'tibor berilmaydi */
    }
    sub = null;
  }
  if (sub) return { sub, fresh: false };
  return { sub: await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }), fresh: true };
}

function subscribeError(e) {
  const name = e && e.name;
  if (name === "NotAllowedError") return err("perm_denied", DENIED_TEXT);
  if (name === "AbortError") {
    return err(
      "push_service",
      "Brauzer bildirishnoma xizmatiga ulana olmadi. Internetni tekshirib, qayta urinib ko'ring. Brave brauzerida Sozlamalar → Maxfiylik va xavfsizlik bo'limidagi «Google push xizmatlaridan foydalanish» (Use Google services for push messaging) yoqilgan bo'lishi kerak.",
    );
  }
  return err("subscribe_failed", "Brauzer obunani qabul qilmadi. Sahifani yangilab, qayta urinib ko'ring.");
}

function askPermission() {
  return new Promise((resolve) => {
    try {
      const p = Notification.requestPermission((r) => resolve(r)); // eski Safari: qayta chaqiruv bilan
      if (p && typeof p.then === "function") p.then(resolve, () => resolve(permission()));
    } catch {
      resolve(permission());
    }
  });
}

// ---------------------------------------------------------------------------
// Shu qurilmada yoqish / o'chirish
// ---------------------------------------------------------------------------
const writeFlag = (uid, sid) => writeJson(FLAG_KEY, { uid, sid: sid || "", at: Date.now() });

/**
 * Shu qurilmada bildirishnomani yoqadi. FAQAT foydalanuvchi tugmani bosgan zahoti chaqiring: ruxsat so'rovi bu funksiyadagi
 * birinchi amal bo'lishi shart (iPhone/Safari boshqacha qilishga yo'l qo'ymaydi), shuning uchun u async emas.
 */
export function enableHere() {
  const sup = supportInfo();
  if (!sup.ok) return Promise.reject(err("unsupported", SUPPORT_TEXT[sup.reason]));
  const asked = permission() === "default" ? askPermission() : Promise.resolve(permission());
  return enableAfter(asked);
}

async function enableAfter(asked) {
  const perm = await asked;
  if (perm !== "granted") {
    emit();
    throw perm === "denied" ? err("perm_denied", DENIED_TEXT) : err("perm_dismissed", "Ruxsat berilmadi. Tugmani qayta bosib, so'ralganda «Ruxsat berish»ni tanlang.");
  }
  const user = api.sessionUser();
  if (!user) throw err("no_session", "Avval tizimga kiring.");
  let reg;
  let key;
  try {
    [reg, key] = await Promise.all([register(), vapidKey()]);
  } catch (e) {
    throw pushErr(e);
  }
  let made;
  try {
    made = await ensureSubscription(reg, key);
  } catch (e) {
    throw subscribeError(e);
  }
  try {
    await api.rpc("ox_push_subscribe", { p_endpoint: made.sub.endpoint, p_label: myLabel() });
  } catch (e) {
    if (made.fresh) {
      try {
        await made.sub.unsubscribe();
      } catch {
        /* e'tibor berilmaydi */
      }
    }
    throw e;
  }
  writeFlag(user.id, api.sessionId());
  emit();
  return true;
}

/** Shu qurilmada o'chiradi: avval serverdan olib tashlaydi, so'ng brauzer obunasini bekor qiladi. */
export async function disableHere() {
  const sub = await localSubscription();
  if (sub) {
    await api.rpc("ox_push_remove", { p_endpoint: sub.endpoint });
    try {
      await sub.unsubscribe();
    } catch {
      /* e'tibor berilmaydi */
    }
  }
  removeKey(FLAG_KEY);
  emit();
  return true;
}

// ---------------------------------------------------------------------------
// Ilova ochilganda: jim tiklash (qayta kirgan yoki obunasi yangilangan brauzer)
// ---------------------------------------------------------------------------
let syncP = Promise.resolve(false);
/** Oxirgi sync() tugashini kutish uchun (kabinet holatni o'qishdan oldin kutadi). */
export const synced = () => syncP;

/**
 * Bu brauzer shu hisob uchun bildirishnomani yoqqan bo'lsa (flag), obuna hali amalda ekanini tekshiradi va qurilmani joriy seansga bog'laydi.
 * Umumiy tugma to'xtatilgan bo'lsa, qayta yoqib yubormaydi. Xatolar jim: keyingi ochilishda yana urinadi.
 */
export function sync(account, force = false) {
  syncP = doSync(account, force);
  return syncP;
}

async function doSync(account, force) {
  if (!supportInfo().ok || permission() !== "granted" || !hasMessenger(account)) return false;
  const f = readJson(FLAG_KEY);
  if (!f || f.uid !== account.id) return false;
  const sid = api.sessionId();
  if (!force && f.sid === sid && Date.now() - (Number(f.at) || 0) < DAY) return false;
  try {
    const [reg, key] = await Promise.all([register(), vapidKey()]);
    const { sub } = await ensureSubscription(reg, key);
    let paused = false;
    try {
      const st = await api.rpc("ox_push_state", { p_endpoint: sub.endpoint });
      paused = !!st && st.enabled === false;
    } catch (e) {
      if (e && e.fatal) return false;
    }
    const r = await api.rpc("ox_push_subscribe", { p_endpoint: sub.endpoint, p_label: myLabel() });
    if (paused && r && r.created) await api.rpc("ox_push_enable", { p_enabled: false });
    writeFlag(account.id, sid);
    emit();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ilova bilan aloqa: xizmat ishchisidan xabarlar, ruxsat o'zgarishi
// ---------------------------------------------------------------------------
let stopFn = null;

/**
 * Kirgandan keyin chaqiriladi. onOpenChat — bildirishnoma bosilganda; onPoke — yangi turtki kelganda (xabarlarni darhol yangilash uchun).
 */
export function start({ account, onOpenChat = () => {}, onPoke = () => {} }) {
  stop();
  if (!supportInfo().ok || !hasMessenger(account)) return;
  const onMsg = (e) => {
    const t = e && e.data && e.data.type;
    if (t === "ox-open-chat") onOpenChat();
    else if (t === "ox-push") onPoke();
    else if (t === "ox-push-changed") sync(account, true);
  };
  navigator.serviceWorker.addEventListener("message", onMsg);
  let perm = null;
  try {
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: "notifications" }).then(
        (p) => {
          perm = p;
          p.onchange = emit;
        },
        () => {},
      );
    }
  } catch {
    /* ba'zi brauzerlar bu so'rovni tanimaydi */
  }
  stopFn = () => {
    navigator.serviceWorker.removeEventListener("message", onMsg);
    if (perm) perm.onchange = null;
  };
  register().catch(() => {});
  sync(account, false);
}

export function stop() {
  if (stopFn) stopFn();
  stopFn = null;
  syncP = Promise.resolve(false);
}

/** Ilova belgisidagi raqam (o'rnatilgan ilovalarda); qo'llab-quvvatlanmasa — hech narsa. */
export function appBadge(n) {
  try {
    if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(Math.min(n, 99)).catch(() => {});
    else if (!(n > 0) && navigator.clearAppBadge) navigator.clearAppBadge().catch(() => {});
  } catch {
    /* e'tibor berilmaydi */
  }
}

// ---------------------------------------------------------------------------
// Server bilan: xabar yuborilgach xabardor qilish, holat, sinov, umumiy tugma, qurilmalar, ovozsiz suhbatlar, faollik
// ---------------------------------------------------------------------------
let notifyOff = false;
/**
 * Xabar muvaffaqiyatli yuborilgach chaqiriladi: server kimga turtki yuborishni o'zi aniqlaydi (a'zo, o'qimagan, ovozsiz emas...).
 * Yuboruvchining o'z brauzeri bildirishnomani qo'llab-quvvatlashi shart emas. Xato bo'lsa, xabarning o'ziga ta'sir qilmaydi.
 */
export function notifySent(conversationId, seq) {
  if (notifyOff || typeof conversationId !== "string" || !Number.isSafeInteger(seq) || seq < 1) return;
  api.call("push_notify", { conversation_id: conversationId, seq }).catch((e) => {
    // Funksiya eski yoki bildirishnoma ishga tushirilmagan: bu sahifa ochiq turgancha qayta urinmaymiz
    if (e && ["unknown_action", "push_unavailable", "push_key_invalid", "function_missing", "forbidden"].includes(e.code)) notifyOff = true;
  });
}

/** Kabinet uchun: {enabled, max_devices, devices: [{id, label, created_at, seen_at, last_ok_at, fail_count, current, active}]} */
export async function loadState(endpoint) {
  const d = await api.rpc("ox_push_state", endpoint ? { p_endpoint: endpoint } : {});
  const list = d && Array.isArray(d.devices) ? d.devices : [];
  return {
    enabled: !d || d.enabled !== false,
    max: Number.isInteger(d && d.max_devices) ? d.max_devices : 5,
    devices: list.filter((x) => x && typeof x.id === "string"),
  };
}

export const setMaster = (on) => api.rpc("ox_push_enable", { p_enabled: !!on });

/** Boshqa (yoki shu) qurilmani ro'yxatdan olib tashlaydi. Shu brauzerniki bo'lsa, brauzer obunasi ham bekor qilinadi. */
export async function removeDevice(device) {
  if (device.current) return disableHere();
  await api.rpc("ox_push_remove", { p_id: device.id });
  return true;
}

/**
 * Xizmat ishchisiga «hozir sinov turtkisi keladi» deydi: u sahifa fokusda bo'lsa ham bildirishnomani ko'rsatadi (haqiqiy xabarda esa
 * fokusdagi sahifa ustiga bildirishnoma chiqmaydi). Xato bo'lsa e'tibor berilmaydi: sinov baribir yuboriladi.
 */
async function expectTest() {
  try {
    const reg = await register();
    if (reg && reg.active) reg.active.postMessage({ type: "ox-expect-test" });
  } catch {
    /* sinov bildirishnomasi ko'rinmasligi mumkin (sahifa fokusda bo'lsa), lekin yuborilishiga halal bermaydi */
  }
}

/** Sinov bildirishnomasi: {sent, delivered, removed, failed, skipped} */
export async function sendTest(deviceId) {
  await expectTest();
  try {
    return await api.call("push_test", deviceId ? { device_id: deviceId } : {});
  } catch (e) {
    throw pushErr(e);
  }
}

/** [{conversation_id, until}] — until: ISO vaqt yoki null (doimiy) */
export async function loadMutes() {
  const d = await api.rpc("ox_push_mutes");
  return (Array.isArray(d) ? d : []).filter((x) => x && typeof x.conversation_id === "string");
}

/** minutes: 1..525600 yoki null (doimiy) */
export const mute = (conversationId, minutes = null) => api.rpc("ox_push_mute", minutes === null ? { p_conv: conversationId } : { p_conv: conversationId, p_minutes: minutes });
export const unmute = (conversationId) => api.rpc("ox_push_unmute", { p_conv: conversationId });

/** Kabinetdagi «Faollik»: [{id, at, action, by, ip, info}] */
export async function loadActivity(limit = 30) {
  const d = await api.rpc("ox_my_activity", { p_limit: limit });
  return (Array.isArray(d) ? d : []).filter((x) => x && typeof x.action === "string");
}

// ---------------------------------------------------------------------------
// Birinchi eslatma («bildirishnomani yoqing»)
// ---------------------------------------------------------------------------
export function hintWanted(account) {
  if (!hasMessenger(account)) return false;
  const sup = supportInfo();
  if (!sup.ok && sup.reason !== "ios_install") return false;
  if (sup.ok && permission() !== "default") return false;
  const h = readJson(HINT_KEY);
  return !(h && h.uid === account.id);
}
export function dismissHint(account) {
  writeJson(HINT_KEY, { uid: account.id });
}
