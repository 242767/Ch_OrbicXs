// Umumiy interfeys qismlari: xabarcha, band holat, forma maydonlari, oynalar (dialog).
import { h, icon, nextId, copyText } from "./dom.js";

// ---------------------------------------------------------------------------
// Xabarcha (toast)
// ---------------------------------------------------------------------------
const TOAST_ICON = { ok: "check", error: "alert", warn: "alert", info: "info" };

export function toast(kind, text, ms) {
  // Modal oyna ochiq bo'lsa, u sahifaning ustida turadi — xabarcha ham oyna ichiga qo'yiladi, aks holda ko'rinmay qoladi.
  const open = document.querySelectorAll("dialog[open]");
  const dlg = open.length ? open[open.length - 1] : null;
  let box = document.getElementById("toasts");
  if (dlg) {
    box = dlg.querySelector(":scope > .toasts");
    if (!box) {
      box = h("div", { class: "toasts", "aria-live": "polite" });
      dlg.append(box);
    }
  }
  if (!box) return;
  const life = ms ?? (kind === "error" ? 8000 : kind === "warn" ? 10000 : 4500);
  const el = h(
    "div",
    { class: "toast toast--" + kind, role: kind === "error" ? "alert" : "status", onclick: () => el.remove() },
    icon(TOAST_ICON[kind] || "info"),
    h("span", null, text),
  );
  box.append(el);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(() => el.remove(), life);
}

export const errorText = (e) => (e && e.message ? e.message : "Kutilmagan xatolik yuz berdi.");

export function notice(kind, text) {
  return h("div", { class: "notice" + (kind ? " notice--" + kind : ""), role: kind === "bad" ? "alert" : "status" }, text);
}

