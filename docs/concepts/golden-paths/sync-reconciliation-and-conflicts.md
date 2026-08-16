# Golden path — Sync reconciliation and conflicts

> Situation node: `integrations-security/vault-security/sync-reconciliation-and-conflicts` ·
> [situation spine](../situation-spine.md) · recurrence 10 · risk **HIGH** ·
> sides: **client** · `twoSided: true` · convergence: **mixed** ·
> dimensions: function · resilience · ui · security ·
> merged from *External vault sync and conflict* · *Import conflict resolution* ·
> *Local/remote reconcile*
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep size.** All **963** `.rs` files under `src-tauri` (exactly `rust.files`
> in [`shared-facts.json`](../shared-facts.json)) and the `.ts/.tsx` tree. Every
> reconciliation surface in the repo was enumerated and read, not sampled: the
> cloud-sync writer (`src/cloud/sync/**`, 4 files), the remote-command reader
> (`src/cloud/remote_commands.rs`), the Obsidian vault bridge
> (`src/commands/obsidian_brain/**`, 6,145 lines), the p2p manifest mirror
> (`engine/src/p2p/manifest_sync.rs`), the import/export bundle
> (`src/commands/core/data_portability.rs`), the device-pairing registry
> (`db/src/repos/resources/owned_devices.rs`), and their five frontend halves.
>
> **Measured by execution, not by reading.** Read-only copies of the live
> `personas.db` (347 MB) and `personas_data.db` (17 MB) were taken and queried.
> The headline defects — the tombstone table with no producer, the two dead
> cross-device columns, the sync that has never run — were all found by querying
> the running installation's data, and none of them is visible from the code
> alone: every one compiles, type-checks, and passes `npm run check`. The
> repo's own `redact_secrets` predicate (`rows.rs:45-70`) was **ported to
> JavaScript and replayed over every synced column of every live row**, and
> that replay is what inverted the brief (§12.3).
>
> **`cargo` was not run** (the operator's app is running). Every Rust claim is
> static and traces to a file opened during composition.
>
> ---
>
> ## The headline: the mechanism that detects divergence exists, is excellent, and is 40 files away from the path that needs it
>
> This repo contains **seven** distinct answers to "local and remote disagree",
> and **two** of them detect a conflict properly. Both are three-way merges
> against a stored base hash; one is 135 lines with a diff UI, the other is 406
> lines, generic over entity type, with tombstones as a first-class variant.
>
> The cloud sync writer — shipped, and the only one carrying the user's whole
> workspace off-device — has **neither**, and it is built on top of a table that
> belongs to the second one.
>
> | # | Strategy | Where | Detects divergence? | Human ruling? |
> |---|---|---|---|---|
> | 1 | **Three-way merge on a base hash** | `obsidian_brain/conflict.rs:36` | **yes**, 4 outcomes | yes, with a diff |
> | 2 | **Three-way merge + *deterministic* LWW + tombstones** | `engine/src/workspace_sync/merge.rs:107` | **yes**, 5 outcomes | no — both ends are one user, by design |
> | 3 | **Detect-then-ask on a natural key** | `data_portability.rs:6483`, `:6609`, `:9784` | yes, by name/path | yes, no diff |
> | 4 | **Replace the whole set** | `p2p/manifest_sync.rs:278-283` | n/a by construction | n/a |
> | 5 | **Always duplicate** | `data_portability.rs:6060` (new UUID + `" (imported)"`) | n/a by construction | n/a |
> | 6 | **Refuse and name the cost** | `owned_devices.rs:251` `DeviceGroupConflict` | yes | yes — "unpair one side first" |
> | 7 | **Watermark push + *racing* LWW** | `src/cloud/sync/**` (11 tables) | **no** | **no** |
>
> Strategies 4, 5 and 6 are *correct*: they make the conflict unrepresentable or
> refuse to guess. **The distinction between 2 and 7 is the one this document
> exists to draw.** Both are last-writer-wins. Strategy 2's winner is computed
> from the data by a total function — later `modified_at`, ties broken by device
> id (`merge.rs:140-157`) — so **both devices compute the same winner** and the
> outcome is a fact about the rows. Strategy 7's winner is whichever HTTP request
> reached Supabase last. One is a merge rule; the other is a race, and only one of
> them is written down anywhere.
>
> ### Four findings, each measured against the running installation
>
> **1. A shipped feature consumes another module's unfinished foundation as if it
> were live.** `persona_tombstones` (`incremental.rs:3336-3348`) belongs to the
> p2p cross-device work — the migration's own comment block (`:3285-3287`)
> introduces it alongside the sync-state ledger and the `content_hash` columns
> *"so hard-deletes can propagate across devices instead of resurrecting on the
> next pull"*. That work is **Stage 1 of ADR 2026-05-24-cross-device-persona-continuity**,
> and it says so plainly and honestly:
> `engine/src/workspace_sync/mod.rs:20-25` — *"Stage 1 ships this module's data
> model + algorithm with full unit-test coverage but no production caller yet …
> `allow(dead_code, unused_imports)` documents that this is intentional
> foundation, not abandoned code."* **The cloud sync writer, in a different
> crate, then built a complete delete-propagation cascade on top of that table**
> — `fetch_tombstones` (`rows.rs:823`), `process_tombstones` (`mod.rs:372`),
> `delete_persona_cascade` (`:355`), an eight-table `PERSONA_SCOPED_TABLES` sweep
> (`:341`), a cursor-hold-on-failure discipline (`:386-389`) and the comment
> *"Deletes are idempotent"*. **`INSERT INTO persona_tombstones` returns zero hits
> in 963 `.rs` files.** Live: **0 rows.**
>
> So the whole cascade is unreachable, and **no local delete has ever propagated
> to the cloud** — not personas, and not the ten child families that have no
> tombstone concept at all. Exposure if sync were enabled today: **78 personas
> and 22,508 child rows** that no local action can remove. This is not a
> forgotten `INSERT`; a module honestly labelled *"no production caller yet"* was
> treated as a dependency across a crate boundary, and **nothing in the type
> system, the tests or the comments can express that** (§8 Gap 8).
>
> **2. The columns that would make divergence detectable are the same Stage-1
> artefact.** `incremental.rs:3292` adds `personas.content_hash` and
> `personas.last_modified_device`, described as *"(cross-device sync)"*, in the
> same migration group as the tombstone table. **Both have zero readers and zero
> writers in the entire tree** — `last_modified_device` occurs at exactly two
> lines across 963 `.rs` + 4,829 `.ts/.tsx` files, and both are that migration.
> Live: **0 of 78** personas carry either value. They are waiting for
> `personas::update()`'s merge hook, which `workspace_sync/mod.rs:22` schedules
> for Stage 3+. `owned_devices::mark_synced` (`owned_devices.rs:413`) is the same
> story with a worse ending: **0 production callers, 1 test** (`:524`), and no
> comment saying so. **The cheap, correct, in-scope fix is to write these two
> columns now** — that makes divergence *detectable* on the shipped cloud path
> years before the p2p transport lands, and it is what D2 asks for.
>
> **3. The cursor bug was fixed in one of the three places it lives.**
> `sync/mod.rs:272-281` carries a nine-line comment explaining why the cursor must
> advance to `observed_max` and not to wall-clock `now()` — *"it moved the cursor
> past any row committed to SQLite after the SELECT's read snapshot but stamped
> before that instant — permanently excluding it from every later pass."* Correct,
> and the table path was fixed. **`process_tombstones` at `mod.rs:374` still
> captures `tick_start = now_rfc3339()` and writes it at `:393`**, through a
> `let _ =` that also discards the failure — same file, 110 lines apart. And a
> third watermark repeats it outside this module:
> `engine/project_tracking/push.rs:306` passes `chrono::Utc::now()` **captured
> after an awaited LLM consolidation at `:301`**, so everything created during
> that call is permanently skipped (D11). Four of the repo's six time-watermarks
> advance from observed data; two advance from a clock.
>
> **4. The redaction finding inverts under measurement, and the brief's implied
> fix is harmful.** See §12.3. Short version: 4,524 live rows *would* trip
> `redact_secrets` in the ten tables it never reaches — and **3,830 of those are
> its density heuristic firing on file paths and GitHub URLs**, 11 are its prefix
> heuristic firing on prose *about* `sk-`/`AKIA`, and exactly **one** is a
> secret-shaped key (`credentialLinks`, a map of links). Hand-verified 14/14
> density samples: every one a path, a URL, or a slash-joined identifier list.
> **Pointing `redact_secrets` at the other ten tables would corrupt ~3,830 rows of
> legitimate content and catch zero credentials.**
>
> ### And the honest caveat that frames all of it
>
> **Cloud sync has never run on this installation.** `cloud_sync_enabled` is
> unset (default off), all eleven `cloud_sync_cursor_*` keys are absent,
> `cloud_sync_last_at` and `cloud_sync_total_rows` are absent. The one persisted
> artefact is `cloud_sync_device_id`, which exists because
> `remote_command_list_pending` (`remote_commands.rs:211`) calls
> `resolve_device_id` and is gated on `#[requires(privileged)]` + a live token,
> **not** on the sync-enabled flag. So the device identity was minted without the
> user ever enabling sync. Every §7 defect below is a live property of shipped
> code with an instance count of zero, in the same sense that
> [second-database](./second-database.md)'s torn-vector class was — the classes
> are real, the operator has not hit them, and I looked specifically.
>
> ### Sibling boundaries, settled in prose
>
> [**conditional-write**](./conditional-write.md) owns the predicate in the
> `WHERE` clause and whether the caller reads the count. **This path owns the case
> where the other side is not a row in your database** — a PostgREST filter, a
> file on disk, a peer's manifest — and extends its §2: the count matters just as
> much, and `SyncClient::patch` was `Result<()>` until 2026-08-16 so it was not
> merely dropped but *unavailable* (§12.1).
>
> [**idempotent-invocation**](./idempotent-invocation.md) owns `remote_commands.rs`
> — its D2 (the unkeyed spawn) and D3 (the three remaining filterless PATCHes at
> `:105`, `:145`, `:345`). **Those four sites are its deviations, not mine**, and
> this path does not re-list them. **This path owns the eleven-table writer beside
> them**, which that document cites once (`:467`) as an exemplar and never audits.
>
> [**upsert**](./upsert.md) owns insert-or-update as a merge inside one store.
> **This path owns the merge across a store boundary**, where the arbiter is a
> remote `Prefer: resolution=merge-duplicates` you cannot see and cannot condition.
>
> [**delete-semantics**](./delete-semantics.md) owns the blast radius of a delete.
> [**second-database**](./second-database.md) owns the row that exists in
> `personas.db` and `personas_data.db`. **This path owns the row that exists on
> this machine and somewhere else**, and supplies the one thing neither can: the
> tombstone, and what happens when it has no writer.
>
> [**secret-and-pii-redaction**](./secret-and-pii-redaction.md) owns the redactor.
> **This path owns which projection it is pointed at**, and §12.3 corrects the
> assumption that pointing it at more of them is an improvement.
>
> **Not this path:** semantic contradiction between two *local* memories is
> `src/features/overview/sub_memories/libs/memoryConflicts.ts`
> (`duplicate | contradiction | superseded`) — a curation problem with a
> conflict-shaped UI, not a divergence between two copies of one row.
>
> The **Deviations** section is a fix backlog: **three dead mechanisms** (D1, D2,
> D6 — all reachable, all correct, none ever executed), **one live cross-client
> schema drift** (D10), and seven repairs. `workspace_sync` is deliberately
> **not** in it: it is unwired and says so, which §5 treats as the correct way to
> ship half a reconciliation feature.

---

## 1 Trigger

- "This row also lives in the cloud / the vault / on the other device — which one wins?"
- "How do I know what changed since last time?" / "What do I set the cursor to?"
- "The user deleted it here. Is it still there?"
- "Two devices edited the same thing. What does the second one see?"
- "I'm importing a bundle and something with this name already exists."
- "The remote copy is stale and I don't know why."

If you are about to type `last_synced_at`, `content_hash`, `base_hash`,
`cursor`, `watermark`, `since=`, `updated_at >`, `merge-duplicates`,
`tombstone`, `deleted_at`, `device_id`, `resolution: "replace" | "skip"`, or to
write a loop that reads rows out of one store and writes them into another —
you are in this situation.

**Not this path:** a compare-and-set *within* one SQLite file is
[conditional-write](./conditional-write.md); whether a *request* should have
produced a row at all is [idempotent-invocation](./idempotent-invocation.md);
which of this app's two SQLite files a table belongs in is
[second-database](./second-database.md); what a delete takes with it inside one
store is [delete-semantics](./delete-semantics.md).

## 2 The one way

**Decide first whether the copy is authoritative or derived, because that
choice — not the transport — determines everything else. If it is derived, do
not reconcile: replace it wholesale and give it no ability to talk back.** The
p2p manifest mirror gets this exactly right in two statements
(`manifest_sync.rs:278-283`: `DELETE … WHERE peer_id = ?1` then re-INSERT the
whole set), and a set that is atomically replaced cannot diverge, cannot need a
cursor, and cannot need a conflict UI. **If both copies are authoritative — if a
human can edit either one — then you owe three things and they are one feature,
not three: a stored base, a comparison against it, and a per-item ruling.**
Store, on your side, the hash (or version) of the value *as it stood at the last
agreed sync* — never the value's own `updated_at`, which tells you when you
changed it and nothing about the other side. On each pass compare `base` against
*both* current values and branch four ways, exactly as
`three_way_compare` (`obsidian_brain/conflict.rs:36-81`) does: unchanged,
only-mine, only-theirs, and both — where *both* splits again into converged
(same result, report it as an avoided conflict, do not hide it as a no-op) and
diverged. **A diverged item is not yours to resolve. Surface it with enough
content that the human can see what differs**, and take the ruling back over the
wire; then, before you write the winner, **re-read the destination and refuse if
it moved** (`obsidian_brain/mod.rs:1273-1285` — the conflict snapshot goes stale
while the dialog is open, and the guard is eight lines). **Advance the watermark
to a value you observed in the data you just read, never to a clock read** —
`mod.rs:272-281` states the reason and `:393` is what happens when you don't —
and **propagate the watermark write's error**, because a watermark that silently
failed to persist is the one fact the next pass cannot re-derive. **Choose a
watermark column the row's own writers actually touch**: `created_at` plus a
guessed resync window is a bet that nothing mutates later than your guess, and
five of this repo's eleven synced tables take that bet (§7 D4). **Every delete
needs a producer before it needs a propagator** — write the tombstone in the same
transaction as the delete, or the cascade you built downstream is dead code
(§7 D1). **And stamp the writer**: a replica id that is part of nothing is a
passenger; if two copies can be edited, `device_id` (or an equivalent) belongs in
the identity of the row, not beside it. **If there is no human to ask — both ends
are the same person's devices — last-writer-wins is legitimate, but only in the
form where both ends compute the same answer**: a *total* function over the data
(later `modified_at`, ties broken by device id — `workspace_sync/merge.rs:140-157`
is 18 lines and it is the entire difference between a merge rule and a race).
Then stop: do not add a mutex, do not let "whichever request arrived last" become
the rule by omission, and **if you ship the algorithm before the transport, say so
in the module header the way `workspace_sync/mod.rs:20-25` does** — naming the
ADR, the stage, and the consumer that has not landed — because the next module
that finds your table will otherwise treat it as finished (§7 D1).

## 3 Mandated primitives

**Exist today — use them:**

- **`src/commands/obsidian_brain/conflict.rs:36` `three_way_compare(entity_type,
  entity_id, file_path, base_hash, app_content, vault_content) -> ThreeWayResult`** —
  **the one function to copy.** Four outcomes; `ConvergedConflict` is a distinct
  variant with a written justification (`:16-30`) for why it must not collapse
  into `NoChange`. Five unit tests, one per outcome (`:87-134`).
- **`src/commands/obsidian_brain/conflict.rs:9` `enum ThreeWayResult`** — the
  type that makes "I forgot the both-changed case" a non-exhaustive `match`.
  This is the type answer for this leaf; see "Prefer a type over a gate".
- **`engine/src/workspace_sync/merge.rs:107`
  `merge_entity<S: SyncSnapshot>(base_hash: Option<&str>, local, remote)
  -> WorkspaceMergeOutcome`** — the **generic** form of the same algorithm, and
  the one to reach for when the entity type is not fixed. Three things it adds
  over `three_way_compare` and that you should copy: (a) `WorkspaceEntity` (`:24`) is
  `Live { snapshot, device_id } | Tombstone { id, deleted_at, device_id }`, so
  **a deletion is a value in the same enum as a state** and the merge cannot
  forget it; (b) `base_hash: Option<&str>` makes first contact a legal input
  rather than a special case; (c) `last_writer_wins` (`:140-157`) is *total* and
  symmetric, so both devices compute the same winner. 12 unit tests.
  **It has no production caller and its module header says so** (`mod.rs:20-25`,
  ADR 2026-05-24-cross-device-persona-continuity, Stage 3+) — that header is the
  primitive too: it is the correct way to ship half a reconciliation feature.
- **`engine/src/workspace_sync/snapshot.rs:72` `trait SyncSnapshot`** — the content
  hash a merge compares. Implement it on your entity rather than hand-hashing.
- **`db/src/repos/resources/obsidian_brain.rs:7` `upsert_sync_state(&SyncState)`** —
  the base store. `SyncState` (`core/src/models/obsidian_brain.rs:138`) is the
  shape: `entity_type`, `entity_id`, the other side's path, `content_hash`,
  `sync_direction`, `synced_at`. **Call it with `?`, not `let _ =`** — §9.
- **`src/commands/obsidian_brain/mod.rs:1256` `obsidian_brain_resolve_conflict(
  conflict, resolution)`** — the per-item human ruling, with the TOCTOU re-hash
  at `:1273-1285` and a fail-closed `use_vault` arm (`:1321-1327`) whose comment
  records that it used to report success while touching nothing.
- **`src/features/plugins/obsidian-brain/sub_sync/ConflictDiffView.tsx`** — the
  frontend half. Line-level LCS diff, capped at 6,000 chars per side, legend,
  truncation notice. **This is what "enough content that the human can see what
  differs" means**; copy it rather than shipping a name and two buttons.
- **`engine/src/p2p/manifest_sync.rs:262-290` `upsert_peer_manifest`** — the
  derived-mirror strategy. `DELETE … WHERE peer_id = ?1` then re-INSERT. Reach
  for this *first*; if it fits, you have no cursor, no conflict, and no UI.
- **`src/commands/core/data_portability.rs:1530` `ImportConflict` +
  `conflict_key(kind, bundle_id)` (`:1548`)** — the two-pass detect-then-ask
  flow: pass 1 returns conflicts and writes nothing, the frontend rules per item
  into a flat `"<kind>:<id>"` map, pass 2 applies. Its doc comment is the best
  statement of the pattern in the tree.
- **`src/features/settings/sub_portability/components/ImportConflictPanel.tsx`** —
  the ruling UI for that flow (`skip | duplicate | replace`, defaulting to `skip`
  at `:56`, which is the right default).
- **`db/src/repos/resources/owned_devices.rs:251` `group_conflict` →
  `AppError::DeviceGroupConflict`** — the **refuse** strategy, with a truth table
  in the doc comment (`:297`) and the same verdict re-derived on the peer side
  (`p2p/device_pairing.rs:307`). When neither side can safely win, a typed
  refusal that names what would be stranded beats any merge.
- **`src/cloud/sync/client.rs:141` `patch_returning_count(path_and_query, body)
  -> Result<usize>`** — added 2026-08-16. **The only way to write a
  compare-and-set against the cloud.** Its doc comment (`:126-140`) names the two
  billed runs the absence cost. Use it for every mutating remote write; `patch`
  is for writes with no precondition and there are none left that qualify.
- **`src/cloud/sync/mod.rs:265-283` `sync_table_inner`** — the correct cursor
  advance, and its `:272-281` comment is the reason. Read it before writing any
  incremental reader.

**Do not exist — this path names them:**

- **A tombstone writer.** `persona_tombstones` has a reader and no producer (D1).
- **Any read of the cloud's copy of the eleven synced tables.** `SyncClient::get`
  has two call sites, both `pending_commands` (`remote_commands.rs:139`, `:215`).
  The sync is push-only, so no local code can observe that it lost.
- **A shared resolution vocabulary.** Four exist, none compatible (§8 Gap 3).
- **The remote schema, anywhere in this repo.** §8 Gap 1.
- **Any writer for `personas.content_hash` / `personas.last_modified_device` /
  `owned_devices.last_synced_at`** (D2, D6).

## 4 Steps

1. **Classify the copy: authoritative or derived.** Can a human edit the other
   side? If no, go to step 2 and stop after it. If yes, go to step 3.
2. **Derived → replace the set.** Delete-by-owner then re-insert, in one
   transaction (`manifest_sync.rs:278-283`). Write one line in the module header
   saying the mirror is derived and why replacement is safe. **You are done** —
   no cursor, no base hash, no conflict type, no UI.
3. **Authoritative → store the base.** Add a row per synced entity holding the
   *agreed* hash/version, the other side's address, and when. Copy `SyncState`.
   The base is **not** your row's `updated_at`; §7 D4 is what you get if you
   substitute it.
4. **Compare three ways and branch four ways.** `match` on a closed enum, not on
   two booleans — the compiler is the thing that stops you forgetting
   both-changed. Copy `ThreeWayResult`. Report converged separately from
   unchanged; `conflict.rs:16-30` explains why, and it is an audit-trail
   argument, not a purity one.
5. **Advance the watermark from the data.** `let new_cursor =
   observed_max.unwrap_or(previous);` — never `now()`. Bind the write's `Result`
   and propagate it with `?`. **This is the step that fails**: 11 of this repo's
   29 watermark writes discard it (§9).
6. **Surface a diverged item; do not resolve it.** Send both bodies and all three
   hashes. Render a diff, not a name. The ruling comes back over the wire keyed
   by a stable id.
7. **Re-read before you clobber.** On the resolution write, re-hash the
   destination and refuse if it no longer matches the snapshot the user ruled on
   (`mod.rs:1273-1285`). Eight lines; the dialog was open for minutes.
8. **Write the tombstone in the same transaction as the delete.** Before you
   build any propagation, grep for the `INSERT` that feeds it. If there isn't
   one, that is the whole feature and everything downstream is decoration.
9. **Stamp the writer into the identity, not beside it.** If two replicas can
   produce the same primary key, the replica id belongs in the key or in a
   uniqueness constraint. A `device_id` column that no index mentions tells you
   who wrote last and nothing about who wrote first.
10. **And then stop.** No clock comparison across machines. No "merge the JSON".
    No retry that re-pushes on a conflict. If both sides moved and you cannot
    ask, refuse the way `DeviceGroupConflict` refuses.

## 5 Anti-patterns

- **Consuming another module's declared-unfinished foundation as if it were
  live.** *Failure:* the whole feature is dead and reads as shipped, and the
  module that warned you is in a different crate warning about *itself*.
  `process_tombstones` + `delete_persona_cascade` + `PERSONA_SCOPED_TABLES` + the
  cursor-hold logic are ~45 lines of correct, tested-looking code fed by
  `persona_tombstones` — a Stage-1 table of ADR 2026-05-24 whose writer
  (`personas::update()`'s merge hook) is scheduled for Stage 3+ and whose owning
  module says so at `workspace_sync/mod.rs:20-25`. Live: 0 rows, 0 INSERT sites
  in 963 files. **A `#![allow(dead_code)]` and a prose header cannot reach across
  a crate boundary to a consumer of the same *table*.** Before you read a table,
  name the line that writes it.
- **Building the propagation before the producer.** *Failure:* the same shape
  without the excuse — and it is not local. `brainiac` declares soft-delete in
  `migrations/0001_init.sql:3`, ships the `deleted_at` column and **12
  `deleted_at IS NULL` readers**, and has **zero** `SET deleted_at` writers in
  any `.rs` or `.sql` file. Two repos, no contact, same defect. A review question
  that asks "is there a tombstone" passes both; the question that catches them is
  **"name the line that writes it."**
- **Advancing a watermark to a clock read.** *Failure:* rows committed after the
  SELECT's snapshot but stamped before the instant are excluded from **every
  later pass** — a silent, permanent, unrecoverable loss with no error.
  `mod.rs:272-281` documents this in nine lines and `mod.rs:393` does it anyway,
  110 lines later, in the same file.
- **`let _ =` on the watermark write.** *Failure:* discards the `Err` and the
  fact that the two sides' agreement was never recorded. On the Obsidian path
  (8 sites) a lost base hash makes the *next* three-way compare see a stale base
  and report a conflict that does not exist; on the cloud path (`mod.rs:393`) the
  tombstone cursor silently stalls.
- **Using the row's own `updated_at` as the base.** *Failure:* it records when
  **you** changed, which is exactly the fact you already have. The base must be
  the value both sides last agreed on. This is why `SyncState.content_hash` is a
  hash of content and not a timestamp.
- **A `created_at` watermark plus a resync window on a mutable row.**
  *Failure:* every in-place mutation later than the window is invisible forever,
  and the window is a guess about human behaviour. Five of eleven tables here
  (§7 D4); worst observed lag on this install is **11.0h against a 24h
  window** — a 2.2× margin nobody chose.
- **Last-write-wins by omission.** *Failure:* indistinguishable from a decision.
  `client.upsert` sends `Prefer: resolution=merge-duplicates`
  (`client.rs:77`) with no precondition, so the remote row is whatever the last
  device pushed, and **no local code ever reads it back** — the loser cannot
  learn it lost, and the UI (`CloudSyncCard.tsx`) has no concept to show. If LWW
  is right for your data, write that down.
- **Minting the replica identity with a read-then-write and discarding the
  write.** *Failure:* `resolve_device_id` (`cursor.rs:103-112`) reads
  `app_settings`, mints a UUID on miss, and persists it with `let _ =`. Two
  concurrent callers — the 45 s sync loop (`mod.rs:422`) and the 15 s
  remote-command poll (`remote_commands.rs:134`), plus a frontend-invocable
  command (`:211`) — can both miss and both mint; the loser stamps an entire sync
  pass with an id that was never persisted, and the dashboard's `target_device_id`
  routing then points at a device that does not exist. Same shape as
  [conditional-write](./conditional-write.md) D7, applied to identity.
- **A per-item ruling UI that shows a name and two buttons.** *Failure:* the user
  cannot rule, so they guess or default. `CredentialConflict`
  (`data_portability.rs:9540`) carries `name`, `service_type`, `existing_id` — no
  timestamps, no field list, no diff. `SyncConflict` carries both bodies and
  three hashes, in the same repo.
- **Resolving against a stale snapshot.** *Failure:* silently destroys an edit
  made while the dialog was open. Guarded exactly once
  (`mod.rs:1273-1285`); the credential-import resolution pass has no equivalent.
- **Trusting a remote PATCH you cannot count.** *Failure:* two approvals, two
  agent runs, two bills. Fixed 2026-08-16 with `patch_returning_count`;
  [idempotent-invocation](./idempotent-invocation.md) D3 owns the three sites in
  `remote_commands.rs` that still use the countless `patch`.

## 6 Evidence

**The one site to copy: `src/commands/obsidian_brain/conflict.rs:36-81`.** Read
it as five decisions. (1) The base is a **content hash**, stored per entity in a
row of its own, not a timestamp and not the entity's `updated_at`. (2) The
comparison is `app_hash != base` and `vault_hash != base` — two independent
questions, so the result is a 2×2 and not a winner. (3) The both-changed cell
splits again: identical content is `ConvergedConflict`, not `NoChange`, and
`:16-30` argues for that on audit-trail grounds — *"the user did edit both sides,
and we want the audit trail to show that a real conflict was avoided by chance."*
(4) The diverged cell constructs a `SyncConflict` carrying **both full bodies and
all three hashes**, which is what makes a diff renderable. (5) The function
writes nothing and returns a closed enum, so the caller's `match` is exhaustive
and the both-changed arm cannot be forgotten. Its consumer
(`mod.rs:955-1067`) then does the only correct thing with each arm, including
updating the base to the converged hash so the next pass is quiet.

Runner-up, for the **ask-the-human** half:
`data_portability.rs:1530-1550` (`ImportConflict` + `conflict_key`) with
`ImportConflictPanel.tsx` — a two-pass flow where pass 1 writes nothing, the
resolution map is flat and kind-qualified, and the default is `skip`.

For the **derived mirror**: `engine/src/p2p/manifest_sync.rs:278-283`.
For the **refusal**: `db/src/repos/resources/owned_devices.rs:251` +
`engine/src/p2p/device_pairing.rs:307`.

### What is actually synced, and in which direction (measured)

`SYNC_TABLES` (`mod.rs:57-69`) is 11 tables. **All eleven are push-only.**
`SyncClient::get` has exactly two call sites and both read `pending_commands`
(`remote_commands.rs:139`, `:215`), so the cloud's copy of a synced row is never
read by this app. Live row counts and the watermark each table actually uses:

| remote table | local table | watermark col | resync 24 h | `updated_at` exists | live rows |
|---|---|---|---|---|---:|
| `synced_personas` | `personas` | `updated_at` | no | yes | 78 |
| `synced_executions` | `persona_executions` | **`created_at`** | yes | **no** | 2,188 |
| `synced_events` | `persona_events` | **`created_at`** | yes | **no** | 4,972 |
| `synced_manual_reviews` | `persona_manual_reviews` | `updated_at` | no | yes | 194 |
| `synced_messages` | `persona_messages` | **`created_at`** | yes | **no** | 0 |
| `synced_metrics_snapshots` | `persona_metrics_snapshots` | **`created_at`** | yes | **no** | 0 |
| `synced_tool_usage` | `persona_tool_usage` | **`created_at`** | **no** | **no** | 5,720 |
| `synced_memories` | `persona_memories` | `updated_at` | no | yes | 6,535 |
| `synced_knowledge_patterns` | `execution_knowledge` | `updated_at` | no | yes | 2,343 |
| `synced_healing_issues` | `persona_healing_issues` | **`created_at`** | yes | **no** | 205 |
| `synced_triggers` | `persona_triggers` | `updated_at` | no | yes | 351 |
| — | `persona_tombstones` | `deleted_at` | — | — | **0** |

**Six of eleven watermark on `created_at`, and none of those six tables has an
`updated_at` column to use instead.** That is the real constraint: the resync
window is not laziness, it is the only tool available, and the durable fix is a
schema change (§8 Gap 2). Five of the six carry the 24 h window;
`persona_tool_usage` carries none at all — and its `invocation_count` is
INSERT-once (`db/src/repos/execution/tool_usage.rs:65-74`, no UPDATE anywhere),
so that omission is correct and I checked rather than assumed.

**The window's margin, measured on the live data:** 0 of 2,188 executions
completed more than 24 h after creation (worst lag **11.0 h**); 0 of 4,972 events
processed late (worst **0.0 h**); 0 of 25 resolved healing issues resolved late
(worst **0.1 h**). **The class has zero live instances and a 2.2× margin.** The
205-row healing table is where it will bite first: **179 are still `open`**, and
any one of them resolved tomorrow is a cloud row frozen at `open` forever.

### The base-hash population, and where it is not

| | present | absent |
|---|---|---|
| a stored base for comparison | `obsidian_sync_state.content_hash` (per entity) | all 11 cloud tables |
| a natural key to compare on | `dev_projects.root_path` (UNIQUE), `twin_profiles.name`, `credentials.name` | all 11 cloud tables |
| a replica stamp in the identity | — | `device_id` is a passenger column on all 11 |
| a replica stamp at all | `SyncedRow.device_id` (stamped per pass, `rows.rs:536-543`) | `personas.last_modified_device` (**0/78**) |

### Watermark writes: the partition that drives §9

29 production watermark-writer call sites, every one opened:

| | n | files |
|---|---:|---|
| **`let _ =` — the verdict discarded** | **11** | `obsidian_brain/mod.rs` (8), `cloud/sync/mod.rs:393`, `engine/shared_event_relay.rs:170`, `engine/src/shared_event_local_relay.rs:96` |
| **`?` — propagated** | **18** | `slack_poller` (4), `team_slack_relay` (4), `webhook_notifier` (4), `obsidian_brain/mod.rs` (3), `discord_poller` (2), `cloud/sync/mod.rs:282` (1) |

**38% discard it; 62% do not** — and the discipline is not evenly spread: every
poller and relay propagates, and 8 of the 11 discards are one function family.

### Convergence — 5 sibling repos

Swept read-only against `personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
`ascent`, searching for each mechanism **and for its name** (`watermark`,
`checkpoint`, `since`, `etag`, `revision`, `lsn`, `tombstone`, `replica`).

| clause | verdict | evidence |
| --- | --- | --- |
| **An incremental reader keeps a persisted per-stream cursor** | **PHYSICS, and Personas leads the family** | Present in 4 of 6. Personas has **five independent mechanisms over 12+ streams** (`cloud/sync/cursor.rs:33`; `webhook_notifier.rs:620` composite `created_at\|id`; `team_slack_relay.rs:230`; `cloud_webhook_relay.rs:86` with its own `cloud_webhook_watermarks` table; `project_tracking/push.rs:271`), plus the hash-based base in `obsidian_sync_state`. `ascent` has `headSha` + `headEtag` per repository (`prisma/schema.prisma:180-185`). `personas-web` has one **in-memory** offset (`useExecutionPolling.ts:28`). `brainiac` has none — its "incremental" reads are rolling `updated_at > now() - interval` windows (`compose.rs:862`, `library_sweep.rs:82`), which re-read forever and silently drop whatever ages out. `personas-cloud`: **zero traces.** |
| **The cursor advances to a value observed in the data, not to `now()`** | **PHYSICS as an ideal, VIOLATED by the code that already knows better** | Safe: `personas` ×4 (`cloud/sync/mod.rs:281`, `webhook_notifier.rs:716-724`, `cloud_webhook_relay.rs:404-406`, `team_slack_relay.rs:9`) and `ascent`'s `etag` taken from the response header (`github/source.ts:189`). Unsafe: `personas` ×2 — `cloud/sync/mod.rs:374→:393` and `project_tracking/push.rs:306`, the latter capturing `Utc::now()` **after an awaited LLM consolidation**. `vibeman` writes `new Date()` (`supabase/sync.ts:70-86`) and it is harmless only because nothing reads it. **The sharpest single fact in the sweep: the best-documented safe advance in all six repos and a wall-clock advance sit 110 lines apart in one Personas file.** The doctrine landed on the main path and not on the sibling. |
| **A remote write carries a precondition and the caller reads the match** | **PHYSICS, and Personas is the weakest of the four that have it** | `brainiac` **26 `rows_affected()` across 13 files**, plus a named CAS token (`documents.rs:554-562`, *"`dirty_at` is cleared ONLY if `updated_at` is unchanged since the claim"*) and a content-CAS (`docs.rs:629-636`). `ascent` has both flavours — `If-None-Match` → 304 with negative-case tests (`github/source.ts:178`, `source.test.ts:376-401`) and `updateMany(…) → res.count === 1` (`org-watch.ts:212-216`). `vibeman` has the cleanest single example: `.eq('status','open').select()` then `if (data.length === 0) return false` (`external-requirements.ts:73-88`). **Personas: 2 guarded (`remote_commands.rs:292`, `:375`) against ~18 unguarded** — 13 `upsert`, 3 `delete`, 2 bare `patch`. `personas-web`: **zero.** `personas-cloud`: zero state transitions guarded. |
| **A conflict is DETECTED and surfaced, not resolved by racing LWW** | **INVERTED — 1 of 6 shows it to a human** | `brainiac` `docs.rs:637-644` is the only true edit-conflict 409 in six repos: *"this section changed since you loaded it — reload and reapply your edit"*, gated on the CAS at `:629-636` whose comment (`:626-628`) states the goal — *"a second editor is told (409) instead of silently overwriting."* Personas is **PARTIAL with three lanes and three answers**: real (Obsidian, with a diff UI), correct-but-unwired (`workspace_sync/merge.rs`), and blind (the Supabase lane). `ascent` detects only *serialization* conflicts (40001/P2034) and retries them, never showing one. `vibeman`, `personas-cloud`, `personas-web`: absent — `personas-cloud`'s 409s are uniqueness rejections. |
| **Deletes propagate** | **PHYSICS as an intention, and the writer is missing in TWO repos independently** | Personas: table + reader + 9-table cascade, **zero writers** (§7 D1). `brainiac`: `deleted_at` column + **12 readers**, **zero `SET deleted_at`** in any `.rs`/`.sql`. **Two codebases, no contact, the same defect** — which is why §5's review question is "name the line that writes it" and not "is there a tombstone". `vibeman` is the only repo that actually propagates, and it does it without a tombstone at all: `pruneStaleRows` (`supabase/sync.ts:151-165`) deletes remote rows not in the local id list, **after** the upsert, with the ordering rationale written down at `:208-210` and two accepted holes stated in code (`:156` skips when local is empty, `:162` non-fatal). `personas-cloud`, `personas-web`, `ascent`: absent. |
| **A replica identity is stamped into the row's IDENTITY** | **INVERTED — 1 of 6, and its id is not unique** | Only `vibeman` puts it in a key: `UNIQUE(device_id, project_id)` (`schema-external.sql:20`) used as the upsert conflict target (`project-sync.ts:58`). **And `getDeviceId()` is `os.hostname()` (`project-sync.ts:16-18`)** — not minted, not unique, so two machines sharing a hostname collide *inside the primary key*. Personas mints a real UUIDv4 (`cursor.rs:103-112`) and stamps ~12 row structs, but **it is a passenger**: the remote PK is the entity id, so device B's upsert overwrites device A's row silently. `brainiac`, `ascent`, `personas-cloud`: absent (`personas-cloud`'s `workerId` is a WS-session handle, never persisted on a row). |
| **The remote schema lives in the repository** | **PHYSICS, and Personas is the only repo that fails it — with drift already shipped** | `brainiac` 41 `.sql` migrations + `openapi.json` + real-Postgres integration tests. `ascent` 31 Prisma migrations, one literally named `20260710120000_sync_schema_drift`. `vibeman` `src/lib/supabase/schema-external.sql` with CHECK constraints, mirrored by `external-types.ts`. **Personas: `CREATE TABLE …synced_` returns zero hits; `supabase/` holds only CLI `.temp` metadata.** The remote shape exists only as Rust structs (`rows.rs:120-300`) — while the *local* SQLite DDL runs to ~8,000 lines. **And the cost is already paid:** `personas-web` reads `synced_observability_daily` (`supabaseApi.ts:479`) and `synced_persona_spend` (`:497`) from the same tenant, and **neither table appears in `SYNC_TABLES`** (verified: zero hits in this repo). Two clients, one unwritten schema, divergence live today. |

**The strongest result in this sweep is a negative one, and it is about
Personas.** Six repos, and the only one that ships a real cross-device sync is
also the only one that does not keep its remote schema — and it is the only one
where a second client is already reading tables the writer does not write. The
three repos that check their schema in (`brainiac`, `vibeman`, `ascent`) show no
instance of this failure at all.

**Two clauses convergence does NOT support, stated plainly.** (1) *"A cursor is
better than a rolling window"* — `brainiac` deliberately uses rolling windows and
its authors would recognise the trade; the honest claim is narrower, that a
window silently drops what ages out and a cursor does not. (2) *"Ask a human"* —
five of six repos never ask, and `workspace_sync/mod.rs:16-18` argues correctly
that when both ends are the same user, a deterministic LWW is the right answer
and no conflict UI is required. **The clause that survives everywhere is not
"detect and ask" — it is "compute the winner from the data, so both sides get the
same answer."** Personas' cloud lane is the only place in six repos where the
winner is decided by network arrival order.

## 7 Deviations

Every entry is live on `master` @ `2a874e692`.

**D1 — the tombstone table has no producer, so no delete ever propagates — and
the reason is a crate-boundary dependency on a module that says it is not
finished.** `db/src/migrations/incremental.rs:3336-3348` creates
`persona_tombstones (persona_id, deleted_at, device_id)`; the comment block
introducing that migration group (`:3285-3287`) says it exists *"so hard-deletes
can propagate across devices instead of resurrecting on the next pull."* Its
owner is `engine/src/workspace_sync/`, Stage 1 of
ADR 2026-05-24-cross-device-persona-continuity, whose `mod.rs:20-25` states there
is **"no production caller yet"** and whose `merge.rs:6-9` explains the exact
failure: *"without an explicit tombstone, a delete on one device is
indistinguishable from 'never synced' and the row resurrects on the next pull."*
**`src/cloud/sync/rows.rs:823` `fetch_tombstones` reads that table anyway**, and
`mod.rs:372-395` builds a nine-table cascade on it. **`INSERT INTO
persona_tombstones` → zero hits in 963 `.rs` files;** the only other occurrences
are the migration and the retention registry (`:7992`). `personas::delete`
(`db/src/repos/core/personas.rs:1758`) writes none. Live: **0 rows.**
Consequence: `process_tombstones`, `delete_persona_cascade`, the eight-table
`PERSONA_SCOPED_TABLES` sweep and the `synced_events?target_persona_id` delete
are unreachable; **every local delete leaves its cloud row permanently.**
Exposure at today's counts: **78 personas + 22,508 child rows.**
*Fix, and it is small:* one INSERT inside `personas::delete`'s transaction
stamping `cursor::resolve_device_id`. That is independent of Stage 3 — the cloud
writer needs the tombstone *now*, the p2p transport needs it later, and one
producer serves both. Then `persona_tombstones.device_id` has a meaning too.

**D2 — the columns that would make divergence detectable are the same Stage-1
artefact, and writing them does not need Stage 3.**
`incremental.rs:3292-3298` adds `personas.content_hash` and
`personas.last_modified_device`, described as *"(cross-device sync)"*, in that
same migration group. `last_modified_device` occurs at **2 lines in the whole
tree**, both that migration. Live: **0 of 78** rows non-null for either. They are
waiting on `personas::update()`'s merge hook (`workspace_sync/mod.rs:22`,
Stage 3+) — but they are exactly the base hash and the replica stamp §2 requires,
on the one table the *shipped* cloud writer already syncs with an `updated_at`
watermark. *Fix:* compute `content_hash` from the `PersonaWorkspaceSnapshot`'s
own `SyncSnapshot` impl in `personas::update`, and stamp `last_modified_device`
from `resolve_device_id`. **That makes divergence detectable on the shipped path
without waiting for the transport**, and it is the prerequisite for the type
answer below.

**D3 — the cursor fix landed on the table path and not on the tombstone path.**
`src/cloud/sync/mod.rs:374` `let tick_start = now_rfc3339();` → `:393`
`let _ = cursor::set_cursor(pool, "tombstones", &tick_start);`. The comment at
`:272-281` explains exactly why this is wrong for the table path and was changed
there. Two defects in one line: a clock-derived watermark, and a discarded
`Result`. *Fix:* advance to `max(deleted_at)` over the tombstones actually
processed — `tombstones.last().map(|t| t.deleted_at.clone())` — and propagate.
(This is inert until D1 ships, which is why D1 is first.)

**D4 — five tables watermark on `created_at` behind a 24 h guess.**
`mod.rs:57-69` marks `executions`, `events`, `messages`, `metrics`,
`healing_issues` as `resync = true`; `rows.rs:505-516` widens their read to
`OR datetime(created_at) > datetime(?2)` with `?2 = now − 24 h`
(`mod.rs:255-259`). Any in-place mutation later than 24 h after the row was
created is **permanently invisible to the cloud**. Measured live: 0 instances,
worst lag 11.0 h, and **179 open healing issues** as the pending population.
*Fix (in order):* (a) add `updated_at` to the five tables and touch it on every
write — this is the durable fix and it deletes the resync concept; (b) until
then, widen the window per table from the measured worst lag rather than one
shared 24 h constant, and say in the comment that it is a bet.

**D5 — eleven watermark writes discard their verdict.** §9's population.
`src/commands/obsidian_brain/mod.rs:651`, `:741`, `:820`, `:955`, `:1013`,
`:1043`, `:1241`, `:1687` (`let _ = sync_repo::upsert_sync_state(…)`);
`src/cloud/sync/mod.rs:393`; `src/engine/shared_event_relay.rs:170` and
`engine/src/shared_event_local_relay.rs:96` (`let _ = repo::update_cursor(…)`).
The Obsidian eight are the sharpest: a base hash that failed to persist makes the
next `three_way_compare` run against a **stale base**, turning a clean pass into a
`ConvergedConflict` the user is then shown. Three sites in the same file
(`:364`, `:1305`, `:1376`) use `?`. *Fix:* `?` at all eleven; the two relay sites
already sit inside `Result`-returning fns.

**D6 — `owned_devices::mark_synced` has zero production callers, and unlike
`workspace_sync` nothing says so.** `db/src/repos/resources/owned_devices.rs:413-421`.
One call site in the tree, at `:524`, inside `#[cfg(test)]`. So
`owned_devices.last_synced_at` is NULL for every paired device and the pairing UI
cannot say when a peer was last reconciled. **The contrast with `workspace_sync`
is the lesson**: both are unwired, one carries a module header naming its ADR,
its stage and its future consumers, and the other carries nothing — so a reader
of `mark_synced` cannot tell "not yet" from "forgotten". Same shape as
[conditional-write](./conditional-write.md) D2's `claim_for_instance` (0
production callers, 5 test call sites). *Fix:* call it from the manifest-sync
completion path in `p2p/manifest_sync.rs`, or add the header.

**D7 — the replica identity is minted by an unguarded read-then-write.**
`src/cloud/sync/cursor.rs:103-112`. `settings::get` → mint UUID →
`let _ = settings::set(…)`. Three concurrent entry points
(`mod.rs:422`, `remote_commands.rs:134`, `:211`), no uniqueness constraint, no
`INSERT … ON CONFLICT DO NOTHING RETURNING`, and the persist's failure discarded.
A loser stamps a whole pass with an id that was never stored, and
`pending_commands?target_device_id=eq.<id>` then matches nothing.
*Fix:* `INSERT OR IGNORE` the minted id and re-read, the shape
`deliberation::claim_capability` already uses (`deliberation.rs:250`).

**D8 — `device_id` is a passenger on all eleven projections.**
`rows.rs:536-543` stamps the same `device_id` onto every row of a pass; the
remote merge key is the row `id` alone (`client.rs:77`
`resolution=merge-duplicates`). Two devices holding the same row id — reachable
today via export/import of a bundle — collapse to one cloud row whose
`device_id` is whichever pushed last, and **neither device can observe it**,
because nothing reads the cloud copy back. *Fix:* the cheap half is D2 (stamp
`last_modified_device` locally so at least the *local* provenance is answerable);
the real half is a schema decision on the remote, which this repo cannot
currently express (§8 Gap 1).

**D9 — the credential-import ruling asks for a decision it does not inform.**
`data_portability.rs:9540` `CredentialConflict { name, service_type, existing_id }`.
The user is asked `replace | skip` with no timestamps, no field list, no
indication of what differs — and `replace` at `:9820+` deletes
`credential_fields`, `credential_rotation_history` and
`credential_rotation_policies` for the existing id. Compare `SyncConflict`, which
carries both bodies. Also: the resolution pass re-reads `existing` but the
resolution map is keyed by name only, so there is no `expected_id` on the wire —
the guard [conditional-write](./conditional-write.md) §2 asks for. *Fix:* carry
`existing_updated_at` + a field-level diff into `CredentialConflict`, and key the
resolution map by `existing_id`.

**D10 — the remote schema is nowhere, and a second client has already drifted
from it.** The shape of eleven `synced_*` tables and `pending_commands` exists in
this repo only as Rust structs (`rows.rs:120-300`); `CREATE TABLE …synced_`
returns **zero hits**, and `supabase/` holds only CLI `.temp` metadata. **The
drift is not hypothetical:** `personas-web`, reading the same Supabase tenant,
queries `synced_observability_daily` (`../personas-web/src/lib/supabaseApi.ts:479`)
and `synced_persona_spend` (`:497`) — **neither appears in `SYNC_TABLES`
(`mod.rs:57-69`), and both return zero hits in this entire repo.** Two clients,
one schema that lives in neither, and a reader already pointed at tables nothing
writes. §8 Gap 1.

**D11 — a third watermark advances from a clock, and this one is worse than
`mod.rs:393`.** `src/engine/project_tracking/push.rs:306`:
`subscription::update_last_pulse_at(&handle.pool, &sub.project_id,
chrono::Utc::now())?`. The `Result` *is* propagated — this is not D5's shape — but
the **value** is a clock read taken *after* `consolidator::run_for_project(…).await?`
at `:301`, an LLM consolidation that can run for many seconds. Every event created
during that call is stamped before the new watermark and read after it, so it is
**permanently excluded from every later pulse**. The comment at `:304-305` says
the advance exists *"so the next push/tick consolidates only the NEW slice instead
of overlapping ranges"* — which is the right goal reached with the wrong value.
*Fix:* advance to `max(created_at)` over `events`, which is already in scope at
`:299`. **§9's rule does not and should not match this** — the defect is the
argument, not the discarded verdict, and there is no textual signal that separates
a wrong clock read from a right one (see the refusal in §9).

**Structural.** Every deviation above shipped under a green `npm run check`. The
`golden-path-census` pre-push job had no rule in this territory before this
document: of the registry's 116 rules, **none targets `src-tauri/src/cloud/**`,
a PostgREST-shaped write, or a watermark**.

## 8 Gaps

1. **The remote half of the contract is not in the repository.** `rows.rs:13-16`
   says the field names *"match the Supabase columns 1:1, so the upsert body
   needs no renaming"* — that 1:1 is maintained by a human editing two systems.
   There is no DDL, no `ts-rs`-style export, no schema test, and no way for
   `npm run check` to notice that a renamed Rust field silently stops populating
   a remote column. The leaf is marked `twoSided`, and **half the contract is
   unrepresented**. This is the one gap with **live, measured consequences**
   (D10) and the one where all three siblings that solved it did so the same way
   — `brainiac` 41 `.sql` migrations, `ascent` 31 Prisma migrations, `vibeman`
   `schema-external.sql` + a mirrored types file. Fixing it is not a gate, it is
   a file: a checked-in `supabase/schema.sql` plus a test asserting each
   `Synced*Row`'s serialized keys are a subset of its table's columns, and that
   every table any client reads has a writer.
2. **Six of eleven synced tables have no `updated_at` to watermark on.**
   `persona_executions`, `persona_events`, `persona_messages`,
   `persona_metrics_snapshots`, `persona_tool_usage`, `persona_healing_issues`.
   The resync window is a workaround for a missing column, not a design. Adding
   the column is a [schema-change](./schema-change.md) + a touch in every writer;
   until then D4 is not fully fixable.
3. **Four incompatible resolution vocabularies for one UX act.**
   `use_app | use_vault` (obsidian), `replace | skip | duplicate` (bundle
   import), `replace | skip` (credential import),
   `merge | keep_a | keep_b | dismiss` (memory curation). Four Rust types, four
   React panels, no shared component, no shared error phrasing. The repo has a
   precedent for consolidating exactly this — `src/lib/decisions/rowWrites.ts`,
   one door per decidable row type with `isDecisionConflict` matching five
   backend phrasings — and reconciliation rulings do not use it.
4. **SQLite cannot transact across a network, and no compensating protocol is
   written down.** The cloud pass upserts eleven tables and then processes
   deletes; a crash between them leaves the remote holding rows for an entity the
   local side has forgotten. [second-database](./second-database.md) §2's
   owning-store-first-plus-named-repair protocol is the right shape and
   `backlog_triage.rs:23-27` is the model header. **Zero of the four sync modules
   has one.**
5. **A push-only sync cannot detect anything, by construction.** Every clause in
   §2 about comparison presumes you can see the other side. `SyncClient` can
   (`get` exists and works), and the writer chooses not to. This is a legitimate
   design for a read-only dashboard; it stops being legitimate the moment the
   dashboard can write, which `pending_commands` already proves it can.
6. **`value_looks_secret`'s density arm is unusable outside a JSON payload.**
   Measured: 3,830 hits across `persona_executions` and `persona_memories`, and
   14/14 hand-sampled are file paths, GitHub URLs, or slash-joined identifier
   lists. It is safe where it lives (`persona_events.payload`, 4,972/4,972 of
   which are structured JSON decrypted from ciphertext) and unsafe as a general
   text scrubber. Any widening needs a different predicate, not the same one
   pointed at more columns.
7. **Nothing observes that the two sides agree.** There is no integrity query, no
   drift report, and no way — even manually — to ask "how many rows differ".
   `CloudSyncStatus` (`mod.rs:108-124`) reports rows *pushed*, errors, and
   cursors; it has no field that could hold a divergence count because there is
   no producer for one.
8. **Rust has no way to say "this table is not finished yet."**
   `#![allow(dead_code)]` plus a module header (`workspace_sync/mod.rs:20-25`) is
   the strongest available signal and it is genuinely good — it names the ADR,
   the stage, and the consumers that have not landed. **It reaches every reader
   of the module and no reader of the schema.** `persona_tombstones` is a table
   name in a SQL string in a different crate; nothing connects it back. The
   general form is [second-database](./second-database.md) Gap 6's wall — types
   do not reach through a process global — one layer further out: **types do not
   reach through a table name.** The only available instrument is a test that
   walks table names in SQL literals, which is what §9's refusal specifies.

## Prefer a type over a gate

**Answered before §9 was written, held against all seven qualifications, and the
answer is unusual for this corpus: the type already exists — TWICE, in this repo,
one of them generic and already written for exactly the cross-device case — and
the fix is to wire it up rather than to invent one.**

`ThreeWayResult` (`obsidian_brain/conflict.rs:9-33`) and
`WorkspaceMergeOutcome` (`workspace_sync/merge.rs:86-99`) are closed enums with
four and five variants, each returned by a pure function that writes nothing.
Their consumers must `match` exhaustively, so **"I forgot the both-changed case"
is a compile error**, and the converged arm carries its hash so it cannot be
discharged with a shrug. `WorkspaceMergeOutcome` goes further and is the better
model: its *input* type `WorkspaceEntity` is
`Live { snapshot, device_id } | Tombstone { id, deleted_at, device_id }`, so **a
deletion is not a special case, it is a variant** — the exact structural answer
to D1, written down and unwired.

The cloud writer's equivalent is `Vec<T> → client.upsert(…) → Result<(), AppError>`:
a shape in which the both-changed case is not merely forgotten but
**unrepresentable**, and in which a delete has no way to be spoken at all.

**A second, smaller type falls out of §9's refusal and is worth shipping
independently: `ReadWatermark(String)`, constructible only by `max()` over rows
observed in a result set.** A clock read cannot produce one. That makes D3 and
D11 compile errors, and — unlike a matcher — it does not confuse a read watermark
with a schedule pointer (`ascent`'s `nextScanAt`, `brainiac`'s `last_run_at`),
because a schedule pointer simply never takes the type. Held against
qualification 3: it would have **6 construction sites** today (`cloud/sync/mod.rs:281`,
`webhook_notifier.rs:716`, `cloud_webhook_relay.rs:404`, `team_slack_relay.rs:9`,
plus the two fixes) — thin, but every one of them is on the hot path, and unlike
`ThreeWayResult` it needs no other work to land first.

Held against the seven qualifications:

1. **A required prop carries only what it actually encodes.** `ThreeWayResult`
   encodes exactly "how do these two values relate to the last agreed value". It
   does **not** encode who should win, and it must not — that is the human's, and
   collapsing the two is how last-write-wins gets adopted by accident.
2. **Requiredness is orthogonal to closedness.** The win here is entirely
   **closedness**. Making `base_hash: String` a required parameter (it already
   is) changes nothing; making the *result* a four-armed enum is the whole thing.
   This rules out the obvious alternative of requiring `expected_hash` on the
   cloud upsert — see qualification 7.
3. **A type nobody constructs constrains nothing.** This is the qualification
   that decides the shape, and it is the whole reason **not** to open by wiring
   `merge_entity` into the cloud path. `ThreeWayResult` has one construction site
   and one consumer; `WorkspaceMergeOutcome` has **zero** of each in production.
   The missing ingredient is not the type, it is the *base*: `SyncState` rows
   exist for Obsidian entities and for nothing else, and `personas.content_hash`
   is NULL on 78 of 78 rows. **A merge enum introduced before a stored base is
   exactly the type this qualification forbids — and the repo has already built
   one and correctly left it unwired.** Ship the base (D2) and the producer (D1)
   first; then `merge_entity` has somewhere to be constructed and the fix is
   mechanical rather than a design.
4. **A type anyone can construct authenticates nothing.** `SyncConflict` is a
   plain `pub struct` with all-public fields and it **crosses the IPC boundary in
   both directions** (`obsidian_brain_resolve_conflict(conflict: SyncConflict,
   resolution: String)`), so the frontend can fabricate one. The repo already
   knows this and compensates correctly rather than pretending otherwise: the
   command re-derives containment from `conflict.file_path`
   (`mod.rs:1265-1271`) and re-hashes the destination against `conflict.vault_hash`
   before writing (`:1273-1285`). **That is the right posture — a caller-supplied
   conflict is untrusted input, and the guard is at the write, not at the type.**
5. **Withholding beats requiring.** `three_way_compare` withholds the ability to
   write. It returns a verdict and touches nothing, so no caller can "resolve"
   inside the comparison. Copy that: the comparison function must not take a pool.
6. **Withhold the dangerous freedom, not the answer.** The answer — both bodies,
   all three hashes — is fully handed over. What is withheld is the freedom to
   *pick a winner without asking*. `ThreeWayResult::Conflict` cannot be consumed
   into a write without the programmer visibly choosing to.
7. **Withholding a requirement only helps when the requirement was forcing the
   bad value.** Directly applicable, and it is why the tempting cloud-side fix is
   wrong. Making the upsert take `expected_hash: Option<String>` would let every
   caller pass `None` voluntarily — the degradation
   [conditional-write](./conditional-write.md) measured for
   `decide_knowledge_cas`. **And it cannot work anyway: the arbiter is PostgREST's
   `Prefer` header, which offers merge-duplicates or nothing.** The precondition
   would have to move into the *filter*, which is what `patch_returning_count`
   makes possible for PATCH and what upsert structurally cannot express.

**Does the type reach the code?** For the Obsidian path, entirely — the base, the
compare, the enum and the ruling are all Rust the compiler sees. **For the cloud
path, no, and the boundary is worth naming precisely.** Three walls, all of them
outside this repo's type system:

- **The merge rule is a string in an HTTP header.** `client.rs:77`
  `"resolution=merge-duplicates,return=minimal"`. `rustc` will compile any
  spelling. This is [conditional-write](./conditional-write.md)'s
  "inside a SQL string literal" wall, one layer further out.
- **The remote schema is not in the repository at all** (Gap 1), so no generated
  type, no `ts-rs`, no binding-drift job can reach it.
- **The identity of the row on the remote is a decision made in Supabase's
  console.** Whether `device_id` participates in the primary key — the single
  fact that decides whether two devices collide — is not expressible here.

**So the fix order is: (0) ship `ReadWatermark` and fix D3 + D11, which depends
on nothing; (1) write the tombstone producer (D1) — one INSERT, and it serves
both the shipped cloud path and Stage 3; (2) write `content_hash` +
`last_modified_device` (D2), which gives the base a home; (3) check the remote
schema into this repo (Gap 1), which is where drift has already occurred;
(4) then, and only then, wire `workspace_sync::merge_entity` into the cloud
lane — do NOT write a third merge engine; (5) keep §9's rule as the ratchet on
the watermark writes throughout, and delete it when it reaches zero.**

## 9 The missing gate

**The condition, stated stack-free:**

> *The only durable record of what two copies last agreed on is written for its
> side effect alone. If that write fails, nothing observes it — and the next
> reconciliation runs against a base it believes is current, so a silent
> persistence failure is laundered into a confident wrong answer about whether
> the two sides diverged.*

This is not "an error was swallowed". A watermark is the one fact in a sync
that **cannot be re-derived from either side** — it is the memory of the
agreement itself. Losing it is not degraded telemetry; it is amnesia that
presents as certainty.

An adopting repo must re-derive its own proxy. This one keys on Rust's
`let _ = <path>::<fn-name-containing-a-watermark-noun>(…)`. A TypeScript repo
spells the identical condition as `void saveCursor(x)` or
`saveCursor(x).catch(() => {})`, and this pattern scores a structural zero there
while the condition is present — measured in the sweep for §6.

**Existing rules checked for overlap, by reading each definition rather than its
title** (116 rules in the registry as of this composition):

| rule | what it covers | why it does not cover this |
| --- | --- | --- |
| `unverified-effect-dispatch` | `let _ = … .emit(…)` / `emit_event(…)` — a post-write **notification** whose delivery is unobserved. 60 files / 162 matches | Anchored on `emit`. A notification is re-derivable from the state it announces; a watermark is not. **Zero match-position overlap** — verified: no line matches both patterns. |
| `discarded-guard-verdict` | a guarded single-row `UPDATE` reached through `.execute("UPDATE … WHERE id = ?N AND …")` in statement position | Anchored on a SQL literal with a compound `WHERE`. All 11 of this rule's matches go through repository functions; none has a SQL literal at the call site. Disjoint by construction. |
| `blind-identity-write` | a `db/src/repos` fn returning `Result<()>` reaching a bare `WHERE id = ?` write | Scoped to `src-tauri/db/src/repos`; **all 11 matches here are outside that root**. And it is about the callee's signature, this is about the caller's statement. |
| `unfenced-work-outcome-write` | a terminal-status `UPDATE … WHERE id = ?` | About the outcome of claimed work, not about the memory of a sync. |
| `optional-store-handle` | `Option<DbPool>` at a boundary | Unrelated. |
| `unkeyed-billable-spawn` | `execute_persona_inner(… None, …)` | [idempotent-invocation](./idempotent-invocation.md)'s; unrelated anchor. |
| `process-global-caches-a-failure`, `silent-row-skip`, `untimed-repo-query` | statics, row mapping, timing | Unrelated. |

**No registry rule targets `src-tauri/src/cloud/**`, a PostgREST-shaped write, or
a watermark. Proposing one.**

**Precision 11/11 — every match opened and read.** The population is the **29**
production watermark-writer call sites in the tree (`set_cursor`,
`write_cursor`, `touch_cursor`, `update_cursor`, `upsert_sync_state`,
`set_watermark`, `seed_watermark_to_newest`), enumerated by hand and
partitioned:

| | matches | files |
| --- | ---: | --- |
| **anchor** — a watermark-noun call whose result is either dropped or propagated | **30** | 10 |
| ↳ **violating** (`let _ =`) | **11** | 4 |
| ↳ **compliant** (`?`) — the positive control | **19** | 6 |

11 + 19 = 30 accounts for every anchor match. Narrowed to *writers only* the
split is **11 violating / 18 compliant = the 29 hand-counted writer call sites,
exactly**. The control's 19th is a single **read** —
`assignment_repo::newest_event_cursor_for_team(…)?` at
`team_slack_relay.rs:461`, which matches only because its `let Some(…) =` sits on
the previous line so the pattern sees a clean line start. It belongs in the
compliant class for the purpose the control serves (proving the gate keys on
`let _ =` and not on the noun) and is disclosed rather than filtered out.
`read_cursor(pool, …)?` at `:459` and `get_watermark(pool)?` at `:590` are the
two other reads in these files and **neither matches**, because both sit after
`= ` or `if ` rather than at a statement boundary — checked, because a control
that quietly swept up every read would not be measuring what it claims.

**Zero matches sit inside `#[cfg(test)]`,** verified by brace-matched range
against all four files: `obsidian_brain/mod.rs`'s only `#[cfg(test)]` is a
`mod mirror_tests;` declaration at `:10` (all 8 matches are at `:651`–`:1687`);
`cloud/sync/mod.rs`'s test module starts at `:484` (match at `:393`);
`shared_event_relay.rs`'s at `:245` (match at `:170`);
`shared_event_local_relay.rs` has none and its match is at `:96` of 99, inside
`run_once`.

**One recall gap, disclosed with its consequence.** The most damaging instance of
this condition in the repo is **not matched**: `cursor.rs:110`
`let _ = settings::set(pool, settings_keys::CLOUD_SYNC_DEVICE_ID, &new_id)`
persists the **replica identity** through a generic settings setter whose name
carries no watermark noun (§7 D7). Widening the noun list to `settings::set`
would take the count from 11 to ~200 and destroy precision. **D7 must be fixed by
hand; the gate will not remind anyone** — the same disclosure
[conditional-write](./conditional-write.md) made for its `prepare_cached` miss,
and for the same structural reason.

**Where it executes.** `npm run census:check` runs in the **`golden-path-census`
pre-push lefthook job** (`lefthook.yml:74-75`) and inside `npm run check`
(`package.json:52`). Both are local and both are the developer's own machine —
not CI. That job exists because, as its own comment records
(`lefthook.yml:58-64`), the census *"was enforced NOWHERE"* until 2026-08-16.
This rule inherits fail-loud from the runner: a walk under `floor: 900` (the tree
is 963), a rule matching zero files, a stale `exclude`, a rise, **and a silent
drop** all exit non-zero.

### The rule

```json
{
  "rules": [
    {
      "id": "discarded-sync-watermark-write",
      "goldenPath": "docs/concepts/golden-paths/sync-reconciliation-and-conflicts.md",
      "title": "The write that records what two copies last agreed on is evaluated for its side effect alone, so a failure to persist the agreement is laundered into a confident wrong answer on the next pass",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\blet\\s+_\\s*(?::[^=;\\n]{0,60})?=\\s*(?:[A-Za-z_]\\w*\\s*::\\s*){0,4}[A-Za-z_]\\w*(?:cursor|sync_state|watermark|checkpoint|high_water|synced_at)\\w*\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "`let _ = <path>::<fn>(..)` where the called function's own name ends in a sync-watermark noun (cursor / sync_state / watermark / checkpoint / high_water / synced_at). PROXY FOR the stack-free condition: the only durable record of what two copies last agreed on is written for its side effect alone, so if the write fails nothing observes it, and the NEXT reconciliation runs against a base it believes is current - a silent persistence failure laundered into a confident wrong answer about whether the two sides diverged. THIS IS NOT 'AN ERROR WAS SWALLOWED': a watermark is the one fact in a sync that cannot be re-derived from either side, because it is the memory of the agreement itself. MEASURED 2026-08-16 at 2a874e692: 11 matches across 4 of 963 .rs files, ALL ELEVEN OPENED AND CONFIRMED (precision 11/11), commentMatchesSkipped 0. Population and partition: 29 production watermark-writer call sites exist in the tree (set_cursor, write_cursor, touch_cursor, update_cursor, upsert_sync_state, set_watermark, seed_watermark_to_newest), enumerated by hand; this pattern's anchor sees 30 statements (11 dropped + 19 propagated, the extra 1 being reads of the same watermark) and the writer-only split is 11 violating / 18 compliant - so 38% of this repo's watermark writes discard the verdict and 62% do not, and the discipline is NOT evenly spread: every poller and relay propagates, and 8 of the 11 discards are one function family. THE 11: commands/obsidian_brain/mod.rs:651,741,820,955,1013,1043,1241,1687 (`let _ = sync_repo::upsert_sync_state(..)`) - these are the sharpest, because that file's three_way_compare (commands/obsidian_brain/conflict.rs:36) compares the CURRENT app and vault hashes against the stored base, so a base hash that failed to persist makes the next pass see both sides as changed and report a ConvergedConflict to the user that did not happen; three sites in the SAME FILE (:364, :1305, :1376) use `?`, so this is drift inside one module and not a house style. cloud/sync/mod.rs:393 (`let _ = cursor::set_cursor(pool, \"tombstones\", &tick_start)`) - two defects in one line: the value is a WALL-CLOCK read (tick_start = now_rfc3339() at :374) and the same file's :272-281 carries a nine-line comment explaining why that is wrong and was fixed for the table path at :281, plus the Result is dropped. engine/shared_event_relay.rs:170 and engine/src/shared_event_local_relay.rs:96 (`let _ = repo::update_cursor(..)`) - the team event relay's per-subscription cursor; :96's own comment three lines above says 'Hold the cursor at the last successful seq so ordering is preserved', which is exactly the invariant the dropped Result cannot guarantee. ZERO MATCHES INSIDE #[cfg(test)], verified by BRACE-MATCHED RANGE against all four files (never a line threshold): obsidian_brain/mod.rs's only #[cfg(test)] is a `mod mirror_tests;` DECLARATION at :10 while every match is at :651-:1687; cloud/sync/mod.rs's test module opens at :484 (match at :393); shared_event_relay.rs's at :245 (match at :170); shared_event_local_relay.rs has no test module at all and its match is at :96 of 99, inside run_once. DOES NOT OVERLAP `unverified-effect-dispatch`, which is the nearest neighbour and the one to check: that rule is `let _ = .. .emit(..)` / emit_event(..) at 60 files / 162 matches, anchored on the EMIT, and no line in the tree matches both patterns - the distinction is semantic and load-bearing, because a notification is re-derivable from the state it announces and a watermark is not. Nor `discarded-guard-verdict` (anchored on a `.execute(\"UPDATE .. WHERE id = ?N .. AND ..\")` SQL literal at the call site; all 11 here go through repository functions and carry no SQL). Nor `blind-identity-write` (scoped to src-tauri/db/src/repos; all 11 are outside that root, and it keys on the CALLEE's signature where this keys on the CALLER's statement). Nor `unfenced-work-outcome-write`, `optional-store-handle`, `unkeyed-billable-spawn`. No rule in the 116-rule registry targets src-tauri/src/cloud/**, a PostgREST-shaped write, or a watermark. ONE DISCLOSED RECALL GAP, and it is the most damaging instance in the repo: cloud/sync/cursor.rs:110 `let _ = settings::set(pool, settings_keys::CLOUD_SYNC_DEVICE_ID, &new_id)` persists the REPLICA IDENTITY through a generic settings setter whose name carries no watermark noun, so it is invisible here - and its failure mode is worse than any match (resolve_device_id is an unguarded read-then-write with three concurrent entry points, so a loser stamps an entire sync pass with an id that was never stored and pending_commands?target_device_id=eq.<id> then matches nothing). Widening the noun list to settings::set takes the count from 11 to ~200 and destroys precision; that site must be fixed by hand. PRECONDITION (must be re-derived per repo): this repo spells the drop as Rust's `let _ =` and names its watermark writers with a noun in the function name. A TypeScript repo spells the identical condition `void saveCursor(x)` or `saveCursor(x).catch(() => {})` and scores a structural zero against this pattern while having the condition. LEGAL FIX, one character each: change `let _ =` to a bound value and propagate with `?`. The compliant form is in the same files - commands/obsidian_brain/mod.rs:1305 and cloud/sync/mod.rs:282. Do NOT silence a match by wrapping in `.ok()` (discards the Err too) or by renaming the function to drop the noun. END OF LIFE: this rule is designed to reach zero - all 11 are one-character fixes. When the count reaches 0 the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "baseline": { "files": 4, "matches": 11 },
      "floor": 900
    }
  ]
}
```

**No `exclude` entries.** There is no legitimate file-level exemption — the
compliant spelling is one character away everywhere — so no stale suppression can
accumulate.

**`floor: 900`** matches every other `src-tauri`-rooted rule deliberately;
several rules over one root must not hold several opinions about what "the Rust
tree is intact" means. The walk reports **963**, exactly `rust.files` in
[`shared-facts.json`](../shared-facts.json).

**On severity.** The census mechanism's own semantics are the severity: drift is
fatal under `npm run census:check`, which runs pre-push and inside
`npm run check`. No argument from warning volume is offered or would be valid
(doctrine §3). The rule is a **ratchet held until the base store exists**, not the
fix; the fix is in "Prefer a type over a gate", and the instrument that would
catch D1/D2/D10 is not this — it is the schema file specified in Gap 1 and a
`grep`-shaped test asserting every tombstone-consuming table has a producer.

### Positive control (evidence, NOT merged as a gate)

The same watermark-noun call heads, reached at a statement boundary and
propagated with `?` instead of dropped.

```json
{
  "id": "discarded-sync-watermark-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/sync-reconciliation-and-conflicts.md",
  "title": "POSITIVE CONTROL - the same watermark accessors whose Result is propagated",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "(?:^|[;{}])\\s*(?:[A-Za-z_]\\w*\\s*::\\s*){0,4}[A-Za-z_]\\w*(?:cursor|sync_state|watermark|checkpoint|high_water|synced_at)\\w*\\s*\\((?:[^()]|\\([^()]*\\))*\\)\\s*\\?",
    "flags": "gm",
    "ignoreCommentLines": true,
    "description": "CONTROL, not a gate. The IDENTICAL watermark-noun call head as discarded-sync-watermark-write, preceded by a statement boundary instead of `let _ =` and terminated by `?`. Measured 2026-08-16 at 2a874e692: 19 matches across 6 files against the gate's 11 across 4 - engine/team_slack_relay.rs (5), engine/slack_poller.rs (4), engine/webhook_notifier.rs (4), commands/obsidian_brain/mod.rs (3), engine/discord_poller.rs (2), cloud/sync/mod.rs:281 (1). This is a PARTITION, not a ratio: 11 + 19 = 30 accounts for every anchor match. Narrowed to WRITERS only the split is 11 / 18, which is EXACTLY the 29 watermark-writer call sites counted by hand. The single extra is a READ - assignment_repo::newest_event_cursor_for_team(..)? at team_slack_relay.rs:461, which matches only because its `let Some(..) =` sits on the PREVIOUS line so the pattern sees a clean line start; it is disclosed rather than filtered out because the control's job is to prove the gate discriminates on what happens to the Result and NOT on the noun. The two other reads in these files - read_cursor(..)? at team_slack_relay.rs:459 and get_watermark(..)? at webhook_notifier.rs:590 - do NOT match, because both sit after `= ` or `if ` rather than at a statement boundary; checked deliberately, because a control that quietly swept up every read would not be measuring what it claims. If the gate were keying on the token `cursor` it would match all 30. Note the reported line numbers run one LOW versus the call, because the pattern's anchor is the `[;{}]` that ends the PREVIOUS statement, which usually sits on the previous line. Run both together whenever the gate's pattern is edited: if this control's count collapses toward the gate's, the shared anchor has broken and BOTH numbers are meaningless - that is the failure this control exists to make visible. It is expected to RISE as the 11 are fixed (each fix moves one match from the gate to the control), which is exactly why it carries NO baseline: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved. scripts/census/lib/engine.mjs exempts a `-positive-control` id from the baseline requirement and merge-published-rules.mjs skips it by construction."
  },
  "floor": 900
}
```

### Refused: a gate on the tombstone-with-no-producer condition — with the reason

D1 is the largest finding in this document and it is **not gateable by the
census, by construction**. The defect is an **absence**: a table that is read and
never written. Counting occurrences of a bad shape cannot express "this table has
no `INSERT`", because there is no bad shape — there is a missing statement, in a
file that has no other reason to mention the table. The census "cannot assert an
ABSENCE" limit
([doctrine §4](../golden-path-doctrine.md#4-census-rules)) applies exactly.

**The right instrument is a Rust test, and it is cheap:**

> `every_consumed_table_has_a_producer` — build `init_test_db()`, read
> `sqlite_master` for the table list, then for each table name that appears in a
> `SELECT` literal under `src/cloud/**` assert the same name appears in an
> `INSERT` literal somewhere in `src-tauri`. **Assert the instrument before the
> result** — `tables_seen > 200 && select_literals > 5` — the shape
> [foreign-key-policy](./foreign-key-policy.md) §3 built for the dangling-parent
> case and [second-database](./second-database.md) §9 specified for the
> wrong-pool case. Run today, it fails on `persona_tombstones`.

### Refused: a gate on the clock-derived watermark — with the numbers

The tempting second rule is "a watermark advanced from `now()`" (D3, D11). It was
built and refused.

| candidate | matches | true positives | precision | recall |
| --- | ---: | ---: | --- | --- |
| **A** — a watermark-noun call with `Utc::now()` / `now_rfc3339()` **in the argument** | 1 | 1 | 100% | **1 of 2** |
| **B** — A, widened to a local binding assigned from a clock within 20 lines | ~9 | 2 | ~22% | 2 of 2 |

**Candidate A finds `push.rs:306` and structurally cannot find `mod.rs:393`,**
because the latter passes `&tick_start`, a variable bound 19 lines earlier
(`:374`). One match, and it misses the instance this document opened with.
**Candidate B reaches both and drops to ~22% precision**, because a clock read
near a watermark write is usually the row's own `updated_at`.

And the deeper reason to refuse is that **the condition is not textual at all**:
`ascent`'s `nextScanAt` is computed from `Date.now()` at three sites
(`org-watch.ts:214`, `:231`, `:245`) and is **correct** — it answers "when should
I next look", not "how far have I read". `brainiac`'s `last_run_at = now()`
(`sweeps.rs:243`) is correct for the same reason. A regex cannot tell a schedule
pointer from a read watermark, and getting that wrong means firing on correct
content, which the contract rules out. **What separates them is a type — a
`ReadWatermark(String)` that only `max()` over observed rows can construct — and
that is where this belongs, not in a matcher.**

Two more conditions have no textual signal at all and are named rather than
gated:

- **A watermark column that the row's writers never touch** (D4). Deciding it
  requires joining "which column is passed as `cursor_col`" to "which columns the
  table's `UPDATE` statements set" — two facts in different files. It needs the
  same fixture-backed test.
- **The remote schema drifting from the Rust projection** (D10 / Gap 1). Not a
  gate at all until the schema is in the repository; then it is a subset
  assertion plus "every table a client reads has a writer", and the file *is* the
  fix. This one has already fired in production and nobody saw it.

---

## 12 Corrections to the brief

**12.1 — "check what still uses the old `patch` and whether any of those needed a
precondition." Answered, and then handed back.** Two callers remain, both in
`remote_commands.rs` (`:105` `set_command_status`, `:145` the poll's auto-expire),
both `let _ =`, and `:105` is the sharper of the two — it settles a terminal
status with **no status filter and no device filter**, so a reject landing while
the agent runs can be clobbered by the completion write. **But those four sites
are already [idempotent-invocation](./idempotent-invocation.md)'s §7 D3, listed
there on 2026-08-16 with the exact fix strings.** This document does not re-list
them. The correction to the brief is that the interesting `patch` question in
*this* leaf's territory is the one nobody has asked: **`upsert` has no
count-returning sibling and cannot have one**, because the arbiter is
`Prefer: resolution=merge-duplicates` and PostgREST offers no conditional upsert.
That is a wall, not an omission, and it is in "Prefer a type over a gate".

**12.2 — "10 of 11 cloud-sync tables are unredacted on the way out." Correct, and
the framing is inverted.** The count is right: `redact_secrets` is reached only
through `sanitize_event_payload` → `project_event_payload` → `row_to_event`, so
exactly one of eleven projections is scrubbed. **The implied conclusion — point it
at the other ten — is measurably harmful.** See 12.3.

**12.3 — the measured exposure, and why the obvious fix is wrong.** I ported
`key_is_secret` / `value_looks_secret` / `redact_secrets` (`rows.rs:45-95`) to
JavaScript verbatim and ran them over every projected column of every live row.
**4,524 of 22,235 rows would trip the redactor.** Decomposed by which arm fires:

| arm | hits | hand-verified sample | verdict |
|---|---:|---|---|
| **density** (≥60 chars, no whitespace, ≥90% base64/hex alphabet) | **3,830** | 14/14 | **all false** — `docs/adr/ADR-0005-bounded-repository-interfaces-for…`, `https://github.com/xkazm04/xprize-grant-writing-non…`, `ResultPanel/DocumentStudio/NegotiationStudio/Eligib…` |
| **prefix** (`sk-`, `AKIA`, `ghp_`, …) | **11** | 11/11 | **all false** — every one is prose *listing credential prefixes*, e.g. a 21-char token reading `AKIA/AIza/sk-/…` inside an agent's own write-up of a secret-scanning task |
| **secret-looking JSON key** | **1** | 1/1 | **false** — `personas.design_context :: credentialLinks`, an object of links |

So the honest exposure on this installation is **zero measured credentials**, and
running `redact_secrets` over the other ten projections would replace ~3,830
rows' `output_data` / `content` with `"[redacted]"` while catching none. The
class is real — nothing structurally prevents a token landing in
`persona_executions.output_data` — but the fix is a *different predicate*, not a
wider aim (§8 Gap 6). Two facts explain why the existing one is safe where it
lives: `persona_events.payload` is **4,972 of 4,972 encrypted at rest**, so every
value the redactor sees has already been decrypted from a structured payload, and
`sanitize_event_payload` returns `None` for anything that is not JSON — the
density arm never meets free prose.

**12.4 — "`companion_dev_op.fleet_session_id` is 4 of 4 dangling; 7 cross-store
edges exist with no marker." True, and not this leaf's.** Those are two SQLite
files on one machine and they are
[second-database](./second-database.md)'s §7 P1-d, measured there on 2026-08-15
with the same numbers. A `-- CROSS-STORE:` marker is that path's prescription and
I have nothing to add to it. **What this leaf owns is the row that exists on this
machine and on another one** — and there the equivalent marker is worse off than
a comment: the columns exist (`personas.content_hash`,
`personas.last_modified_device`) and are empty (D2).

**12.5 — "there is exactly one client-supplied precondition in the app (three,
per a later correction)." Three is right for the SQLite side and this leaf adds a
fourth surface that has none.** `expectedUpdatedAt`, `expectedStatus` ×2, per
[conditional-write](./conditional-write.md) §6. The reconciliation surfaces add:
Obsidian's `conflict.vault_hash` re-check (`mod.rs:1273-1285`) — a genuine
client-supplied precondition, **checked before the write**, which brings the true
count to **four**; and the credential-import resolution map, keyed by **name**
with no `existing_id` on the wire, which is a fifth surface that should have one
and does not (D9).

**12.6 — "`personas-cloud` dropped the compare-and-set entirely." Confirmed, and
it is the wrong repo to look at for this leaf.** `trigger_version`: **0
occurrences** in the whole repo, re-verified; every event-status transition is an
unconditional `UPDATE … WHERE id = ?` (`packages/orchestrator/src/db.ts:776`,
`:809`, `:819`, `:841`). But `personas-cloud` has **no cursor, no tombstone and
no persisted device identity either** — it has no replication problem, so it is
evidence about `conditional-write`'s leaf and silence about this one. The
sibling that actually carries this leaf's clauses is `vibeman`, and it inverts
the brief's expectation in the other direction (12.9).

**12.9 — a correction to my own first draft, which the convergence oracle
forced.** I composed §6 around "this repo has one conflict detector, in
`obsidian_brain`". **It has two.** `engine/src/workspace_sync/merge.rs` is 406
lines and 12 tests: a three-way merge generic over `SyncSnapshot`, with
`WorkspaceEntity::Tombstone` as a first-class variant and a *total, symmetric*
`last_writer_wins` (`:140-157`). I missed it because I swept for the mechanism
(`three_way`, `base_hash`, `conflict`) inside `src/` and `db/`, and it lives in
the `engine` crate under a name — `workspace_sync` — I had not thought to search.
**This is precisely the failure doctrine §5 warns about**: *"search for its NAME
as well as its mechanism."* I committed it inside my own repo, not across a
sibling.

The correction is not cosmetic — it inverts D1's story. `persona_tombstones` is
not a table someone forgot to populate; it is **that module's** table, shipped in
Stage 1 with an honest header saying the writer lands in Stage 3+, and the cloud
sync writer in another crate built a nine-table cascade on top of it anyway. The
finding got sharper and the blame got more interesting: the defect is a
**cross-crate dependency on a declared-unfinished foundation**, which no type,
lint or test in this repo can currently express (§8 Gap 8).

**12.10 — and a clause the brief did not have, which the oracle produced.** The
brief framed the ideal as "detect divergence and get a per-item human ruling" —
the spine's own `why`. **Five of six repos never ask a human, and
`workspace_sync/mod.rs:16-18` argues correctly that for two devices belonging to
one person, a deterministic LWW *is* the right answer and no conflict UI is
required.** So the universal clause is not "ask". It is **"compute the winner
from the data, so both sides get the same answer"** — and by that standard the
Obsidian lane (ask) and the workspace_sync lane (deterministic LWW) are both
correct, and only the cloud lane, where the winner is network arrival order, is
not. §2 was rewritten around this.

**12.7 — the brief asked four questions; the answers are:** what syncs, and in
which direction — **11 tables, push-only, zero reads back**. What the cursor is
and what happens if it is lost or rewound — **a per-table RFC3339 string in
`app_settings`; losing it re-pushes from the epoch — the 4 tables flagged
`full_backfill` (`personas`, `memories`, `knowledge_patterns`, `triggers`) — or
from 90 days ago for the other 7 (`cursor.rs:40-44`), which is safe because the
remote merge is idempotent, and *lossy* for the 7: anything older than 90 days
that was never pushed can never be. **Rewinding is recoverable; *advancing*
wrongly is not, and `mod.rs:393` still does**. Whether a
delete propagates or resurrects — **neither: it is simply never sent, because the
tombstone table has no producer (D1)**. Whether two devices editing the same row
is representable — **yes, and undetectably: the remote merges on `id` alone,
`device_id` is a passenger, and no local code reads the result (D8)**.

**12.8 — a fifth answer the brief did not ask for, and it is the one that
matters:** *what is the user told when local loses?* On the Obsidian path, a
line-level diff and a two-button ruling. On the import path, a name and a
three-way choice. On the cloud path, **nothing** — `CloudSyncStatus`
(`mod.rs:108-124`) has eight fields and not one of them could hold a divergence,
because there is no producer for one, because nothing looks.
