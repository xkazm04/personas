# Golden path — Engine caps and ceilings

> Situation node: `backend-runtime/resilience-policies/engine-caps-and-ceilings` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **MEDIUM** ·
> sides: **server** · convergence: **converged** ·
> dimensions: **resilience · cost · performance**
> Composed 2026-08-17 against `master` @ `2a874e692`. **Short form** (Mode 2 tiering:
> `risk: medium`, recurrence < 9) — prose dropped, measurement kept.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri/` (`shared-facts.json#rust.files` = 963;
> re-verified — the census engine's own walk reports 963, and both of this document's scanners agree).
> Every ceiling-shaped `const`, every `.take(` / `.truncate(` / `.chunks(` / `.min(` application, and
> every `LIMIT` clause inside a Rust string literal, enumerated **twice** — once through
> `scripts/census/lib/instruments/` (`stripCfgTest`, `stripComments`, `extractRustStrings`) and once
> through a bespoke scanner with its own brace-matched `#[cfg(test)]` stripper, its own
> scheme-safe comment blanker and a different pattern family. Read in full: `core/src/limits.rs`,
> `src/engine/background.rs` (backfill + schedule ceilings), `engine/src/p2p/messaging.rs`,
> `src/engine/api_proxy.rs`, `engine/src/tier.rs`, `db/src/vector_store.rs`,
> `src/commands/obsidian_brain/vault_fs.rs`, plus every site named in §7.
>
> **`cargo` was not run.** Every Rust claim is static and traces to a file read during composition.
> **No row counts.** The 2026-08-17 purge (20,342 rows across 25 tables) makes historical row
> evidence unreproducible; nothing here needs it — this leaf is about constants, not data.
>
> **Settles:** where the number lives, what it must be written next to, what happens at the boundary,
> and whether anyone can tell it happened.

---

## 0. The headline

**This repo built the one thing that makes a ceiling auditable — a helper that logs what it clipped
and why — and called it once in 963 files. There are 577 ceiling-shaped constants across 235 files,
58 % of them with no written reason; the tree's collection ceilings are split almost exactly evenly
between a named constant (51 sites) and a bare integer at the call site (53 sites); and at the
boundary this binary does six different things, none of which the site declares.**

### 0.1 — the designated module holds 3 of 577

`core/src/limits.rs` is a real, deliberate, well-written ceilings module. Its header explains **why
it is in `personas-core` and not `engine`** (`validation` clamps user timeouts against it and sits
below the engine in the crate graph; one reference dragged 157 k LOC upward). It contains six
constants and one helper, and every constant carries a rationale that names what the number must be
larger or smaller than:

- `VECTOR_INSERT_BATCH = 500` — *"keeps per-batch memory under ~2 MB for a 1024-dim f32 embedding
  (~4 KB per row), well below the threshold where the SQLite write lock would meaningfully block
  other readers"*
- `BACKFILL_HARD_CAP = 100` (`:59`) — *"an every-minute trigger that missed 12 hours would otherwise
  emit 720 events at the next tick and drown the queue"*
- `SCHEDULE_EXECUTIONS_PER_PERSONA_HOUR_DEFAULT = 60` — *"one per minute is the highest cadence the
  5-field cron parser supports, so 60 preserves that intent"*

That is the standard. Measured against it, **577 numeric ceiling-shaped constants** (`*_CAP`,
`*_MAX`, `*_LIMIT`, `*_CEILING`, `*_BUDGET`, `*_QUOTA`, `*_THRESHOLD`) live in **235 files**, and
`limits.rs` holds **3** of them. Centralisation is not the goal — a cap belongs next to what it
bounds — but the *habit* is: of the 577, **389 (67.4 %) carry a `///` line and only 240 (41.6 %)
carry a rationale of two lines or more.** 58 % of this engine's ceilings do not say why they are
the number they are.

### 0.2 — six boundary behaviours, none declared

The brief asked for the classification and it is the useful half of this leaf. Every ceiling in this
binary does one of six things when it bites, and **the site never says which**:

