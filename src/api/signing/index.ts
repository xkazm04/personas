import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface DocumentSignature {
  id: string;
  file_name: string;
  file_path: string | null;
  file_hash: string;
  signature_b64: string;
  signer_peer_id: string;
  signer_public_key_b64: string;
  signer_display_name: string;
  metadata: string | null;
  signed_at: string;
  created_at: string;
}

export interface SignDocumentResult {
  signature: DocumentSignature;
  sidecar_json: string;
}

export interface VerifyDocumentResult {
  valid: boolean;
  signer_peer_id: string;
  signer_display_name: string;
  signed_at: string;
  file_hash_match: boolean;
  signature_valid: boolean;
  error: string | null;
}

export const generateSigningKey = () =>
  invoke<{ peer_id: string; display_name: string; status: string }>("generate_signing_key");

export class SignDocumentRejectedError extends Error {
  constructor(reason: string) {
    super(`signDocument refused: ${reason}`);
    this.name = "SignDocumentRejectedError";
  }
}

// SENSITIVE PATH GUARD — TRUST STATEMENT (read this before changing).
//
// This array is checked by `signDocument` (below) before invoking the Tauri
// `sign_document` command. It refuses paths that match obvious secret /
// private-key / wallet locations.
//
// Trust assumption: backend enforcement of the same allowlist has NOT been
// verified by this audit (the Rust side was out of scope for the
// 2026-04-27 ambiguity audit). Until a contract test pairs this list with
// the backend's allowlist, treat this guard as the PRIMARY gate, not
// defense in depth — a future persona tool that calls
// `invoke("sign_document", …)` directly would bypass this check entirely
// and could sign arbitrary credential files. If you find yourself wanting
// to call the IPC directly, route through `signDocument` instead, or
// confirm the backend enforces these patterns and update this comment.
//
// Pattern shape: each regex must match its documented threat AND fail
// against innocuous paths that share substrings (e.g. `private_key` was
// previously over-broad — `Documents/private_key_lecture_notes.md` would
// have matched and been silently blocked. Patterns now require a path
// boundary plus a real key extension or a literal `.key` suffix).
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]credentials/i,
  /[/\\]\.config[/\\]gcloud[/\\]/i,
  /[/\\]id_rsa(\.|$)/i,
  /[/\\]id_ed25519(\.|$)/i,
  /[/\\]id_ecdsa(\.|$)/i,
  /[/\\]id_dsa(\.|$)/i,
  /\.(pem|p12|pfx|key|jks|keystore)$/i,
  // Tightened: must end with a key-bearing extension OR be a bare
  // `private_key` / `private-key` filename. Avoids matching unrelated
  // notes, lectures, or directories that happen to contain the substring.
  /[/\\]private[_-]?key(\.(pem|p12|pfx|key|jks|keystore|asc|gpg|pub|der|crt|cer|p7b))?$/i,
  /[/\\]wallet\.dat$/i,
  /[/\\]\.npmrc$/i,
  /[/\\]\.netrc$/i,
];

function isSensitivePath(filePath: string): boolean {
  return SENSITIVE_PATH_PATTERNS.some((re) => re.test(filePath));
}

export const signDocument = (filePath: string, metadata?: string) => {
  if (isSensitivePath(filePath)) {
    return Promise.reject(
      new SignDocumentRejectedError(
        "path matches a sensitive credential pattern (private key / vault / cloud credentials). " +
          "Pick a different file via the Drive picker.",
      ),
    );
  }
  return invoke<SignDocumentResult>("sign_document", { filePath, metadata });
};

export const verifyDocument = (filePath: string, sidecarJson: string) =>
  invoke<VerifyDocumentResult>("verify_document", {
    input: { file_path: filePath, sidecar_json: sidecarJson },
  });

export const listDocumentSignatures = () =>
  invoke<DocumentSignature[]>("list_document_signatures");

export const deleteDocumentSignature = (id: string) =>
  invoke<boolean>("delete_document_signature", { id });

export const exportSignatureSidecar = (id: string) =>
  invoke<string>("export_signature_sidecar", { id });

export const writeSidecarFile = (filePath: string, content: string) =>
  invoke<void>("write_sidecar_file", { filePath, content });

export const readSidecarFile = (filePath: string) =>
  invoke<string>("read_sidecar_file", { filePath });
