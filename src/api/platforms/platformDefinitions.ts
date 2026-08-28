import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { PlatformDefinition, ProtocolMapRule } from "@/lib/personas/platformDefinitions";

// ============================================================================
// Platform Definition Summary (from list command)
// ============================================================================

export interface PlatformDefinitionSummary {
  id: string;
  label: string;
  format: string;
  isBuiltin: boolean;
  nodeTypeCount: number;
  credentialRuleCount: number;
}

// ============================================================================
// Boundary validation
// ============================================================================

/**
 * The TS `PlatformDefinition` is a CACHED COPY of the Rust table, not a mirror
 * of it — see the header of `@/lib/personas/platformDefinitions`. The shapes
 * have already drifted: the Rust `ProtocolMapRule` carries no `node_patterns`,
 * so a backend-sourced rule arrives without `nodePatterns` and any reader that
 * assumed the TS type would throw a `TypeError` far from here.
 *
 * So this response is validated, not asserted. Missing optional collections are
 * filled with `[]` (a definition with no rules is meaningful; a definition whose
 * rules are the wrong shape is not), and a payload that is not a definition at
 * all fails here with a message naming the field, rather than deep inside the
 * import pipeline.
 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function objectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

export function parsePlatformDefinition(raw: unknown, id: string): PlatformDefinition {
  if (!isRecord(raw)) {
    throw new Error(`get_platform_definition("${id}") returned a non-object payload`);
  }
  for (const key of ["id", "label", "format"] as const) {
    if (typeof raw[key] !== "string") {
      throw new Error(`get_platform_definition("${id}") payload is missing string field "${key}"`);
    }
  }

  return {
    id: raw.id as string,
    label: raw.label as string,
    format: raw.format as PlatformDefinition["format"],
    isBuiltin: raw.isBuiltin === true,
    nodeTypeMap: objectArray(raw.nodeTypeMap).map((m) => ({
      sourcePattern: String(m.sourcePattern ?? ""),
      targetService: String(m.targetService ?? ""),
    })),
    credentialConsolidation: objectArray(raw.credentialConsolidation).map((c) => ({
      sourcePatterns: stringArray(c.sourcePatterns),
      targetConnector: String(c.targetConnector ?? ""),
      description: String(c.description ?? ""),
    })),
    nodeRoleClassification: objectArray(raw.nodeRoleClassification).map((n) => ({
      pattern: String(n.pattern ?? ""),
      role: n.role as PlatformDefinition["nodeRoleClassification"][number]["role"],
    })),
    excludedCredentialTypes: stringArray(raw.excludedCredentialTypes),
    // `nodePatterns` has no Rust counterpart — default it rather than let an
    // `undefined` reach `extractProtocolsFromNodes`.
    protocolMapRules: objectArray(raw.protocolMapRules).map((p) => ({
      platformPattern: String(p.platformPattern ?? ""),
      targetProtocol: p.targetProtocol as ProtocolMapRule["targetProtocol"],
      condition: String(p.condition ?? ""),
      nodePatterns: stringArray(p.nodePatterns),
    })),
  };
}

// ============================================================================
// API Functions
// ============================================================================

export const listPlatformDefinitions = () =>
  invoke<PlatformDefinitionSummary[]>("list_platform_definitions");

export const getPlatformDefinition = async (id: string): Promise<PlatformDefinition> =>
  parsePlatformDefinition(await invoke<unknown>("get_platform_definition", { id }), id);
