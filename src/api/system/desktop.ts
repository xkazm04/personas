import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DiscoveredApp } from "@/lib/bindings/DiscoveredApp";
import type { ImportedMcpServer } from "@/lib/bindings/ImportedMcpServer";
import type { DesktopCapability } from "@/lib/bindings/DesktopCapability";
import type { DesktopConnectorManifest } from "@/lib/bindings/DesktopConnectorManifest";
export type { DiscoveredApp, ImportedMcpServer, DesktopCapability, DesktopConnectorManifest };

// -- Capability metadata ------------------------------------------------

export const CAPABILITY_INFO: Record<
  DesktopCapability,
  { label: string; description: string; risk: "low" | "medium" | "high" }
> = {
  file_read: {
    label: "File Read",
    description: "Read files from your filesystem",
    risk: "low",
  },
  file_write: {
    label: "File Write",
    description: "Create or modify files on your filesystem",
    risk: "high",
  },
  process_spawn: {
    label: "Launch Apps",
    description: "Launch desktop applications",
    risk: "high",
  },
  network_local: {
    label: "Local Network",
    description: "Connect to services running on your machine",
    risk: "medium",
  },
  clipboard_read: {
    label: "Clipboard",
    description: "Read your clipboard contents",
    risk: "medium",
  },
  notify: {
    label: "Notifications",
    description: "Send desktop notifications",
    risk: "low",
  },
  env_read: {
    label: "Environment",
    description: "Read environment variables",
    risk: "low",
  },
  system_api: {
    label: "System API",
    description: "Use OS APIs to control applications",
    risk: "high",
  },
};

// -- Desktop Discovery --------------------------------------------------

export const discoverDesktopApps = () =>
  invoke<DiscoveredApp[]>("discover_desktop_apps", {});

export const discoverDesktopClis = () =>
  invoke<DiscoveredApp[]>("discover_desktop_clis", {});

export const importClaudeMcpServers = () =>
  invoke<ImportedMcpServer[]>("import_claude_mcp_servers", {});

export const getDesktopConnectorManifest = (connectorName: string) =>
  invoke<DesktopConnectorManifest | null>("get_desktop_connector_manifest", {
    connectorName,
  });

export const getPendingDesktopCapabilities = (connectorName: string) =>
  invoke<DesktopCapability[]>("get_pending_desktop_capabilities", {
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

export const revokeDesktopApprovals = (connectorName: string) =>
  invoke<void>("revoke_desktop_approvals", { connectorName });

export const isDesktopConnectorApproved = (connectorName: string) =>
  invoke<boolean>("is_desktop_connector_approved", { connectorName });

export const registerImportedMcpServer = (
  server: ImportedMcpServer,
  credentialName: string,
) =>
  invoke<string>("register_imported_mcp_server", { server, credentialName });
