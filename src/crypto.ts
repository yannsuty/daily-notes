const SALT = new TextEncoder().encode('daily-note-v1-salt');
const PBKDF2_ITERATIONS = 100_000;

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
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

async function deriveKey(passphrase: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveSyncId(passphrase: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(passphrase),
  );
  return bufferToBase64(hash);
}

export async function encryptPayload(
  passphrase: string,
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await deriveKey(passphrase);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: bufferToBase64(encrypted),
    iv: bufferToBase64(iv.buffer),
  };
}

export async function decryptPayload(
  passphrase: string,
  ciphertext: string,
  iv: string,
): Promise<string> {
  const key = await deriveKey(passphrase);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64ToBuffer(iv)) },
    key,
    base64ToBuffer(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

const PASSPHRASE_STORAGE_KEY = 'daily-note-passphrase';

export function storePassphrase(passphrase: string): void {
  localStorage.setItem(PASSPHRASE_STORAGE_KEY, passphrase);
}

export function getStoredPassphrase(): string | null {
  return localStorage.getItem(PASSPHRASE_STORAGE_KEY);
}

export function clearStoredPassphrase(): void {
  localStorage.removeItem(PASSPHRASE_STORAGE_KEY);
}
