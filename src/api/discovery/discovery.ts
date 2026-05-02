import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

/**
 * Single item returned by a connector discovery op — used to populate
 * dynamic option lists in the adoption questionnaire (Sentry projects,
 * codebase names, etc.).
 *
 * Mirrors the Rust `DiscoveredItem` struct in `engine/discovery.rs`.
 */
export interface DiscoveredItem {
  value: string;
  label: string;
  sublabel: string | null;
}

/**
 * Ask the backend to resolve a discovery op against a specific credential
 * and return a list of `{value, label, sublabel}` triples.
 *
 * `params` carries user-supplied values used by chained discovery ops
 * (e.g. a project slug the user already picked, interpolated as
 * `{{param.<key>}}` in the op's path template).
 */
export const discoverConnectorResources = (
  credentialId: string,
  serviceType: string,
  operation: string,
  params?: Record<string, string>,
) =>
  invoke<DiscoveredItem[]>("discover_connector_resources", {
    credentialId,
    serviceType,
    operation,
    params: params ?? {},
  });
