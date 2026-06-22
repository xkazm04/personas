import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/**
 * Qwen remote-engine configuration (Phase 1 split engine).
 *
 * The API key lives in the OS keyring (set via `set_qwen_credentials`); the
 * base URL is an app setting. `get_qwen_status` never returns the key — only
 * whether one is configured plus the effective base URL / default model.
 */
export interface QwenStatus {
  configured: boolean;
  baseUrl: string;
  model: string;
}

export const getQwenStatus = () => invoke<QwenStatus>('get_qwen_status');

export const setQwenCredentials = (apiKey: string, baseUrl?: string) =>
  invoke<void>('set_qwen_credentials', { apiKey, baseUrl });

export const clearQwenCredentials = () => invoke<void>('clear_qwen_credentials');
