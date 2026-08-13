# Golden path — Paginated list query

> Situation node: `data-persistence/query-performance/paginated-list-query` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of `src-tauri/{src,db,core}` and `src/**`,
> against `master` @ `f7676ab82`. `.claude/worktrees/**` and `target/` excluded from every count.
> Every number below was measured over the tree — by script for the command surface, by reading
> the SQL for every claim about a specific query. Nothing is estimated.
> Dimensions: **performance · ui · function · resilience · cost**.
> Two-sided: the **command half** (limit, cursor, clamp, total) and the **client half**
> (how the next page is asked for), plus the contract between them.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.
>
> **Second-pass finding — read this first.** The sweep began on the client (the leaf was filed
> partly on a suspicion of ~17 hand-rolled paginators) and found **two**. Almost every defect in
> this path is upstream of any component: `QueryBuilder`, the repo layer's shared query composer,
> treats a row cap as **opt-in** and emits `LIMIT -1` for offset-only callers. 225 of 384 list
> commands are hard-unbounded and 64 of the 99 that take a limit never clamp it, because the
> cheapest correct thing to write is not the bounded thing. Fix the composer's default and most
> of the backlog below becomes a deletion.

## Trigger

- "List the X" / "add a command that returns all the Y" / "the Z table needs a page"
- "This list is slow now that there are a few thousand rows"
- "Add a Load more / infinite scroll / next-page button"
- "How many are there in total?" — a count next to a list
- "The list stops at 100 and I can't get the rest"
- "It shows duplicates when I scroll" / "a row went missing when I paged"

If you are about to type `-> Result<Vec<T>, AppError>` on a `#[tauri::command]`, `limit: Option<i64>`,
`limit.unwrap_or(`, `OFFSET`, `offset: items.length`, `LIMIT ?1` without a `.clamp(`, `setLimit(prev + PAGE)`,
`.slice(page * PAGE_SIZE`, or a `total` you intend to render above a list — you are in this situation.

**Not this path:** bounding the *DOM* (how many rows render) is
[`long-list-rendering`](../situation-spine.md) — `UnifiedTable`'s `rowHeight` virtualization. This path
bounds the *fetch*. They compose and neither substitutes for the other; the decision rule is in **See also**.

## The one way

Bound the query at the database, not in the client. Add **two** commands per entity: a cheap
`get_<entity>_counts(filters) -> <Entity>Counts` (one `GROUP BY`, no row data) and a keyset page
`list_<entity>_page(filters, cursor: Option<String>, limit: Option<i64>) -> <Entity>Page`, where
`<Entity>Page` is a `#[derive(TS)] #[ts(export)]` struct of exactly `{ rows, nextCursor: Option<String>, hasMore: bool }`.
Inside the repo fn: `let limit = limit.unwrap_or(DEFAULT).clamp(1, MAX);` — a named const pair, never a
bare `unwrap_or` — order by `(created_at DESC, id DESC)`, carry the cursor as the opaque
`"{created_at}|{id}"` of the last row and match it with the **composite** predicate
`(created_at < ? OR (created_at = ? AND id < ?))`, and fetch `limit + 1` rows to derive `hasMore` by
truncation rather than paying a second `COUNT`. Never `OFFSET`: it walks and discards every skipped row,
and it silently duplicates or drops rows whenever the table mutates between two pages — which for
`persona_events`, `persona_executions` and `persona_messages` is constantly. On the client, do not write
page state: call **`useLayeredList`** with a `filterKey`, a `fetchPage(cursor)` adapter and `fetchCounts`,
render `sentinelRef` at the end of the list, and read the total from L0 counts — never from `rows.length`.
Reach for `DataGrid`'s `pageSize` **only** when the set is already fully in memory and bounded by
construction (a per-credential audit log, a config table); it is page chrome over an array, not a way to
make a large fetch cheap, and its "of {total}" is `data.length`. And shrink the row: a list command must
return a projection type (`ExecutionListItem`, 16 scalars) — never the full record with its
`input_data` / `output_data` / payload blobs.

## Mandated primitives

**Client**

- **`src/hooks/utility/data/useLayeredList.ts`** — `useLayeredList<Row, Counts>({ filterKey, fetchPage, fetchCounts?, enabled? })`. The shared L0/L1/L2 hook. Returns `{ rows, counts, loading, loadingMore, hasMore, error, sentinelRef, loadMore, reload }`. Carries the **epoch guard** (`:99`, `:128`) that drops stale responses — Tauri `invoke` has no abort, so this *is* the cancellation mechanism. `enabled: false` defers off-screen surfaces. `LayeredPage<Row>` (`:38-43`) is the client-side page contract.
- **`.../useLayeredList.ts:186-199`** — `sentinelRef`, an `IntersectionObserver` callback ref with `rootMargin: '240px'`. This is the "load more" affordance; do not write a button unless you also need one.
- **`src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts:35`** — the adapter template. Filters fold into `filterKey`; `PAGE_SIZE = 40` matches the server clamp.
- **`shared/components/display/UnifiedTable`** — `onEndReached` (`:168`) + `endReachedThreshold` (`:169`) wire `loadMore` to scroll. Only fires when virtualized (`rowHeight > 0`) and is **disabled under `groupBy`** (`:532`).
- **`src/hooks/utility/interaction/useEndReached.ts`** — the scroll-proximity primitive behind it, for non-table surfaces.
- **`shared/components/display/DataGrid`** — `pageSize` + `pageSizeOptions` + `onPageSizeChange`, the clamp-don't-reset effect (`:168-174`), and the footer (`:459-532`). **In-memory sets only.**
- **`src/lib/tauriInvoke.ts`** — `invokeWithTimeout`. `DEFAULT_TIMEOUT_MS = 90_000` (`:37`); on timeout the backend is **not** cancelled (`:131`). This is why an unbounded list query is a resilience defect, not just a slow one.

