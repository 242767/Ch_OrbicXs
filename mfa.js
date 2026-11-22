// Ikki bosqichli tasdiq (2FA, Authenticator ilovasi): kodni tasdiqlash ekrani, qurilmani ulash ekrani va kabinetdagi qurilmalar bo'limi.
// Kod faqat Supabase Auth'ga boradi (api.js: mfaEnroll / mfaVerify / mfaUnenroll); bu fayl faqat ekranlarni chizadi.
import { h, icon, fmtDate, copyText } from "../dom.js";
import * as api from "../api.js";
import { busy, confirmDialog, dialog, errorText, field, notice, toast } from "../ui.js";
import { introFrame } from "./intro.js";

// 6 xonali kod maydoni: faqat raqamlar qoladi (probel va boshqa belgilar o'chadi), telefon klaviaturasi raqamli ochiladi,
// brauzer/parol boshqaruvchisi kodni o'zi to'ldira oladi (autocomplete="one-time-code").
function codeField({ label = "6 xonali kod", hint } = {}) {
  const input = h("input", {
    class: "input input--code",
    type: "text",
    name: "otp",
    inputmode: "numeric",
    autocomplete: "one-time-code",
    maxlength: 12,
    placeholder: "000000",
    spellcheck: "false",
    autocapitalize: "none",
    "aria-required": "true",
  });
  input.addEventListener("input", () => {
    const d = input.value.replace(/\D/g, "").slice(0, 6);
    if (d !== input.value) input.value = d;
  });
  const f = field({ label, hint, input });
  return {
    el: f.el,
    input,
    error: f.error,
    get digits() {
      return input.value.replace(/\D/g, "");
    },
  };
}

const groups = (secret) => String(secret).replace(/=+$/, "").replace(/(.{4})/g, "$1 ").trim();

// ---------------------------------------------------------------------------
// Qurilmani ulash paneli: QR kod → ilovadagi kod → tasdiqlash. To'liq ekranli ulash va kabinetdagi oyna shuni ishlatadi.
// onEnrolled() — kod tasdiqlangach (seans aal2 ga ko'tarilgan); onCancel — bekor qilish tugmasi kerak bo'lsa.
// ---------------------------------------------------------------------------
export function enrollPanel({ onEnrolled, onCancel = null }) {
  let factor = null;
  let verified = false;
  let alive = true;
  let gen = 0;
  const box = h("div", { class: "mfa" });

  function cancel() {
    dispose();
    if (onCancel) onCancel();
  }
  const cancelBtn = () => (onCancel ? h("button", { class: "btn btn--quiet", type: "button", onclick: cancel }, "Bekor qilish") : null);

  function paintLoading() {
    box.replaceChildren(h("div", { class: "skel skel--qr", "aria-hidden": "true" }), h("p", { class: "section__sub", role: "status" }, "QR kod tayyorlanmoqda…"));
  }

  function paintFail(e) {
    box.replaceChildren(
      notice(e && e.code === "mfa_disabled" ? "warn" : "bad", errorText(e)),
      h("div", { class: "section__actions" }, h("button", { class: "btn btn--primary", type: "button", onclick: start }, icon("refresh"), "Qayta urinish"), cancelBtn()),
    );
  }

  function paintReady() {
    const f = factor;
    const code = codeField({ hint: "Kod ilovada har 30 soniyada yangilanadi." });
    const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
    const btn = h("button", { class: "btn btn--primary", type: "submit" }, "Tasdiqlash va yoqish");
    const copy = h("button", { class: "btn btn--ghost btn--sm", type: "button" }, icon("copy"), "Kalitni nusxalash");
    copy.addEventListener("click", async () => {
      const ok = await copyText(f.secret);
      toast(ok ? "ok" : "error", ok ? "Kalit nusxalandi." : "Nusxalab bo'lmadi. Kalitni qo'lda belgilab nusxalang.");
    });
    const qr = f.qr
      ? h("div", { class: "qr" }, h("img", { src: f.qr, alt: "Authenticator ilovasi uchun QR kod", width: 200, height: 200 }))
      : notice("warn", "QR kodni ko'rsatib bo'lmadi. Quyidagi kalitni ilovaga qo'lda kiriting.");
    const manual = h(
      "details",
      { class: "manual", open: !f.qr },
      h("summary", null, "Skaner qila olmayapsizmi? Kalitni qo'lda kiriting"),
      h("p", { class: "field__hint" }, "Ilovada «Kalit kiritish» (Enter a setup key) ni tanlang, hisob nomi sifatida «OrbicXs» deb yozing, turi — vaqtga asoslangan (Time based)."),
      h("p", { class: "secret num", dataset: { secret: "true" } }, groups(f.secret)),
      h("div", { class: "section__actions" }, copy),
    );
    const form = h(
      "form",
      {
        class: "form",
        novalidate: true,
        async onsubmit(e) {
          e.preventDefault();
          err.hidden = true;
          code.error("");
          const digits = code.digits;
          if (digits.length !== 6) {
            code.error("Kod 6 ta raqamdan iborat bo'lsin.");
            code.input.focus();
            return;
          }
          await busy(btn, async () => {
            try {
              await api.mfaVerify(f.id, digits);
              verified = true;
              await onEnrolled();
            } catch (ex) {
              if (!alive || (ex && ex.fatal)) return;
              if (ex.code === "factor_missing") {
                // Tugallanmagan qurilma bir necha daqiqada o'chib ketadi: yangi QR kod beriladi
                toast("warn", "QR kodning muddati tugadi. Yangisi yaratildi: uni ilovada qayta skanerlang.");
                start();
                return;
              }
              code.input.value = "";
              if (ex.code === "bad_code") {
                code.error(errorText(ex));
                code.input.focus();
              } else {
                err.textContent = errorText(ex);
                err.hidden = false;
              }
            }
          });
        },
      },
      code.el,
      err,
      h("div", { class: "section__actions" }, btn, cancelBtn()),
    );
    box.replaceChildren(
      h(
        "ol",
        { class: "steps" },
        h("li", null, h("p", { class: "steps__t" }, "Telefoningizga Authenticator ilovasini o'rnating."), h("p", { class: "field__hint" }, "Google Authenticator, Microsoft Authenticator, Authy, 2FAS yoki shunga o'xshash istalgan ilova mos keladi.")),
        h("li", null, h("p", { class: "steps__t" }, "Ilovada hisob qo'shing va QR kodni skanerlang."), qr, manual),
        h("li", null, h("p", { class: "steps__t" }, "Ilovada ko'ringan 6 xonali kodni kiriting."), form),
      ),
    );
  }

  async function start() {
    const mine = ++gen;
    factor = null;
    paintLoading();
    try {
      const f = await api.mfaEnroll();
      if (!alive || mine !== gen) {
        api.mfaDiscard(f.id);
        return;
      }
      factor = f;
      paintReady();
    } catch (e) {
      if (!alive || mine !== gen || (e && e.fatal)) return;
      paintFail(e);
    }
  }

  // Panel yopilganda tasdiqlanmagan qurilma tashlab yuboriladi (tasdiqlangani hech qachon o'chmaydi)
  function dispose() {
    alive = false;
    gen++;
    if (factor && !verified) api.mfaDiscard(factor.id);
  }

  return { el: box, start, dispose };
}

