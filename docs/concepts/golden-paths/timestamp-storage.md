# Golden path — Timestamp storage

> Situation node: `data-persistence/data-modeling/timestamp-storage` · [situation spine](../situation-spine.md)
> Composed 2026-08-13 from a ground-truth sweep of the Rust tree (`src-tauri/{src,db,core,engine,data}`),
> the four migration files, and `src/**`, against `master` @ `7bb572e2b`. `.claude/worktrees/**` and
> `target/` excluded from every count. Every number below was measured, not estimated; the SQLite
> behaviours were verified by running them.
> Dimensions: **function · resilience · performance**. Two-sided: Rust write · SQL default · frontend read.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells in
> `workspace_practice_context_state` when this path is ingested.

## Trigger

- "Add a `created_at` / `updated_at` / `expires_at` / `last_seen_at` column"
- "Prune rows older than N days" / "count executions in the last 24 hours" / "spend this month"
- "Why is this timestamp two hours off?" / "why does the relative time say '2h ago' for something that just happened?"
- "Sort by most recent" / "paginate this feed by cursor" / "merge these two tables into one timeline"
- "This lease/claim/token isn't expiring" / "retention isn't deleting anything"
- "Parse the timestamp from the DB"

If you are about to type `to_rfc3339()`, `DEFAULT (datetime('now'))`, `datetime('now', '-30 days')`, `datetime(created_at)`, `NaiveDateTime::parse_from_str`, `new Date(row.created_at)`, `Date.parse(`, `.replace(' ', 'T')`, or `a.created_at.localeCompare(b.created_at)` — you are in this situation.

## The one way

Store every moment as **one fixed-width string: `YYYY-MM-DDTHH:MM:SS.sssZ`** (24 characters, always — UTC, `T` separator, exactly three fractional digits, literal `Z`). Produce it in Rust with `to_rfc3339_opts(SecondsFormat::Millis, true)` behind the shared `core::utils::now_utc()` helper — never `to_rfc3339()`, never `Utc::now().format(...)`, never `Local::now()`. Produce it in SQL with `strftime('%Y-%m-%dT%H:%M:%fZ','now')` — as the column `DEFAULT` and as the right-hand side of every comparison. Because the shape is fixed-width and zone-terminated, **byte order equals chronological order unconditionally**, so compare the raw column (`created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`) and never wrap it in `datetime(...)` — the wrapper is what makes the predicate non-sargable and costs you the index. On the frontend the string is byte-identical to `new Date().toISOString()`, so `Date.parse` is correct with no normalization: render through `display/RelativeTime` or `display/AbsoluteTime` and sort with `localeCompare` on the raw value. Then stop: no format fallback parser, no `datetime()` wrapper, no `.replace(' ', 'T')`, no `Local::now()`. The two shapes this repo actually holds today are each internally coherent — what is broken is that **nothing pins which shape a given column contains**, so every predicate's correctness is an accident of which code path last wrote the row.

## Mandated primitives

**Exist today — use them:**

- **`src/lib/utils/formatters.ts:11` — `normalizeTimestamp(s)`.** The one correct frontend adapter for legacy rows: `/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/` → `s.replace(' ','T') + 'Z'`. Its docblock (`:6-10`) states the bug verbatim. **Only 3 modules call it.**
- **`src/features/shared/components/display/RelativeTime.tsx`** — `timestamp: string | number | null`, `fallback = '-'`, `showTooltip = true`. Normalizes at `:30`, live-updates off the shared tick in `src/hooks/utility/timing/relativeTimeTicker.ts`. **Correct as shipped.** 100 usages / 86 files. The elapsed-time primitive.
- **`src/features/shared/components/display/AbsoluteTime.tsx`** — `variant?: 'datetime' | 'date' | 'time' | 'compact'`, `fallback`, `showRelativeTooltip = true`; presets in the `FORMATS` map at `:10-16`. The fixed-timestamp primitive **once it is fixed** (see Deviations P0).
- **`src-tauri/core/src/utils/mod.rs:10` — `now_ms() -> i64`.** Epoch millis for in-memory/registry use. 66 call sites. Orthogonal to TEXT columns — do not widen it into a clock.
- **`db/src/migrations/incremental.rs:33` — `ddl_step(conn, sql)`.** The add-column/exec wrapper every migration goes through.

**Do not exist — this path defines them; create them before writing new code:**