**Server**

- **`src-tauri/src/commands/design/reviews.rs:1027-1055`** — `list_manual_reviews_page`: the reference command. `limit.unwrap_or(40).clamp(1, 200)`, cursor decode, `next_cursor` from the last row.
- **`.../reviews.rs:1013-1019`** — `parse_review_cursor`: the opaque `"<created_at>|<id>"` codec. Malformed → `None` → page 1, never an error.
- **`src-tauri/db/src/repos/dev_tools.rs:3814-3876`** — `triage_ideas`: the reference repo fn. Composite cursor predicate (`:3834`), `LIMIT limit + 1` (`:3843`), truncate-to-derive-`has_more` (`:3858-3861`), counts from a shared `triage_scope_clauses` (`:3738`) so **a filtered page and its counts cannot disagree**.
- **Named clamp constants** — `TRIAGE_DEFAULT_LIMIT = 50` / `TRIAGE_MAX_LIMIT = 200` (`dev_tools.rs:3692-3693`); `TASKS_PAGE_DEFAULT_LIMIT = 40` / `TASKS_PAGE_MAX_LIMIT = 200` (`:4933-4934`). Copy this shape; do not inline magic numbers.
- **`src-tauri/core/src/models/review.rs:117` `ManualReviewPage`** — the page struct shape. `#[ts(export)]` is mandatory: the page contract is a typed contract or it is not one.
- **`ExecutionListItem`** (`src/lib/bindings/ExecutionListItem.ts`) — the payload-projection precedent: 16 scalars, no blobs, fed by `list_executions_summary`.
- **`src-tauri/db/src/migrations/incremental.rs:4347-4352`** — `dev_triage_page_indexes`, the only keyset indexes in the schema, with the reason on the tin: *"without these the paged reads degrade to a full scan + sort … on every page."* **A keyset page without its `(filter…, created_at DESC, id DESC)` index is not a fast page.** Add the index in the same change as the query.
- **`timed_query!`** — wrap every paged repo fn; it is how a regression in page cost becomes visible.
- **`src-tauri/src/engine/background_job.rs:24-33`** — `MAX_LINES: 500` / `MAX_LINE_BYTES: 4KB`, described at `:285` as "the single chokepoint where … clamped". The only real payload chokepoint in the codebase; model row-blob truncation on it.

## Steps

