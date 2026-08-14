# Golden path — ID generation

> Situation node: `data-persistence/data-modeling/id-generation` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 from a ground-truth sweep of `master`.
> Sweep size: **963 `.rs` files** and **4,829 `.ts`/`.tsx` files** (exactly `rust.files` and
> `frontend.tsFiles` in [`shared-facts.json`](../shared-facts.json)) · **398 `CREATE TABLE` statements
> over 307 distinct table names** parsed with a balanced-paren DDL parser and every primary-key clause
> classified · **1,530 Rust struct id fields** typed · **1,058 id fields across 502 of the 1,032
> non-barrel generated binding files** · **456 `Uuid::new_v4()` call sites in 207 files**.
>
> **A large part of this path is measured against RUNNING SOFTWARE.** The operator's live
> `personas.db` (347 MB, 241 tables, 198 of them carrying an `id` column) and `personas_data.db`
> (67 tables — the companion brain) were copied and opened read-only. Every claim about what ids
> *actually look like*, whether a NULL id has ever occurred, whether `(created_at, id)` is really a
> total order, and how full each truncated-id namespace is comes from querying those files —
> **77,763 rows scanned** — not from reading DDL. The central nullability claim was proven by
> *executing the insert*, not by reasoning about the grammar. Per the
> [model-effort guide](../../development/model-effort-guide.md), *a gate that asserts data is not a
> gate on behaviour*, so the behaviour was observed.
>
> Dimensions: **function · resilience · security · code-quality**. **Two-sided:** ids minted in the
> renderer, ids minted in Rust, and what the identifier means once it crosses IPC are all in scope.
> A **convergence sweep** ran against `brainiac` (Rust · sqlx · Postgres), `personas-cloud`
> (TS · better-sqlite3) and `personas-web` (TS · Supabase). **It confirmed the previous composer's
> warning about newtypes, contradicted one clause this document would otherwise have asserted, and
> supplied the warrant for the clause that survived** (§6).
>
> **Sibling boundaries, settled in prose.**
> [**Persisted model struct**](./persisted-model-struct.md) owns the *type* of every field and the
> generated binding — including, explicitly, the ruling that this repo's `String` ids are the
> ecosystem norm and must not be "fixed". This path does not re-litigate that; it **re-tests it**
> against a wider sweep and reports the result in §6. Where that path governs `Option<T>` over a
> `DEFAULT`-less column, this one governs the *one* column that path's census rule cannot see: the
> primary key, which never carries a `DEFAULT` in this tree (**0 of 398 statements**) and is
> therefore invisible to `nullable-default-column`. The two rules are disjoint by measurement.
> [**Index design**](./index-design.md) owns what the database is asked to *find*. This path owns
> whether the key it finds by has **order** — and corrects a natural worry with a measurement: a
> UUIDv4 primary key has no locality, but this schema never range-scans one, so the cost that path
> warns about does not land here (§6).
> [**Schema change**](./schema-change.md) owns where the DDL goes. This path owns two words inside
> it (`NOT NULL`) and what they cost three layers up.
> [**Row to struct mapping**](./row-to-struct-mapping.md) owns what happens when a column cannot be
> read. This path owns why the `id` column, uniquely, must never be one of them.
>
> The **Deviations** section is a fix backlog.

## 1 Trigger

- "I'm adding a table — what should the primary key be?"
- "Should this be a UUID or an autoincrement integer?"
- "Can the frontend generate the id and send it, so the optimistic row keeps its key?"
- "This is a join table — does it need its own `id`?"
- "The full UUID is ugly in the URL / the log / the filename — can I shorten it?"
- "Two tables both call this thing an `id` but they're different things"
- "Can I use the id as the share token?" / "is this id guessable?"
- "I'm paging with a cursor — can I use the id?"

If you are about to type `CREATE TABLE … (id TEXT PRIMARY KEY`, `Uuid::new_v4()`, `crypto.randomUUID()`,
`.chars().take(8)`, `short_id(`, `AUTOINCREMENT`, or `PRIMARY KEY (a, b)` — you are in this situation.

## 2 The one way

**Mint the id in Rust, at the moment of the insert, as a full `Uuid::new_v4().to_string()`, and
declare its column `id TEXT PRIMARY KEY NOT NULL`.** Not in SQL — **no primary key in this tree
carries a `DEFAULT`, 0 of 398 statements**, and adding one would put the identity of a row in a place
no Rust code can see. Not in the renderer — an id minted in the webview is a *view-model key*, and
the moment it becomes a row's identity you have moved the uniqueness guarantee to the least trusted
layer with no validator behind it. **Never truncate it.** A short form for a log line, a filename or
a UI chip is `&id[..8]` **at the point of rendering**; storing the truncation throws away 90 of the
122 random bits and buys nothing, because the column is `TEXT` either way. **Give the row an `id` at
all only if it has an identity of its own** — a row that exists purely because two other rows are
related gets a **composite primary key** of the two foreign keys and no `id` column, which is what
all 28 composite-PK tables here already do without exception. Reach for a **natural key** only when
the identifier is authored rather than generated — a connector's `builtin-airtable`, a setting's
`key`, a `provider` name — and then accept that the value is a public contract you can never
change. Reach for a **deterministic id** (`Uuid::new_v5` over a frozen namespace) only when the same
logical thing must get the same id computed independently in two places, and freeze the namespace in
a comment saying so; `recipe_derivation.rs:28-51` is the one site that does this and the one to
copy. **Reach for an integer rowid in exactly one case: the row's position in a sequence is part of
its meaning** — `change_journal` is the only such table here, and it is correct. Then stop: do not
wrap the id in a newtype (§6 measured this and found no support for it anywhere), do not add a
uniqueness retry loop, and **never let an identifier double as a secret** — a capability token is 32
bytes of CSPRNG stored as a hash, which is a different construction entirely.

### The frontend half, and the contract between them

The renderer legitimately mints three kinds of string, and **only the third is a defect**:

| Kind | Example | Crosses the wire? | Verdict |
|---|---|---|---|
| **View-model key** — a React list key, an optimistic placeholder, a toast id | `notificationCenterStore.ts:131` `pn-${++nextId}-${Date.now()}` | No | **Correct.** 60 mint sites in 39 non-test files; all but one never reach `invoke` |
| **Run-correlation id** — names a streaming job so its events can be routed back | `useDesignAnalysis.ts:148` `clientDesignId` → `analysis.rs:67` | Yes, as a *parameter* | **Correct, and it is the reason the pattern exists.** The id names a run, not a row; the backend uses it for its event channel and its cancel registry (`analysis.rs:77,:266`) |
| **Idempotency key** — de-dupes a double-submit | `api/agents/executions.ts:67`, `executionSlice.ts:421,435` | Yes | **Correct.** The key is compared, never stored as identity |
| **A row's primary key** | `alertSlice.ts:455` `id: crypto.randomUUID()` → `alert_rules.rs:268` `INSERT INTO fired_alerts (id, …)` | Yes, as *identity* | **This is the defect.** §7 |

**The contract:** a command that accepts an id from the renderer must state which of those four it
is, and if it is the fourth, it must not be. Seven Rust sites today accept a caller-chosen id with
`unwrap_or_else(|| Uuid::new_v4()…)` (§7); **none of them validates the value**, and the validator
that would — `personas_core::validation::require_valid_id` — **exists, is complete, and has zero
callers in the entire tree.**