- **`core::utils::now_utc() -> String`** = `chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)`. The single Rust chokepoint. Sits beside `now_ms()` in `core/src/utils/mod.rs`. **There is no shared now-helper in this repo today** — the five that exist are module-private one-offs (`src/cloud/sync/mod.rs:142`, `src/cloud/remote_commands.rs:64`, `src/engine/project_tracking/pulse.rs:180`, and two under `#[cfg(test)]`: `src/engine/failover.rs:328`, `db/src/repos/resources/persona_change_log.rs:475`), so **657 sites open-code `Utc::now().to_rfc3339()` with no chokepoint to change.** This is the root cause of every deviation below.
- **`core::utils::SQL_NOW`** = the `&'static str` `"strftime('%Y-%m-%dT%H:%M:%fZ','now')"`, for DDL defaults and predicate right-hand sides.
- **`toEpochMs(s: string): number`** exported from `src/lib/utils/formatters.ts` — the single frontend parse. Replaces the duplicate `toEpochUtc` at `src/lib/channel/eventModel.ts:13` and the seven broken half-fixes.

## Steps

1. **Declare the column** `TEXT` with `DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`. Never `DEFAULT (datetime('now'))`. Add the index you intend to use (`CREATE INDEX ... ON t(created_at DESC)`) — with a fixed-width canonical shape a plain column index is all you ever need.
2. **Declare it once.** Put the DDL in exactly one migration file. If a table is created in both `initial.rs`/`schema.rs` *and* patched by `incremental.rs`, the two must agree byte-for-byte on the timestamp columns — 14 columns currently do not (see Deviations).

   > **Contested count (2026-08-14).** A later composer re-parsed this
   > **table-scoped** — comparing each column against the same table's other
   > declaration — and measured **4**, not 14. The methods differ in exactly the
   > way that inflates: an unscoped parse matches a column *name* across
   > different tables and reports a disagreement that isn't one. That is the
   > same substring-vs-structural error that made the Tauri-command count wrong
   > three times running, so **4 is the more likely figure and 14 should not be
   > cited until adjudicated.** Neither number has been re-derived by a third
   > pass; the doctrine in this section does not depend on which is right.
3. **Write it from Rust** with `now_utc()` bound as a parameter, or omit the column entirely and let the DEFAULT fire. Both now produce the identical 24-character string, so **either is correct** — that equivalence is the whole point of choosing a shape SQLite can also emit.
4. **Compare the raw column.** `WHERE created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')`, `ORDER BY created_at DESC`, `WHERE expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')`. No `datetime(col)`. No `julianday(col)`. Cross-table timeline merges compare the raw values directly — no `strftime` normalization layer.
5. **Read it in TypeScript** through `RelativeTime` (elapsed) or `AbsoluteTime` (fixed). Sort with `localeCompare` on the raw string; when you need arithmetic use `toEpochMs()`. Never `new Date(str)` in a component.
6. **Stop.** No `parse_from_str` fallback loop, no `parse_ts` helper, no `.replace(' ','T')`, no `Date.parse` outside `formatters.ts`.

### Existing rows — the migration (not optional; a write-side fix alone changes nothing)

Every database in the field holds a permanent mix of four shapes, and **no migration in this repo has ever normalized timestamp data** — the only ones that touch it are NULL back-fills (`incremental.rs:7718-7724`) that write the *wrong* shape into tables whose live writers use RFC3339. So the 81 broken predicates keep returning wrong sets on historical rows even if all 657 write sites were fixed today. Fix the data:

```sql
UPDATE <table>
   SET <col> = strftime('%Y-%m-%dT%H:%M:%fZ', <col>)
 WHERE <col> IS NOT NULL
   AND <col> NOT LIKE '____-__-__T__:__:__.___Z'
   AND strftime('%Y-%m-%dT%H:%M:%fZ', <col>) IS NOT NULL;
```

All four verified against SQLite (`sqlite3 :memory:`, 2026-08-13):

| input | `strftime('%Y-%m-%dT%H:%M:%fZ', …)` |
|---|---|
| `2026-08-13 12:34:56` (SQLite default) | `2026-08-13T12:34:56.000Z` |
| `2026-08-13T12:34:56.789012+00:00` (`to_rfc3339`) | `2026-08-13T12:34:56.789Z` |
| `2026-08-13T12:34:56Z` (`to_rfc3339_opts`, legacy migrations) | `2026-08-13T12:34:56.000Z` |
| `2026-08-13T12:34:56` (`format("%Y-%m-%dT%H:%M:%S")`) | `2026-08-13T12:34:56.000Z` |
| `garbage` | `NULL` |