1. **Decide whether you need a server page at all.** Is the row count bounded by construction (a seeded catalog, one credential's audit log, a config table)? If yes, one clamped fetch + `DataGrid pageSize` is correct and you are done. If the table grows with usage — events, executions, messages, memories, ideas, reviews, audit rows — you need a server page. Guessing "it'll stay small" is how all 225 unbounded list commands got written.
2. **Write the projection row type first.** A list row is scalars + ids. If your row type contains a prompt, an output, a JSON payload or a log body, split it: `<Entity>ListItem` for the list, the full record for the detail fetch. Model on `ExecutionListItem`.
3. **Write the repo fn.** `let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);` with both consts named and co-located. `ORDER BY created_at DESC, id DESC` — the `id` tiebreaker is not optional. `LIMIT limit + 1`. Cursor predicate `(created_at < ? OR (created_at = ? AND id < ?))`. Truncate to `limit`, set `has_more`, emit `next_cursor` from the last surviving row. Wrap in `timed_query!`.
4. **Write the counts fn** in the same module, sharing the *same* WHERE-clause builder as the page fn. If the two build their filters independently they will drift, and the UI will show "142" above 40 rows that belong to a different filter.
5. **Declare the page struct** with `#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)] #[serde(rename_all = "camelCase")] #[ts(export)]` and exactly `rows` / `nextCursor` / `hasMore`. Run `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` and commit `src/lib/bindings/`. A page returned as `serde_json::Value` is not a contract.
6. **Register both commands**, then `node scripts/generate-command-names.mjs`.
7. **Add the two API wrappers** in `src/api/<area>/<entity>.ts` using `invokeWithTimeout`, typed by the generated bindings — do not hand-declare the page interface.
8. **Write the adapter hook** — `use<Entity>Queue(filters)` returning `useLayeredList(...)`. Fold every server-resolved filter into `filterKey`. Pass `enabled` through so an off-screen tab pays nothing.
9. **Render.** Static chrome always; `isLoading` + `data` into `UnifiedTable` (see the [tables path](./tables.md)); `hasMore && <div ref={sentinelRef} />` at the end of the list. Read the total from `counts`, never from `rows.length`.
10. **Add `rowHeight` if the loaded window can exceed a few hundred rows** — keyset bounds the fetch, virtualization bounds the DOM, and a long infinite-scroll session needs both. Wire `onEndReached={hasMore && !loadingMore ? loadMore : undefined}` as an alternative to the sentinel; do not wire both.
11. **Stop.** No `useState(page)`, no `.slice()`, no clamp effect, no prev/next chrome, no `setLimit(prev + PAGE)`, no `offset`, no `Math.ceil(total / PAGE_SIZE)`.

## Anti-patterns

- **`limit.unwrap_or(N)` with no `.clamp()`** — **64 of the 99** list commands that take a limit. The default is not a bound; it is only what happens when the caller says nothing. Any caller — including the MCP tool surface (`mcp_server/tools.rs:715,:1840,:1981`) and the local HTTP surface (`engine/management_api.rs:318`) — can pass a larger number, and two of these paths then compute `limit + 1`: with `overflow-checks` off in `[profile.release]` (`Cargo.toml:284-291`), a large limit wraps negative and SQLite reads a negative `LIMIT` as **no limit at all**. The clamp is what makes the default a bound.
- **`.max(1)` mistaken for a clamp.** It is a *floor*, not a ceiling — it protects the query from `LIMIT 0` and does nothing about `LIMIT 9223372036854775807`. Both `PaginatedEvents` producers use it and only it (`db/src/repos/communication/events.rs:391,:1297`). If you write `.max(1)`, you meant `.clamp(1, MAX_LIMIT)`.
- **A list command with no `limit` parameter at all** — a verified floor of **225 of 384** `Vec`-returning commands (~59%; realistically 250–285 once shared-module false negatives are removed). The whole table serialises over IPC on every call. It is not slow-then-slower: it is fine until it is a 90-second `invokeWithTimeout` failure that does not cancel the backend.
- **Composing a query through `QueryBuilder` and not calling `.limit()`** — `db/src/query_builder.rs:216-229`. `has_limit` is `false` unless the caller opts in, and there is no default and no cap in the builder. Worse, an offset-only caller gets `LIMIT -1 OFFSET ?N` (`:293`) — SQLite's idiom for *explicitly unlimited*. The shared helper makes the unbounded query the default one.
- **`OFFSET`** — 9 commands. Between two pages a new row at the head shifts every subsequent row by one; the client either re-receives the boundary row (visible duplicate, React key warning) or never sees it (silent loss). `messageSlice.ts:44` passes `offset = messages.length` with **no dedupe**; `ExecutionList.tsx:155` passes `offset = rawRows.length` into a table whose rows are created head-first while you scroll. None of the 9 validates the offset beyond `.max(0)`.
- **Returning the full record in a list** — `list_executions` / `list_all_executions` / `list_executions_by_trigger` / `list_executions_for_use_case` all `SELECT *` into `PersonaExecution`, which carries `input_data`, `output_data`, `execution_flows` and `tool_steps` (`core/src/models/execution.rs:13`): the full prompt, the full model output and the full tool-call trace, per row, at an uncapped `unwrap_or(200)` default. This is the largest payload on the IPC surface, and `list_executions_summary` next door already proves the fix.
- **Keeping the unbounded twin exported after shipping the page** — `list_manual_reviews` (`commands/design/reviews.rs:998`) still reads the whole `persona_manual_reviews` table with no `LIMIT`, beside `list_manual_reviews_page`. The layered-fetch ADR permitted this as "a graceful migration window"; the window has been open since 2026-05-21 and `useMonitorData.ts:309` still falls back to it.
- **`ORDER BY created_at` with no `id` tiebreaker** — `messages.rs:61`. Rows written in the same millisecond order nondeterministically, so the "same" page can return different rows on two calls. `events.rs:1331-1334` documents exactly why this is required; the messages repo did not get the memo.
- **A cursor that is only a timestamp** — `useEventLog.ts:282` sends `until: oldest.created_at` into `where_lte("created_at", …)`. The ORDER BY has the `(created_at, id)` tiebreaker but the WHERE clause does not, so siblings sharing the boundary timestamp beyond the page edge are **permanently unreachable**, and the client's compensating `ms < oldestMs` filter (`:300`) is what drops them. Worse: a page that is entirely boundary-timestamp duplicates yields `newOnes.length === 0` → `setHasMoreOlder(false)` (`:303-304`) — the list silently declares itself exhausted while rows remain.
- **Grow-the-limit instead of paging** — `overviewSlice.ts:357-407`. Each "load more" re-fetches the *entire* list at `limit + 50`, so reaching page 10 has transferred 50+100+…+500 rows. `hasMore` is the heuristic `rawCount >= limit` (`:399`), which lies when the table holds exactly `limit` rows, and the 500-row ceiling (`MAX_GLOBAL_LIMIT`) is enforced with `globalExecutionsWarning: null` — the honesty field exists and is never set.
- **A total that describes the table while the list shows a slice** — `MemoriesPageDense.tsx:194` renders `"{memoriesTotal} memories stored by agents"` over a list `memorySlice.ts:113-121` fetched with `limit: 100, offset: 0` and **no continuation of any kind**. The header is the only evidence the user has that rows are missing, and it is phrased as if they aren't.
- **Paginating in Rust after reading the whole table** — `reviews.rs:504-566`. The coverage-filter branch runs `SELECT * FROM persona_design_reviews` with no LIMIT, post-filters in a `Vec`, then `.skip(offset).take(per_page)`. It has the signature of pagination and the cost of a full scan.
- **Returning a page as `serde_json::Value`** — `reviews.rs:156,170-173`. The frontend hand-writes the matching interface at `src/api/overview/reviews.ts:58`; nothing checks that they agree. Same class: `CompanionMessagePage` (`chat.rs:47-58`) is `Serialize`-only with no `#[ts(export)]`, and `MemoriesWithStats` exists only as a TypeScript interface.
- **Hand-rolling page state over an array** — `useState(page)` + `.slice(page * SIZE, …)` + prev/next + a clamp effect. `DataGrid`'s `pageSize` includes the clamp-**don't-reset** behaviour (`:168-174`) that hand-rolls get wrong: resetting to page 1 on every `data.length` change snaps the user back after an ordinary edit.
- **Clamping the derived page instead of the stored one** — `ClusterPatternsModal.tsx:260` computes `pageClamped` at render but leaves `page` stale, so after the list shrinks the first "prev" click decrements an out-of-range value and renders the same page.
- **Using the page endpoint as a counts probe** — `useTaskQueue.ts:123` calls `devApi.tasksPage(projectId, undefined, 1)` to read `page.counts`, bypassing `useLayeredList`'s own `fetchCounts` slot and issuing an unfiltered counts read next to a filtered page.
- **Discarding `hasMore`** — `useTimelineReplay.ts:190` takes `result.events` and drops `result.has_more`, then re-truncates client-side to `MAX_REPLAY_EVENTS`. The user is shown a replay that is silently missing its head.
- **A truncation flag with no continuation** — `DriveTreeNode.hasMoreChildren`: the backend admits it truncated and offers no way to ask for the rest.

## Evidence

**Adoption, against 1,649 `#[tauri::command]` fns of which 390 (23.6%) are list-shaped:** **6** commands return a page type; **4** of those have a ts-rs binding (`ManualReviewPage`, `TriagePage`, `TasksPage`, `PaginatedEvents`); only **3** accept a `cursor` parameter at all. **2** surfaces consume the shared client hook. **4** call sites wire `onEndReached`. **7** surfaces use `DataGrid`'s `pageSize` (4 direct + 3 through `FacetedDecisionTable`'s `pageSize = 25` default). Properly bounded list commands: ~41 of 384 (~11%).

