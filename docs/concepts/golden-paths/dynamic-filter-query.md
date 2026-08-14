# Golden path — Dynamic filter query

> Situation node: `data-persistence/query-composition/dynamic-filter-query` ·
> [situation spine](../situation-spine.md) · recurrence **59** · dimensions
> **function · performance · security · code-quality · resilience**.
> Composed 2026-08-14 against `master`.
>
> **Sweep size.** All **963 `.rs` files** under `src-tauri/**` (exactly `rust.files` in
> [`shared-facts.json`](../shared-facts.json) — two independent walks agreeing, which is the only
> reason to trust either) parsed with a comment-stripping, string-literal-aware, raw-string-aware
> scanner rather than grepped. From that parse: **475 `format!` calls whose literal contains SQL**,
> and every one of the **886 `{}` placeholders inside them** classified by its position in the
> statement; **492 SQL literals containing `COUNT(` and `FROM`**, of which **383 carry a `WHERE`**
> and **24 carry both a `WHERE` and a runtime placeholder**; **129 SQL literals containing `LIKE`**
> (163 `LIKE` occurrences) of which **10 carry `ESCAPE`**; **22 LIKE-pattern constructions**;
> **1,660** of the **1,661** `#[tauri::command]` fns (`tauriCommands` in
> [`shared-facts.json`](../shared-facts.json) — no new command count is minted here) parsed with
> full parameter lists. Every dynamic-filter function named below was opened and read. `target/` and
> `.claude/worktrees/**` excluded throughout.
>
> **Measured against RUNNING SOFTWARE.** The operator's live `personas.db` (347 MB) was copied and
> opened read-only; **14 `EXPLAIN QUERY PLAN`s** were run against it, and the `LIKE` folding
> semantics were measured on the *same SQLite build family the app links* — `rusqlite` is
> `features = ["bundled"]` (`src-tauri/Cargo.toml:134`), so the probe used `better-sqlite3` 12.9.0
> (SQLite 3.53.0, **zero `ICU` compile options**). **This mattered:** the first probe used the
> `sqlite3.exe` on this machine's PATH, which *is* ICU-linked and reported `'É' LIKE 'é'` → **1**.
> The app's SQLite reports **0**. A gate — or a golden path — written from the first reading would
> have been confidently wrong.
>
> **A convergence sweep** ran read-only against `brainiac` (Rust · sqlx · Postgres), `vibeman`
> (TS · better-sqlite3) and `personas-cloud` (TS · better-sqlite3). It **corrected two claims in
> this document's brief** and found the leaf's headline defect **live in a sibling** (§6).
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "Add a status / category / date-range filter to this list" — *on the server side*
- "Build the WHERE clause from whichever filters are set"
- "The count above the list doesn't match the rows in it"
- "The last page is empty" / "the pager says 40 and there are 12"
- "Search finds nothing when I type an underscore" / "typing `%` returns everything"
- "This filtered list got slow" / "does this filter have an index?"

If you are about to type `let mut clauses: Vec<String>`, `conditions.join(" AND ")`,
`WHERE 1 = 1` followed by `push_str(" AND …")`, `format!("?{}", params.len() + 1)`,
`if x.is_some() { "?2" } else { "?1" }`, `format!("%{}%", user_input)`, or a second
`SELECT COUNT(*)` beside a list query — you are in this situation.

### Scope decision — the seam with `filtering-and-search`

The sibling leaf [`filtering-and-search`](./filtering-and-search.md) drew this seam yesterday, and
drew it **per filter dimension, not per surface**, because one filter bar routinely sends `search`
to SQL and evaluates `category` in memory (**9 of 116 filter-holding files are mixed**) and the two
are indistinguishable from the prop shape. That seam holds and this document adopts it verbatim:

> **Does this dimension's value cross the IPC boundary?**

**Yes → this path.** Predicate composition, parameter binding, `escape_like`, the supporting index,
and whether the count and the page describe the same set. **No → that path**, which also owns the
completeness precondition (an in-memory filter over a capped array is a *wrong* answer, not a slow
one) and the control that produces the value.

**Not this path either:** *whether the query is bounded at all* is
[paginated-list-query](./paginated-list-query.md) — an unbounded query with a perfect predicate is
still unbounded. *Which index the predicate needs* is [index-design](./index-design.md); this path
owns only the obligation to check that one exists. *Which columns a partial UPDATE writes* is
`partial-update-semantics` — `QueryBuilder::set_opt` composes a SET clause with the same machinery
and is not this leaf.

### Which clauses are physics, which are this house

Measured 2026-08-14 against three siblings; detail and citations in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **Bind every value; never interpolate one** | **physics, unanimous, and all four repos already pass** | Personas **0** caller-controlled values interpolated into SQL across 886 classified placeholders; `brainiac` 0; `vibeman` 0; `personas-cloud` 0. The brief expected a P0 here. There is none — see §7 *Cleared*. |
| **The count and the page must be built from ONE predicate value** | **physics — and every repo in the fleet has both the before and the after** | `brainiac` 3 shared / 2 duplicated, and `archive.rs:252-253` writes the reason on the tin: *"Uses the EXACT same FILTER, so it can never disagree with `list` about what matches."* `vibeman` fixed exactly this bug in `xray/route.ts:28-30` and left the 5-way duplication that caused it. `personas-cloud` has it **live** (`db.ts:1129` vs `:1594`). Personas: **5 of 8 share, 3 re-derive, 1 is wrong today.** |
| **A predicate and its parameters must travel as ONE value** | **physics — this is the mechanism behind the clause above** | Every repo that shares a predicate does so by passing an object that carries both; every repo that re-derives one is passing a `String` and keeping the params somewhere else. `vibeman`'s `IdeaQueryBuilder` stores `WhereClause { sql, params }` pairs (`:16-19`); Personas' `QueryBuilder` carries `conditions` + `params` in one struct. |
| **Sort column and direction are an allow-list, never a caller string** | **physics — and the sibling's is a compile error where ours is a convention** | `brainiac` `order_sql(self) -> &'static str` over a 5-arm match (`archive.rs:76`): returning a runtime string **does not compile**. `vibeman` guards with a runtime regex. Personas has `validated_sort_column(col: Option<&str>) -> &str` (`memories.rs:136`) — elided to the *input* lifetime, so `_ => col.unwrap_or("created_at")` would compile. §"Prefer a type over a gate". |
| **Escape `%` and `_` in user input before it becomes a LIKE pattern** | **physics, and the fleet is split — we are in the middle** | `vibeman` **11 of 11** user-input LIKE sites escaped, each paired with an explicit `ESCAPE '\'` (`repository.utils.ts:247-249`). `brainiac` **0 of 15** — no `escape_like`, no `ESCAPE`, anywhere. `personas-cloud` has no text search at all. Personas **7 of 21**. |
| **A shared query-builder abstraction, adopted** | **ergonomics — and the brief's convergence claim is WRONG for this leaf** | The brief cites `vibeman`'s `buildUpdateQuery` at "35% adoption where this repo's macros reached 2.6%". Re-measured: it is **SET-side only, with no WHERE/filter counterpart at all**, so it is not evidence about dynamic filters; its true adoption is 30% under the most generous denominator and **1 file by direct import**; and its companion `buildUpdateStatement` — which holds the 135-entry table allow-list — has **zero callers**. The real comparable is `IdeaQueryBuilder`: **1 of 60 repository files**. Personas' `QueryBuilder` reaches **14 files**. §6. |
| **A typed filter struct crossing the wire** | **physics** | `brainiac` `MemoryFilter` / `DocFilter` / `FlaggedFilter`, all-`Option`, where `None` means exactly what `($n IS NULL OR …)` means. Personas: **2 commands of 1,660** take a typed `*Filter` struct; **56 take ≥2 loose positional filter params**. |
| **The `where_like_any` / `where_like_escape_any` pair** | **house, and it is a trap** | Nobody else ships two spellings of the same predicate where one silently omits the escape clause. §8 Gap 1. |

## 2 The one way

