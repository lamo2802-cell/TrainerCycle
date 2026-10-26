// Web Push with only WebCrypto: a VAPID-signed request (RFC 8292) carrying a payload encrypted for the
// browser's subscription keys (RFC 8291, aes128gcm). No npm packages, so it runs the same in Deno and Node.

export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey; subject: string };

const enc = new TextEncoder();
export const b64u = (b: Uint8Array) => {
  let s = ""; b.forEach((x) => s += String.fromCharCode(x));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export const unb64u = (s: string) => {
  const t = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(t, (c) => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0; for (const p of parts) { out.set(p, i); i += p.length; }
  return out;
};
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

async function vapidHeader(endpoint: string, keys: VapidKeys) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.publicKey}`;
}

export async function encrypt(sub: Subscription, payload: Uint8Array) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(payload, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

// Returns the push service's HTTP status: 201 sent, 404/410 the subscription is gone.
export async function sendPush(sub: Subscription, data: unknown, keys: VapidKeys, ttl = 4 * 3600) {
  const body = await encrypt(sub, enc.encode(JSON.stringify(data)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidHeader(sub.endpoint, keys), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: "normal" },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
