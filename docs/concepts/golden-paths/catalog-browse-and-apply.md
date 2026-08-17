# Golden path — Catalog browse and apply

> Situation node: `product-surfaces` › `authoring-and-catalogs` › `catalog-browse-and-apply` ·
> [situation spine](../situation-spine.md) · recurrence **19** · risk **medium** ·
> sides: **client** (contradicted by measurement — see [§12.1](#121--sides-client-is-wrong-for-the-fifth-time-and-this-time-the-answer-is-in-a-build-script)) ·
> convergence: **mixed** · dimensions: **ui · function · resilience · security**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` (the census engine's own `walked` count) and
> all `.rs` under `src-tauri/`. **Nine shipped catalogs** enumerated end to end and counted on both
> sides of the install boundary: **111** canonical template JSON (2,039,352 bytes), **299** bundled
> recipes, **134** baked connector definitions, **123** baked shared-event feeds, **35 + 15 + 27**
> skill directories across repo / user library / installer bundle, **7** team-preset manifests,
> **9** archetypes, **13** builtin tool seeds, **1** example scrape config. **Twelve** client browse
> surfaces opened and read, with their install doors and their Rust halves
> (`skill_files.rs` 1,415 lines, `template_adopt.rs`, `recipe_seed.rs`, `db/src/lib.rs:1533-1930`,
> `repos/communication/reviews.rs`, `repos/resources/connectors.rs`, `repos/resources/recipes.rs`,
> `skill_usage.rs`). All **152** committed census rules read; **18** re-run to measure overlap.
>
> **Measured by EXECUTION, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB, 71 tables) were taken
> 2026-08-17 02:20 UTC with the app running, together with their `-wal`/`-shm`; **the live files were
> never opened for write and both copies were deleted at the end of composition.** Five things were
> then replayed verbatim against the copies and the real filesystem:
> 1. **`increment_adoption_count`'s own `WHERE test_case_name = ?` predicate**
>    (`db/src/repos/communication/reviews.rs:623-627`) over all **160** `adoption_log` rows. §0 is
>    that result.
> 2. **`hash_skill_dir` + `classify_sync_state`** (`skill_files.rs:385-448`), transliterated
>    byte-for-byte (SHA-256 over sorted `rel + 0x00 + len_u64_le + bytes`, excluding the two
>    sidecars), over all **105** installed skill directories in 15 roots.
> 3. **`publish_skill_to_library`'s version guard** (`skill_files.rs:983-995`) over all **35** repo
>    skills against the **15**-skill user library.
> 4. **Both template integrity layers** — `computeContentHashSync` (cyrb53) against
>    `templateChecksums.ts` and against `template_checksums.rs` — over all **111** canonical
>    templates.
> 5. **The recipe seeder's own key** (`find_by_source(source_template_id, source_use_case_id)`,
>    `recipe_seed.rs:175-179`) over all **299** bundle entries vs all **316** live rows, with the
>    `refresh_model_tier` merge separated from real content drift.
>
> **Nothing was installed, adopted, applied, subscribed to or seeded.** No live command was invoked.
> **`cargo` was not run** and no build of any kind was started — the operator uses this app daily.
> Every Rust claim is static or replayed in SQL/JS. No secret value appears below.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened, none modified. See §6.
>
> **Settles:** what the baked artifact contains, what identity an installed copy keeps, what
> re-install does, and what happens to installs of an item the catalog stops shipping.
>
> ### Cross-reference, not overlap
>
> [**`dry-run-preview`**](./dry-run-preview.md) — same subdomain, composed the same day — owns
> **the number a preview shows before an action**. This owns **the item, its identity, and what the
> install leaves behind.** Its `skill_files_install_preview` finding (*"16 files removed across 8
> skills; 0 will be, `copy_dir_recursive` cannot delete"*) is **confirmed and extended** here in
> §7 D2: the files that will not be removed are the same files that make the installed copy read
> `diverged` forever.
>
> [**`ai-draft-preview-apply`**](./ai-draft-preview-apply.md) owns **an artifact a model wrote**.
> This owns **an artifact the app shipped**. Its P3 (*provenance in a field, not in prose*) is the
> parent of this path's P2, and its §7 D8 (`connector_definitions` `is_builtin = 0` count is 0;
> `playwright_procedures` 0 rows) is **reproduced exactly** and answered in §0's "read-only
> catalogs" column.
>
> [**`untrusted-definition-validation`**](./untrusted-definition-validation.md) owns **whether a
> definition the app did not author is legal**. This owns **a definition the app DID author** — the
> opposite trust posture — and cites its §7.I finding (built-in template integrity is enforced at
> catalog load) rather than re-deriving it. §0 measures what that check can and cannot see.
>
> [**`codegen-task-registration`**](./codegen-task-registration.md) owns **whether a generated
> artifact is fresh**. This owns **what the generated artifact does once it ships**. §12.3 offers
> that path a correction: the script it names as the clean answer to staleness has 22 stale
> directories in its gitignored destination right now.

---

## 0. The headline

**Nine shipped catalogs. Two of them record which version of a catalog entry an installed copy came
from. One of those two writes the answer into a file that nothing reads; the other writes the same
constant into all 316 rows.**

And the surface the user actually looks at — the template gallery's adoption counter — is wrong by
**18×**, because the writer keys on the display name and the caller passes the id.

### The adoption counter, replayed against all 160 real adoptions

`increment_adoption_count` (`db/src/repos/communication/reviews.rs:607-645`) does two things in one
transaction: it bumps a counter and it writes the audit row. Both use the same predicate.

```rust
tx.execute(
    "UPDATE persona_design_reviews
       SET adoption_count = adoption_count + 1, last_adopted_at = ?1
     WHERE test_case_name = ?2",              // :623-627   ← the DISPLAY NAME
    params![now, template_name],
)?;
let review_id: Option<String> = tx
    .prepare("SELECT id FROM persona_design_reviews WHERE test_case_name = ?1")?
    .query_row(params![template_name], |row| row.get(0))
    .ok();                                     // :633-636   ← same predicate, .ok() swallows the miss
```

Its two callers disagree about what `template_name` is:

| caller | what it passes | matches `test_case_name`? |
|---|---|---|
| `commands/design/team_synthesis.rs:606` | `&tmpl.test_case_name` — the display name | ✅ |
| `commands/design/template_adopt.rs:604` | `&template_name`, whose own tracing field one line up reads **`template_id = %template_name`** (`:230`) | ❌ it is the **slug** |

Replayed over the live ledger:

```
adoption_log rows                                                        160
  the UPDATE's predicate would match a persona_design_reviews row         16   (10.0%)
  the UPDATE's predicate would match ZERO rows — a silent no-op          144   (90.0%)
  adoption_log.source_review_id NULL (the app's OWN record of the miss)  144   (the same 144)
  distinct template_name values that match nothing                        16 of 23
  sum of adoption_count across all 113 seed rows TODAY                     9
```

The two counts of 144 were produced ~59 days apart by different code — the app's `.ok()` at write
time in June, my forward replay against today's catalog — which rules out "the catalog changed
since". **The nine templates this operator adopted 17 times each (`code-reviewer`, `docs-steward`,
`release-manager`, `security-sentinel`, `solution-architect`, …) all show `adoption_count = 0`**, and
`TrendingCarousel` sorts by `adoption_count DESC` (`reviews.rs:126`, `:515`). The trending shelf is
ordered by a number that is zero for 90% of what was installed.

**And the 10% that landed does not survive either.** Of the 16 resolving adoptions, **7 now read
`adoption_count = 0` and `last_adopted_at = NULL`** — `Scientific Writing Editor` has five logged
adoptions with `source_review_id` set on all five, and a counter of zero. The cause is two different
keys in the same pipeline:

- the seed **upsert** conflicts on `(test_case_name, test_run_id)` (`reviews.rs:222`, `:294`) — the
  **name**;
- the seed **prune** deletes `WHERE test_run_id = ? AND test_case_id NOT IN (…)` (`reviews.rs:363-393`)
  — the **id**.

Rename a template and the upsert does not conflict, so a new row is minted at zero; the prune cannot
reap the old one because its id is still active. **Both survivors are in the database right now:**

```
test_case_id                     test_case_name                  created_at
daily-standup-compiler           "Daily Standup Compiler"        2026-04-09   ← orphan
daily-standup-compiler           "Daily Personal Briefer"        2026-08-16   ← today's row
support-intelligence-use-case    "Support Intelligence Use Case" 2026-04-23   ← orphan
support-intelligence-use-case    "Support Intelligence"          2026-08-16   ← today's row
```

113 seed rows for 111 templates. **The repo's one genuine upstream-removal reconciliation cannot
remove the only two stale rows it has**, because the reaper's key is not the writer's key.

**160 adoptions → 16 counted → 9 still visible. 5.6%.**

### The version field exists in two catalogs and holds one constant in both

| | the field | live distribution | the comparison it was added for |
|---|---|---|---|
| **recipes** | `recipe_definitions.source_version`, rendered as `v{recipe.version}` (`RecipesTableResults.tsx:312`) | **`'1.0.0'` on 316 of 316 rows** — the seeder's literal fallback, `recipe_seed.rs:236` `seed.source_version.or_else(\|\| Some("1.0.0"))`, surfaced by `recipeAdapter.ts:390` `def.source_version ?? '1.0.0'` | `compareVersions(current, pinned) > 0` (`recipeStaleness.ts:57`) — **can never be true** |
| **skills** | frontmatter `version:`, `parse_skill_version(None) → (1, 0)` (`skill_files.rs:640-650`) | **0 of 15** user-library skills declare one; 17 of 35 repo skills declare `1.0` | `if src_v <= lib_v { refuse }` (`skill_files.rs:983`) — **refuses because the default equals the legal minimum** |

Replaying the publish guard over the real trees:

```
publish_skill_to_library, replayed over all 35 repo skills against the 15-skill library
  not in the library — publishes freely (an add)                21
  REFUSED: source not ahead of the library                      13   ← 13 of the 14 overlaps
  allowed as a version bump                                      1
  library skills carrying a parseable version:                   0 of 15
```

The guard is the best single idea in this document — it is the only place in six codebases that
refuses a catalog write because the version is not a bump, and its error message names the fix. It
**refuses 13 of 14 real upgrades**, not because the content is stale but because the destination has
no version and `None` defaults to `1.0`, which is the value `docs/skill-standard.md` tells authors
to start at. This is the contract's fifth §9 failure mode in its purest form: *a gate on reaching a
destination is only as good as the destination's defaults.*

### The one install-time baseline in the app is written on every install and read by nothing

`write_provenance` (`skill_files.rs:405-423`) stamps a sidecar into every installed skill:

```rust
let prov = SkillProvenance {
    source_kind, source_project_id,
    source_path: source_dir.to_string_lossy().into_owned(),
    content_hash,                                   // ← the hash of the SOURCE at install time
    installed_at: chrono::Utc::now().to_rfc3339(),
};
```

`grep -n 'content_hash' skill_files.rs` finds **zero reads of `prov.content_hash`**. The classifier
that answers *"has this changed?"* compares the two live hashes and never consults the baseline:

```rust
let installed_hash = hash_skill_dir(skill_dir);
let source_hash    = hash_skill_dir(Path::new(&prov.source_path));
let state = match (installed_hash, source_hash) {
    (Some(inst), Some(src)) if inst == src => SYNC_IN_SYNC,
    _ => SYNC_DIVERGED,                             // :436-448
};
```

Transliterated and executed over all 105 installed skill directories:

```
skill directories walked (15 roots)                              105
  carrying a provenance sidecar                                    4   (3.8%)
  → classify_sync_state says local_only ("you wrote this")       101
  → classify_sync_state says in_sync                               0
  → classify_sync_state says diverged                              4   (4 of 4)

the FOUR-WAY partition prov.content_hash makes available, and nothing reads:
  unchanged                                                        0
  LOCAL EDIT ONLY   (source untouched, installed copy edited)      3
  UPSTREAM MOVED ONLY                                              0
  both moved                                                       0
  SOURCE GONE       (installed copy PRISTINE, source deleted)      1
```

```
auto-invoicer/scan-code-optimizer
  at-install c51d8753…  source-now NULL  installed-now c51d8753…   ← byte-identical to what shipped
  app says: DIVERGED                     truth: the source directory no longer exists
politicas|brainiac|pumper /passport-onboard
  at-install 46dbec3d…  source-now 46dbec3d…  installed-now e0fafa10…/74791b43…
  app says: DIVERGED                     truth: the user edited the installed copy
```

**Four sidecars, one word, three different situations, and the word is wrong for the one copy that
is pristine.** 101 skills — including all 35 in this repo, every one of which came from the shared
library — report `local_only`, which the type's own doc comment glosses as *"no provenance sidecar —
hand-authored"* (`skill_files.rs:64`). And `skill_registry.origin` is `'authored'` on **74 of 74**
rows: the column exists with a vocabulary and the scanner's `INSERT` (`skill_usage.rs:175-181`) does
not list it.

### The two-layer template integrity check is one number checked twice

`templateCatalog.ts:1-13` documents *"Two-layer integrity verification… the backend (Rust) is
authoritative… much harder to tamper with."* Executed:

```
canonical templates on disk                                       111   (75 published, 36 is_published:false)
LAYER 1 (client, templateChecksums.ts)   pass 111 · missing 0 · mismatch 0
LAYER 2 (Rust, template_checksums.rs) over the SAME bytes layer 1 approved:
  disagreements                                                     0 of 111
```

Zero is not a health signal here — it is **structural**. `generate-template-checksums.mjs:144`
computes `checksums[rel] = computeContentHashSync(canonical)` **once** and writes the same map to
both files (`:172` TS, `:292` Rust); the two manifests are byte-identical over all 111 entries.
Layer 2 is then handed its input **by the layer it is checking** — `verify_template_integrity_batch`
takes `{path, content}` from the client (`template_adopt.rs:2126-2148`) and never reads the file —
and its verdict is discarded: `void import(...).then((m) => m.verifyTemplatesWithBackend())` at
`eventBridge.ts:1145` and `:1151`, with the failure arm being a `logger.error` and nothing else
(`templateCatalog.ts:381-386`). The Rust command's own docstring is honest about it: *"its caller
only logs it, so this detects tampering rather than preventing it"* (`template_adopt.rs:2135-2137`).

The hash is **cyrb53** — 53 bits, non-cryptographic, three byte-identical copies
(`generate-template-checksums.mjs:24`, `templateVerification.ts`, `template_checksums.rs:135-152`).

### The catalog inventory, both sides of the boundary

| catalog | baked | installed rows | identity an install keeps | version an install keeps |
|---|---|---:|---|---|
| **persona templates** | 111 JSON / 2.04 MB, 111 checksums ×2 | `persona_design_reviews` **113**, `personas` **78**, `adoption_log` **160** | `adoption_log.template_name` — an **id** in 144 rows, a **name** in 16 | **none.** 0 of 111 templates carry a version field |
| **recipes** | 299 (`_recipe_seeds.json` v1, ref `34f483f1f^`) | `recipe_definitions` **316** (315 builtin, 1 user, **17 not in the bundle**) | `(source_template_id, source_use_case_id)` ✅ | `source_version` = `'1.0.0'` × 316 |
| **connector definitions** | 134 (`builtin_connectors.rs`, 292 KB, generated) | **134**, `is_builtin = 1` on 134/134 | catalog `id` ✅ | none |
| **shared events** | **123** feeds + **0** firings | catalog **125** (2 from the scraper seed), firings **0**, subs **3** at cursor `0` | catalog `id` ✅ | none |
| **skills** | 35 repo + 15 library + **27 bundled (22 retired)** | **105** dirs, `skill_registry` **74** | sidecar `source_path` on **4 of 105**; `origin='authored'` 74/74 | sidecar `content_hash` — **never read**; registry `version` NULL 74/74 |
| **team presets** | 7 manifests | `persona_teams` **8** | none | none |
| **archetypes** | 9 (+5 memory strategies) | **0** — snapshot into the persona at creation | n/a (by design) | n/a |
| **builtin tools** | 13 | `persona_tool_definitions` **170** (10 builtin) | id | none |
| **playwright procedures** | AI-authored, no seed | **0** | — | — |

**Which catalogs are only ever read, and which can be written** — the brief's question, answered:

- **Read-only in practice, writable by the door:** `connector_definitions` — 134 of 134 `is_builtin=1`,
  **0 rows ever created with `is_builtin=0`** (reproducing `ai-draft-preview-apply` §7 D8), and yet
  `update_connector` / `delete_connector` (`commands/credentials/connectors.rs:41-61`) consult
  `is_builtin` **nowhere**. `updateConnector` has **zero call sites in 4,829 files**
  (`src/api/auth/connectors.ts:20` is the only occurrence) and `deleteConnector` has exactly one, a
  rollback of a just-created custom row (`useCredentialDesign.ts:122-126`).
- **Read-only and never written:** `playwright_procedures` (0 rows), `shared_event_firings` (0 rows).
- **Writable and written:** `recipe_definitions` (`update_recipe` / `delete_recipe`,
  `commands/recipes/crud.rs:108-137`, **no `is_builtin` guard**, and `RecipeCard.tsx:115-146` offers
  edit and delete on every row including all 315 builtins), and the skill files
  (`skill_files_write`, `skill_files.rs:1213`).
- **Not a catalog table at all:** archetypes, which are snapshotted into the persona at creation and
  keep no row — a deliberate design stated in `archetype_catalog.rs:14-17`, and the only catalog in
  the app with **no drift question**, because there is nothing to drift.

### And one catalog ships an empty shelf

`shared_event_catalog` holds **125** browsable feeds. `BUILTIN_SHARED_EVENT_FIRINGS` is
`&[]` — the generator's input, `scripts/events/connector-events.ledger.json`, has been
`{"version":1,"firings":[]}` (36 bytes) since **2026-07-07**. `shared_event_firings`: **0 rows**.
Three live subscriptions sit at `last_cursor = '0'` with `events_relayed = 0`. The user can browse
123 feeds and subscribe to any of them; the shipped ledger has never carried one item.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and everything else is downstream of it.** **A catalog entry and an installed copy
> of it are two different objects, and the link between them must be the entry's stable id — never
> its display name, never its filesystem path.** A name is what the item is *called*; an id is what
> it *is*. The moment one component keys on the name and another keys on the id, every mechanism
> that has to reconcile them — a counter, a badge, a prune, an upsert — is correct for one of them
> and silently wrong for the other.
> *Warrant: measured here — one function bumps a counter `WHERE display_name = ?` while its main
> caller passes the id, so 144 of 160 installs incremented nothing and the app's own audit column
> recorded the miss 144 times; and the seed pipeline's upsert keys on the name while its prune keys
> on the id, which leaves stale rows the reaper cannot see and mints fresh zeroed rows on every
> rename. Both are the same defect wearing two hats.*
>
> **P2 — physics.** **An installed copy must record WHICH VERSION of the entry it came from, at
> install time, in a field.** Not the current version of the entry — that changes under you. The
> value as it stood the moment the copy was made. Without it, "the user edited this" and "the
> catalog moved on" are the same observation, and no amount of hashing separates them afterwards.
> *Warrant: executed — the one place in this app that stamps an install-time baseline writes it to a
> sidecar that nothing reads, and its classifier answers with one word for four distinct situations;
> replayed over every installed copy, the word is wrong for the one copy that is byte-identical to
> what shipped. And a sibling repo implements exactly this and is the only one of six that can
> answer the question.*
>
> **P3 — physics, and it is the trap.** **A version field whose default equals its legal minimum
> cannot be compared.** Adding the column is not the work; making it carry distinct values is. A
> comparison against a constant is a comparison that is always false, and it fails in the safe
> direction — silently, reporting "nothing to update" forever — which is why it survives review.
> *Warrant: two independent instances in one repo. A recipe catalog with a version column, a version
> chip, a pinned version, a comparator and an Update badge, whose column holds `'1.0.0'` on 316 of
> 316 rows. A publish guard that refuses a write unless the version is a bump, whose absent-version
> default is `1.0` — the value the standard tells authors to start at — and which therefore refuses
> 13 of 14 real upgrades.*
>
> **P4 — physics.** **Installing is a projection, and a projection needs a reaper.** Writing each
> catalog item into the destination is half of the job; the other half is deciding what happens to
> destination entries the catalog no longer contains. If nothing reconciles, a retired item is
> immortal in every install and in every shipped bundle — and the failure is invisible, because
> nothing ever *does* anything wrong.
> *Warrant: measured — 22 of the 27 skill directories this repo's installer would ship were retired
> 13 days before the sweep and are still there, because the mirror script writes each destination it
> is about to fill and prunes none; and the one seeder in the tree that does have a reaper hand-codes
> a single `DELETE` for one retired item, by id, in a comment that explains itself.*
>
> **P5 — ergonomics with teeth.** **"Already installed" must be answered from a stored link, not
> recomputed from a resemblance.** A badge that decides by matching names is answering a different
> question than the one the user asked, and it is wrong in both directions — it claims an install
> that was somebody else's, and misses one after a rename.
> *Warrant: of the twelve browse surfaces here, five show no installed state at all, four decide it
> by name-set membership, and the three that use a stored link are the three that behave. The
> strongest of the three is a toggle, where re-install is unrepresentable.*
>
> **P6 — security, and it inverts the effort.** **Integrity effort follows what is easy to hash, not
> what is dangerous to run.** The catalog whose items are inert data gets two verification layers;
> the catalog whose items are instructions an agent will execute gets none. Ask what the item *does*
> when installed, and put the verification there.
> *Warrant: measured here — 111 template JSON files (data) carry a 111-entry checksum manifest
> embedded twice; 105 installed skill directories, whose contents are read and followed by a coding
> agent with filesystem and shell access, carry no manifest at all, and the app has a write door
> into them.*
>
> **P7 — ergonomics.** **A verification layer that is fed its input by the thing it verifies is a
> receipt, not a check.** Independence is about the *input path*, not the language, the process or
> the binary. Two copies of one number, compared over bytes one party supplied, is one check.
> *Warrant: executed — 0 disagreements of 111 between two "independent" manifests generated from a
> single hash call; the second layer receives `{path, content}` over IPC from the first and never
> opens the file; its verdict is discarded at both call sites, which the server command's own
> docstring states.*
>
> **Scale condition.** P1 bites on the second entry point — the first caller and the writer agree by
> construction because one person wrote both. P2 and P3 bite the first time the catalog ships a
> second version of anything. P4 bites the first time something is retired, which is later than you
> think and long after anyone would look. P5 bites at the first rename. P6 and P7 bite once, at the
> only moment that matters.

---

## 1. Trigger

- "Ship a library of starter X the user can browse and install with one click."
- "Add a template / preset / skill / connector / recipe to the catalog."
- "Show a checkmark on the ones they've already got."
- "They edited their copy — how do we tell them ours changed?"
- "We renamed a template. What happens to the installs?"
- "We're retiring these six presets."

**If you are about to write** a `for` loop over a `BUILTIN_*` constant with an `INSERT OR IGNORE`
in it; a `new Set(catalog.map(x => x.name))` that decides an "installed" badge; an
`UPDATE … WHERE name = ?` in a boot-time seeder; an `install(itemId, overwrite: bool)` door; a
`cpSync(src, dst, { recursive: true })` that mirrors a shipped directory; or a schema for an
installed row that has a `source_id` and no `source_version` — **you are in this situation.**

### Boundaries with the adjacent leaves

- [**`dry-run-preview`**](./dry-run-preview.md) owns **the claim made before the action**. This owns
  **the item and its lineage**. They meet at `skill_files_install_preview`, which is that path's
  exemplar defect and this path's §7 D2 for a different reason: its unremovable files are what makes
  the installed copy permanently `diverged`.
- [**`ai-draft-preview-apply`**](./ai-draft-preview-apply.md) owns **an artifact a model authored**;
  this owns **an artifact the app shipped**. Its P3 asks *did anyone record that a machine wrote
  this*; this path's P2 asks *did anyone record which shipped version this is a copy of*. Same
  column-shaped answer, opposite provenance question.
- [**`untrusted-definition-validation`**](./untrusted-definition-validation.md) owns **a definition
  from outside**. A catalog item is from *inside*, which is exactly why it is validated less; §0's
  P6 is that inversion measured.
- [**`codegen-task-registration`**](./codegen-task-registration.md) owns **whether the generated
  artifact is fresh**. This owns **whether it is still supposed to exist** — a different question,
  and §7 D1 is a case where the answer is no and the freshness check is green.
- [**`entity-draft-editing`**](./entity-draft-editing.md) owns **the user's unsaved work**. An
  installed catalog item that the user has since edited is *both* — and P2 is what lets you tell.

## 2. The one way

**Give every catalog entry a stable id and a version, key every write, badge, prune and upsert on
that id, and stamp `(entry_id, entry_version, installed_at)` onto the installed row at install
time — then answer every later question by comparing against the stamped version, never by hashing
two live copies.** Concretely: (a) **the entry's id is the only join key** — the display name is
presentation, and any `WHERE name = ?` in an install path is a bug waiting for a rename; if a
function takes the entry's identity, name the parameter after what it holds and make the two callers
unable to disagree. (b) **Stamp the version at install, in a column**, beside the id — the version
as it was, not a pointer to what it is now. (c) **Make the version's absent-value distinct from its
minimum**: `Option<Version>` with `None` meaning *unknown*, never a default that collides with the
first legal value, or the comparison you built it for is dead on arrival. (d) **Reconcile the
destination on every projection** — after writing the N entries, decide the fate of everything in the
destination that is not one of them (delete it, tombstone it, or mark it `missing_since`), and use
the same key you wrote with. (e) **Answer "already installed" from the stamped link**, not from a
name set, and prefer a control where re-install is unrepresentable (a toggle) over one that is
merely guarded. (f) **Decide, per catalog, which fields the catalog owns and which the user owns**,
write that split down at the seeder, and refresh only the catalog's half — the alternative is either
clobbering edits every boot or freezing the catalog forever. (g) **Verify integrity where the item
is dangerous, not where it is easy** — and if you ship two layers, make the second one read the
artifact itself, not bytes the first layer hands it. (h) **Act on the verdict or delete the layer**;
a check whose result is `logger.error` is a check that tells the attacker and nobody else. Then stop:
do not add a second identity column, do not let the reaper and the writer key on different things,
and do not ship a version field you cannot make vary.

If you must get one right first: **(a)**. Every other clause in this document is a consequence of
one component keying on the name and another keying on the id.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/commands/infrastructure/skill_files.rs:930-1007` — `publish_skill_to_library` | **the version-guarded catalog write, and the best single idea in this document.** `if src_v <= lib_v { return Err(…) }` with an error string that names the fix: *"A publish must be a version bump — apply the improvement, bump `version:` in SKILL.md, then publish."* Copy the shape; fix the default first (§7 D3). |
| `src-tauri/src/commands/infrastructure/skill_usage.rs:225-245` — `reconcile_scope`'s tail | **the reaper, done right, and the only one in the tree that is not hand-maintained.** After the write loop it stamps every row of that scope whose name is `NOT IN` the seen list with `missing_since = COALESCE(missing_since, datetime('now'))`, under a comment that states the semantics: *"a removed skill must never read as 'dormant', it reads as gone."* This is §2(d). |
| `src-tauri/src/engine/recipe_seed.rs:105-296` — `seed_recipes_from_bundle` / `insert_one` | **the field-ownership split, written down.** Its module docstring names exactly which two keys the catalog owns (`model_override`, `model_rationale`) and states that *"every other `prompt_template` field (incl. user edits) is preserved untouched."* Executed over the live database: 170 of 299 byte-identical, 124 differing only in the tier keys, **5 with real content drift, all preserved**. This is §2(f), and it is the only seeder in the app that got it right. |
| `src-tauri/src/engine/recipe_seed.rs:118-123` — `EXPECTED_SEED_VERSION` | **the bundle-shape gate**: a version on the *bundle*, checked before anything is written, failing fast rather than mis-mapping fields. |
| `src-tauri/src/commands/infrastructure/skill_files.rs:401-423` — `write_provenance` + `SkillProvenance` | **the install-time stamp**, already built, already carrying `content_hash` and `installed_at`. It is 90% of P2; the missing 10% is a reader (§7 D4). |
| `src/lib/personas/templates/templateCatalog.ts:128-217` — `loadAndVerify` | **the browse-side loader to copy**: checksum → shape validation → **id-collision refusal** (`CatalogIntegrityError`), each skip carrying a typed `CatalogSkipReason`, surfaced by `getTemplateCatalogStatus()` as a four-state `ok \| partial \| empty \| failed`. It is the only catalog loader in the app that distinguishes *empty-but-healthy* from *everything-failed*. |
| `src/lib/personas/templates/validateTemplate.ts` | **the shape validator that runs AFTER the checksum**, with the reason stated at `:41-52`: a checksum alone trusts whatever shape the JSON has, because the developer's own regen blesses it. |
| `src/features/triggers/sub_shared/SubscribeControls.tsx:21-33` | **the install control where re-install is unrepresentable.** One `toggle` over `!!subscription`, keyed on the catalog entry's **id** (`useSharedEvents.ts:89-93`). This is §2(e) and the only surface in the app with no re-install question to answer. |
| `src/features/templates/sub_recipes/libs/useAdoption.ts:56-74` | **the idempotent adopt**: the duplicate check runs *inside* the queued mutator, so two clicks cannot race it, and the second attempt warns rather than duplicating. |
| `src/features/plugins/fleet/sub_skills/SkillInstallModal.tsx:79-92` | **the caller that reads the install outcome** — `if (result.installed) … else if (result.reason === 'exists') { warn; setOverwrite(true) }`. One of two in the tree that branch on the answer (§9). |
| `src/lib/personas/templates/seedTemplates.ts:113-126` + `db/src/repos/communication/reviews.rs:363-393` | **the client-side reaper.** Right idea, wrong key — see §7 D5. Copy the structure, not the predicate. |

**Do NOT build:** a second identity column; an `UPDATE … WHERE display_name = ?` in an install path;
a version field whose absent-value equals its first legal value; an "installed" badge from a
`Set` of names; a projection loop with no reaper; a second integrity layer fed by the first;
a `logger.error` as the entire response to a failed integrity check.

## 4. Steps

1. **Give the catalog entry an id and a version before you write the loader.** The id is stable
   across renames; the version changes whenever the content does. Both are in the artifact, not
   derived from its path or its title.
2. **Design the installed row's provenance columns at the same time** — `source_entry_id`,
   `source_entry_version`, `installed_at`. Adding them later means backfilling from nothing: 78
   personas and 160 adoption rows here can never be resolved to a version, because none was ever
   recorded.
3. **Write the loader: verify, validate, refuse collisions, and report what you dropped.** Copy
   `templateCatalog.ts:128-217`. A catalog that silently serves 109 of 111 is worse than one that
   fails.
4. **Write the projection AND its reaper in the same function**, keyed on the same column. If you
   cannot delete (a shared destination, user data), stamp `missing_since` — `reconcile_scope` is the
   pattern.
5. **Decide, in writing, which fields the catalog owns.** Put the list in the seeder's docstring like
   `recipe_seed.rs` does. Refresh only those; never a blanket `SET` of everything you happen to have.
6. **Ask whether the type can make the wrong call impossible — before writing the gate.** Here it
   can, twice; see below.
7. **Build the install door to return an outcome that distinguishes *installed* from *already
   there*** — and make the caller unable to ignore it (§9).
8. **Badge from the stored link.** If the surface can be a toggle, make it a toggle.
9. **Put the integrity check where the item is dangerous**, act on its verdict, and if you ship a
   second layer make it read the artifact from disk itself.
10. **And then stop.** Do not add an `adoption_count` that a second code path also has to maintain;
    derive it from the ledger. Do not add a "force reinstall" without a version comparison to make it
    meaningful.

### Can the type make the wrong call impossible? — asked before §9

**Yes, twice, and both edits delete a whole family.**

**(1) The name/id confusion is a newtype problem, and it is live.** The defect in §0 is not that
someone wrote the wrong `WHERE` clause; it is that `template_name: String` accepted a
`template_id: String` at one of two call sites, and the function next to it logged
`template_id = %template_name` on the same value one line earlier. Two `String`s cannot disagree.

```rust
// The dangerous freedom is that the id and the name are the same type.
pub struct CatalogEntryId(String);        // private field — construct only from the catalog
pub struct CatalogEntryName(String);      // presentation; never a join key

pub fn increment_adoption_count(pool: &DbPool, entry: &CatalogEntryId, persona_id: Option<&str>)
```

Held against the seven qualifications
([doctrine §1](../golden-path-doctrine.md#1-prefer-a-type-over-a-gate--and-the-seven-qualifications)):

- **Q1 — a type carries only what it encodes.** Honest limit, and it is the sharp one: `CatalogEntryId`
  makes the *argument* unmistakable and does **nothing** about the `WHERE test_case_name = ?` inside
  the SQL string. That is [doctrine §1's "inside a SQL string literal"](../golden-path-doctrine.md#where-types-cannot-reach)
  exactly. The type moves the error from *"the caller passed the wrong thing"* to *"the query joins
  on the wrong column"*, which is a smaller and more visible bug — but it does not delete it. **The
  column change is the fix; the newtype is what stops it coming back.**
- **Q2 — requiredness ≠ closedness.** The win is closedness. `template_name: String` is already
  required and required nothing useful.
- **Q3 — a type nobody constructs constrains nothing.** Survives: there are 160 live rows written
  through this door and two callers, and the catalog is the only legitimate construction site — which
  is what makes a private field workable here.
- **Q4 — a type anyone can construct authenticates nothing.** Decisive, and the reason the field must
  be private: `CatalogEntryId(template_name.clone())` at the call site reproduces the bug verbatim.
  Construct it in the catalog loader and nowhere else.
- **Q5 — withholding beats requiring.** The dangerous freedom is *handing an install path a display
  name at all*. Withhold it: `increment_adoption_count` has no use for the name and should not be
  able to see one.
- **Q6 — withhold the dangerous freedom, not the answer.** The answer is *which entry* — keep that.
  Withholding the id (an install door that takes only a persona id) breaks the feature.
- **Q7 — withholding a requirement helps only where the requirement forced the bad value.** Nothing
  forced `template_adopt.rs` to pass the id; it is simply what that function had in hand under a
  name-shaped parameter. So the fix is the type, not a widened signature.

**(2) The version default is an `Option` problem, and it is the cheaper edit.** `parse_skill_version(None) → (1, 0)`
and `source_version.or_else(|| Some("1.0.0"))` both collapse *unknown* into *the first legal value*.

```rust
// NOT: fn parse_skill_version(v: Option<&str>) -> (u32, u32)   // None -> (1,0)
fn parse_skill_version(v: Option<&str>) -> Option<(u32, u32)>   // None stays None

match (src_v, lib_v) {
    (Some(s), Some(l)) if s <= l => refuse("not a bump"),
    (None, _) | (_, None)        => refuse("cannot compare: declare a version first"),
    _                            => allow(),
}
```

The consequence is the point: the guard stops silently answering *"not a bump"* to a question it
could not evaluate, and starts saying *"I cannot tell"* — which is a different sentence and a
different fix for the user. Same edit on the recipe side: `source_version: Option<String>` with no
`'1.0.0'` fallback makes the 316 constant rows read `NULL`, and `computeStaleRecipeIds`'s existing
`if (!pinned) continue` already handles that correctly and honestly.

**And one destination needs fixing before either gate points at it** (contract, fifth §9 failure
mode). Routing callers to the install-outcome door is worth little while
`increment_adoption_count`'s own predicate cannot match 90% of what reaches it, and while the badge
those callers feed is sorted by a counter that is zero for the nine most-installed templates.
**Fix the join key first.**

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **An install path keyed on the display name** | Every rename orphans the link, and a second caller passing the id silently no-ops. Executed: 144 of 160 adoptions incremented nothing; `source_review_id` NULL on the same 144. `reviews.rs:623-627`. §7 D6. |
| **A writer and a reaper on different keys** | The reaper cannot see what the writer created. Upsert on `(test_case_name, test_run_id)` (`reviews.rs:222`), prune on `test_case_id NOT IN (…)` (`reviews.rs:378-385`): 113 rows for 111 templates, and the two orphans are exactly the two renamed templates. §7 D5. |
| **A version field defaulted to its own minimum** | The comparison is always false and fails in the safe direction, so nothing ever looks. `'1.0.0'` × 316; `parse_skill_version(None) → (1,0)` refusing 13 of 14 upgrades. §7 D3, D7. |
| **A projection loop with no reaper** | A retired item is immortal. 22 of 27 bundled skills retired 2026-08-04, still in the installer's resource dir and already copied into `target/debug/skills`. `scripts/sync-system-skills.mjs:39-49`. §7 D1. |
| **One hand-written `DELETE` as the retirement mechanism** | It works exactly once, for the item somebody remembered. `db/src/lib.rs:1797-1800` deletes `builtin-local-scraper` by id, with a comment explaining the retirement — and nothing generalises it. |
| **A boot-time refresh that `SET`s every field it has** | The user's edit to an installed item is reverted every launch, silently. `UPDATE connector_definitions SET label, icon_url, fields, healthcheck_config, metadata, category, services, events, resources … WHERE name = ? AND is_builtin = 1` (`db/src/lib.rs:1826-1832`). §7 D8. |
| **`INSERT OR IGNORE` as the whole idempotency story** | Deleting a builtin is undone at the next launch and nothing says so. Same site. |
| **An install-time baseline nobody reads** | Two opposite situations get one word. 4 sidecars, 4 × `diverged`, 3 local edits and 1 pristine-with-a-dead-source. `skill_files.rs:405-448`. §7 D4. |
| **An "installed" badge from a `Set` of names** | Wrong in both directions — claims someone else's install, misses one after a rename. `ownedServiceTypes.has(connector.name)` (`usePickerFilters.ts:66`), `installedNames.has(entry.name)` (`skillsManagerRows.ts:94`), `installedByProject.get(pid)?.has(skillName)` (`useSkillsRegistry.ts:198`). §7 D9. |
| **A second integrity layer fed by the first** | 0 disagreements of 111, structurally. `verify_template_integrity_batch(templates: Vec<{path, content}>)` never opens a file. §7 D10. |
| **A `logger.error` as the response to a failed integrity check** | The verdict is discarded at both call sites (`eventBridge.ts:1145`, `:1151`); the tampered template stays in the catalog, because layer 1 already admitted it. §7 D10. |
| **Discarding the install door's outcome** | The app reports success for an install that wrote nothing. `RegistryTab.tsx:79-81`, `skillsManagerRows.ts:134-135`, against `SkillInstallModal.tsx:83-92` which branches. §9. |
| **A counter maintained beside the ledger that already has the answer** | Two sources of truth for one number, and they are 160 vs 9. `adoption_count` vs `adoption_log`. §7 D6. |
| **Integrity effort on the inert catalog, none on the executable one** | 111 data files carry a 111-entry manifest twice; 105 directories of agent instructions carry none, and the app can write into them. §7 D11. |

## 6. Evidence

**The one site to copy: `src-tauri/src/commands/infrastructure/skill_usage.rs:225-245` — the reaper.**

```rust
    // Rows of this scope no longer on disk become history (stamped once) — a
    // removed skill must never read as "dormant", it reads as gone.
    let placeholders = if seen.is_empty() { "''".to_string() }
        else { seen.iter().map(|_| "?").collect::<Vec<_>>().join(",") };
    let sql = format!(
        "UPDATE skill_registry SET missing_since = COALESCE(missing_since, datetime('now'))
         WHERE scope = ?1 AND COALESCE(project_id,'') = ?2 AND name NOT IN ({placeholders})"
    );
```

Four decisions worth copying: (1) the projection loop and the reconciliation are **in the same
function**, so you cannot ship one without the other; (2) `COALESCE(missing_since, …)` stamps
**once**, so the row records when it went missing rather than when you last noticed; (3) it marks
rather than deletes, because the destination holds user history the catalog does not own; (4) the
`seen` list is built from the same walk that did the writing, so the reaper's key is provably the
writer's key — the property §0 shows the template pipeline lacks.

**And the guard to copy, `skill_files.rs:983-995`:**

```rust
if src_v <= lib_v {
    return Err(AppError::Validation(format!(
        "publish refused: the project copy of `{skill_name}` declares version {} but \
         the library already carries {}. A publish must be a version bump — apply the \
         improvement, bump `version:` in SKILL.md, then publish.", …)));
}
```

Refusing a catalog write on a version comparison is a thing **no other repo in the fleet does**. Copy
it, and fix the `None → (1,0)` default in the same edit or it refuses everything (§7 D3).

**Also exemplary:**

- `src-tauri/src/engine/recipe_seed.rs:3-52` — the module docstring that enumerates the catalog's
  owned fields and states the idempotency contract, including *why* content drift is deliberately
  left alone. Executed against 316 live rows it does exactly what it says.
- `src/lib/personas/templates/templateCatalog.ts:190-207` — refusing to serve a catalog that cannot
  be addressed by id, with the cross-platform reasoning in the comment (*"silent last-wins dedupe
  depends on glob ordering which differs between Linux and Windows"*).
- `src/features/triggers/sub_shared/SubscribeControls.tsx:21-33` — install state as a toggle over the
  catalog entry's id. There is no re-install bug because there is no re-install.
- `src/features/templates/sub_presets/PresetPreviewModal.tsx:85-183` + `usePresetAdoption.ts:110-198`
  — the richest install preview in the app: a team graph, per-member selection, live progress and a
  **partial-failure retry** (`retryTeamPresetMembers`) that re-adopts only the members that failed.
  It passes `(presetId, overrides, roles)` — an id and a delta, never the manifest.
- `src-tauri/engine/src/archetype_catalog.rs:14-17` — the catalog that deliberately keeps no rows:
  *"unlike recipes, archetypes need no per-install rows — the persona snapshots everything it uses at
  creation time."* Naming a snapshot as a snapshot removes the drift question instead of answering
  it badly.

### Convergence — see §6.1

## 7. Deviations

Every entry is live on `master` @ `2a874e692` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database. **Per the campaign's no-destructive-applies rule
these are notes, not asks** — every fix below changes a schema, a seeded row, a shipped bundle or
what a live browse surface renders.

### D1 — P0. 22 of the 27 skills the installer ships were retired on 2026-08-04

`scripts/sync-system-skills.mjs:39-49`:

```js
for (const name of SYSTEM_SKILLS) {
  const dst = path.join(dstRoot, name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
}
```

It removes each destination **it is about to write** and nothing else. `src-tauri/resources/skills`
holds **27** directories; `SYSTEM_SKILLS` resolves to **5** (`passport-onboard`, `project-populate`,
`i18n-translate`, `ship-milestone`, plus the `scan-*` dirs discovered from `.claude/skills`, of which
exactly one — `scan-sweep` — still exists). The other **22** are the single-lens `scan-*` skills whose
retirement is documented in the Rust allowlist:

> *"The 22 single-lens scan-\* skills were retired 2026-08-04 — the sweep is the only scan entry
> point."* — `skill_files.rs:241-243`

Their directory mtimes are all `Aug 4 17:56`; the five live ones are `Aug 15 21:43`. `tauri.conf.json:130`
maps `"resources/skills": "skills"` into the bundle, and Tauri has already copied all **27** into
`src-tauri/target/debug/skills`. The Rust `SYSTEM_SKILLS` allowlist prevents installing them through
`skill_files_install_system`, so the live blast radius is the bundle size and one stranded install
(§7 D4) — but the *catalog* ships 81% retired content.

**Fix (note):** prune `dstRoot` to `SYSTEM_SKILLS` before the copy loop. It is a three-line change to
a build script and it changes what the installer contains.

### D2 — P0. The skills install preview's "removed" count is exactly what makes the copy permanently `diverged`

`dry-run-preview` §7 D2 established that `skill_files_install_preview` reports `removedCount`,
rendered as *"{n} removed"* by `SkillInstallModal.tsx:143-152`, while `copy_dir_recursive`
(`skill_files.rs:327-345`) only creates and overwrites — **8 of 14 shared skills would claim 16 files
removed and 0 will be.** Confirmed, and extended:

The files that survive are not merely leftovers. `hash_skill_dir` walks the whole target directory,
so every unremoved file is in the installed hash and **not** in the source hash. `classify_sync_state`
therefore returns `diverged` **immediately after a successful install**, for a copy the installer just
made. The preview's "removed" number and the badge's "diverged" state are the same defect measured at
two moments.

**Fix (note):** the fix `dry-run-preview` proposes — delete the preview command and give
`install_skill_copy` a `dry_run: bool` computed by the walk that copies — closes both, provided the
copy also reconciles the destination (P4).

### D3 — P0. The version guard refuses 13 of 14 real upgrades, and the reason is its own default

`skill_files.rs:640-650`:

```rust
/// Parse a canonical "major.minor" version into comparable numbers. `None` or
/// unparseable → `(1, 0)` — the implicit version of a pre-standard skill.
pub(crate) fn parse_skill_version(v: Option<&str>) -> (u32, u32) { … }
```

Replayed over the real trees (transliterated `extract_frontmatter_value` → `extract_skill_version` →
`parse_skill_version`, byte-length semantics preserved):

```
repo skills                                    35   (17 declare a parseable version)
user library skills                            15   ( 0 declare a parseable version)
overlap (in both)                              14
  REFUSED — source not ahead                   13
  allowed as a bump                             1
```

Every library copy evaluates to `(1, 0)`; `docs/skill-standard.md`'s starting version is `1.0`; and
the guard is `src_v <= lib_v`. **A source at the standard's first version can never publish over an
unversioned library copy.** The guard is correct, its message is excellent, and it is unreachable.

**Fix (note):** `parse_skill_version -> Option<(u32,u32)>` and a three-arm match that refuses
*"cannot compare"* separately from *"not a bump"* (§4). It changes the outcome of a live door.

### D4 — P0. `prov.content_hash` is written on every install and read nowhere

`write_provenance` (`skill_files.rs:405-423`) stamps it; `grep 'content_hash' skill_files.rs` returns
**zero reads of `prov.content_hash`**. `classify_sync_state` (`:433-448`) compares the two *live*
hashes instead, so it cannot distinguish:

| truth | what the app says | live count |
|---|---|---:|
| the user edited the installed copy | `diverged` | **3** |
| the catalog moved on | `diverged` | 0 |
| both moved | `diverged` | 0 |
| **the copy is pristine and the source is gone** | `diverged` | **1** |
| no sidecar at all | `local_only` — *"hand-authored"* (`:64`) | **101** |

The pristine case is `auto-invoicer/scan-code-optimizer`: installed hash `c51d8753…` equals the
recorded install-time hash exactly, and `prov.source_path` is
`\\?\C:\…\.claude\worktrees\scanner-skills\src-tauri\target\debug\skills\scan-code-optimizer` — a
**deleted git worktree's build output**. It is a D1 skill, installed before the retirement, untouched
since, reported as drifted. And the identity it kept is an **absolute filesystem path**, which is the
one thing about a catalog item guaranteed not to survive.

**Fix (note):** three-way classify against `prov.content_hash` (`in_sync` / `locally_edited` /
`upstream_changed` / `both`), and record `source_kind + entry_id + version` instead of an absolute
path. It changes what the Fleet drawer's badge says on four rows today, and on every future install.

### D5 — P1. The seed reaper's key is not the seed writer's key

Upsert: `ON CONFLICT(test_case_name, test_run_id)` (`reviews.rs:222`, `:294`).
Prune: `WHERE test_run_id = ?1 AND test_case_id NOT IN (…)` (`reviews.rs:363-393`).

A renamed template does not conflict → a new row at `adoption_count = 0`; the old row's
`test_case_id` is still active → the prune cannot reach it. Live: **113 rows for 111 templates**, the
two extras being `daily-standup-compiler` ("Daily Standup Compiler" → "Daily Personal Briefer",
created 2026-04-09) and `support-intelligence-use-case` ("Support Intelligence Use Case" →
"Support Intelligence", 2026-04-23). Both appear twice in the gallery today under two names.

`DO UPDATE SET … created_at = excluded.created_at` also means every seed row's `created_at` is
rewritten on every launch — 111 of 113 read `2026-08-16`, which is why the "New" heuristics on
catalog cards cannot be trusted either.

**Fix (note):** conflict on `(test_case_id, test_run_id)`, add the unique index, and drop
`created_at` from the update set. It rewrites live gallery rows.

### D6 — P1. The adoption counter and the adoption ledger disagree 160 to 9

Fully derived in §0. The three numbers, all replayed:

```
adoption_log rows                                      160
increments the predicate could have made                16   (10.0%)
adoption_count still visible in the gallery today        9   ( 5.6%)
adoption_log.persona_id pointing at a live persona      63   of 160  (97 dangling; no FK on the column)
```

`adoption_log(id, template_name, source_review_id, persona_id, adopted_at)` has **no template id, no
template version, and no foreign key**. `personas` has no `source_template_id` column at all —
`template_category` is the closest thing and it is a category. So for 78 personas the question *"which
catalog entry, at which version, is this a copy of"* is **unanswerable and unbackfillable**, exactly
as `ai-draft-preview-apply` §7 found for model authorship.

**Fix (note):** pass the id, join on the id, add `template_id`/`template_version` to `adoption_log`,
and derive `adoption_count` from it rather than maintaining a second copy. Schema migration plus a
changed browse surface.

### D7 — P1. The recipe catalog's entire version apparatus rests on a constant

Three independent reasons the "Update" chip (`RecipesTableResults.tsx:262-268`,
`RecipeDetailHeader.tsx:80-93`) can never render:

1. **`source_version` is `'1.0.0'` on 316 of 316 rows** — `recipe_seed.rs:236`'s
   `.or_else(|| Some("1.0.0"))`, surfaced by `recipeAdapter.ts:390`'s `?? '1.0.0'`. Every row of the
   browse table shows `v1.0.0`.
2. **`recipeToUseCase` never pins a version.** `useAdoption.ts:238-240` writes
   `source_recipe_id: recipe.id` under a comment claiming *"future republish flows reconcile against
   the source"*, and `isRecipeStale` bails one line in: `const pinned = …source_recipe_version; if
   (!pinned) return false;` (`recipeStaleness.ts:39-40`). Only the promote/Foundry lane pins it
   (`build_sessions.rs:1278-1323`).
3. **Nothing has ever been adopted.** Live: **0 of 118** use cases across 75 personas carry a
   `source_recipe_id`; **0 of 2,188** `persona_executions` carry `source_recipe_id` or
   `source_recipe_version`; `persona_recipe_links` holds **0** rows.

The best-designed install-state UI in the app — an Adopted chip, an Update chip, a version column, a
staleness comparator with a written rationale for its conservative bail, and a `{from, to}` tooltip —
sits on top of a column with one value and a code path that has never run.

**Fix (note):** `source_version: Option<String>` with no fallback; pin `source_recipe_version` in
`recipeToUseCase`. Changes what every row of the recipe table displays.

### D8 — P1. The connector seeder reverts user edits every launch and resurrects deletions

`db/src/lib.rs:1802-1834`, per connector, on every boot:

```sql
INSERT OR IGNORE INTO connector_definitions (…) VALUES (…, 1, ?13, ?13);
UPDATE connector_definitions
   SET label=?1, icon_url=?2, fields=?3, healthcheck_config=?4, metadata=?5,
       category=?6, services=?7, events=?8, resources=?9, updated_at=?10
 WHERE name = ?11 AND is_builtin = 1;
```

- The `INSERT` keys on `id`; the `UPDATE` keys on **`name`**, which has no unique index
  (`connector_definitions` carries only the PK autoindex and `idx_cd_category`). It is safe today
  only because all 134 baked names happen to be distinct — a measured property of the data, not a
  constraint.
- Nine fields are overwritten unconditionally. `update_connector` / `delete_connector`
  (`commands/credentials/connectors.rs:41-61`) have **no `is_builtin` guard**, so an edit is legal
  and silently reverted at the next launch; a delete is silently undone by the `INSERT OR IGNORE`.
- Retirement is one hand-written `DELETE` for one id (`lib.rs:1797-1800`, `builtin-local-scraper`,
  with a comment explaining why). There is no general mechanism, and no other retired connector would
  be caught.

Contrast `repos/resources/recipes.rs:106-116`, in the same tree, which withholds `is_builtin` from
`CreateRecipeInput` *"so user-facing create paths can't mint builtin rows"* — the right instinct,
applied to create and not to update or delete.

**Fix (note):** key the refresh on `id`; add the `is_builtin` guard to the update/delete doors;
enumerate catalog-owned fields the way `recipe_seed.rs` does. Changes what a boot writes.

### D9 — P2. Four browse surfaces decide "installed" by name, five show nothing at all

Of **twelve** client browse surfaces:

| decision rule | surfaces |
|---|---|
| **a stored link to the catalog entry** ✅ | shared-events toggle (`useSharedEvents.ts:89-93`, by entry id); recipe Adopted chip (`RecipesBrowseList.tsx:49-52`, by `source_recipe_id` — correct, and dead per D7); preset per-member progress (live events) |
| **name-set membership** ⚠ | connector "Connected" (`usePickerFilters.ts:66`, `ownedServiceTypes.has(connector.name)` against credentials' `service_type`); skills board (`skillsManagerRows.ts:94`); skills heatmap (`useSkillsRegistry.ts:198`); skill sync badge (hash compare, D4) |
| **nothing** | templates gallery; team presets; Explore; onboarding picker; Skills Workbench adopt lane |

The templates gallery's only install-adjacent number is `adoption_count`, which is D6.

**Fix (note):** badge from the stored link. For templates that requires D6's schema change first.

### D10 — P2. The second integrity layer cannot disagree with the first, and its verdict is dropped

Measured in §0: one `computeContentHashSync` call populates both manifests
(`generate-template-checksums.mjs:144` → `:172` and `:292`); all 111 entries are byte-identical
across the two files; layer 2 is fed `{path, content}` by layer 1 and never opens a file; both call
sites `void` the result (`eventBridge.ts:1145`, `:1151`); the failure arm is a `logger.error`. The
Rust command says so itself at `template_adopt.rs:2135-2137`.

What layer 2 *does* add is real but narrow: the manifest lives in the binary, so an attacker who
tampers with a template **and** regenerates `templateChecksums.ts` is caught — provided they leave
the call in place. An attacker who edits the bundle deletes the call.

The hash is cyrb53 — **53 bits**, non-cryptographic, three byte-identical implementations.

**Fix (note):** have the Rust side read the file from disk itself, and act on the verdict (drop the
template from the catalog, not just log). It changes what the gallery shows under tampering, and it
changes app startup behaviour.

### D11 — P2. The executable catalog has no integrity manifest and a write door

111 template JSON files — inert data, adopted into rows — carry a 111-entry checksum manifest
embedded **twice**. 105 installed skill directories — whose `SKILL.md` is read and followed by a
coding agent with filesystem and shell access — carry **no manifest against anything**;
`skill_registry.content_hash` records what the file *is*, never what it *should be*. And
`skill_files_write` (`skill_files.rs:1213-1247`) lets the app overwrite any file inside
`.claude/skills` (it refuses *new* files and canonicalizes against traversal, which is good, and does
not help here).

Reported, not fixed: the correct answer is a manifest for the bundled system skills — the 5 the app
itself dispatches — since those are the ones with a shipped source of truth. The user's own library
legitimately has none.

### D12 — P3. Two catalogs have never been exercised, and one ships an empty shelf

- `connector_definitions`: **0 rows with `is_builtin = 0`** — reproducing `ai-draft-preview-apply`
  §7 D8 exactly, two weeks and one composer later.
- `playwright_procedures`: **0 rows.**
- `shared_event_firings`: **0 rows.** 125 browsable feeds, 3 live subscriptions at `last_cursor = '0'`,
  `events_relayed = 0`, and `scripts/events/connector-events.ledger.json` has been
  `{"version":1,"firings":[]}` (36 bytes) since 2026-07-07.
- `recipe_definitions`: **17 rows are not in the shipped bundle** (16 of them `is_builtin = 1`),
  derived from three email templates by an earlier path. The seeder's key
  (`source_template_id`, `source_use_case_id`) cannot see them as stale, because it only ever asks
  whether a *bundle* entry is present — never whether a *row* is still shipped. That is P4's reaper,
  missing from the one seeder that is otherwise exemplary.

### The measurement that could not be made

*How many installed items in this database are behind the catalog?* **There is no such query.** For
78 personas, 160 adoptions, 134 connector definitions, 125 shared-event feeds, 8 teams and 170 tool
definitions, the version of the catalog entry at install time was never recorded. Of the two stores
that record anything, one holds a constant (`source_version = '1.0.0'` × 316) and the other writes to
a file with no reader (4 sidecars, 0 reads). The question is not unanswered — it is **unanswerable,
permanently, with no backfill possible**, for every catalog in the app.

## 8. Gaps

1. **There is no catalog abstraction.** Nine catalogs, nine loaders, nine install doors, nine
   provenance answers (six of which are "none"). Nothing in the tree names the concept: no
   `CatalogEntry` trait, no shared `install(entry, target)`, no shared reconcile. Each of P1–P5 is
   re-derived per catalog, and five of nine get P1 wrong.
2. **No catalog artifact carries a content version.** Templates have `schema_version` (a *shape*
   version, `3`) and no content version; connectors and shared events have none; skills have an
   optional frontmatter `version:` that 18 of 35 repo skills and 15 of 15 library skills omit. §2(b)
   is not implementable today for six of the nine without adding a field to the artifact format.
3. **`adoption_log` cannot be repaired from what it holds.** 144 rows carry a slug, 16 carry a
   display name, in one `TEXT` column with no discriminator, and 97 point at deleted personas with no
   FK. A migration can classify the 160 by matching both catalogs — but it cannot recover which
   *version* was installed, which is the field that matters.
4. **`tokenMaps.ts` has no category for an install state.** Its ten categories are execution, event,
   automation, severity, priority, healing_status, healing_category, connector_status, test, dev.
   `local_only | in_sync | diverged` is a closed vocabulary with no shared door, and D4's three-way
   split would add a fourth value with nowhere to live. **This is the fourth leaf to want one
   category table** (`ai-draft-preview-apply` §8 Gap 4 counted three).
5. **The census cannot assert any of this path's four largest findings.** "This install records no
   version", "this reaper's key is not the writer's key", "this sidecar field has no reader", "these
   22 directories should not be here" are all **absences**, and the census ratchets presences.
   §9 gates a fifth, smaller thing, and says so.
6. **`hash_skill_dir` cannot be used to compare against a manifest, only against another directory.**
   It hashes the destination's whole tree, so a target with an extra file can never equal its source —
   which is why D2 and D4 are the same defect. A per-file manifest hash would separate "the source's
   files differ" from "the target has extras".
7. **Nothing in the app can enumerate "installs of catalog entry X".** Skills: walk 15 project
   directories and read sidecars. Templates: a `TEXT` column with two vocabularies. Connectors: the
   row *is* the install. There is no reverse index, so "we are retiring X — who has it?" has no
   answer at any of the nine catalogs.

## 9. The missing gate

**The condition, stated stack-free:** *a catalog install door reports whether the item was actually
installed, and the caller discards that answer and tells the user it was.*

This is deliberately **not** the largest finding in the document — the largest are absences (§8 Gap 5)
and the census cannot express them. It is the largest *countable* one, it is client-side, and it is
the one place where the same door is called correctly in some files and incorrectly in others, which
is what makes a ratchet meaningful.

**The signal (a proxy, and stated as one):** a call to one of this repo's catalog install/adopt doors
appearing as a **bare statement** — `await`/`void` with the returned outcome bound to nothing. The
door vocabulary is **derived from the tree, not from imagination** (doctrine §2): every
`export const` / `export async function` in `src/api/**` whose body invokes a Tauri command matching
`adopt_*` / `*_install*` / `*_subscribe` / `promote_build_draft` / `create_adoption_session` /
`retry_team_preset_members`, filtered to those that install a **shipped catalog item** into live
state. That extraction yielded 16 candidates; 8 survived the catalog filter. **An adopting repo must
re-derive its own door set** — the condition is *"is the outcome that says 'nothing happened'
consulted"*, not the token `installSkill`.

**The mechanism: a census rule.** The runner already exists and implements the fail-loud contract, so
this path writes no script.

**Where it executes:** `npm run census:check` is part of `npm run check`, and it is the
**`golden-path-census` pre-push job** in `lefthook.yml`. Per this batch's calibration `ci.yml` is red
on 10 pre-existing failures, so **a gate that only runs in CI runs nowhere.** This one fails the push.

**Precision 8/8 on the stated condition; 6 of 8 can produce a wrong claim today. Every match opened
and read.**

| match | what is discarded | is it a defect |
|---|---|---|
| `RegistryTab.tsx:79` `if (isPresetSkill(skill)) await installSystemSkill(skill, projectId, false)` | `SkillInstallResult` — then `addToast(…skills_registry_adopted…, 'success')` at `:81`, unconditionally | **yes** — `overwrite: false`, so `{installed:false, reason:"exists"}` is reported as a successful adopt |
| `RegistryTab.tsx:80` `else await installSkill(skill, null, projectId, false)` | same | **yes**, same toast |
| `skillsManagerRows.ts:134` | `addToast(…skills_preset_installed…, 'success')` at `:135` | **yes**, same shape in a second file |
| `skillPlacement.ts:54` / `:56` (`dispatchSkillToRepo`) | the JSDoc at `:33-35` documents `overwrite: false` as a supported mode, and `:44-45` claims *"Rejects (propagating) if the install or the spawn fails, so callers can surface the error"* — which is **false for the `exists` outcome**: it does not reject, it proceeds to dispatch a Fleet session against a stale or missing copy | **yes**, ×2, and the docstring is contradicted |
| `workspaceStore.ts:164` (`installPresetSkills`) | its docstring says *"Existing skills are left untouched"*, so the outcome is deliberately unused — but nothing can report "0 of N presets landed" vs "N of N" | **latent** — deliberate, and unreportable |
| `PassportActionsRow.tsx:135` `installSystemSkill('project-populate', raw.project.id, true)` | `overwrite: true`, so `installed` is always true or it throws; `file_count` is dropped | **latent** — safe only because a boolean literal happens to be `true` |

The two `latent` rows are the shape `ai-draft-preview-apply` §7 D4 named: *"live blast radius today:
0 — that is also exactly the kind of latency that makes a defect ship."* One `?? true` changed to
`?? false` converts both.

**The gate and its control partition the anchor exactly:**

| | matches | files |
| --- | ---: | ---: |
| **anchor** — a catalog install door named anywhere in `src/` | **22** | |
| ↳ **violating** — called as a bare statement, outcome dropped | **7** | 5 |
| ↳ **compliant** — outcome bound, returned, or handed to a caller (the control) | **9** | 8 |
| ↳ neither — 2 door definitions, 2 comments, 2 test-bridge method declarations | 6 | |

7 + 9 + 6 = 22, with no remainder. The control's 9 include `SkillInstallModal.tsx:79` (the site that
branches on `result.installed` and primes `overwrite` on `exists`), `usePresetAdoption.ts:142,192`
(which read `res.members` to drive per-member progress and a partial retry),
`useSharedEvents.ts:72` (which puts the returned subscription into state), and
`useLifecycle.ts:263` (`const result: PromoteBuildResult = await promoteBuildDraft(`).

**Existing rules checked for overlap first — 18 of them, by re-running each neighbour's committed
pattern through the census engine's own scanner and intersecting `file:line` sets. All 18 reproduced
their committed baselines exactly, which is also the instrument's own check.**

| neighbour rule | its files / matches | site overlap | file overlap |
|---|---:|---:|---:|
| `unverifiable-catalog-lookup` | 5 / 7 | **0** | 0 |
| `bindingless-catch-on-io` | 84 / 122 | **0** | 0 |
| `discarded-toast-copy` | 49 / 94 | **0** | 0 |
| `unsolicited-failure-as-toast` | 15 / 18 | **0** | 0 |
| `unverified-clipboard-write` | 22 / 32 | **0** | 0 |
| `read-failure-as-empty-value` | 32 / 68 | **0** | 0 |
| `unchecked-destination-id-assertion` | 19 / 54 | **0** | 0 |
| `asserted-definition-blob` | 15 / 16 | **0** | 0 |
| `unconsented-irreversible-door` | 12 / 12 | **0** | 0 |
| `unaddressable-agent-spawn` | 6 / 6 | **0** | **1** (`RegistryTab.tsx`, its line 100 vs my 79/80) |
| `module-scope-install-latch` | 13 / 13 | **0** | **1** (`workspaceStore.ts`, its line 52 vs my 164) |
| `verdict-write-outside-door` · `snapshot-replace-rollback` · `absent-entity-count-as-zero` · `staged-verdict-map-collapsed` · `hand-rolled-stale-token` · `estimate-typed-as-measurement` · `unwired-url-open-door` | 6/8 · 2/9 · 30/40 · 3/3 · 36/42 · 11/20 · 40/46 | **0** | 0 |

`unverifiable-catalog-lookup` is the nearest by name and shares nothing: it keys on a translation
catalog cast to `Record<string, string>` — a *label* lookup, not a *content* install.
**Site overlap is 0 with all 18; file overlap is 1 file of 5 with two of them, at unrelated lines.**

**Disclosed recall gaps — four, all structural:**

1. **A `.then()` chain instead of `await`.** `SkillLibraryDrawer.tsx:187` passes the promise into a
   ternary; it happens to be compliant, but the pattern would score zero on a violating one.
2. **A door reached indirectly** — `data.wb?.runAdopt(name)` dispatches an LLM Dev-runner task that
   writes skill files without going through `install_skill_copy` at all. That lane needed
   `skill_files_stamp_provenance` (`skill_files.rs:1019`) built specially for it, and the gate cannot
   see it.
3. **The whole Rust half.** Every finding in §7 D1, D5, D8 and D12 is server- or build-side and
   invisible here. **The count can reach zero while every one of them stands.**
4. **It cannot assert an absence** — which is what P2, P4 and §8 Gap 5 are about. *"This install
   records no version"*, *"this reaper's key is not the writer's key"*, *"this sidecar field has no
   reader"* are the three sharpest findings in this document and all three are ungateable by
   counting. All three were found by **running** something.

**How it fails loudly if its own precondition is absent** — verified by deliberately breaking the
rule, nine ways:

```
baseline (gate 5f/7m, control 8f/9m, 4829 walked)  -> exit 0
floor 9000 > 4829 walked                           -> exit 1   (matcher/root broken, not codebase clean)
gate pattern matches zero files                    -> exit 1
CONTROL pattern matches zero files                 -> exit 1
stale exclude entry                                -> exit 1
baseline too LOW (a rise)                          -> exit 1
baseline too HIGH (a silent drop)                  -> exit 1
baseline ON the positive control                   -> exit 1   (validateRule rejects a control with a baseline)
moved root                                         -> exit 1
```

```json
{
  "rules": [
    {
      "id": "unread-catalog-install-outcome",
      "goldenPath": "docs/concepts/golden-paths/catalog-browse-and-apply.md",
      "title": "A catalog install/adopt door is called as a bare statement, so the outcome that says whether the item was actually installed is discarded and the caller proceeds — and reports — as if it was",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?<!=\\s)(?<!>\\s)(?<!return\\s)(?<![({,]\\s)\\b(?:await|void)\\s+(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?(?:installSkill|installSystemSkill|adoptTeamPreset|retryTeamPresetMembers|instantAdoptTemplate|createAdoptionSession|promoteBuildDraft|subscribeFeed)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A call to one of this repo's eight CATALOG install/adopt doors appearing as a BARE STATEMENT - `await`/`void` with the returned outcome bound to nothing, returned to nobody, and handed to nobody. PROXY FOR the stack-free condition: a catalog install door reports whether the item was actually installed, and the caller discards that answer and tells the user it was. THE DOOR VOCABULARY IS DERIVED FROM THE TREE, NOT FROM IMAGINATION (doctrine section 2): every `export const` / `export async function` under src/api/** whose body invokes a Tauri command matching adopt_* / *_install* / *_subscribe / promote_build_draft / create_adoption_session / retry_team_preset_members was extracted mechanically (16 candidates), then filtered to the 8 that install a SHIPPED CATALOG ITEM into live state - dropping adoptOffspring (a lab result), cloudAdoptDeployment (a cloud deployment), installHooks / subscribeTerminal / startSetupInstall / cancelSetupInstall / artistInstallBlenderMcp (not catalogs), previewInstallSkill (a preview) and promoteUseCaseToRecipe (publishes INTO the catalog, the reverse direction). THE FOUR FIXED-LENGTH LOOKBEHINDS ARE THE DISCRIMINATOR and they are fixed-length on purpose (doctrine forbids variable-length lookbehind after one cost 73 seconds): (?<!=\\s) drops `const res = await installSkill(`, (?<!return\\s) drops `return await devApi.installSkill(` at fleet/sub_skills/useSkillData.ts:107, (?<!>\\s) drops an arrow-body `=> await`, (?<![({,]\\s) drops an argument position. AN EARLIER DRAFT ANCHORED ON THE PRECEDING CHARACTER INSTEAD ([\\n;{}]|\\)|\\belse\\b) and had to be abandoned: the match then STARTS on the previous line, so ignoreCommentLines - which classifies by the line of match.index - would silently drop any hit whose preceding line is a comment. MEASURED 2026-08-17 at 2a874e692: 7 matches across 5 of 4829 .ts/.tsx files, EVERY ONE OPENED AND READ. PRECISION 8/8 ON THE STATED CONDITION; 6 of 8 can produce a wrong claim today. THE SEVEN: (1)+(2) plugins/dev-tools/sub_skills/registry/RegistryTab.tsx:79,80 - `if (isPresetSkill(skill)) await installSystemSkill(skill, projectId, false); else await installSkill(skill, null, projectId, false);` followed at :81 by an UNCONDITIONAL addToast(skills_registry_adopted, 'success'); overwrite is false, so the backend's `{installed:false, reason:\"exists\"}` (skill_files.rs:797-804) is reported to the user as a successful adopt and the heatmap cell flips. (3) plugins/dev-tools/sub_skills/skillsManagerRows.ts:134 - same shape, same unconditional success toast at :135, second file. (4)+(5) teams/sub_factory/passport/skillPlacement.ts:54,56 inside dispatchSkillToRepo - `overwrite ?? true`, and the option's own JSDoc at :33-35 documents `false` as a supported mode ('Pass false to preserve an already-installed (possibly customized) copy'), while the function's docstring at :44-45 claims 'Rejects (propagating) if the install or the spawn fails, so callers can surface the error and re-enable their trigger' - WHICH IS FALSE FOR THE `exists` OUTCOME: it does not reject, it proceeds to dispatch a Fleet session against a stale or missing copy. (6) plugins/dev-tools/sub_workspaces/workspaceStore.ts:164 in installPresetSkills - LATENT: its docstring says 'Existing skills are left untouched', so the outcome is deliberately unused, but nothing can then report '0 of N presets landed' versus 'N of N'. (7) teams/sub_factory/passport/PassportActionsRow.tsx:135 - LATENT: overwrite is the literal `true`, so `installed` is always true or the call throws; only file_count is dropped. The two latent rows are the shape ai-draft-preview-apply section 7 D4 named - live blast radius 0, converted to a real defect by one `?? true` becoming `?? false`. THE GATE AND ITS CONTROL PARTITION THE ANCHOR EXACTLY: 22 anchor occurrences in src/ = 7 violating + 9 compliant (the control) + 6 neither (2 door definitions in src/api, 2 comments, 2 test-bridge method declarations). ZERO SITE-LEVEL OVERLAP with all 18 neighbouring rules re-measured by re-running their committed patterns through the census engine's own scanner (not assumed) - all 18 reproduced their committed baselines exactly: unverifiable-catalog-lookup (5/7, nearest by NAME and disjoint in fact - it keys on a translation-catalog cast to Record<string,string>, a LABEL lookup, not a content install), bindingless-catch-on-io (84/122), discarded-toast-copy (49/94), unsolicited-failure-as-toast (15/18), unverified-clipboard-write (22/32), read-failure-as-empty-value (32/68), unchecked-destination-id-assertion (19/54), asserted-definition-blob (15/16), unconsented-irreversible-door (12/12), verdict-write-outside-door (6/8), snapshot-replace-rollback (2/9), absent-entity-count-as-zero (30/40), staged-verdict-map-collapsed (3/3), hand-rolled-stale-token (36/42), estimate-typed-as-measurement (11/20), unwired-url-open-door (40/46), plus unaddressable-agent-spawn (6/6) and module-scope-install-latch (13/13) which each share ONE FILE at unrelated lines (RegistryTab.tsx:100 vs my :79/:80; workspaceStore.ts:52 vs my :164) and zero sites. FOUR DISCLOSED RECALL GAPS, all structural: (1) a .then() chain instead of await - SkillLibraryDrawer.tsx:187 passes the promise into a ternary and scores zero here; (2) a door reached INDIRECTLY - the LLM adopt lane (skillsWorkbenchData.ts:181-204) writes skill files through a Dev-runner task without going through install_skill_copy at all, which is why skill_files_stamp_provenance (skill_files.rs:1019) had to be built for it; (3) THE ENTIRE RUST HALF IS INVISIBLE - this golden path's four largest deviations are server- or build-side (22 of 27 bundled skills retired 2026-08-04 and still shipped because scripts/sync-system-skills.mjs:39-49 rm's each destination it is about to write and prunes none; the seed upsert keying on test_case_name while the seed prune keys on test_case_id; the connector seeder's blanket 9-field UPDATE ... WHERE name = ? AND is_builtin = 1 at db/src/lib.rs:1826-1832; 17 recipe rows the seeder can never see as stale) and THE COUNT CAN REACH ZERO WHILE EVERY ONE OF THEM STANDS; (4) it cannot assert an ABSENCE, which is what this leaf's P2 and P4 are about - 'this installed row records no version of what it was installed from', 'this reaper's key is not the writer's key', 'this install-time hash has no reader' are the three sharpest findings in the document and all three were found by RUNNING something, replayed against read-only copies of the operator's live databases and the real filesystem: 144 of 160 adoption_log rows would match ZERO persona_design_reviews rows under increment_adoption_count's own WHERE test_case_name = ? (db/src/repos/communication/reviews.rs:623-627) because commands/design/template_adopt.rs:604 passes the template ID under a parameter named template_name whose own tracing field one line up at :230 reads template_id, and the app's OWN source_review_id column is NULL on exactly the same 144; the gallery's adoption_count totals 9 while the ledger holds 160; prov.content_hash is written by write_provenance (skill_files.rs:405-423) on every install and read ZERO times, so classify_sync_state returns 'diverged' for all 4 sidecars on this machine covering 3 local edits and 1 copy that is byte-identical to what shipped whose source directory was deleted, while 101 of 105 installed skill directories report 'local_only' which the type's own doc comment glosses as 'hand-authored'; and recipe_definitions.source_version is the literal '1.0.0' on 316 of 316 rows so compareVersions(current, pinned) > 0 (recipeStaleness.ts:57) can never be true. PRECONDITION (must be re-derived per repo): this proxy keys on a repo where every catalog install crosses a named TypeScript wrapper around a Tauri command and returns a result object carrying an installed/reason discriminator. A repo whose install is an HTTP POST whose 200-vs-409 distinction lives in a status code, an ORM upsert whose `created` flag is a tuple element, or a shell-out whose answer is an exit code, has the SAME condition wearing markup this pattern cannot see and scores a structural zero. The condition to re-derive is 'IS THE ANSWER THAT SAYS NOTHING HAPPENED CONSULTED BEFORE THE USER IS TOLD SOMETHING DID', not the token installSkill. LEGAL FIX, in order: (1) bind the result and branch on it - src/features/plugins/fleet/sub_skills/SkillInstallModal.tsx:79-92 is the shape to copy, `if (result.installed) { success toast; close } else if (result.reason === 'exists') { warning toast; setOverwrite(true) }`, which turns the no-op into a second, informed confirm; (2) where the caller genuinely does not care, say so in the signature rather than at the call site - a door that cannot fail to install needs no outcome, and one that can must not be callable as a statement; (3) longer term make the outcome unignorable by returning a value the caller must destructure, which is the client half of this path's section 4 type. Do NOT silence a match by wrapping the call in a helper that returns void (that hides it from the rule without changing what the user is told), or by moving it into a .then() chain (recall gap 1). END OF LIFE: this rule is designed to reach zero - all 7 are bindable and the compliant form exists in this tree at 9 sites across 8 files. When it does, the runner fails structurally on zero matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "exclude": [],
      "baseline": { "files": 5, "matches": 7 },
      "floor": 4000
    },
    {
      "id": "unread-catalog-install-outcome-positive-control",
      "goldenPath": "docs/concepts/golden-paths/catalog-browse-and-apply.md",
      "title": "POSITIVE CONTROL - the same eight catalog install doors whose outcome IS bound, returned, or handed to a caller",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "(?:=|\\breturn|\\?|:)\\s*(?:await\\s+)?(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?(?:installSkill|installSystemSkill|adoptTeamPreset|retryTeamPresetMembers|instantAdoptTemplate|createAdoptionSession|promoteBuildDraft|subscribeFeed)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "CONTROL, not a gate. The IDENTICAL eight catalog install doors as unread-catalog-install-outcome, in the COMPLIANT form: the call sits in a value position - assigned (`const res = await adoptTeamPreset(`), returned (`return await devApi.installSkill(`), or handed to a caller through a ternary (`installName ? installSkill(...) : Promise.resolve(null)`) - so the outcome that distinguishes 'installed' from 'already there' survives the call. Exists to prove the gate discriminates on WHETHER THE ANSWER IS CONSULTED rather than on the presence of an install call: measured 2026-08-17 at 2a874e692 it matches 9 times across 8 files against the gate's 7 across 5, AND THE TWO PARTITION THE ANCHOR EXACTLY - 7 violating + 9 compliant + 6 neither (2 door definitions in src/api, 2 comments, 2 test-automation bridge method declarations) = 22, the total number of occurrences of these eight names in 4,829 .ts/.tsx files. So 44% of the call sites read the answer and 56% do not. THE NINE, and what each does with the answer: SkillInstallModal.tsx:79 (`const result = await onInstall(targetId, overwrite)`) branches at :83-92 on result.installed and, on `exists`, warns and PRIMES setOverwrite(true) so a second confirm replaces - the exemplar, and the reason the same door called from RegistryTab.tsx is a defect rather than a style difference; usePresetAdoption.ts:142 and :192 read res.members to drive per-member progress rows and a PARTIAL-FAILURE RETRY (retryTeamPresetMembers re-adopts only the failed members); useSharedEvents.ts:72 (`const sub = await api.subscribeFeed(entryId)`) puts the returned subscription into the map that decides the Subscribed toggle, which is why that surface has no re-install bug at all - re-install is unrepresentable there; useLifecycle.ts:263 (`const result: PromoteBuildResult = await promoteBuildDraft(`); useDevCloneAdoption.ts:33 (`const result = await instantAdoptTemplate('Dev Clone', designResultJson)`); ChronologyAdoptionView.tsx:1079 (`const sessionId = await createAdoptionSession(`); fleet/sub_skills/useSkillData.ts:107 (`return await devApi.installSkill(...)`) - hands the outcome up to SkillInstallModal, which is the one that reads it; SkillLibraryDrawer.tsx:187 - the ternary that feeds the same modal; test/automation/bridge.ts:2247. A MATCH HERE IS NOT A CERTIFICATE: binding the value is necessary and not sufficient - useSkillData.ts:107 only helps because its consumer branches, and a caller that binds `result` and never reads `result.installed` would land here while having the condition. Carries NO baseline BY CONSTRUCTION: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs exempts a -positive-control id from the baseline requirement; verified by deliberately adding one, which exits 1). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if unread-catalog-install-outcome falls while this stays flat, an install call was DELETED rather than given a reader, and the ratchet would otherwise have recorded that as progress. If this control's count ever collapses toward the gate's, the shared door vocabulary has broken - most likely because an api wrapper was renamed - and BOTH numbers are meaningless; that is the failure this control exists to make visible."
      },
      "exclude": [],
      "floor": 4000
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private scratch
registry, filename unique to this composer because siblings share the scratchpad>`, never against the
shared `rules.json`, and **the full registry was not run** (doctrine §4). The runner reports
**7 matches / 5 files** for the gate and **9 / 8** for the control over **4,829** `.ts`/`.tsx` files
walked against a floor of **4,000**, and `--check` exits **0** at the declared baseline.
**Re-extracted from this finished document and re-run, with identical counts.**

### The type, alongside the ratchet

The gate counts one shape in one language. Four things it cannot reach, in descending importance:

- **The join key is not a type at all where it matters.** `WHERE test_case_name = ?` is a word inside
  a SQL string literal ([doctrine §1](../golden-path-doctrine.md#where-types-cannot-reach), item 1).
  The `CatalogEntryId` newtype in §4 makes the *argument* unmistakable and leaves the *column* alone.
  **Change the column; add the newtype so it cannot drift back.**
- **The version default is a one-line `Option` change and it unblocks two catalogs.**
  `parse_skill_version -> Option<(u32,u32)>` and dropping `?? '1.0.0'` turn two always-false
  comparisons into two honest three-state ones. This is the cheapest fix in the document.
- **Fix the reader before ratcheting the writers** (contract: *a gate on reaching a destination is
  only as good as the destination's defaults*). Routing install callers to read their outcome is
  worth little while the badge they feed is sorted by a counter that is zero for the nine
  most-installed templates.
- **A second, different instrument is owed for P4.** *"Does every projection of a catalog reconcile
  its destination"* is an absence over a pair of statements, which the census cannot express. The
  right shape is a **test**: seed a catalog with N entries, project it, remove one entry, project
  again, and assert the destination no longer serves it. No such test exists for any of the nine
  catalogs here, and `scripts/sync-system-skills.mjs` would fail it today with 22 rows.

## 12. Corrections to the brief

Recorded per [doctrine §7](../golden-path-doctrine.md#7-corrections-are-the-deliverable).

### 12.1 — `sides: "client"` is wrong for the fifth time, and this time the answer is in a build script

The brief carried `sides=client`. Measured: the two P0s in §7 are a **Node build script**
(`sync-system-skills.mjs`, 22 stale directories in the installer bundle) and a **Rust seeder pair**
(`reviews.rs`'s upsert-on-name / prune-on-id). The headline defect is a **Rust `WHERE` clause**. The
best primitive in the document is **Rust** (`reconcile_scope`). The exemplar guard is **Rust**
(`publish_skill_to_library`). The unreadable baseline is **Rust** (`prov.content_hash`).

What is genuinely client-side is the *population*: 12 browse surfaces, 9 of which show install state
wrongly or not at all — and the census rule that survived. So `client` is not merely wrong, it is
**half right in the least useful way**: it points at where the symptom is visible and away from every
answer.

**This is the fifth leaf to report `sides: "client"` contradicted by its own measurement**
(`ai-draft-preview-apply` §12.1 counted four, all four finding the answer on the server). At five for
five the doctrine's *"anti-correlated with where the answer lives"* now has a fifth data point, and
this one adds a wrinkle worth recording: **the answer was not on the "server" either — it was in a
build script and a `.gitignore`d directory**, which neither value of a two-valued field can name.
Recommend the orchestrator drop `sides` from briefs entirely rather than keep flipping it.

### 12.2 — `convergence: mixed` — see §6.1

### 12.3 — a correction offered upward to a neighbouring path composed the same day

[`codegen-task-registration`](./codegen-task-registration.md) §9's rule description names
`scripts/sync-system-skills.mjs` as one of three **legal fixes** for generated-artifact staleness:

> *"or generate into a destination git does not track, which deletes the whole condition
> (`scripts/sync-system-skills.mjs` writes the gitignored `src-tauri/resources/skills`)."*

**Measured, that destination has 22 stale directories in it right now**, retired 2026-08-04, already
copied into `target/debug/skills`, and mapped into the installer by `tauri.conf.json:130`. Being
untracked deletes the *drift* condition — git cannot report a diff on a file it does not track — and
it deletes the *visibility* with it. The staleness did not go away; it became unobservable, which is
strictly worse than a stale tracked file that `git status` would have shown.

Offered as a strengthening, not a contradiction: that path's clause should read *"generate into a
destination git does not track **and reconcile it on every run**"* — because an untracked destination
is the one case where nothing else can notice. Its own P3 (*a generator only holds the line if
something runs it*) has a sibling: **a mirror only holds the line if something prunes it.**

### 12.4 — "Skills install reports 16 files removed and removes 0 — extend it." Extended, and the extension is that the same files are why nothing is ever `in_sync`

Confirmed as stated. The extension is that `dry-run-preview` framed this as a **preview-fidelity**
defect and it is also an **identity** defect: `hash_skill_dir` covers the whole target tree, so the
unremovable files put the installed copy permanently out of hash-equality with its source, and
`classify_sync_state` — the only install-state signal the skills catalog has — therefore reports
`diverged` for a copy the installer just wrote. Live: **0 of 105 installed skill directories are
`in_sync`**, and 0 of the 4 that could be. One defect, two surfaces, and the second one is the badge
the user reads.

### 12.5 — "connector_definitions has 0 rows with is_builtin=0 and playwright_procedures has 0 rows — ask which catalogs are only ever read and which can be written." Asked, and the framing needed inverting

Both counts reproduce exactly. But *"read-only vs writable"* turned out to be the wrong axis, because
**the two do not line up**: `connector_definitions` is the catalog with **zero** user-authored rows
and it is also the one whose update and delete doors have **no `is_builtin` guard at all**
(`commands/credentials/connectors.rs:41-61`) — the most locked-down *data* behind the least locked-down
*door*. Meanwhile `recipe_definitions` is edited and deleted freely through the UI on all 315 builtin
rows, and its seeder is the one that carefully preserves user edits.

The axis that actually predicts behaviour is **whether the seeder's refresh is selective**:
`recipe_seed.rs` names the two fields the catalog owns and preserves everything else (measured: 5
drifted rows preserved); `seed_builtin_connectors` overwrites nine fields every boot. Being
"read-only" is a property of *nobody having tried*, not of the design. The brief's question implied
the risk was foreign content entering a catalog; measured, the risk is the **catalog overwriting the
user**, and only one of the nine seeders has thought about it.

### 12.6 — "measure whether a checksum is ever verified at install time or only at build time" — the answer is neither, and the interesting part is why "twice" is once

Measured: **at catalog load, not at install** — `instant_adopt_template`'s removal of a re-check is
correct and documented, as [`untrusted-definition-validation`](./untrusted-definition-validation.md)
§7.I established. The brief's binary (build time vs install time) missed the case that is actually
there.

The finding the question led to is different and better: **the two layers are one check.** One
`computeContentHashSync` call at `generate-template-checksums.mjs:144` populates both manifests; they
are byte-identical over 111 entries; layer 2 is handed `{path, content}` by layer 1 and never opens a
file; both call sites discard the verdict. Executed: **0 disagreements of 111, structurally
impossible to have any.** This is doctrine §2's *"codegen guarantees the two mirrors agree with each
other, not that either agrees with reality"* arriving in a **security** control rather than a
generated artifact — the first time in the corpus, and the reason P7 is stated separately from P6.

### 12.7 — "scan-agents-to-skills.mjs skips existing outputs unless --force, so its staleness is structurally unreachable" — true, and it is the smaller half of the story

Confirmed at `scan-agents-to-skills.mjs:403-405`. But the generator's *output* directory is
`.claude/skills/scan-sweep` — one skill, currently fresh in every respect that matters. The 22
retired directories are not its unreachable staleness; they are `sync-system-skills.mjs`'s missing
prune, in a **different** directory, from a **different** script, and they would exist even if
`scan-agents-to-skills.mjs` had a `--check` mode.

The brief treated these as one lead. They are two, and the one it named is the harmless one.

### 12.8 — a correction to my own instrument

My first draft of the §9 pattern anchored on the character *preceding* the `await`
(`(?:[\n;{}]|\)|\belse\b)\s*(?:await|void)\s+…`) so it could reject `return await` and `= await`
without a variable-length lookbehind. It produced the right counts and it was wrong, for a reason the
doctrine already names: **the match then starts on the previous line**, and
`scripts/census/lib/engine.mjs:190` classifies a match by `lineOf(match.index)`. Any violating call
whose preceding line is a comment would have been silently dropped as a comment match — the same
family as the `#[cfg(` comment that moved `build-gated-ipc-entrypoint` from 127 to 126, recorded in
that file's own comment at `:200-208`.

The fix is four **fixed-length** lookbehinds (`(?<!=\s)`, `(?<!>\s)`, `(?<!return\s)`,
`(?<![({,]\s)`) so the match starts at `await`, on the line the reader will act on. Counts were
unchanged; correctness was not. **A pattern that produces the right number today and is positioned
one line early is a pattern that will produce the wrong number the first time someone adds a
comment.**