**Compose the predicate once, into a value that carries its own parameters, and hand that same value
to every query the surface renders.** Write one `fn <entity>_filters(…) -> QueryBuilder` in the
repository module that owns the table, put every dimension in it, and return it — then the page
calls `qb.build_select("SELECT * FROM t")`, the count calls
`format!("SELECT COUNT(*) FROM t {}", qb.where_clause())`, and the facet rollup calls the same
`where_clause()` with the same `params_ref()`. `db/src/repos/core/memories.rs:76-119` is that
function and it is the site to copy. **Never** build a WHERE clause as a bare `String` — a `String`
cannot carry its bindings, so a second query cannot reuse it, and the count is re-typed by hand;
that is how a number above a list comes to describe a different set than the list. Bind every
value (`where_eq`, `where_in`, `where_gte`) and **never interpolate one**; interpolate only
identifiers you resolved through a total `match` returning a `&'static str`. For free text, run the
value through **`repos::utils::escape_like`** and use **`where_like_escape_any`** — never
`where_like_any`, whose only difference is that it omits `ESCAPE '\'`. Add the index the predicate
needs in the same change ([index-design](./index-design.md) §4), and check the plan against the
real database rather than assuming — an identical WHERE clause **does not** imply an identical
plan, and the count and the page routinely get different indexes (§6). If one query must be scoped
differently from the other — status chips that stay truthful outside the current status filter —
express that by *adding* a clause to the shared builder, never by omitting one from a second
hand-written copy, and say so in a comment the way `dev_tools.rs:3735-3736` does. Then stop: no
second WHERE string, no `WHERE 1 = 1`, no hand-counted `?N`, no `LIKE` without `ESCAPE`.

## 3 Mandated primitives

**Exist today — use them:**

- **`src-tauri/db/src/query_builder.rs` `QueryBuilder`** — the shared composer. `where_eq` /
  `where_gte` / `where_lte` / `where_in` / `where_like_escape_any` / `where_raw`, plus
  `order_by(_multiple)`, `limit`, `offset`. **It tracks `?N` for you** (`next_idx()`, `:58`) — that
  is the whole reason it exists, and it is the reason a predicate built with it can be handed to a
  second query. `where_clause()` (`:249`) returns the fragment; `params_ref()` (`:326`) returns the
  bindings that go with it; `build_select(base)` (`:303`) assembles the page. **31 production call
  sites across 14 files.**
- **`…/query_builder.rs:138-153` `where_in`** — and read the empty branch: `vals.is_empty()` emits
  the always-false condition `"0"`, not an invalid `IN ()`. Compare `dev_tools.rs:4956-4958`, which
  makes the *opposite* choice deliberately (an empty status list means "no filter") and documents
  why. Both are defensible; the point is that the primitive has already decided and you should know
  which decision you are getting.
- **`src-tauri/db/src/repos/utils.rs:22` `escape_like`** — `\` then `%` then `_`, in that order.
  Four lines. **This is the only correct one of the four implementations in the tree** (§7).
  Import it: `use crate::repos::utils::escape_like;`.
- **`…/query_builder.rs:108-120` `where_like_escape_any(&[cols], pattern)`** — emits
  `(a LIKE ?1 ESCAPE '\' OR b LIKE ?2 ESCAPE '\')`. **5 production call sites.** Pair it with
  `escape_like`; neither is sufficient alone.
- **`src-tauri/db/src/repos/core/memories.rs:76-119` `build_memory_filters`** — **copy this
  function.** It returns a `QueryBuilder`, and four call sites consume it: the page (`:174`), the
  count (`:602`), the stats rollup (`:674`) and the combined command (`:711`, `:717`). One
  predicate, four queries, no possibility of disagreement.
- **`src-tauri/db/src/repos/dev_tools.rs:3736-3760` `triage_scope_clauses`** — the same discipline
  without the builder, and the doc comment above it (`:3733-3734`) is the doctrine in one sentence:
  *"WHERE fragments for everything EXCEPT status — shared by the page query and all three count
  rollups so a filtered page and its counts can't disagree."* It returns
  `(Vec<String>, Vec<Box<dyn ToSql>>)` — a hand-rolled tuple that carries clause **and** params
  together, which is precisely what makes reuse possible.
- **`src-tauri/src/companion/brain/episodic.rs:59-71` `machine_marker_exclusion_sql`** — a shared
  predicate *fragment*, consumed by `count_conversation_after` (`:228`) and
  `list_conversation_after` (`:270`). Its doc comment (`:216-221`) states why the count must be
  built from the page's predicate: *"the sleep cycle reports 'read N of M episodes in the window',
  and M has to be the TRUE count."*
- **`src-tauri/db/src/repos/core/memories.rs:136-152` `validated_sort_column` / `validated_sort_direction`** —
  the sort allow-list, as a total `match` with a default arm. Copy the shape; see
  *Prefer a type over a gate* for the one-word improvement to its signature.
- **the live `personas.db`** — copy it and run `EXPLAIN QUERY PLAN`. It takes ten seconds and it
  settled four questions in this document that reading could not.

**Do not exist — this path names them:**

- **A `Filters` value that crosses the IPC boundary as one thing.** 2 commands of 1,660 take a
  typed `*Filter` struct; 56 take ≥2 loose positional filter params, and adding a dimension to one
  of those means editing the command, the API wrapper, the repo fn *and* every sibling query that
  is supposed to agree with it. `IncidentFilters` (`src/lib/bindings/IncidentFilters.ts`) is the
  worked example and it lives in one feature.
- **A `FilteredQuery` that owns both its page and its count.** `vibeman`'s `IdeaQueryBuilder` is the
  proven shape: `count()` (`:142-149`) and `execute()` (`:110-114`) both route through
  `buildSelect()` → `buildWhereString()`, so divergence is unrepresentable. Ours is one method
  away. §"Prefer a type over a gate".

## 4 Steps

1. **List the dimensions and confirm each one crosses the boundary.** If a dimension is evaluated
   in memory it belongs to [filtering-and-search](./filtering-and-search.md), and it has a
   completeness precondition this path does not carry.
2. **Write one `fn <entity>_filters(…) -> QueryBuilder`** in the repository module for the table.
   Every dimension goes in it. Take `Option<&str>` per dimension, not a struct of `String` — the
   `Option` *is* the "not filtering by this" case and it should not be spelled twice.
3. **Bind, never interpolate.** `qb.where_eq("category", cat.to_string())`. If you reach for
   `format!` inside a predicate, you want `where_raw(|idx| …)` (`:167`), which hands you the next
   parameter index — the escape hatch that keeps the binding contract.
4. **Interpolate an identifier only through a total `match` that returns a literal.** Sort column,
   sort direction, a `GROUP BY` expression. Never a caller string, never a `String` built at
   runtime. `memories.rs:136-152` is the shape.
5. **Escape free text before it becomes a pattern.**
   `let pattern = format!("%{}%", escape_like(trimmed));` then
   `qb.where_like_escape_any(&["title", "content"], pattern);`. Trim first and skip an empty
   query — and skip it in *every* query that shares the builder, which is automatic if you did
   step 2 and a live bug if you did not (§7 team_memories).
6. **Ask the type-over-gate question here, before you write the second query.** Can the page and
   the count take the *same value* rather than the same arguments? If your count fn's signature
   differs from your page fn's by even one parameter, you have already built the divergence — the
   compiler will never tell you, and no reviewer reads two signatures side by side.
7. **Build the page from the builder and the count from the same builder.**
   ```rust
   let qb = memory_filters(persona_id, category, search, tier);          // one value
   let total: i64 = conn.query_row(
       &format!("SELECT COUNT(*) FROM t {}", qb.where_clause()),
       qb.params_ref().as_slice(), |r| r.get(0))?;                        // count first
   let mut qb = memory_filters(persona_id, category, search, tier);       // then page
   qb.order_by(col, dir); qb.limit(limit); qb.offset(offset);
   ```
   **Order matters and it is load-bearing:** `limit`/`offset` push parameters, so a count issued
   with `params_ref()` *after* they are pushed binds the wrong values.
   `reviews.rs:568-596` gets this right by issuing the count before `push_param`;
   `vibeman`'s `scan.repository.ts:49-62` gets it right by the same accident and would break
   silently if the lines were reordered. Rebuild the filter rather than mutate one builder, or
   `where_clause()`/`params_ref()` before touching pagination.
8. **If one query is deliberately scoped differently, add a clause — never omit one.** Status chips
   that must stay truthful outside the current status filter: build the shared scope *without*
   status (`triage_scope_clauses`), then `clauses.push("status = ?")` on the page only
   (`dev_tools.rs:3826-3828`). The asymmetry is then visible in one place and explained in one
   comment.
9. **Add the index and check the plan.** `EXPLAIN QUERY PLAN` on a copy of the real database.
   `SEARCH … USING INDEX` is the answer you want; `SCAN` on a table that grows is not.
   **Check the count separately** — it is a different query and it gets a different plan (§6).
10. **Stop.** No second WHERE string. No `WHERE 1 = 1`. No hand-counted `?N`. No `LIKE` without
    `ESCAPE`. No `.join(" AND ")` into a SQL literal when `QueryBuilder` is one import away.

## 5 Anti-patterns

- **Building the predicate as a `String` instead of a value that carries its parameters.** This is
  the root cause of everything below it. `team_memories.rs` writes the same four-dimension filter
  **three times** — page (`:50-64`), count (`:327-340`), stats (`:355-369`) — because there is
  nothing to return. `memories.rs` next door writes it **once** because `build_memory_filters`
  returns a `QueryBuilder`. Same feature, same shape, opposite outcome, and the difference is the
  return type.
- **A count whose parameter list differs from its page's.** `get_team_memory_stats(team_id,
  category, search)` cannot receive `run_id`; `list_team_memories(team_id, run_id, category,
  search, …)` can. `useTeamMemories.ts:39-41` calls all three with one filter set, and the third
  call **structurally cannot** carry the run filter. Filter the panel to one run and the header's
  total, average importance, category breakdown and run breakdown all describe the whole team.
- **Re-deriving the same predicate with a different guard.** The team-memory page skips an
  all-whitespace search (`:59` `let trimmed = q.trim(); if !trimmed.is_empty()`); the count does
  not (`:335-337` uses `s` raw). Search for three spaces: the list shows every row, the count says
  zero. Two lines apart in file order, three hundred apart in the file.
- **`WHERE 1 = 1` plus `push_str`.** `manual_reviews.rs:644-663` — the tree's only `WHERE 1 = 1`,
  and it is on the pagination path this repo documents as its reference implementation. It works; it
  also means the predicate is a `String` by the time it exists, so `counts()` (`:680`) re-types
  `WHERE persona_id = ?1` twice more in an `if`/`else`. Three copies of one predicate for one
  surface.
- **Counting `?N` by hand.** `if persona_id.is_some() { "?2" } else { "?1" }` —
  `memory_review_proposal.rs:172`, `persona_jobs.rs:148`, `backlog.rs:158`, `procedural.rs:220`,
  `semantic.rs:353`. Five copies of one arithmetic trick, each correct only while the function has
  exactly two possible bindings. `shared_events.rs:44,:47` does the general version with
  `param_values.len() + 1`. **`QueryBuilder` exists to delete this and its doc comment says so**
  (`query_builder.rs:1-5`: *"Instead of manually managing `Vec<Box<dyn ToSql>>` and
  `format!("?{idx}")`…"*).
- **`where_like_any`.** It is `where_like_escape_any` with the `ESCAPE '\'` removed. It has one
  production caller (`events.rs:1327`) and that caller is a user-facing event search whose pattern
  is also unescaped — so a `_` in the search box is a single-character wildcard and a `%` matches
  everything. There is no situation in which the un-escaped variant is the right one; it is a
  primitive that exists only to be chosen by mistake.
