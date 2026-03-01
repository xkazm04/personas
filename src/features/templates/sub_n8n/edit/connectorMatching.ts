import type { PersonaCredential } from '@/lib/types/types';

/**
 * Canonical credential-to-connector matching.
 *
 * Ranking strategy (highest priority first):
 * 1. Exact service_type match
 * 2. Prefix match (service_type starts with connector name or vice versa)
 * 3. Credential name contains connector name (case-insensitive)
 */
export function matchCredentialToConnector(
  credentials: PersonaCredential[],
  connectorName: string,
): PersonaCredential | null {
  // 1. Exact service_type match
  const exact = credentials.find((c) => c.service_type === connectorName);
  if (exact) return exact;

  // 2. Prefix match (either direction) — only if unambiguous (single match)
  const prefixMatches = credentials.filter(
    (c) =>
      c.service_type.startsWith(connectorName) ||
      connectorName.startsWith(c.service_type),
  );
  if (prefixMatches.length === 1) return prefixMatches[0]!;

  // 3. Name includes (case-insensitive)
  const lower = connectorName.toLowerCase();
  const nameMatch = credentials.find((c) =>
    c.name.toLowerCase().includes(lower),
  );
  if (nameMatch) return nameMatch;

  return null;
}

/**
 * Partition credentials into "matching" (best matches first) and "others"
 * for a credential picker dropdown.
 */
export function rankCredentialsForConnector(
  credentials: PersonaCredential[],
  connectorName: string,
): { matching: PersonaCredential[]; others: PersonaCredential[] } {
  const lower = connectorName.toLowerCase();

  const matching: PersonaCredential[] = [];
  const others: PersonaCredential[] = [];

  // Pre-compute prefix matches to detect ambiguity
  const prefixHits = new Set(
    credentials
      .filter(
        (c) =>
          c.service_type.startsWith(connectorName) ||
          connectorName.startsWith(c.service_type),
      )
      .map((c) => c.id),
  );
  const prefixUnambiguous = prefixHits.size === 1;

  for (const cred of credentials) {
    const isExact = cred.service_type === connectorName;
    const isPrefix = prefixUnambiguous && prefixHits.has(cred.id);
    const isNameMatch = cred.name.toLowerCase().includes(lower);

    if (isExact || isPrefix || isNameMatch) {
      matching.push(cred);
    } else {
      others.push(cred);
    }
  }

  return { matching, others };
}
