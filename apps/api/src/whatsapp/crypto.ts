/**
 * Tokens of the locals are encrypted at rest with AES-GCM. `WHATSAPP_TOKEN_KEY` is the 32-byte key in
 * base64; the stored value is `base64(iv || ciphertext)` (the 12-byte IV goes first).
 */

const IV_BYTES = 12;

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const key = bytesFromBase64(keyBase64);
  if (key.length !== 32) throw new Error("WHATSAPP_TOKEN_KEY must be 32 bytes in base64");
  return crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(keyBase64: string, token: string): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)),
  );
  const payload = new Uint8Array(iv.length + ciphertext.length);
  payload.set(iv);
  payload.set(ciphertext, iv.length);
  return base64FromBytes(payload);
}

export async function decryptToken(keyBase64: string, payloadBase64: string): Promise<string> {
  const key = await importKey(keyBase64);
  const payload = bytesFromBase64(payloadBase64);
  if (payload.length <= IV_BYTES) throw new Error("Invalid encrypted WhatsApp token");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: payload.slice(0, IV_BYTES) },
    key,
    payload.slice(IV_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}
