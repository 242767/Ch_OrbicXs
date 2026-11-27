// Xavfsizlik jurnali (faqat administrator): kim, qachon, nima qilgani. Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi.
import { h, icon, fmtDate, debounce } from "../dom.js";
import * as api from "../api.js";
import { errorText, toast } from "../ui.js";
import { EVENTS, PERM, ROLE } from "../parts.js";

const roleName = (r) => ROLE[r] || String(r);
const permList = (v) => (Array.isArray(v) && v.length ? v.map((p) => PERM[p] || String(p)).join(", ") : "yo'q");

function changeText(key, c) {
  const from = c && typeof c === "object" ? c.from : undefined;
  const to = c && typeof c === "object" ? c.to : undefined;
  if (key === "display_name") return "Ism: «" + from + "» → «" + to + "»";
  if (key === "role") return "Rol: " + roleName(from) + " → " + roleName(to);
  if (key === "permissions") return "Ruxsatlar: " + permList(from) + " → " + permList(to);
  return key;
}

// Tafsilotni odam o'qiydigan qisqa matnga aylantiradi (jurnalda parol yoki kalit hech qachon bo'lmaydi)
function detailText(e) {
  const d = e.details && typeof e.details === "object" && !Array.isArray(e.details) ? e.details : {};
  const parts = [];
  try {
    const sessions = Number.isInteger(d.sessions_revoked) ? "Yopilgan seanslar: " + d.sessions_revoked : null;
    switch (e.action) {
      case "account.create":
        parts.push("Rol: " + roleName(d.role), "ruxsatlar: " + permList(d.permissions), d.generated_password === false ? "parol qo'lda kiritilgan" : "parol avtomatik yaratilgan");
        break;
      case "account.update":
        for (const [k, v] of Object.entries(d.changes && typeof d.changes === "object" ? d.changes : {})) parts.push(changeText(k, v));
        break;
      case "account.block":
        if (d.already_blocked) parts.push("hisob allaqachon bloklangan edi");
        if (d.ban_applied === false) parts.push("Supabase Auth'da blok qo'llanmadi");
        if (sessions) parts.push(sessions);
        break;
      case "account.unblock":
        if (d.already_active) parts.push("hisob allaqachon faol edi");
        break;
      case "account.delete":
        if (d.role) parts.push("Rol: " + roleName(d.role));
        break;
      case "password.reset":
        parts.push(d.generated_password === false ? "parol qo'lda kiritilgan" : "parol avtomatik yaratilgan");
        if (sessions) parts.push(sessions);
        break;
      case "password.change":
        parts.push(d.forced ? "vaqtinchalik paroldan majburiy almashtirish" : "o'zi almashtirdi");
        if (sessions) parts.push(sessions);
        break;
      case "mfa.enrolled":
        if (d.name) parts.push("Qurilma: " + d.name);
        if (d.source === "detected") parts.push("keyinroq aniqlandi");
        break;
      case "mfa.removed":
        if (d.name) parts.push("Qurilma: " + d.name);
        parts.push(d.source === "admin" ? "administrator olib tashladi" : d.source === "detected" ? "egasi olib tashlagan (keyinroq aniqlandi)" : "olib tashlandi");
        break;
      case "account.reset_mfa":
        parts.push("Olib tashlangan qurilmalar: " + (Number.isInteger(d.factors_removed) ? d.factors_removed : 0));
        if (Number.isInteger(d.factors_failed) && d.factors_failed > 0) parts.push("olib tashlab bo'lmagani: " + d.factors_failed);
        if (sessions) parts.push(sessions);
        break;
      case "session.revoke": {
        const what = d.scope === "one" ? "bitta seans" : d.scope === "others" ? "boshqa barcha seanslar" : d.scope === "all" ? "barcha seanslar" : "seanslar";
        parts.push(what + (Number.isInteger(d.count) ? " (yopilgan: " + d.count + ")" : ""), d.self ? "o'z hisobida" : "administrator tomonidan");
        break;
      }
      case "push.enable":
      case "push.disable":
        if (d.label) parts.push("Qurilma: " + d.label);
        break;
      default:
        break;
    }
  } catch {
    return "";
  }
  return parts.join("; ");
}

const who = (login) => (!login ? "—" : login === "sql-editor" ? "SQL muharriri" : login === "system" ? "Tizim" : "@" + login);

