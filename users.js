// Administrator paneli: hisoblar ro'yxati (qidiruv, filtr, saralash) va boshqaruvi
// (yaratish, tahrirlash, parolni tiklash, bloklash, o'chirish). Har bir amalni server (ox-api) qayta tekshiradi.
import { h, icon, fmtDate, relTime, collator, debounce, nextId } from "../dom.js";
import * as api from "../api.js";
import { busy, checkbox, confirmDialog, credentialsDialog, dialog, errorText, field, notice, passwordRules, pwField, seg, textInput, toast } from "../ui.js";
import { avatar, cleanName, nameProblem, PERM, PERM_KEYS, ROLE, roleTag, statusTag, warningTexts } from "../parts.js";
import { sessionsPanel } from "./sessions.js";

const time = (s) => (s ? Date.parse(s) : -Infinity);

const cmp = {
  name: (a, b) => collator.compare(a.display_name, b.display_name) || collator.compare(a.login, b.login),
  role: (a, b) => (a.role === b.role ? 0 : a.role === "admin" ? -1 : 1) || cmp.name(a, b),
  status: (a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1) || cmp.name(a, b),
  last: (a, b) => time(a.last_sign_in_at) - time(b.last_sign_in_at) || cmp.name(a, b),
  created: (a, b) => time(a.created_at) - time(b.created_at) || cmp.name(a, b),
};

function toastWarnings(list) {
  for (const t of warningTexts(list)) toast("warn", t);
}

// ---- dialoglar uchun qismlar ----
function permsPicker(selected) {
  const boxes = PERM_KEYS.map((k) => checkbox({ name: "perm", value: k, label: PERM[k], checked: selected.includes(k) }));
  return {
    el: h(
      "fieldset",
      { class: "field" },
      h("legend", { class: "field__label" }, "Ruxsat etilgan bo'limlar"),
      h("div", { class: "perm-grid" }, boxes.map((b) => b.el)),
      h("p", { class: "field__hint" }, "Bu bo'limlar keyingi bosqichlarda qo'shiladi; ruxsatni hozirdan belgilab qo'yish mumkin."),
    ),
    get value() {
      return boxes.filter((b) => b.input.checked).map((b) => b.input.value);
    },
  };
}

function roleChoice(value, { locked = false } = {}) {
  const warn = notice("warn", "Administrator barcha hisoblarni boshqara oladi: yaratadi, bloklaydi, parolini tiklaydi va jurnalni ko'radi.");
  warn.hidden = true;
  const s = seg({
    name: "role",
    label: "Rol",
    value,
    options: [
      { value: "user", label: ROLE.user },
      { value: "admin", label: ROLE.admin },
    ],
    onchange: (v) => {
      warn.hidden = !(v === "admin" && v !== value);
    },
  });
  if (locked) s.setDisabled(true);
  return {
    el: h("div", { class: "field" }, h("span", { class: "field__label" }, "Rol"), s.el, locked ? h("p", { class: "field__hint" }, "O'z rolingizni o'zgartira olmaysiz.") : null, warn),
    get value() {
      return s.value;
    },
  };
}