| at the boundary | mechanism | example | observable? |
|---|---|---|---|
| **refuse** | return an error | `MAX_AGENT_PAYLOAD_BYTES` → `AppError::Validation` (`p2p/messaging.rs:174`) | yes — the caller is told |
| **clip, and say so** | `cap_with_log(label, requested, cap)` (`core/src/limits.rs:75`) | `background.rs:2607`, backfill | yes — `tracing::debug!` with label, requested, cap |
| **drop oldest** | ring buffer `pop_front` | `MAX_MESSAGES_PER_PERSONA = 100` (`p2p/messaging.rs:187-196`) | a `tracing::debug!` + a counter |
| **drop newest** | `.take(N)` on an iterator | 53 sites, §0.3 | **no** |
| **evict least-recently-used** | LRU sweep before insert | `MAX_BUCKET_ENTRIES = 1024` (`api_proxy.rs:286-296`) | **no** |
| **proceed forever** | a `MAX` sentinel meaning *unlimited* | `TierConfig::enterprise` = `usize::MAX` (`tier.rs:41-43`); `budget.rs:35` returns `u32::MAX` | n/a — nothing is bounded |

The compliant end of that table is `cap_with_log`. **It has exactly one call site in 963 files**
(`src/engine/background.rs:2607`), against ~440 sites that apply a ceiling by other means. The repo
built the right primitive, wrote it into the ceilings module beside the constants, unit-tested it,
and then never reached for it again.

### 0.3 — named vs anonymous: the tree is split down the middle

`.take(N)` is the dominant ceiling application in this codebase. Splitting its 337 sites by argument
and by receiver — because a `.chars().take(8)` is a *display* truncation and belongs to
[`id-generation`](./id-generation.md), not here:

| | applied to a character/byte stream | applied to a **collection** |
|---|---:|---:|
| **integer literal** — anonymous | 134 | **65** |
| **named constant** — compliant | 38 | **61** |
| a variable | 19 | 20 |

**65 anonymous against 61 named.** Not a codebase that has a convention and drifts from it — a
codebase that has never had one. The census rule in §9 keys on the sharpest, highest-precision slice
of that population (an explicit `iter()`-family receiver): **53 violating matches in 34 files against
51 compliant matches in 32 files**, a near-exact partition of the same anchor.

**The good news, measured and worth stating.** Where the ceiling is a SQL `LIMIT`, this repo is
close to perfect: of **323** `LIMIT` clauses inside `SELECT … FROM` string literals, **223 of the 228
multi-row ones carry an `ORDER BY` in the same statement (97.8 %)**. Only 5 take N rows in an order
SQLite does not promise (§7.E). Whoever writes SQL here knows that a truncation without an ordering
is a lottery. Whoever writes `.take(5)` on a `Vec` has not made the connection.

---

## Principle (stack-free head)

A ceiling is a **relationship**, not a number. Before you write the value, write down what it must be
smaller than (a queue that will drown, a lock that will block, a context window, a bill) — then write
the number **as that relationship**, in a named constant, with the relationship in its doc comment.
Then answer the second question, which is the one that gets skipped: **when this bites, what is
thrown away, and how does anyone find out?** A cap that silently drops the tail of a collection in an
order nobody specified is not a safety net; it is a source of results that differ between machines.

Three clauses:

1. **Name it, and name what it protects.** `APPLY_MAX_CONCURRENT_PER_REPO = 4` with *"they share one
   checkout"* can be re-tuned by the next person; `= 4` cannot. A literal at the call site cannot
   enter a relationship with any other constant, so no one can ever check the two against each other.
2. **Declare the boundary behaviour at the site.** Refuse, clip, drop-oldest, drop-newest, evict, or
   proceed — six different contracts. Route the clip through one helper that takes a label, so the
   log line says which cap fired and by how much.
3. **Bound the unit *and* the aggregate.** A per-item cap under a fan-out is `N × cap`. Both bounds
   must exist and both must be named; the aggregate is the one that gets forgotten, because the
   per-item one feels like it is already the answer.

---

## 2. The one way (compact)

