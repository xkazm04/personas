import type { HealthResult } from "@/features/vault/shared/hooks/health/useCredentialHealth";
import type { CredentialMetadata } from "@/lib/types/types";
import { matchCredentialToConnector } from "@/features/templates/sub_n8n/edit/connectorMatching";

/** Build a HealthResult from persisted credential metadata (no live check). */
export function healthFromMetadata(cred: CredentialMetadata): HealthResult | null {
  if (cred.healthcheck_last_success === null || cred.healthcheck_last_success === undefined) return null;
  return {
    success: cred.healthcheck_last_success,
    message: cred.healthcheck_last_message ?? '',
    lastSuccessfulTestAt: cred.healthcheck_last_tested_at ?? null,
    isStale: true,
  };
}

/** Derive a simple status from credential + definition. */
export function getConnectorStatus(
  connectorName: string,
  credentials: unknown[],
  buildLinks: Record<string, string>,
): { found: boolean; healthy: boolean | null; credName: string | null } {
  const creds = credentials as Array<Record<string, unknown>>;
  // Check explicit build link first
  const linkedId = buildLinks[connectorName];
  if (linkedId) {
    const cred = creds.find((c) => c.id === linkedId);
    if (cred) return { found: true, healthy: (cred.healthcheck_last_success as boolean | null) ?? null, credName: cred.name as string };
  }
  // Auto-match by service_type
  const match = matchCredentialToConnector(credentials as Parameters<typeof matchCredentialToConnector>[0], connectorName);
  if (match) {
    const m = match as unknown as Record<string, unknown>;
    return { found: true, healthy: (m.healthcheck_last_success as boolean | null) ?? null, credName: m.name as string };
  }
  return { found: false, healthy: null, credName: null };
}

interface ConnectorCardData {
  name: string;
  label?: string;
  icon?: string;
}

/** Check if all connectors in the cell have healthy credentials. Exported for cell state override. */
export function checkConnectorsHealth(
  connectors: ConnectorCardData[],
  credentials: unknown[],
  buildLinks: Record<string, string>,
): { allHealthy: boolean; unhealthyNames: string[] } {
  const unhealthy: string[] = [];
  for (const c of connectors) {
    const status = getConnectorStatus(c.name, credentials, buildLinks);
    if (!status.found || status.healthy !== true) {
      unhealthy.push(c.name);
    }
  }
  return { allHealthy: unhealthy.length === 0, unhealthyNames: unhealthy };
}
