// Supabase bilan aloqa: kirish/chiqish, seansni saqlash va yangilash, ox-api funksiyasini chaqirish.
// supabase-js kutubxonasi ishlatilmaydi — hammasi oddiy fetch: tashqi kod yo'q, shuning uchun CSP qattiq turadi.
// Bu faylda faqat OCHIQ kalit (publishable/anon) bor. Maxfiy kalit saytga hech qachon tushmaydi.
import config from "../config.js";

const URL_ = String(config.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY_ = String(config.SUPABASE_KEY || "").trim();
const DOMAIN = String(config.LOGIN_DOMAIN || "orbicxs.internal").trim().toLowerCase();
const FN = String(config.FUNCTION_NAME || "ox-api").trim();

const STORE_KEY = "ox.session.v1";
const MARGIN = 60; // token tugashiga shuncha soniya qolganda yangilanadi
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{1,39}$/;

const NET_MSG = "Server bilan aloqa o'rnatilmadi. Internetni tekshirib, qayta urinib ko'ring.";
const OLD_FN_MSG = "Server funksiyasi (" + FN + ") eskirgan: bu amalni tanimaydi. Funksiyani 2-bosqich versiyasi bilan almashtiring (qo'llanma, 5-qadam).";
const KEY_MSG = "Supabase sayt kalitini qabul qilmadi. config.js dagi SUPABASE_KEY (Publishable key) to'g'riligini tekshiring.";

export class ApiError extends Error {
  constructor(code, message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fatal = false; // true: butun ekran almashtirilgan (seans tugagan, bloklangan va h.k.) — ko'rinishlar xabar chiqarmasin
    this.retryAfter = 0; // soniya: server «shuncha kutib turing» degan bo'lsa (tezlik cheklovi)
  }
}

const nowSec = () => Math.floor(Date.now() / 1000);

// ---------------------------------------------------------------------------
// Sozlamalarni tekshirish (config.js)
// ---------------------------------------------------------------------------
function jwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

export function configProblem() {
  const placeholder = /LOYIHA-ID|SHU_YERGA/i;
  if (/^sb_secret_/i.test(KEY_) || (jwtPayload(KEY_) || {}).role === "service_role") {
    return {
      code: "secret_key",
      title: "config.js ichiga maxfiy kalit qo'yilgan",
      text: "Sayt maxfiy (Secret / service_role) kalit bilan ishlamaydi va uni hech qayerga yubormaydi. Bu kalit allaqachon GitHub yoki Vercel'ga tushgan bo'lsa, uni zudlik bilan Supabase'da almashtiring (API Keys bo'limida kalitni qayta yarating). Keyin config.js ga faqat Publishable kalitni qo'ying.",
    };
  }
  if (!KEY_ || placeholder.test(KEY_)) {
    return { code: "no_key", title: "Sayt hali sozlanmagan", text: "config.js ichidagi SUPABASE_KEY qiymatini Supabase'dagi Publishable key bilan almashtiring (qo'llanma, 6-qadam)." };
  }
  if (!/^(sb_publishable_[A-Za-z0-9_-]{8,}|eyJ[\w-]+\.[\w-]+\.[\w-]+)$/.test(KEY_)) {
    return { code: "bad_key", title: "Kalit noto'g'ri ko'rinishda", text: "config.js dagi SUPABASE_KEY «sb_publishable_...» bilan boshlanishi kerak. Kalitni to'liq nusxalaganingizni tekshiring." };
  }
  if (!URL_ || placeholder.test(URL_)) {
    return { code: "no_url", title: "Sayt hali sozlanmagan", text: "config.js ichidagi SUPABASE_URL qiymatini o'z loyihangiz manzili bilan almashtiring (masalan, https://abcdxyz.supabase.co)." };
  }
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(URL_) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(URL_)) {
    return { code: "bad_url", title: "Supabase manzili noto'g'ri", text: "SUPABASE_URL «https://...supabase.co» ko'rinishida bo'lsin, oxirida «/rest/v1» yoki boshqa qo'shimcha bo'lmasin." };
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(DOMAIN) || !/^[A-Za-z0-9_-]{1,60}$/.test(FN)) {
    return { code: "bad_config", title: "config.js noto'g'ri", text: "LOGIN_DOMAIN va FUNCTION_NAME qiymatlarini tekshiring (standart: orbicxs.internal va ox-api)." };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Seansni saqlash: «eslab qol» — localStorage, aks holda sessionStorage. Ombor ishlamasa, xotirada.
// ---------------------------------------------------------------------------
function getStore(name) {
  try {
    const s = window[name];
    s.getItem("ox.probe");
    return s;
  } catch {
    return null;
  }
}
const local = getStore("localStorage");
const sess = getStore("sessionStorage");
let mem = null;
let memOnly = !(local || sess);

function parse(raw) {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.access_token === "string" && typeof o.refresh_token === "string" && Number.isFinite(o.expires_at) && o.user && typeof o.user.id === "string") {
      return { access_token: o.access_token, refresh_token: o.refresh_token, expires_at: o.expires_at, user: { id: o.user.id, email: String(o.user.email || "") }, remember: !!o.remember };
    }
  } catch {
    /* buzilgan yozuv e'tiborga olinmaydi */
  }
  return null;
}

function load() {
  for (const s of [local, sess]) {
    if (!s) continue;
    let raw = null;
    try {
      raw = s.getItem(STORE_KEY);
    } catch {
      raw = null;
    }
    const p = raw ? parse(raw) : null;
    if (p) return p;
  }
  return null;
}

