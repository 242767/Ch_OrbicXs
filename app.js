// OrbicXs platformasi — asosiy modul: ekranlar (kirish, 2FA kodi, parol almashtirish, ilova) va yo'naltirish (#/users, #/audit, #/cabinet).
import * as api from "./js/api.js";
import { h, icon } from "./js/dom.js";
import { toast } from "./js/ui.js";
import { avatar, warningTexts } from "./js/parts.js";
import { loginView } from "./js/views/login.js";
import { forceView } from "./js/views/force.js";
import { mfaEnrollView, mfaVerifyView } from "./js/views/mfa.js";
import { diagnosisBox, noticeView } from "./js/views/notice.js";
import { CABINET_SECTIONS, cabinetView } from "./js/views/cabinet.js";
import { usersView } from "./js/views/users.js";
import { auditView } from "./js/views/audit.js";
import { chatView } from "./js/views/chat.js";
import { createUnreadWatcher } from "./js/chatwatch.js";
import * as push from "./js/push.js";

const root = document.getElementById("root");
const BRAND = "OrbicXs";

const noMfa = () => ({ state: "off", required: false, factors: [], maxAgeHours: 0, verifiedAt: null });

const S = {
  screen: "boot", // boot | config | login | mfa | force | app | notice
  account: null,
  aal: null,
  mfa: noMfa(), // serverdagi 2FA holati: off | ok | verify | enroll (faqat administratorlar uchun «off» dan boshqa)
  route: null,
  token: 0, // har bir yo'nalish uchun yangi qiymat: eskirgan ekran yangi ekranni buzmasin
  shell: null,
  view: null, // ochiq bo'lim (yo'naltirish natijasi): {el, title, dispose?, route?}
  watch: null, // o'qilmagan xabarlar hisoblagichi (faqat «messenger» ruxsati bor hisoblar uchun)
  unread: 0,
  title: "",
  entering: false,
  cleanup: null, // joriy ekran almashtirilganda bajariladigan tozalash (masalan, tugallanmagan 2FA qurilmasini tashlab yuborish)
};

// perm — shu ruxsat bo'lmasa, bo'lim menyuda ko'rinmaydi va manzil bo'yicha ham ochilmaydi
const ROUTES = {
  cabinet: { admin: false, make: cabinetView },
  chat: { admin: false, perm: "messenger", make: chatView },
  users: { admin: true, make: usersView },
  audit: { admin: true, make: auditView },
};

const hasPerm = (p) => !!S.account && Array.isArray(S.account.permissions) && S.account.permissions.includes(p);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAB_KEYS = new Set(CABINET_SECTIONS.map((s) => s.key));

function runCleanup() {
  const fn = S.cleanup;
  S.cleanup = null;
  if (!fn) return;
  try {
    fn();
  } catch {
    /* tozalash xatosi ekranni to'xtatmasin */
  }
}

function mount(screen, node, title, cleanup = null) {
  runCleanup();
  S.cleanup = cleanup;
  S.screen = screen;
  root.replaceChildren(node);
  document.title = title ? title + " — " + BRAND : BRAND;
  window.scrollTo(0, 0);
}

function showBoot() {
  mount("boot", h("div", { class: "boot", role: "status" }, h("div", { class: "boot__ring" }), h("span", { class: "boot__load" }, "Yuklanmoqda…")));
}

function showLogin(flash) {
  S.account = null;
  S.shell = null;
  S.mfa = noMfa();
  mount("login", loginView({ flash, onDone: enter }), "Kirish");
}

const toLogin = () => showLogin(null);

function showBlocked() {
  S.account = null;
  mount(
    "notice",
    noticeView({
      title: "Hisob bloklangan",
      text: "Bu hisob administrator tomonidan bloklangan. Qayta ochish uchun administratorga murojaat qiling.",
      tone: "bad",
      actions: [{ text: "Kirish oynasiga qaytish", primary: true, onclick: toLogin }],
    }),
    "Hisob bloklangan",
  );
}

function showNoAccount() {
  S.account = null;
  mount(
    "notice",
    noticeView({
      title: "Kirish ruxsati yo'q",
      text: "Login va parol to'g'ri, lekin bu hisob platformaga qo'shilmagan. Administratorga murojaat qiling.",
      tone: "bad",
      actions: [{ text: "Kirish oynasiga qaytish", primary: true, onclick: toLogin }],
    }),
    "Kirish ruxsati yo'q",
  );
}

