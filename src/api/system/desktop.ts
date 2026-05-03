import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DiscoveredApp } from "@/lib/bindings/DiscoveredApp";
import type { ImportedMcpServer } from "@/lib/bindings/ImportedMcpServer";
import type { DesktopCapability } from "@/lib/bindings/DesktopCapability";
import type { DesktopConnectorManifest } from "@/lib/bindings/DesktopConnectorManifest";
import type { Translations } from "@/i18n/en";
export type { DiscoveredApp, ImportedMcpServer, DesktopCapability, DesktopConnectorManifest };

// -- Capability metadata ------------------------------------------------

type CapabilityLabelKey = keyof Translations["vault"]["desktop_discovery"]["capabilities"];

export const CAPABILITY_INFO: Record<
  DesktopCapability,
  { labelKey: CapabilityLabelKey; descriptionKey: CapabilityLabelKey; risk: "low" | "medium" | "high" }
> = {
  file_read: {
    labelKey: "file_read_label",
    descriptionKey: "file_read_description",
    risk: "low",
  },
  file_write: {
    labelKey: "file_write_label",
    descriptionKey: "file_write_description",
    risk: "high",
  },
  process_spawn: {
    labelKey: "process_spawn_label",
    descriptionKey: "process_spawn_description",
    risk: "high",
  },
  network_local: {
    labelKey: "network_local_label",
    descriptionKey: "network_local_description",
    risk: "medium",
  },
  clipboard_read: {
    labelKey: "clipboard_read_label",
    descriptionKey: "clipboard_read_description",
    risk: "medium",
  },
  notify: {
    labelKey: "notify_label",
    descriptionKey: "notify_description",
    risk: "low",
  },
  env_read: {
    labelKey: "env_read_label",
    descriptionKey: "env_read_description",
    risk: "low",
  },
  system_api: {
    labelKey: "system_api_label",
    descriptionKey: "system_api_description",
    risk: "high",
  },
};

// -- Desktop Discovery --------------------------------------------------

export const discoverDesktopApps = () =>
  invoke<DiscoveredApp[]>("discover_desktop_apps", {});

export const importClaudeMcpServers = () =>
  invoke<ImportedMcpServer[]>("import_claude_mcp_servers", {});

export const getDesktopConnectorManifest = (connectorName: string) =>
  invoke<DesktopConnectorManifest | null>("get_desktop_connector_manifest", {
    connectorName,
  });

export const approveDesktopCapabilities = (
  connectorName: string,
  capabilities: DesktopCapability[],
) =>
  invoke<void>("approve_desktop_capabilities", {
    connectorName,
    capabilities,
  });

export const registerImportedMcpServer = (
  server: ImportedMcpServer,
  credentialName: string,
) =>
  invoke<string>("register_imported_mcp_server", { server, credentialName });
