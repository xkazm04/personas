import type { PersonaCredential } from '@/lib/types/types';

/** Minimum connector name length for fuzzy (prefix / substring) matching. */
const MIN_FUZZY_LENGTH = 4;

/**
 * Canonical credential-to-connector matching.
 *
 * Ranking strategy (highest priority first):
 * 1. Exact service_type match
 * 2. Prefix match (service_type starts with connector name or vice versa)
 * 3. Credential name contains connector name (case-insensitive)
 *
 * Steps 2 & 3 are skipped when the connector name is shorter than
 * {@link MIN_FUZZY_LENGTH} to avoid vacuous matches on short generic
 * names like "api", "db", or "http".
 */
export function matchCredentialToConnector(
  credentials: PersonaCredential[],
  connectorName: string,
): PersonaCredential | null {
  // 1. Exact service_type match
  const exact = credentials.find((c) => c.service_type === connectorName);
  if (exact) return exact;

  if (connectorName.length < MIN_FUZZY_LENGTH) return null;

  // 2. Prefix match (either direction) -- only if unambiguous (single match)
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

  const fuzzyEligible = connectorName.length >= MIN_FUZZY_LENGTH;

  // Pre-compute prefix matches to detect ambiguity
  const prefixHits = fuzzyEligible
    ? new Set(
        credentials
          .filter(
            (c) =>
              c.service_type.startsWith(connectorName) ||
              connectorName.startsWith(c.service_type),
          )
          .map((c) => c.id),
      )
    : new Set<string>();
  const prefixUnambiguous = prefixHits.size === 1;

  for (const cred of credentials) {
    const isExact = cred.service_type === connectorName;
    const isPrefix = prefixUnambiguous && prefixHits.has(cred.id);
    const isNameMatch = fuzzyEligible && cred.name.toLowerCase().includes(lower);

    if (isExact || isPrefix || isNameMatch) {
      matching.push(cred);
    } else {
      others.push(cred);
    }
  }

  return { matching, others };
}