function passwordChoice(getLogin) {
  const rules = passwordRules({ login: getLogin });
  const pw = pwField({ label: "Parolni kiriting", name: "password", autocomplete: "new-password", oninput: () => rules.check(pw.input.value) });
  const manual = h("div", { class: "form", hidden: true }, pw.el, rules.el);
  const HINT = {
    auto: "Avtomatik parol tasodifiy yaratiladi va faqat bir marta ko'rsatiladi. Foydalanuvchi birinchi kirishda uni o'zi almashtiradi.",
    manual: "O'zingiz tanlagan parolni foydalanuvchiga xavfsiz usulda yetkazing. U birinchi kirishda uni o'zi almashtiradi.",
  };
  const hint = h("p", { class: "field__hint" }, HINT.auto);
  const mode = seg({
    name: "pwmode",
    label: "Parol usuli",
    value: "auto",
    options: [
      { value: "auto", label: "Avtomatik yaratilsin" },
      { value: "manual", label: "O'zim kiritaman" },
    ],
    onchange(v) {
      manual.hidden = v !== "manual";
      hint.textContent = HINT[v === "manual" ? "manual" : "auto"];
      if (v === "manual") pw.input.focus();
    },
  });
  return {
    el: h(
      "div",
      { class: "field" },
      h("span", { class: "field__label" }, "Parol"),
      mode.el,
      hint,
      manual,
    ),
    get password() {
      return mode.value === "manual" ? pw.input.value : null;
    },
    validate() {
      if (mode.value !== "manual") return true;
      pw.error("");
      if (!rules.check(pw.input.value, "", { flag: true })) {
        pw.error("Parol quyidagi talablarga javob bersin.");
        pw.input.focus();
        return false;
      }
      return true;
    },
    showError(msg) {
      if (mode.value !== "manual") return false;
      pw.error(msg);
      pw.input.focus();
      return true;
    },
  };
}

const PW_CODES = new Set(["weak_password", "password_too_short", "password_too_long", "password_weak", "password_has_login", "invalid_password"]);

