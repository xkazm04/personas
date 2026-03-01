import { getSessionPublicKey } from "@/api/credentials";

let cachedPublicKey: CryptoKey | null = null;

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

/**
 * Encrypt a string using the session-specific RSA public key.
 * Returns a base64-encoded ciphertext.
 * The public key is fetched from the backend on the first call and cached.
 */
export async function encryptWithSessionKey(data: string): Promise<string> {
  try {
    if (!cachedPublicKey) {
      const pem = await getSessionPublicKey();
      cachedPublicKey = await importPublicKey(pem);
    }

    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
      {
        name: "RSA-OAEP",
      },
      cachedPublicKey,
      encodedData
    );

    const bytes = new Uint8Array(encryptedBuffer);
    const binary = String.fromCharCode(...bytes);
    return window.btoa(binary);
  } catch (err) {
    console.error("RSA encryption failed:", err);
    throw new Error("Failed to encrypt sensitive data for IPC");
  }
}
