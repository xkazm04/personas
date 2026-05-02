import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/**
 * Signal an in-flight OCR run to abort. Resolves to `true` if the token
 * was found and cancelled, `false` if the operation already finished or
 * was never registered.
 */
export const cancelOcrOperation = (operationId: string) =>
  invoke<boolean>("cancel_ocr_operation", { operationId });
