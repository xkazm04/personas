import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ApiProxyResponse } from "@/lib/bindings/ApiProxyResponse";
import type { ApiProxyCredentialMetrics } from "@/lib/bindings/ApiProxyCredentialMetrics";
import type { ApiEndpoint } from "@/lib/bindings/ApiEndpoint";
import type { ApiParameter } from "@/lib/bindings/ApiParameter";
import type { ApiRequestBody } from "@/lib/bindings/ApiRequestBody";
export type { ApiProxyResponse, ApiProxyCredentialMetrics, ApiEndpoint, ApiParameter, ApiRequestBody };

// -- API Proxy ----------------------------------------------------------

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

// -- API Proxy Metrics --------------------------------------------------

export const getApiProxyMetrics = () =>
  invoke<ApiProxyCredentialMetrics[]>('get_api_proxy_metrics', {});

// -- API Definition -----------------------------------------------------

export const parseApiDefinition = (rawSpec: string) =>
  invoke<ApiEndpoint[]>('parse_api_definition', { rawSpec });

export const saveApiDefinition = (credentialId: string, rawSpec: string) =>
  invoke<void>('save_api_definition', { credentialId, rawSpec });

export const loadApiDefinition = (credentialId: string) =>
  invoke<ApiEndpoint[] | null>('load_api_definition', { credentialId });
