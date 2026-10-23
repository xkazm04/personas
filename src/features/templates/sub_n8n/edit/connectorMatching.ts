/**
 * Structural credential shape used by connector-matching. Accepts either
 * `CredentialLike` (camelCase wire shape) or any frontend type that
 * mirrors `serviceType`. Callers passing `CredentialMetadata` (snake_case
 * `service_type`) must map at the call site until that derived type is
 * also migrated.
 */
export type CredentialLike = { id: string; name: string; serviceType: string };

/** Minimum connector name length for fuzzy (prefix / substring) matching. */
export const MIN_FUZZY_LENGTH = 4;

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
  credentials: CredentialLike[],
  connectorName: string,
): CredentialLike | null {
  // 1. Exact service_type match
  const exact = credentials.find((c) => c.serviceType === connectorName);
  if (exact) return exact;

  if (connectorName.length < MIN_FUZZY_LENGTH) return null;

  // 2. Prefix match (either direction) -- only if unambiguous (single match)
  const prefixMatches = credentials.filter(
    (c) =>
      c.serviceType.startsWith(connectorName) ||
      connectorName.startsWith(c.serviceType),
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
