/**
 * Standards & branching policy (Pipeline Stage 3).
 *
 * Persisted on `dev_projects.standards_config` as an opaque JSON string. The
 * connected team's personas must respect it; it's injected into member
 * executions via team_context + CODEBASE_* env (3c).
 *
 * The parse/serialize/default logic itself lives in the shared
 * `@/lib/standards/standardsConfig` module (also used by the team passport)
 * so both surfaces agree on what an empty config means — this file re-exports
 * it to avoid churning every import in this feature.
 */
export {
  type BranchSel,
  type StandardsConfig,
  defaultStandards,
  emptyStandards,
  parseStandards,
  serializeStandards,
  resolveBranchName,
} from '@/lib/standards/standardsConfig';
