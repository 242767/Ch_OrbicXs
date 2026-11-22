// Shaxsiy kabinet: profil, parol, seanslar. Profil o'zgartirishi bazaning ruxsat qoidalari (RLS) orqali ketadi.
import { h, fmtDate } from "../dom.js";
import * as api from "../api.js";
import { busy, confirmDialog, errorText, field, notice, textInput, toast } from "../ui.js";
import { avatar, bioProblem, cleanBio, cleanName, nameProblem, permChips, roleTag, statusTag } from "../parts.js";
import { passwordForm } from "./password.js";
import { mfaCard } from "./mfa.js";
import { sessionsPanel } from "./sessions.js";

const len = (s) => [...s].length;

export function cabinetView(ctx) {
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

  // ---- profil ----
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

  const profileForm = h(
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

  // ---- parol ----
  const pw = passwordForm({ login: acc.login, onSaved: (res) => ctx.afterPasswordChange(res) });

  // ---- ikki bosqichli tasdiq (faqat administrator; server talabi o'chiq bo'lsa ham, qurilma ulangan bo'lsa ko'rsatiladi) ----
  const mfa = acc.role === "admin" && (ctx.mfa.required || ctx.mfa.factors.some((f) => f.verified)) ? mfaCard(ctx) : null;

  // ---- seanslar ----
  const allBtn = h(
    "button",
    {
      class: "btn btn--ghost",
      type: "button",
      async onclick() {
        const r = await confirmDialog({
          title: "Barcha qurilmalardan chiqasizmi?",
          lead: "Shu qurilmadagi seans ham yopiladi, qayta kirishingiz kerak bo'ladi. Telefon yoki kompyuteringiz yo'qolgan yoki begona odam kirgan bo'lishi mumkin deb o'ylasangiz, shundan foydalaning.",
          confirmText: "Barchasidan chiqish",
          danger: true,
          run: () => ctx.signOutEverywhere(),
        });
        void r;
      },
    },
    "Barcha qurilmalardan chiqish",
  );
  const sess = sessionsPanel({ ctx, extra: allBtn, onSelfClosed: () => ctx.sessionClosedHere() });

  const el = h(
    "div",
    null,
    h("header", { class: "page-head" }, h("h1", null, "Kabinet"), h("p", null, "Profilingiz va xavfsizlik sozlamalari.")),
    h(
      "div",
      { class: "cab" },
      identity,
      h(
        "div",
        { class: "cab__forms" },
        h("section", { class: "section", "aria-labelledby": "cab-profile" }, h("h2", { id: "cab-profile" }, "Profil"), profileForm),
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
          { class: "section", "aria-labelledby": "cab-sessions" },
          h("h2", { id: "cab-sessions" }, "Seanslar"),
          h("p", { class: "section__sub" }, "Hisobingizga kirilgan qurilmalar. Tanimagan qurilma ko'rsangiz, uni yoping va parolingizni almashtiring."),
          sess.el,
        ),
      ),
    ),
  );
  return { el, title: "Kabinet" };
}
