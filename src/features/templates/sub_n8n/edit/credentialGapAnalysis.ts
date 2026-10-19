import type { SuggestedConnector } from '@/lib/types/designTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { matchCredentialToConnector, MIN_FUZZY_LENGTH } from './connectorMatching';

export type CredentialGapStatus = 'ready' | 'ambiguous' | 'missing';

export interface CredentialGapEntry {
  connector: SuggestedConnector;
  status: CredentialGapStatus;
  /** Matched credential when status is 'ready'. */
  matchedCredential: CredentialMetadata | null;
  /** Multiple potential matches when status is 'ambiguous'. */
  ambiguousCandidates: CredentialMetadata[];
}

export interface CredentialGapResult {
  entries: CredentialGapEntry[];
  readyCount: number;
  ambiguousCount: number;
  missingCount: number;
}

/** Exact service type, or (for names long enough to be specific) a prefix in
 *  either direction or the connector name inside the credential's name. */
function isCandidate(c: CredentialMetadata, connectorName: string): boolean {
  if (c.service_type === connectorName) return true;
  if (connectorName.length < MIN_FUZZY_LENGTH) return false;
  return c.service_type.startsWith(connectorName)
    || connectorName.startsWith(c.service_type)
    || c.name.toLowerCase().includes(connectorName.toLowerCase());
}

/**
 * Cross-reference detected connectors from AgentIR against the user's
 * existing credentials. Returns a per-connector readiness assessment.
 */
export function analyzeCredentialGaps(
  connectors: SuggestedConnector[],
  credentials: CredentialMetadata[],
  selectedConnectorNames?: Set<string>,
): CredentialGapResult {
  // Adapt CredentialMetadata[] (snake_case) to CredentialLike (camelCase serviceType)
  // expected by matchCredentialToConnector.
  const asPersonaCreds = credentials.map((c) => ({
    id: c.id,
    name: c.name,
    serviceType: c.service_type,
  }));

  let readyCount = 0;
  let ambiguousCount = 0;
  let missingCount = 0;

  const entries: CredentialGapEntry[] = connectors
    .filter((c) => !selectedConnectorNames || selectedConnectorNames.has(c.name))
    .map((connector) => {
      // Every credential that could serve this connector. Counted BEFORE the
      // single-pick matcher: matchCredentialToConnector refuses an ambiguous
      // prefix (two `google_*` items for `google`) by returning null, and
      // reading that null as "missing" told the user to add a credential they
      // already had twice.
      const candidates = credentials.filter((c) => isCandidate(c, connector.name));
      const match = matchCredentialToConnector(asPersonaCreds, connector.name);
      const matchedCredential = match ? credentials.find((c) => c.id === match.id) ?? null : null;

      if (candidates.length > 1) {
        ambiguousCount++;
        return { connector, status: 'ambiguous' as const, matchedCredential, ambiguousCandidates: candidates };
      }

      if (candidates.length === 1) {
        readyCount++;
        return { connector, status: 'ready' as const, matchedCredential: candidates[0]!, ambiguousCandidates: [] };
      }

      missingCount++;
      return {
        connector,
        status: 'missing' as const,
        matchedCredential: null,
        ambiguousCandidates: [],
      };
    });

  return { entries, readyCount, ambiguousCount, missingCount };
}
