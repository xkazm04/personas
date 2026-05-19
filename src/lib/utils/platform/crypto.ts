import { getSessionPublicKey } from "@/api/vault/credentials";
import { createLogger } from "@/lib/log";
import { extractMessage } from "@/lib/silentCatch";

const logger = createLogger("crypto");

/**
 * Public-key cache for hybrid IPC encryption.
 *
 * The backend session keypair can rotate without the frontend tearing down —
 * Tauri-window reload that doesn't restart the renderer, vault re-key, panic
 * recovery, or a keyring access denial that forces fallback re-init. Without
 * detection, a stale `cachedPublicKey` would silently encrypt with an
 * abandoned RSA key and the backend's decrypt would fail with a "Failed to
 * encrypt sensitive data for IPC" error indistinguishable from a transient
 * IPC fault.
 *
 * Strategy: cache the imported `CryptoKey` plus the raw PEM string and a
 * fetch timestamp. On every encrypt, if the cache is older than
 * `PUBLIC_KEY_REFRESH_INTERVAL_MS`, refetch the PEM (cheap IPC — backend
 * just reads a static) and compare. Only re-import the heavy CryptoKey when
 * the PEM actually changed. Backend rotation is detected within ~60s with no
 * backend signalling required; if a `session-key-rotated` Tauri event is ever
 * added, `clearCryptoCache()` continues to be the right hook.
 *
 * `clearCryptoCache()` is called on logout (the only event today that we
 * trust to invalidate the key synchronously); callers may also invoke it on
 * receiving any explicit rotation signal.
 */
let cachedPublicKey: CryptoKey | null = null;
let cachedPem: string | null = null;
let lastFetchAt = 0;

const PUBLIC_KEY_REFRESH_INTERVAL_MS = 60_000;

/** Clear the cached session public key. Must be called on logout AND on any
 *  explicit session-key rotation signal. */
export function clearCryptoCache(): void {
  cachedPublicKey = null;
  cachedPem = null;
  lastFetchAt = 0;
}

async function getOrRefreshSessionPublicKey(): Promise<CryptoKey> {
  const now = Date.now();
  if (cachedPublicKey && now - lastFetchAt < PUBLIC_KEY_REFRESH_INTERVAL_MS) {
    return cachedPublicKey;
  }
  const pem = await getSessionPublicKey();
  if (cachedPublicKey && pem === cachedPem) {
    // Same key as last time we checked; just renew the freshness stamp.
    lastFetchAt = now;
    return cachedPublicKey;
  }
  // PEM changed (or never fetched) — re-import as a fresh CryptoKey.
  cachedPem = pem;
  cachedPublicKey = await importPublicKey(pem);
  lastFetchAt = now;
  return cachedPublicKey;
}

/**
 * Import a PEM-formatted SPKI public key into a CryptoKey object.
 */
async function importPublicKey(pem: string): Promise<CryptoKey> {
  const pemHeader = "-----BEGIN PUBLIC KEY-----";
  const pemFooter = "-----END PUBLIC KEY-----";
  const pemContents = pem
    .replace(pemHeader, "")
    .replace(pemFooter, "")
    .replace(/\s/g, "");

  const binaryDerString = window.atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }

  return window.crypto.subtle.importKey(
    "spki",
    binaryDer.buffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return window.btoa(binary);
}

/**
 * Hybrid encrypt: AES-256-GCM for data, RSA-OAEP for the AES key.
 *
 * Output format: `base64(rsa_encrypted_aes_key).base64(iv || aes_ciphertext)`
 *
 * This avoids the RSA plaintext size limit (~190 bytes for 2048-bit OAEP/SHA-256)
 * which credential payloads regularly exceed.
 */
export async function encryptWithSessionKey(data: string): Promise<string> {
  try {
    const publicKey = await getOrRefreshSessionPublicKey();

    // 1. Generate a random AES-256 key and 12-byte IV
    const aesKey = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true, // extractable -- we need the raw bytes to RSA-encrypt them
      ["encrypt"],
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // 2. Encrypt data with AES-GCM
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    const aesCiphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      encodedData,
    );

    // 3. Export the raw AES key bytes (32 bytes) and encrypt with RSA-OAEP
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
    const encryptedAesKey = await window.crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      rawAesKey,
    );

    // 4. Combine IV + AES ciphertext
    const ivAndCiphertext = new Uint8Array(iv.length + aesCiphertext.byteLength);
    ivAndCiphertext.set(iv, 0);
    ivAndCiphertext.set(new Uint8Array(aesCiphertext), iv.length);

    // 5. Return as "rsaEncryptedKey.ivPlusCiphertext" (both base64)
    return arrayBufferToBase64(encryptedAesKey) + "." + arrayBufferToBase64(ivAndCiphertext.buffer);
  } catch (err) {
    logger.error("Hybrid encryption failed", { detail: extractMessage(err) });
    const wrapped = new Error("Failed to encrypt sensitive data for IPC");
    (wrapped as unknown as { cause: unknown }).cause = err;
    throw wrapped;
  }
}
