// Shaxsiy kabinet: Profil · Bildirishnomalar · Qurilmalar · Xavfsizlik.
// Bo'limlar manzilda turadi (#/cabinet/<bo'lim>), shuning uchun «orqaga» tugmasi va havolalar ishlaydi. Bo'lim birinchi ochilganda quriladi
// va keyin saqlanadi (profil formasidagi yozilgan matn bo'limlar almashganda yo'qolmaydi). Profil o'zgartirishi bazaning ruxsat qoidalari (RLS) orqali ketadi.
import { h, fmtDate } from "../dom.js";
import * as api from "../api.js";
import { busy, confirmDialog, errorText, field, textInput, toast } from "../ui.js";
import { avatar, bioProblem, cleanBio, cleanName, nameProblem, permChips, roleTag, statusTag } from "../parts.js";
import { passwordForm } from "./password.js";
import { mfaCard } from "./mfa.js";
import { sessionsPanel } from "./sessions.js";
import { activityPanel } from "./activity.js";
import { pushSection } from "./cabinet_push.js";

const len = (s) => [...s].length;

export const CABINET_SECTIONS = [
  { key: "profil", label: "Profil" },
  { key: "bildirishnoma", label: "Bildirishnomalar" },
  { key: "qurilma", label: "Qurilmalar" },
  { key: "xavfsizlik", label: "Xavfsizlik" },
];
const LABEL = Object.fromEntries(CABINET_SECTIONS.map((s) => [s.key, s.label]));
const titleFor = (key) => (key === "profil" ? "Kabinet" : LABEL[key] + " — Kabinet");

