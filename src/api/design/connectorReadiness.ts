import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

import type { ConnectorReadinessEntry } from '@/lib/bindings/ConnectorReadinessEntry';

/**
 * Batch-resolve connector readiness through the AUTHORITATIVE Rust resolver
 * (`commands::design::connector_readiness`) — the same one that gates real
 * execution and writes `personas.setup_status`.
 *
 * Browsing surfaces must never re-derive readiness in TypeScript: the retired
 * `installed && has_credential` heuristic disagreed with the resolver by
 * construction (zero-config / native / aggregate connectors read as not-ready;
 * an unbindable credential row read as ready), so a card could promise a
 * template the run gate would then block.
 *
 * ONE call per data change, not one per card — the resolver can spawn (cached,
 * bounded) provider-CLI probes, so per-connector IPC would be an N+1.
 *
 * Names are de-duplicated case-insensitively and blanks dropped backend-side;
 * the result is NOT positionally aligned with the request. Look entries up by
 * name.
 */
export const connectorReadinessBatch = (connectors: string[]) =>
  invoke<ConnectorReadinessEntry[]>('connector_readiness_batch', { connectors });
