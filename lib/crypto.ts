/**
 * AES-256-GCM encryption for sensitive values (access tokens, API keys).
 * Requires ENCRYPTION_KEY env var — 64 hex chars (32 bytes).
 */

const ALGO = "AES-GCM";
const IV_LENGTH = 12; // 96-bit IV for GCM

function getKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY must be set to 64 hex characters in production");
    }
    // Dev fallback — NOT secure, only for local development
    return "0".repeat(64);
  }
  return key;
}

async function importKey(hex: string): Promise<CryptoKey> {
  const bytes = Uint8Array.from(Buffer.from(hex, "hex"));
  return crypto.subtle.importKey("raw", bytes, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

/** Encrypt a plaintext string → base64 ciphertext (iv:ciphertext) */
export async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return plaintext;
  const key = await importKey(getKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);
  const ivHex = Buffer.from(iv).toString("hex");
  const cipherHex = Buffer.from(cipherBuf).toString("hex");
  return `${ivHex}:${cipherHex}`;
}

/** Decrypt a base64 ciphertext (iv:ciphertext) → plaintext */
export async function decrypt(ciphertext: string): Promise<string> {
  if (!ciphertext || !ciphertext.includes(":")) return ciphertext; // already plaintext (legacy)
  const key = await importKey(getKey());
  const [ivHex, cipherHex] = ciphertext.split(":");
  const iv = Uint8Array.from(Buffer.from(ivHex, "hex"));
  const cipherBuf = Uint8Array.from(Buffer.from(cipherHex, "hex"));
  const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipherBuf);
  return new TextDecoder().decode(plainBuf);
}

/** Check if a value looks encrypted (has our iv:cipher format) */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]+$/.test(value);
}