- **A fourth private `escape_like`.** Three byte-identical definitions
  (`repos/utils.rs:22` `pub`, `core/memories.rs:64` private, `communication/reviews.rs:12`
  private) and one **incomplete** re-derivation at `mcp_server/tools.rs:495`, which escapes `%`
  and `_` but not `\`. Measured on the app's own SQLite: a query containing a backslash
  over-matches through that path (`1` where `escape_like` gives `0`). Two of the four files
  already `use crate::repos::utils::escape_like` — the shared one is reachable and was copied
  anyway.
- **Assuming the client and the server agree about what "matches" means.** They do not, and it is
  measured. The app's SQLite is `bundled`, so `LIKE` folds **ASCII only**: `'É' LIKE 'é'` → **0**,
  `'П' LIKE 'п'` → **0**, `upper('é')` → unchanged. The client's `.toLowerCase()` — **511
  occurrences in 250 files**, of which **121 in 56 files** are the
  `.toLowerCase().includes(<variable>)` filter idiom
  ([filtering-and-search](./filtering-and-search.md) §7 C and its §9 control) — is full-Unicode. So
  the *same string* in the *same box* matches a row when the dimension is evaluated in memory and
  does not when it crosses to SQL, in a 14-locale product. Neither half normalizes: **0**
  `String.normalize('NF…')` on the client, and **no `COLLATE NOCASE` on any column a list filter
  searches** (the tree's `COLLATE NOCASE` uses are all exact-name resolution in the Athena approval
  path). NFD `e`+U+0301 does not match NFC `é` in either half.
- **Assuming the count's plan is the page's plan.** It is not. Measured on the live 347 MB database
  with the identical WHERE clause: the memories page takes
  `idx_pm_persona_created (persona_id=?)` because the `ORDER BY` tips the planner to the
  `created_at` composite and then filters `category` row by row; the count takes the strictly more
  selective `idx_pm_persona_category (persona_id=? AND category=?)`. The count is *faster than the
  page it describes*. Adding an index for one of the pair does nothing for the other.
- **Post-filtering in Rust and calling the result a page.** `reviews.rs:505-566` — the coverage
  branch runs `SELECT *` with no `LIMIT`, filters in a `Vec`, then `.skip().take()`. Its `total` is
  honest (it counts the post-filtered set, so count and page agree), which is exactly why it costs
  a full scan. Owned by [paginated-list-query](./paginated-list-query.md); named here because the
  honest count is *why* it is expensive, and the two properties trade against each other.
- **`LIKE` against an encrypted column.** `events.rs:1324-1326` documents it in the one place it
  was noticed: *"`payload` is stored encrypted at rest … a LIKE against it matches ciphertext and
  silently returns zero hits."* A predicate can be perfectly composed, perfectly bound, perfectly
  indexed and still be searching bytes nobody typed.

## 6 Evidence

**Adoption.** `QueryBuilder`: **31 production sites across 14 files** (excluding the builder itself
and every `#[cfg(test)]` module). Hand-composed dynamic WHERE clauses outside it: **15 functions
across 13 files**, hand-enumerated by reading each one, in four distinct idioms —
clause-`Vec` + `join(" AND ")` (8 functions), `push_str(" AND …")` onto a growing SQL string (2, of
which **exactly one** — `manual_reviews.rs:644` — opens with the `WHERE 1 = 1` sentinel), interpolate
a pre-built fragment variable (4), string-accumulate with `param_values.len() + 1` (1).
`escape_like`: **3 definitions, 7 call sites in 4 files**, plus 1 partial re-implementation.
`where_like_escape_any`: **5 sites in 3 files**. `where_like_any`: **1**. `where_like` and
`where_like_escape` (the single-column variants): **0 call sites — dead configuration.**
Typed filter structs on the IPC surface: **2 of 1,660 commands**.

- **`db/src/repos/core/memories.rs:76-119` — copy this one.** One function returns a
  `QueryBuilder`; the page, the count, the stats rollup and the combined command all call it. It is
  the only surface in the tree where a filtered aggregate and its filtered page are *provably*
  built from one predicate, and the mechanism is the return type.
- **`db/src/repos/dev_tools.rs:3733-3760` + `:3814-3876` — copy this one when you need an
  asymmetry.** `triage_scope_clauses` returns everything except status; the page adds
  `status = ?` (`:3827`), the three count rollups do not (`:3765-3789`). The asymmetry is
  deliberate, located in one place, and written down.
- **`src/companion/brain/episodic.rs:59-71,:216-228,:264-276`** — the same discipline in the
  companion brain, where a shared `String` fragment is enough because the predicate takes no
  parameters. The doc comment explains why the count cannot be `rows.len()`.
- **`src/commands/infrastructure/system/storage.rs:110-127`** — one `where_clause` used by the
  `SELECT COUNT(*)` preview and the `DELETE` that follows it. The strongest form of the invariant:
  the number shown to the user and the rows destroyed are the *same* predicate, so a preview cannot
  under-report a destructive action.
- **`db/src/repos/communication/reviews.rs:568-596`** — count and page share `where_with_space`
  inside one function, and the count is issued **before** `push_param(per_page)` /
  `push_param(offset)` mutate the parameter vector. The ordering is the correctness condition and
  nothing marks it.
