---
subject: data-access
evidence:
  - src-tauri/db/src/query_builder.rs             # parameter-index-tracking builder; values bound, identifiers documented as caller-validated
  - src-tauri/db/src/macros.rs                    # CRUD + row-mapper generation from one declaration
  - src-tauri/db/src/repos/utils.rs               # escape_like hoisted "so the escaping rule lives in exactly one place"; collect_rows skip-and-log
  - src-tauri/db/src/lib.rs                       # crate header: "depends on personas-core and nothing else of ours"; upward calls injected as CdcHooks
  - src-tauri/core/src/lib.rs                     # the bottom-of-graph rule stated as the crate's reason to exist
  - src-tauri/db/src/repos/execution/executions.rs  # representative heavy repo: builder use, batch endpoints, idempotent insert-first create
counter_evidence:
  - src-tauri/db/src/repos/resources/mcp_gateways.rs  # add_member: INSERT OR IGNORE then returns a fresh id unconditionally — a write surface lying about what it wrote
deviations:
  - w2-data-access   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Data Access - evidence

How this codebase measures against the [`data-access`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
