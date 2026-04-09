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

export const signDocument = (filePath: string, metadata?: string) =>
  invoke<SignDocumentResult>("sign_document", { filePath, metadata });

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