const TRANSIENT = new Set(["network", "auth_unavailable", "server_error", "upstream_unreachable", "rate_limited"]);

// Hisobni tekshirib bo'lmadi (tarmoq yoki server sozlamasi): seans saqlanadi, «Qayta urinish» beriladi
function showProblem(e) {
  const transient = TRANSIENT.has(e.code);
  mount(
    "notice",
    noticeView({
      title: transient ? "Aloqa o'rnatilmadi" : "Server hali to'liq sozlanmagan",
      text: e.message || "Kutilmagan xatolik yuz berdi.",
      tone: "warn",
      extra: transient ? null : diagnosisBox(api.ping),
      actions: [
        { text: "Qayta urinish", primary: true, onclick: () => enter() },
        { text: "Chiqish", onclick: signOutLocal },
      ],
    }),
    "Xatolik",
  );
}

// ---------------------------------------------------------------------------
// Kirgandan keyingi yo'l: «me» javobiga qarab ekran tanlanadi.
// Tartib: 2FA kodi → majburiy parol almashtirish → 2FA qurilmasini ulash → ilova.
// (Kod parolni almashtirishdan oldin so'raladi: server parol almashtirishni ham 2FA ga bog'laydi. Qurilma hali ulanmagan
// administrator esa avval vaqtinchalik parolini almashtiradi, keyin qurilmani ulaydi.)
// ---------------------------------------------------------------------------
const MFA_STATES = new Set(["off", "ok", "verify", "enroll"]);

function readMfa(m) {
  if (!m || typeof m !== "object") return noMfa();
  const max = Number(m.max_age_hours);
  return {
    state: MFA_STATES.has(m.state) ? m.state : "off",
    required: m.required === true,
    factors: (Array.isArray(m.factors) ? m.factors : [])
      .filter((f) => f && typeof f.id === "string")
      .map((f) => ({ id: f.id, name: typeof f.friendly_name === "string" ? f.friendly_name : "", verified: f.status === "verified", createdAt: typeof f.created_at === "string" ? f.created_at : null })),
    maxAgeHours: Number.isFinite(max) ? max : 0,
    verifiedAt: typeof m.verified_at === "string" ? m.verified_at : null,
  };
}

function applyMe(data) {
  S.aal = data.aal ?? null;
  S.mfa = readMfa(data.mfa);
  setAccount(data.account);
}

function gate() {
  if (S.mfa.state === "verify") return "verify";
  if (S.account.must_change_password) return "force";
  if (S.mfa.state === "enroll") return "enroll";
  return "app";
}

function showGate() {
  const g = gate();
  if (g === "verify") showMfaVerify();
  else if (g === "force") showForce();
  else if (g === "enroll") showMfaEnroll();
  else showApp();
}

// opts.afterMfa — shu zahoti kod tasdiqlandi/qurilma ulandi: server hamon tasdiq so'rasa, cheksiz aylanmaslik uchun qayta kiriladi
async function enter(opts) {
  if (S.entering) return;
  const afterMfa = !!(opts && opts.afterMfa === true);
  S.entering = true;
  showBoot();
  try {
    applyMe(await api.call("me"));
    const g = gate();
    if (afterMfa && (g === "verify" || g === "enroll")) {
      await api.signOut(false);
      showLogin({ kind: "warn", text: "Tasdiqlash seansga o'tmadi. Xavfsizlik uchun qayta kiring: avval parol, keyin Authenticator kodi." });
      return;
    }
    showGate();
  } catch (e) {
    if (e && e.fatal) return; // ekranni voqea qayta ishlovchisi almashtirgan
    showProblem(e instanceof api.ApiError ? e : new api.ApiError("internal", "Kutilmagan xatolik yuz berdi."));
  } finally {
    S.entering = false;
  }
}

function showMfaVerify() {
  const v = mfaVerifyView({
    account: S.account,
    factors: S.mfa.factors.filter((f) => f.verified),
    onVerified: () => enter({ afterMfa: true }),
    onSignOut: signOutLocal,
  });
  mount("mfa", v.el, "Tasdiqlash kodi");
  v.focus();
}

