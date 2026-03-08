import type { SuggestedConnector } from '@/lib/types/designTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { matchCredentialToConnector } from './connectorMatching';

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

/**
 * Cross-reference detected connectors from AgentIR against the user's
 * existing credentials. Returns a per-connector readiness assessment.
 */
export function analyzeCredentialGaps(
  connectors: SuggestedConnector[],
  credentials: CredentialMetadata[],
  selectedConnectorNames?: Set<string>,
): CredentialGapResult {
  // Adapt CredentialMetadata[] to the PersonaCredential shape expected by matchCredentialToConnector
  const asPersonaCreds = credentials.map((c) => ({
    id: c.id,
    name: c.name,
    service_type: c.service_type,
    metadata: c.metadata,
    last_used_at: c.last_used_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  }));

  let readyCount = 0;
  let ambiguousCount = 0;
  let missingCount = 0;

  const entries: CredentialGapEntry[] = connectors
    .filter((c) => !selectedConnectorNames || selectedConnectorNames.has(c.name))
    .map((connector) => {
      const match = matchCredentialToConnector(asPersonaCreds, connector.name);

      if (match) {
        // Check if there are multiple potential matches (ambiguous)
        const lower = connector.name.toLowerCase();
        const allMatches = credentials.filter(
          (c) =>
            c.service_type === connector.name ||
            (connector.name.length >= 4 && (
              c.service_type.startsWith(connector.name) ||
              connector.name.startsWith(c.service_type) ||
              c.name.toLowerCase().includes(lower)
            )),
        );

        if (allMatches.length > 1) {
          ambiguousCount++;
          return {
            connector,
            status: 'ambiguous' as const,
            matchedCredential: credentials.find((c) => c.id === match.id) ?? null,
            ambiguousCandidates: allMatches,
          };
        }

        readyCount++;
        return {
          connector,
          status: 'ready' as const,
          matchedCredential: credentials.find((c) => c.id === match.id) ?? null,
          ambiguousCandidates: [],
        };
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