- **`src-tauri/db/src/repos/dev_tools.rs:3814-3876` — the ONE server site to copy.** Named clamp consts, composite cursor predicate, `limit + 1` truncation, and counts sharing the page's own filter builder. Every other paginated repo fn in the tree is a subset of this.
- **`src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts:35` — the ONE client site to copy.** 22 lines, no state, filters folded into `filterKey`, `PAGE_SIZE` documented as matching the server clamp.
- `src-tauri/src/commands/design/reviews.rs:1027-1055` + `:1013-1019` — the command half and the cursor codec, with the clamp stated in the doc comment (`:1026`).
- `src/hooks/utility/data/useLayeredList.ts:1-36` — the doctrine, written on the primitive: L0 counts / L1 first viewport / L2 sentinel, and why `enabled` exists.
- `src/features/overview/sub_manual-review/components/ReviewInboxPanel.tsx:145-152` — the sentinel, correctly held until the reveal cascade finishes so a scroll mid-animation doesn't chain-fetch.
- `src/features/plugins/dev-tools/sub_runner/RunDeskPage.tsx:272` — the second correct sentinel render.
- `src-tauri/src/commands/execution/audit_incidents.rs:73-77` — the best *offset* command: `DEFAULT_LIMIT = 100` / `MAX_LIMIT = 500` clamped through a shared helper. Still offset (see Deviations), but bounded and honest.
- `src/features/overview/sub_incidents/components/IncidentsInbox.tsx:533` + `useIncidentsData.ts:19,55` — **the truncation-honesty exemplar.** `truncated = rows.length >= DEFAULT_LIMIT` renders a translated *"Showing the first {limit} incidents — narrow the filters to see the rest."* When you cannot page yet, this is the minimum: say so, in a translated string, with the number.
- `src/api/agents/executions.ts:26` + `ExecutionListItem` — the payload projection, ~16 scalars against `PersonaExecution`'s full record with `input_data` / `output_data`.
- `src-tauri/src/commands/companion/chat.rs:397-432` — a correct keyset page with `clamp(1, 500)` and an `exhausted` flag deliberately computed from **raw scanned rows, not surviving rows** (`:421`, doc `:44-47`) so a fully-filtered page cannot fake the end of the transcript. Copy that reasoning whenever a page is post-filtered.

## Deviations found

Counts are over `src-tauri/src/commands/**` (1,649 `#[tauri::command]` fns, 384 returning `Result<Vec<…>>` + 6 returning a page type) and `src/**`.

### P0 — the shared-layer root causes (fix first; upstream of everything below)

| Path | What's wrong |
|---|---|
| **`src-tauri/db/src/query_builder.rs:216-229,:266-300`** | The repo layer's shared query composer treats bounding as **opt-in**: `has_limit` is false unless a caller calls `.limit()`, there is no default and no cap, and `build_clauses` emits `LIMIT -1 OFFSET ?N` — *explicitly unlimited* — for offset-only callers. **This is the structural reason 225+ commands are unbounded.** Fix here first: a mandatory cap (`.limit()` defaulting to a crate-wide `MAX_LIST_ROWS`, callers opting *down* rather than in) makes every downstream fix a deletion rather than an addition. `db/src/macros.rs:412-417` has the same shape for the CRUD macro. |
| **225 `Vec`-returning commands with no `limit`/`offset`/`cursor` parameter at all** (verified floor; ~250–285 realistic) | ~59% of the list surface is structurally unbounded. There is no per-command fix; the fix is the builder above plus the ratcheted gate in §9. |
| **64 of 99 limit-taking commands unclamped** (35 clamped) | The default is mistaken for a bound. Concentrated in `db/src/repos/{communication,core}` — `memories.rs:167,233,705,1474`, `messages.rs:55,96,117,254`, `events.rs:210,350,765`, `chat.rs:32,53`, `reviews.rs:81`. |
| `src-tauri/db/src/repos/communication/events.rs:391,:1297` | `limit.unwrap_or(N).max(1)` then `let fetch = limit + 1`. `.max(1)` is a floor, not a clamp; with release `overflow-checks` off, a huge caller limit wraps to a negative `LIMIT` — SQLite reads that as unlimited. The one place the missing clamp is a correctness bug, not just a cost one. |
| **No IPC payload-size guard exists anywhere in the command layer** | No list command measures its serialised response. The size guards that do exist are all import/export file caps, LLM prompt caps, or per-integration (`drive.rs:947`, `n8n_transform/cli_runner.rs:59`). The one true chokepoint precedent is `engine/background_job.rs:24-33`. Meanwhile `list_all_executions` returns 200 full `PersonaExecution` records — prompt + output + tool trace each — by default. |
| `docs/architecture/overview-layered-fetch.md:136-144` | The rollout table is **wrong and load-bearing**: it lists `sub_messages` as "already keyset + virtualized" (it is `LIMIT/OFFSET` with no id tiebreaker, `messageSlice.ts:41-68`) and `sub_events` as "cursor + sentinel already" (its cursor is a bare timestamp with a known skip bug). Two sub-modules are marked done that are among the worst offenders, so the doc actively retires work that was never done. Its line `:80` ("the old fetch-all command stays registered … for a graceful migration window") is what keeps `list_manual_reviews` alive at `reviews.rs:998` fifteen months on. |