// ---------------------------------------------------------------------------
// Tugma «band» holati: ikki marta bosilishining oldini oladi
// ---------------------------------------------------------------------------
export async function busy(btn, fn) {
  if (!btn || btn.disabled) return undefined;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  const spin = h("span", { class: "btn__spin", "aria-hidden": "true" });
  btn.prepend(spin);
  try {
    return await fn();
  } finally {
    spin.remove();
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Forma maydonlari (brauzerning o'z tekshiruvi o'rniga o'zbekcha xabarlar: formalarda novalidate)
// ---------------------------------------------------------------------------
export function textInput({ type = "text", name, value = "", placeholder, maxlength, autocomplete = "off", inputmode, capitalize = "none", oninput, autofocus }) {
  return h("input", {
    class: "input",
    type,
    name,
    value,
    placeholder,
    maxlength,
    autocomplete,
    inputmode,
    autocapitalize: capitalize,
    spellcheck: "false",
    "aria-required": "true",
    autofocus,
    oninput,
  });
}

export function field({ label, hint, input, wrap }) {
  const id = input.id || (input.id = nextId("in"));
  const hintId = hint ? id + "-hint" : null;
  const errId = id + "-err";
  const err = h("p", { class: "field__error", id: errId, role: "alert", hidden: true });
  input.setAttribute("aria-describedby", [hintId, errId].filter(Boolean).join(" "));
  const el = h("div", { class: "field" }, h("label", { class: "field__label", for: id }, label), wrap || input, hint ? h("p", { class: "field__hint", id: hintId }, hint) : null, err);
  return {
    el,
    input,
    error(msg) {
      if (msg) {
        err.textContent = msg;
        err.hidden = false;
        input.setAttribute("aria-invalid", "true");
      } else {
        err.textContent = "";
        err.hidden = true;
        input.removeAttribute("aria-invalid");
      }
    },
  };
}

export function pwField({ label, name, autocomplete = "current-password", hint, oninput, autofocus }) {
  const input = h("input", { class: "input", type: "password", name, autocomplete, autocapitalize: "none", spellcheck: "false", "aria-required": "true", autofocus, oninput });
  const toggle = h("button", { class: "pw__toggle", type: "button", "aria-label": "Parolni ko'rsatish", "aria-pressed": "false" }, icon("eye"));
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.setAttribute("aria-label", show ? "Parolni yashirish" : "Parolni ko'rsatish");
    toggle.replaceChildren(icon(show ? "eyeoff" : "eye"));
    input.focus();
  });
  return field({ label, hint, input, wrap: h("div", { class: "pw" }, input, toggle) });
}

export function seg({ name, label, options, value, onchange }) {
  const el = h("div", { class: "seg", role: "radiogroup", "aria-label": label });
  for (const o of options) {
    el.append(
      h(
        "label",
        { class: "seg__opt" },
        h("input", { type: "radio", name, value: o.value, checked: o.value === value, onchange: () => onchange && onchange(o.value) }),
        h("span", null, o.label),
      ),
    );
  }
  return {
    el,
    get value() {
      const c = el.querySelector("input:checked");
      return c ? c.value : value;
    },
    setDisabled(v) {
      for (const i of el.querySelectorAll("input")) i.disabled = !!v;
    },
  };
}

export function checkbox({ name, label, value, checked = false, disabled = false, onchange }) {
  const input = h("input", { type: "checkbox", name, value, checked, disabled, onchange });
  return { el: h("label", { class: "check" }, input, h("span", null, label)), input };
}

// Parol talablari ro'yxati. Server ham xuddi shu qoidalarni tekshiradi (u oxirgi hakam); bu yerda foydalanuvchiga oldindan ko'rsatiladi.
// login — matn yoki (login keyinroq yoziladigan formalar uchun) matn qaytaruvchi funksiya
export function passwordRules({ login = "", needsDiff = false } = {}) {
  const getLogin = () => String(typeof login === "function" ? login() : login).trim().toLowerCase();
  const lis = {
    len: h("li", { dataset: { ok: "false" } }, "Kamida 12 belgi"),
    var: h("li", { dataset: { ok: "false" } }, "Kamida 5 xil belgi"),
    login: h("li", { dataset: { ok: "false" } }, "Loginni o'z ichiga olmaydi"),
    diff: h("li", { dataset: { ok: "false" } }, "Joriy paroldan farq qiladi"),
    extra: h("li", { dataset: { ok: "false" }, hidden: true }, ""),
  };
  if (getLogin().length < 4) lis.login.hidden = true;
  if (!needsDiff) lis.diff.hidden = true;
  const el = h("ul", { class: "rules", "aria-live": "polite" }, lis.len, lis.var, lis.login, lis.diff, lis.extra);
  const mark = (li, ok) => li.setAttribute("data-ok", ok ? "true" : "false");
  function check(pw, current = "", { flag = false } = {}) {
    const chars = [...pw];
    const bytes = new TextEncoder().encode(pw).length;
    const has = pw.length > 0;
    const lg = getLogin();
    lis.login.hidden = lg.length < 4;
    const res = {
      len: chars.length >= 12,
      var: new Set(chars).size >= 5,
      login: has && !(lg.length >= 4 && pw.toLowerCase().includes(lg)),
      diff: has && pw !== current,
    };
    let extra = null;
    if (bytes > 72) extra = "72 baytdan uzun emas (kirill harflari va emoji ko'proq joy oladi)";
    else if (/[\x00-\x1f\x7f]/.test(pw)) extra = "Boshqaruv belgilari bo'lmasin";
    mark(lis.len, res.len);
    mark(lis.var, res.var);
    mark(lis.login, res.login);
    mark(lis.diff, res.diff);
    lis.extra.hidden = extra === null;
    lis.extra.textContent = extra || "";
    const valid = res.len && res.var && (lg.length < 4 || res.login) && (!needsDiff || res.diff) && extra === null;
    // Yuborishga urinib bo'lmagach, bajarilmagan talablar qizil bo'ladi (oldin xira turadi: foydalanuvchi hali yozayotgan bo'lishi mumkin)
    if (flag && !valid) el.setAttribute("data-flagged", "true");
    return valid;
  }
  return { el, check };
}

// ---------------------------------------------------------------------------
// Oynalar (<dialog>): fokus ushlab turiladi, Esc yopadi, yopilganda fokus joyiga qaytadi
// dialog() — oyna yopilganda qiymat bilan bajariladigan va'da qaytaradi (bekor qilinsa: undefined)
// ---------------------------------------------------------------------------
export function dialog({ title, wide = false, dismissible = true, backdrop = dismissible, build }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const titleId = nextId("dlg-t");
    const dlg = h("dialog", { class: "dlg" + (wide ? " dlg--wide" : ""), "aria-labelledby": titleId });
    let result;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dlg.remove();
      if (opener && opener.isConnected && typeof opener.focus === "function") {
        try {
          opener.focus();
        } catch {
          /* e'tibor berilmaydi */
        }
      }
      resolve(result);
    };
    const close = (value) => {
      result = value;
      if (dlg.open) dlg.close();
      else finish();
    };
    dlg.addEventListener("close", finish);
    dlg.addEventListener("cancel", (e) => {
      if (!dismissible) e.preventDefault();
    });
    // Matn belgilab, sichqonchani oyna tashqarisida qo'yib yuborsa, oyna yopilib qolmasin
    let downOnBackdrop = false;
    dlg.addEventListener("mousedown", (e) => {
      downOnBackdrop = e.target === dlg;
    });
    dlg.addEventListener("click", (e) => {
      if (backdrop && e.target === dlg && downOnBackdrop) close(undefined);
    });
    const parts = build(close, dlg);
    dlg.append(
      h(
        "div",
        { class: "dlg__head" },
        h("h2", { id: titleId }, title),
        dismissible ? h("button", { class: "iconbtn", type: "button", "aria-label": "Yopish", onclick: () => close(undefined) }, icon("x")) : null,
      ),
      h("div", { class: "dlg__body" }, parts.body),
      parts.foot ? h("div", { class: "dlg__foot" }, parts.foot) : null,
    );
    document.body.append(dlg);
    dlg.showModal();
  });
}