function showMfaEnroll() {
  const v = mfaEnrollView({ account: S.account, onEnrolled: () => enter({ afterMfa: true }), onSignOut: signOutLocal });
  mount("mfa", v.el, "Ikki bosqichli tasdiq", v.dispose);
  v.start();
}

function showForce() {
  const v = forceView({ account: S.account, onSaved: afterPasswordChange, onSignOut: signOutLocal });
  mount("force", v.el, "Yangi parol");
  v.focus();
}

// ---------------------------------------------------------------------------
// Chiqish va parol almashtirishdan keyingi harakatlar
// ---------------------------------------------------------------------------
async function signOutLocal() {
  runCleanup(); // tugallanmagan 2FA qurilmasi (bo'lsa) seans hali yaroqli paytda tashlab yuboriladi
  await api.signOut(false);
  showLogin(null);
}

async function signOutEverywhere() {
  const ok = await api.signOut(true);
  showLogin(
    ok
      ? { kind: "ok", text: "Barcha qurilmalardan chiqildi. Davom etish uchun qayta kiring." }
      : { kind: "warn", text: "Shu qurilmadan chiqildi, lekin boshqa qurilmalardagi seanslarni yopib bo'lmadi (aloqa xatosi). Qayta kirib, yana urinib ko'ring." },
  );
}

// Seanslar ro'yxatidan shu qurilmaning o'z seansi yopilganda (server uni allaqachon o'chirgan)
async function sessionClosedHere() {
  await api.signOut(false);
  showLogin({ kind: "warn", text: "Bu qurilmadagi seans yopildi. Davom etish uchun qayta kiring." });
}

async function afterPasswordChange(res) {
  for (const t of warningTexts(res && res.warnings)) toast("warn", t);
  if (res && res.relogin) {
    // Server bu seansni ham yopdi (token ichida seans raqami yo'q edi): yangi parol bilan qayta kiriladi
    await api.signOut(false);
    showLogin({ kind: "ok", text: "Parol almashtirildi. Yangi parol bilan qayta kiring." });
    return;
  }
  const forced = S.screen === "force";
  toast("ok", "Parol almashtirildi." + (res && res.sessions_revoked > 0 ? " Boshqa qurilmalardagi seanslar yopildi." : ""));
  if (forced) await enter();
  else if (S.account) S.account = { ...S.account, must_change_password: false };
}