export function auditView(ctx) {
  const Q = { event: "", login: "" };
  let entries = [];
  let hasMore = false;
  let loading = false;
  let error = null;
  let gen = 0;

  const list = h("div", { role: "list", "aria-label": "Jurnal yozuvlari" });
  const moreBtn = h("button", { class: "btn btn--ghost", type: "button", onclick: () => load(false) }, "Yana yuklash");
  const more = h("div", { class: "more", hidden: true }, moreBtn);
  const loginInput = h("input", {
    class: "input",
    type: "search",
    name: "login",
    placeholder: "Login bo'yicha (masalan, dilshod)",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Login bo'yicha qidirish",
  });
  const eventSel = h(
    "select",
    { class: "select", "aria-label": "Hodisa turi bo'yicha filtr" },
    h("option", { value: "" }, "Barcha hodisalar"),
    Object.entries(EVENTS).map(([k, t]) => h("option", { value: k }, t)),
  );
  const head = h("div", { class: "log__head", "aria-hidden": "true" }, h("span", null, "Vaqt"), h("span", null, "Kim"), h("span", null, "Nima bo'ldi"), h("span", null, "Kimga"), h("span", null, "IP"), h("span", null, "Tafsilot"));

  function row(e) {
    const detail = detailText(e);
    return h(
      "div",
      { class: "log__row", role: "listitem" },
      h("span", { class: "log__time num", title: fmtDate(e.at) }, fmtDate(e.at)),
      h("span", { class: "log__actor" }, who(e.actor_login)),
      h("span", { class: "log__what" }, EVENTS[e.action] || e.action),
      h("span", { class: "log__target" }, e.target_login ? "@" + e.target_login : ""),
      h("span", { class: "log__ip num" }, e.ip || ""),
      h("span", { class: "log__details" }, detail),
    );
  }

  function paint() {
    more.hidden = !hasMore;
    moreBtn.disabled = loading;
    if (!entries.length) {
      if (loading) list.replaceChildren(h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" }));
      else if (error) {
        list.replaceChildren(
          h(
            "div",
            { class: "empty" },
            h("h2", null, "Jurnalni yuklab bo'lmadi"),
            h("p", null, errorText(error)),
            h("button", { class: "btn btn--ghost", type: "button", onclick: () => load(true) }, icon("refresh"), "Qayta urinish"),
          ),
        );
      } else {
        list.replaceChildren(
          h("div", { class: "empty" }, h("h2", null, "Yozuvlar yo'q"), h("p", null, Q.event || Q.login ? "Bu filtrlarga mos yozuv topilmadi." : "Amallar bajarilgach, ular shu yerda ko'rinadi.")),
        );
      }
      return;
    }
    list.replaceChildren(...entries.map(row));
  }

  // fresh=true: filtr o'zgargan yoki yangilash — boshidan; aks holda eski yozuvlarning davomi
  async function load(fresh) {
    if (!fresh && (loading || !entries.length)) return;
    const mine = ++gen;
    loading = true;
    error = null;
    if (fresh) entries = [];
    paint();
    try {
      const params = { limit: 50 };
      if (Q.event) params.event = Q.event;
      if (Q.login) params.login = Q.login;
      if (!fresh) params.before = String(entries[entries.length - 1].id);
      const data = await api.call("audit", params);
      if (mine !== gen || !ctx.alive()) return;
      const got = Array.isArray(data.entries) ? data.entries : [];
      entries = fresh ? got : entries.concat(got);
      hasMore = !!data.has_more && got.length > 0;
    } catch (e) {
      if (mine !== gen || !ctx.alive() || (e && e.fatal)) return;
      if (fresh || !entries.length) error = e;
      else toast("error", errorText(e));
    } finally {
      if (mine === gen) {
        loading = false;
        paint();
      }
    }
  }

  const onLogin = debounce(() => {
    const v = loginInput.value.trim().toLowerCase().replace(/^@/, "");
    if (v && !api.LOGIN_RE.test(v)) return; // to'liq yozilmaguncha so'rov yuborilmaydi
    if (v === Q.login) return;
    Q.login = v;
    load(true);
  }, 350);
  loginInput.addEventListener("input", onLogin);
  eventSel.addEventListener("change", () => {
    Q.event = eventSel.value;
    load(true);
  });

  const el = h(
    "div",
    null,
    h(
      "header",
      { class: "page-head" },
      h(
        "div",
        { class: "page-head__row" },
        h("div", null, h("h1", null, "Jurnal"), h("p", null, "Hisoblar bilan bog'liq muhim amallar. Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi.")),
        h("div", { class: "page-head__actions" }, h("button", { class: "iconbtn", type: "button", "aria-label": "Jurnalni yangilash", title: "Yangilash", onclick: () => load(true) }, icon("refresh"))),
      ),
    ),
    h("div", { class: "toolbar" }, h("div", { class: "toolbar__search" }, icon("search"), loginInput), h("div", { class: "toolbar__filters toolbar__filters--one" }, eventSel)),
    h("div", { class: "sheet" }, head, list, more),
  );
  paint();
  load(true);
  return { el, title: "Jurnal" };
}
