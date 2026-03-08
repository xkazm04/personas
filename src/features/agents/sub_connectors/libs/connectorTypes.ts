export interface ConnectorStatus {
  name: string;
  credentialId: string | null;
  credentialName: string | null;
  testing: boolean;
  result: { success: boolean; message: string } | null;
  /** Transient error from the last credential link attempt. */
  linkError: string | null;
}

// ── Connector readiness ──────────────────────────────────────────────
//
// Execution requires a linked credential (any readiness except 'unlinked').
// A passing healthcheck ('healthy') is recommended but not strictly required —
// connectors with 'linked_untested' or 'unhealthy' status will attempt execution
// but may fail at runtime.

export type ConnectorReadiness =
  | 'unlinked'        // no credential linked — blocks execution
  | 'linked_untested' // credential linked, not yet tested
  | 'healthy'         // credential linked, healthcheck passed
  | 'unhealthy';      // credential linked, healthcheck failed

export function deriveReadiness(status: ConnectorStatus): ConnectorReadiness {
  if (!status.credentialId) return 'unlinked';
  if (!status.result) return 'linked_untested';
  return status.result.success ? 'healthy' : 'unhealthy';
}

/** True if the connector has a linked credential (minimum for execution). */
export function isExecutionReady(status: ConnectorStatus): boolean {
  return deriveReadiness(status) !== 'unlinked';
}

// ── UI status config ─────────────────────────────────────────────────

export const STATUS_CONFIG = {
  ready: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Ready' },
  untested: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Untested' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Failed' },
  missing: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'No credential' },
  testing: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Testing...' },
} as const;

export function getStatusKey(status: ConnectorStatus): keyof typeof STATUS_CONFIG {
  if (status.testing) return 'testing';
  if (!status.credentialId) return 'missing';
  if (!status.result) return 'untested';
  return status.result.success ? 'ready' : 'failed';
}