On the wire the id is always an opaque `string`: **1,010 of 1,058 id fields in the generated
bindings are `string` or `string | null` (95.5%)**, 12 are `number`, 6 are `bigint` (all
`GitHubRelease`-shaped upstream integers). The frontend must treat it as opaque — never parse it,
never sort by it, never infer a type from its prefix.

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14. Detail in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **A random 128-bit id is the default primary key** | **physics** | Personas 268/307 tables TEXT PK, 8,034 of 10,053 sampled live ids are v4 UUIDs; `brainiac` 30 `uuid PRIMARY KEY` of 47 PKs; `personas-cloud` 9 TEXT PK of 13, minted with `nanoid()`. Three stacks, three generators, one shape |
| **A join/edge/bucket row gets a composite PK and no `id`** | **physics, and it is unanimous** | Personas **28/28** composite PKs are edge tables (`memory_edges(from_id,to_id,rel)`), membership (`team_member_trust`), or (scope, bucket) state (`sla_daily(persona_id,day)`) — **zero exceptions**. `brainiac` **11/11** the same (`team_members(team_id,user_id)`, `identities(provider,subject)`, `extraction_cache(org_id,cache_key)`). `personas-cloud` 3/3. Nobody gives a link row a surrogate key |
| **An integer sequence is for rows whose ORDER is their meaning** | **physics** | Personas' 3 `AUTOINCREMENT` tables are `recipe_suggestion_events`, `skill_usage_events`, `doc_read_events`, plus `change_journal`'s rowid — all append-only logs. `brainiac`'s 3 are `embedding_versions` (a version *number*), `queue.jobs` (a FIFO), `library_usage_events` (a log). Both repos reached "sequence ⇔ append-only ordinal" independently |
| **Never let an id be a secret** | **physics** | Personas: `ipc_auth.rs:53-57` 32-byte CSPRNG, `external_api_keys.rs:37-44` `pk_<32 hex>` stored as SHA-256, `pairing.rs:97-128` fingerprint + constant-time compare. `brainiac` mints `Uuid::new_v4()` for row ids and separately hashes its API tokens. The two constructions are kept apart in both |
| **Mint server-side, not client-side** | **contradicted — and the sibling is worse than us** | `personas-cloud` accepts a caller-chosen id at **three** HTTP endpoints (`httpApi.ts:556` `body.id \|\| nanoid()`, `:640`, `db.ts:1104` `input.id ?? nanoid()`), over a *network* boundary, with an ownership check on only one of them. This repo does the same thing at 7 sites over local IPC. **The idiom is convergent; that makes it a shared trap, not a licence.** What travels is the mitigation neither repo has: validate the supplied id |
| **`NOT NULL` on the primary key** | **physics — invisibly, which is why we missed it** | Postgres makes `PRIMARY KEY` imply `NOT NULL` by standard, so `brainiac`'s 30 uuid PKs and `personas-web`'s Supabase tables are non-nullable **for free** and the condition cannot occur there. `personas-cloud` is on SQLite and has the identical hole. The clause is universal; only SQLite makes you type it, and this repo types it **0 times in 299** |
| **A full-width id; never a truncation** | **physics by absence, and the exception proves the rule** | **Nobody else truncates a stored key.** `brainiac` 0 sites; `personas-web` 0; `personas-cloud` calls `nanoid()` **17 times, 16 of them at the full 21-char default** — and its one length-limited call is `worker-${nanoid(8)}` (`packages/worker/src/config.ts:48`), **a process instance name, not a row's primary key**, which is exactly the display/storage line this path draws. Personas has 34, on primary keys. The one clause where the sweep found this repo alone |
| **An id newtype (`PersonaId(String)`)** | **unvalidated — NO ORACLE, re-confirmed** | See §6. Do not act on this |
| **A monotonic / sortable id (v7, ULID, snowflake)** | **unvalidated — no oracle** | `Uuid::now_v7`: **0 in Personas, 0 in `brainiac`** (which is on `uuid` 1.x and could). No ULID, no snowflake, no `nanoid` sortable variant anywhere. And the measurement says we do not need one (§6) |
| **Deterministic (v5) ids for seeded content** | **house convention** | 1 site here (`recipe_derivation.rs`), 308 live rows, and no trace of the idea in any sibling. It is *correct* and well-documented; it is not doctrine |

## 3 Mandated primitives

**Exist today — use them:**

- **`uuid::Uuid::new_v4().to_string()`** — the default. 456 call sites / 207 files; 373 of them
  immediately `.to_string()`. `uuid` is pinned at **1.22.0** with `features = ["v4","v5"]` in all
  four crates, and **`fast-rng` is enabled nowhere**, so `new_v4()` draws from `getrandom 0.4.2` —
  a CSPRNG, 122 random bits. That matters for §5's last entry.
- **`db/src/repos/resources/external_api_keys.rs:37-44` + `:73`** — **the site to copy for anything
  with both an identity and a secret.** `generate_token()` fills 16 bytes from
  `rand::thread_rng().fill_bytes`, formats `pk_<32 hex>`, and returns it with a display prefix; the
  row's `id` is a separate `Uuid::new_v4().to_string()`; only `key_hash` is stored, it is
  `skip_serializing`, and `roundtrip` at `:260-292` asserts the plaintext never appears in the
  serialized record. Identity and secret, minted apart, in fourteen lines.
- **`src/commands/recipes/recipe_derivation.rs:28-51` `derive_recipe_id`** — the deterministic-id
  primitive. A frozen namespace UUID with a doc comment that says *"this UUID must NEVER change once
  Phase 1b has run against a real DB"*, `Uuid::new_v5(&NS, "<template_id>:<use_case_id>")`, and a
  note that the Python converter computes the identical value. Use it when two independent producers
  must agree on an id without talking.
- **`personas_core::validation::require_valid_id`** (`core/src/validation/mod.rs:36-64`) — length cap
  at 200, ASCII-alphanumeric + `-_.` whitelist, `..` rejection, with the rationale in the comment
  (*"eliminates entire classes of injection: null bytes, control chars, path traversal, CRLF, SQL"*).
  **It has ZERO callers.** Its sibling `require_non_empty` has 31, in the same three files. This is
  the most striking finding in the sweep: the answer exists, is good, and is dead.
- **`db/src/migrations/incremental.rs:4618` `change_journal.id INTEGER PRIMARY KEY`** — the correct
  integer-rowid table, and the only one. Its reader (`repos/execution/change_journal.rs:215`,
  `:234`) is the only code in the tree that depends on id order (`ORDER BY id DESC` for
  reverse-replay, `WHERE … AND id > ?3` for "every later write"), and the comment at
  `db/src/journal.rs:376-378` states the boundary explicitly: *"Every allowlisted table has a TEXT id
  PRIMARY KEY."*
- **`db/src/migrations/incremental.rs:2871` / `schema.rs:1365` — `id INTEGER PRIMARY KEY CHECK (id = 1)`**
  — the singleton-row idiom, used twice (`notification_dispatch_watermark`, `local_identity`). A
  table that can hold exactly one row does not need a generated id; it needs a constraint saying so.
- **`src/commands/core/data_portability.rs:1502` `ImportResult.id_mapping`** — the import remapper.
  Every id in an incoming bundle is **re-minted** and the old→new pair recorded, so every FK can be
  rewritten (`:6118`, `:6175`, `:6234`, `:6249`). This is the right answer to "an id from another
  install is not an id here", and it is already built.
- **`src/companion/util.rs:11 short_id(len)`** — read its doc comment before using it: *"not for
  anything requiring guaranteed global uniqueness at scale."* The comment is correct. §7 is about
  what happens when a second copy of the function does not carry it.

**Do not exist — this path defines them:**

- **`personas_core::ids::mint()`** — a single function returning `Uuid::new_v4().to_string()`, and
  the only sanctioned way to produce a stored identifier. Trivial, and its whole value is that
  *there is nothing on it to truncate*: 34 sites currently reach for `.chars().take(N)` because the
  thing in hand is a `String` that invites it. See "Prefer a type over a gate".
- **A round-trip test that a minted id survives insert → read → lookup.** Nothing in the tree asserts
  that the value written as `id` is the value a later `WHERE id = ?` finds. (This is the id-shaped
  half of [persisted-model-struct](./persisted-model-struct.md) Gap 9, which asks for the same test
  for every other field.)

## 4 Steps