Declare the ceiling as a `const` with a doc comment naming the resource it protects, put it beside
the code it bounds (or in `core/src/limits.rs` if two crates need it), apply it through
`personas_core::limits::cap_with_log(label, requested, cap)` so the clip is attributable, and pair
every per-unit bound with an aggregate one. Concretely: (a) **never an integer literal inside
`.take(`, `.truncate(`, `.chunks(` or a `LIMIT`** — the number must have a name before it has a
value; (b) **the doc comment states the relationship, not the value** — *"500 keeps per-batch memory
under ~2 MB"* rather than *"batch size"*; (c) **if the ceiling clips rather than refuses, call
`cap_with_log`** — it takes a `&'static str` label precisely so the log line identifies which of the
577 ceilings fired, and it is a two-line function you can reach from any crate that depends on
`personas-core`; (d) **if the ceiling truncates a collection, order it first** — the SQL half of this
tree already does this at 97.8 %, and `.take(N)` on an unsorted `Vec` or on `read_dir()` picks its
survivors by allocation or filesystem order, which differs between machines; (e) **write down which
end you keep** — `.take(N)` keeps the head, `pop_front` at capacity drops the head, and a reader
cannot tell from the call which one they got; (f) **add the aggregate bound in the same commit as the
per-unit one**, the way `BACKFILL_HARD_CAP` (per trigger) and `GLOBAL_BACKFILL_PER_TICK = 50` (`background.rs:1915`, all
triggers, one tick) sit nine lines apart with the reason on the line — *"a thundering herd"*; and
(g) **do not spell "unlimited" as `usize::MAX`** unless you name the sentinel —
`vault_fs.rs:69`'s `pub const UNBOUNDED_DEPTH: u32 = u32::MAX` is the one place in the tree that does
this correctly, and `TierConfig::enterprise` is what it looks like when you do not (§7.F).

## 6. Evidence