export function cabinetView(ctx, { sub = "", setTitle = () => {} } = {}) {
  const acc = ctx.account;

  // ---- chap ustun: kim ekanligi ----
  const identity = h("aside", { class: "cab__id", "aria-label": "Hisob ma'lumotlari" });
  function paintIdentity() {
    const a = ctx.account;
    identity.replaceChildren(
      avatar(a, { size: "lg" }),
      h("div", { class: "cab__who" }, h("h2", null, a.display_name), h("p", { class: "who__login" }, "@" + a.login)),
      h("div", { class: "cab__tags" }, roleTag(a.role), statusTag(a.status)),
      h(
        "dl",
        { class: "cab__facts" },
        h("div", null, h("dt", null, "Ruxsat etilgan bo'limlar"), h("dd", { class: "cab__perms" }, permChips(a.permissions))),
        h("div", null, h("dt", null, "Hisob yaratilgan"), h("dd", null, fmtDate(a.created_at, { time: false }))),
      ),
    );
  }
  paintIdentity();

  // ---------------------------------------------------------------------------
  // Bo'limlar (har biri {el, show?, hide?, dispose?} qaytaradi; show — qayta ochilganda, hide — boshqasiga o'tilganda)
  // ---------------------------------------------------------------------------
  function profileSection() {
    const nameField = field({
      label: "Ism",
      hint: "Boshqalar sizni shu nom bilan ko'radi.",
      input: textInput({ name: "display_name", value: acc.display_name, maxlength: 60, autocomplete: "name", capitalize: "words" }),
    });
    const bio = h("textarea", { class: "textarea", name: "bio", maxlength: 300, rows: 4, placeholder: "O'zingiz haqingizda qisqacha…", autocomplete: "off" });
    bio.value = acc.bio || "";
    const bioField = field({ label: "Tavsif", input: bio });
    const counter = h("span", { class: "counter num" }, "");
    const profileErr = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const saveBtn = h("button", { class: "btn btn--primary", type: "submit", disabled: true }, "Saqlash");
    const baseline = () => ({ name: ctx.account.display_name, bio: ctx.account.bio || "" });
    const dirty = () => cleanName(nameField.input.value) !== baseline().name || cleanBio(bio.value) !== baseline().bio;
    const sync = () => {
      counter.textContent = len(bio.value) + " / 300";
      saveBtn.disabled = !dirty();
    };
    nameField.input.addEventListener("input", sync);
    bio.addEventListener("input", sync);
    sync();

    const form = h(
      "form",
      {
        class: "form",
        novalidate: true,
        async onsubmit(e) {
          e.preventDefault();
          profileErr.hidden = true;
          nameField.error("");
          bioField.error("");
          const name = cleanName(nameField.input.value);
          const text = cleanBio(bio.value);
          const nameIssue = nameProblem(name);
          if (nameIssue) {
            nameField.error(nameIssue);
            nameField.input.focus();
            return;
          }
          const bioIssue = bioProblem(text);
          if (bioIssue) {
            bioField.error(bioIssue);
            bio.focus();
            return;
          }
          await busy(saveBtn, async () => {
            try {
              const row = await api.updateProfile({ display_name: name, bio: text });
              ctx.setAccount({ ...ctx.account, display_name: row.display_name, bio: row.bio, updated_at: row.updated_at });
              nameField.input.value = row.display_name;
              bio.value = row.bio;
              paintIdentity();
              toast("ok", "Profil saqlandi.");
            } catch (ex) {
              if (ex && ex.fatal) return;
              profileErr.textContent = errorText(ex);
              profileErr.hidden = false;
            }
          });
          sync();
        },
      },
      nameField.el,
      bioField.el,
      h("div", { class: "section__actions" }, saveBtn, counter),
      profileErr,
    );
    return { el: h("section", { class: "section", "aria-labelledby": "cab-profile" }, h("h2", { id: "cab-profile" }, "Profil"), form) };
  }

  function notificationsSection() {
    const p = pushSection(ctx);
    return { ...p, el: h("section", { class: "section", "aria-labelledby": "cab-push" }, h("h2", { id: "cab-push" }, "Bildirishnomalar"), p.el) };
  }

  function devicesSection() {
    const allBtn = h(
      "button",
      {
        class: "btn btn--ghost",
        type: "button",
        async onclick() {
          await confirmDialog({
            title: "Barcha qurilmalardan chiqasizmi?",
            lead: "Shu qurilmadagi seans ham yopiladi, qayta kirishingiz kerak bo'ladi. Telefon yoki kompyuteringiz yo'qolgan yoki begona odam kirgan bo'lishi mumkin deb o'ylasangiz, shundan foydalaning.",
            confirmText: "Barchasidan chiqish",
            danger: true,
            run: () => ctx.signOutEverywhere(),
          });
        },
      },
      "Barcha qurilmalardan chiqish",
    );
    const sess = sessionsPanel({ ctx, extra: allBtn, onSelfClosed: () => ctx.sessionClosedHere() });
    return {
      el: h(
        "section",
        { class: "section", "aria-labelledby": "cab-sessions" },
        h("h2", { id: "cab-sessions" }, "Kirgan qurilmalar"),
        h("p", { class: "section__sub" }, "Hisobingizga kirilgan qurilmalar (seanslar). Tanimagan qurilma ko'rsangiz, uni yoping va parolingizni almashtiring."),
        sess.el,
      ),
      show: () => sess.reload(),
    };
  }

  function securitySection() {
    const pw = passwordForm({ login: acc.login, onSaved: (res) => ctx.afterPasswordChange(res) });
    // Ikki bosqichli tasdiq: faqat administrator; server talabi o'chiq bo'lsa ham, qurilma ulangan bo'lsa ko'rsatiladi
    const mfa = acc.role === "admin" && (ctx.mfa.required || ctx.mfa.factors.some((f) => f.verified)) ? mfaCard(ctx) : null;
    const act = activityPanel();
    return {
      el: h(
        "div",
        { class: "cab__forms" },
        h(
          "section",
          { class: "section", "aria-labelledby": "cab-password" },
          h("h2", { id: "cab-password" }, "Parol"),
          h("p", { class: "section__sub" }, "Parolni almashtirsangiz, boshqa qurilmalardagi seanslaringiz yopiladi; shu qurilmada kirgan holda qolasiz."),
          pw.el,
        ),
        mfa ? mfa.el : null,
        h(
          "section",
          { class: "section", "aria-labelledby": "cab-activity" },
          h("h2", { id: "cab-activity" }, "So'nggi hodisalar"),
          h("p", { class: "section__sub" }, "Hisobingizdagi oxirgi o'zgarishlar: parol, 2FA, seanslar, bildirishnomalar va administrator amallari. Siz qilmagan narsani ko'rsangiz, parolingizni almashtiring va administratorga xabar bering."),
          act.el,
        ),
      ),
      show: () => act.reload(),
      dispose: () => act.dispose(),
    };
  }

  const BUILD = { profil: profileSection, bildirishnoma: notificationsSection, qurilma: devicesSection, xavfsizlik: securitySection };

  // ---------------------------------------------------------------------------
  // Navigatsiya va bo'limlarni almashtirish
  // ---------------------------------------------------------------------------
  const links = new Map(CABINET_SECTIONS.map((s) => [s.key, h("a", { href: "#/cabinet/" + s.key, dataset: { sec: s.key } }, s.label)]));
  const nav = h("nav", { class: "cabnav", "aria-label": "Kabinet bo'limlari" }, [...links.values()]);
  const panels = h("div", { class: "cab__panels" });
  const built = new Map(); // key → {sec, wrap}
  let cur = "";
  let disposed = false;

  function route(next) {
    if (disposed) return;
    const key = BUILD[next] ? next : "profil";
    if (key === cur) return;
    const prev = built.get(cur);
    if (prev && prev.sec.hide) prev.sec.hide();
    cur = key;
    let entry = built.get(key);
    if (!entry) {
      const sec = BUILD[key]();
      const wrap = h("div", { class: "cab__forms", id: "cab-sec-" + key, dataset: { sec: key } }, sec.el);
      panels.append(wrap);
      entry = { sec, wrap };
      built.set(key, entry);
    } else if (entry.sec.show) {
      entry.sec.show();
    }
    for (const [k, e] of built) e.wrap.hidden = k !== key;
    for (const [k, a] of links) {
      if (k === key) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    setTitle(titleFor(key));
  }
  route(sub);

  const el = h(
    "div",
    null,
    h("header", { class: "page-head" }, h("h1", null, "Kabinet"), h("p", null, "Profil, bildirishnomalar, qurilmalar va xavfsizlik sozlamalari.")),
    h("div", { class: "cab" }, identity, h("div", { class: "cab__main" }, nav, panels)),
  );

  return {
    el,
    title: titleFor(cur),
    route,
    dispose() {
      disposed = true;
      for (const e of built.values()) {
        if (e.sec.dispose) {
          try {
            e.sec.dispose();
          } catch {
            /* tozalash xatosi ekranni to'xtatmasin */
          }
        }
      }
      built.clear();
    },
  };
}