1. **Decide whether the row has an identity at all.** If it exists only because two other rows are
   related, or because a (scope, time-bucket) needs a slot, it has **no `id`**: write
   `PRIMARY KEY (a, b)` and stop. All 28 composite-PK tables here and all 11 in `brainiac` are this
   shape, with zero counterexamples in either repo. Adding a surrogate `id` to a link table buys a
   second uniqueness question you then have to answer with a `UNIQUE` constraint anyway.
2. **Decide who authors the value.** Three cases, and only three:

   | The identifier is… | Use | Example here |
   |---|---|---|
   | generated, meaningless, one producer | `Uuid::new_v4().to_string()` | 302 sites |
   | **authored by a human or a catalog file** | the natural key, verbatim | `connector_definitions.id = 'builtin-airtable'` (134 rows), `app_settings.key`, `circuit_breaker_state.provider` |
   | **computed identically by two independent producers** | `Uuid::new_v5(&FROZEN_NS, name)` | `recipe_derivation.rs:51` (308 rows) |

   A natural key is a **public contract**: renaming `builtin-airtable` orphans every row that
   references it, and there is no migration that can find them all. Take it only when the name is
   already the thing.
3. **Ask the type-over-gate question here, in the DDL.** Write **`id TEXT PRIMARY KEY NOT NULL`**.
   Two words. In SQLite a bare `TEXT PRIMARY KEY` **accepts NULL, and accepts many NULLs** — proven
   by execution in §5 — while `pub id: String` on the Rust side says it cannot. `NOT NULL` is the
   edit that makes the struct's type a true statement instead of a hopeful one, and it is the
   highest-leverage line in this document. **299 declarations in this tree omit it. Zero include it.**
4. **Mint at the insert, in the repo function, on one line.** `let id = Uuid::new_v4().to_string();`
   immediately above the `INSERT`. Not in the command layer, not in a constructor, not in the
   caller — because an id that travels before it is written is an id someone can substitute.
5. **If the id needs a human-readable prefix, prefix the *full* uuid** — `format!("delib-{}", Uuid::new_v4())`,
   as 20 sites do. The prefix is a debugging aid, not a namespace: it does not make the id unique and
   it must not be parsed to infer a type. **Do not truncate the uuid to make room for the prefix.**
6. **If the id arrives from outside — the renderer, an HTTP body, an import bundle — do all three:**
   (a) call `require_valid_id("field", &value)?` (it exists; it has never been called);
   (b) decide explicitly whether the value is *identity* or *correlation*, and if identity, prefer
   re-minting and returning the mapping the way `data_portability.rs:1502` does;
   (c) if you accept it as identity anyway, say in a comment why substitution is not a hazard here.
7. **Write the query that reads it back before you finish.** If the read is a keyset page, the id
   participates as the **tiebreaker** in `(created_at, id)` — see §6 for why that is fine with a
   non-monotonic uuid and why it is load-bearing. If the read is `ORDER BY id`, stop: you need a
   sequence, and you are in the `change_journal` case, which means an `INTEGER PRIMARY KEY`.
8. **Then stop.** No newtype (§6). No `Uuid::now_v7`. No retry-on-collision loop — a 122-bit id does
   not collide, and if yours might, that is a signal you truncated it. No `INSERT OR REPLACE` on a
   generated id: `ON CONFLICT` on a random primary key can only mean the id was not random.

## 5 Anti-patterns

- **Truncating a UUID and storing the truncation — 34 sites, 32 to 48 bits, and the widths have
  already drifted inside one column.** `companion/brain/util.rs:31` `short_id(n)` takes the first `n`
  hex chars of a v4 UUID; **13 wrapper functions** (`fn short_uuid` ×11, `fn short_random` ×1, a
  third private `fn short_id` ×1) exist only to call it, **8 of them at width 8** (32 bits), and
  those mint the primary keys of the companion brain — `ep_` (episodes), `fact_`, `goal_`, `proc_`,
  `ritual_`, `ref_`, `blog_`. Measured on the live `personas_data.db`: **`ep_` already holds 1,067 rows.** The
  birthday bound puts P(collision) at **1% by 9,291 rows** and 50% by ~77,000 — and companion
  episodes are the one table this product is *designed* to grow without bound. The same database
  proves the drift is not hypothetical: **`appr_` ids exist at both 10 hex (55 rows) and 12 hex
  (65 rows)** in one column, because commit `d96f085ff` standardised the helper to 12 and the old
  rows kept their width. Nothing can tell them apart. The failure mode is honest — a PK violation
  makes the `INSERT` fail loudly, not corrupt — but the write that fails is a memory the companion
  has already formed, at 3am, in the sleep cycle, where nobody is watching.
- **`id TEXT PRIMARY KEY` without `NOT NULL` — 299 declarations, 0 exceptions.** SQLite's
  documented, deliberately-preserved bug: outside `INTEGER PRIMARY KEY` and `WITHOUT ROWID`, a PK
  column is nullable. **Verified by executing it against a copy of the operator's real 347 MB
  database:** three `INSERT … (id) VALUES (NULL)` into a fresh `id TEXT PRIMARY KEY` table all
  succeeded and left three rows with a NULL id; the same insert into
  `id TEXT PRIMARY KEY NOT NULL` was rejected with `NOT NULL constraint failed`. This tree has **no
  `WITHOUT ROWID` and no `STRICT` table**, so nothing else closes it. The reader types `pub id:
  String`, so a NULL id is an `InvalidColumnType` that takes the row — or the whole list — with it.
- **Letting the renderer choose a row's primary key.** `alertSlice.ts:455` builds a `FiredAlert` with
  `id: crypto.randomUUID()`; `create_fired_alert` (`commands/communication/observability/alerts.rs:109-115`)
  takes the whole struct and hands it to `alert_rules.rs:264-273`, which inserts `alert.id` as the
  primary key. **No server-side mint, no validation, no `require_valid_id`.** The command is behind
  `require_auth_sync`, and this is a local-first single-user app, so the *exposure* is small — but
  the shape is the one that is catastrophic the moment any of this reaches a shared surface, and
  `personas-cloud` has already shipped the same shape over HTTP (§6).
- **Two copies of the helper, one of which lost the warning.** `companion/util.rs:11` and
  `companion/brain/util.rs:31` are byte-identical `short_id(n)` implementations. The first carries
  the doc comment *"Used for turn ids, approval ids, scratch-file names… **not for anything requiring
  guaranteed global uniqueness at scale**"*; the second says only *"Random lowercase-hex id"* — and
  it is the one used to mint persisted primary keys. Commit `d96f085ff` (2026-07-17) explicitly
  deduplicated *five* such helpers into the first copy and standardised on 12 chars; the `brain/`
  half of the tree was never in scope, so it kept its own copy, its own default of 8, and none of the
  caveat. **A deduplication that leaves the second copy is worse than none, because the surviving
  documentation now describes a function some callers are not using.**
- **A validator with no callers.** `require_valid_id` (`core/src/validation/mod.rs:36`) is complete
  and correct and has **0** call sites, while the seven `unwrap_or_else(|| Uuid::new_v4()…)` sites
  that accept a caller-chosen id have **0** validation between them. Dead safety code reads, to the
  next author, as evidence the question was already answered.
