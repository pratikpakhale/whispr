const ALGO = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGO, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return bufferToBase64(raw);
}

export async function importKey(base64: string): Promise<CryptoKey> {
  const raw = base64ToBuffer(base64);
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(
  key: CryptoKey,
  plaintext: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bufferToBase64(combined.buffer);
}

export async function decrypt(
  key: CryptoKey,
  data: string
): Promise<string> {
  const combined = new Uint8Array(base64ToBuffer(data));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

export async function encryptBuffer(
  key: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    data
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return combined.buffer;
}

export async function decryptBuffer(
  key: CryptoKey,
  data: ArrayBuffer
): Promise<ArrayBuffer> {
  const combined = new Uint8Array(data);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  return crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
}

// --- Passphrase protection ---

const PBKDF2_ITERATIONS = 200_000;

export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(passphrase);
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoded,
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt.buffer as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptRoomKey(
  roomKey: CryptoKey,
  passphraseKey: CryptoKey
): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", roomKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    passphraseKey,
    raw
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bufferToBase64url(combined.buffer);
}

export async function decryptRoomKey(
  encryptedKey: string,
  passphraseKey: CryptoKey
): Promise<CryptoKey> {
  const combined = new Uint8Array(base64urlToBuffer(encryptedKey));
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const raw = await crypto.subtle.decrypt(
    { name: ALGO, iv },
    passphraseKey,
    ciphertext
  );
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, [
    "encrypt",
    "decrypt",
  ]);
}

// --- Base64url helpers (URL-safe, no padding) ---

function bufferToBase64url(buffer: ArrayBuffer): string {
  return bufferToBase64(buffer)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlToBuffer(b64url: string): ArrayBuffer {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return base64ToBuffer(b64);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