export function current() {
  if (!memOnly) mem = load();
  return mem;
}
export const hasSession = () => current() !== null;
export const sessionUser = () => (current() || {}).user || null;

function persist(ses) {
  mem = ses;
  const first = ses.remember ? local : sess;
  const target = first || sess || local;
  let ok = false;
  if (target) {
    try {
      target.setItem(STORE_KEY, JSON.stringify(ses));
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (ok) {
    for (const s of [local, sess]) {
      if (s && s !== target) {
        try {
          s.removeItem(STORE_KEY);
        } catch {
          /* e'tibor berilmaydi */
        }
      }
    }
  }
  memOnly = !ok;
}

function wipe() {
  mem = null;
  memOnly = !(local || sess);
  for (const s of [local, sess]) {
    if (!s) continue;
    try {
      s.removeItem(STORE_KEY);
    } catch {
      /* e'tibor berilmaydi */
    }
  }
  clearTimeout(timer);
}

// ---------------------------------------------------------------------------
// Voqealar: ilova ekranni almashtirishi uchun
//   {type:"signed_out", reason:"expired"|"other_tab"|"blocked"|"no_account"|"user"}
//   {type:"signed_in"}   — boshqa oynada kirildi
//   {type:"must_change_password"}
//   {type:"mfa_required"}            — amal uchun Authenticator kodi kerak (ilova tasdiqlash ekranini ko'rsatadi)
//   {type:"mfa_enrollment_required"} — administratorda 2FA qurilmasi hali ulanmagan
// ---------------------------------------------------------------------------
const listeners = new Set();
export function onEvent(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(ev) {
  for (const fn of [...listeners]) {
    try {
      fn(ev);
    } catch (e) {
      console.error("[ox] listener xatosi", e);
    }
  }
}
function endSession(reason) {
  const had = current() !== null;
  wipe();
  if (had) emit({ type: "signed_out", reason });
}

let lastSeen = hasSession();
window.addEventListener("storage", (e) => {
  if (e.key !== null && e.key !== STORE_KEY) return;
  const now = hasSession();
  if (now && !lastSeen) emit({ type: "signed_in" });
  if (!now && lastSeen) emit({ type: "signed_out", reason: "other_tab" });
  lastSeen = now;
});

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
let cfgOk = null;
async function http(path, { method = "GET", body, token, headers = {}, ms = 15000 } = {}) {
  // config.js noto'g'ri yoki ichida maxfiy kalit bo'lsa, hech qanday so'rov yuborilmaydi
  if (cfgOk === null) cfgOk = configProblem() === null;
  if (!cfgOk) throw new ApiError("bad_config", "Sayt sozlanmagan: config.js ni tekshiring.", 0);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const hd = { apikey: KEY_, ...headers };
    if (token) hd.authorization = "Bearer " + token;
    if (body !== undefined) hd["content-type"] = "application/json";
    const res = await fetch(URL_ + path, {
      method,
      headers: hd,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    let json = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch {
    throw new ApiError("network", NET_MSG, 0);
  } finally {
    clearTimeout(timer);
  }
}

const authCode = (j) => String((j && (j.error_code || j.error)) || "");
const authMsg = (j) => String((j && (j.msg || j.error_description || j.message)) || "");
const sessionExpired = () => new ApiError("session_expired", "Seans tugadi. Qayta kiring.", 401);

function toSession(j, remember) {
  if (!j || typeof j.access_token !== "string" || typeof j.refresh_token !== "string" || !j.user || typeof j.user.id !== "string") {
    throw new ApiError("auth_error", "Kirish xizmati kutilmagan javob qaytardi. Birozdan so'ng qayta urinib ko'ring.", 0);
  }
  const exp = Number(j.expires_in);
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    // Qurilma soati noto'g'ri bo'lsa ham ishlashi uchun: tugash vaqti serverning emas, o'zimizning soatimizga nisbatan.
    expires_at: nowSec() + (Number.isFinite(exp) && exp > 0 ? exp : 3600),
    user: { id: j.user.id, email: String(j.user.email || "") },
    remember: !!remember,
  };
}

// ---------------------------------------------------------------------------
// Kirish va chiqish
// ---------------------------------------------------------------------------
function signInError(r) {
  const code = authCode(r.json);
  const msg = authMsg(r.json);
  if (r.status === 429 || code === "over_request_rate_limit") {
    return new ApiError("rate_limited", "Juda ko'p urinish. Bir necha daqiqadan so'ng qayta urinib ko'ring.", 429);
  }
  if (code === "user_banned" || /banned/i.test(msg)) {
    return new ApiError("blocked", "Bu hisob bloklangan. Administrator bilan bog'laning.", r.status);
  }
  if (code === "email_not_confirmed" || /not confirmed/i.test(msg)) {
    return new ApiError("not_confirmed", "Hisob hali tasdiqlanmagan. Administratorga murojaat qiling.", r.status);
  }
  if (r.status === 400 && (code === "invalid_credentials" || code === "invalid_grant" || /invalid login credentials/i.test(msg))) {
    return new ApiError("bad_credentials", "Login yoki parol noto'g'ri.", 400);
  }
  if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(msg)) return new ApiError("key_rejected", KEY_MSG, r.status);
  if (r.status === 404) return new ApiError("bad_url", "Supabase manzili topilmadi. config.js dagi SUPABASE_URL ni tekshiring.", 404);
  if (r.status >= 500) return new ApiError("auth_unavailable", "Kirish xizmati hozir javob bermayapti. Birozdan so'ng qayta urinib ko'ring.", r.status);
  return new ApiError("auth_error", "Kirib bo'lmadi (xato " + r.status + "). Birozdan so'ng qayta urinib ko'ring.", r.status);
}

export async function signIn(login, password, remember) {
  const l = String(login || "").trim().toLowerCase();
  if (!LOGIN_RE.test(l)) {
    throw new ApiError("bad_login", "Login noto'g'ri yozilgan: faqat kichik lotin harflari, raqam, nuqta, tagchiziq va tire bo'lishi mumkin.");
  }
  if (typeof password !== "string" || !password) throw new ApiError("bad_password", "Parolni kiriting.");
  const r = await http("/auth/v1/token?grant_type=password", { method: "POST", body: { email: l + "@" + DOMAIN, password } });
  if (!r.ok) throw signInError(r);
  const ses = toSession(r.json, remember);
  persist(ses);
  lastSeen = true;
  schedule();
  return ses.user;
}

// everywhere=true: barcha qurilmalardagi seanslar yopiladi. Natija: server tomonda bajarildimi.
export async function signOut(everywhere = false) {
  const ses = current();
  let ok = true;
  if (ses) {
    if (everywhere) {
      try {
        const token = await freshToken();
        const r = await http("/auth/v1/logout?scope=global", { method: "POST", token, ms: 10000 });
        ok = r.ok || r.status === 401 || r.status === 403;
      } catch (e) {
        ok = e instanceof ApiError && e.code === "session_expired";
      }
    } else {
      // Mahalliy chiqish odatda kutdirmaydi: so'rov fonda ketadi. Token muddati o'tgan bo'lsa, avval yangilanadi,
      // aks holda server seansi ochiq qolib ketardi.
      let token = ses.access_token;
      if (ses.expires_at - nowSec() <= 5) {
        try {
          token = await freshToken();
        } catch {
          token = null;
        }
      }
      if (token) http("/auth/v1/logout?scope=local", { method: "POST", token, ms: 6000 }).catch(() => {});
    }
  }
  lastSeen = false;
  wipe();
  return ok;
}

// ---------------------------------------------------------------------------
// Tokenni yangilash (bir nechta oyna bir-biriga xalaqit bermasligi uchun Web Locks bilan)
// ---------------------------------------------------------------------------
let inflight = null;
let timer = null;

export function freshToken(force = false) {
  const ses = current();
  if (!ses) return Promise.reject(sessionExpired());
  if (!force && ses.expires_at - nowSec() > MARGIN) return Promise.resolve(ses.access_token);
  if (inflight) return inflight;

  const run = async () => {
    const latest = current();
    if (!latest) throw sessionExpired();
    const rotatedElsewhere = latest.refresh_token !== ses.refresh_token;
    if ((rotatedElsewhere || !force) && latest.expires_at - nowSec() > MARGIN) return latest.access_token;
    const r = await http("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: latest.refresh_token } });
    if (r.ok) {
      const next = toSession(r.json, latest.remember);
      persist(next);
      lastSeen = true;
      schedule();
      return next.access_token;
    }
    if (r.status === 429 || r.status >= 500) {
      throw new ApiError("auth_unavailable", "Kirish xizmati hozir javob bermayapti. Birozdan so'ng qayta urinib ko'ring.", r.status);
    }
    if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(authMsg(r.json))) throw new ApiError("key_rejected", KEY_MSG, r.status);
    // Yangilash tokeni yaroqsiz: seans tugagan, yopilgan yoki hisob bloklangan
    const blocked = authCode(r.json) === "user_banned";
    throw blocked ? new ApiError("blocked", "Bu hisob bloklangan. Administrator bilan bog'laning.", r.status) : sessionExpired();
  };
  const withLock = (fn) => (navigator.locks && navigator.locks.request ? navigator.locks.request("ox-refresh-v1", fn) : fn());
  inflight = withLock(run).finally(() => {
    inflight = null;
  });
  return inflight;
}

function schedule() {
  clearTimeout(timer);
  const ses = current();
  if (!ses) return;
  const ms = Math.min(2 ** 31 - 1, Math.max(0, (ses.expires_at - nowSec() - MARGIN + 5) * 1000));
  timer = setTimeout(async () => {
    try {
      await freshToken();
    } catch (e) {
      if (e instanceof ApiError && (e.code === "session_expired" || e.code === "blocked")) {
        endSession(e.code === "blocked" ? "blocked" : "expired");
        return;
      }
      // vaqtinchalik xato (tarmoq): yaqinroq qayta urinamiz
      clearTimeout(timer);
      timer = setTimeout(schedule, 30000);
      return;
    }
    schedule();
  }, ms);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !hasSession()) return;
  freshToken()
    .then(schedule)
    .catch((e) => {
      if (e instanceof ApiError && e.code === "session_expired") endSession("expired");
      else if (e instanceof ApiError && e.code === "blocked") endSession("blocked");
    });
});

export function startSession() {
  lastSeen = hasSession();
  schedule();
}

// ---------------------------------------------------------------------------
// ox-api funksiyasini chaqirish
// ---------------------------------------------------------------------------
// Ekranni butunlay almashtiradigan xatolar (seans tugagan, bloklangan...) bir joyda qayta ishlanadi.
function escalate(e) {
  if (!(e instanceof ApiError)) return e;
  switch (e.code) {
    case "invalid_token":
    case "no_token":
    case "session_expired": {
      endSession("expired");
      const x = sessionExpired();
      x.fatal = true;
      return x;
    }
    case "blocked":
    case "no_account":
      endSession(e.code);
      e.fatal = true;
      return e;
    case "password_change_required":
      e.fatal = true;
      emit({ type: "must_change_password" });
      return e;
    case "mfa_required":
    case "mfa_enrollment_required":
      e.fatal = true;
      emit({ type: e.code });
      return e;
    default:
      return e;
  }
}

function gatewayError(status, j) {
  const m = j && typeof j === "object" ? String(j.message || j.msg || "") : "";
  if ((status === 401 || status === 403) && /api key|apikey/i.test(m)) return new ApiError("key_rejected", KEY_MSG, status);
  if (status === 401 || status === 403) {
    return new ApiError(
      "gateway_rejected",
      "Supabase funksiyaga ruxsat bermadi (" + status + "). Supabase → Edge Functions → " + FN + " → Details bo'limida «Verify JWT» o'chirilganini tekshiring." + (m ? " (Javob: " + m.slice(0, 120) + ")" : ""),
      status,
    );
  }
  if (status === 404) {
    return new ApiError("function_missing", "«" + FN + "» funksiyasi Supabase'da topilmadi. Uni joylang (qo'llanma, 5-qadam) va nomi aynan shunday ekanini tekshiring.", 404);
  }
  if (status === 429) return new ApiError("rate_limited", "Juda ko'p so'rov. Birozdan so'ng qayta urinib ko'ring.", 429);
  if (status >= 500) return new ApiError("server_error", "Supabase funksiyasi javob bermadi (" + status + "). Birozdan so'ng qayta urinib ko'ring.", status);
  return new ApiError("bad_response", "Serverdan kutilmagan javob keldi (" + status + ").", status);
}

async function invoke(action, params, canRetry) {
  let token;
  try {
    token = await freshToken();
  } catch (e) {
    throw escalate(e);
  }
  const r = await http("/functions/v1/" + FN, { method: "POST", token, body: { ...params, action }, ms: 25000 });
  const j = r.json;
  if (j && typeof j === "object" && typeof j.ok === "boolean") {
    if (j.ok) return j.data;
    const er = j.error && typeof j.error === "object" ? j.error : {};
    const e = new ApiError(String(er.code || "error"), String(er.message || "Xatolik yuz berdi."), r.status);
    const wait = Number(er.retry_after);
    if (Number.isFinite(wait) && wait > 0) e.retryAfter = Math.min(Math.ceil(wait), 3600);
    // Sayt yangi, funksiya hali eski versiyada: amal nomini tanimaydi
    if (e.code === "unknown_action") e.message = OLD_FN_MSG;
    if (e.code === "invalid_token" && canRetry) {
      // Token muddati yaqinda tugagan bo'lishi mumkin: bir marta yangilab qayta urinamiz
      try {
        await freshToken(true);
      } catch (e2) {
        throw escalate(e2);
      }
      return invoke(action, params, false);
    }
    throw escalate(e);
  }
  throw escalate(gatewayError(r.status, j));
}

export const call = (action, params = {}) => invoke(action, params, true);

// Funksiya joylanganmi va sozlanganmi — tashxis uchun (kirish talab qilinmaydi)
export async function ping() {
  try {
    const r = await http("/functions/v1/" + FN, { method: "GET", ms: 8000 });
    const d = r.json && r.json.data;
    if (r.ok && d && d.service === "ox-api") return { state: d.configured ? "ready" : "unconfigured", version: String(d.version || "") };
    if (r.status === 404) return { state: "missing" };
    if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(authMsg(r.json))) return { state: "key" };
    if (r.status === 401 || r.status === 403) return { state: "gateway" };
    return { state: "unknown", status: r.status };
  } catch {
    return { state: "offline" };
  }
}