- **Minting the same entity's id in four places with three shapes.** A use case's id is minted at
  `useAdoption.ts:220` (`uc-${crypto.randomUUID()}`, in the renderer, then persisted into
  `design_context` and referenced by **seven** tables' `use_case_id` columns), at
  `template_adopt.rs:2279` and `build_sessions.rs:1207` (`format!("uc-{}", Uuid::new_v4())`), and at
  `build_simulate.rs:143` as **`format!("uc_{}_{}", idx, &slug[..40])`** — an index-plus-slug that is
  neither random nor stable across a reordering. Meanwhile `dev_use_cases.id`
  (`repos/dev_tools.rs:7406`) is a bare uuid. One concept, four mints, and no function either side
  can call.
- **Reusing a natural key across namespaces.** `builtin-personas-database` is the primary key of a
  row in `persona_credentials` **and** of a row in `connector_definitions` — the only cross-table id
  collision among **70,953 distinct string ids** in the live database. Harmless today; it is exactly
  the ambiguity a generated id cannot have, and the reason a natural key needs a namespace prefix
  chosen on purpose.
- **Using a UUID as a bearer token.** `engine/share_link.rs:112` mints
  `uuid::Uuid::new_v4().to_string()` and serves bundle bytes to anyone who presents it at
  `GET /share/{token}`. The **entropy is adequate** — `uuid` 1.22 with no `fast-rng` draws 122 bits
  from `getrandom` — so this is not a break. It is a **category error**, and the tree holds the line
  everywhere else: `ipc_auth.rs:53-57`, `external_api_keys.rs:41`, and `pairing.rs` all use
  `rand::thread_rng().fill*` for secrets and `Uuid::new_v4()` for identity. The cost of the blur is
  that UUIDs are treated as loggable — and `share_link.rs:376` does log a prefix of this one,
  deliberately truncated to 8 chars, which is the mitigation an author who thought it was an id
  would not have written.
- **Assuming a UUID sorts.** It does not. Eight of the nine `id <> ?` predicates in the tree are
  keyset **tiebreakers** inside `(created_at < ? OR (created_at = ? AND id < ?))`, which is correct
  because they need a *stable total order*, not a monotonic one. The ninth
  (`change_journal.rs:234`) genuinely means "everything after this", and it is the one table with an
  integer rowid. If you find yourself wanting the ninth shape on a uuid table, you want a sequence.

## 6 Evidence

**Adoption.** 307 distinct tables: **268 TEXT primary key** (242 named `id`, 26 named something else),
**28 composite**, **4 `INTEGER PRIMARY KEY`** (2 of them singleton `CHECK (id = 1)`),
**3 `AUTOINCREMENT`**, 4 with none (all DDL-parser or migration-test fixtures). **803 id-shaped column
declarations: 795 `TEXT`, 8 `INTEGER` (99.0%).** 1,530 Rust struct id fields: **1,039 `String` +
406 `Option<String>` = 94.4%**, 10 `i64`. Live shapes across 10,053 sampled rows: **8,034 v4 UUID ·
1,005 integer · 543 prefixed-uuid · 277 natural · 194 v5 UUID.**

- **`db/src/repos/resources/external_api_keys.rs:37-44,73,260-292` — copy this one.** The one site
  that mints an identity and a secret in the same function and keeps them completely separate, with
  a test that asserts the plaintext never leaks into the serialized record.
- **`src/commands/recipes/recipe_derivation.rs:28-51`** — the deterministic-id primitive, with the
  frozen namespace, the never-change warning, and the note that a Python script computes the
  identical value. If you ever need two producers to agree on an id, this is the shape.
- **`db/src/journal.rs:376-378` + `incremental.rs:4618`** — the boundary between the two id regimes
  written down: the journal's own key is the rowid because its *order is its meaning*, and the
  comment states that every table it journals has a TEXT id instead.
- **`src/commands/core/data_portability.rs:1502, :6118, :6175, :6234-6269`** — the import remapper.
  Every incoming id is re-minted, the mapping recorded, and every FK rewritten through it; a fact
  whose sources all fail to remap is **dropped rather than written with a dangling reference**
  (`:1139`). This is the strongest id-handling code in the repo.
- **`core/src/models/tool.rs:17-61` `VirtualToolId`** — read this before §"Prefer a type over a
  gate". It is the tree's only id newtype, and what it enforces is a **format** (`auto_{automation_id}`)
  so that `tool_kind()` and `automation_runner` cannot disagree — not an *identity*. It never
  crosses serde and never touches a column. It is a good newtype for a reason that does not
  generalise to `PersonaId`.
- **`db/src/repos/communication/events.rs:427-447`** — the keyset tiebreaker done right, including
  the `(Some, None)` arm whose comment names the legacy watermark that has no id to break ties with.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only, against `brainiac` (Rust · sqlx · Postgres · 148 `.rs`, 45 `.sql`, a
118-file TS console — the strong oracle), `personas-cloud` (TS · better-sqlite3) and `personas-web`
(TS · Supabase, 1,037 files).

- **The newtype warning is CONFIRMED, and the sweep widened the evidence rather than softening it.**
  [persisted-model-struct](./persisted-model-struct.md) marked "a newtype for an id" *unvalidated —
  no oracle* and told the next composer not to "fix" the `String` ids. Re-tested from the id side:
  `brainiac` declares **0** `struct …Id(` and **0** `type …Id =`. All three TypeScript repos declare
  **0** branded string types (`string & { __brand }` — the idiomatic TS equivalent, searched for
  explicitly). Personas has exactly one, and it is a format wrapper, not an identity wrapper. **Four
  codebases, three languages, two databases, and the count of entity-identity newtypes is one — and
  that one isn't one.** A 1,445-site refactor on this evidence would be the most expensive mistake
  available in this corpus. **Do not do it, and do not let a future composer "discover" it.**
- **…but the sibling did make the id a real type, on a different axis, and that one has warrant.**
  `brainiac` types its id fields **`Uuid`, not `String`: 200 fields against 20** (91%), all the way
  through its request structs (`console.rs:135,462,626,938,1129,1377,1569`) — so a malformed id fails
  at *deserialization*, at the edge, before any handler runs, and `require_valid_id`'s entire job is
  done by the type. **This does not transfer, and the reason is the stack:** Postgres has a native
  `uuid` column type behind it, while SQLite has none, and — decisively — **32% of this repo's live
  ids are not UUIDs at all** (prefixed, natural-key or v5), so a `Uuid` field would be a lie for a
  third of the surface. The transferable half is the *principle* — validate the id's shape at the
  boundary, once — and here that means calling the validator that already exists.
- **`personas-cloud` reinvented the client-supplied-id idiom, over HTTP, and that is a warning not a
  licence.** `httpApi.ts:556` `id: body.id || nanoid()`, `:640` `id: body.id ?? nanoid()`,
  `db.ts:1104` `input.id ?? nanoid()`. The persona endpoint at least checks the existing row's
  project before overwriting (`:549-552`); the tool-definition endpoint at `:640` does not. Two
  independent codebases reached the same convenience from opposite directions, and **neither
  validates the supplied string.** That is the convergence result that changed this document: §4
  step 6 is not "don't do it", it is "do the thing both repos skipped".
- **Nobody else truncates a stored key, and that is the sharpest single finding.** `brainiac`: 0
  truncation sites. `personas-cloud`: `nanoid()` called **17** times, **16 at its 21-character
  default** — and the single call that does pass a length,
  `workerId: … \`worker-${nanoid(8)}\`` (`packages/worker/src/config.ts:48`), names a **process
  instance**, not a row. A sibling with the length argument trivially available used it once, for
  the one thing that is not persisted. `personas-web`: 0. **Personas: 34, on primary keys.** When
  a clause has no trace anywhere else it is usually local calibration; here the polarity is
  inverted — the *absence* elsewhere is the evidence, because three siblings had the same
  convenience available and none took it.
- **The "UUIDv4 primary key has index-locality costs" worry does not land here, and
  [index-design](./index-design.md) is why.** That path measured the whole index set and found the
  hot path clean, `sqlite_stat1`/`stat4` populated, and — decisively — **not one of its 210
  unsupported predicates is a range scan over an `id`**. Confirmed independently from this side:
  `MAX(id)` **0 sites**, `last_insert_rowid` **0 sites**, `ORDER BY id` **1 site** (`change_journal`,
  the integer table). SQLite's b-tree on a random TEXT key costs page splits on insert, but nothing
  in this schema ever asks for a *range* of ids, so the cost is bounded and already paid. **The
  natural worry is real in general and false here, and saying so is the finding.**
- **The `(created_at, id)` tiebreaker is load-bearing, and the measurement says so loudly.** Against
  the live database: `team_assignment_events` holds **8,486 rows across only 3,342 distinct
  `created_at` values — 5,144 timestamp ties (61%)**; `team_channel_messages` 383 ties of 1,491
  (26%). Without the id in the cursor those pages would skip or repeat rows on every scroll. And
  `(created_at, id)` is a **total order in every case tested: 8,486 rows, 8,486 distinct pairs, zero
  collisions.** So the id being *unsorted* costs nothing and the id being *unique and stable* is
  what makes paging correct. That is the whole answer to "does anything depend on ids being
  sortable": one table does, and it uses an integer.
- **The class this path is about has never occurred.** All 198 tables in the live `personas.db` with
  an `id` column were scanned — **77,763 rows — and the count of NULL ids is 0 and of empty-string
  ids is 0.** Across every table, **70,953 distinct string ids with exactly one cross-table
  collision** (a natural key, named in §5). **The repo is clean on the thing it is structurally
  unable to prevent.** §9's rules are a ratchet on a clean surface, not a fix backlog, and the
  document would be dishonest if it implied otherwise.
- **Where the siblings are worse, plainly.** `personas-web` mints 10 ids from `Date.now()`/
  `Math.random()` across 7 files with no generated types anywhere to say which are persisted.
  `personas-cloud`'s `mapRow<T>` ends in `return result as T` fed by 26 `SELECT *` queries, so an id
  column that stops arriving becomes `undefined` on a field typed `string`. Neither has anything
  resembling `data_portability.rs`'s id-remapping import.

## 7 Deviations found

### P0 — a 32-bit primary key on the one table designed to grow forever

| Path | Defect |
|---|---|
| **width 8 (32 bits) — 8 wrappers:** `brain/episodic.rs:524`, `brain/semantic.rs:547`, `brain/goals.rs:317`, `brain/procedural.rs:403`, `brain/rituals.rs:275`, `brain/reflection.rs:211`, `brain/backlog.rs:247`, `engine/persona_jobs.rs:102` — plus direct `take(8)` at `commands/companion/approvals/approval_exec_dev.rs:844` and `brain/daily_goals.rs:126,:135,:226` | **32 bits of identity.** Live: `ep_` 1,067 rows, `fact_` 80, `proc_` 30. P(collision) 1% at **9,291 rows**, 50% at ~77,000. `docs/plans/athena-longevity.md` is a plan to make these tables grow indefinitely. **Fix: `Uuid::new_v4().to_string()`; truncate at display.** |
| **width 10 (40 bits) — 3 wrappers:** `brain/consolidation.rs:1022`, `brain/doctrine.rs:623`, `companion/jobs/mod.rs:537`, `companion/proactive/mod.rs:630` — plus `brain/decisions.rs:63`, `brain/taxonomy.rs:91`, `night_shift/mod.rs:107,:199` | 1% at ~148,661 rows. Not urgent; still an entropy decision nobody wrote down. |
| **width 12 (48 bits) — the post-`d96f085ff` standard:** `companion/util.rs:11` called from `dispatcher.rs:3172`, `session.rs:727`, `turn_ledger.rs:317`, `projects.rs:117`, `backlog_triage.rs:197`, `incident_diagnosis.rs:169`, `night_plan.rs:156`, `brain/cycle_report.rs:114,:217`, `brain/sync_staging.rs:83`, `brain/profile_synthesis.rs:37,:342,:365` | 1% at ~2.4M rows. Fine in practice — and it is still a hand-picked width standing where 122 free bits used to be. |
| live `personas_data.db`, `appr_` namespace | **One primary-key column, two entropy classes.** 55 rows at 10 hex (pre-`d96f085ff`), 65 at 12 hex. No code, no type and no query can distinguish them. |
| `src/companion/util.rs:11` vs `src/companion/brain/util.rs:31` | **Two byte-identical `short_id(n)`.** The first documents "not for anything requiring guaranteed global uniqueness at scale"; the second, which mints persisted PKs, does not. `d96f085ff` deduplicated five copies into the first and never reached `brain/`. |

### P0 — the validator that exists and has never been called

| Path | Defect |
|---|---|
| `core/src/validation/mod.rs:36-64` | `require_valid_id` — length cap, charset whitelist, `..` rejection, with the injection classes it closes named in the comment. **0 callers tree-wide.** `require_non_empty`, six lines above it, has **31**. |
| `commands/design/analysis.rs:67` · `commands/design/template_adopt.rs:2279` · `commands/obsidian_brain/mod.rs:643,:733,:812` · `engine/src/scraper.rs:488` · `browser_bridge/mod.rs:84` | **7 sites accept a caller-chosen id** with `unwrap_or_else(|| Uuid::new_v4()…)`. **None validates it.** `scraper.rs:488` takes it straight out of a `serde_json::Value` payload (`input.get("id")`). |
| `stores/slices/overview/alertSlice.ts:455` → `commands/communication/observability/alerts.rs:109-115` → `repos/communication/alert_rules.rs:264-273` | **A renderer-minted string becomes a primary key**, with no server-side mint and no validation. The command takes the whole `FiredAlert` and inserts `alert.id` verbatim. |
| `features/templates/sub_recipes/libs/useAdoption.ts:220` | `id: \`uc-${cryptoRandomId()}\`` → `mutateUseCases` → persisted in `personas.design_context`, and referenced by `use_case_id` columns on **`persona_executions`, `persona_messages`, `persona_manual_reviews`, `persona_memories`, `persona_triggers`, `persona_event_subscriptions`, `persona_events`** (`incremental.rs:521-656`). Seven foreign keys pointing at a value the webview chose. |

### P1 — the identity column is nullable, everywhere

| Class | Count | Where |
|---|---:|---|
| `id TEXT PRIMARY KEY` **without** `NOT NULL` | **299** statements / 29 files | `incremental.rs` 114 · `schema.rs` 73 · `lib.rs` 30 · `initial.rs` 21 · `fk_hygiene.rs` 12 · 24 more files |
| …**with** `NOT NULL` | **0** | — |
| TEXT PK not named `id`, without `NOT NULL` | 33 | `app_settings.key`, `circuit_breaker_state.provider`, `connector_definitions`… |
| `WITHOUT ROWID` tables (which would close it) | **0** | — |
| `STRICT` tables | **0** | — |
| NULL or empty ids **in the live database** | **0** of 77,763 rows | the class is reachable and has never been reached |

### P2 — one concept, many mints

| Class | Count | Where |
|---|---:|---|
| Sites minting a **use case** id | **4**, in 3 shapes | `useAdoption.ts:220` (TS, `uc-<uuid>`) · `template_adopt.rs:2279` · `build_sessions.rs:1207` (`uc-<uuid>`) · **`build_simulate.rs:143` `uc_{idx}_{slug}`** — not random, not stable under reordering. `dev_use_cases.id` (`dev_tools.rs:7406`) is a bare uuid |
| Tables whose own `id` column holds **more than one shape** in live data | **4** of 198 | `persona_tool_definitions` (163 uuid + 7 `builtin-*`) · `persona_credentials` (21 + 4) · `persona_teams` (7 uuid + 1 `wsteam-`) · `recipe_definitions` (194 v5 + 6 v4) |
| Cross-table id collisions among 70,953 live string ids | **1** | `builtin-personas-database` in both `persona_credentials` and `connector_definitions` |
| Distinct truncated-id prefixes in `personas_data.db` | **15** | at 3 different widths (32/40/48 bits) |
| Distinct id-field **names** on the wire | **247** | `id` 259 · **`personaId` 66 vs `persona_id` 61** — the same id, two spellings, per [persisted-model-struct](./persisted-model-struct.md)'s casing finding, reproduced from the id side |
| Frontend id-mint sites (non-test) | 60 / 39 files | **59 are view-model keys or correlation ids and are correct**; the exceptions are named in P0 |
| Uses of a UUID as a bearer token | **1** | `engine/share_link.rs:112` — entropy adequate, category wrong (§5) |

### Corrections to the brief and to prior findings

- **The brief's "704 `String` ids" does not reproduce at this scope, and the difference is
  informative, not a contradiction.** Counting every `pub …id…:` field declaration in all 963 `.rs`
  files gives **1,530**, of which **1,445 (94.4%)** are `String`/`Option<String>`. The 704 in
  [persisted-model-struct](./persisted-model-struct.md) is the *persisted-read-model* subset, which
  is the right denominator for that path's question. **Cite the number with its scope**; both are
  correct and they answer different questions. The conclusion — *do not newtype them* — survives at
  either scope and is re-confirmed in §6 on wider evidence.
- **The brief's "UUIDv4 primary key on a large table has index-locality costs" is true in general and
  does not apply here.** Checked against what [index-design](./index-design.md) measured plus three
  independent probes from this side: `MAX(id)` 0, `last_insert_rowid` 0, `ORDER BY id` 1 (the integer
  table). **No range scan over any id exists in this schema**, so the locality cost is confined to
  insert-time page splits on tables where `index-design` already found the hot path healthy. No
  action.
- **"Ids minted on the frontend and sent to the backend are a distinct risk class" — true, and much
  smaller than it looks.** 50 `crypto.randomUUID()` sites plus 57 `Date.now()`/`Math.random()` id
  sites; **exactly one file that mints an id also calls `invoke` in a way that carries it**
  (`api/agents/executions.ts:67`, an idempotency key, which is correct). Tracing by hand through the
  store and API layers finds **two** genuinely persisted frontend-minted identities
  (`alertSlice.ts:455`, `useAdoption.ts:220`), plus four that mint ids for objects whose id is
  **discarded before persistence** — `RecipeEditor.tsx:40` mints one per schema field on every parse
  and `serializeSchema` (`:55-64`) drops it, so the churn is invisible and harmless. **Two, not
  fifty. The alarming-looking number was mostly React keys.**
- **The other predictability worry clears too.** `uuid` 1.22.0 with `features = ["v4","v5"]` and
  **`fast-rng` enabled nowhere in the workspace** resolves `new_v4()` to `getrandom 0.4.2` — a
  CSPRNG. No id in this tree is derived from a timestamp, a counter, or a sequence a client can see
  (`format!` with `timestamp_millis`/`as_millis` into an id: **0 sites**). The one integer-sequence
  table, `change_journal`, is never exposed over any network surface. **Nothing here is guessable in
  a way that matters for authorization**, and the authorization boundaries that do exist
  (`ipc_auth`, `mcp_server/auth.rs`, `fleet/pairing.rs`) are all built on hashed 32-byte CSPRNG
  secrets rather than on ids.
- **`persisted-model-struct`'s `nullable-default-column` rule cannot see this leaf's condition, and
  the two rules are disjoint by measurement.** That rule keys on `DEFAULT` without `NOT NULL`. **Zero
  of the 398 `CREATE TABLE` statements in this tree give a primary-key column a `DEFAULT`** — so the
  299 nullable identity columns score zero against it. Checked before proposing §9's second rule,
  precisely so the corpus does not grow two rules over one condition.

## 8 Gaps in the primitive

1. **SQLite will not make a primary key non-null and offers no way to ask it to, short of `STRICT`
   or `WITHOUT ROWID`.** Both are table-level opt-ins with other consequences (`WITHOUT ROWID`
   changes the storage layout and forbids `AUTOINCREMENT`; `STRICT` rejects the type-affinity
   flexibility several columns here rely on). `NOT NULL` is therefore a per-column discipline with no
   structural backstop — the same shape as the `NOT NULL DEFAULT` gap
   [persisted-model-struct](./persisted-model-struct.md) step 2 names, arriving through a different
   door. Postgres does not have this gap at all, which is why `brainiac` never had to think about it.
2. **`rusqlite` has no compile-time link between the Rust field and the column.** `row.get::<_,
   String>("id")` compiles against a nullable column and fails on the first NULL row, at runtime, in
   production. Same category as that path's Gap 3, and the convergence sweep found the one sibling
   with `sqlx::query_as!` available uses it zero times out of 332 queries — so the compile-checked
   escape is unproven even where it exists.
3. **Nothing associates an id's *shape* with the entity it names.** `use_case_id TEXT` appears on
   seven tables and holds values minted in four places in three formats; `String` says nothing, the
   generated binding says `string`, and the only artefact that could say more is a comment. This is
   the honest core of the newtype question — the gap is real; the evidence that newtypes are the
   answer does not exist (§6).
4. **`uuid` offers no "short but still safe" constructor, so truncation looks like the obvious
   answer.** The crate exposes `.simple()` (dashes stripped) and `Display`, and the step from
   `.simple().to_string()` to `.chars().take(8)` is one method call with no friction and no
   diagnostic. `nanoid`'s API at least makes the length an explicit argument with a documented
   collision table; `uuid`'s makes it a `String` operation that reads like formatting.
5. **A composite primary key has no expression on the Rust side.** The 28 composite-PK tables are
   read into structs whose fields are two ordinary `String`s; nothing marks the pair as the identity,
   and `WHERE a = ? AND b = ?` is retyped at every call site. The DDL knows; nothing above it does.
6. **A natural key has no namespace.** `builtin-*` is a convention held by 145 rows across three
   tables and by nothing else; the one cross-table collision in the live database is between two of
   them. SQLite offers no schema-level namespacing, and a prefix chosen by habit is not one.
7. **Nothing tests that a minted id round-trips.** No test in the tree writes a row and asserts that
   `WHERE id = ?` finds it back. The whole minting layer — 456 call sites — is unverified behaviour.
8. **The import remapper is per-call-site, not a primitive.** `data_portability.rs` does id remapping
   correctly across ~40 mint sites and 5 phases, entirely by hand; the same job in
   `template_adopt.rs`, `teams.rs` `clone_team` and `personas.rs` `duplicate_persona` is re-derived
   each time. There is no `IdRemap` type, so "did you remap every FK?" is a code-review question
   forever.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this must be answered explicitly, **and it must be
answered before §9.** For this leaf the answer is **yes twice — and an emphatic no to the type
everyone reaches for first.**

**Yes (1): `NOT NULL` on the primary key is the type fix, and it is two words.** A column declared
`id TEXT PRIMARY KEY NOT NULL` makes `pub id: String` a true statement about the database instead of
a hope, makes a NULL identity **unrepresentable** rather than merely unobserved, and removes the
entire failure mode without any runtime cost. 299 declarations need the edit; the census rule below
is the ratchet that stops the 300th, not the fix. This is the best-warranted clause in the document:
Postgres gives it away free (which is why `brainiac` has 30 non-nullable uuid PKs and no opinion
about it), the SQL standard mandates it, and SQLite's exemption is a documented bug the project has
kept only for compatibility.

**Yes (2): a `personas_core::ids::mint()` returning `String` makes truncation stop being the path of
least resistance.** The 34 truncation sites exist because `Uuid::new_v4()` hands you a value with 122
bits and an inviting `.chars()` method three keystrokes away. A single sanctioned constructor —
plus **deleting both `short_id(n)` helpers** so the shortcut has no name to call — converts the
census rule below from a permanent gate into a migration counter that ratchets to zero and is then
deleted. This is the same shape as `FacetedDecisionTable`'s required `emptyTitle` and
`createLazySection`'s owned fallback: the wrong call loses its spelling.

**No — and this is the important half. An id newtype is NOT the answer, and the evidence against it
is now stronger than when it was first flagged.** [persisted-model-struct](./persisted-model-struct.md)
measured 704 `String` id fields, found **no oracle anywhere** for wrapping them, and marked the
clause *unvalidated* specifically so nobody would act on it. This path re-tested that from the
identifier side across a wider surface and the answer did not move: **`brainiac` declares zero id
newtypes and zero id type aliases; all three TypeScript siblings declare zero branded string types;
and Personas' single `VirtualToolId` enforces a string *format*, never crosses serde, and never
touches a column.** Four codebases, three languages, two databases, one instance — and that instance
is a different construction solving a different problem. At this repo's scope the change would touch
**1,445 field declarations**, every `params![]` in 963 files, and — because ts-rs would emit the
newtype as a bare `string` regardless — would buy the frontend nothing at all. **A path that
prescribed that refactor on taste would be the most expensive mistake this corpus could make, and
the honest output is to say so plainly rather than to find a clever reason it is different here.**

What the newtype *would* have bought — "this string was validated, and it names this entity" — is
available for a hundredth of the cost and is **already built**: `require_valid_id`. It has zero
callers. Wire it into the seven sites that accept a caller-chosen id before anyone proposes a
type-system solution to a problem a dead function already solves.

## 9 The missing gate

### The semantic conditions, stated first

Two, each stack-free:

> **(A)** An identifier is minted with less entropy than its collision domain requires.
> **(B)** A row's identity column can be absent.

Per the [portability test](../research/portability-test.md), what follows are **one repo's proxies**.
An adopting repo inherits the two sentences and re-derives its own signals against its own id
generator and its own DDL dialect. Condition (B) in particular **cannot exist** in a Postgres
sibling — the standard makes `PRIMARY KEY` imply `NOT NULL` — so a repo adopting this path must ask
"which of my primary keys can be absent?" and may correctly answer "none, structurally".

### What is gated, and what is refused

**(A) and (B) are both countable and both gated below.** A third condition — *a row's identity was
chosen by an untrusted producer* — is **refused**, with the measurement, below.

### The two census rules

**(A) `truncated-uuid-id`** keys on both spellings the repo uses: the inline
`.simple().to_string().chars().take(N)` chain and a call to either `short_id(N)` helper. Measured:
**28 files / 34 matches**. **Precision, by reading every one of the 34:** 31 true positives (18 direct
mint sites plus the 13 `fn short_uuid()`/`fn short_random()`/`fn short_id()` wrappers that exist only
to mint), **3 false positives** — two are length assertions in the helper's own unit test
(`companion/brain/util.rs:104,105`) and one names a scratch file rather than a row
(`companion/session.rs:2684`). Cross-checked by a completely different route: enumerating id prefixes
in the live `personas_data.db` finds **15 truncated-id namespaces, every one of them a primary key**.
**Precondition:** this repo mints with the `uuid` crate and shortens with `.chars().take(N)` or a
local `short_id(N)`. A repo using `nanoid(len)`, a base62 encoder, or a database sequence wears the
same condition in markup this pattern cannot see.

**(B) `nullable-text-primary-key`** keys on `id TEXT PRIMARY KEY` with no `NOT NULL` in the same
column clause. Measured: **29 files / 299 matches**, and **an independent balanced-paren DDL parser
over all 398 `CREATE TABLE` statements reaches the same 299 by a different route** (parse the
statement, split its top-level clauses, take the one carrying `PRIMARY KEY`, test it for `NOT
NULL`) — 299/299 true positives, 0 conforming declarations anywhere. **The lookahead is scoped to
the next comma or close-paren, not to end-of-line, and that is load-bearing rather than fussy:**
several fixtures write a whole `CREATE TABLE` on one line, and a line-scoped lookahead lets a *later*
column's `NOT NULL` suppress the match — measured at **271 instead of 299, hiding 28 real
declarations in 9 files.** That variant was fault-injected below and the ratchet caught it.
**Precondition:** this repo writes DDL as SQL string literals inside Rust and names the identity
column `id`.

**Neither rule duplicates an existing one, checked against all 31 entries in `rules.json` before
publishing.** `nullable-default-column` ([persisted-model-struct](./persisted-model-struct.md) §9)
keys on `DEFAULT` without `NOT NULL`, and **0 of 398 `CREATE TABLE` statements give a primary key a
`DEFAULT`** — it scores zero on all 299 of these. `hand-rolled-fixture-ddl` keys on a `CREATE TABLE`
appearing outside the migration files; it shares *files* with rule B but not the condition (it counts
statements that should not exist; rule B counts a column clause that is incomplete wherever it
appears). A merged dry-run of all 33 rules runs green.

```json
{"rules":[
  {
    "id": "truncated-uuid-id",
    "goldenPath": "docs/concepts/golden-paths/id-generation.md",
    "title": "Identifier minted by truncating a UUID, discarding the entropy that made it collision-free",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "Uuid::new_v4\\(\\)\\s*(?:\\.\\s*simple\\(\\))?\\s*\\.\\s*to_string\\(\\)\\s*\\.\\s*chars\\(\\)\\s*\\.\\s*take\\(\\s*\\d+\\s*\\)|(?:^|[^_A-Za-z0-9])short_id\\(\\s*\\d+\\s*\\)",
      "flags": "gm",
      "ignoreCommentLines": true,
      "description": "a UUIDv4 truncated to a fixed number of hex characters and used as an identifier, in either spelling this repo uses: the inline `.simple().to_string().chars().take(N)` chain, and a call to one of the two `short_id(N)` helpers. PROXY FOR the stack-free condition \"an identifier is minted with less entropy than its collision domain requires\". A full v4 UUID carries 122 random bits; take(8) keeps 32, take(10) keeps 40, take(12) keeps 48. Measured against the operator's live personas_data.db: the `ep_` (episode) namespace already holds 1,067 rows at 32 bits, where the birthday bound puts P(collision) at 1% by 9,291 rows and 50% by ~77,000 - and companion episodes are the one table this product is explicitly designed to grow without bound (docs/plans/athena-longevity.md). The same database shows the width has ALREADY drifted inside one namespace: `appr_` ids exist at both 10 hex (55 rows, minted by the pre-2026-07-17 `short_random()`) and 12 hex (65 rows, minted by today's `short_id(12)`), so one primary-key column holds two different entropy classes and nothing can tell them apart. The failure mode is a PRIMARY KEY constraint violation on INSERT - the write fails loudly rather than corrupting, which is the honest severity - but the write that fails is a memory the companion has already formed. Widths in the tree today: 8 hex x13, 10 hex x9, 12 hex x12. PRECISION measured by reading all 34 matches: 31 true positives (mint sites plus the eleven `fn short_uuid()` / `fn short_random()` wrappers that exist only to mint), 3 false positives - two are length assertions in the helper's own unit test (src-tauri/src/companion/brain/util.rs:104,105) and one names a scratch file rather than a row (src-tauri/src/companion/session.rs:2684). An independent enumeration by prefix over the live database agrees: 15 distinct truncated-id namespaces, all of them primary keys. PRECONDITION (must be re-derived per repo): this repo mints ids in Rust with the `uuid` crate and shortens them with a `.chars().take(N)` chain or a local `short_id(N)` helper. A repo using nanoid's length argument, a base62 encoder, or a database sequence has the same condition wearing markup this pattern cannot see. LEGAL FIX: store the full identifier and truncate only at DISPLAY time. `Uuid::new_v4().to_string()` is already what 302 other sites in this tree do; a short form for a log line or a UI chip is `&id[..8]` at the point of rendering, which costs nothing and keeps the stored key at 122 bits. If a short stored id is genuinely required (a QR payload, a user-typed code), say so in a comment and size it against the table's growth curve rather than by habit."
    },
    "baseline": { "files": 28, "matches": 34 },
    "floor": 900
  },
  {
    "id": "nullable-text-primary-key",
    "goldenPath": "docs/concepts/golden-paths/id-generation.md",
    "title": "TEXT PRIMARY KEY declared without NOT NULL, so a row's identity can be absent",
    "roots": ["src-tauri"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "[\"'`\\s(]id[\"'`]?\\s+TEXT\\s+PRIMARY\\s+KEY(?![^,)\\n]*NOT\\s+NULL)",
      "flags": "gi",
      "ignoreCommentLines": true,
      "description": "a column named `id` declared TEXT PRIMARY KEY with no NOT NULL in the same column clause. PROXY FOR the stack-free condition \"a row's identity column can be absent\". This is a SQLite-specific manifestation of a universal condition, and the reason it exists is a documented SQLite bug preserved for backwards compatibility: unless the column is INTEGER PRIMARY KEY, or the table is WITHOUT ROWID, or NOT NULL is written explicitly, SQLite ALLOWS NULLs in a PRIMARY KEY column - and allows MANY of them, because the PK index treats each NULL as distinct. VERIFIED BEHAVIOURALLY, not inferred: against a copy of the operator's real 347MB personas.db, `INSERT INTO t (id) VALUES (NULL)` into a fresh `id TEXT PRIMARY KEY` table was accepted three times and left three rows with a NULL id; the same insert into `id TEXT PRIMARY KEY NOT NULL` was rejected with `NOT NULL constraint failed`. The consequence three layers up is the one docs/concepts/golden-paths/persisted-model-struct.md measures: every Rust read model types `pub id: String` (1,039 of them, non-Option), so a NULL id makes the row read fail with InvalidColumnType and, per docs/concepts/golden-paths/row-to-struct-mapping.md, take the whole list with it or make the row silently vanish. This tree has NO `WITHOUT ROWID` and NO `STRICT` table, so nothing else closes the hole. WHAT THIS DOES NOT SAY: no NULL or empty id exists in the live database - 77,763 rows across 198 tables with an `id` column were scanned and the count is zero. The class is reachable by construction and has never been reached. This is a preventive ratchet on a clean surface, not a fix backlog. PRECISION: 299 matches across 29 files, and an independent balanced-paren DDL parser over all 398 CREATE TABLE statements in the tree reaches the same 299 by a different route (parse the statement, split its top-level clauses, take the one that carries PRIMARY KEY, test its text for NOT NULL) - 299/299 true positives, 0 declared NOT NULL anywhere. The lookahead is scoped to the next comma or close-paren rather than to end-of-line, which is load-bearing: several fixtures write a whole CREATE TABLE on one line, and a line-scoped lookahead lets a LATER column's NOT NULL suppress the match (measured: 271 instead of 299, hiding 28 real declarations in 9 files). PRECONDITION (must be re-derived per repo): this repo writes DDL as SQL string literals inside Rust and names the identity column `id`. A Postgres sibling cannot have this condition at all - the SQL standard makes PRIMARY KEY imply NOT NULL, and brainiac's 30 `uuid PRIMARY KEY` columns are non-nullable for free. LEGAL FIX: write `id TEXT PRIMARY KEY NOT NULL`. It is two words, it makes `pub id: String` a true statement about the column instead of a hopeful one, and it is the type-level fix this golden path prefers over the gate."
    },
    "baseline": { "files": 29, "matches": 299 },
    "floor": 900
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/id-generation-rules-candidate.json --check`):

```
  rule                    files   base  matches   base  walked  floor
  OK   truncated-uuid-id          28     28       34     34     963    900
  OK   nullable-text-primary-key  29     29      299    299     963    900

  census OK — 2 rule(s), 1926 file-visits, 333 surviving violation(s) across 57 file(s).
```

`963 walked` is exactly `rust.files` in [`shared-facts.json`](../shared-facts.json) — two
independently derived counts agreeing, which is the only reason to trust either. `floor: 900` matches
every other `src-tauri`-rooted rule deliberately: several rules over one root must not hold several
opinions about what "the Rust tree is intact" means.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule set, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES`) | **1** |
| floor above the walk (`floor: 5000` on a 963-file root) | **1** |
| silent drop (baseline claims 60 where 34 exist) | **1** |
| count rises (baseline claims 100 where 299 exist) | **1** |
| renamed root (`src-tauri` → `src-tauri-x`) | **1** |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** |
| stale `exclude` entry (a path matching no file) | **1** |
| **the near-miss variant** — rule B's lookahead widened from `[^,)\n]*` to `[^\n]*` | **1** (drift: `matches dropped 299 -> 271`, `files dropped 29 -> 20`) |

