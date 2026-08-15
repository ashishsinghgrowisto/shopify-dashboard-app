// lib/crypto.js
// Envelope encryption for access tokens at rest.
//
// A public app holds a live Admin API token for every merchant that installs it.
// Those tokens are the whole ballgame: one leak reads every client's analytics.
// Shopify's Level 2 protected-customer-data requirements call for encryption at
// rest, and "the database volume is encrypted" is a weaker claim than "the
// column is ciphertext even to someone holding a database dump".
//
// AES-256-GCM, random 12-byte IV per value, auth tag appended. Stored as
// `v1:<base64 iv>:<base64 ciphertext+tag>` so the prefix can carry a future
// scheme without a migration.

import crypto from "crypto";

const PREFIX = "v1";
const IV_BYTES = 12;

let warned = false;

function keyBuffer() {
  const raw = process.env.APP_ENCRYPTION_KEY || "";
  if (!raw.trim()) return null;

  // Accept base64 (preferred, 32 bytes) or a long passphrase, which we hash to
  // 32 bytes so a human-typed value still produces a valid key.
  const buf = Buffer.from(raw.trim(), "base64");
  if (buf.length === 32) return buf;
  return crypto.createHash("sha256").update(raw.trim(), "utf8").digest();
}

export function encryptionAvailable() {
  return keyBuffer() !== null;
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    "[crypto] APP_ENCRYPTION_KEY is not set — access tokens are being stored in " +
      "plaintext. Generate one with `openssl rand -base64 32` and set it before " +
      "onboarding merchants through the public app."
  );
}

export function encryptToken(plaintext) {
  const key = keyBuffer();
  if (!key) {
    warnOnce();
    return plaintext;
  }
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${Buffer.concat([enc, tag]).toString("base64")}`;
}

export function decryptToken(stored) {
  if (!stored) return stored;
  const s = String(stored);

  // Written before a key was configured, or by a deployment without one.
  if (!s.startsWith(PREFIX + ":")) return s;

  const key = keyBuffer();
  if (!key) {
    throw new Error(
      "A stored token is encrypted but APP_ENCRYPTION_KEY is not set on this deployment"
    );
  }

  const [, ivB64, payloadB64] = s.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  const tag = payload.subarray(payload.length - 16);
  const body = payload.subarray(0, payload.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
