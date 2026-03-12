import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// -- Types --------------------------------------------------------------

export interface DiscoveredApp {
  connector_name: string;
  label: string;
  installed: boolean;
  binary_path: string | null;
  version: string | null;
  running: boolean;
  category: string;
}

export interface ImportedMcpServer {
  name: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  source: string;
}

export type DesktopCapability =
  | "file_read"
  | "file_write"
  | "process_spawn"
  | "network_local"
  | "clipboard_read"
  | "notify"
  | "env_read"
  | "system_api";

export interface DesktopConnectorManifest {
  connector_id: string;
  capabilities: DesktopCapability[];
  allowed_binaries: string[];
  allowed_paths: string[];
  allowed_ports: number[];
  justifications: Record<string, string>;
}

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
