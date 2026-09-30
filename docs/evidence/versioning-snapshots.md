---
subject: versioning-snapshots
evidence:
  - src-tauri/db/src/repos/lab/versions.rs                       # monotonic number derived at insert; full-graph INSERT…SELECT snapshot (prompt + tools + config); tag 'experimental' minted at creation; parent_version_id lineage column
  - src-tauri/src/commands/execution/lab.rs                      # declared tag vocabulary (production/experimental/archived); atomic production swap; restore rejects incomplete snapshots instead of COALESCE-ing a hybrid
  - src-tauri/db/src/repos/execution/metrics.rs                  # create_prompt_version_if_changed — dedupe gate at the one capture door
  - src-tauri/src/engine/auto_rollback.rs                        # regression demotion: production tag (not highest number) selects current; 2x error-rate threshold; event carries from/to versions + both rates
  - src-tauri/db/src/repos/lab/ratings.rs                        # version economics pinned to version ids with explicit predicate (attempted / resolved='passed' / cost_per_success)
  - src-tauri/db/src/repos/lab/evolution_proposals.rs            # human-gated promotion proposals; cycles always complete promoted=false, only the approval path flips it
  - src-tauri/db/src/repos/resources/persona_change_log.rs       # the field-log shape of history: per-field diff rows on the caller's transaction, redaction, coalescing window, write-time retention cap
  - docs/concepts/golden-paths/definition-version-history.md     # measured census: three version mechanisms, one live; capture-bypass and constraint gaps counted against real databases
counter_evidence:
  - src-tauri/db/src/migrations/incremental/   # persona_versions DDL: per-entity version_number with NO unique constraint — the sequence is code-enforced only, and the census found 12 such tables
deviations:
  - w9-versioning-snapshots   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Versioning Snapshots - evidence

How this codebase measures against the [`versioning-snapshots`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