// Tasdiqlash oynasi. run() muvaffaqiyatli bajarilsa, oyna {ok:true, result} bilan yopiladi; xato bo'lsa, oyna ochiq qoladi.
export function confirmDialog({ title, lead, body, confirmText, cancelText = "Bekor qilish", danger = false, typeToConfirm = null, run }) {
  return dialog({
    title,
    backdrop: false,
    build(close) {
      const formId = nextId("cf");
      const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
      const confirmBtn = h("button", { class: "btn " + (danger ? "btn--danger" : "btn--primary"), type: "submit", form: formId }, confirmText);
      const cancelBtn = h("button", { class: "btn btn--ghost", type: "button", autofocus: true, onclick: () => close(undefined) }, cancelText);
      let typed = null;
      const sync = () => {
        confirmBtn.disabled = typed ? typed.input.value.trim().toLowerCase() !== typeToConfirm : false;
      };
      if (typeToConfirm) {
        typed = field({
          label: "Tasdiqlash uchun «" + typeToConfirm + "» deb yozing",
          input: textInput({ name: "confirm", placeholder: typeToConfirm, oninput: sync }),
        });
        confirmBtn.disabled = true;
      }
      const form = h(
        "form",
        {
          id: formId,
          class: "form",
          novalidate: true,
          async onsubmit(e) {
            e.preventDefault();
            if (confirmBtn.disabled) return;
            err.hidden = true;
            cancelBtn.disabled = true;
            await busy(confirmBtn, async () => {
              try {
                const result = await run();
                close({ ok: true, result });
              } catch (ex) {
                if (ex && ex.fatal) {
                  close(undefined);
                  return;
                }
                err.textContent = errorText(ex);
                err.hidden = false;
              }
            });
            cancelBtn.disabled = false;
            sync();
          },
        },
        lead ? h("p", { class: "dlg__lead" }, lead) : null,
        body,
        typed ? typed.el : null,
        err,
      );
      return { body: form, foot: [cancelBtn, confirmBtn] };
    },
  });
}

