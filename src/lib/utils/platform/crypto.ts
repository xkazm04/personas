import { getSessionPublicKey } from "@/api/vault/credentials";

let cachedPublicKey: CryptoKey | null = null;

/** Clear the cached session public key. Must be called on logout. */
export function clearCryptoCache(): void {
  cachedPublicKey = null;
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
    if (!cachedPublicKey) {
      const pem = await getSessionPublicKey();
      cachedPublicKey = await importPublicKey(pem);
    }

    // 1. Generate a random AES-256 key and 12-byte IV
    const aesKey = await window.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true, // extractable — we need the raw bytes to RSA-encrypt them
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
      cachedPublicKey,
      rawAesKey,
    );

    // 4. Combine IV + AES ciphertext
    const ivAndCiphertext = new Uint8Array(iv.length + aesCiphertext.byteLength);
    ivAndCiphertext.set(iv, 0);
    ivAndCiphertext.set(new Uint8Array(aesCiphertext), iv.length);

    // 5. Return as "rsaEncryptedKey.ivPlusCiphertext" (both base64)
    return arrayBufferToBase64(encryptedAesKey) + "." + arrayBufferToBase64(ivAndCiphertext.buffer);
  } catch (err) {
    console.error("Hybrid encryption failed:", err);
    const wrapped = new Error("Failed to encrypt sensitive data for IPC");
    (wrapped as unknown as { cause: unknown }).cause = err;
    throw wrapped;
  }
}
