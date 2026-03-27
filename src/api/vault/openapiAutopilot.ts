import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { OpenApiParseResult } from "@/lib/bindings/OpenApiParseResult";
import type { GeneratedConnectorResult } from "@/lib/bindings/GeneratedConnectorResult";
import type { PlaygroundTestResult } from "@/lib/bindings/PlaygroundTestResult";

export const openapiParseFromUrl = (url: string) =>
  invoke<OpenApiParseResult>("openapi_parse_from_url", { url });

export const openapiParseFromContent = (content: string) =>
  invoke<OpenApiParseResult>("openapi_parse_from_content", { content });

export const openapiGenerateConnector = (
  parsed: OpenApiParseResult,
  selectedEndpoints?: number[],
  customName?: string,
  customColor?: string,
) =>
  invoke<GeneratedConnectorResult>("openapi_generate_connector", {
    parsed,
    selectedEndpoints,
    customName,
    customColor,
  });

export const openapiPlaygroundTest = (
  baseUrl: string,
  path: string,
  method: string,
  headers: Record<string, string>,
  queryParams: Record<string, string>,
  body?: string,
) =>
  invoke<PlaygroundTestResult>("openapi_playground_test", {
    baseUrl,
    path,
    method,
    headers,
    queryParams,
    body,
  });
