import { useCallback, useEffect, useState } from "react";

import { listCredentials } from "@/api/vault/credentials";
import type { PersonaCredential } from "@/lib/bindings/PersonaCredential";
import { silentCatch } from "@/lib/silentCatch";

/**
 * Detects whether a Google Gemini credential is connected in the vault and
 * exposes the first matching credential's metadata so the Drive OCR flow
 * can gate its UI + pass the credential ID to the backend wrapper.
 *
 * The decrypted API key is never held on the frontend — the Rust
 * `ocr_drive_file_gemini` command resolves it server-side.
 */
export function useOcr() {
  const [credentials, setCredentials] = useState<PersonaCredential[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    listCredentials()
      .then((rows) => setCredentials(rows))
      .catch(silentCatch("drive:ocr:credentials"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const geminiCredential = credentials.find(
    (c) => c.service_type === "google_gemini",
  );

  return {
    loading,
    hasGemini: Boolean(geminiCredential),
    geminiCredentialId: geminiCredential?.id ?? null,
    geminiCredentialName: geminiCredential?.name ?? null,
    refresh,
  };
}

/**
 * True when a drive entry's mime or extension is OCR-eligible (image or
 * pdf). Used to decide whether to show the "Extract text" context menu
 * entry for a given file.
 */
export function isOcrEligible(mime: string | null, ext: string | null): boolean {
  if (mime?.startsWith("image/")) return true;
  if (mime === "application/pdf") return true;
  const e = (ext ?? "").toLowerCase();
  return ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif", "pdf"].includes(e);
}
