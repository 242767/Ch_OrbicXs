// OrbicXs — push bildirishnoma yuboruvchi (Supabase Edge Function, Deno).
//
// Bazadagi trigger (1-sozlash.sql) yangi xabar kelganda shu funksiyani chaqiradi
// va qabul qiluvchining obunalarini yuboradi. Tashqi kutubxona kerak emas:
// faqat WebCrypto va fetch. Standartlar: RFC 8291 (aes128gcm) va RFC 8292 (VAPID).
//
// Kerakli sirlar (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEBHOOK_SECRET

const enc = new TextEncoder();

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
type Vapid = { publicKey: string; privateKey: string; subject: string };

function b64uToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64u(u: Uint8Array): string {
  let s = "";
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

// VAPID: push xizmatiga "bu xabarni shu sayt yubormoqda" deb ishonch beruvchi imzolangan token
async function vapidJwt(audience: string, v: Vapid): Promise<string> {
  const pub = b64uToBytes(v.publicKey);
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: v.privateKey,
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
  };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const body = bytesToB64u(enc.encode(JSON.stringify({ aud: audience, exp, sub: v.subject })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${bytesToB64u(new Uint8Array(sig))}`;
}

// Xabar matnini faqat qabul qiluvchining brauzeri ocha oladigan qilib shifrlaydi
async function encryptPayload(sub: Sub, payload: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64uToBytes(sub.keys.p256dh);
  const authSecret = b64uToBytes(sub.keys.auth);

  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));

  const keyInfo = concat(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = concat(payload, new Uint8Array([2])); // 0x02 = oxirgi (yagona) blok
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, record));

  const header = new Uint8Array(21); // salt(16) + blok hajmi(4) + kalit uzunligi(1)
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export async function sendWebPush(sub: Sub, message: string, vapid: Vapid) {
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, vapid);
  const body = await encryptPayload(sub, enc.encode(message));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body,
  });
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status, ok: res.ok, gone: res.status === 404 || res.status === 410 };
}

function validSub(s: any): s is Sub {
  return !!s && typeof s.endpoint === "string" && s.endpoint.startsWith("https://") &&
    typeof s.keys?.p256dh === "string" && typeof s.keys?.auth === "string";
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  if (!secret || !sameSecret(req.headers.get("x-webhook-secret") ?? "", secret)) {
    return json({ error: "unauthorized" }, 401);
  }

  const vapid: Vapid = {
    publicKey: Deno.env.get("VAPID_PUBLIC_KEY") ?? "",
    privateKey: Deno.env.get("VAPID_PRIVATE_KEY") ?? "",
    subject: Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
  };
  if (!vapid.publicKey || !vapid.privateKey) return json({ error: "VAPID kalitlari sirlarda yo'q" }, 500);

  let data: any;
  try {
    data = await req.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const subs: Sub[] = (Array.isArray(data?.subscriptions) ? data.subscriptions : []).filter(validSub).slice(0, 10);
  const message = JSON.stringify({
    title: String(data?.title ?? "OrbicXs").slice(0, 80),
    body: String(data?.body ?? "").slice(0, 160),
    url: String(data?.url ?? "./"),
  });

  const results = await Promise.all(
    subs.map((s) =>
      sendWebPush(s, message, vapid).catch((e) => ({ status: 0, ok: false, gone: false, error: String(e) }))
    ),
  );
  for (const r of results) if (!r.ok) console.error("push xatosi:", JSON.stringify(r));
  return json({ sent: results.filter((r) => r.ok).length, total: subs.length, statuses: results.map((r) => r.status) });
}

Deno.serve(handle);
