---
subject: entity-lifecycle
evidence:
  - src-tauri/src/commands/core/personas.rs            # persona_blast_radius before delete; two-phase drain delete_persona; DeletePersonaResult receipt; pure deletion_forbidden_reason guard
  - src-tauri/db/src/repos/core/personas.rs            # blast_radius enumeration; archive_persona/restore_persona (lifecycle orthogonal to enabled); set_lifecycle single door
  - src-tauri/core/src/models/persona_change_log.rs    # per-field change history with redaction — who changed what, when, from what source
  - src-tauri/db/src/repos/execution/executions.rs     # resolve_recipe_provenance: provenance denormalized onto runs at insert; "NULL is the honest answer — never a sentinel"
  - src-tauri/db/src/repos/core/memories.rs            # delete_all preserving the core tier inside the operation (WHERE tier != 'core')
  - src/features/vault/sub_dependencies/credentialGraph.ts   # blast radius on credential revoke + simulateRevocation what-if, shared severity thresholds
  - docs/concepts/golden-path-deferred-fixes.md        # the measured cascade: 2026-08-17 purge, 20,342 rows across 25 tables through the declared ON DELETE CASCADE graph
counter_evidence:
  - src/features/overview/sub_memories/components/MemoriesPageDense.tsx   # bulk-delete confirm shows a client-computed count (page size) while the server predicate preserves core tier — preview and predicate decoupled
deviations:
  - w9-entity-lifecycle   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Entity Lifecycle - evidence

How this codebase measures against the [`entity-lifecycle`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
