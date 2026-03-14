/**
 * Credential coverage validation for the promotion gate.
 *
 * Computes whether all tools that require credentials have corresponding
 * credential links configured. Used by the build lifecycle to gate promotion
 * from draft to production.
 */
import type { PersonaToolDefinition } from "@/lib/bindings/PersonaToolDefinition";

/** Result of a credential coverage check. */
export interface CoverageResult {
  /** True when every required credential type has a matching link. */
  covered: boolean;
  /** Credential types that are required but not linked. */
  missing: string[];
  /** Total number of unique required credential types. */
  total: number;
  /** Number of required credential types that have links. */
  linked: number;
}

/**
 * Compute credential coverage for a set of tools.
 *
 * Collects unique `requires_credential_type` values from non-null tool
 * definitions, compares them against the keys of `credentialLinks`, and
 * returns a coverage summary.
 *
 * @param tools - Persona tool definitions (may include tools without credential requirements)
 * @param credentialLinks - Map of credential type to credential ID, or null
 */
export function computeCredentialCoverage(
  tools: PersonaToolDefinition[],
  credentialLinks: Record<string, string> | null,
): CoverageResult {
  const links = credentialLinks ?? {};

  // Collect unique required credential types (filter out null/undefined)
  const requiredTypes = new Set<string>();
  for (const tool of tools) {
    if (tool.requires_credential_type != null) {
      requiredTypes.add(tool.requires_credential_type);
    }
  }

  const total = requiredTypes.size;
  const missing: string[] = [];

  for (const type of requiredTypes) {
    if (!(type in links)) {
      missing.push(type);
    }
  }

  const linked = total - missing.length;

  return {
    covered: missing.length === 0,
    missing,
    total,
    linked,
  };
}
