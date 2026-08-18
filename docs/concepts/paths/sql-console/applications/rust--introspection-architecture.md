---
layer: application
subject: sql-console
technique: introspection-architecture
stack: rust
---

# One parameterized introspection door, and the deleted second one

Schema browsing in the vault's database surfaces runs through exactly two
Tauri commands — `introspect_db_tables` and `introspect_db_columns`
(`src-tauri/src/commands/credentials/db_schema.rs:185-207`, both
`#[requires(privileged)]`) — which delegate to `introspect_tables` and
`introspect_columns` in `src-tauri/src/engine/db_query.rs:696-835`. The
client hook `src/hooks/database/useTableIntrospection.ts` is their only
consumer, and the NL lane's schema context
(`src-tauri/src/commands/credentials/nl_query.rs:348-377`) calls the same
two engine functions — one schema truth for the browser, the editor, and
the model.

## The clicked name is a bound value

```rust
// db_query.rs:790-815 (abridged)
let safe_name = table_name.replace(|c: char| !c.is_alphanumeric() && c != '_', "");
match credential.service_type.as_str() {
    "neon" => execute_neon_parameterized(&fields,
        "SELECT column_name, data_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_schema = 'public' AND table_name = $1 \
         ORDER BY ordinal_position", &[&safe_name]).await,
    "planetscale" => execute_planetscale_parameterized(&fields,
        "SELECT column_name, column_type, is_nullable, column_default \
         FROM information_schema.columns \
         WHERE table_schema = DATABASE() AND table_name = ? \
         ORDER BY ordinal_position", &[&safe_name]).await,
    "supabase" => introspect_supabase_columns(&fields, &safe_name).await,   // OpenAPI spec, not SQL
    "convex" | "notion" | "airtable" => /* API-family introspection */ …
    other => Err(AppError::Internal(format!("Column introspection is not supported for '{other}'."))),
}
```

Every element of the technique is present in that block:

- **Catalog query, name as data.** The SQL families query
  `information_schema.columns` with the table name bound (`$1` / `?`) — the
  identifier never enters query text.
- **Belt and braces at the door.** `safe_name` (`:790`) reduces the name to
  `[alnum_]` *before* binding. The technique's reason is visible three lines
  down: for the API families (`supabase` via its OpenAPI spec, `convex`,
  `notion`, `airtable`) the name travels into a URL or path segment, not a
  bound parameter, and one sanitizer applied once covers every transport.
- **Fixed query texts selected by request kind.** There is no free-text
  lane through these functions; a family the match does not know gets an
  explicit "not supported" error, not a guessed query.
- **The door audits and scrubs like the executor.** Both functions write a
  `db_query:introspect_*` audit line on credential decrypt (`:714-723`,
  `:779-788`) and pass through `finalize_result` (`:747`, `:826`), the same
  duration/sanitize path the execute lane uses.

## The second door was deleted, on purpose

`src/features/vault/sub_databases/introspectionQueries.ts:1-8` is the
one-validation-door story in the repo's own words: the former frontend
`getListTablesQuery` / `getListColumnsQuery` / `getRedisKeyScanCommand`
builders *"were a weaker second implementation and have been deleted."*
What remains in that file is connector-family classification and
`getSelectAllQuery` (`:128-154`) — a **clipboard** helper that emits a
quoted `SELECT * FROM "name" LIMIT 100;` for the user to paste, never
executed by the app. That is the emitted-versus-executed line the technique
draws; the quoting there is courtesy (the comment at `:131-133` records the
`order-items` → `order MINUS items` bug it fixed), not defense.

## The client cache is honest about being a cache

`useTableIntrospection.ts:28-53` keeps module-scoped Maps (tables, columns,
key scans) that survive tab switches and remounts, bounded at 50 / 200
entries with oldest-first eviction (`boundedSet`, `:40-46`), and cleared
per credential by `clearCacheForCredential` (`:48`). `fetchTables(skipCache
= true)` (`:159`) is the user-invokable refresh; the tables tab wires it
(`tabs/TablesTab.tsx:62`). Progressive disclosure holds: tables on connect,
columns on selection (`:220` region), nothing counted eagerly.

## Deviations against the standard

- Both SQL-family table introspections hard-code a single namespace
  (`table_schema = 'public'` at `:729`; `DATABASE()` at `:733`) — the
  browser has no namespace level.
- Row counts are not surfaced at all (neither estimate nor on-demand exact),
  which is the conservative side of the technique's rule but leaves the
  browser without the size signal users expect.
- Schema-shaped execution errors (unknown column/table) are not treated as
  staleness signals; refresh is manual only.