### Hard-unbounded commands on tables that grow without bound (no limit param at all)

Every row below was verified by reading the SQL. This is the migration front, ordered by how fast the table grows.

| Path | Table read |
|---|---|
| `commands/communication/messages.rs:109` `get_messages_by_thread` | `persona_messages`, full thread (repo `messages.rs:228`) |
| `commands/communication/messages.rs:80,:89` `get_message_deliveries` / `get_bulk_delivery_summaries` | `persona_message_deliveries` (`:581`, `:533`) |
| `commands/design/reviews.rs:998` `list_manual_reviews` | `persona_manual_reviews` — full table, **beside its own paged twin** |
| `commands/execution/executions.rs:784,:720,:749` `list_active_chains` / `get_chain_trace` / `get_chain_stop_reasons` | `persona_executions`, `execution_traces`, `chain_stop_reasons` |
| `commands/execution/healing.rs:80,:96` `get_retry_chain` / `list_healing_knowledge` | `persona_executions`, `healing_knowledge` |
| `commands/execution/annotations.rs:47` · `policy_events.rs:18` · `lab.rs:1423,:1442` | `persona_execution_annotations`, `policy_events`, `lab_result_events`, `lab_tool_calls` |
| `commands/core/memories.rs:175,:85` · `core/personas.rs:512` | `persona_memories`, `memory_claims`, and a per-persona `persona_executions` rollup that scans unbounded |
| `commands/communication/events.rs:137,:146` · `shared_events.rs:119` | `persona_event_subscriptions`, `shared_event_firings` |
| `commands/credentials/crud.rs:277,:285` | `credential_events` — append-only audit, never pruned |
| `commands/infrastructure/byom.rs:95,:104` · `tools/tools.rs:113,:123,:133` | `provider_audit_log`, `persona_tool_usage` (`tool_usage.rs:104,144,182`) |
| `commands/infrastructure/dev_workspaces.rs:140,:291,:380,:467` | `workspace_knowledge` (455 adopted patterns today), `workspace_knowledge_evidence`, `workspace_practice_adoption` (1,848 cells), `workspace_pattern_edges` |
| `commands/infrastructure/dev_tools.rs:419` · `dev_tools/goals.rs:13,:183,:431` · `dev_tools/contexts.rs:93` | `dev_ideas` full-key scan, `dev_goals`, `dev_goal_items`, `dev_contexts` |
| `commands/infrastructure/skill_usage.rs:597` · `doc_rot.rs:710` · `research_lab.rs:477` | `skill_usage_events`, `doc_read_events`, `research_experiment_runs` |
| `commands/credentials/vector_kb.rs:1218,:1300` · `ocr/mod.rs:657` | `kb_documents`, `kb_entities`, `ocr_documents` |
| `commands/companion/sidecars.rs:163` · `teams/team_memories.rs:115` · `execution/scheduler.rs:71` | `companion_turn_sidecar`, `team_memories`, `schedule_missed_runs` |

### Unclamped caller-supplied limits (64 commands)

| Path | What's wrong |
|---|---|
| `db/src/repos/communication/messages.rs:55-67` | `limit.unwrap_or(50)` unclamped, `OFFSET`, and `ORDER BY created_at DESC` with **no `id` tiebreaker** — every pagination hazard in one 12-line fn, on the messages table. |
| `commands/credentials/intelligence.rs:11,:22` · `rotation.rs:66,:204` | Credential audit log and rotation history, `unwrap_or(50)`/`unwrap_or(200)`, unclamped. Append-only, never pruned. |
| `commands/execution/executions.rs:644` `get_execution_log_lines` | Only the `unwrap_or(500)` is wrong. This is a *file* reader, not a query: tail mode uses a `VecDeque` ring (`:685-690`) and forward mode a streaming `.skip().take()`, so memory is bounded by `max_lines` — correct design, missing only the clamp that stops a caller sizing the ring itself. Worth reading as the model for paging a non-SQL source. |
| `commands/teams/deliberations.rs:81` · `assignments.rs:84` · `team_memories.rs:10` | `unwrap_or(200)`/`unwrap_or(100)`/`unwrap_or(50)` over team channel and memory tables. |
| `commands/companion/consolidate.rs:72,:276` · `jobs.rs:36` · `proactive.rs:80` | Four companion list commands, unclamped, over tables the night shift writes to on every tick. |
| `commands/execution/healing.rs:174` · `evolution.rs:145,:257` · `genome.rs:526` · `lab.rs:161,:370,:495,:753,:803` · `tests.rs:118` | Ten unclamped engine/lab audit reads. |
| `commands/infrastructure/dev_tools.rs:668` | `dev_tools_list_pending_ideas`, `unwrap_or(100)` unclamped — in the same file as `dev_tools_triage_ideas`, the repo's own reference implementation. |
| `src/engine/management_api.rs:318` · `src/mcp_server/tools.rs:715,:1840,:1981` | The **non-UI** callers: an HTTP surface and the MCP tool surface both pass caller-controlled limits into unclamped repo fns. These are the paths where "no user would type that number" stops being an argument. |