The three guards are each load-bearing: `NOT LIKE` makes the migration **idempotent and cheap to re-run** (a canonical value matches the pattern and is skipped — verified); `IS NOT NULL` on the result stops an unparseable value from being **nulled out** (`strftime` returns NULL on garbage, and a bare `SET col = strftime(col)` would silently destroy it); `<col> IS NOT NULL` preserves legitimately-absent timestamps. Run it once per timestamp column via a loop over the census the gate script already produces (§9), inside `incremental.rs` behind a version flag. Sub-second precision is truncated to milliseconds — accept that; it is the price of fixed width, and the only place the repo relies on finer precision is `team_channel.rs:176`, which already tie-breaks on `id`.

Order matters: **normalize the data first, then flip the DDL defaults, then swap the predicates.** Removing a `datetime()` wrapper before the data is uniform converts a slow-but-correct query into a fast-and-wrong one.

## Anti-patterns

- **`chrono::Utc::now().to_rfc3339()`** — 657 sites. `to_rfc3339()` hardcodes `SecondsFormat::AutoSi` and `use_z = false` (`chrono-0.4.45/src/datetime/mod.rs:634-642`), so it emits **variable-width** output (25/29/32/35 chars) with a `+00:00` offset. Among itself it happens to sort correctly (`+` = 0x2B sorts below `.` = 0x2E and below every digit), but it is not comparable to anything else, and its width variance makes cursor pagination fragile.
- **`DEFAULT (datetime('now'))`** — 337 occurrences. Emits `YYYY-MM-DD HH:MM:SS`: no zone marker, no sub-second, space separator. `' '` = 0x20 sorts **below** `'T'` = 0x54, so any comparison against an RFC3339 value on the same date is inverted. Verified: `'2026-08-13 12:00:00' < '2026-08-13T00:00:00+00:00'` → `1` (a row 12 hours *later* sorts first).
- **Mixing `Z` and `+00:00`** — `'Z'` = 0x5A sorts **above** every digit. Verified: `'2026-08-13T12:00:00Z' > '2026-08-13T12:00:00.500+00:00'` → `1`, i.e. the earlier instant sorts later. The repo has one `to_rfc3339_opts(Secs, true)` writer (`src/commands/companion/approvals/approval_exec_dev.rs:787`) and, per `db/src/repos/communication/sla.rs:836-837`, historical migration rows carrying `Z`.
- **`WHERE created_at < datetime('now','-30 days')` on an RFC3339 column** — 81 sites. Fails only on the *boundary day*, so it looks right in testing and is wrong by up to 24 hours in production. Bounded, but the bound is fixed while the window is not: at `-2 minutes` (`src/commands/companion/fleet_bridge.rs:1695`), `-30 minutes` (`:1730`) or `-24 hours` (`src/mcp_server/tools.rs:1960`) **the error equals or exceeds the window itself**.
- **`WHERE datetime(created_at) > datetime(?1)`** — 91 sites. Correct, and the reason it exists, but wrapping the column in a function makes the predicate non-sargable: SQLite cannot use any index and scans + date-parses every row. `src/cloud/sync/rows.rs:508` does this across **11 tables on every sync pass**, already logged as a High finding in `docs/harness/refactor-perf-2026-07-16/tauri-cloud-misc.md:6-10`. **Do not act on that doc's fix sketch** — it says "all writers stamp RFC3339 UTC", which is false: 3 of the 11 cursor columns (`persona_memories.updated_at`, `execution_knowledge.updated_at`, `persona_healing_issues.created_at`) carry `DEFAULT (datetime('now'))`, so the wrapper is load-bearing until the data is normalized.
- **Writing a defensive multi-shape parser** — 9 exist, four of them named `parse_ts` in four different files. Each is a receipt for the write side's inconsistency. They belong in Deviations, never in new code.
- **`Utc::now().format("...")`** — 20 sites across **12 distinct format strings**, including `"%Y-%m-%d %H:%M:%S"` (the SQLite shape, hand-rolled in Rust — `src/engine/kpi_derivation.rs:483,496,508`) and `"%Y-%m-%dT%H:%M:%S"` with no zone at all, assigned to a field literally named `created_at` (`src/commands/artist/mod.rs:904`).
- **`Local::now()` anywhere near persistence** — 22 real calls. Quiet-hours / night-shift / daily-goal uses are legitimate (they model the user's wall clock); four are not: `src/logging.rs:109`, `src/logging.rs:256`, `src/commands/credentials/auto_cred_browser.rs:304` stamp `Local::now().to_rfc3339()` (a non-UTC offset) into persisted log/crash artifacts, and `db/src/repos/communication/sla.rs:604` makes DB-layer logic depend on the host TZ.
- **`new Date(backendString)` in a component** — 87 sites / 60 files. V8 parses `"2026-08-13 12:34:56"` through its non-standard fallback as **local time**, so a row written "now" reads "2h ago" for a UTC+2 viewer. It also mis-buckets: `src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:40-41` uses `toLocaleDateString()` as a **grouping key**.
- **`.replace(' ', 'T')` without appending `'Z'`** — 7 sites, all in the KPI/goals cluster. A half-fix: it makes V8 take the ISO path, which for an offsetless string still means local. Self-consistent within a comparison, wrong the moment it meets `Date.now()` — which `src/features/teams/sub_kpis/kpiMath.ts:57` does.
- **`a.created_at.localeCompare(b.created_at)` across mixed shapes** — 34 sites / 33 files. A space-form row on a given date always sorts before every `T`-form row on that date. `src/features/triggers/sub_test/TestTab.tsx:105,142` takes `.sort(...)[0]` as "latest run" — a wrong *pick*, not just a wrong order.
- **Declaring a test fixture's table with a different timestamp shape than production** — 7 sites. `src/companion/jobs/operations_views.rs:270` gives `persona_executions.created_at` a `DEFAULT (datetime('now'))` that production (`db/src/migrations/schema.rs:128`) does not have. The tests then validate against a schema the app never runs.

## Evidence

Adoption is thin — this situation has no established correct answer in the repo. Four sites are worth copying, each for one half of the problem:

- **`src/lib/utils/formatters.ts:6-15` — copy this one.** The only place in the codebase that states the defect and fixes it in the same breath: the docblock names SQLite's zone-less output and V8's local-time misread, and `normalizeTimestamp` handles both the space-separated and the offsetless-`T` forms. Everything the frontend half of this path asks for is a generalization of these ten lines.
- `src/features/shared/components/display/RelativeTime.tsx:27-38` — the correct primitive shape: normalize once at the boundary (`:30`), then `Date.parse` (`:33`), `formatRelativeTime` (`:36`), tooltip (`:38`). One parse, one place.
- `db/src/repos/communication/events.rs:591-597` — **the only retention prune in the repo that is correct.** `// Use chrono for the cutoff date to match the timestamp format used in publish().` `persona_events.created_at` is writer-supplied RFC3339 (`db/src/migrations/schema.rs:323`), and the cutoff is built with chrono to match. It is right by explicit reasoning — and it is right *alone*: at least five sibling prunes (`db/src/journal.rs:426-427`, `db/src/repos/execution/executions.rs:1849,1885`, `db/src/repos/communication/messages.rs:520`, `db/src/repos/resources/oauth_token_metrics.rs:202`, `src/engine/project_tracking/events.rs:87`) use the SQL form against columns that hold the other shape.
- `src/commands/teams/team_channel.rs:164,174-177` — the state of the art *given* the mess: normalize on read to one canonical shape (`strftime('%Y-%m-%dT%H:%M:%SZ', datetime(col))`), keyset-paginate on it, tie-break on `id` because the normalization drops sub-second precision. It merges four heterogeneous sources into one correct timeline. Copy the *idea* (one canonical comparison shape); do not copy the *mechanism* — the wrapper costs a full scan, and after the migration the raw column does this for free.
- `db/src/repos/dev_tools.rs:6465` — the test named `parses_the_three_timestamp_shapes_this_database_actually_stores`, which closes with `assert!("2026-05-01T14:00:00+02:00" > "2026-05-01T13:00:00Z", "…yet the strings sort the other way")`. **The repo already proves the defect in a passing test** — and 81 SQL predicates still do exactly what it warns against.

## Deviations found

| Category | Count | Where |
|---|---:|---|
| **P0** `AbsoluteTime` does not normalize | **38 usages / 32 files** | `display/AbsoluteTime.tsx:44-47` |
| **P0** Same `table.column`, different DDL per install path | **14 cols / 8 tables** | `schema.rs` · `initial.rs` vs `incremental.rs` |
| DDL `DEFAULT (datetime('now'))` | **337** occurrences | 258 in migrations (incremental 151 · schema 60 · initial 36 · fk_hygiene 11); 79 in fixture/shadow DDL |
| Tables mixing both shapes across their own ts columns | **91** of 293 | census (639 ts columns: 330 defaulted · 304 writer-supplied · 5 other) |
| Rust `Utc::now().to_rfc3339()` (no chokepoint) | **657** | whole tree; `to_rfc3339` overall: 803 |
| Inline `datetime('now')` written as a value | **102** | e.g. `db/src/repos/dev_tools.rs` — 15 alongside 55 `to_rfc3339` in one file |
| `Utc::now().format(...)` ad-hoc shapes | **20** across **12** formats | incl. 3 hand-rolled SQLite-shape, 1 zone-less |
| `Local::now()` reaching persistence | **4** of 22 | `logging.rs:109,256` · `auto_cred_browser.rs:304` · `sla.rs:604` |
| Unwrapped `col <op> datetime('now',…)` — silently wrong | **81** | 58 no-offset · 13 `-30 days` · 4 `start of month` · 2 `-1 day` · 1 each `-2 min`/`-30 min`/`-24 h`/`-14 d` |
| Wrapped `datetime(col)` — correct, non-sargable | **91** sites | 14 comparisons · 15 `ORDER BY` · rest projections |
| SQL read-normalization layer | **12** | all `src/commands/teams/team_channel.rs` |
| Defensive multi-shape parsers in Rust | **9** | 4 of them named `parse_ts` |
| Frontend raw `new Date(<backend field>)` | **87 / 60 files** | — |
| Frontend `Date.parse(` | **67 / 51 files** | — |
| `localeCompare` on a timestamp field | **34 / 33 files** | 1 correct (`GoalsMissions.tsx:114`) |
| Relational `<`/`>` on raw timestamp strings | **~11** | e.g. `stores/slices/agents/chatSlice.ts:410` |
| `replace(' ','T')` without `'Z'` (broken half-fix) | **7** | KPI/goals cluster |
| Competing un-normalizing relative-time formatters | **5** | incl. `display/grouping.ts:31` (day bucketing) |
| Fixture DDL disagreeing with production shape | **7** | — |
| Expression indexes over `datetime(col)` | **0** | see note below |

### P0 — fix these first

| Path | Defect |
|---|---|
| `src/features/shared/components/display/AbsoluteTime.tsx:44-47` | `Date.parse(timestamp)` raw. Its own docblock (`:6`, `:31-35`) declares it *"the canonical primitive… Never hand-roll `new Date(x).toLocaleString()`"*, so 38 call sites trust it — and every one silently shifts by the viewer's UTC offset on a shape-B value. **One-line fix: wrap in `normalizeTimestamp`.** Also builds a fresh `Intl.DateTimeFormat` per render at `:51`, unmemoized, unlike `formatters.ts:80-91`'s `numberFormatCache`. |
| `credential_audit_log.created_at` | `db/src/migrations/schema.rs:678` declares `DEFAULT (datetime('now'))`; `db/src/migrations/incremental.rs:1046` declares it with **no default**. The shape of a compliance audit trail's timestamp depends on whether the user installed fresh or upgraded. |
| `research_{projects,sources,hypotheses,experiments,experiment_runs,findings,reports}` — 13 cols | `db/src/migrations/initial.rs:406-516` declares `DEFAULT (datetime('now'))`; `incremental.rs:7639-7705` adds the same columns with **no default at all** on legacy DBs, so the identical INSERT writes the space form on a fresh install and **NULL** on an upgraded one. Then `incremental.rs:7718-7724` back-fills those NULLs with `datetime('now')` — the wrong shape for tables whose live writers use RFC3339. |

### Correctness defects, ranked by consequence

- **Late expiry (security-relevant).** `db/src/repos/resources/exposure.rs:58` (`expires_at > datetime('now')`) and `:77` (`expires_at <= datetime('now')`), plus `engine/src/p2p/manifest_sync.rs:238`. `exposed_resources.expires_at` is writer-supplied RFC3339 (`schema.rs:1386`) compared against the space form, so a resource that expired earlier *today* still reads as live until midnight UTC — up to ~24h of over-exposure, in the permissive direction.
- **Money windows.** `db/src/repos/core/personas.rs:1503`, `db/src/repos/execution/executions.rs:1665`, `db/src/repos/execution/policy_evidence.rs:101` (`created_at >= datetime('now','start of month')`), all of `db/src/repos/llm_spend.rs:128,153,170,211` and 15 predicates in `db/src/repos/execution/metrics.rs`. The month boundary is exactly the boundary-day case, so spend attribution slips a day across the month edge.
- **Retention lag.** The five prunes listed under Evidence retain the boundary day indefinitely — bounded at ~24h, not unbounded growth, but permanent.
- **Window smaller than the error.** `src/mcp_server/tools.rs:1960` — `persona_executions.created_at` is RFC3339 (`schema.rs:128`), so `>= datetime('now','-24 hours')` returns up to 48 hours of rows for a tool that reports a 24-hour count.
- **Correct only by accident.** `src/commands/companion/fleet_bridge.rs:1695,1730` (2-minute and 30-minute GC on `companion_approval.created_at`) work today *only* because that table happens to be uniformly space-form — DDL default plus five writers that all pass `datetime('now')` literally (`backlog_triage.rs:203`, `incident_diagnosis.rs:179`, `profile_synthesis.rs:353`, `dispatcher.rs:3195`, `night_plan.rs:167`). One `now_utc()` writer added to that table breaks a 2-minute window by a full day. **This is the whole thesis in one table.**
- **Same column, both shapes, in normal operation.** `persona_memories.updated_at` — `DEFAULT (datetime('now'))` (`schema.rs:527`) and `chrono::Utc::now().to_rfc3339()` at `db/src/repos/core/memories.rs:288,326,339,498`. Same for `dev_kpis` (`db/src/repos/dev_tools.rs:6786` omits → default; `:7001,7104,7191` write `datetime('now')`; `:6857,6897` bind RFC3339) and `memory_nodes` (`memory_ledger.rs:322,891` omit; `data_portability.rs:7534` binds).
- **Fragile-by-convention lease.** `db/src/repos/execution/executions.rs:884-886`: *"`claim_expires_at` is written in RFC3339 (chrono), the same format compared in the predicate — keep all writers on RFC3339 so the lexicographic `<` stays chronologically correct."* Correct today, guarded by a comment. The multi-driver claim CAS is the wrong place for an invariant a machine does not check.

### Corrections to prior findings

- **"Twelve expression indexes exist purely to make `datetime(col)` sargable" — false. There are zero.** No `CREATE INDEX` in the repo references `datetime`, `strftime` or `julianday` (564 `CREATE INDEX` statements checked). The number 12 matches the 12 `strftime('%Y-%m-%dT%H:%M:%SZ', datetime(col))` **read-normalizations** in `src/commands/teams/team_channel.rs`, and an expression index appears only as an unbuilt *fix sketch* in `docs/harness/refactor-perf-2026-07-16/tauri-cloud-misc.md:14`. The performance cost is therefore worse than reported, not better: 91 wrapped predicate sites are non-sargable **with no index able to serve them**.
- **"371 vs 422"** → measured 657 `Utc::now().to_rfc3339()` (803 `to_rfc3339` overall) vs 337 `DEFAULT (datetime('now'))`.
- **"A four-format fallback parser"** → `db/src/repos/communication/sla.rs:839` accepts **five** shapes (RFC3339 + four naive), and it is **one of nine** such parsers.
- **"Three others don't"** → at least **five** sibling retention prunes use the SQL form against the other shape.

## Gaps

1. **No Rust clock primitive exists.** This is upstream of ~800 write-side deviations. There is no `time.rs`/`clock.rs` anywhere in the Rust tree; the five `now`-shaped functions are module-private and three are test-only. Until `core::utils::now_utc()` exists there is nothing to route people to, and no single edit can change the shape.
2. **`to_rfc3339()` is the wrong default and chrono offers no better one.** It hardcodes `AutoSi` + `use_z=false`; getting the canonical shape requires the two-argument `to_rfc3339_opts(SecondsFormat::Millis, true)`, which is longer to type than the wrong answer. That asymmetry is why 657 sites chose wrong — the fix must be a shorter helper, not a lint telling people to type more.
3. **SQLite's `datetime('now')` is the ergonomic DDL default and it is the wrong shape.** `strftime('%Y-%m-%dT%H:%M:%fZ','now')` is 38 characters versus 15. A `SQL_NOW` constant helps Rust-side string building but cannot help the ~258 literal DDL strings; those need a one-time mechanical rewrite plus the gate to hold the line.
4. **Millisecond truncation is lossy and unavoidable.** The canonical shape drops sub-millisecond precision that `to_rfc3339()`'s `AutoSi` currently preserves. Nothing in the repo depends on it (`team_channel.rs:176` already tie-breaks on `id`), but any future ordering that needs finer resolution must carry an explicit sequence column, not more fractional digits.
5. **`normalizeTimestamp` cannot be enforced by types.** Every backend timestamp arrives as `string` through the ts-rs bindings, indistinguishable from any other string, so nothing stops `new Date(row.created_at)`. A branded `Timestamp` type in `src/lib/bindings/` would fix this structurally but requires a ts-rs newtype on the Rust side — larger than this path, and the right long-term answer.
6. **`display/grouping.ts:31` bucketing is a hidden third consumer.** `timeGroupKey` feeds `UnifiedTable`'s `groupBy`, so an hours-level shift moves rows into the wrong day header — a correctness bug that surfaces as a UI oddity and will not be traced back here.
7. **The frontend has two parallel correct parsers and five incorrect ones.** `normalizeTimestamp` (`formatters.ts:11`) and `toEpochUtc` (`eventModel.ts:13`) are independent reimplementations of the same fix; `formatRelativeTime` exists in four more places that do not normalize (`plugins/companion/inbox/utils/formatRelativeTime.ts:34`, `plugins/drive/designTokens.ts:304`, `overview/libs/formatRelativeShort.ts:36`, `hooks/utility/data/useFormattedDate.ts:34`). Consolidation is a precondition for any lint rule with a clean allowlist.
8. **Zero enforcement on the Rust side, by construction.** `npm run check` runs `eslint src/` only; lefthook's pre-commit is eslint-on-staged + secret-scan + i18n, and pre-push is `tsc` + i18n + evals + `.ai/doctor`. **Nothing in either hook reads `src-tauri/`.** Clippy runs in CI (`ci.yml:261`) but cannot see inside SQL string literals. So the gate below has to be a script, not a lint.
9. **The test suite is structurally blind to this.** No frontend test ever feeds a `"YYYY-MM-DD HH:MM:SS"` string; every fixture is `.toISOString()`-generated shape A. Worse, `display/__tests__/grouping.test.ts:35` asserts `timeGroupKey('2026-05-28T01:00:00', NOW) === 'today'` — an unzoned fixture that passes only because both sides are read in the runner's local zone, **enshrining the local-time misreading as correct**. The Rust side is better (`dev_tools.rs:6465`, `sla.rs:1218-1236`) but tests only the parsers, never the SQL predicates.

## The missing gate

Every deviation above shipped under a green `npm run check`, a green `cargo clippy -D warnings`, and a green `npm run test`. Three checks, wired where they will actually run.

### 1. `scripts/check-timestamp-shape.mjs` — the primary gate (Rust + SQL)

**Signal.** Three exact, machine-decidable string patterns in the Rust tree, with no false-positive class:
- `DEFAULT (datetime('now'))` in any DDL string → banned shape.
- A `CREATE TABLE` / `ALTER TABLE ADD COLUMN` whose column name matches `/(_at|_date|_until|_ts)$/` — the census key. 639 columns / 293 tables, extracted deterministically.
- `datetime(<identifier>)` where the identifier matches that same suffix set → non-sargable wrapper.
- `Utc::now().to_rfc3339()` / `Utc::now().format(` / `Local::now()` outside `core/src/utils/mod.rs`.

**Mechanism.** A node script — *not* a lint. ESLint cannot see Rust and clippy cannot see inside string literals; the precedent is `scripts/check-event-registry.mjs`, which already regex-parses `core/src/events.rs` and exits 1. Wire it into `npm run check` (so it runs in `ci.yml:110`'s `frontend-checks` and in the pre-push hook) and add it to lefthook `pre-commit` scoped to `src-tauri/**`. Four assertions:
- **A — no new banned shapes.** Compare against a frozen `scripts/data/timestamp-shape-baseline.json` holding today's 337 defaults / 657 `to_rfc3339` sites keyed by `path:symbol`. **Ratchet-only:** the count may fall, never rise. A new entry fails with the canonical replacement in the message.
- **B — one shape per column, zero tolerance, no allowlist.** If a `table.column` is declared with two different default shapes across `schema.rs` / `initial.rs` / `incremental.rs` / `fk_hygiene.rs`, fail. This catches the 14 install-path divergences and can never be legitimate.
- **C — fixtures match production.** Any `CREATE TABLE` outside `db/src/migrations/` naming a table that migrations also declare must agree on timestamp defaults. Catches the 7 fixture divergences, including the `persona_executions` one that makes a test assert against a schema the app never has.
- **D — no unwrapped `col <op> datetime('now'…)` and no `datetime(col)`** outside the baseline, so the 81 + 91 sites can only shrink.

**Allowlist** (named in the script, each with a reason):
- `src/commands/teams/team_channel.rs` — the 12 read-normalizations, until the migration lands; then deleted, not re-allowed.
- `core/src/utils/mod.rs` — the only legal home for `Utc::now()`.
- The nine defensive parsers — allowed to *read* legacy shapes, banned from *writing* them; the allowlist entry names each and is expected to shrink to zero after the migration.
- `Local::now()` for quiet-hours / night-shift / daily-goals (`quiet.rs`, `night_shift/mod.rs`, `triggers.rs`, `daily_goals.rs`, `rollup.rs`, `overnight.rs`) — these model the user's wall clock and are correct. `logging.rs`, `auto_cred_browser.rs`, `sla.rs:604` are **not** allowlisted.

**How it fails loudly if its own precondition is absent** — the part `ci.yml` keeps getting wrong:
- Assert all four migration files exist and are non-empty; exit 1 naming the missing path. A rename must break the build, not silently drop check B.
- Assert the parse found **≥ 250 tables and ≥ 550 timestamp columns**. Today's census is 293/639; if a DDL-formatting change breaks the regex the script would otherwise report zero violations and pass. A floor turns "I parsed nothing" into a failure instead of a green tick.
- Assert the baseline file parses and is non-empty. An empty or missing baseline is a hard error, never "no violations".
- Assert the Rust roots are non-empty directories. If `src-tauri/db` moves, fail rather than scan nothing.
- Print the surviving violation count on success. A gate that says `0 remaining of 337` is auditable; one that prints nothing is indistinguishable from one that ran nothing.

### 2. `custom/no-raw-date-parse` — the frontend half

**Signal.** `new Date(x)` where `x` is not a numeric literal or `Date`, and any `Date.parse(`. Modelled on the existing `eslint-rules/prefer-numeric.cjs`, which already bans raw `.toFixed()`/`.toLocaleString()` in favour of `display/Numeric` — the same shape of problem with the same shape of answer. **Allowlist:** `src/lib/utils/formatters.ts` (the one parse), `new Date()` with no argument, and `new Date(<number>)`. Error, not warn, for new code. Message points at `RelativeTime` / `AbsoluteTime` / `toEpochMs`. This is enforceable today at 154 sites and should land baselined-then-ratcheted, since the repo's warning baseline is already ~10k and a new warn-level rule would be invisible.

### 3. `src/lib/utils/__tests__/formatters.test.ts` — the behavioural gate

The two lint gates check shapes; only a test checks *behaviour*, and this is precisely where the model-effort guide's warning applies — a gate that asserts data is not a gate on behaviour. Assert that `"2026-08-13 12:34:56"`, `"2026-08-13T12:34:56Z"`, `"2026-08-13T12:34:56.789012+00:00"` and `"2026-08-13T12:34:56"` all resolve to the **same epoch**, and that `AbsoluteTime` renders them identically.

**Its own precondition is the trap.** The test passes vacuously on a UTC runner, because local *is* UTC there — exactly the flaw already baked into `display/__tests__/grouping.test.ts:35`. So the file must open with:

```ts
if (new Date().getTimezoneOffset() === 0) throw new Error(
  'timestamp tests must run under a non-UTC TZ — set TZ=America/New_York'
);
```

and `vitest.config.ts` must set `TZ` for this suite. A test that cannot detect the bug it exists to prevent is worse than no test. Mirror it in Rust: a `#[test]` in `db/src/migrations/` that opens an in-memory DB, runs the full migration chain, reads `PRAGMA table_info` for every table, and asserts each timestamp column's default is either absent or exactly `strftime('%Y-%m-%dT%H:%M:%fZ','now')` — with the same floor assertion (`≥ 250 tables seen`) so a broken migration chain fails instead of asserting over nothing. That test runs today in `ci.yml:258`'s `rust-tests` job with no new infrastructure.

> **Corrections pass — 2026-08-13 · gate lane.** This document specifies a
> gate living in `personas-db` (or another extracted crate) and describes it as
> "already CI-gated" via `npm run test:rust`. That was **false when written**:
> `scripts/build/run-rust-tests.mjs` passes `--lib` against the ROOT manifest,
> so only `personas-desktop`'s lib target compiles, and `test:rust` appeared in
> no workflow and no lefthook job. A test placed there would have been written,
> merged, marked done, and never executed.
>
> `ad91bd538` added `--workspace` to `cargo test` and `cargo clippy` in
> `ci.yml`, so crate tests now run **in CI**. `npm run test:rust` still does
> not run them locally — use `cargo test -p <crate>` or
> `npm run test:rust:crates`. Any gate here must state which lane it runs in
> and must not claim `test:rust` covers it.