// ---------------------------------------------------------------------------
// Ikki bosqichli tasdiq (TOTP): qurilmani ulash, kodni tasdiqlash, qurilmani olib tashlash.
// Brauzer bu amallar uchun Supabase Auth bilan to'g'ridan-to'g'ri gaplashadi: Authenticator kodi funksiyaga ham, bazaga ham bormaydi.
// Kod tasdiqlansa, Auth yangi (aal2) tokenlar beradi — ular darhol joriy seans o'rnida saqlanadi.
// ---------------------------------------------------------------------------
const ISSUER = "OrbicXs";
const SESSION_CODES = new Set(["bad_jwt", "session_not_found", "session_expired", "user_not_found", "no_authorization", "refresh_token_not_found"]);

function mfaError(r) {
  const code = authCode(r.json);
  const msg = authMsg(r.json);
  if (r.status === 429 || code === "over_request_rate_limit") {
    return new ApiError("rate_limited", "Juda ko'p urinish. Bir necha daqiqadan so'ng qayta urinib ko'ring.", 429);
  }
  if (code === "mfa_verification_failed" || code === "mfa_verification_rejected" || /invalid totp/i.test(msg)) {
    return new ApiError("bad_code", "Kod noto'g'ri yoki eskirgan. Ilovadagi hozirgi kodni kiriting. Kod ketma-ket o'tmasa, telefoningizdagi soat avtomatik sozlanganini tekshiring.", 400);
  }
  if (code === "mfa_challenge_expired" || /challenge .*expired/i.test(msg)) {
    return new ApiError("code_expired", "Tasdiqlash so'rovining muddati tugadi. Qayta urinib ko'ring.", r.status);
  }
  if (code === "mfa_totp_enroll_not_enabled" || code === "mfa_totp_verify_not_enabled" || /totp.*(disabled|not enabled)/i.test(msg)) {
    return new ApiError("mfa_disabled", "Supabase loyihangizda Authenticator (TOTP) yoqilmagan. Supabase panelidagi Authentication bo'limida Multi-Factor sozlamasini oching va TOTP ni yoqing (qo'llanma, 8-qadam).", r.status);
  }
  if (code === "insufficient_aal" || /aal2 required/i.test(msg)) {
    return new ApiError("aal2_required", "Bu amal uchun avval Authenticator kodi tasdiqlangan bo'lishi kerak. Chiqib, qayta kiring va kodni kiriting.", r.status);
  }
  if (code === "too_many_enrolled_mfa_factors" || /maximum number of/i.test(msg)) {
    return new ApiError("too_many_factors", "Qurilmalar soni chegaraga yetdi. Keraksiz qurilmani olib tashlang.", r.status);
  }
  if (code === "mfa_factor_name_conflict" || /friendly name/i.test(msg)) {
    return new ApiError("name_conflict", "Qurilma nomi band.", r.status);
  }
  if (code === "mfa_factor_not_found" || (r.status === 404 && /factor/i.test(msg))) {
    return new ApiError("factor_missing", "Qurilma topilmadi: u olib tashlangan yoki muddati tugagan.", 404);
  }
  if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(msg)) return new ApiError("key_rejected", KEY_MSG, r.status);
  if (code === "user_banned") return new ApiError("blocked", "Bu hisob bloklangan. Administrator bilan bog'laning.", r.status);
  if ((r.status === 401 || r.status === 403) && (SESSION_CODES.has(code) || !code)) return sessionExpired();
  if (r.status >= 500) return new ApiError("auth_unavailable", "Kirish xizmati hozir javob bermayapti. Birozdan so'ng qayta urinib ko'ring.", r.status);
  return new ApiError("auth_error", "Ikki bosqichli tasdiq amalini bajarib bo'lmadi (xato " + r.status + "). Birozdan so'ng qayta urinib ko'ring.", r.status);
}

