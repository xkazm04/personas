import { collectAllTags, getCredentialTags } from '@/features/vault/shared/utils/credentialTags';
import { computeHealthScore } from '@/features/vault/shared/utils/credentialHealthScore';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

/** Well-known service names for quick-start buttons. Matched by connector `name`. */
export const QUICK_START_SERVICES = ['openai', 'slack', 'github', 'linear'] as const;

export type HealthFilter = 'all' | 'healthy' | 'failing' | 'untested';
export type SortKey = 'name' | 'created' | 'last-used' | 'health';

export function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function healthFilterLabel(f: HealthFilter): string {
  switch (f) {
    case 'all': return 'All health';
    case 'healthy': return 'Healthy';
    case 'failing': return 'Failing';
    case 'untested': return 'Untested';
  }
}

export function sortLabel(s: SortKey): string {
  switch (s) {
    case 'name': return 'Name';
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

export function filterAndSortCredentials(
  credentials: CredentialMetadata[],
  searchTerm: string | undefined,
  selectedTags: string[],
  healthFilter: HealthFilter,
  sortKey: SortKey,
  getConnectorForType: (type: string) => ConnectorDefinition | undefined,
): CredentialMetadata[] {
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

  // Health filter
  if (healthFilter !== 'all') {
    result = result.filter((cred) => {
      if (healthFilter === 'untested') return cred.healthcheck_last_success === null;
      if (healthFilter === 'healthy') return cred.healthcheck_last_success === true;
      if (healthFilter === 'failing') return cred.healthcheck_last_success === false;
      return true;
    });
  }

  // Sort
  const sorted = [...result];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'created':
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case 'last-used': {
        const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
        const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
        return bTime - aTime;
      }
      case 'health': {
        const toResult = (m: CredentialMetadata) =>
          m.healthcheck_last_success !== null
            ? { success: m.healthcheck_last_success, message: m.healthcheck_last_message ?? '' }
            : null;
        const scoreA = computeHealthScore(toResult(a), null).score;
        const scoreB = computeHealthScore(toResult(b), null).score;
        return scoreA - scoreB;
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
