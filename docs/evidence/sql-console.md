---
subject: sql-console
evidence:
  - src/features/vault/sub_databases/safeModeUtils.ts                 # client mirror: literal-stripped CTE scan, fail-closed on unclosed comment
  - src-tauri/src/engine/db_query.rs                                  # authoritative guard (is_mutation :383, guard :518, one-statement-in-safe-mode :535), LIMIT n+1 bounding, capability enum :621, parameterized introspection :696-835
  - src/features/vault/sub_databases/hooks/useQuerySafeMode.ts        # default-on safe mode + consent gate bound to its target connection
  - src/features/vault/sub_databases/introspectionQueries.ts          # frontend SQL builders deleted; connector-family classification remains
  - src-tauri/src/commands/credentials/db_schema.rs                   # the one execute door + introspection commands + cancel registry
  - src/hooks/database/useTableIntrospection.ts                       # module-scoped schema cache with explicit refresh, single consumer of the door
  - src/features/vault/sub_databases/tabs/ChatTab.tsx                 # NL lane: same useQuerySafeMode, same executeDbQuery, editable SQL shown before run
  - src-tauri/src/commands/credentials/nl_query.rs                    # NL schema context built from the same introspect_tables/introspect_columns door
  - src/features/vault/sub_databases/QueryResultTable.tsx             # NULL styled distinctly, settled-empty vs error, truncation notice, virtualized
  - src/features/vault/sub_databases/tabs/ConnectorCapabilityNote.tsx # capability note rendered from the backend declaration
counter_evidence:
  - src-tauri/src/companion/jobs/connector_use.rs   # a second execute door for a model author: starts_with over 7 verbs incl. drop, bypasses the classifier (:1443-1469)
deviations:
  - w12-sql-console   # anchor in docs/concepts/golden-path-deferred-fixes.md (to be registered by the wave-12 closer; findings enumerated in the composer report)
---

# Sql Console - evidence

How this codebase measures against the [`sql-console`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
