# Catalog row seeding

> Situation node: `data-persistence/migrations/catalog-row-seeding` · situation spine
> `sides: server` · `twoSided: false` · recurrence 6 · risk **medium** · spine label
> `convergence: mixed`. Dimensions: function · code-quality. Spine's own framing:
> *"Refreshing shipped default rows on upgrade without clobbering user edits."*
>
> Composed 2026-08-17 against `master @ 29e28aa8f`. **Short form** (spine header, §0, §2,
> §7, §9, §12) per the batched-tail runbook; the quality core is unchanged.
>
> **Sweep.** Every boot-time seed path in the tree, read in full: `db/src/lib.rs`
> (`seed_builtin_credentials` :1533, `seed_builtin_tools` :1704, `seed_builtin_connectors`
> :1782, `seed_builtin_shared_events` :1849, `seed_example_scrape_config` :1900, and the
> call site at :341-348), `src/lib.rs`'s boot sequence (:683-712), `engine/recipe_seed.rs`
> (326 lines, read whole), `engine/director.rs::ensure_director_persona`, plus the
> generated catalogs `db/src/builtin_connectors.rs` (292,389 B) and
> `db/src/builtin_shared_events.rs` (168,215 B), their JSON sources
> (`scripts/connectors/builtin/*.json`, 134 files) and `scripts/templates/_recipe_seeds.json`.
>
> **Executed, not read.** `seed_builtin_connectors`' refresh `UPDATE` was replayed
> verbatim against a copy of the operator's own `connector_definitions` rows after
> simulating an operator edit (§0.2). Row counts come from the 2026-08-17 purge backup at
> `%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`; **none of the
> tables in this leaf were in the purge cascade**, so these counts are current, not
> historical — but they were still taken from the backup, never from a live file.
>
> `cargo` was unavailable. Nothing here was compiled.

---

## §0 — The headline

**Seven things seed shipped rows into this database. Six of them cannot tell a row the
operator has edited from a row as shipped — and the two that refresh on every start
overwrite the edit and then stamp `updated_at` with the boot time, erasing the only
evidence that an edit ever happened. Executed: an operator's rename, recategorisation and
field edit of a built-in connector all disappear on the very next app start; the recolour
survives, because `color` is the one presentation column missing from a hand-maintained
`SET` list.**

The seven paths, and what each guarantees:

| # | seeder | rows | conflict policy | refreshes on upgrade | protects an edit | receipt | failure |
|---|---|---:|---|:--:|:--:|:--:|---|
| 1 | `seed_builtin_credentials` (`db/src/lib.rs:1533`) | 4 | read-then-`INSERT`, skip if id exists | no (one targeted legacy rename) | **by not writing** | none | `warn!`, continue |
| 2 | `seed_builtin_tools` (`:1704`) | 7 | `INSERT OR IGNORE` | no | **by not writing** | none | **`?` — aborts `init_db`** |
| 3 | `seed_builtin_connectors` (`:1782`) | 134 | `INSERT OR IGNORE` **+ unconditional `UPDATE … WHERE name=? AND is_builtin=1`** | **yes, 9 columns** | **no** | none | **`?` — aborts `init_db`** |
| 4 | `seed_builtin_shared_events` (`:1849`) | 123 catalog + **0** firings | `INSERT OR IGNORE` **+ unconditional `UPDATE … WHERE id=?`** | **yes, 8 columns** | **no** | none | **`?` — aborts `init_db`** |
| 5 | `seed_example_scrape_config` (`:1900`, `cfg(feature="scraper")`) | 1 | `INSERT OR IGNORE` | no | **by not writing** | none | **`?` — aborts `init_db`** |
| 6 | `ensure_director_persona` (`engine/director.rs`) | 1 | ensure-by-id | n/a | n/a | id | `warn!`, continue |
| 7 | `recipe_seed::seed_recipes_from_bundle` | 299 | lookup-by-`(template,use_case)` then **targeted repair** | **yes, 2 system-owned keys only** | **YES — by signature** | **`SeedReport`** | `warn!`, continue |

### §0.1 — One of seven gets it right, and it wrote down why

