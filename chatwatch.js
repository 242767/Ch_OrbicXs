// O'qilmagan xabarlar hisoblagichi: menyudagi nishon va sahifa sarlavhasi uchun.
// «Xabarlar» ekrani ochiq bo'lsa, hisoblagichni o'sha yangilaydi (report); yopiq bo'lsa, bu modul vaqti-vaqti bilan yengil so'rov yuboradi.
import { unreadTotal } from "./chatapi.js";

const FAST = 20000; // sahifa ko'rinib turganda
const SLOW = 60000; // fon oynasida

// Bu xatolardan keyin so'rashni to'xtatamiz: ruxsat yo'q, messenjer o'rnatilmagan yoki hisob yaroqsiz
const STOP = new Set(["no_permission", "chat_missing", "no_account", "blocked", "forbidden", "key_rejected"]);

export function createUnreadWatcher(onChange) {
  let count = 0;
  let timer = null;
  let alive = true;
  let stopped = false;
  let driven = false;
  let busy = false;
  let fails = 0;

  const set = (n) => {
    const v = Math.max(0, Math.floor(Number(n) || 0));
    if (v !== count) {
      count = v;
      onChange(v);
    }
  };
  const delay = () => (fails ? Math.min(120000, 15000 * 2 ** (fails - 1)) : document.visibilityState === "visible" ? FAST : SLOW);
  const plan = (ms) => {
    clearTimeout(timer);
    if (!alive || stopped || driven) return;
    timer = setTimeout(tick, ms === undefined ? delay() : ms);
  };

  async function tick() {
    if (!alive || stopped || driven || busy) return;
    busy = true;
    try {
      const n = await unreadTotal();
      if (alive && !driven) set(n);
      fails = 0;
    } catch (e) {
      if (e && (e.fatal || STOP.has(e.code))) {
        stopped = true;
        set(0);
      } else {
        fails++;
      }
    } finally {
      busy = false;
      plan();
    }
  }

  const wake = () => {
    if (document.visibilityState !== "visible") return;
    fails = 0;
    plan(0);
  };
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);

  return {
    get count() {
      return count;
    },
    start() {
      plan(0);
    },
    /** «Xabarlar» ekrani yangi hisoblagichni bildiradi. */
    report(n) {
      set(n);
    },
    /** Ekran ochilganda true (o'zi so'rash to'xtaydi), yopilganda false (darhol yangilanadi). */
    drive(v) {
      driven = !!v;
      if (driven) clearTimeout(timer);
      else plan(0);
    },
    destroy() {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    },
  };
}