// ---------------------------------------------------------------------------
// To'liq ekranli: administrator har safar kirganda (yoki tasdiq muddati tugaganda) kodni kiritadi
// ---------------------------------------------------------------------------
export function mfaVerifyView({ account, factors, onVerified, onSignOut }) {
  const code = codeField({ label: "Tasdiqlash kodi", hint: "Ilovadagi 6 xonali kod har 30 soniyada yangilanadi." });
  const err = h("div", { class: "notice notice--bad", role: "alert", hidden: true });
  const btn = h("button", { class: "btn btn--primary btn--block", type: "submit" }, "Tasdiqlash");
  const sel = factors.length > 1 ? h("select", { class: "select", name: "factor" }, factors.map((f) => h("option", { value: f.id }, f.name || "Authenticator"))) : null;
  const selField = sel ? field({ label: "Qurilma", input: sel }) : null;
  const factorId = () => (sel ? sel.value : factors.length ? factors[0].id : "");

  const form = h(
    "form",
    {
      class: "form",
      novalidate: true,
      async onsubmit(e) {
        e.preventDefault();
        err.hidden = true;
        code.error("");
        const digits = code.digits;
        if (digits.length !== 6) {
          code.error("Kod 6 ta raqamdan iborat bo'lsin.");
          code.input.focus();
          return;
        }
        await busy(btn, async () => {
          try {
            await api.mfaVerify(factorId(), digits);
            await onVerified();
          } catch (ex) {
            if (ex && ex.fatal) return;
            code.input.value = "";
            if (ex.code === "bad_code") {
              code.error(errorText(ex));
              code.input.focus();
            } else {
              err.textContent = errorText(ex);
              err.hidden = false;
            }
          }
        });
      },
    },
    selField ? selField.el : null,
    code.el,
    err,
    btn,
  );

  const view = introFrame(
    [
      h(
        "div",
        { class: "intro__head" },
        h("span", { class: "intro__sign intro__sign--warn" }, icon("shield")),
        h("h1", null, "Tasdiqlash kodi"),
        h("p", null, "Salom, " + account.display_name + ". Administrator hisobi ikki bosqichli tasdiq bilan himoyalangan: Authenticator ilovasidagi kodni kiriting."),
      ),
      form,
      h(
        "details",
        { class: "manual manual--center" },
        h("summary", null, "Kodni kirita olmayapsizmi?"),
        h("p", { class: "field__hint" }, "Telefoningiz yo'qolgan yoki ilova o'chib ketgan bo'lsa, boshqa administrator «Foydalanuvchilar» bo'limida sizning 2FA qurilmangizni tiklab bera oladi. Yagona administrator bo'lsangiz, qo'llanmadagi 3-2fa-tiklash.sql faylidan foydalaning."),
      ),
      h("div", { class: "intro__actions" }, h("button", { class: "btn btn--quiet", type: "button", onclick: onSignOut }, "Chiqish")),
    ],
    { plain: true },
  );
  return { el: view, focus: () => code.input.focus() };
}

