// OrbicXs platformasi — sayt sozlamalari. Shu fayldagi ikkita qiymatni o'zingizniki bilan almashtiring.
//
// SUPABASE_URL   Supabase → Project Settings → API (yoki "Connect" oynasi) → Project URL.  Masalan: https://abcdxyz.supabase.co
// SUPABASE_KEY   Shu sahifadagi "Publishable key" (sb_publishable_...) yoki eski loyihalarda "anon" kalit.
//
// DIQQAT: bu fayl hammaga ochiq. Bu yerga HECH QACHON "Secret key" (sb_secret_...) yoki "service_role" kalitini qo'ymang.
// Sayt bunday kalitni sezsa, ishlashdan bosh tortadi — lekin kalit allaqachon GitHub'ga tushgan bo'lsa, uni Supabase'da almashtiring.
//
// LOGIN_DOMAIN   2-birinchi-admin.sql va ox-api dagi bilan bir xil bo'lsin. O'zgartirishga hojat yo'q.
// FUNCTION_NAME  Supabase'ga joylangan funksiya nomi (qo'llanmada: ox-api).

export default {
  SUPABASE_URL: "https://LOYIHA-ID.supabase.co",
  SUPABASE_KEY: "sb_publishable_SHU_YERGA_QO'YING",
  LOGIN_DOMAIN: "orbicxs.internal",
  FUNCTION_NAME: "ox-api",
};