export function usersView(ctx) {
  const Q = { search: "", role: "", status: "", sort: "name", dir: "asc" };
  let accounts = null; // null — hali yuklanmagan
  let loadError = null;
  let gen = 0;

  // ---------------------------------------------------------------- ro'yxat
  const countEl = h("p", { "aria-live": "polite" }, "");
  const list = h("div", { role: "list", "aria-label": "Hisoblar" });

  const sortKeys = [
    ["name", "Foydalanuvchi"],
    ["role", "Rol"],
    ["status", "Holat"],
    ["last", "Oxirgi kirish"],
    ["created", "Yaratilgan"],
  ];
  const headBtns = {};
  const head = h(
    "div",
    { class: "tbl__head" },
    sortKeys.map(([k, t]) => {
      const b = h("button", { class: "sortbtn", type: "button", onclick: () => sortBy(k) }, t, icon("up"));
      headBtns[k] = b;
      return h("div", { class: k === "created" ? "col-created" : "" }, b);
    }),
    h("div"),
  );

  function sortBy(key) {
    if (Q.sort === key) Q.dir = Q.dir === "asc" ? "desc" : "asc";
    else {
      Q.sort = key;
      Q.dir = key === "last" || key === "created" ? "desc" : "asc";
    }
    paint();
  }

  function visible() {
    const q = Q.search.normalize("NFC").trim().toLowerCase();
    const arr = (accounts || []).filter(
      (a) => (!Q.role || a.role === Q.role) && (!Q.status || a.status === Q.status) && (!q || a.login.includes(q) || a.display_name.toLowerCase().includes(q)),
    );
    const sign = Q.dir === "asc" ? 1 : -1;
    return arr.sort((a, b) => sign * cmp[Q.sort](a, b));
  }

  function act(a, key, name, label, onclick, { disabled = false, danger = false, title } = {}) {
    return h(
      "button",
      {
        class: "act" + (danger ? " act--danger" : ""),
        type: "button",
        title: title || label,
        "aria-label": label + " — " + a.display_name,
        dataset: { act: key },
        disabled,
        onclick,
      },
      icon(name),
      h("span", { class: "act__t" }, label),
    );
  }

  // Qatordagi kichik belgilar: administratorda 2FA holati, faol seanslar soni
  function badges(a) {
    const out = [];
    const on = Number(a.mfa_factors) > 0;
    if (a.role === "admin" && (on || ctx.mfa.required)) {
      out.push(h("span", { class: "tbl__badge " + (on ? "tbl__badge--ok" : "tbl__badge--warn"), dataset: { mfa: on ? "on" : "off" } }, icon("shield"), on ? "2FA yoqilgan" : "2FA ulanmagan"));
    }
    if (Number.isInteger(a.sessions)) out.push(h("span", { class: "tbl__badge", dataset: { sessions: String(a.sessions) } }, icon("monitor"), a.sessions + " ta seans"));
    return out.length ? h("span", { class: "tbl__badges" }, out) : null;
  }

  function row(a) {
    const self = a.id === ctx.account.id;
    const blocked = a.status === "blocked";
    const hasMfa = Number(a.mfa_factors) > 0;
    return h(
      "div",
      { class: "tbl__row", role: "listitem", dataset: { id: a.id, login: a.login, status: a.status } },
      h(
        "div",
        { class: "tbl__who" },
        avatar(a, { pending: a.must_change_password && !blocked }),
        h(
          "div",
          { class: "tbl__id" },
          h("div", { class: "who__name" }, h("span", { class: "who__text" }, a.display_name), self ? h("span", { class: "who__you" }, "Siz") : null),
          h("div", { class: "who__login" }, "@" + a.login),
        ),
      ),
      h("div", { class: "tbl__meta" }, h("span", { class: "tbl__role" }, roleTag(a.role)), h("span", { class: "tbl__status" }, statusTag(a.status))),
      h(
        "div",
        { class: "tbl__last", title: a.last_sign_in_at ? fmtDate(a.last_sign_in_at) : "" },
        h("span", null, a.last_sign_in_at ? relTime(a.last_sign_in_at) : "Hali kirmagan"),
        a.must_change_password && !blocked ? h("span", { class: "tbl__hint" }, "Parolni hali almashtirmagan") : null,
        badges(a),
      ),
      h("div", { class: "tbl__created" }, fmtDate(a.created_at, { time: false })),
      h(
        "div",
        { class: "tbl__act" },
        act(a, "edit", "edit", "Tahrirlash", () => openEdit(a)),
        act(a, "sessions", "monitor", "Seanslar", () => openSessions(a)),
        act(a, "reset", "key", "Parolni tiklash", () => openReset(a), { disabled: self, title: self ? "O'z parolingizni Kabinet bo'limidan almashtiring" : undefined }),
        a.role === "admin"
          ? act(a, "reset2fa", "shield", "2FA ni tiklash", () => resetMfaFlow(a), {
              disabled: self || !hasMfa,
              title: self ? "O'z qurilmalaringizni Kabinet bo'limidan boshqaring" : !hasMfa ? "Bu administratorda 2FA qurilmasi yo'q" : undefined,
            })
          : h("span", { class: "act act--none", "aria-hidden": "true" }),
        blocked
          ? act(a, "unblock", "unlock", "Blokdan chiqarish", () => unblockFlow(a))
          : act(a, "block", "ban", "Bloklash", () => blockFlow(a), { disabled: self, title: self ? "O'zingizni bloklay olmaysiz" : undefined }),
        act(a, "delete", "trash", "O'chirish", () => deleteFlow(a), {
          disabled: self || !blocked,
          danger: true,
          title: self ? "O'zingizni o'chira olmaysiz" : !blocked ? "O'chirishdan oldin hisobni bloklang" : undefined,
        }),
      ),
    );
  }

  function paint() {
    for (const k of Object.keys(headBtns)) {
      if (Q.sort === k) headBtns[k].dataset.dir = Q.dir;
      else delete headBtns[k].dataset.dir;
    }
    if (accounts === null) {
      if (loadError) {
        countEl.textContent = "";
        list.replaceChildren(
          h(
            "div",
            { class: "empty" },
            h("h2", null, "Ro'yxatni yuklab bo'lmadi"),
            h("p", null, errorText(loadError)),
            h("button", { class: "btn btn--ghost", type: "button", onclick: () => load(true) }, icon("refresh"), "Qayta urinish"),
          ),
        );
      } else {
        countEl.textContent = "Yuklanmoqda…";
        list.replaceChildren(h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" }));
      }
      return;
    }
    const rows = visible();
    countEl.textContent = rows.length === accounts.length ? accounts.length + " ta hisob" : rows.length + " / " + accounts.length + " ta hisob";
    if (!rows.length) {
      list.replaceChildren(
        h(
          "div",
          { class: "empty" },
          h("h2", null, "Hech narsa topilmadi"),
          h("p", null, "Qidiruv yoki filtrlarni o'zgartirib ko'ring."),
          h(
            "button",
            {
              class: "btn btn--ghost",
              type: "button",
              onclick() {
                Q.search = Q.role = Q.status = "";
                searchInput.value = "";
                roleSel.value = "";
                statusSel.value = "";
                paint();
              },
            },
            "Filtrlarni tozalash",
          ),
        ),
      );
      return;
    }
    list.replaceChildren(...rows.map(row));
  }

  async function load(showSkeleton) {
    const mine = ++gen;
    if (showSkeleton) {
      accounts = null;
      loadError = null;
      paint();
    }
    try {
      const data = await api.call("list");
      if (mine !== gen || !ctx.alive()) return;
      accounts = Array.isArray(data.accounts) ? data.accounts : [];
      loadError = null;
    } catch (e) {
      if (mine !== gen || !ctx.alive() || (e && e.fatal)) return;
      if (accounts === null) loadError = e;
      else toast("error", errorText(e));
    }
    paint();
  }

  // Amaldan so'ng ro'yxatni yangilab, fokusni o'sha qatordagi tugmaga qaytaramiz
  async function reloadAndFocus(id, key) {
    await load(false);
    const btn = id && key ? list.querySelector('[data-id="' + id + '"] [data-act="' + key + '"]:not([disabled])') : null;
    (btn || searchInput).focus();
  }

  // ---------------------------------------------------------------- yaratish
  async function openCreate() {
    const made = await dialog({
      title: "Yangi hisob",
      wide: true,
      backdrop: false,
      build(close) {
        const formId = nextId("cr");
        const nameF = field({ label: "Ism", input: textInput({ name: "display_name", maxlength: 60, capitalize: "words", autofocus: true, placeholder: "Masalan, Dilshod Karimov" }) });
        const loginF = field({
          label: "Login",
          hint: "Kichik lotin harflari, raqam, nuqta, tagchiziq va tire (2–40 belgi). Hisob yaratilgach, loginni o'zgartirib bo'lmaydi.",
          input: textInput({ name: "login", maxlength: 40, placeholder: "dilshod" }),
        });
        const role = roleChoice("user");
        const perms = permsPicker(PERM_KEYS);
        const pwc = passwordChoice(() => loginF.input.value);
        const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
        const cancel = h("button", { class: "btn btn--ghost", type: "button", onclick: () => close(undefined) }, "Bekor qilish");
        const submit = h("button", { class: "btn btn--primary", type: "submit", form: formId }, "Hisob yaratish");
        const form = h(
          "form",
          {
            id: formId,
            class: "form",
            novalidate: true,
            async onsubmit(e) {
              e.preventDefault();
              err.hidden = true;
              nameF.error("");
              loginF.error("");
              const name = cleanName(nameF.input.value);
              const login = loginF.input.value.trim().toLowerCase();
              const nameIssue = nameProblem(name);
              if (nameIssue) {
                nameF.error(nameIssue);
                nameF.input.focus();
                return;
              }
              if (!api.LOGIN_RE.test(login)) {
                loginF.error("Login 2–40 belgidan iborat bo'lsin: kichik lotin harflari, raqam, nuqta, tagchiziq va tire; birinchi belgi harf yoki raqam.");
                loginF.input.focus();
                return;
              }
              if (!pwc.validate()) return;
              cancel.disabled = true;
              await busy(submit, async () => {
                try {
                  const params = { login, display_name: name, role: role.value, permissions: perms.value };
                  if (pwc.password !== null) params.password = pwc.password;
                  close(await api.call("create", params));
                } catch (ex) {
                  if (ex && ex.fatal) {
                    close(undefined);
                    return;
                  }
                  if (["login_taken", "invalid_login", "reserved_login", "login_domain_rejected"].includes(ex.code)) {
                    loginF.error(errorText(ex));
                    loginF.input.focus();
                  } else if (ex.code === "invalid_name") {
                    nameF.error(errorText(ex));
                    nameF.input.focus();
                  } else if (PW_CODES.has(ex.code) && pwc.showError(errorText(ex))) {
                    /* xato parol maydonida ko'rsatildi */
                  } else {
                    err.textContent = errorText(ex);
                    err.hidden = false;
                  }
                }
              });
              cancel.disabled = false;
            },
          },
          nameF.el,
          loginF.el,
          role.el,
          perms.el,
          pwc.el,
          err,
        );
        return { body: form, foot: [cancel, submit] };
      },
    });
    if (!made) return;
    load(false);
    await credentialsDialog({
      title: "Hisob yaratildi",
      lead: "«" + made.account.display_name + "» uchun kirish ma'lumotlari:",
      login: made.account.login,
      password: made.password,
    });
    toastWarnings(made.warnings);
    reloadAndFocus(made.account.id, "edit");
  }

  // ---------------------------------------------------------------- tahrirlash
  async function openEdit(a) {
    const self = a.id === ctx.account.id;
    const res = await dialog({
      title: "Hisobni tahrirlash",
      wide: true,
      backdrop: false,
      build(close) {
        const formId = nextId("ed");
        const nameF = field({ label: "Ism", input: textInput({ name: "display_name", value: a.display_name, maxlength: 60, capitalize: "words", autofocus: true }) });
        const role = roleChoice(a.role, { locked: self });
        const perms = permsPicker(a.permissions || []);
        const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
        const cancel = h("button", { class: "btn btn--ghost", type: "button", onclick: () => close(undefined) }, "Bekor qilish");
        const submit = h("button", { class: "btn btn--primary", type: "submit", form: formId }, "Saqlash");
        const form = h(
          "form",
          {
            id: formId,
            class: "form",
            novalidate: true,
            async onsubmit(e) {
              e.preventDefault();
              err.hidden = true;
              nameF.error("");
              const name = cleanName(nameF.input.value);
              const nameIssue = nameProblem(name);
              if (nameIssue) {
                nameF.error(nameIssue);
                nameF.input.focus();
                return;
              }
              cancel.disabled = true;
              await busy(submit, async () => {
                try {
                  close(await api.call("update", { id: a.id, display_name: name, role: role.value, permissions: perms.value }));
                } catch (ex) {
                  if (ex && ex.fatal) {
                    close(undefined);
                    return;
                  }
                  if (ex.code === "invalid_name") {
                    nameF.error(errorText(ex));
                    nameF.input.focus();
                  } else {
                    err.textContent = errorText(ex);
                    err.hidden = false;
                  }
                }
              });
              cancel.disabled = false;
            },
          },
          nameF.el,
          h("div", { class: "field" }, h("span", { class: "field__label" }, "Login"), h("div", { class: "readonly" }, "@" + a.login), h("p", { class: "field__hint" }, "Loginni o'zgartirib bo'lmaydi.")),
          role.el,
          perms.el,
          err,
        );
        return { body: form, foot: [cancel, submit] };
      },
    });
    if (!res) return;
    if (res.account && res.account.id === ctx.account.id) ctx.setAccount({ ...ctx.account, ...res.account });
    toast(res.changed ? "ok" : "info", res.changed ? "O'zgarishlar saqlandi." : "O'zgarish kiritilmadi.");
    toastWarnings(res.warnings);
    reloadAndFocus(a.id, "edit");
  }

  // ---------------------------------------------------------------- parolni tiklash
  async function openReset(a) {
    const res = await dialog({
      title: "Parolni tiklash",
      wide: true,
      backdrop: false,
      build(close) {
        const formId = nextId("rs");
        const pwc = passwordChoice(() => a.login);
        const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
        const cancel = h("button", { class: "btn btn--ghost", type: "button", autofocus: true, onclick: () => close(undefined) }, "Bekor qilish");
        const submit = h("button", { class: "btn btn--primary", type: "submit", form: formId }, "Parolni tiklash");
        const form = h(
          "form",
          {
            id: formId,
            class: "form",
            novalidate: true,
            async onsubmit(e) {
              e.preventDefault();
              err.hidden = true;
              if (!pwc.validate()) return;
              cancel.disabled = true;
              await busy(submit, async () => {
                try {
                  const params = { id: a.id };
                  if (pwc.password !== null) params.password = pwc.password;
                  close(await api.call("reset_password", params));
                } catch (ex) {
                  if (ex && ex.fatal) {
                    close(undefined);
                    return;
                  }
                  if (PW_CODES.has(ex.code) && pwc.showError(errorText(ex))) {
                    /* xato parol maydonida ko'rsatildi */
                  } else {
                    err.textContent = errorText(ex);
                    err.hidden = false;
                  }
                }
              });
              cancel.disabled = false;
            },
          },
          h("p", { class: "dlg__lead" }, "«" + a.display_name + "» (@" + a.login + ") uchun yangi vaqtinchalik parol beriladi. Eski parol darhol bekor bo'ladi, hisob barcha qurilmalardan chiqariladi va keyingi kirishda yangi parol tanlashi kerak bo'ladi."),
          pwc.el,
          err,
        );
        return { body: form, foot: [cancel, submit] };
      },
    });
    if (!res) return;
    load(false);
    await credentialsDialog({
      title: "Parol tiklandi",
      lead: "«" + a.display_name + "» uchun yangi kirish ma'lumotlari:",
      login: a.login,
      password: res.password,
    });
    toastWarnings(res.warnings);
    reloadAndFocus(a.id, "reset");
  }

  // ---------------------------------------------------------------- seanslar (qurilmalar)
  async function openSessions(a) {
    const who = "«" + a.display_name + "» (@" + a.login + ")";
    await dialog({
      title: "Seanslar",
      wide: true,
      build(close) {
        const panel = sessionsPanel({
          ctx,
          userId: a.id,
          person: who,
          onSelfClosed: () => {
            close(undefined);
            ctx.sessionClosedHere();
          },
        });
        const done = h("button", { class: "btn btn--primary", type: "button", autofocus: true, onclick: () => close(undefined) }, "Yopish");
        return { body: [h("p", { class: "dlg__lead" }, who + " hisobiga kirilgan qurilmalar."), panel.el], foot: [done] };
      },
    });
    if (ctx.alive()) reloadAndFocus(a.id, "sessions");
  }

  // ---------------------------------------------------------------- 2FA ni tiklash (telefon yo'qolgan administrator uchun)
  async function resetMfaFlow(a) {
    const r = await confirmDialog({
      title: "2FA ni tiklaysizmi?",
      lead:
        "«" +
        a.display_name +
        "» (@" +
        a.login +
        ") hisobidagi barcha Authenticator qurilmalari olib tashlanadi va u barcha qurilmalardan chiqariladi. Parolini bilsa, qayta kirib, telefonni yangidan ulaydi. Telefon yo'qolgan yoki almashtirilgan bo'lsa, shundan foydalaning.",
      confirmText: "2FA ni tiklash",
      danger: true,
      run: () => api.call("reset_mfa", { id: a.id }),
    });
    if (!r) return;
    const n = r.result && Number.isInteger(r.result.factors_removed) ? r.result.factors_removed : 0;
    toast("ok", n > 0 ? "2FA tiklandi: " + n + " ta qurilma olib tashlandi, seanslar yopildi." : "Olib tashlanadigan qurilma topilmadi.");
    toastWarnings(r.result && r.result.warnings);
    reloadAndFocus(a.id, "reset2fa");
  }

  // ---------------------------------------------------------------- bloklash / blokdan chiqarish / o'chirish
  async function blockFlow(a) {
    const r = await confirmDialog({
      title: "Hisobni bloklaysizmi?",
      lead: "«" + a.display_name + "» (@" + a.login + ") darhol barcha qurilmalardan chiqariladi va qayta kira olmaydi. Ma'lumotlari saqlanadi; blokni keyin olib tashlash mumkin.",
      confirmText: "Bloklash",
      danger: true,
      run: () => api.call("block", { id: a.id }),
    });
    if (!r) return;
    toast("ok", "Hisob bloklandi.");
    toastWarnings(r.result.warnings);
    reloadAndFocus(a.id, "unblock");
  }

  async function unblockFlow(a) {
    const r = await confirmDialog({
      title: "Blokni olib tashlaysizmi?",
      lead: "«" + a.display_name + "» (@" + a.login + ") yana tizimga kira oladi (parolini bilsa).",
      confirmText: "Blokni olib tashlash",
      run: () => api.call("unblock", { id: a.id }),
    });
    if (!r) return;
    toast("ok", "Blok olib tashlandi.");
    toastWarnings(r.result.warnings);
    reloadAndFocus(a.id, "block");
  }

  async function deleteFlow(a) {
    const r = await confirmDialog({
      title: "Hisobni o'chirasizmi?",
      lead: "«" + a.display_name + "» (@" + a.login + ") butunlay o'chiriladi: kirish hisobi ham, platformadagi ma'lumotlari ham. Buni qaytarib bo'lmaydi. Jurnaldagi yozuvlar saqlanib qoladi.",
      confirmText: "Butunlay o'chirish",
      danger: true,
      typeToConfirm: a.login,
      run: () => api.call("delete", { id: a.id, confirm_login: a.login }),
    });
    if (!r) return;
    toast("ok", "Hisob o'chirildi.");
    toastWarnings(r.result.warnings);
    reloadAndFocus(null, null);
  }

  // ---------------------------------------------------------------- umumiy ko'rinish
  const searchInput = h("input", {
    class: "input",
    type: "search",
    name: "q",
    placeholder: "Ism yoki login",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "Ism yoki login bo'yicha qidirish",
  });
  const onSearch = debounce(() => {
    Q.search = searchInput.value;
    paint();
  }, 120);
  searchInput.addEventListener("input", onSearch);

  const mkSelect = (label, options, key) => {
    const sel = h("select", { class: "select", "aria-label": label }, options.map(([v, t]) => h("option", { value: v }, t)));
    sel.addEventListener("change", () => {
      Q[key] = sel.value;
      paint();
    });
    return sel;
  };
  const roleSel = mkSelect("Rol bo'yicha filtr", [["", "Barcha rollar"], ["admin", ROLE.admin], ["user", ROLE.user]], "role");
  const statusSel = mkSelect("Holat bo'yicha filtr", [["", "Barcha holatlar"], ["active", "Faol"], ["blocked", "Bloklangan"]], "status");

  const el = h(
    "div",
    null,
    h(
      "header",
      { class: "page-head" },
      h(
        "div",
        { class: "page-head__row" },
        h("div", null, h("h1", null, "Foydalanuvchilar"), countEl),
        h(
          "div",
          { class: "page-head__actions" },
          h("button", { class: "iconbtn", type: "button", "aria-label": "Ro'yxatni yangilash", title: "Yangilash", onclick: () => load(false) }, icon("refresh")),
          h("button", { class: "btn btn--primary", type: "button", onclick: openCreate }, icon("plus"), "Yangi hisob"),
        ),
      ),
    ),
    h("div", { class: "toolbar" }, h("div", { class: "toolbar__search" }, icon("search"), searchInput), h("div", { class: "toolbar__filters" }, roleSel, statusSel)),
    h("div", { class: "sheet" }, head, list),
  );

  paint();
  load(true);
  return { el, title: "Foydalanuvchilar" };
}