> A clamp may legitimately live in the repo fn rather than the command — `list_settings_audit_entries` (`commands/infrastructure/settings.rs:220`) takes a bare `limit: u32` and reads as unbounded at the command, but `db/src/repos/resources/settings_audit_log.rs:83` clamps it to `[1, 1000]` and the doc comment says so. Any gate on this must follow one delegation hop before reporting, and any reviewer must read the repo fn before filing the bug.

### Payload cost — list rows carrying blobs (no guard anywhere)

| Path | What's wrong |
|---|---|
| `commands/execution/executions.rs:33,:61,:568,:578` | `SELECT *` → `PersonaExecution` with `input_data`, `output_data`, `execution_flows`, `tool_steps` (`core/src/models/execution.rs:13`) at `unwrap_or(200)`, uncapped. **The single largest IPC payload risk in the surface** — and `list_executions_summary` at `:43` is the fix, already written, already used by three other call sites. |
| `commands/communication/events.rs:23,:33,:49` | `PersonaEvent` including the full `payload` JSON; `get_in_range` defaults to **1000 rows**. |
| `commands/core/memories.rs:24` · `communication/messages.rs:22,:109` · `infrastructure/dev_tools.rs:300,:668` | Full `content` / `description` bodies per row, uncapped. |

### `OFFSET` pagination — migrate to keyset (9 commands, 3 live client consumers)

| Path | What's wrong |
|---|---|
| `commands/communication/messages.rs:23-30` ← `src/stores/slices/overview/messageSlice.ts:41-68` | `offset = get().messages.length`, no dedupe, no id tiebreaker. A message arriving between pages duplicates or hides a row. The slice fetches `getMessageCount()` separately for `messagesTotal` — the correct L0 instinct wired to the wrong L1. |
| `commands/execution/executions.rs:44-52` ← `src/features/agents/sub_executions/components/list/ExecutionList.tsx:155` | `offset = rawRows.length` against a table that inserts head-first while the user scrolls. `hasMore = !reachedEnd && rawRows.length >= PAGE_SIZE` (`:150`) is a heuristic, not the server's answer. |
| `commands/design/reviews.rs:145-173` ← `src/hooks/design/template/useGalleryQuery.ts:158-194` | Page-number offset with a real server `total` and a careful re-entrancy lock (`:213-242`) — good client engineering over the wrong contract. |
| `messages.rs:118 get_thread_summaries` · `execution/audit_incidents.rs:80 list_audit_incidents` · `infrastructure/dev_tools.rs:300 dev_tools_list_ideas` · `teams/team_memories.rs:10 list_team_memories` · `core/memories.rs:24 list_memories` · `infrastructure/cloud.rs:1162 cloud_list_executions` | The remaining six. `list_audit_incidents` is the **only one of the nine** whose limit is clamped; none of the nine validates the offset beyond `.max(0)`. |

### Broken or absent continuation

| Path | What's wrong |
|---|---|
| `src/features/overview/sub_events/libs/useEventLog.ts:256-314` | Timestamp-only cursor against an inclusive `where_lte`; boundary-timestamp siblings are unreachable, and an all-duplicate page sets `hasMoreOlder = false` and ends the list early. |
| `src/stores/slices/overview/memorySlice.ts:107-133` | `offset` hardcoded `0`, `limit` 100 (500 with search), no `loadMore`, no truncation notice — while `MemoriesPageDense.tsx:194` prints the full table count above the truncated list, in hardcoded English with a JS plural hack. **The sharpest user-visible defect in this leaf.** |
| `src/stores/slices/overview/overviewSlice.ts:357-407` | Grow-the-limit re-fetch, heuristic `hasMore`, silent 500-row ceiling with the `globalExecutionsWarning` honesty field left `null` at `:401` (and again at `:271`). |
| `src/hooks/realtime/useTimelineReplay.ts:190-196` | Drops `has_more`; re-truncates client-side. |
| `src/features/plugins/dev-tools/sub_runner/useTaskQueue.ts:120-131` | Uses `tasksPage(projectId, undefined, 1)` as a counts probe instead of `useLayeredList`'s `fetchCounts`, and reads counts unfiltered while the page is filtered. |
| `src/lib/bindings/DriveTreeNode.ts:8` | `hasMoreChildren` with no cursor — truncation admitted, continuation impossible. |
| `src/features/vault/sub_credentials/components/features/CredentialIntelligence.tsx:48` | Fetches a fixed 500 audit rows into memory and paginates them 20-at-a-time client-side; row 501 is unreachable and nothing says so. |

### Untyped page contracts (3)

- `src-tauri/src/commands/design/reviews.rs:156,:170-173` — returns `serde_json::Value`; shape hand-mirrored at `src/api/overview/reviews.ts:58-105`.
- `src-tauri/src/commands/companion/chat.rs:47-58` — `CompanionMessagePage` is `Serialize`-only, no `#[ts(export)]`, no binding.
- `list_memories_with_stats` → `MemoriesWithStats` exists only as a TypeScript interface (`src/api/overview/memories.ts:101-105`). All three carry a `total` or `hasMore` that no compiler checks.

