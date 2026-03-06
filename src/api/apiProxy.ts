import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ──────────────────────────────────────────────────────────────

export interface ApiProxyResponse {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  duration_ms: number;
  content_type: string | null;
}

export interface ApiEndpoint {
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  parameters: ApiParameter[];
  request_body: ApiRequestBody | null;
  tags: string[];
}

export interface ApiParameter {
  name: string;
  location: string;
  required: boolean;
  schema_type: string | null;
  description: string | null;
}

export interface ApiRequestBody {
  content_type: string;
  schema_json: string | null;
  required: boolean;
}

// ── API Proxy ──────────────────────────────────────────────────────────

export const executeApiRequest = (
  credentialId: string,
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: string,
) =>
  invoke<ApiProxyResponse>('execute_api_request', {
    credentialId,
    method,
    path,
    headers,
    body: body || null,
  });

// ── API Definition ─────────────────────────────────────────────────────

export const parseApiDefinition = (rawSpec: string) =>
  invoke<ApiEndpoint[]>('parse_api_definition', { rawSpec });

export const saveApiDefinition = (credentialId: string, rawSpec: string) =>
  invoke<void>('save_api_definition', { credentialId, rawSpec });

export const loadApiDefinition = (credentialId: string) =>
  invoke<ApiEndpoint[] | null>('load_api_definition', { credentialId });