// 2FA qurilmalari o'zgargach (qo'shildi/olib tashlandi): holat serverdan qayta o'qiladi.
// true — hamon ilovadamiz (ko'rinishni yangilash kerak); false — boshqa ekranga o'tildi (masalan, oxirgi qurilma olib tashlansa, yangisini ulash ekrani).
async function afterMfaChange() {
  try {
    applyMe(await api.call("me"));
  } catch (e) {
    if (e && e.fatal) return false;
    throw e;
  }
  if (gate() !== "app") {
    showGate();
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Ilova qobig'i va yo'naltirish
// ---------------------------------------------------------------------------
function setAccount(acc) {
  S.account = acc;
  if (S.shell) S.shell.paintChip();
}

function makeCtx(token) {
  return {
    get account() {
      return S.account;
    },
    get aal() {
      return S.aal;
    },
    get mfa() {
      return S.mfa;
    },
    alive: () => S.token === token && S.screen === "app",
    setAccount,
    signOutEverywhere,
    sessionClosedHere,
    afterPasswordChange,
    afterMfaChange,
  };
}

function buildShell() {
  const admin = S.account.role === "admin";
  const items = [{ route: "cabinet", label: "Kabinet", icon: "user" }];
  if (hasPerm("messenger")) items.push({ route: "chat", label: "Xabarlar", icon: "chat", badge: true });
  if (admin) items.push({ route: "users", label: "Foydalanuvchilar", icon: "users" }, { route: "audit", label: "Jurnal", icon: "log" });

  // badge — o'qilmagan xabarlar soni (0 bo'lsa yashirin); matni ekran o'qish dasturi uchun havolaning aria-label'iga yoziladi (paintBadge)
  const links = (tab) =>
    items.map((i) =>
      h(
        "a",
        { href: "#/" + i.route, dataset: { route: i.route } },
        icon(i.icon),
        tab ? h("span", null, i.label) : i.label,
        i.badge ? h("span", { class: "badge num", dataset: { badge: i.route }, hidden: true, "aria-hidden": "true" }) : null,
      ),
    );
  const brand = () => h("div", { class: "brand" }, h("img", { src: "icon-192.png", alt: "", width: 34, height: 34 }), BRAND);
  const chip = h("a", { class: "chip", href: "#/cabinet", "aria-label": "Kabinet" });
  const main = h("main", { class: "main", id: "main", tabindex: "-1" });

  const el = h(
    "div",
    { class: "app" },
    h(
      "aside",
      { class: "rail" },
      h("div", null, brand(), h("nav", { class: "nav", "aria-label": "Asosiy menyu" }, links(false))),
      h("div", { class: "rail__foot" }, chip, h("button", { class: "btn btn--quiet", type: "button", onclick: signOutLocal }, icon("logout"), "Chiqish")),
    ),
    h("header", { class: "topbar" }, brand(), h("button", { class: "iconbtn", type: "button", "aria-label": "Chiqish", title: "Chiqish", onclick: signOutLocal }, icon("logout"))),
    main,
    items.length > 1 ? h("nav", { class: "tabbar", "aria-label": "Asosiy menyu" }, links(true)) : null,
  );

  const paintChip = () => {
    const a = S.account;
    chip.replaceChildren(avatar(a, { size: "sm" }), h("span", { class: "chip__text" }, h("span", { class: "chip__name" }, a.display_name), h("span", { class: "chip__sub" }, "@" + a.login)));
  };
  paintChip();
  return { el, main, paintChip };
}

// Sahifa sarlavhasi: o'qilmagan xabarlar bo'lsa, boshida «(3)» ko'rinadi
function paintTitle() {
  if (S.screen !== "app") return;
  document.title = (S.unread > 0 ? "(" + (S.unread > 99 ? "99+" : S.unread) + ") " : "") + (S.title ? S.title + " — " : "") + BRAND;
}

function setTitle(t) {
  S.title = t || "";
  paintTitle();
}

// Menyudagi nishon (rail va pastki panel) va sahifa sarlavhasi
function paintBadge(n) {
  S.unread = n;
  push.appBadge(n); // o'rnatilgan ilova belgisidagi raqam (qo'llab-quvvatlanmasa, hech narsa qilmaydi)
  if (S.shell) {
    for (const b of S.shell.el.querySelectorAll("[data-badge]")) {
      b.textContent = n > 99 ? "99+" : String(n);
      b.hidden = n < 1;
    }
    for (const a of S.shell.el.querySelectorAll('a[data-route="chat"]')) {
      if (n > 0) a.setAttribute("aria-label", "Xabarlar, o'qilmagan: " + n);
      else a.removeAttribute("aria-label");
    }
  }
  paintTitle();
}

// Ilova qobig'i almashtirilganda yoki chiqilganda: ochiq bo'lim va hisoblagich to'xtatiladi (suhbat rasmlari ham xotiradan olib tashlanadi)
function teardownApp() {
  teardownView();
  push.stop();
  push.appBadge(0);
  if (S.watch) S.watch.destroy();
  S.watch = null;
  S.unread = 0;
  S.route = null;
}

// Xizmat ishchisidan: bildirishnoma bosildi (xabarlar ochiladi) yoki yangi turtki keldi (ro'yxat va hisoblagich darhol yangilanadi)
function openChatFromPush() {
  if (S.screen === "app" && hasPerm("messenger") && !/^#\/chat/.test(location.hash)) location.hash = "#/chat";
}

function pokeFromPush() {
  if (S.screen !== "app") return;
  if (S.watch) S.watch.poke();
  if (S.view && typeof S.view.poke === "function") S.view.poke();
}

function showApp() {
  S.shell = buildShell();
  mount("app", S.shell.el, null, teardownApp); // avvalgi qobiqning tozalashi shu yerda bajariladi — hisoblagich undan KEYIN yaratiladi
  S.watch = hasPerm("messenger") ? createUnreadWatcher(paintBadge) : null;
  if (S.watch) S.watch.start();
  push.start({ account: S.account, onOpenChat: openChatFromPush, onPoke: pokeFromPush });
  renderRoute();
}

// #/chat/<uuid> — suhbat; #/cabinet/<bo'lim> — kabinet bo'limi; qolganlari #/<bo'lim>
function parseHash() {
  const m = /^#\/([a-z]+)(?:\/([^/?#]*))?/.exec(location.hash);
  const name = m ? m[1] : "";
  const rest = m && m[2] ? m[2] : "";
  return {
    name,
    id: name === "chat" && UUID_RE.test(rest) ? rest : "",
    junk: name === "chat" && !!rest && !UUID_RE.test(rest),
    sub: name === "cabinet" && CAB_KEYS.has(rest) ? rest : "",
    junkSub: name === "cabinet" && !!rest && !CAB_KEYS.has(rest),
  };
}

function paintShell(name, id) {
  const { el, main } = S.shell;
  for (const a of el.querySelectorAll("[data-route]")) {
    if (a.dataset.route === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  // Xabarlar ekrani butun oynani egallaydi (ichida o'z aylantirishi bor); telefonda suhbat ochiq bo'lsa, yuqori va pastki panellar yashiriladi
  el.classList.toggle("app--chat", name === "chat");
  el.classList.toggle("app--convo", name === "chat" && !!id);
  main.classList.toggle("main--chat", name === "chat");
}

function renderRoute() {
  if (S.screen !== "app" || !S.shell) return;
  const isAdmin = S.account.role === "admin";
  const p = parseHash();
  let name = p.name;
  let id = p.id;
  const def = ROUTES[name];
  if (!def || (def.admin && !isAdmin) || (def.perm && !hasPerm(def.perm))) {
    name = isAdmin ? "users" : "cabinet";
    id = "";
    history.replaceState(null, "", "#/" + name);
  } else if (p.junk) {
    history.replaceState(null, "", "#/chat");
  } else if (p.junkSub) {
    history.replaceState(null, "", "#/cabinet");
  }
  // Ro'yxatdan suhbatga (yoki suhbatdan suhbatga) o'tganda bo'lim qayta qurilmaydi: faqat ochiq suhbat almashadi.
  // Kabinetda ham shunday: bo'limlar (#/cabinet/<bo'lim>) o'sha sahifaning o'zida almashadi.
  if ((name === "chat" || name === "cabinet") && S.route === name && S.view && typeof S.view.route === "function") {
    S.view.route(name === "chat" ? id : p.sub);
    paintShell(name, id);
    return;
  }
  teardownView();
  S.route = name;
  const view = ROUTES[name].make(makeCtx(++S.token), { id, sub: name === "cabinet" ? p.sub : "", watch: S.watch, setTitle });
  S.view = view;
  S.shell.main.replaceChildren(view.el);
  setTitle(view.title);
  paintShell(name, id);
  window.scrollTo(0, 0);
  S.shell.main.focus({ preventScroll: true });
}

// Bo'lim almashganda eski bo'lim tozalanadi (hisoblagich esa ilova bilan birga yashaydi)
function teardownView() {
  const v = S.view;
  S.view = null;
  if (v && typeof v.dispose === "function") {
    try {
      v.dispose();
    } catch {
      /* tozalash xatosi ekranni to'xtatmasin */
    }
  }
}

window.addEventListener("hashchange", renderRoute);

// ---------------------------------------------------------------------------
// Seans voqealari (boshqa oynada chiqish/kirish, seans tugashi, bloklanish, server 2FA talab qilishi)
// ---------------------------------------------------------------------------
api.onEvent((ev) => {
  if (ev.type === "signed_out") {
    if (S.screen === "login" || S.screen === "config") return;
    if (ev.reason === "blocked") showBlocked();
    else if (ev.reason === "no_account") showNoAccount();
    else if (ev.reason === "expired") showLogin({ kind: "warn", text: "Seans tugadi. Qayta kiring." });
    else showLogin(null);
  } else if (ev.type === "signed_in") {
    if (S.screen === "login") enter();
  } else if (ev.type === "must_change_password") {
    if (S.screen === "app") enter();
  } else if (ev.type === "mfa_required" || ev.type === "mfa_enrollment_required") {
    // Tasdiq muddati o'tib ketgan yoki qurilma o'chirilgan: holat qayta o'qiladi va tegishli ekran chiqadi
    if (S.screen === "app" || S.screen === "force") enter();
  }
});

function start() {
  const problem = api.configProblem();
  if (problem) {
    mount("config", noticeView({ title: problem.title, text: problem.text, tone: problem.code === "secret_key" ? "bad" : "warn" }), "Sozlash kerak");
    return;
  }
  api.startSession();
  if (api.hasSession()) enter();
  else showLogin(null);
}

start();
