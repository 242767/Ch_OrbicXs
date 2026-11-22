// Butun ekranli xabarlar: hisob bloklangan, kirish ruxsati yo'q, server sozlanmagan, sayt sozlanmagan.
import { h, icon } from "../dom.js";
import { notice } from "../ui.js";
import { introFrame } from "./intro.js";

// actions: [{text, onclick, primary}]
export function noticeView({ title, text, actions = [], extra = null, tone = "warn" }) {
  return introFrame(
    [
      h("div", { class: "intro__head" }, h("span", { class: "intro__sign intro__sign--" + tone }, icon(tone === "bad" ? "ban" : "info")), h("h1", null, title), h("p", null, text)),
      extra,
      actions.length
        ? h(
            "div",
            { class: "intro__actions" },
            actions.map((a) => h("button", { class: "btn " + (a.primary ? "btn--primary" : "btn--ghost") + " btn--block", type: "button", onclick: a.onclick }, a.text)),
          )
        : null,
    ],
    { plain: true },
  );
}

// Server tomoni sozlanmaganida: funksiya joylanganmi/sozlanganmi — qisqa tashxis (kirish talab qilinmaydi)
export function diagnosisBox(ping) {
  const box = notice("", "Tekshirilmoqda…");
  box.hidden = true;
  ping().then((p) => {
    const msg = {
      ready: "Funksiya joylangan va ishlayapti" + (p.version ? " (v" + p.version + ")" : "") + ". Muammo uning sozlamalarida yoki ma'lumotlar bazasida bo'lishi mumkin.",
      unconfigured: "Funksiya joylangan, lekin uning Supabase kalitlari/manzili topilmayapti. Edge Functions → Secrets bo'limini tekshiring.",
      missing: "Funksiya Supabase'da topilmadi. Uni joylang (qo'llanma, 5-qadam).",
      gateway: "Supabase funksiyaga ruxsat bermayapti: «Verify JWT» o'chirilganini tekshiring.",
      key: "Supabase sayt kalitini qabul qilmadi: config.js dagi SUPABASE_KEY (Publishable key) to'g'ri ekanini tekshiring.",
      offline: "Supabase'ga ulanib bo'lmadi. Internetni va config.js dagi SUPABASE_URL ni tekshiring.",
      unknown: "Funksiya kutilmagan javob qaytardi (" + (p.status || "?") + ").",
    }[p.state];
    if (msg) {
      box.textContent = "Tashxis: " + msg;
      box.hidden = false;
    }
  });
  return box;
}