- `db/src/repos/core/memories.rs:136-152` — `validated_sort_column` / `validated_sort_direction`:
  the only sort allow-list in the tree, and the only place a caller-supplied ORDER BY reaches SQL
  safely.
- `db/src/repos/utils.rs:22-27` — `escape_like`. Backslash first. The order is the whole
  correctness argument and three of the four implementations in the tree get it right.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only, against `brainiac` (Rust · sqlx · Postgres), `vibeman`
(TS · better-sqlite3 · 1,999 files) and `personas-cloud` (TS · better-sqlite3 · 32 files).
**It corrected two claims in this document's brief and found the leaf's headline defect live in a
sibling.**

| Axis | `personas` | `brainiac` | `vibeman` | `personas-cloud` | Verdict |
|---|---|---|---|---|---|
| Caller value interpolated into SQL | **0** | **0** | **0** | **0** | **Physics — and the brief's suspicion is cleared four ways.** |
| Dynamic WHERE style | `QueryBuilder` (14 files) + 15 hand-rolls in 4 idioms | **zero dynamic SQL text** — `($n IS NULL OR col = $n)` sentinels, **57 predicates, 100%** | builder class (1 def / 26 calls) + 10 `join(' AND ')` + 19 `WHERE 1=1` accumulations | 3 conditions-array + 1 `WHERE 1=1` | **Local calibration.** Sentinels win at ≤8 fixed dimensions and one query plan; a builder wins at many or mutually-exclusive ones. `brainiac` took the fork knowingly (`archive.rs:17-18`). |
| Count/page share one predicate | **5 of 8 share** | 3 shared / 2 duplicated | 1 exemplar; **5-way duplication** in `xray.repository.ts` | **live divergence** | **Physics, and it is the defect this leaf exists for.** |
| `escape_like` + `ESCAPE` on user input | **7 of 21** | **0 of 15** | **11 of 11** | n/a (no text search) | **Physics, achievable, and we are between the two poles.** |
| Sort column allow-list | a `match` returning `&str` (elided lifetime) | an **enum** returning `&'static str` — a compile error to get wrong | runtime regex | no user sort | **Physics; `brainiac`'s is the type version of ours.** |
| Typed filter struct | **2 of 1,660 commands** | `MemoryFilter` / `DocFilter` / `FlaggedFilter`, all-`Option` | `XRayEventFilters` (typed, but each consumer re-implements the predicate) | inline anonymous objects, **not shared** between list and stats | **Physics — and the sibling proves a type alone is not enough.** |
| Index serving the filtered columns | hot tables covered; two gallery surfaces scan (113 / 125 rows — correct) | `migrations/0033_list_indexes.sql` exists **solely** for the list queries, header names the modules it serves, `pg_trgm` GIN makes leading-wildcard `ILIKE` indexed | `obs_xray_events`: **zero indexes**, most-filtered table in the repo | **100% of filtered columns indexed** | **Nobody wins; `brainiac` is the one to copy.** |

**Three things the sweep settled that reading could not:**

1. **The count/page divergence is live in a sibling, not hypothetical here.**
   `personas-cloud`'s `/api/executions` list (`db.ts:1129-1143`) filters `project_id`,
   `persona_id`, `status`; its stats (`db.ts:1594-1598`) filters `project_id`, `persona_id` and a
   `created_at >= cutoff` the list does not apply. Filter the list to `status=failed` and the panel
   beside it reports every status; the list shows rows the stats never counted. And `vibeman`
   *already shipped and fixed* this exact bug — `app/api/xray/route.ts:28-30` records it in a
   comment: *"previously these were computed and then discarded: the response always returned the
   unfiltered recent events"* — by threading one filters object through three methods while leaving
   the five hand-rolled predicate implementations that caused it. **Two independent codebases, one
   defect, and neither fixed the structure.**
2. **The brief's `vibeman` convergence claim does not hold for this leaf.**
   `buildUpdateQuery` is SET-side only; it has no WHERE counterpart, so it says nothing about
   dynamic filters. Measured adoption is 30% under the most generous denominator (18 of 60
   repository files, transitively via `createGenericRepository`), **1 file by direct import**, and
   0.9% repo-wide; its companion `buildUpdateStatement`, which carries the 135-entry table
   allow-list, has **zero callers** — the strongest guard in the file protects nothing that runs.
   The real comparable is `IdeaQueryBuilder`, at **1 of 60 repository files**. Personas'
   `QueryBuilder` reaches 14 files and 31 sites, which on this axis puts us **ahead**.
3. **`escape_like` is the axis where Personas is ahead of the strongest sibling.**
   `brainiac` — better signatures, better indexes, better comments, a genuinely novel
   dimension-masking facet construction — has **zero** `escape_like`, **zero** `ESCAPE`, and 15
   `ILIKE` predicates built as `'%' || $1 || '%'`. It is injection-safe and wildcard-unsafe.
   Searching it for `50%` or `foo_bar` silently over-matches, everywhere, with no fix in the tree.
   That is the failure mode that **survives even in a codebase with no dynamic SQL at all**, and it
   is the reason §9 gates this and not something more architectural.

**One clause has no trace anywhere and is flagged as house convention:** the
`where_like_any` / `where_like_escape_any` pair. No sibling ships two spellings of one predicate
distinguished only by whether the escape clause is present. It is not doctrine; it is a footgun we
built ourselves (§8 Gap 1).

### Measured against the running database

Copied read-only from the operator's install (347 MB, `persona_memories` 6,535 rows,
`persona_events` 4,972, `team_memories` 347, `dev_ideas` 236, `persona_design_reviews` 113,
`shared_event_catalog` 125).

| Query (the repo's real composed SQL) | Plan |
|---|---|
| memories **page**: `persona_id` + `category` + LIKE, `ORDER BY created_at DESC LIMIT 50` | `SEARCH … USING INDEX idx_pm_persona_created (persona_id=?)` |
| memories **count**: byte-identical WHERE, no ORDER/LIMIT | `SEARCH … USING INDEX idx_pm_persona_category (persona_id=? AND category=?)` |
| memories page, **no persona selected** (the default Memories view) | **`SCAN persona_memories` + `USE TEMP B-TREE FOR ORDER BY`** |
| team_memories page / count / stats (three predicates for one surface) | three *different* indexes: `idx_tm_team_importance_created`, `idx_tm_team_run`, `idx_tm_team_cat` |
| `dev_ideas` triage page, **scoped to a project** | `SEARCH … USING INDEX idx_dev_ideas_project` + `USE TEMP B-TREE FOR ORDER BY` |
| design-reviews gallery page + count | `SCAN persona_design_reviews` (113 rows — correct, per [index-design](./index-design.md) §4 step 2) |
| `shared_event_catalog` search | `SCAN` + temp B-tree (125 rows — correct) |

**Two of these are new facts, not restatements.**

- **The count and the page get different indexes from the same predicate.** Nothing in either
  document upstream says this, and it changes step 9: checking the page's plan does not check the
  count's.
- **It extends [index-design](./index-design.md) §7 P1 and [paginated-list-query](./paginated-list-query.md) Gap 3.**
  Those measured that `idx_dev_ideas_triage(status, created_at DESC)` serves the triage filter while
  the sort survives as a temp B-tree. Measured here: once the Backlog is **scoped to a project** —
  which is the normal way the surface is used — the planner picks `idx_dev_ideas_project` instead
  and the keyset index is not chosen at all. The index serves the *unscoped* page.

**LIKE semantics, measured on the app's SQLite build** (`better-sqlite3` 12.9.0 / SQLite 3.53.0,
`0` ICU compile options, matching `rusqlite features = ["bundled"]`):

| Probe | Result |
|---|---|
| `'A' LIKE 'a'` | **1** — ASCII folds |
| `'É' LIKE 'é'` · `'П' LIKE 'п'` | **0** · **0** — nothing else does |
| `hex(upper(char(233)))` | `C3A9` — unchanged; `upper()`/`lower()` are ASCII-only too |
| NFD `e`+U+0301 `LIKE` `%é%` (NFC) | **0** — no normalization anywhere |
| `'axc' LIKE '%a_c%'` (user typed `a_c`) | **1** — an unescaped `_` is a wildcard |
| …with `escape_like` + `ESCAPE '\'` | **0** |
| `mcp_server/tools.rs:495`'s partial escaper, on a query containing `\` | **1 (over-matches)** where `escape_like` gives **0** |

