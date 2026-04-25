import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface OcrDocument {
  id: string;
  file_name: string;
  file_path: string | null;
  provider: string;
  model: string | null;
  extracted_text: string;
  structured_data: string | null;
  prompt: string | null;
  duration_ms: number;
  token_count: number | null;
  created_at: string;
}

export interface OcrResult {
  document: OcrDocument;
  raw_response: string | null;
}

export const ocrWithGemini = (
  filePath: string,
  apiKey: string,
  model?: string,
  prompt?: string,
  operationId?: string,
) => invoke<OcrResult>("ocr_with_gemini", { filePath, apiKey, model, prompt, operationId });

export const ocrWithClaude = (filePath: string, prompt?: string) =>
  invoke<OcrResult>("ocr_with_claude", { filePath, prompt }, undefined, 300_000);

/**
 * Signal an in-flight OCR run to abort. Resolves to `true` if the token
 * was found and cancelled, `false` if the operation already finished or
 * was never registered.
 */
export const cancelOcrOperation = (operationId: string) =>
  invoke<boolean>("cancel_ocr_operation", { operationId });

export const listOcrDocuments = () =>
  invoke<OcrDocument[]>("list_ocr_documents");

export const deleteOcrDocument = (id: string) =>
  invoke<boolean>("delete_ocr_document", { id });