// Bir martalik ma'lumotlar oynasi (yangi hisob / tiklangan parol). Faqat «Tayyor» tugmasi bilan yopiladi.
export function credentialsDialog({ title, lead, login, password }) {
  return dialog({
    title,
    wide: true,
    dismissible: false,
    build(close) {
      const site = location.origin + location.pathname.replace(/index\.html$/, "");
      const row = (label, value, cls) => {
        const btn = h("button", { class: "iconbtn", type: "button", "aria-label": label + "ni nusxalash" }, icon("copy"));
        btn.addEventListener("click", async () => {
          const ok = await copyText(value);
          toast(ok ? "ok" : "error", ok ? label + " nusxalandi." : "Nusxalab bo'lmadi. Matnni qo'lda belgilab nusxalang.");
        });
        return h("div", { class: "cred__row" }, h("span", { class: "cred__label" }, label), h("span", { class: "cred__value " + cls }, value), btn);
      };
      const all = h("button", { class: "btn btn--ghost", type: "button" }, icon("copy"), "Hammasini nusxalash");
      all.addEventListener("click", async () => {
        const text = "Sayt: " + site + "\nLogin: " + login + (password ? "\nParol: " + password : "");
        const ok = await copyText(text);
        toast(ok ? "ok" : "error", ok ? "Sayt, login va parol nusxalandi." : "Nusxalab bo'lmadi. Matnni qo'lda belgilab nusxalang.");
      });
      const done = h("button", { class: "btn btn--primary", type: "button", autofocus: true, onclick: () => close(true) }, "Tayyor");
      const body = [
        lead ? h("p", { class: "dlg__lead" }, lead) : null,
        h("div", { class: "cred" }, row("Login", login, "cred__value--login"), password ? row("Parol", password, "") : null),
        password
          ? notice("warn", "Bu parol faqat hozir ko'rsatiladi. Oynani yopgach, uni qayta ko'rib bo'lmaydi (kerak bo'lsa, yangisi yaratiladi). Foydalanuvchiga xavfsiz usulda yuboring. U birinchi kirishda parolni o'zi almashtiradi.")
          : notice("", "Parolni siz o'zingiz kiritgansiz, shuning uchun u bu yerda ko'rsatilmaydi. Foydalanuvchi birinchi kirishda uni almashtiradi."),
      ];
      return { body, foot: [all, done] };
    },
  });
}

// ---------------------------------------------------------------------------
// Tugma yonida ochiladigan kichik menyu. Bir vaqtda faqat bittasi ochiq turadi.
// items: {icon, label, onSelect, danger} — tanlanadigan qator; {note} — izoh matni; {divider: true} — chiziq.
// Esc, tashqariga bosish, oyna o'lchamining o'zgarishi menyuni yopadi; ↑/↓ qatorlar bo'ylab yuradi.
// ---------------------------------------------------------------------------
let openPop = null;

export function popMenu({ opener, items, label = "Menyu", align = "end" }) {
  if (openPop) openPop.close(false);
  const btns = [];
  const nodes = items.map((it) => {
    if (it.note) return h("p", { class: "menu__note", role: "presentation" }, it.note);
    if (it.divider) return h("div", { class: "menu__sep", role: "separator" });
    const b = h("button", { class: "menu__item" + (it.danger ? " menu__item--danger" : ""), type: "button", role: "menuitem" }, it.icon ? icon(it.icon) : null, it.label);
    b.addEventListener("click", () => {
      pop.close(false);
      it.onSelect();
    });
    btns.push(b);
    return b;
  });
  const el = h("div", { class: "menu", role: "menu", "aria-label": label }, nodes);
  document.body.append(el);
  const r = opener.getBoundingClientRect();
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let top = r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  let left = align === "end" ? r.right - mw : r.left;
  left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - mw - 8));
  el.style.top = Math.round(top) + "px";
  el.style.left = Math.round(left) + "px";
  opener.setAttribute("aria-expanded", "true");

  const onDown = (e) => {
    if (!el.contains(e.target) && !opener.contains(e.target)) pop.close(false);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      pop.close(true);
    } else if (e.key === "Tab") {
      pop.close(false);
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && btns.length) {
      e.preventDefault();
      const i = btns.indexOf(document.activeElement);
      btns[(i + (e.key === "ArrowDown" ? 1 : -1) + btns.length) % btns.length].focus();
    }
  };
  const onResize = () => pop.close(false);
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onResize);
  const pop = {
    el,
    close(refocus = true) {
      if (openPop !== pop) return;
      openPop = null;
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      el.remove();
      opener.removeAttribute("aria-expanded");
      if (refocus && opener.isConnected) opener.focus();
    },
  };
  openPop = pop;
  if (btns.length) btns[0].focus();
  return pop;
}