`engine/recipe_seed.rs` is the exemplar, and the reasoning is in its own module docstring
(`:26-46`): existing rows are skipped, with *"two targeted exceptions"* — a metadata
repair and a model-tier refresh — and *"every other `prompt_template` field (incl. user
edits) is preserved untouched."*

The repair's guard is the thing to copy (`:189-190`):

```rust
let stale_name = existing.name == seed.source_use_case_id
    && seed.name != seed.source_use_case_id;
```

with the comment *"a user rename breaks the equality, so renamed rows are never touched."*
That is not a flag and not a timestamp. It is a **signature of the un-edited row** —
derived from the defect being repaired, so it can only match rows that still exhibit it.
No column had to be added, and no operator had to be asked.

It also carries the only version gate (`EXPECTED_SEED_VERSION`, `:68`; the bundle is
refused outright on mismatch, `:118-123`), the only per-row failure isolation (*"one bad
recipe shouldn't block 290 good ones"*, `:106-110`), and the only receipt
(`SeedReport { total, created, skipped_existing, repaired, failed }`).

This is the same shape [`backfill-migration`](./backfill-migration.md) found for repairs:
*fourteen backfill operations, exactly one can tell its caller that it finished*. Seeds
score **1 of 7** on the same axis. That two neighbouring leaves independently land on
"exactly one of N returns a receipt" is worth more than either finding alone.

### §0.2 — Executed: what happens to an operator's edit

Replayed against a copy of the operator's own rows (`connector_definitions`, `slack`),
using the exact `UPDATE` at `db/src/lib.rs:1826-1831` with the shipped values read out of
`builtin_connectors.rs`:

```text
1. shipped row, as seeded    : Slack        | #4A154B | messaging | [{"key":"bot_token"… | 2026-08-17T09:24:38Z
2. after the operator edits  : Slack (work) | #ff0000  | my-tools  | [{"key":"webhook_url"…| 2026-01-01T00:00:00Z
3. after the next app start  : Slack        | #ff0000  | messaging | [{"key":"bot_token"… | 2026-08-17T23:59:59Z
```

The rename, the recategorisation and the credential-field edit are gone. The **recolour
survives** — not by design, but because the `SET` list is hand-maintained and `color` is
not on it:

- written every start: `label, icon_url, fields, healthcheck_config, metadata, category,
  services, events, resources, updated_at`
- not written: `name, color, is_builtin, created_at`

**The edit is reachable.** `update_connector` is a registered Tauri command
(`src/commands/credentials/connectors.rs:42-52`, allow-listed at `ipc_auth.rs:168`) with
**no `is_builtin` guard**, and `db/src/repos/resources/connectors.rs:228-262` writes
`fields`, `healthcheck_config`, `services`, `events`, `metadata` — five of the nine
columns the seeder overwrites. A second, app-generated writer does the same:
`commands/design/n8n_transform/confirmation.rs:540` sets `services` on a connector row,
and the next boot reverts it.

### §0.3 — `updated_at` on a seeded row is the boot clock

Measured on the backup, `connector_definitions`:

| | value |
|---|---|
| rows | 134, all `is_builtin = 1`, 0 user rows |
| **distinct `updated_at`** | **1** — `2026-08-17T09:24:38.517217+00:00` |
| distinct `created_at` | **17** |

`created_at` records seventeen genuine arrival waves across seventeen releases.
`updated_at` records one thing: the last time the app started. So the column that would
answer *"has anyone touched this row?"* — the predicate every other repo in the fleet
lacks and this one could have had for free — is overwritten by the very statement whose
safety depends on it. **The seed destroys its own oracle.**

### §0.4 — Nothing ever removes a catalog entry, measured three ways

| catalog | shipped | in table | **orphans** |
|---|---:|---:|---:|
| connectors (`builtin_connectors.rs` ← 134 JSON files) | 134 | 134 | **0** |
| shared events (`builtin_shared_events.rs`) | 123 | 125 | **2** |
| recipes (`_recipe_seeds.json`) | 299 | 316 | **16 `is_builtin = 1`, 1 not** |

The two shared-event orphans are `scrape-example-hn-front-changed` and
`scrape-example-hn-front-error`, both still `status = 'active'`, both from a
feature-gated example. The sixteen recipe orphans are real feature rows —
`email-follow-up-tracker/uc_ondemand_check`, `email-lead-extractor/uc_human_review`,
`email-support-assistant/uc_email_triage`, … — each carrying `is_builtin = 1`, which is
what the UI reads to decide a row is system-owned and therefore not the user's to manage.
**They will never be refreshed (they are not in the bundle) and never be removed (nothing
prunes).** They are permanently frozen at whatever the shipped content was on the day
they landed, wearing a badge that says the vendor maintains them.

The connectors column is 0 for one reason, and it is worth naming because it is *not* a
mechanism: a **hand-written one-off** at `db/src/lib.rs:1797-1800`,

```rust
let _ = conn.execute(
    "DELETE FROM connector_definitions WHERE id = 'builtin-local-scraper' AND is_builtin = 1", []);
```

plus a second at `migrations/incremental.rs:5734` for `desktop_terminal` / `desktop_vscode`.
Two retirements, two bespoke `DELETE`s, both with the id spelled into a string literal. The
next retirement needs a third, and if nobody writes it the row simply stays — which is
exactly what happened to the shared events and the recipes.

This is the **third** independent measurement of this shape in the corpus today (the canvas
layout entries, the version tables, and now three catalogs), which promotes it from an
observation to a property of the design: **`INSERT OR IGNORE` plus an unconditional
`UPDATE` is an upsert, and an upsert has no delete half.**

### §0.5 — Four seeds can prevent the app from starting; three cannot, and the split is backwards

`db::init_db_with_journal` propagates with `?` (`db/src/lib.rs:341-348`), so a failure in
`seed_builtin_tools`, `seed_builtin_connectors`, `seed_builtin_shared_events` or
`seed_example_scrape_config` **fails `init_db` and the app does not start**. The three
seeds that run one layer up — credentials, Director, recipes — are each wrapped in a
`match … Err(e) => tracing::warn!` and are survivable (`src/lib.rs:685`, `:693`, `:710`).

The split does not track importance. The seeds that can kill the boot are a 7-row tool
list, a presentation refresh, a catalog nobody has subscribed to (`subscriber_count = 0`
on 125 of 125 rows) and **a disabled Hacker News scraping example**. The seed that cannot
kill the boot is the one that populates 299 recipes without which template adoption does
not work on a fresh install.

---

## §2 — The one way

**Seed by identity, refresh only what the vendor owns, and prove the row is still the
vendor's before you touch it — then report what you did.** Concretely, in order:

1. **Split the row's columns into two sets before you write any SQL.** *Vendor-owned*
   (the shipped definition: schema, endpoints, capabilities, the model tier) and
   *operator-owned* (name, label, colour, category, enablement, anything the UI exposes an
   editor for). Write the split down in the seed function. `seed_builtin_shared_events`
   already half-does this — its comment says *"preserve subscriber_count/status"* — and
   the discipline is to make the list exhaustive rather than incidental.
2. **Insert by the stable id, keyed once.** `INSERT … ON CONFLICT(<the real uniqueness
   key>) DO NOTHING`, not `INSERT OR IGNORE` — the targeted form still raises `NOT NULL`
   and `CHECK` violations that the statement-wide form swallows (measured behaviourally by
   [`upsert`](./upsert.md)'s
   `unverifiable-conflict-clause`). **Use the same key for the insert and the refresh.**
   `seed_builtin_connectors` inserts on `id` and refreshes on `name`; a rename in the
   shipped catalog would leave the row matched by neither, refreshed never, and invisible
   to both halves.
3. **Gate the refresh on a fact about the row, not on where it came from.** `is_builtin`
   answers *"did we ship this?"*, which is not the question. Either carry the shipped
   content's identity on the row — `source_revision TEXT` / `definition_hash TEXT`, written
   at seed time and compared before refresh — or derive a **signature of the un-edited
   row** the way `recipe_seed.rs:189` does. The hash form is strictly better because it
   generalises: `vibeman/src/app/db/repositories/discovered-template.repository.ts:108-133`
   is the fleet's only content-hash-gated refresh, and it is worth reading.
4. **Never write `updated_at` in a refresh that changed nothing.** Compare first, write
   only on difference. A `SET updated_at = now()` that runs unconditionally converts the
   column from "last change" to "last boot" (§0.3) and takes the audit trail with it.
5. **Reconcile removals explicitly, and prefer retirement to deletion.** Compute the set
   difference between the shipped catalog and the table on every seed pass, and act on it
   in one place: `status = 'retired'` for rows a user may still reference, a real `DELETE`
   only for rows that cannot be referenced. Copy vibeman's `markStale` (`:236-256`) —
   including its explicit *"Safety guard: do NOT mark all as stale on total parse failure"*
   (`:244`), which is the correct answer to the obvious failure mode of a reconcile pass.
   A per-id `DELETE` written by hand at retirement time is not a mechanism; it is a
   promise to remember.
6. **Return a receipt and isolate per-row failure.** `SeedReport { total, created,
   skipped_existing, repaired, retired, failed }`, logged at `info!`, with each row's
   error caught and counted rather than propagated. One malformed catalog entry must not
   be able to stop the application from starting (§0.5).
7. **Version the bundle and refuse a shape you do not understand.** `EXPECTED_SEED_VERSION`
   (`recipe_seed.rs:68`) is the whole pattern: a bundle whose `version` you do not
   recognise is refused loudly, not silently mis-mapped field-by-field.

**And the ordering rule that falls out of all of the above:** a seed runs on **every
start**, which makes it the only migration-shaped operation whose cost and blast radius
are paid repeatedly. Everything a boot migration may do once, a seed must be able to do
2,000 times without accumulating a single unintended write.

---

## §7 — Deviations

**D1 — P0: the connector refresh overwrites operator edits on every start, and the edit
path is a live IPC command.** `db/src/lib.rs:1826-1831` vs
`src/commands/credentials/connectors.rs:42-52`. Nine columns rewritten unconditionally for
all 134 built-in rows; five of them are writable through `update_connector`, which has no
`is_builtin` guard. Replayed and confirmed in §0.2. *Deferred, not applied — the fix
changes what a live surface shows and the current behaviour may be deliberate for
`fields`/`healthcheck_config`.* Register as a deferred fix with the two-set split from
§2.1 as the proposed shape.

**D2 — P0: `updated_at` is stamped by the refresh, so no seeded row can be asked whether
it was edited.** 134 of 134 connector rows share one `updated_at` (the last boot);
`created_at` has 17 distinct values. `seed_builtin_shared_events` does the same to
`cached_at` (`:1864-1873`). The compare-before-write of §2.4 fixes both.

**D3 — P1: the connector insert and the connector refresh key on different columns.**
`INSERT OR IGNORE … (id, …)` (`:1802`) then `UPDATE … WHERE name = ?11 AND is_builtin = 1`
(`:1830`). Today this is latent — measured: 134 distinct ids, 134 distinct names, **0
duplicate names**, and every table row matches a shipped id *and* a shipped name. It
becomes a silent freeze the first time a shipped `name` changes for an existing `id`: the
insert is ignored (id present), the update matches nothing (name absent), and the row is
never refreshed again with no error anywhere.

**D4 — P1: 16 `is_builtin = 1` recipes and 2 `status = 'active'` shared events are in the
table and in no shipped catalog.** §0.4. Frozen forever, badged as vendor-maintained.
Nothing computes this set difference; the two catalog retirements that have happened were
hand-written per-id `DELETE`s (`db/src/lib.rs:1799`, `migrations/incremental.rs:5734`).

**D5 — P1: a built-in catalog row cannot be permanently deleted.** `delete_connector` is a
registered command (`ipc_auth.rs`), `crud_delete!("connector_definitions")`
(`repos/resources/connectors.rs:29`) has no `is_builtin` guard, and the next start's
`INSERT OR IGNORE` re-creates the row. There is no tombstone table for catalogs (the
`persona_tombstones` table covers personas only). Read from code, not executed.

**D6 — P1: four seeds can prevent the application from starting, and they are the four
least important ones.** §0.5. `seed_example_scrape_config` — one disabled Hacker News
example — is `?`-propagated into `init_db`; the 299-recipe seed that makes template
adoption work is `warn!`-and-continue.

**D7 — P2: no seed except recipes returns a receipt, and none isolates per-row failure.**
Seeders 1-5 call `conn.execute(...)` in a loop and discard the returned row count, so a
seed pass cannot report created-vs-skipped, and a single failing row aborts the remaining
rows *and* (for 2-5) the boot. `seed_builtin_connectors` logs
`"Seeded {} builtin connector definitions"` with `connectors.len()` — the length of the
**input**, which is 134 whether or not a single row was written.

**D8 — P2: `seed_builtin_shared_events` ships zero of the "baked firings" it advertises.**
The docstring (`:1841-1847`) and the log line (`:1878-1882`) both describe seeding
firings; `BUILTIN_SHARED_EVENT_FIRINGS` contains **0** entries and `shared_event_firings`
holds **0** rows. The `INSERT OR IGNORE` loop at `:1868-1876` has never executed a
statement. Also measured: `subscriber_count = 0` on **125 of 125** catalog rows, so the
`UPDATE`'s careful preservation of that column has never preserved a non-zero value.

**D9 — P3: the recipe bundle's own docstring is stale.** `recipe_seed.rs:3-4` says *"298
recipes … plus 9 SDLC-template recipes appended"* (= 307). The bundle declares
`recipe_count: 299` and contains **299**. The code handles the mismatch correctly —
`recipe_count_signal_mismatch` (`:164-166`) warns rather than fails — but the prose is
wrong by 8 in a file whose entire subject is keeping a shipped count honest.

**D10 — P3: `persona_tool_definitions` holds 10 `is_builtin = 1` rows; the seeder ships
7.** The other three arrived from a migration rather than the seeder, so the "shipped tool
catalog" has two producers and one of them is not the seed function. Not harmful today;
recorded because §2.5's reconcile pass would report them as orphans and be wrong.

---

## §9 — The gate: declined, with numbers, plus the instrument that would work

**Declined.** Four candidate signals were measured against this tree; each is reported with
the count that killed it.

| candidate signal | violating | compliant control | why declined |
|---|---:|---:|---|
| `INSERT OR IGNORE INTO` / `REPLACE INTO` in Rust | 68 / 39 files | `ON CONFLICT` 79 | **100% overlap** with the existing `unverifiable-conflict-clause` (baseline 40 files / 71 matches, same roots, same extensions, same anchor). Nothing to add. |
| a refresh `UPDATE … WHERE … is_builtin = 1` | **1** (`db/src/lib.rs:1830`) | — | population 1. A one-site rule is a named assertion, not a ratchet, and it goes structurally to zero the moment D1 is fixed — which the census cannot express (doctrine §4). |
| a provenance-flag column (`is_builtin\|is_system\|is_default\|is_seeded\|builtin` declared `INTEGER\|BOOLEAN`) | **5 / 2 files** | revision/hash columns (`source_version`, `manifest_hash`, `content_hash`, `checksum`, `template_version`, …) **13 / 4 files** | the partition is real and the *direction* is right, but 5 matches in 2 files is below the noise floor of a ratchet: any of the four migration files being reformatted moves it. |
| a `fn seed_*` returning `Result<(), _>` (no receipt) | 5 | 1 (`SeedReport`) | population 5, and the receipt concept is already anchored one leaf over by `unfinishable-backfill-receipt` — a second rule for the same idea on a smaller population is the "three paths, one mechanism" duplication the census exists to prevent. |

**Prefer a type over a gate — and here a type genuinely reaches, which is why the decline
is not a shrug.** Held against the seven qualifications:

- **Q5 (withholding beats requiring)** is the operative one, and the withholding is of a
  *column list*. Replace `conn.execute("UPDATE connector_definitions SET label=?, …")`
  with `connectors::refresh_shipped(&conn, &c.id, ShippedFields { label, icon_url, fields,
  healthcheck_config, metadata, category, services, events, resources })`. A seeder cannot
  then name an operator-owned column, because `ShippedFields` has no field for one. The
  same edit makes D1 unspellable and D3 impossible (one function, one key).
- **Q1 (a required prop carries only what it encodes)** is the qualification that stops
  this being the whole answer. `ShippedFields` closes *which columns* and says nothing
  about *whether this row is still the vendor's* — so it must be paired with the
  `source_revision` / signature predicate of §2.3. Two edits, not one.
- **Q3 (a type nobody constructs constrains nothing)** passes: 7 construction sites,
  every seed path in the tree.
- **Q4** is not applicable (no untrusted constructor). **Q2, Q6, Q7** do not bite.

**The condition the census genuinely cannot host, and the instrument that can.** §0.4 is
an **absence** — *no code anywhere computes the set difference between the shipped catalog
and the table* — and the doctrine is explicit that a ratchet on presences cannot assert
one. The instrument is a **seed inventory check**, and it is the same shape that found the
29 orphan ts-rs bindings and the 314 unregistered triage queues:

> For each shipped catalog (`builtin_connectors.rs`, `builtin_shared_events.rs`,
> `_recipe_seeds.json`), parse the shipped ids **twice, by two different anchors**, and
> diff against the ids in the corresponding table. Report *shipped-with-no-row* and
> *row-with-no-shipped-entry* separately. **Exit 2 if either catalog yields fewer than 50
> ids** — the precondition guard, without which a broken parser reports "no orphans" and
> looks like a working gate forever.

Run today, that check reports **0 / 2 / 16**. Two of its three answers are non-zero and
neither has ever been surfaced by anything.

**Why "two different anchors" is written into the instrument.** Counting the shipped
catalog is where this leaf's own measurement went wrong, twice, in the same way — see
§12.2.

---

## §12 — Corrections

**12.1 — To my brief, on both sharp questions, and the answers differ per seeder.** The
brief asked *"is a seed idempotent, does it UPSERT or INSERT-OR-IGNORE, and — the sharp
one — what happens when the operator has edited a seeded row?"* There is no single answer:
**all seven are idempotent**, five are `INSERT OR IGNORE`-shaped and two of those five
also carry an unconditional refresh `UPDATE`; on the sharp question the split is **5
protect the edit (by never refreshing), 1 protects it deliberately (by signature), 1 does
not protect it at all** — and the one that does not is the largest catalog in the app. The
brief also asked whether seeds are *versioned or checksummed*: **1 of 7** (`recipe_seed`'s
`EXPECTED_SEED_VERSION`), and it version-gates the *bundle*, not the rows. No row anywhere
carries a checksum of the content it was seeded from.

**12.2 — To `rate-limiting.md` §12.6: the connector count is 134, not 135, and the
reconciliation it published is a fabrication.** That document's disagreement table reads:

> | connector seed rows | 135 (impl A) | 134 (impl B) | A counted `BuiltinConnector {`
> struct literals; B counted `metadata: Some(r##"…"##)` blobs it could JSON-parse. One
> row's metadata uses a different raw-string form. | **Both.** 135 connectors, 134
> parseable blobs.

Measured here, three ways:

- `grep -c "BuiltinConnector {"` → **135**. That is impl A's number.
- `grep -c "^        BuiltinConnector {$"` (the 8-space struct-literal opener) → **134**.
- The 135th match is `pub struct BuiltinConnector {` at **`builtin_connectors.rs:4`** — the
  type declaration, counted as an instance of itself.
- `metadata: Some(r##"` → **134**. `metadata: None` → **0**. There is no odd raw-string
  form and no unparseable blob.

And independently: the JSON source directory holds **134** files with **134** distinct
ids; the table holds **134** rows; a structural block-split parser and a line-pairing
parser both return **134** with an identical id sequence, and the set difference against
the table is empty in both directions.

So impl B was right, impl A was off by one, and the published resolution — *"both right;
one row's metadata uses a different raw-string form"* — is an explanation invented to
reconcile two numbers instead of opening the file. This is precisely the failure the
doctrine warns about from the other side (*"do not pick the prettier number"*): the
prettier move here was to keep **both**. A disagreement of exactly one, between a naive
token count and a structural count, should always be tested against the declaration first.

**12.3 — And I reproduced the same error in the same session, on the neighbouring
catalog.** My first count of `builtin_shared_events.rs` was **124**, from
`grep -c "BuiltinSharedEvent {"`. The true count is **123**; the 124th match is
`pub(crate) struct BuiltinSharedEvent {` at line 10. I caught it only because I had just
finished writing §12.2 and re-ran the count structurally. Recorded because it is the
strongest available evidence that the trap is in the *instrument*, not in the author: two
independent composers, hours apart, made the identical off-by-one on two sibling generated
files. **Never count a Rust struct literal with a substring that also matches its
declaration.**

**12.4 — The spine's `convergence: mixed` label: contradicted, and it should read
`converged-on-the-disease`.** Effective cohort for this leaf: **3 of 5** — `personas-web`
does no database seeding at all (its connector catalog is a static TS module) and
`personas-cloud` has an `is_builtin` column and a full upsert with **zero seed callers**.
The three that seed are brainiac (`sweep_schedules`, 5 rows across 3 migrations),
ascent (one `Organization` sentinel) and vibeman (one `default-project` row).

**Not one of the three protects an operator-edited row with a predicate.** There is no
`is_custom`, no `user_modified`, no `updated_at > seeded_at`, no `COALESCE` of user
fields anywhere in the cohort. Protection, where it exists, is accidental: brainiac's
`ON CONFLICT (kind) DO NOTHING` (and two of its four sites are plain `INSERT`s that would
hard-fail on re-run — they survive only because sqlx never re-runs), ascent's
`ON CONFLICT ("slug") DO NOTHING`, and vibeman's `COUNT(*) > 0` whole-table guard, which
resurrects `default-project` the moment an operator deletes their last project.

**And not one of the three prunes a removed entry** — which makes §0.4 a fleet-wide
property rather than a local lapse. That is *"the fleet converged on the disease"*, the
tenth-failure mode from the doctrine, and an oracle that only counts agreement would read
5-for-5 silence as maximal confirmation.

**12.5 — Personas is ahead of the fleet, by exactly one seeder out of seven.** Stated as
self-comparison. `recipe_seed.rs` is the only thing in six repositories that (a)
version-gates its bundle, (b) refuses to overwrite a row a user renamed, (c) isolates
per-row failure, and (d) returns a receipt. Six of this repo's seven seeders are no better
than the fleet's three; the seventh is better than all of them, and it is 326 lines away
from the two that clobber.

**12.6 — The best answer for §2.5 is in the ancestor repo, on a catalog it discovered
rather than shipped.** `vibeman/src/app/db/repositories/discovered-template.repository.ts`
is the fleet's only reconcile-with-prune: targeted `ON CONFLICT(source_project_path,
template_id) DO NOTHING` (`:167`), a **content-hash-gated** UPDATE (`:108-133`), a
`markStale` that sets `status='stale'` *"instead of deleting, preserving history"*
(`:236-256`) behind an explicit *"Safety guard: do NOT mark all as stale on total parse
failure"* (`:244`), and a separate opt-in `DELETE` path (`:299-313`). Every clause §2.3-2.5
prescribes exists there. It governs *discovered* rows, not shipped ones — so this is the
doctrine's component-boundary shape again: **a solved problem that did not cross from the
catalog the code found to the catalog the code ships.**

**12.7 — One sibling is a port and must not be counted.**
`personas-web/src/data/connectors.ts:47` carries the header *"Generated from
personas/scripts/connectors/builtin/*.json on 2026-05-17"*, and its generator hardcodes
`C:/Users/kazda/kiro/personas/scripts/connectors/builtin` — **an absolute path into this
repo on a different machine's user profile**, which makes it currently unrunnable and
therefore stale by three months. It is a derived copy of the exact catalog this leaf is
about, and it is the reason the effective cohort is 3 and not 4.

**12.8 — `sides: "server"` holds, and the mechanism is worth naming.** Every seeder, every
deviation, every candidate signal and the whole reconcile instrument are server-side Rust
running before the webview exists. The client's only involvement is `update_connector` —
which is not the seed, it is the edit the seed destroys. The label survives because the
seed literally runs before there is a client, which is the kind of structural reason the
doctrine asks for when a label holds.
