import { invoke } from "@tauri-apps/api/core";

// ── Types ──────────────────────────────────────────────────────────────

export type ForageSource =
  | "aws_credentials"
  | "aws_config"
  | "kube_config"
  | "env_var"
  | "dot_env"
  | "npmrc"
  | "docker_config"
  | "git_hub_cli"
  | "ssh_key"
  | "git_config";

export type ForageConfidence = "high" | "medium" | "low";

export interface ForagedCredential {
  id: string;
  label: string;
  service_type: string;
  source: ForageSource;
  fields: Record<string, string>;
  already_imported: boolean;
  confidence: ForageConfidence;
}

export interface ForagingScanResult {
  credentials: ForagedCredential[];
  scanned_sources: string[];
  scan_duration_ms: number;
}

export interface ForageImportResult {
  id: string;
  name: string;
  service_type: string;
  field_count: number;
}

// ── API calls ──────────────────────────────────────────────────────────

export const scanCredentialSources = () =>
  invoke<ForagingScanResult>("scan_credential_sources");

export const importForagedCredential = (
  foragedId: string,
  credentialName: string,
  serviceType: string,
) =>
  invoke<ForageImportResult>("import_foraged_credential", {
    foragedId,
    credentialName,
    serviceType,
  });