**The one site to copy: `src/engine/background.rs:1899-1915` together with `:2607-2618`.** A
re-exported per-unit cap with its rationale, an aggregate cap twelve lines below it whose comment
names the failure mode it prevents (*"a mass restart after long downtime with many backfill-enabled
triggers could still emit (triggers × cap) catch-up events in one tick — a thundering herd"*), and
the only `cap_with_log` call in the repo applying the per-unit half. Both halves named, both
documented, the clip attributable, and the drop semantics stated in prose (*"their best-effort
catch-up extras are just dropped — the same semantics as the per-trigger drop-oldest"*).

| site | exemplary for |
|---|---|
| `core/src/limits.rs:1-87` | The module. Every constant carries the relationship, not just the value; the header explains its own crate placement; `cap_with_log` makes a clip attributable in two lines. |
| `core/src/limits.rs:104-113` | A **canary test** rather than a value assertion: `VECTOR_INSERT_BATCH >= 100` / `<= 5000` with the message *"risks blocking the SQLite write lock"*. Pins the *relationship*, so a future bump is deliberate without freezing the number. |
| `db/src/vector_store.rs:78-103` | How to re-export a shared ceiling without forking it: a crate-local alias with a doc comment pointing at the single source of truth, consumed by `.chunks(Self::VECTOR_INSERT_BATCH)`. |
| `engine/src/p2p/messaging.rs:171-196` | Two ceilings, two different boundary behaviours, three lines apart, **both instrumented**: a new-key cap that refuses (`AppError::RateLimited` + counter) and a per-key ring buffer that drops the oldest (`tracing::debug!` + counter). The only place in the tree that distinguishes them explicitly. |
| `src/engine/api_proxy.rs:235-244, :286-296` | Three independent memory bounds on one map — idle eviction, a sweep throttle so the sweep is not itself unbounded work, and a hard LRU at `MAX_BUCKET_ENTRIES`. |
| `src/commands/obsidian_brain/vault_fs.rs:42, :69` | `pub const UNBOUNDED_DEPTH: u32 = u32::MAX` — the sentinel **named**, with the docstring saying what passing it means. |

## 7. Deviations

### 7.A — The attributable-clip helper has one caller (P2)

`cap_with_log(label, requested, cap)` exists at `core/src/limits.rs:75`, is unit-tested at `:93-102`,
and is called at **`src/engine/background.rs:2607` and nowhere else** in 963 files. Two
implementations agree exactly (a literal grep and the census engine's own walk).

Against it: ~440 ceiling applications by other means — 199 `.take(<literal>)`, 99 `.take(<NAMED>)`,
17 `.truncate(…)`, 8 `.chunks(…)`, and 144–147 SQL `LIMIT <literal>` clauses. **The gap between the
best answer in the repo and its adoption is 1 : ~440.** Nothing about `cap_with_log` is
backend-specific; it lives in `personas-core`, which every other crate already depends on.

**Fix:** it is a mechanical, non-destructive change at each site — `cap_with_log` returns the clipped
value and changes no behaviour except adding a `debug!`. It is *not* applied here because 440 call
sites is a campaign, not an edit, and because a `debug!` per site is a log-volume decision the
operator should make. §9 ratchets the anonymous half so the population stops growing while that is
decided.

### 7.B — 53 collection ceilings are integer literals with no name and no disclosure (P2)

The §9 population. Hand-verified 10 of 53 by opening each — **10/10 true positives**, and the
character of them is worth recording because it is not what "magic number" usually means:

| site | what is silently dropped |
|---|---|
| `src/commands/infrastructure/dev_tools.rs:2192` | `read_dir(&mem_dir).flatten().take(200)` — **200 memory files are scanned and the rest are never read**, and directory iteration order is filesystem-defined, so *which* 200 is undefined and differs between machines |
| `engine/src/prompt/advisory.rs:182` | 10 recent executions into a **prompt**. A truncation of what the model is allowed to know |
| `src/companion/dispatcher.rs:1379` | `console_errors` `.take(20)` into a dispatch payload — the 21st error does not exist downstream |
| `src/engine/digest.rs:518` | top-5 persona trends into a digest body |
| `src/companion/orchestration/operative_memory.rs:493` | 8 touched files as a "preview" with no *"+N more"* |
| `src/commands/infrastructure/dev_tools/portfolio.rs:289,317,318,319` | four `take(5)`/`take(20)` clips assembling a project portfolio summary |

Two of the ten disclose the total anyway (`sleep_cycle.rs:1963` interpolates
`prune_candidates.len()` beside its `take(25)`; `llm_topology.rs:71` states *"up to 50"* in a
comment). Eight do not. **The reader of the output cannot tell truncation happened.** This is the
same disclosure gap [`entity-picker`](./entity-picker.md) measured for pickers — and note its
finding transfers: the same codebase writes *"Showing X of Y"* for tables and does not write it here.

### 7.C — 58 % of this engine's ceilings carry no written reason (P2)

577 numeric ceiling-shaped constants, 235 files. **389 (67.4 %)** have a `///` line immediately
above; only **240 (41.6 %)** have a doc block of two lines or more — the length at which a comment
stops restating the name and starts stating the relationship. Undocumented examples, all real
ceilings on work:

`db/src/memory_recall.rs:106  const CAP = 2000` · `db/src/repos/core/memories.rs:1550
const ACTIVE_CAP = 60` · `db/src/repos/execution/change_journal.rs:190  const DIFF_ENTRY_CAP = 500`
· `db/src/repos/dev_tools.rs:3693  const TRIAGE_MAX_LIMIT = 200` · `db/src/byom.rs:167
const SIMPLE_PROMPT_CHARS_MAX = 2_000` · `db/src/perf.rs:60  const WARN_BUDGET_PER_WINDOW = 5`.

Each of these is tunable in principle and untunable in practice: nobody downstream can tell whether
`ACTIVE_CAP = 60` is a memory bound, a prompt-size bound, or a product decision. **This is the
cheapest deviation in the document to fix and the one most likely to stay unfixed**, because a
missing comment never fails anything.

### 7.D — The boundary behaviour is never declared, and two of the six are unobservable (P2)

Per §0.2. `.take(N)` (drop-newest, 199 literal + 99 named sites) and the `api_proxy` LRU
(`MAX_BUCKET_ENTRIES`, evict-least-recently-used) both produce **no signal at all** when they bite.
The LRU case is the sharper one: `check_rate_limit` evicts another credential's token bucket to make
room (`api_proxy.rs:286-296`), which silently **resets that credential's rate limit** — a security-
adjacent effect with no log line, no counter, and no test.

A proxy measurement of how silent the boundary is, over the ~440 application sites: a log macro
appears within four lines of **2 of 304** anonymous applications and **5 of 136** named ones. Both
implementations agree on both numbers. Treat these as a *proxy for* "the caller could find out",
not a count of defects — a clip logged ten lines away still counts as observable, and this window
cannot see it.

### 7.E — Five multi-row reads take N rows in an order SQLite does not promise (P2)

Of 323 `LIMIT` clauses in `SELECT … FROM` literals: 223 multi-row with `ORDER BY`, **5 without**
(and 95 `LIMIT 1` existence probes, where any row will do and no ordering is needed — correctly
excluded).

| site | statement | what "which rows" means |
|---|---|---|
| `db/src/repos/core/memories.rs:1937` | `SELECT id FROM persona_memories WHERE tier = 'archive' LIMIT ?1` | an arbitrary N archived memories |
| `src/engine/digest.rs:382` | `… FROM persona_credentials WHERE status IN ('expired','error') LIMIT 10` | the digest shows an arbitrary 10 of the broken credentials |
| `src/commands/infrastructure/skill_files.rs:195` | `SELECT root_path FROM dev_projects LIMIT 5` | an arbitrary 5 projects |
| `src/companion/prompt.rs:902` | `SELECT name, root_path FROM dev_projects LIMIT 5` | an arbitrary 5 projects, **into the companion's prompt** |
| `src/engine/dispatch.rs:785` | `SELECT id FROM audit_incidents WHERE status='open' AND id LIKE ?1 LIMIT 2` | legitimate — an ambiguity probe, "is there more than one match" |

So the honest read is **4 real, 1 correct-by-design**. The two `dev_projects LIMIT 5` sites are the
ones that matter: they are the same query written twice in two modules, both feeding a model, both
picking their five by rowid. A user with six projects has one that the companion cannot see, and
which one depends on insertion order.

### 7.F — `usize::MAX` as "unlimited" makes the ceiling do unbounded work forever (P2)

`TierConfig::enterprise` sets `event_source_max`, `webhook_trigger_max` and `max_queue_depth` to
`usize::MAX` (`engine/src/tier.rs:41-43`). For the two rate budgets, `RateLimiter::check`
(`rate_limiter.rs:60`) then never rejects — but it still pushes every admitted timestamp and
`retain`s over the whole 60-second window on **every** call, so the per-call cost grows with the
actual rate and stays there. Nothing leaks (the window bounds it), and nothing is bounded either:
the constant that was supposed to cap the work now guarantees the work is proportional to the load
it was protecting against.

`tier_usage.rs:88` has to special-case the sentinel (`if limit == 0 || limit == usize::MAX`), which
is the tell — a value that every reader must remember to test for is not a limit, it is an enum
member spelled as a number. Compare `vault_fs.rs:69`'s named `UNBOUNDED_DEPTH`. And see
[`admission-control`](./admission-control.md) §7.C for the same axis' *other* sentinel — `0`, which
means five different things in this binary.

### 7.G — What the brief called rare is actually the repo's strongest habit (P1 finding, no fix)

The brief primed **`BACKFILL_HARD_CAP` + `GLOBAL_BACKFILL_PER_TICK`** as the positive-control
exemplar for "two bounds, per-unit and aggregate". It is an excellent exemplar and every claim about
it verified. But the implication that the shape is rare here does not survive measurement:
**42 aggregate-shaped ceilings exist** (`*_PER_TICK`, `*_PER_RUN`, `GLOBAL_*`, `*_PER_SUB_PER_TICK`),
concentrated in exactly the places that fan out — `subscription.rs` alone declares **eight**
(`GOAL_ADVANCE_MAX_PER_TICK`, `ASSIGNMENT_AUTO_RESUME_MAX_PER_TICK`, `REVIEW_TRIAGE_MAX_PER_TICK`,
`BACKLOG_TO_GOAL_MAX_PER_TICK`, `ATHENA_REACTION_MAX_PER_TICK`, `MAX_RESOLUTIONS_PER_TICK`,
`KPI_DERIVATION_MAX_PER_TICK`, `MAX_PROMOTE_PER_TICK`), and the pollers, the director, the
deliberation engine, the alert evaluator and the webhook notifier each have their own.

**The per-tick ceiling is a settled, well-adopted house idiom in this engine.** That is the leaf's
best news and the spine's `convergence: converged` label pointing, for once, at something real — see
§10. It also relocates the deviation: the gap is not that aggregates are missing, it is that they
are anonymous and silent like everything else (`MAX_REPLIES_PER_TICK`, `MAX_ROWS_PER_TICK`,
`MAX_EVENTS_PER_TICK` are named, which is the good half; none routes through `cap_with_log`, which
is §7.A).

## 9. The missing gate

**Published: one census rule and its positive control.**

**The type test first, because it outranks the gate.** Can the signature make the wrong call
impossible? Partly, and the partial answer is instructive. `.take()` is `std::iter::Iterator`'s — it
cannot be withheld, so no type reaches the 199 literal sites (doctrine §1, *"a thing that was never
declared"*: there is no local API here to constrain). What *can* be typed is the other half:
`cap_with_log(label: &'static str, requested: usize, cap: usize)` **already withholds the dangerous
freedom** — you cannot clip through it without naming the cap. It is the Q5 answer, it exists, and
per Q3 (*a type nobody constructs constrains nothing*) it has **one construction site**, which is
exactly why it constrains nothing today. So: the type is right, the type is present, and the missing
piece is adoption. That is precisely the condition a ratchet is for.

**Signal.** A collection is truncated to an integer literal: an `iter()`-family receiver immediately
followed by `.take(<digits>)`. **Proxy for** the stack-free condition *"a bound on how much work or
data flows on is written as an unnamed number, so nothing can relate it to the ceiling it must
respect and nothing reports what was dropped."* Restricting the receiver to an explicit
`iter/into_iter/values/keys/drain/flatten/rev` call is what buys the precision: it excludes
`.chars().take(8)` (a display truncation, [`id-generation`](./id-generation.md)'s leaf) and
`.filter(…).take(n)` chains whose receiver the regex cannot see, at the cost of recall — it finds
**53 of the 65** literal collection ceilings the two scanners agree exist. A gate that fires on
correct content is worse than no gate; a gate that misses 12 of 65 is a ratchet with a known floor.

**Precision, hand-verified: 10/10.** Opened `portfolio.rs:289`, `operative_memory.rs:493`,
`dispatcher.rs:1379`, `digest.rs:518`, `dev_tools.rs:2192`, `advisory.rs:182`,
`subscription.rs:2287`, `sleep_cycle.rs:1963`, `llm_topology.rs:71`, `task_executor.rs:1109`. All
ten are integer-literal ceilings on a collection with no name; eight of the ten also make no
disclosure that truncation occurred (§7.B lists them).

**Positive control: a near-exact partition of the anchor.** The same receivers pointed at the
compliant form — `.take(<NAMED_CONST>)` — return **51 matches in 32 files** against the violating
**53 in 34**. Violating + compliant = 104 of the 108 sites the anchor can reach; the remainder are
variables. A control at that ratio proves the pattern discriminates on *shape* (is the bound named?)
rather than on a token.

**Overlap, measured at the SITE level against the FINAL pattern:** the only existing rule that could
plausibly collide is `truncated-uuid-id` ([`id-generation`](./id-generation.md), 34 matches / 28
files), which matches `.chars().take(N)` chains. Diffed as `file:line` sets: **2 shared files, 0
shared sites.** No merge needed.

**Failure modes this rule inherits from the runner** (`scripts/census/run-census.mjs`): a `floor` of
700 against 963 walked files fails loudly if the walk shrinks; a zero-file match fails structurally;
a silent drop fails under `--check`. **What it cannot do:** it cannot see whether the clip is
disclosed, and it cannot express *"must reach zero"* — this population should shrink toward the
named form, and when it does the baseline ratchets rather than the rule being deleted, because the
compliant form is a value here, not an absence.

```json
{
  "id": "magic-collection-ceiling",
  "goldenPath": "docs/concepts/golden-paths/engine-caps-and-ceilings.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\.\\s*(?:iter|into_iter|iter_mut|values|values_mut|keys|drain|flatten|rev)\\s*\\(\\s*\\)\\s*\\.\\s*take\\s*\\(\\s*\\d+\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A collection is truncated to an integer literal. PROXY FOR the stack-free condition: a bound on how much work or data flows on is written as an unnamed number, so nothing can relate it to the ceiling it must respect and nothing reports what was dropped. The iter()-family receiver is what buys precision — it excludes .chars().take(N) display truncations (id-generation.md's leaf, 0 site overlap with truncated-uuid-id) at the cost of missing .filter(..).take(N) chains: it finds 53 of the 65 literal collection ceilings two independent scanners agree exist. Precision hand-verified 10/10. LEGAL FIX: name the bound as a const with a doc comment stating what it must be smaller than, and apply it through personas_core::limits::cap_with_log(label, requested, cap) so the clip is attributable — that helper exists, is unit-tested, and has ONE caller in 963 files (background.rs:2607). PRECONDITION (re-derive per repo): this repo bounds work with Rust iterator .take(); a repo using slicing, a paginator or a query builder has the same condition wearing markup this pattern cannot see."
  },
  "baseline": { "files": 34, "matches": 53 },
  "floor": 700
}
```

```json
{
  "id": "magic-collection-ceiling-positive-control",
  "goldenPath": "docs/concepts/golden-paths/engine-caps-and-ceilings.md",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "\\.\\s*(?:iter|into_iter|iter_mut|values|values_mut|keys|drain|flatten|rev)\\s*\\(\\s*\\)\\s*\\.\\s*take\\s*\\(\\s*(?:[a-z_][a-z0-9_]*::)*[A-Z][A-Z0-9_]*\\s*\\)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL for magic-collection-ceiling: the same anchors pointed at the COMPLIANT form, where the bound is a named constant (optionally path-qualified). Measured 51 matches in 32 files against the violating rule's 53 in 34 — a near-exact partition of the anchor, which is what proves the pattern discriminates on whether the bound is NAMED rather than on the token .take(. A control returning ~0 would mean the pattern keys on something else."
  },
  "floor": 700
}
```

**A second instrument the census cannot host.** The disclosure half of §7.B — *did the output say it
was truncated?* — is a relationship between a `.take(N)` and a nearby `len()` in the same rendered
string. Not countable by regex, and the honest answer is a review habit rather than a gate: when you
clip a collection into anything a human or a model will read, interpolate the original length beside
it. `sleep_cycle.rs:1963` is the one site in the tree that does.

## 10. Convergence

The spine's `convergence: converged` label is tested here and **holds on one clause and fails on the
other** — which is the split-verdict shape the doctrine says a single enum field cannot carry.

- **Holds:** the per-tick / per-run aggregate ceiling is a settled idiom, 42 declarations deep in
  this repo alone (§7.G), and `vibeman` — this repo's ancestor — carries the same shape in its
  route handlers. This is one author reaching for the same answer repeatedly, so per doctrine §5 it
  is weak evidence for physics and strong evidence for ergonomics. Report it as such.
- **Fails:** the *attributable clip* has no analogue anywhere in the cohort. No sibling has a
  `cap_with_log`; every one of them truncates silently. **Personas is ahead of the fleet here and
  does not use its own advantage** — which is the most useful form the "ahead" finding takes, because
  the thing to adopt is already written and already in the right crate.

## 12. Corrections

### 12.1 — To the brief: the compliant per-unit + aggregate shape is not rare, it is the house style

The brief offered `BACKFILL_HARD_CAP` + `GLOBAL_BACKFILL_PER_TICK` as *"the compliant shape — use it
as your positive-control exemplar if it survives your own reading."* It survives, in every detail:
`BACKFILL_HARD_CAP` is at `core/src/limits.rs:59` (the crate is `core`, not `engine`, exactly as
primed), `GLOBAL_BACKFILL_PER_TICK = 50` is at `background.rs:**1915**` — the brief said `:1913`, which is
inside its doc comment; *"a thundering herd"* is on `:1911`, and `background.rs:1906` re-exports the per-unit cap with a doc comment pointing at the
single source of truth. **But it is one of 42 aggregate-shaped ceilings, not a rarity** (§7.G). The
correction matters because it moves the prescription: "add the aggregate bound" is not the advice
this engine needs — it already does that — "name what the bound protects and make the clip
attributable" is.

### 12.2 — To the brief: "the finding is almost never *there is no cap*"

Correct, and the specific form it took here is worth recording. The brief predicted *"two caps on
the same path disagree, or one is a hard refusal and its neighbour is a silent drop."* The second
half landed exactly — `p2p/messaging.rs:171-196` has a refusal and a silent-ish drop three lines
apart, and `api_proxy.rs:286-296` evicts a *different* credential's bucket with no signal at all. The
first half did **not**: no pair of disagreeing caps on one path was found. What was found instead is
a third shape the brief did not predict — **the ceiling that is correct, named, documented, and
unobservable**, which is 42 of 42 aggregate ceilings and ~438 of ~440 applications.

### 12.3 — Disagreements between the two implementations, and their causes

| count | impl A (instruments) | impl B (bespoke) | cause | settled at |
|---|---:|---:|---|---|
| ceiling-shaped `const` declarations | 578 | 588 | B's `[^=]+?` type class accepted `&str`, sweeping in **11 settings-key and status-token name constants** (`MAX_PARALLEL_EXECUTIONS = "max_parallel_executions"`). A's `[A-Za-z0-9_:<>, ]` accidentally excluded exactly those. A missed one multi-line declaration B caught. | **577 numeric** (B minus the 11 strings), **574 distinct names** |
| `.take(<int literal>)` | 199 | 197 | A's pattern tolerates whitespace/newlines between `.` and `take`; B is line-scoped and cannot see a chain split across lines. | **A (199)** |
| `.min(<literal>)` | 98 | 73 | A's argument class allowed `.`, so it matched **float** clamps (`.min(100.0)`, a percentage clamp) as integer ceilings. | **B (73)** — and the lesson is that `.min()` is not a ceiling instrument; it clamps floats too and neither pass can tell a capacity bound from a percentage clamp, so it is excluded from every headline here |
| SQL `LIMIT <literal>` | 167 → 144 | 147 | A's first draft passed the **raw** source to `extractRustStrings` instead of the `#[cfg(test)]`-stripped source, counting test-module SQL. Fixed mid-composition; the residual 3-site gap is B's line scan seeing `LIMIT` tokens outside string literals. | **144** (A, corrected) |

The `.min()` row is the one to carry forward: it is a measurement where **agreement would have been
worse than disagreement.** Both passes counted something real; only the disagreement revealed that
the two were counting different *kinds* of thing, and the resolution was to drop the instrument
rather than pick a number.

### 12.4 — To `admission-control` §7.C: the sentinel problem has a second half

That path enumerated `0` meaning five things on the capacity axis. **`MAX` is the other sentinel and
it is on the same axis**: `usize::MAX` for "unlimited" in `TierConfig::enterprise`, `u32::MAX` passed
as an argument to mean "no limit" (`db/src/repos/dev_tools.rs:1868`), `i64::MAX` likewise
(`change_journal.rs:332`), `u32::MAX` returned to mean "no budget" (`companion/proactive/budget.rs:35`).
Four sites, one convention, **one of which names it** (`vault_fs.rs:69`). A reader of
`rows_for_execution(&tx, execution_id, i64::MAX)` has to know the callee's contract to know that
number is not a ceiling. No correction to that path's claims — an addition to its axis.