### Rust-side fake pagination (1)

- `src-tauri/db/src/repos/communication/reviews.rs:504-566` — full-table `SELECT *`, Rust-side filter, `.skip().take()`. Currently unreachable from the gallery (which resolves coverage client-side and never sends `coverageFilter`), so this is a loaded gun rather than a live wound — but the command exposes the parameter.

### Client-side hand-rolls (2 — the hypothesis said 17; it is 2)

- `src/features/vault/sub_credentials/components/features/AuditLogTable.tsx:23,:28,:35-36,:41-43,:119-141` — `DataGrid`'s `pageSize` rebuilt end to end. It gets the clamp **right** (`:41-43`, with a comment explaining why), which is the tell that this is a re-derivation of the primitive rather than a mistake. Also a raw `<table>` with untranslated `'All'` (`:78`), `'{n} entries'` (`:81`) and `'Page {n}/{m}'` (`:130`).
- `src/features/overview/sub_patterns/graph/ClusterPatternsModal.tsx:234,:239,:259-261,:322-346` — `PAGE = 8` declared inside the component body, render-time-only clamp leaving `page` stale, plus a sort dropdown and a search that each reset the page. *(Already slated for deletion in the pattern-fabric v2 UI phase.)*

**The hypothesis is corrected:** a sweep for `useState(page)` + `.slice()` across `src/**` returns ~40 files, but 38 of them are not pagination — they are `useProgressiveReveal` animation cadence (7 files), show-more booleans (5), single-item steppers with "X of N" chrome (6), fixed-depth card stacks (2), and constant display caps (~20 `slice(0, MAX)` with no state at all). Only 2 hold a page index and slice by it. **The client is not where this situation is broken; the command layer is.**

## Gaps in the primitive

1. **No primitive spans both halves.** `useLayeredList` handles cursor paging but knows nothing about tables; `UnifiedTable` virtualizes but cannot paginate; `DataGrid` paginates but cannot virtualize and cannot express a server total (its footer reads `data.length`, `DataGrid.tsx:486`). A surface that is server-paged, virtualized and needs a "N of M" footer must assemble three pieces by hand. Verified by grep: `pageSize` appears nowhere in `UnifiedTable.tsx`; `rowHeight`/`onEndReached` appear nowhere in `DataGrid.tsx`.
2. **There is no server-side keyset helper, and the helper that does exist makes unbounded the default.** `QueryBuilder` (`db/src/query_builder.rs`) composes `LIMIT`/`OFFSET` but holds no policy: no default, no cap, `has_limit` false unless asked, and `LIMIT -1 OFFSET ?N` for offset-only callers. Meanwhile keyset paging is hand-rolled independently in four places (`manual_reviews.rs:632`, `dev_tools.rs` triage `:3822` and tasks `:4936`, plus internal watermark readers `events.rs:427` and `messages.rs:384`) in four different cursor styles: opaque `"a|b"` string, two split args, a bare `has_more` with no cursor, and page-number offset. A `db::keyset::page(conn, sql, cursor, limit)` helper plus a `#[derive]`-able `Page<T>`, and a crate-wide `MAX_LIST_ROWS` default in the builder, would make the correct shape the cheap one. Their absence is why the shape diverged.
3. **Keyset indexes exist for exactly two tables.** `incremental.rs:4347` covers `dev_ideas` and `dev_tasks` only — and says why: without them "the paged reads degrade to a full scan + sort … on every page". `persona_manual_reviews`, the reference implementation of this whole path, has no such index. Every keyset page added without its index is a page that is correct and still slow.
4. **No crate-wide row cap exists.** Every one of the ~22 named row-limit constants is file-local (`TRIAGE_MAX_LIMIT`, `MAX_LIST_LIMIT` ×2, `MAX_LIST_ROWS`, `MAX_ROWS_PER_LIST`, `MAX_ROWS`, …), with five different naming conventions and no shared default. There is nothing for a new command to import, so the cheapest correct thing to do is invent a twenty-third constant — or skip it.
5. **`useLayeredList` has no `total`.** `Counts` is opaque `unknown`, so nothing can render "40 of 1,204" without a per-feature convention. Every adopter re-derives it, and `useTaskQueue` resorted to abusing the page endpoint.
6. **`useLayeredList` cannot prepend.** `loadMore` only appends (`:155`). Reverse-chronological transcripts that page *backwards* — the companion chat, `useEventLog`'s "load older" — cannot use it, which is precisely why both hand-rolled and why both are broken.
7. **No shared truncation-honesty component.** `IncidentsInbox` invented the right pattern (`:533`) and it lives in one feature. There is no `<TruncationNotice limit={n} />`, so the five surfaces that silently truncate had nothing to reach for.
8. **`onEndReached` is silently ignored under `groupBy`** (`UnifiedTable.tsx:532`). A grouped, virtualized, server-paged list has no continuation and no warning that it doesn't.
9. **`PaginatedEvents` has `has_more` and no cursor** (`core/src/models/event.rs:126-129`). The type *cannot* express a next page, which is why its only consumer invented a timestamp cursor and got it wrong. It should be a `<Entity>Page`.
10. **The `PaginatedEvents` shape was never exercised as a paging contract.** `list_events_in_range`'s two callers both discard `has_more`, and `search_events` is used only for filtered search plus the broken "load older". Nobody ever needed page 3, which is how the cursorlessness survived review.
11. **Zero tests on the server contract.** `useLayeredList` has a test file (`src/hooks/utility/data/__tests__/useLayeredList.test.ts`, 5 cases incl. the epoch guard) — the client half is the *only* half with regression coverage. No test asserts that a clamp holds, that a cursor round-trips, or that a page boundary with duplicate timestamps loses no row. The `id`-tiebreaker bug in `messages.rs` would not fail any suite.
12. **Zero enforcement.** 21 custom ESLint rules exist; none covers list bounding, and no check script reads Rust command signatures for anything but *names* (`check-command-contract.mjs`). Every deviation above shipped under a green `npm run check`.