That last row is the one worth keeping: the plausible-looking simplification of the regex is exactly
the mistake a future editor would make, it silently under-reports by 9%, and the ratchet catches it
as a drop rather than reporting a cleaner codebase.

**No `exclude` entries on either rule.** Rule A's three false positives are two lines in a unit test
and one filename — excluding `brain/util.rs` by path would hide the canonical helper itself, which is
the opposite of what the rule is for, and a 3-of-34 known-noise floor is cheaper than an allowlist
that goes stale. Rule B has no legitimate exception at all: every one of the 299 is the condition.

**A note on the engine caveat.** Both patterns' `\s+` runs cross newlines, so both are multiline
patterns of the kind the 2026-08-14 comment-rewind fix was made for. Cross-checked independently, as
the caveat asks: rule B's 299 is reproduced by a balanced-paren DDL parser that never sees a regex,
and rule A's 34 is reproduced by enumerating id prefixes in the live database. Rule A's matches
always begin at `Uuid::` or at the character before `short_id(`, and rule B's at a quote, space or
open-paren before `id` — neither can begin on a comment-only line and run past it, because the token
sequence has to be contiguous.

### What this does NOT gate, and why — one refusal

**"A row's identity was chosen by an untrusted producer" is not expressible as a content match, and
no regex should be shipped for it.** The naive signal is `crypto.randomUUID` in `src/`: **50 matches
across 30 files, of which 2 are persisted entity ids — 4% precision.** The other 48 are React list
keys, optimistic-UI placeholders, idempotency keys, and run-correlation ids, all of which are the
*correct* use of the primitive. Baselining that would ratchet 48 correct constructions and teach
habitual `npm run census -- --update`, which is the reflex the census exists to prevent. **Refusing a
signal because its ratchet would be routinely overridden is a real outcome, not a compromise** — the
same conclusion `persisted-model-struct` §9 reached about field-level casing, by the same reasoning.

