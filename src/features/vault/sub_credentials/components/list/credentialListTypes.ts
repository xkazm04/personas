import { collectAllTags, getCredentialTags } from '@/features/vault/shared/utils/credentialTags';
import { computeHealthScore } from '@/features/vault/shared/utils/credentialHealthScore';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';

/** Well-known service names for quick-start buttons. Matched by connector `name`. */
export const QUICK_START_SERVICES = ['openai', 'slack', 'github', 'linear'] as const;

export type HealthFilter = 'all' | 'healthy' | 'unverifiable' | 'failing' | 'untested';
export type SortKey = 'name' | 'type' | 'created' | 'last-used' | 'health';

/**
 * Three-valued health of a credential, mirroring the backend `HealthProbeState`
 * (engine/healthcheck.rs):
 * - `verified`     — a live probe ran and passed
 * - `unverifiable` — the connector has no live probe; stored but not checkable
 * - `failed`       — a live probe ran and failed
 * - `untested`     — never probed
 */
export type HealthState = 'verified' | 'unverifiable' | 'failed' | 'untested';

/**
 * Read the typed health state from a credential. Prefers the persisted
 * `healthcheck_last_state` token (written by the backend probe path); falls back
 * to the legacy `healthcheck_last_success` boolean for credentials probed before
 * the typed state landed. Both come from persisted metadata — no re-probe.
 */
export function readCredentialHealthState(cred: CredentialMetadata): HealthState {
  const parsed = parseJsonOrDefault<Record<string, unknown> | null>(cred.metadata, null);
  const token = parsed?.healthcheck_last_state;
  if (token === 'verified' || token === 'unverifiable' || token === 'failed') {
    return token;
  }
  if (cred.healthcheck_last_success === null) return 'untested';
  return cred.healthcheck_last_success ? 'verified' : 'failed';
}

export function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function healthFilterLabel(f: HealthFilter): string {
  switch (f) {
    case 'all': return 'All health';
    case 'healthy': return 'Healthy';
    case 'unverifiable': return 'Unverifiable';
    case 'failing': return 'Failing';
    case 'untested': return 'Untested';
  }
}

export function sortLabel(s: SortKey): string {
  switch (s) {
    case 'name': return 'Name';
    case 'type': return 'Type';
    case 'created': return 'Created';
    case 'last-used': return 'Last used';
    case 'health': return 'Health status';
  }
}

export interface CredentialListProps {
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  searchTerm?: string;
  onDelete: (id: string) => void;
  onQuickStart?: (connector: ConnectorDefinition) => void;
  onGoToCatalog?: () => void;
  onGoToAddNew?: () => void;
  onWorkspaceConnect?: () => void;
}

export interface GroupedCredentials {
  category: string;
  items: { credential: CredentialMetadata; connector?: ConnectorDefinition }[];
}

export interface CredentialFilterOptions {
  searchTerm?: string;
  selectedTags?: string[];
  healthFilter?: HealthFilter;
  /** Connector category filter; empty string = all categories. */
  categoryFilter?: string;
  /** Sort direction; defaults to 'asc' for name/type, 'desc' for created/last-used, asc for health. */
  sortDirection?: 'asc' | 'desc';
  sortKey: SortKey;
}

export function filterAndSortCredentials(
  credentials: CredentialMetadata[],
  options: CredentialFilterOptions,
  getConnectorForType: (type: string) => ConnectorDefinition | undefined,
): CredentialMetadata[] {
  const {
    searchTerm,
    selectedTags = [],
    healthFilter = 'all',
    categoryFilter = '',
    sortDirection,
    sortKey,
  } = options;

  let result = credentials;

  // Text search
  const q = (searchTerm ?? '').trim().toLowerCase();
  if (q) {
    result = result.filter((credential) => {
      const connector = getConnectorForType(credential.service_type);
      return (
        credential.name.toLowerCase().includes(q)
        || credential.service_type.toLowerCase().includes(q)
        || connector?.label.toLowerCase().includes(q)
      );
    });
  }

  // Tag filter
  if (selectedTags.length > 0) {
    result = result.filter((cred) => {
      const tags = getCredentialTags(cred);
      return selectedTags.some((t) => tags.includes(t));
    });
  }

  // Category filter (post-lookup against connector definition)
  if (categoryFilter) {
    result = result.filter((cred) => {
      const conn = getConnectorForType(cred.service_type);
      return (conn?.category || 'other') === categoryFilter;
    });
  }

  // Health filter — three-valued so "Healthy" means genuinely verified, not
  // merely "not failed" (which would sweep in unverifiable credentials).
  if (healthFilter !== 'all') {
    result = result.filter((cred) => {
      const state = readCredentialHealthState(cred);
      if (healthFilter === 'untested') return state === 'untested';
      if (healthFilter === 'healthy') return state === 'verified';
      if (healthFilter === 'unverifiable') return state === 'unverifiable';
      if (healthFilter === 'failing') return state === 'failed';
      return true;
    });
  }

  // Sort
  const dir = sortDirection === 'desc' ? -1 : 1;
  const sorted = [...result];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return dir * a.name.localeCompare(b.name);
      case 'type': {
        const aLabel = getConnectorForType(a.service_type)?.label || a.service_type;
        const bLabel = getConnectorForType(b.service_type)?.label || b.service_type;
        return dir * aLabel.localeCompare(bLabel);
      }
      case 'created':
        // Default for "created" remains newest-first when no explicit direction provided.
        return sortDirection === undefined
          ? new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          : dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      case 'last-used': {
        const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return sortDirection === undefined ? bTime - aTime : dir * (aTime - bTime);
      }
      case 'health': {
        const toResult = (m: CredentialMetadata) =>
          m.healthcheck_last_success !== null
            ? { success: m.healthcheck_last_success, message: m.healthcheck_last_message ?? '' }
            : null;
        const scoreA = computeHealthScore(toResult(a), null).score;
        const scoreB = computeHealthScore(toResult(b), null).score;
        return dir * (scoreA - scoreB);
      }
      default:
        return 0;
    }
  });

  return sorted;
}

export function groupCredentials(
  filteredCredentials: CredentialMetadata[],
  sortKey: SortKey,
  getConnectorForType: (type: string) => ConnectorDefinition | undefined,
): GroupedCredentials[] {
  if (sortKey !== 'name') {
    return [{ category: '', items: filteredCredentials.map((cred) => ({ credential: cred, connector: getConnectorForType(cred.service_type) })) }];
  }
  const groups: Record<string, { credential: CredentialMetadata; connector?: ConnectorDefinition }[]> = {};
  for (const cred of filteredCredentials) {
    const conn = getConnectorForType(cred.service_type);
    const cat = conn?.category || 'other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ credential: cred, connector: conn });
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, items]) => ({ category: cat, items }));
}

export { collectAllTags };