**Honest calibration on the folding gap:** in *this operator's* live data the exposure is near zero
— **0 of 6,535** `persona_memories.title` values and **0 of 347** `team_memories.title` values
contain a cased non-ASCII letter (284 of 6,535 `content` values do). The non-ASCII characters that
saturate the corpus are em-dashes and arrows, which have no case. The gap is **latent, not live,
for an English-writing operator** — and it is a shipped defect for the other thirteen locales,
because persona names, memory titles and project names are user-generated. Stating both is the
finding; a document that reported only the first number would be alarmist and one that reported
only the second would be wrong.

## 7 Deviations found

### P0 — a filtered aggregate that cannot receive the filter, rendered beside the list it disagrees with

| Path | Defect |
|---|---|
| **`db/src/repos/resources/team_memories.rs:318-344` (count) · `:346-418` (stats) · `:35-77` (page)** · commands `src/commands/teams/team_memories.rs:11,:83,:105` · caller `src/features/teams/sub_teamMemory/useTeamMemories.ts:39-41` | One filter set, three predicates, hand-written three times. **(a)** `get_team_memory_stats` takes no `run_id` parameter at all, so with a run filter active the panel header's total, average importance, category breakdown and run breakdown describe the **whole team** while the list and the count describe one run — and the hook calls all three with the same filters in one `Promise.all`. **(b)** The page trims the search term and skips it when empty (`:59`); the count does not (`:335`), so an all-whitespace query makes the list show every row while the count reports zero. Neither is reachable from a type; both are one `build_team_memory_filters()` away from impossible. |

### The count/page census — 8 surfaces that pair a filtered aggregate with a filtered page

Every row verified by opening both queries.

| Surface | Predicate source | Verdict |
|---|---|---|
| `persona_memories` | `build_memory_filters()` → `QueryBuilder`, 4 consumers | **shared** ✓ |
| `dev_ideas` triage | `triage_scope_clauses()` → `(Vec<String>, Vec<Box<dyn ToSql>>)`, 4 consumers | **shared, with a documented asymmetry** ✓ |
| `persona_design_reviews` gallery | one `where_with_space` inside one fn (`reviews.rs:494-596`) | **shared (intra-function)** ✓ |
| `companion_node` episodes | `machine_marker_exclusion_sql()`, 2 consumers | **shared** ✓ |
| `persona_executions` prune | one `where_clause` for the COUNT preview and the DELETE (`storage.rs:110-127`) | **shared** ✓ |
| `team_memories` | three hand-written copies | **divergent, wrong today** (P0) |
| `dev_tasks` `tasks_page` | page hand-rolled (`dev_tools.rs:4948-4980`); counts written as **two literal SQL strings in an `if`/`else`** (`:5007-5019`) | **not shared.** Correct today (counts are deliberately project-scoped so status chips stay truthful) — but the page's `statuses` and cursor clauses have no counts counterpart *by construction*, and the file's own `triage_scope_clauses` shows the author knew the better shape 1,200 lines earlier |
| `persona_manual_reviews` | page `WHERE 1 = 1` + `push_str` (`manual_reviews.rs:644`); `counts()` re-types `persona_id = ?1` **twice more** in an `if`/`else` (`:702`,`:711`) | **not shared.** Agree today on the single shared dimension. This is the surface [paginated-list-query](./paginated-list-query.md) names as the client-side reference implementation, and it has the weakest predicate sharing in the leaf |

**5 of 8 share one predicate value; 3 re-derive it; 1 of the 3 is measurably wrong.**

### Hand-composed WHERE clauses — 15 functions, 13 files, 4 idioms