The condition is **relational**: it joins a mint site in one language to a `#[tauri::command]`
signature in another to an `INSERT` in a third file. Two checkers can express it, and both are
cheaper than a regex:

1. **The one that already exists: call `require_valid_id`.** Seven Rust sites accept a caller-chosen
   id (§7) and none validates it. Wiring the validator in is seven lines. Once it is in, the gate is
   `grep -c require_valid_id` — a rule that a *conforming* construction is present rather than that a
   violating one is absent, which is the shape that survives a repo where the violation wears
   different markup.
2. **An `#[test]` that the identity of a persisted row is minted server-side.** For each
   `#[tauri::command]` that takes a struct deriving `Deserialize` with a non-`Option` `id` field and
   reaches an `INSERT`, assert the command re-mints. That is behaviour over shape, it survives a
   rename, and it is the same host [index-design](./index-design.md) §9 refusal 1 and
   [persisted-model-struct](./persisted-model-struct.md) §9 refusal 3 both converged on. **Mark
   honestly: no such test exists in any of the four repos swept, so this is local calibration, not
   doctrine.**

**How the census rules fail loudly when their own precondition is absent** is inherited from the
runner and demonstrated in the fault table: a zero-match run fails structurally rather than reporting
a clean tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a
drop without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made here from warning volume, and none could be: `npm run check` runs `eslint src/`
with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level rule enforces
nothing at either gate at any count. The census rules enforce; a lint rule would not. Rule B in
particular starts at 299 and can only ratchet down — that is the point, and it is why the fix (two
words per declaration) belongs in "Prefer a type over a gate" rather than here.

## See also

- [Persisted model struct](./persisted-model-struct.md) — the type of every *other* field, and the
  newtype ruling this path re-tested and confirmed.
- [Schema change](./schema-change.md) — where the `CREATE TABLE` goes that carries the two words.
- [Index design](./index-design.md) — what the key is used to find, and why a random primary key
  costs nothing here.
- [Row to struct mapping](./row-to-struct-mapping.md) — what happens to a row whose `id` cannot be
  read.
- [Timestamp storage](./timestamp-storage.md) — the other half of every keyset cursor in §6.