// Foydalanuvchi tokeni bilan Auth'ga so'rov; token muddati yaqinda tugagan bo'lsa, bir marta yangilab qaytariladi
async function authed(path, { method = "GET", body, ms = 15000 } = {}) {
  let token;
  try {
    token = await freshToken();
  } catch (e) {
    throw escalate(e);
  }
  let r = await http(path, { method, token, body, ms });
  if (r.status === 401 && authCode(r.json) !== "insufficient_aal") {
    try {
      token = await freshToken(true);
    } catch (e) {
      throw escalate(e);
    }
    r = await http(path, { method, token, body, ms });
  }
  return r;
}

// Auth qaytargan QR rasmni <img> uchun xavfsiz «data:» manziliga aylantiradi. Auth uni ikki xil ko'rinishda berishi mumkin:
// oddiy SVG matni yoki «data:image/svg+xml;utf-8,<svg…>» (ichida «#» belgisi bo'lsa, shu ko'rinishda rasm ochilmaydi, shuning uchun qayta kodlanadi).
// Tanish bo'lmagan yoki shubhali tarkib (skript, havola, tashqi manba) bo'lsa — null: o'rniga kalit qo'lda kiritiladi.
function qrImageSrc(raw) {
  let s = typeof raw === "string" ? raw.trim() : "";
  if (!s || s.length > 100000) return null;
  if (/^data:/i.test(s)) {
    const i = s.indexOf(",");
    if (i < 0) return null;
    const head = s.slice(0, i);
    s = s.slice(i + 1);
    try {
      if (/;base64/i.test(head)) s = atob(s);
      else if (/^\s*%3c/i.test(s)) s = decodeURIComponent(s);
    } catch {
      return null;
    }
  }
  s = s.replace(/^(?:\s|<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!doctype[^>]*>)+/i, "");
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>\s*$/i.test(s)) return null;
  if (/<(?:script|foreignObject|iframe|image|use|a|style|link|embed|object|animate|set)\b|\bon[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=|@import|url\s*\(/i.test(s)) return null;
  // viewBox bo'lmasa, rasm CSS orqali kichraytirilganda siqilmaydi, kesilib qoladi: uni o'lchamlardan hosil qilamiz
  const root = (/^<svg\b[^>]*>/i.exec(s) || [""])[0];
  if (!/\bviewBox\s*=/i.test(root)) {
    const w = /\bwidth\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(root);
    const hh = /\bheight\s*=\s*["']?(\d+(?:\.\d+)?)/i.exec(root);
    if (w && hh) s = s.replace(/^<svg\b/i, '<svg viewBox="0 0 ' + w[1] + " " + hh[1] + '"');
  }
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
}

const p2 = (n) => String(n).padStart(2, "0");
const deviceStamp = () => {
  const d = new Date();
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
};

// Yangi Authenticator qurilmasini boshlaydi: {id, name, secret, uri, qr}. Qurilma kod tasdiqlangunga qadar «tugallanmagan» turadi.
export async function mfaEnroll() {
  // Oldingi tugallanmagan urinishlarni tozalaymiz: ular nom to'qnashuviga va qurilmalar soni chegarasiga sabab bo'ladi
  const u = await authed("/auth/v1/user");
  if (u.ok && u.json && Array.isArray(u.json.factors)) {
    for (const f of u.json.factors) {
      if (f && f.status !== "verified" && typeof f.id === "string" && UUID_RE.test(f.id)) {
        try {
          await authed("/auth/v1/factors/" + f.id, { method: "DELETE" });
        } catch {
          /* tozalab bo'lmasa, davom etamiz */
        }
      }
    }
  }
  const base = "Authenticator " + deviceStamp();
  let name = base;
  for (let i = 0; i < 3; i++) {
    const r = await authed("/auth/v1/factors", { method: "POST", body: { factor_type: "totp", friendly_name: name, issuer: ISSUER } });
    if (r.ok) {
      const j = r.json && typeof r.json === "object" ? r.json : {};
      const t = j.totp && typeof j.totp === "object" ? j.totp : {};
      if (typeof j.id !== "string" || !UUID_RE.test(j.id) || typeof t.secret !== "string" || !/^[A-Za-z2-7=]{8,128}$/.test(t.secret)) {
        throw new ApiError("auth_error", "Kirish xizmati kutilmagan javob qaytardi. Birozdan so'ng qayta urinib ko'ring.", 0);
      }
      return { id: j.id.toLowerCase(), name: typeof j.friendly_name === "string" ? j.friendly_name : name, secret: t.secret, uri: typeof t.uri === "string" ? t.uri : "", qr: qrImageSrc(t.qr_code) };
    }
    const err = mfaError(r);
    if (err.code === "name_conflict" && i < 2) {
      name = base + " #" + Math.random().toString(36).slice(2, 5);
      continue;
    }
    throw escalate(err);
  }
  throw new ApiError("name_conflict", "Qurilma nomi band. Qayta urinib ko'ring.", 422);
}

// Authenticator kodini tasdiqlaydi (ham yangi qurilmani yakunlash, ham keyingi kirishlar uchun). Muvaffaqiyatda seans aal2 ga ko'tariladi.
export async function mfaVerify(factorId, code) {
  const c = String(code || "").replace(/\s+/g, "");
  if (typeof factorId !== "string" || !UUID_RE.test(factorId)) throw new ApiError("factor_missing", "Qurilma topilmadi. Sahifani yangilab, qayta urinib ko'ring.", 404);
  if (!/^[0-9]{6}$/.test(c)) throw new ApiError("bad_code", "Kod 6 ta raqamdan iborat bo'lsin.", 400);
  for (let attempt = 0; attempt < 2; attempt++) {
    const ch = await authed("/auth/v1/factors/" + factorId + "/challenge", { method: "POST", body: {} });
    if (!ch.ok) throw escalate(mfaError(ch));
    const cid = ch.json && typeof ch.json.id === "string" ? ch.json.id : "";
    if (!UUID_RE.test(cid)) throw new ApiError("auth_error", "Kirish xizmati kutilmagan javob qaytardi. Birozdan so'ng qayta urinib ko'ring.", 0);
    const v = await authed("/auth/v1/factors/" + factorId + "/verify", { method: "POST", body: { challenge_id: cid, code: c } });
    if (v.ok) {
      const prev = current();
      persist(toSession(v.json, prev ? prev.remember : false));
      lastSeen = true;
      schedule();
      return;
    }
    const err = mfaError(v);
    if (err.code === "code_expired" && attempt === 0) continue; // so'rov muddati o'tib ketgan: yangisini ochib, bir marta qayta uriniladi
    throw escalate(err);
  }
  throw new ApiError("code_expired", "Tasdiqlash so'rovining muddati tugadi. Qayta urinib ko'ring.", 422);
}

// Qurilmani olib tashlaydi. Tasdiqlangan qurilma uchun seans aal2 bo'lishi kerak (Auth talabi).
export async function mfaUnenroll(factorId) {
  if (typeof factorId !== "string" || !UUID_RE.test(factorId)) throw new ApiError("factor_missing", "Qurilma topilmadi. Sahifani yangilab, qayta urinib ko'ring.", 404);
  const r = await authed("/auth/v1/factors/" + factorId, { method: "DELETE" });
  if (r.ok) return;
  const err = mfaError(r);
  if (err.code === "factor_missing") return; // allaqachon yo'q — maqsadga erishilgan
  throw escalate(err);
}

// Tugallanmagan (kod kiritilmagan) qurilmani tashlab yuboradi. Xatolar e'tiborga olinmaydi va ekranni o'zgartirmaydi.
export async function mfaDiscard(factorId) {
  try {
    if (typeof factorId !== "string" || !UUID_RE.test(factorId)) return;
    const ses = current();
    if (!ses) return;
    const token = ses.expires_at - nowSec() > 5 ? ses.access_token : await freshToken();
    await http("/auth/v1/factors/" + factorId, { method: "DELETE", token, ms: 8000 });
  } catch {
    /* tugallanmagan qurilma baribir bir necha daqiqada o'zi o'chadi */
  }
}

// ---------------------------------------------------------------------------
// O'z profilini o'zgartirish: ruxsat qoidalari (RLS) bazaning o'zida — faqat ism va tavsif, faqat o'z qatori
// ---------------------------------------------------------------------------
function restError(r) {
  const code = String((r.json && r.json.code) || "");
  if (code === "23514") return new ApiError("invalid_value", "Ism yoki tavsifda ruxsat etilmagan belgilar bor yoki uzunligi chegaradan oshgan.", r.status);
  if (r.status === 404 || code === "42P01" || /^PGRST20[25]$/.test(code)) {
    return new ApiError("setup_incomplete", "Platforma jadvallari topilmadi. Supabase → SQL Editor'da 1-asos.sql to'liq bajarilganini tekshiring.", r.status);
  }
  if (r.status === 401 || r.status === 403 || code === "42501") return new ApiError("forbidden", "Bu amalga ruxsat yo'q.", r.status);
  return new ApiError("db_error", "Saqlab bo'lmadi (xato " + r.status + "). Birozdan so'ng qayta urinib ko'ring.", r.status);
}

export async function updateProfile(patch) {
  const user = sessionUser();
  if (!user || !UUID_RE.test(user.id)) throw escalate(sessionExpired());
  const send = (token) =>
    http("/rest/v1/ox_accounts?select=id,display_name,bio,updated_at&id=eq." + user.id, {
      method: "PATCH",
      token,
      headers: { prefer: "return=representation" },
      body: patch,
    });
  let token;
  try {
    token = await freshToken();
  } catch (e) {
    throw escalate(e);
  }
  let r = await send(token);
  if (r.status === 401) {
    try {
      token = await freshToken(true);
    } catch (e) {
      throw escalate(e);
    }
    r = await send(token);
  }
  if (r.ok && Array.isArray(r.json)) {
    if (!r.json.length) throw new ApiError("profile_denied", "Profilni saqlab bo'lmadi: hisob faol emas yoki ruxsat yo'q.", 403);
    return r.json[0];
  }
  throw restError(r);
}

// ---------------------------------------------------------------------------
// Xabarlar (messenjer): bazadagi funksiyalar (PostgREST RPC) va fayl ombori (Storage).
// Hammasi foydalanuvchining o'z tokeni bilan ketadi; kim nimani ko'rishi bazadagi qoidalar (4-messenjer.sql) bilan belgilanadi.
// Brauzer jadvallarga to'g'ridan-to'g'ri yozmaydi: faqat ox_chat_* funksiyalari va ox-chat ombori.
// ---------------------------------------------------------------------------
const CHAT_MISSING_MSG = "Messenjer bazada o'rnatilmagan. Supabase → SQL Editor'da 4-messenjer.sql faylini to'liq bajaring (qo'llanma, «Messenjer» bo'limi).";
const BUCKET = "ox-chat";
const FILE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$/;
export const isChatPath = (p) => typeof p === "string" && FILE_PATH_RE.test(p);

// Baza xatosi (PostgREST): bizning funksiyalar xatosi «PTnnn» kodi va hint (xato nomi) bilan keladi, xabar o'zbekcha.
function rpcError(r) {
  const j = r.json && typeof r.json === "object" ? r.json : {};
  const code = typeof j.code === "string" ? j.code : "";
  const hint = typeof j.hint === "string" ? j.hint : "";
  const msg = typeof j.message === "string" ? j.message : "";
  if (/^PT[0-9]{3}$/.test(code) && /^[a-z_]{3,40}$/.test(hint)) {
    const e = new ApiError(hint, msg || "Amalni bajarib bo'lmadi.", r.status);
    if (hint === "rate_limited") {
      const wait = Number(j.details);
      e.retryAfter = Number.isFinite(wait) && wait > 0 ? Math.min(Math.ceil(wait), 3600) : 30;
    }
    return e;
  }
  // Funksiya bazada yo'q: PostgREST 404 + PGRST202 («schema cache» da topilmadi) beradi; eski versiyalar yoki eskirgan kesh holatida
  // 404 + 42883 («function … does not exist»). Ikkalasi ham bir xil ma'noni bildiradi: 4-messenjer.sql bajarilmagan (yoki to'liq emas).
  if (code === "PGRST202" || (r.status === 404 && (code === "42883" || /schema cache|function .* does not exist/i.test(msg)))) {
    return new ApiError("chat_missing", CHAT_MISSING_MSG, 404);
  }
  if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(msg)) return new ApiError("key_rejected", KEY_MSG, r.status);
  if (r.status === 401) return sessionExpired();
  if (r.status === 429) {
    const e = new ApiError("rate_limited", "Juda ko'p so'rov. Birozdan so'ng qayta urinib ko'ring.", 429);
    e.retryAfter = 30;
    return e;
  }
  if (r.status === 403 || code === "42501") return new ApiError("forbidden", "Bu amalga ruxsat yo'q.", r.status);
  if (r.status >= 500) return new ApiError("server_error", "Server javob bermadi (" + r.status + "). Birozdan so'ng qayta urinib ko'ring.", r.status);
  return new ApiError("db_error", "So'rovni bajarib bo'lmadi (xato " + r.status + ").", r.status);
}

/** Xabarlar funksiyasini chaqiradi (masalan, rpc("ox_chat_list")). Muvaffaqiyatda JSON javobni qaytaradi. */
export async function rpc(fn, args = {}, { ms = 20000 } = {}) {
  if (typeof fn !== "string" || !/^ox_chat_[a-z_]{2,40}$/.test(fn)) throw new ApiError("bad_call", "Noto'g'ri chaqiruv.", 0);
  let token;
  try {
    token = await freshToken();
  } catch (e) {
    throw escalate(e);
  }
  let r = await http("/rest/v1/rpc/" + fn, { method: "POST", token, body: args, ms });
  if (r.status === 401) {
    // Token muddati yaqinda tugagan bo'lishi mumkin: bir marta yangilab qayta urinamiz
    try {
      token = await freshToken(true);
    } catch (e) {
      throw escalate(e);
    }
    r = await http("/rest/v1/rpc/" + fn, { method: "POST", token, body: args, ms });
  }
  if (r.ok) return r.json;
  throw escalate(rpcError(r));
}

// Ikkilik (rasm/fayl) so'rovlari uchun: tanasi Blob bo'lishi, javobi Blob qaytishi mumkin
async function httpBin(path, { method = "GET", body, token, headers = {}, ms = 30000, wantBlob = false } = {}) {
  if (cfgOk === null) cfgOk = configProblem() === null;
  if (!cfgOk) throw new ApiError("bad_config", "Sayt sozlanmagan: config.js ni tekshiring.", 0);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const hd = { apikey: KEY_, ...headers };
    if (token) hd.authorization = "Bearer " + token;
    const res = await fetch(URL_ + path, { method, headers: hd, body, signal: ctl.signal, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    if (res.ok && wantBlob) return { ok: true, status: res.status, json: null, blob: await res.blob() };
    let json = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, blob: null };
  } catch {
    throw new ApiError("network", NET_MSG, 0);
  } finally {
    clearTimeout(timer);
  }
}

// Ombor xatosi: {statusCode, error, message}. Ba'zi versiyalar rad etishni HTTP 400 + statusCode 403 bilan beradi, shuning uchun ikkalasiga qaraladi.
function storageError(r, what) {
  const j = r.json && typeof r.json === "object" ? r.json : {};
  const sc = Number(j.statusCode) || r.status;
  const text = String(j.error || "") + " " + String(j.message || "") + " " + String(j.msg || "");
  if (r.status === 413 || sc === 413) return new ApiError("too_large", "Fayl hajmi 10 MB dan oshmasligi kerak.", 413);
  if (r.status === 415 || sc === 415 || /invalid_mime_type|mime type/i.test(text)) return new ApiError("bad_type", "Bu turdagi faylni yuborib bo'lmaydi.", 415);
  if ((r.status === 401 || r.status === 403) && /api key|apikey/i.test(text)) return new ApiError("key_rejected", KEY_MSG, r.status);
  if (/bucket not found/i.test(text)) return new ApiError("chat_missing", CHAT_MISSING_MSG, 404);
  if (r.status === 429 || sc === 429) {
    const e = new ApiError("rate_limited", "Juda ko'p so'rov. Birozdan so'ng qayta urinib ko'ring.", 429);
    e.retryAfter = 30;
    return e;
  }
  if (r.status === 404 || sc === 404 || /not.?found/i.test(text)) return new ApiError("file_missing", "Fayl topilmadi: u o'chirilgan bo'lishi mumkin.", 404);
  if (r.status === 401 || r.status === 403 || sc === 401 || sc === 403 || /row-level security|unauthorized|not allowed/i.test(text)) {
    return new ApiError(what === "upload" ? "upload_denied" : "file_denied", what === "upload" ? "Fayl yuklashga ruxsat yo'q. Administrator «Media» ruxsatini olib qo'ygan bo'lishi mumkin." : "Bu faylni ko'rishga ruxsat yo'q.", r.status);
  }
  if (r.status >= 500) return new ApiError("server_error", "Fayl ombori javob bermadi (" + r.status + "). Birozdan so'ng qayta urinib ko'ring.", r.status);
  return new ApiError("storage_error", "Fayl bilan amalni bajarib bo'lmadi (xato " + r.status + ").", r.status);
}

const staleJwt = (r) => r.status === 401 || (r.json && typeof r.json === "object" && /InvalidJWT|exp.*claim|jwt expired/i.test(String(r.json.error || "") + String(r.json.message || "")));

async function storage(method, path, { body, mime, ms, wantBlob, what } = {}) {
  if (!isChatPath(path)) throw new ApiError("bad_path", "Fayl manzili noto'g'ri.", 0);
  let token;
  try {
    token = await freshToken();
  } catch (e) {
    throw escalate(e);
  }
  // Manzil faqat [0-9a-f-/.] belgilaridan iborat (yuqorida tekshirildi), shuning uchun qo'shimcha kodlash kerak emas
  const url = "/storage/v1/object/" + (method === "GET" ? "authenticated/" : "") + BUCKET + "/" + path;
  const go = (t) => httpBin(url, { method, body, token: t, headers: method === "POST" ? { "content-type": mime } : {}, ms, wantBlob });
  let r = await go(token);
  if (!r.ok && staleJwt(r)) {
    try {
      token = await freshToken(true);
    } catch (e) {
      throw escalate(e);
    }
    r = await go(token);
  }
  if (r.ok) return r;
  throw escalate(storageError(r, what));
}

/** Faylni «ox-chat» omboriga yuklaydi. path — «<suhbat>/<uuid>.<kengaytma>»; mime — ruxsat etilgan tur. */
export async function fileUpload(path, blob, mime) {
  await storage("POST", path, { body: blob, mime, ms: 120000, what: "upload" });
}
/** Faylni yuklab olib, Blob qaytaradi. */
export async function fileDownload(path) {
  const r = await storage("GET", path, { wantBlob: true, ms: 120000, what: "download" });
  return r.blob;
}
/** Faylni ombordan o'chiradi. Fayl allaqachon yo'q bo'lsa ham xato bermaydi. */
export async function fileRemove(path) {
  try {
    await storage("DELETE", path, { ms: 20000, what: "remove" });
  } catch (e) {
    if (e instanceof ApiError && e.code === "file_missing") return;
    throw e;
  }
}

export const loginDomain = DOMAIN;