// ---------------------------------------------------------------------------
// To'liq ekranli: administratorda hali qurilma yo'q — davom etishdan oldin ulash shart
// ---------------------------------------------------------------------------
export function mfaEnrollView({ account, onEnrolled, onSignOut }) {
  const panel = enrollPanel({ onEnrolled });
  const view = introFrame(
    [
      h(
        "div",
        { class: "intro__head" },
        h("span", { class: "intro__sign intro__sign--warn" }, icon("shield")),
        h("h1", null, "Ikki bosqichli tasdiqni yoqing"),
        h("p", null, "Salom, " + account.display_name + ". Administrator hisobi uchun bu majburiy: parolga qo'shimcha ravishda telefondagi Authenticator ilovasi kodi so'raladi. Sozlash bir marta, taxminan bir daqiqa oladi."),
      ),
      panel.el,
      h("div", { class: "intro__actions" }, h("button", { class: "btn btn--quiet", type: "button", onclick: onSignOut }, "Chiqish")),
    ],
    { plain: true },
  );
  return { el: view, start: panel.start, dispose: panel.dispose };
}

// ---------------------------------------------------------------------------
// Kabinetdagi bo'lim (administrator): ulangan qurilmalar, yangisini qo'shish, olib tashlash
// ---------------------------------------------------------------------------
export function mfaCard(ctx) {
  const list = h("div", { class: "sess", role: "list", "aria-label": "Ulangan qurilmalar" });
  const sub = h("p", { class: "section__sub" });
  const addBtn = h("button", { class: "btn btn--ghost", type: "button", dataset: { act: "mfa-add" }, onclick: () => addDevice() }, icon("plus"), "Qurilma qo'shish");
  const devices = () => ctx.mfa.factors.filter((f) => f.verified);

  function row(f) {
    const name = f.name || "Authenticator";
    const btn = h("button", { class: "btn btn--ghost btn--sm", type: "button", dataset: { act: "mfa-remove" }, "aria-label": "Qurilmani olib tashlash — " + name }, "Olib tashlash");
    btn.addEventListener("click", () => removeDevice(f));
    return h(
      "div",
      { class: "sess__row", role: "listitem", dataset: { fid: f.id } },
      h("span", { class: "sess__ico", "aria-hidden": "true" }, icon("phone")),
      h("div", { class: "sess__main" }, h("div", { class: "sess__title" }, h("span", { class: "sess__name" }, name)), h("div", { class: "sess__meta" }, h("span", null, "Ulangan: " + fmtDate(f.createdAt)))),
      btn,
    );
  }

  function paint() {
    sub.textContent = ctx.mfa.required
      ? "Administrator hisobi har kirishda parolga qo'shimcha ravishda telefondagi Authenticator ilovasi kodini so'raydi. Telefonni almashtirsangiz, avval yangisini ulang, so'ng eskisini olib tashlang."
      : "Serverda ikki bosqichli tasdiq talabi o'chirilgan (REQUIRE_AAL2), shuning uchun hozir kod so'ralmaydi.";
    const devs = devices();
    list.replaceChildren(...(devs.length ? devs.map(row) : [h("div", { class: "empty empty--tight" }, h("p", null, "Hali qurilma ulanmagan."))]));
  }

  async function refresh() {
    try {
      if (await ctx.afterMfaChange()) paint();
    } catch (e) {
      if (e && e.fatal) return;
      toast("error", errorText(e));
    }
  }

  async function addDevice() {
    const done = await dialog({
      title: "Yangi qurilma ulash",
      wide: true,
      backdrop: false,
      build(close, dlg) {
        const panel = enrollPanel({ onEnrolled: () => close(true), onCancel: () => close(undefined) });
        dlg.addEventListener("close", () => panel.dispose());
        panel.start();
        return { body: panel.el };
      },
    });
    if (!done) return;
    toast("ok", "Yangi qurilma ulandi.");
    await refresh();
  }

  async function removeDevice(f) {
    const last = devices().length <= 1;
    const r = await confirmDialog({
      title: "Qurilmani olib tashlaysizmi?",
      lead:
        last && ctx.mfa.required
          ? "Bu oxirgi qurilma. Olib tashlasangiz, hisobingiz ikki bosqichli tasdiqsiz qoladi va darhol yangi qurilma ulashingiz so'raladi."
          : "Bu qurilmadagi Authenticator kodi endi ishlamaydi.",
      confirmText: "Olib tashlash",
      danger: true,
      run: () => api.mfaUnenroll(f.id),
    });
    if (!r) return;
    toast("ok", "Qurilma olib tashlandi.");
    await refresh();
  }

  const el = h(
    "section",
    { class: "section", "aria-labelledby": "cab-mfa" },
    h("h2", { id: "cab-mfa" }, "Ikki bosqichli tasdiq"),
    sub,
    list,
    h("div", { class: "section__actions" }, addBtn),
  );
  paint();
  return { el, paint };
}