| Idiom | Sites | Where |
|---|---|---|
| clause-`Vec` + `join(" AND "\|" OR ")` spliced into a SQL literal | 8 | `reviews.rs:134` · `memory_review_proposal.rs:153` · `dev_tools.rs:3736` · `dev_tools.rs:4936` · `backlog.rs:137` · `rituals.rs:141` · `persona_jobs.rs:136` · `mcp_server/tools.rs:2206` |
| `push_str(" AND …")` onto a growing SQL string | 2 | `manual_reviews.rs:644` (the tree's **only** `WHERE 1 = 1`) · `operations_views.rs:136-151` (opens on a real predicate instead) |
| interpolate a pre-built fragment variable | 4 | `procedural.rs:206` · `semantic.rs:341` · `episodic.rs:68` · `memory_health.rs:96` |
| string-accumulate with `param_values.len() + 1` | 1 | `shared_events.rs:40-48` |

**Manual `?N` arithmetic appears in 7 of the 15.** Five of them are the identical
`if x.is_some() { "?2" } else { "?1" }` trick (`memory_review_proposal.rs:172`,
`persona_jobs.rs:148`, `backlog.rs:158`, `procedural.rs:220`, `semantic.rs:353`), each correct only
while its function has exactly two possible bindings. `QueryBuilder`'s module doc names this exact
problem as its reason to exist.

### `escape_like` — three copies, one incomplete fourth, and a primitive that omits the escape

| Path | Defect |
|---|---|
| `db/src/repos/core/memories.rs:64-69` · `db/src/repos/communication/reviews.rs:12-17` | Private, byte-identical copies of `repos/utils.rs:22`. Two *other* files in the same tree import the shared one (`settings.rs:6`, `team_memories.rs:5`), so it is reachable and was duplicated anyway. Harmless today; three places to fix when the escaping policy changes. |
| **`src/mcp_server/tools.rs:495`** | `query.replace('%', "\\%").replace('_', "\\_")` — escapes `%` and `_`, **not `\`**. Measured on the app's SQLite: a query containing a backslash over-matches through this path (`1`) where `escape_like` gives `0`. An incomplete fourth implementation, on the MCP tool surface, where the input is model-generated. |
| **`db/src/query_builder.rs:123-135` `where_like_any`** | `where_like_escape_any` minus `ESCAPE '\'`. One production caller, and that caller's pattern is unescaped too (`events.rs:1323,:1327`), so `search_events` treats a user's `_` as a wildcard and a `%` as "everything". A primitive whose only distinguishing feature is the absence of a safety clause. |
| `db/src/query_builder.rs:89-103` `where_like` / `where_like_escape` | **0 call sites.** Dead configuration, and one of the two is the unsafe spelling — a developer discovering the module finds four LIKE helpers, two of them dead and one of them wrong. |

### Unescaped LIKE patterns — 12 sites, 10 files (the §9 baseline)

Of the 12, **7 interpolate a caller- or model-supplied free-text value** and are true positives
under the narrow reading: `companion/dispatcher.rs:2825,:2885,:3037` (Athena's memory/task search),
`events.rs:1323` (`EventFilterInput.search`, crosses IPC), `shared_events.rs:52`
(`shared_events_browse_catalog(category, search)`, crosses IPC),
`companion/jobs/operations_views.rs:149` (`arg_str(args, "persona")`, a model-supplied name),
`commands/companion/approvals/approval_exec_ship.rs:119` (a project slug — *"whatever the model
wrote"*, `:117` — and a `_` in it resolves a **different project** for a Ship approval).
**4 interpolate an internal UUID** (`personas.rs:2048`, `triggers.rs:520`,
`connector_readiness.rs:882`, and `mcp_server/tools.rs:495`'s partial escaper), and **1
interpolates a compile-time constant** (`auth_detect.rs:659`, from `COOKIE_DOMAIN_MAP`). They are
not excluded: the condition the rule names is *the escaping policy is re-decided at the call site*,
and an id-valued site re-decides it exactly as much as a search-valued one. Both numbers are given
so the next reader can challenge the choice rather than inherit it.

### Identifier interpolation — checked, and clean

Every one of the **886 `{}` placeholders inside the 475 SQL-bearing `format!` literals** was
classified by position. Interpolated identifiers resolve to: `{placeholders}` (a generated `?,?,?`
list — the largest class by far), a `const`, a `&'static str` from a total `match`, a table name
from a fixed sync manifest (`cloud/sync/rows.rs:506`), a column list filtered against the live
schema (`change_journal.rs:426-438`), or a documented caller constant
(`research_lab.rs:236` states it: *"`column` is a hardcoded caller constant, never user input"*).
The one caller-controlled identifier path — the SQL sandbox in `engine/db_query.rs` — allow-lists
through `validate_sql_identifier` (`:1134-1146`) to `[A-Za-z0-9_.]`.

### Cleared — do not "fix" these, and say so out loud

- **There is no SQL injection in this repo.** The brief asked for a P0 and required any interpolated
  caller value to be labelled one. **The count is zero**, across all 886 classified placeholders,
  and the four `format!`-built statements that *look* like value interpolation are `pragma_table_info('{}')`
  (a table name), a test-fixture SQL script (`data_portability.rs:10201`), an RFC3339 timestamp
  minted by `Utc::now()` (`memories.rs:924`), and a `const` (`dev_workspaces.rs:2093`). All three
  siblings are also at zero. **The array-of-conditions-plus-array-of-params shape is the attractor**,
  and every repo in the fleet independently landed on it. A cleared claim is worth as much as a
  confirmed one and this one cost most of the sweep.
- **`dev_tasks`' project-scoped counts and `dev_ideas`' status-free rollups are correct, not
  divergent.** A status chip that only counts the current status is useless. The defect is not the
  asymmetry; it is expressing the asymmetry as a *second hand-written query* rather than as a clause
  added to a shared one.
- **The gallery and catalog full scans are correct.** 113 and 125 rows; per
  [index-design](./index-design.md) §4 step 2, an index there is a cost with no benefit.
- **`personas.db`'s hot filtered tables are indexed.** `persona_memories`, `persona_events`,
  `team_memories`, `dev_ideas` all get `SEARCH … USING INDEX` on their real predicates. The one
  plan worth watching is the **all-agents** memories view, which is a `SCAN` + temp B-tree on 6,535
  rows because no dimension leads.

## 8 Gaps in the primitive

1. **`where_like_any` exists.** `QueryBuilder` ships two spellings of one predicate whose only
   difference is that one omits `ESCAPE '\'`. Nothing marks the safe one as safe; the names sort
   adjacently and the unsafe one is shorter. **This is the [contract](../golden-path-contract.md)'s
   fifth failure mode with a twist** — the destination is not merely mis-defaulted, the destination
   *contains* the wrong answer. A gate routing callers to `QueryBuilder`'s LIKE helpers would be
   satisfied by the broken one. **Delete it and its single caller** before ratcheting anything.
2. **Nothing couples the pattern to the escape.** `where_like_escape_any` takes a `String` that the
   caller was supposed to have escaped, and a caller who forgets gets an `ESCAPE '\'` clause with
   nothing to escape — a query that looks careful and behaves as if it were not. An
   `EscapedLikePattern(String)` newtype minted only by `escape_like` makes the pairing
   unrepresentable; today it is a convention held by four call sites in three files.
3. **`escape_like` lives in `repos::utils` and the escaping policy has four owners.** Three copies
   plus one incomplete inline version, and the one on the MCP surface — the one taking
   model-generated input — is the incomplete one. There is no `personas_db::like` module, so the
   cheapest thing to write when you need it in a new file is a fifth copy.
4. **`QueryBuilder` cannot express `IS NULL`, `!=`, `>` or a bare `IN` subquery.** Callers reach for
   `where_raw` (11 sites) or leave the builder entirely. `memories.rs:92,:106` uses `where_raw` for
   `tier != ?` and a `NOT (… AND …)`; `triggers.rs:1541` uses it for a `json_extract`. Each escape
   is safe, and each is one more predicate whose text lives at the call site.
5. **`build_clauses()` cannot serve a keyset page.** The composite cursor predicate
   `(created_at < ? OR (created_at = ? AND id < ?))` needs `where_raw`, and `limit`/`offset` push
   parameters at build time so `LIMIT limit + 1` cannot be expressed at all. **That is why all four
   keyset pages in the tree are hand-rolled** (`dev_tools.rs` ×2, `manual_reviews.rs`,
   `reviews.rs`), and hand-rolling the page is what put their counts out of reach of a shared
   builder. [paginated-list-query](./paginated-list-query.md) Gap 2 asks for
   `db::keyset::page(…)`; **when it lands it must take a `QueryBuilder`, not a `&str`**, or it will
   reproduce this leaf's defect at four more sites.
6. **A `QueryBuilder` cannot be cloned or reused.** `params: Vec<Box<dyn ToSql>>` is not `Clone`, so
   the count/page pair must call the filter-building function **twice** (`memories.rs:711`,`:717`)
   and rely on it being pure. It is, and nothing enforces it. A `Clone` impl, or a
   `fn where_parts(&self) -> (String, Vec<&dyn ToSql>)`, removes the second call and the
   ordering hazard of step 7 at once.
7. **`validated_sort_column(col: Option<&str>) -> &str` elides to the input lifetime.** Every arm
   returns a literal today, but `_ => col.unwrap_or("created_at")` compiles. `brainiac`'s
   `order_sql(self) -> &'static str` (`archive.rs:76`) does not. One word.
8. **No filter type crosses the wire.** 2 commands of 1,660 take a `*Filter` struct; adding a
   dimension to the other 56 means editing four layers and remembering every sibling query that
   should agree. `IncidentFilters` proves the shape works here; it has one adopter.
9. **Nothing connects a predicate to its index, or to its *count's* index.**
   [index-design](./index-design.md) Gap 3 states the first half; the measurement in §6 adds the
   second — the count is a different query with a different plan, and no artefact anywhere in the
   repo relates the two.
10. **Zero enforcement.** 62 census rules and 21 custom ESLint rules; none touches predicate
    composition, parameter binding, LIKE escaping, or count/page agreement. `.claude/conventions.json`
    says nothing about `QueryBuilder`. `cargo clippy -D warnings` has no opinion about SQL. **Every
    deviation above shipped under a green `npm run check`.**

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this is answered explicitly and **above** §9.
**Yes, four times — and one of the four is the highest-value change in this document.**

1. **Make a filtered query own its count. This is the one.** The P0 and both "not shared" rows in
   §7 have the same shape: a page and an aggregate assembled from the same *arguments* by two
   functions, which the compiler cannot relate. Give `QueryBuilder` a `count_select(&self, table)`
   beside `build_select(&self, base)` and the pair is derived from one value; better, mint a
   `FilteredQuery { qb, table }` whose `page(limit, offset)` and `count()` both route through one
   `where_clause()`. **`vibeman` has already run this experiment** — `IdeaQueryBuilder::count()`
   (`:142-149`) and `::execute()` (`:110-114`) both call `buildSelect()` → `buildWhereString()`, so
   divergence is unrepresentable. It is the only construction in three sibling repos with that
   property, and it is at **1 of 60 repository files** there. We have the builder; we are one method
   short. That converts the P0 from a bug into a shape nobody can write.
2. **`EscapedLikePattern(String)`, minted only by `escape_like`** (Gap 2), with
   `where_like_escape_any` taking it and `where_like_any` **deleted** (Gap 1). Then "a LIKE pattern
   whose wildcards are live" stops being expressible in the builder at all, and §9's rule becomes a
   migration counter that ratchets to zero and is deleted rather than a permanent gate. This is
   `FacetedDecisionTable`'s required-`emptyTitle` precedent applied to a pattern argument.
3. **`fn validated_sort_column(col: Option<&str>) -> &'static str`** (Gap 7). One word; makes
   returning a caller string a compile error, exactly as `brainiac` does. The cheapest fix in this
   document.
4. **When `db::keyset::page(…)` lands, it must take a `QueryBuilder`** (Gap 5), so a keyset page
   cannot be built from a predicate its count cannot see. Four hand-rolled keyset pages exist today
   and three of them are the reason their counts are hand-written.

**Where a type cannot reach, and why.** *Whether the count and the page were given the same
arguments* is not a property of any signature once they are two functions — and making them one is
item 1, which is the point. *Whether an index exists for the predicate* is a fact about DDL in
another crate ([index-design](./index-design.md) settles this: it needs observation, not shape).
And *whether the client's matching policy agrees with SQL's* spans two languages and a serialization
boundary; the honest answer there is that **the server should stop trying to agree** — route free
text to the FTS5 tables that already exist (`executions_fts`, `companion_fts`, `kb_chunks_fts`,
whose `unicode61` tokenizer folds Unicode and strips diacritics) instead of to `LIKE`, and the
disagreement disappears rather than being policed.

## 9 The missing gate

### The semantic conditions, stated first

Two, both stack-free:

> **(A)** A wildcard pattern for a substring match is assembled from an interpolated value without
> routing that value through the one shared escaper, so whether the value's own wildcard characters
> are literal or live is re-decided at each call site.
>
> **(B)** A filtered aggregate and the filtered page it is rendered beside are assembled from two
> independently written predicates, so the number above the list can describe a different set than
> the list.

Per the [portability test](../research/portability-test.md), what follows is **one repo's proxy for
(A)**. An adopting repo inherits the sentence and re-derives its own signal — `brainiac`'s shape is
`'%' || $1 || '%'` concatenated in SQL and would score **zero** against this pattern while being
0-for-15 on the condition; `vibeman`'s is `escapeLikePattern(x)` in TypeScript and is 11-for-11.

### Checked first: is this already gated?

All 62 rules in `scripts/census/rules.json` were read. The four adjacent ones cover different
conditions: **`unverifiable-conflict-clause`** (40/71) counts statement-wide `INSERT OR IGNORE|REPLACE`
— a *write* conflict-resolution condition; **`blind-identity-write`** (35/82) counts a discarded
affected-row count on the *write* path; **`call-site-text-match`** (56/121) counts
`.toLowerCase().includes(` in `src/**` — the **client** half of the same matching-policy problem,
and the sibling this rule composes with rather than duplicates; **`silent-row-skip`** (64/148)
counts discarded rows on the read path. **(A) is ungated.** Nothing anywhere touches (B).

### What is gated, and what is refused

**(A) is countable and is gated below. (B) is refused**, with the checker that can express it
specified instead of a bad regex shipped — see *Two refusals*.

### The rule — `unescaped-like-pattern`

Keys on a `format!` whose literal **begins with `%`** and contains an interpolation, where no
`escape_like` appears in the argument list. The leading-`%` anchor is what separates a LIKE pattern
from percentage formatting (`format!("{}%", rule.threshold)`, `alert_evaluator.rs:140`, and dozens
like it), and it costs two real prefix-patterns (`workspace_harvest.rs:853`,
`engine/dispatch.rs:790`) that the rule therefore misses. **A ratchet does not need recall; it needs
to be unable to rise** — the precedent is `blind-identity-write`, which paid 13 real matches for the
same guarantee.

**Do NOT hand-merge this into `rules.json`** — publish and let the orchestrator merge via
`scripts/census/merge-published-rules.mjs`.

```json
{"rules":[
  {
    "id": "unescaped-like-pattern",
    "goldenPath": "docs/concepts/golden-paths/dynamic-filter-query.md",
    "title": "A LIKE pattern built from an interpolated value without escape_like, so the value's own % and _ stay live wildcards",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bformat!\\s*\\(\\s*\"%[^\"\\n]{0,20}\\{[^\"\\n]{0,20}\"(?:\\s*,(?:(?!escape_like)(?:\\([^()]{0,160}\\)|[^;()])){0,200})?\\)",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a format! whose literal BEGINS with % and contains an interpolation - a SQL LIKE pattern - with no escape_like anywhere in its argument list. PROXY FOR the stack-free condition: a wildcard pattern for a substring match is assembled from an interpolated value without routing that value through the one shared escaper, so whether the value's own wildcard characters are literal or live is re-decided at each call site. Measured 2026-08-14 against the app's OWN SQLite build (rusqlite features=[\"bundled\"], zero ICU; probed with better-sqlite3 12.9.0 / SQLite 3.53.0, which has the same zero ICU compile options): 'axc' LIKE '%a_c%' returns 1, so a user who types a_c matches axc; with escape_like plus ESCAPE '\\' it returns 0. The first probe of this used the sqlite3.exe on PATH, which IS ICU-linked and gave the opposite answer for case folding - measure against the build you ship, not the build you have. The destination is repos/utils.rs:22 escape_like (backslash first, then % then _) paired with QueryBuilder::where_like_escape_any (query_builder.rs:108), which emits ESCAPE '\\'. WARNING before ratcheting: the sibling primitive where_like_any (query_builder.rs:123) is where_like_escape_any with the ESCAPE clause REMOVED, so a caller can reach the shared builder and still be wrong - delete it and its one caller (events.rs:1327) first, or this gate certifies a migration to a broken destination. Baseline 12 matches across 10 of 963 files. Precision by reading all 12: SEVEN interpolate caller- or model-supplied free text (companion/dispatcher.rs:2825,:2885,:3037 Athena's search; events.rs:1323 EventFilterInput.search which crosses IPC; shared_events.rs:52 which also crosses IPC; companion/jobs/operations_views.rs:149 a model-supplied persona name; approvals/approval_exec_ship.rs:119 a project slug where an underscore resolves a DIFFERENT project for a Ship approval), FOUR interpolate an internal UUID, and ONE interpolates a compile-time constant (auth_detect.rs:659 from COOKIE_DOMAIN_MAP). None is excluded: an id-valued site re-decides the escaping policy exactly as much as a search-valued one. mcp_server/tools.rs:495 is a true positive of a fourth kind - it re-derives escape_like inline and escapes % and _ but NOT backslash, so a query containing a backslash over-matches (measured: 1 where escape_like gives 0). CONVERGENCE: vibeman escapes 11 of 11 user-input LIKE sites and pairs every one with an explicit ESCAPE clause (repository.utils.ts:247-249); brainiac escapes 0 of 15 and has no escape_like and no ESCAPE anywhere in the tree; personas-cloud has no text search. The condition is real, achievable, and universally under-solved. PRECONDITION (must be re-derived per repo): this repo builds LIKE patterns with Rust format! and a leading literal %. A repo that concatenates wildcards inside SQL ('%' || $1 || '%', which is what brainiac does) or in a template literal has the SAME condition wearing markup this pattern cannot see and scores zero. LEGAL FIX, in order: (1) route the value through repos::utils::escape_like and use QueryBuilder::where_like_escape_any - core/memories.rs:114-115 is the two-line shape; (2) for a search over a large text corpus, use the FTS5 tables that already exist (executions_fts, companion_fts, kb_chunks_fts) whose unicode61 tokenizer also fixes the Unicode folding gap that LIKE cannot; (3) if the value is provably a constant, hoist it to a const and it stops being an interpolation. Do NOT silence a match by moving the % into the SQL string - that trades this condition for one no static analysis can see."
    },
    "baseline": { "files": 10, "matches": 12 },
    "floor": 900
  }
]}
```

**Validated standalone before publishing**
(`node scripts/census/run-census.mjs --rules <scratch>/dfq-rules-K7vn.json --check`, then
re-extracted from this finished document and re-run):

```
  rule                    files   base  matches   base  walked  floor
  OK   unescaped-like-pattern     10     10       12     12     963    900

  census OK — 1 rule(s), 963 file-visits, 12 surviving violation(s) across 10 file(s).
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) — two
independently derived counts agreeing, which is the only reason to trust either. `floor: 900`
matches every other `src-tauri`-rooted rule deliberately: several rules over one root must not hold
several opinions about what "the Rust tree is intact" means. Runtime **0.69 s** for the full
963-file walk; the pattern has no variable-length lookbehind and every quantifier is bounded.
**No `exclude` entries** — the compliant construction is excluded by the *pattern* (the
`escape_like` negative lookahead), not by a path, so there is no legitimate file-level exception and
a stale exemption cannot accumulate.

### The positive control

Published with a `-positive-control` id suffix and **no `baseline`**, so it asserts liveness rather
than drift. It points the **same anchors** at the **compliant** form.

```json
{"rules":[
  {
    "id": "unescaped-like-pattern-positive-control",
    "goldenPath": "docs/concepts/golden-paths/dynamic-filter-query.md",
    "title": "POSITIVE CONTROL for unescaped-like-pattern — the same anchors pointed at the COMPLIANT form, which must never report zero",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "\\bformat!\\s*\\(\\s*\"%[^\"\\n]{0,20}\\{[^\"\\n]{0,20}\"\\s*,\\s*escape_like\\s*\\(",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "the identical literal anchor as unescaped-like-pattern, requiring escape_like instead of forbidding it - i.e. every CORRECTLY escaped LIKE pattern in the tree. Not a violation and never to be ratcheted. It exists so that a zero from unescaped-like-pattern is provably a broken matcher rather than a finished migration, and so that the gate is demonstrably discriminating on the GUARD rather than on the shape: the two populations are DISJOINT (gate 10 files / 12 matches, control 3 files / 6 matches, intersection 0 files), verified programmatically 2026-08-14. If this control ever reports zero while the gate still reports its population, escape_like has been renamed or the LIKE-pattern idiom has changed, and the gate's baseline is measuring nothing. Its three files are db/src/repos/resources/team_memories.rs (3), db/src/repos/communication/reviews.rs (2) and db/src/repos/core/memories.rs (1); one further match is correctly skipped on a comment-only line (the worked example in query_builder.rs's module doc), which is also the only exercise of the engine's comment-rewind path by either rule."
    },
    "floor": 900
  }
]}
```

**Both populations, and their overlap** (measured 2026-08-14 via `scanRule` from
`scripts/census/lib/engine.mjs` — the same code the real run uses):

| | files | matches | walked | commentMatchesSkipped |
|---|---|---|---|---|
| `unescaped-like-pattern` (gate) | **10** | **12** | 963 | 0 |
| `unescaped-like-pattern-positive-control` | **3** | **6** | 963 | 1 |
| **overlap** | **0** | — | — | — |

**Disjoint, not nested** — and that is a stronger property than the strict-subset relation
`call-site-text-match` reports for its control. The gate and the control share every anchor and
differ only on the guard, so a matcher that ignored the guard would report their union. The
fault table proves it does not.

### ⚠ A tooling defect the orchestrator must fix before merging the control

**`scripts/census/run-census.mjs` cannot print a baseline-free rule.** `report()` at
**`run-census.mjs:188`** dereferences `rule.baseline.files` unconditionally:

```js
`  ${mark} ${pad(rule.id, 22)} ${lpad(result.files, 6)} ${lpad(rule.baseline.files, 6)} ` +
```

A correctly shaped positive control therefore crashes the runner with
`TypeError: Cannot read properties of undefined (reading 'files')` — **after** the FAIL line is
printed and **before** the exit-code path runs, so **the process exits 0**. That is precisely the
"gate that manufactures confidence" the [contract](../golden-path-contract.md) names.

This brief stated the baseline-free shape "is now supported end to end (merger, validator and
asserter were each fixed in turn this week)". **It is not.** `report()` is a fourth layer, and it
was never taught. `assertRule` carries a comment (`engine.mjs:290-299`) drawing exactly the right
lesson from the third instance — *"a convention introduced at the authoring layer has to be pushed
through every layer that consumes the artifact, and 'I fixed the validator' is not the same as 'the
shape now works'"* — and then the fix stopped one file short of the layer that renders the artifact.
The fix is one guard: `rule.baseline ? lpad(rule.baseline.files, 6) : lpad('—', 6)` and the same for
`matches`. Both rules above were consequently validated through `scanRule`/`validateRule` directly
(`validateRule` returns **no errors** for either), and the gate was fault-injected alone.

### Fail-loud, verified by deliberate break

Each row is a single-field mutation of the validated gate, run with `--check` against the real tree.

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` over a 963-file root) | **1** |
| silent drop (baseline claims 40 where 12 exist) | **1** |
| count rises (baseline claims 3 where 12 exist) | **1** |
| file count rises (baseline claims 2 files where 10 exist) | **1** |
| renamed root (`src-tauri` → `src-tauri-x`) | **1** |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |
| **GUARD REMOVED — the `(?!escape_like)` lookahead deleted** | **1** — `files rose 10 -> 13 (+3)`, `matches rose 12 -> 17` |

**The last row is the one that matters.** Deleting the single guard makes the rule match the
positive control's population too, and the file count rises by **exactly the control's three
files**. The matcher is discriminating on the escaping guard, not on "anything shaped like a
`format!`" — which is the property a fault table can demonstrate and a match count cannot.

### Two refusals

1. **Condition (B) — "the count and the page were built from different predicates" — is refused,
   and specifying the refusal is the finding.** It is *relational between two functions*: the page
   is `list_page(…)` in one module and the aggregate is `counts(…)` two hundred lines below, or in
   a different file, or (for `team_memories`) in a different command whose signature is one
   parameter shorter. A census rule counts occurrences inside one file and cannot express "these
   two predicates should be the same value". Every single-file proxy was tried and rejected: keying
   on `SELECT COUNT(` matches **492** literals of which 383 have a WHERE and the overwhelming
   majority are correct; keying on "a file containing both a `COUNT(` literal and a `LIMIT` literal"
   matches the five *exemplars* as readily as the three defects — **a gate that fires on correct
   content is worse than no gate**, and the shape here is precisely that.

   **The checker that can express it is a Rust test that observes behaviour**, per the
   [model-effort guide](../../development/model-effort-guide.md)'s warning that *a gate that asserts
   data is not a gate on behaviour*: on a fresh `init_test_db()`, seed rows across two runs and two
   categories, then for each filtered surface assert `count(filters) == page(filters, huge_limit).len()`
   for a matrix of filter combinations including the empty string and an all-whitespace string.
   `team_memories` fails that test today on two of the cells, and the assertion is four lines. It
   must run under `cargo test --workspace` — `npm run test:rust` passes `--lib` against the root
   manifest, so a test in `personas-db` would be written, merged and never executed locally; use
   `cargo test -p personas-db` or `npm run test:rust:crates`, and `ci.yml:275` is the `--workspace`
   form that makes the lane live in CI. **The census engine cannot express "must be zero"; this
   condition must never happen, so it needs a test.** Marked honestly: three sibling repos test
   their data layer and **none of the four tests this invariant**, so the instrument is unproven
   everywhere — which is a reason for caution, not confidence.

2. **"A WHERE clause was hand-composed instead of built with `QueryBuilder`" is refused as a
   ratchet, on grounds the measurement supports.** It is countable (15 functions, 13 files, and the
   `.join(" AND ")`-into-a-SQL-literal idiom alone is 11 sites at high precision), and the fix is a
   real migration. But **the population includes the two best functions in this document**:
   `triage_scope_clauses` (`dev_tools.rs:3736`) and `machine_marker_exclusion_sql`
   (`episodic.rs:68`) hand-compose their predicates *and* are the exemplars §3 tells you to copy,
   because what makes them correct is that clause and params travel together — not which type
   carries them. A ratchet on the idiom would report the doctrine as the violation. Per the
   contract's fifth failure mode, the right move is upstream: close Gap 5 so `QueryBuilder` can
   express a keyset page, close Gap 6 so a builder can be reused without calling the factory twice,
   and then the hand-rolls have somewhere to go. **Counting them before that is counting people for
   not using a tool that cannot do their job.**

**On severity.** The census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made anywhere in this document from warning volume, and none could be: `npm run check`
runs `eslint src/` with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level
rule enforces nothing at either gate at any count. The census rule enforces; a lint rule would not.

**Ratchet policy.** Do **not** ratchet this baseline down before Gap 1 lands. Migrating a call site
to `where_like_any` moves the number and fixes nothing — the destination must be correct before
arriving at it counts. Delete `where_like_any`, delete the two dead single-column LIKE helpers,
introduce `EscapedLikePattern` if you can, *then* ratchet with `npm run census -- --update` behind
each migration commit.

## See also

- [Filtering and search](./filtering-and-search.md) — the other side of the seam in §1. Owns the
  control, the debounce, the page-reset, and the completeness precondition for every dimension that
  does **not** cross the boundary. Its §7 C (121 `toLowerCase().includes()` hand-rolls, 0
  `Intl.Collator`) is the client half of the matching-policy disagreement measured here.
- [Paginated list query](./paginated-list-query.md) — bounds the query this path filters. Its Gap 2
  asks for `db::keyset::page(…)`; **that helper must take a `QueryBuilder`, not a `&str`** (Gap 5),
  or the count/page divergence gets four new sites.
- [Index design](./index-design.md) — which index the predicate needs. §6 here adds two measured
  facts to it: the count and the page get **different** indexes from an identical WHERE, and
  `idx_dev_ideas_triage` is **not** chosen once the triage page is scoped to a project.
- [Repository CRUD surface](./repository-crud-surface.md) — where the filter function lives, and the
  `pool: &DbPool` / `Result<T, AppError>` shape it wears.
- [Transaction boundary](./transaction-boundary.md) — a count and a page issued on two connections
  can straddle a write, so they can disagree even when their predicate is shared. Both
  `memories.rs:710` and `reviews.rs:453` take one `conn` for the whole pair; neither says why, and
  neither takes a transaction.