## The missing gate

**Signal.** A `#[tauri::command]` whose return type is `Result<Vec<T>, …>` or `Result<…Page, …>`. This is a near-perfect machine signal: 384 + 6 hits out of 1,649 commands, no false positives, and it is **already extracted** by an existing script — `scripts/check-command-contract.mjs:102` carries the exact `#[tauri::command] … fn <name>` regex. The client signal is much weaker (2 real hand-rolls in the whole tree) and does not warrant its own rule; enforce the server.

**Mechanism.** A new `scripts/check-list-bounding.mjs`, wired into the existing `check:contracts` npm target (already inside `npm run check`, already CI-gated). For every list command it asserts three things:

1. **Bounded** — the fn signature accepts `limit: Option<i64|u32>` (or the page's own `limit`), *and* that value reaches a `.clamp(lo, hi)` either in the command body or in the single repo fn it delegates to. **`.max(n)` does not satisfy this and is reported by name** — it is the single most common near-miss (both `PaginatedEvents` producers), and a rule that accepted it would certify the exact bug it exists to catch.
2. **Typed page** — a command returning a `…Page`/`Paginated…` type requires that struct to carry `#[ts(export)]` and a `(nextCursor|cursor)` + `hasMore` pair. This is what catches `serde_json::Value` pages and `Serialize`-only page structs.
3. **No new `OFFSET`** — a repo fn reached from a list command must not contain `OFFSET`, and must not reach `QueryBuilder::offset()` without `::limit()` (the `LIMIT -1` path), unless allowlisted. Keyset is the house style; offset is a legacy set that may shrink and must not grow.

**Allowlist.** `LIST_BOUNDING_ALLOWLIST` in the script, keyed by command name, each entry carrying a mandatory one-line reason string. Legitimate members: closed sets bounded by seed data (`list_connectors`, `list_persona_templates`, tier/catalog reads), per-parent reads whose cardinality is a schema constraint (a persona's connectors, a team's members), and the nine existing `OFFSET` commands as a **frozen, named** legacy set. An allowlist without a reason string is rejected — the reason is what makes the next reader able to challenge it. **The allowlist is explicitly not the migration vehicle:** 225 unbounded commands cannot be reasoned about one entry at a time, and an allowlist that large is just a disabled check. The ratchet below carries the backlog; the allowlist carries only the permanent exceptions.

**How it fails loudly if its own precondition is absent.** This is the part `ci.yml` has historically got wrong, so it is specified rather than assumed:

- **Parser floor.** The script cross-checks the command names it parsed against `src/lib/commandNames.generated.ts` — an independently generated enumeration of **1,585** registered commands. If it recognises fewer than 95% of that union, it **exits non-zero with "parser is blind"**, not with "no violations". A refactor that respells the attribute (`#[tauri::command(rename_all = …)]`), moves commands out of `src-tauri/src/commands/`, or breaks the regex therefore fails the build instead of silently passing over zero files. `check-command-contract.mjs` already models the throw-on-missing-anchor idea (`:42-44`) but has no such floor on `extractImplementedTauriCommands` — this script must not repeat that.
- **Ratchet, not threshold.** The current violating counts (225 unbounded, 64 unclamped, 9 offset) are written into the script as a baseline. The check fails if any count **rises** — and equally fails if a count comes back *lower than baseline without the baseline being updated*, printing the new number. A broken parser reports 0, which trips the second branch, so the gate cannot degrade into a no-op that manufactures confidence.
- **Non-vacuous allowlist.** Every allowlisted name must still resolve to a real registered command; a stale entry is an error, exactly as `staleOverrides` already is in the sibling script. An allowlist that quietly stops matching anything is the other way a gate dies.
- **Self-test.** A fixture pair under `scripts/__tests__/` — one command that violates each of the three rules, one that satisfies each — asserted on every run, so the rules are proven live rather than assumed live. `scripts/docs/__tests__/check-doc-sync.test.mjs` is the precedent.

**What no gate can catch, and is therefore doctrine only:** whether the `id` tiebreaker is in the `ORDER BY`, whether the cursor predicate is composite, whether a keyset page has its supporting index, and whether the rendered total describes the same set as the rendered rows. These are semantic and need the tests named in Gap 11 — one page-boundary test per paginated entity, asserting that two sequential pages over a table with duplicate timestamps lose and duplicate nothing. Write that test when you write the page. A grep can tell you the query is bounded; only a test can tell you the page is honest.

## See also

- [Tables & list surfaces](./tables.md) — what renders the rows once this path has bounded them.
- `long-list-rendering` — bounding the DOM. **Decision rule:** bounded-by-construction set → one clamped fetch + `DataGrid pageSize`. Growing table, short window → keyset page + `useLayeredList`. Growing table, long scroll → keyset page + `UnifiedTable` with `rowHeight` + `onEndReached`. Virtualization never substitutes for a bounded query: the rows are already in memory by the time it helps.
- [Page loading](./page-loading.md) — the L0-counts-first paint this path's `fetchCounts` feeds.
- `docs/architecture/overview-layered-fetch.md` — the 2026-05-21 ADR this path supersedes for prescription. Its rollout table (`:136-144`) is stale; see Deviations P0.
