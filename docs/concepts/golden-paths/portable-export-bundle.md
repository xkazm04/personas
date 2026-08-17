# Golden path — the portable export bundle

> Situation node: `integrations-security/vault-security/portable-export-bundle` ·
> [situation spine](../situation-spine.md) · recurrence 7 · risk **HIGH** ·
> sides **client** (**corrected: two-sided, and the client half is the only half that refuses — see §0.1**) ·
> convergence **mixed** · dimensions: **security · function · resilience · code-quality**
> Composed 2026-08-16 against `master` @ `cd9d094d9`.
>
> **Sweep.** `commands/core/data_portability.rs` (12,704 lines) read across every export, import,
> validation, crypto and skills-to-disk region; `commands/core/import_export.rs`,
> `engine/bundle.rs` (1,010), `engine/src/enclave.rs` (322), `commands/network/bundle.rs` (493),
> `ipc_auth.rs`, and the client half — `api/system/dataPortability.ts`,
> `sub_portability/{libs/useDataPortability.ts, components/export-prototype/useExportPicker.ts,
> components/CredentialPortability.tsx}`, `sub_network/components/BundleImportDialog.tsx`.
> **963 `.rs` files** walked by the census engine; **1,658** `#[tauri::command]` definitions parsed
> for their success type by two independent implementations.
>
> **Measured by executing, not reading.**
> 1. **The export's serialization logic was replayed against READ-ONLY COPIES of both live
>    databases** (`personas.db` 347 MB, `personas_data.db` 17.5 MB, copied with their `-wal`/`-shm`
>    at 2026-08-16 16:20). Every section of `PortabilityBundle` was rebuilt from the same columns
>    `build_export_bundle` reads and JSON-serialised, and the credential-export loop's builtin-skip
>    was replayed row by row. §0 is that result. **No export was invoked, no bundle was written
>    outside the scratchpad, nothing was imported, no live file was opened for write.**
> 2. Two independent implementations of the command census (a brace-matched line walker and a
>    whole-file non-consuming regex, no shared code) — **1,658 vs 1,656 commands, 125 vs 124
>    `Result<bool>`**; the ±2 is reconciled in §12.7. They agree **exactly** on the partition that
>    matters (5 violating / 16 compliant).
> 3. The §9 rule was built in a **private scratch registry with a filename unique to this composer**,
>    exercised through all four of the runner's fail-loud modes, overlap-checked by running all 119
>    existing rules over my two match files, then re-extracted from this finished document and
>    re-run. **The full registry was NOT run**, per the doctrine.
>
> **NEVER PRINT A SECRET.** No secret value, prefix or partial appears below. Credential findings
> are reported as shape, column, length and count. Nothing was decrypted.
>
> ### Sibling boundaries, settled in prose
>
> [**column-encryption-at-rest**](./column-encryption-at-rest.md) owns the secret **in a column**.
> [**secret-display-and-transfer**](./secret-display-and-transfer.md) owns the secret **in motion**
> — the clipboard, the IPC response, the redaction pattern set. **This path owns the artifact**: what
> a file that leaves this process actually contains, what the process that reads one back trusts, and
> whether the round trip is the same shape in both directions. Where we overlap on `export_credentials`,
> that path established *"no export path carries a decrypted credential in the clear"* — **true, and
> §0.2 is the correction it could not see: on this install that command carries no credential at all.**
>
> [**untrusted-definition-validation**](./untrusted-definition-validation.md) owns *is this incoming
> object legal* — its §7.B (`import_composition_workflows`), §7.C (`root_path`) and §7.D
> (`sig_valid`) are cited here, extended, and in one case **corrected** (§12.3). This path owns the
> other direction and the seam: *what did we hand out, and does the door that reads it back refuse.*
>
> [**ipc-session-token-race**](./ipc-session-token-race.md) owns *the credential on the invoke*, and
> already established that `export_full` / `export_credentials` / `import_portability_bundle` /
> `import_credentials` are commented out of `PRIVILEGED_COMMANDS` with `require_privileged` (async,
> unfalsifiable) as their only guard. **Taken as given here, not re-derived** — §0.2 is what that
> ungated door actually does when you call it.
>
> [**informed-consent-gate**](./informed-consent-gate.md) owns the confirm dialog;
> [**filesystem-boundary**](./filesystem-boundary.md) owns path containment;
> [**second-database**](./second-database.md) owns the two-store split that §7.E lands in.
>
> The **Deviations** section is a fix backlog and contains **one P0 that is live on the operator's
> machine right now** (§7.A), **one signature that authenticates nothing** (§7.B), and eight repairs.

---

## 0. The headline, before anything else

**This repo has the only encrypted export envelope in six codebases, and the command whose doc
comment is "Export all credential secrets to a password-protected encrypted file" writes an
envelope containing zero of this install's 25 credentials — and returns `Ok(true)`.**

### 0.1 — The gate is in React

Three IPC doors import a signed `.persona` bundle. All three call `bundle::apply_import`
(`engine/bundle.rs:392`), which computes the signature verdict at `:406` and uses it at `:497` as a
**provenance field on the row it just wrote**:

```rust
// engine/bundle.rs:406        the verdict
let (sig_valid, _signer_trusted) = verify_against_trusted_key(pool, &sig, manifest_bytes.as_bytes());
// engine/bundle.rs:497        its only consumer
signature_verified: sig_valid,
```

The refusal lives here, in a React component:

```tsx
// src/features/settings/sub_network/components/BundleImportDialog.tsx:400-427
preview.signature_valid
  ? <button onClick={handleImport}>{st.import_btn}</button>
  : (() => {
      const requiredKind = preview.signer_trusted ? 'tamper' : 'unknown';
      const matchedKind  = dangerConfirmed === requiredKind;
      return <button disabled={!matchedKind} …>{st.import_anyway}</button>;
    })()
```

That component is **good** — it re-arms consent whenever `bundle_hash`, `signer_trusted` or
`signature_valid` changes (`:88-92`), and a "tamper" acknowledgement does not unlock "unknown
signer". It is also the entire enforcement. `apply_bundle_import` (`network/bundle.rs:61`) spends
40 lines on a genuinely rigorous **TOCTOU** guard — mandatory hash when a preview happened
(`:89-95`), byte re-hash against the previewed hash (`:96-110`) — and **zero lines on the
signature**. So a bundle whose signer is unknown, or whose signature is invalid, is refused by a
button and accepted by the backend.

**The same file family already wrote down the rule this breaks.** 200 lines from the
`export_credentials` body, `require_passphrase_for_selection` has this doc comment:

> *"The frontend gates this too (`passphraseMissing` in `useExportPicker`), but the frontend is not
> the boundary — anything that can invoke can skip it."* — `data_portability.rs:1898-1899`

One module refused to trust the client and said why. Its neighbour, for a stronger claim
(authenticity, not passphrase length), trusts it completely.

### 0.2 — The measured contents of an export, replayed against the live databases

| section | what it carries | measured (this install) |
|---|---|---:|
| `personas` + triggers + subscriptions + **memories** | rebuilt field-by-field; `design_context`, `system_prompt`, trigger `config` and **6,535 memory bodies** verbatim | **32,653,604 B** (78 personas, 351 triggers, 102 subs) |
| `project_skills` (on disk, `<root>/.claude/skills/**`) | every markdown file ≤256 KiB, **uncapped in count** | **14,072,899 B** (1,598 files, 13 of 14 projects) |
| `workspace_knowledge` | `detail_md` + `statement` verbatim | **2,473,251 B** (1,306 entries) |
| dev-project graph (goals/ideas/tasks/contexts/use-cases/milestones/…) | rows with original uuids + timestamps | **1,670,003 B** |
| `teams` + team memories | | **395,451 B** |
| `credentials` (**plaintext, always present**) | `name`, `service_type`, **and `metadata` verbatim** | **99,622 B** for 25 rows |
| `kpis` | active + paused only | **32,880 B** (39 of 65) |
| `tool_definitions` | | **36,520 B** (170) |
| **compact total** | | **51,434,230 B = 49.05 MiB** |
| **after `to_string_pretty`** (ratio 1.0161, measured on the persona section) | | **≈ 52,262,000 B = 49.84 MiB** |
| **the ceiling its own importer enforces** — `MAX_DECOMPRESSED_SIZE`, `data_portability.rs:4966` | | **52,428,800 B = 50 MiB** |

**99.7% of the ceiling, with ~166 KB of headroom, and the figure is a lower bound** — it excludes
the encrypted twins section, the encrypted Athena section, and the `encrypted_credentials` envelope,
all three of which are strictly additive when a passphrase is supplied. **One more 170 KB memory and
this install's `export_full` writes a file its own `import_portability_bundle` refuses to open**, and
neither end can see it coming: `compute_export_stats` (`:1605`) forecasts **seven** caps
(`:1673-1684` — personas, tools, teams, credentials, KPIs, projects, twins), **all of them counts,
none of them bytes**, and the byte cap is the one that binds. The two biggest sections
(`persona_memories` at 63% and `project_skills` at 27%) are between them 90% of the bundle and
**neither is capped by the exporter at all** — while twins are capped at 10 and KPI measurements at 100.

### 0.3 — `export_credentials` exports nothing, and the sibling door 200 lines away exports everything

```rust
// data_portability.rs:9553   "Export all credential secrets to a password-protected encrypted file."
let builtin_names: HashSet<String> = connector_repo::get_all(pool)      // :9572
    .unwrap_or_default().into_iter().filter(|c| c.is_builtin)
    .map(|c| c.name.to_lowercase()).collect();
for cred in &all_creds {
    if builtin_names.contains(&cred.service_type.to_lowercase()) { continue; }   // :9582
```

Replayed against the live database:

```
connector_definitions:                    134 rows, is_builtin = 1 on 134 of 134
persona_credentials:                       25 rows, 23 distinct service_type values
service_types matching a builtin name:     23 of 23
--------------------------------------------------------------------------
export_credentials would emit:              0 credentials,  0 fields
build_encrypted_credentials would emit:    25 credentials, 42 fields (36 sensitive)
```

`build_encrypted_credentials` (`:9347`), the unified-export twin that runs when you tick
"credentials" in the export picker, is the **same loop with the same `cred_repo::get_all` and the
same `get_decrypted_fields`, minus the eight-line builtin filter**. Two doors, one file, 200 lines
apart, opposite decisions — and the one that skips everything is the one named for the job.

The failure is total and silent in both directions:

- **Nothing checks `entries.len()`.** The envelope is built, PBKDF2'd, AES-256-GCM'd and written
  (`:9604-9661`) whether it holds 25 credentials or none.
- **The return type cannot say.** `-> Result<bool, AppError>` (`:9560`), where `true` means *the user
  picked a save path* (`:9661`) and `false` means *they cancelled* (`:9664`). The UI reads it exactly
  that way: `setCredExportStatus(saved ? 'success' : 'idle')`
  (`useDataPortability.ts:232-233`). **A vault export that carried nothing renders as success.**

This is §9's rule, and it is the reason the type answer in §4 is a *yes*.

### 0.4 — What a bundle carries that nobody enumerated

`CredentialMetaExport` (`:454`) is documented *"Non-secret credential metadata … Secrets are NOT
included"* and its third field is `metadata: c.metadata.clone()` (`:2596`) — **the whole blob,
verbatim, into the plaintext section of a passphrase-less zip.** Measured across the 25 live rows:

| key | rows | bytes | what it is |
|---|---:|---:|---|
| `healthcheck_results` | 25 | **72,889** | **verbatim probe output from the remote API** |
| `anomaly_score` | 25 | 5,148 | usage telemetry |
| `healthcheck_last_message` | 25 | 1,491 | **verbatim, whatever the remote API said** |
| `healthcheck_last_success_at` / `_tested_at` / `_state` / `_success` | 25 | 2,224 | probe bookkeeping |
| `last_used_at`, `usage_count` | 25 | 986 | telemetry |
| `oauth_*` (7 keys) | 2 | 244 | refresh lifecycle |
| `description`, `is_builtin`, `always_active` | 4/4/1 | 441 | display |
| **total** | 25 | **89,757** | |

Scanned value-by-value with the eleven credential shapes
[column-encryption-at-rest](./column-encryption-at-rest.md) established: **zero literal
credential-shaped values in `metadata` today.** But **2 of the 25 blobs contain a `[secret]` mask
marker**, which is the write-path sanitizer (`credentials.rs:642`) recording that it *has already
fired on this channel* — and that sanitizer masks 7 of 20 real token shapes, measured. So the
channel is proven live and the redactor guarding it is proven partial.

The clear leak is next door: **`persona_memories.content` carries 2 literal labelled credential
assignments** (the same 2 that path found unredacted at rest), and all 6,535 memory bodies travel in
the plaintext `personas` section of any bundle exported without a passphrase.

### 0.5 — The round trip is not idempotent, and the operator's vault already shows it

`import_bundle` writes credential shells named `format!("{} (imported)", c.name)` (`:6017`) and
dedupes on **that** name (`:6023-6028`). Export → import → export → import therefore accumulates
suffixes. Live, on this machine:

```
persona_credentials by "(imported)" occurrences:   0 → 12 rows    1 → 2 rows    2 → 11 rows
personas 0/78 · persona_teams 0/8 · dev_projects 0/14 · twin_profiles 0/1
```

**11 of 25 credential rows carry `(imported) (imported)`.** The credential path is the only section
that has actually round-tripped on this install, and it is the only section whose identity is a
name the importer mutates. `import_transactions` holds **155** rows (145 committed, 10 rolled back)
— and per [untrusted-definition-validation](./untrusted-definition-validation.md)'s measurement,
every one has `entity_results = '[]'`.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head carries no file path,
primitive name or count, so an adopting repo can tell physics from local calibration.

> **P1 — physics, and the subject.** *An artifact is a second implementation of your schema, written
> once and read by a program you will not be present for.* The moment bytes leave the process, the
> exporter and the importer are two programs. Everything that is normally guaranteed by them sharing
> a heap — that a field exists, that a hash was checked, that an id is yours — becomes a claim one
> makes and the other must test.
>
> **P2 — physics, and the most replicated finding in this sweep.** **A marker written on the way out
> and never read on the way back in is not integrity; it is decoration.** Version stamps, content
> hashes, signatures and row counts all decay into this shape, and they decay *quietly*, because the
> producing side keeps working. Before you add a marker to a format, name the line of code that will
> refuse because of it. If you cannot, do not add the marker — its presence is what stops the next
> person from looking.
>
> **P3 — physics.** *A signature over a manifest authenticates the manifest.* If the payload lives in
> a separate member of the archive, the only thing binding it to the signature is a digest **inside**
> the manifest — so a digest that nothing recomputes leaves the payload unsigned while the archive
> reads as signed. Verify over the **exact bytes that were signed**, and verify the digest chain all
> the way to the bytes you are about to execute.
>
> **P4 — physics.** *A refusal that lives in the view is not a refusal.* Anything that can call the
> importer can skip the view. If the producing side of your app already writes "the frontend is not
> the boundary" in a comment, that sentence is a repo-wide invariant, not a local one.
>
> **P5 — physics.** **An exporter's success type must be able to say what it carried.** A boolean
> conflates *the user cancelled*, *it worked*, and *it worked and carried nothing* — and the third is
> the one that ships. Return the counts. This is the single cheapest edit in this document and it is
> the one that would have caught the worst defect.
>
> **P6 — physics.** **An inclusion policy expressed as a `continue` in a loop has no floor.** A
> filter that skips a class of rows can skip all of them; the only thing that makes that observable
> is a post-condition on what survived. Filters get written when the class is small and become total
> when the taxonomy moves — the class stayed "non-builtin", the world became all-builtin, and nobody
> re-measured.
>
> **P7 — physics.** *Two doors to the same data will disagree, and the disagreement will be invisible
> because each is individually reasonable.* Whenever a capability grows a "unified" variant beside its
> standalone one, the two inclusion policies drift. Give them one implementation, or write a test that
> asserts they emit the same set.
>
> **P8 — ergonomics.** **The producer must enforce the consumer's limits, or forecast them.** A cap
> that lives only on the read side turns a successful export into an unopenable file, and the person
> holding it has no way back. If you cannot enforce the limit while writing, at minimum forecast the
> quantity the limit is expressed in — a preview that counts rows against a byte ceiling is not a
> preview.
>
> **P9 — security.** *An artifact names a place, and the place is the vulnerability.* Where the
> payload's file names are guarded and the **root** they are written under is not, the guard is on the
> half that was easy to reason about. Ask which field selects the target, and confine that one first —
> especially when the target directory is where other programs read their instructions.
>
> **P10 — ergonomics.** **A round trip must be idempotent in the entity's identity.** If the importer
> renames what it lands, the entity's key changes every cycle and N round trips give N copies. Mint a
> stable id, or match on one; do not match on a field you also mutate.
>
> **P11 — security, and the one that decides how much the rest matters.** *An encrypted artifact's
> whole security is the weakest passphrase your gate accepts.* A key-derivation function at 600,000
> iterations in front of an 8-character minimum is 600,000 iterations of theatre. And "8 characters"
> must mean the same thing on both sides of the wire — a length check in bytes and a length check in
> code units are two different gates with one name.
>
> **Scale condition.** P2, P3, P4 and P5 are correctness on the very first artifact. P6 and P7 bite
> the first time an inclusion policy exists. P8 bites when the first real workspace exports. P9 bites
> the first time an artifact names a path. P10 bites on the second round trip — which, measured here,
> has already happened. P11 bites when the artifact is intercepted, i.e. exactly once and too late.

### Convergence — five sibling repos, censused independently

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Eight questions per repo: does a portable
artifact exist; are secrets in it and in what form; does the exporter rebuild or copy rows; is there
an integrity marker and does anything branch on it; what does the import trust; is an absent format
version refused; is the artifact install-bound; and what confines the import's disk writes.

| | personas-web | brainiac | personas-cloud | vibeman | ascent |
|---|---|---|---|---|---|
| portable artifact exists | **no** | yes (`pg_dump` + OKF) | **no** | yes (KB bundle) | yes (CSV/JSON + `.SKILL.md`) |
| secrets re-encrypted for transport | n/a | **no — plaintext dump to S3** | n/a | n/a (none carried) | n/a (none carried) |
| exporter rebuilds vs copies rows | n/a | **rebuild** 1/0 | n/a | **mixed** 2 copy / 3 rebuild | **rebuild** ~6/2/0 |
| integrity marker **branched on** | n/a | dedupe only | **YES — refuses** | **no marker at all** | **computed, never branched** |
| absent format version refused | n/a | **no** (marker unreadable) | n/a | **no** (bare array accepted) | **no** (shape string only) |
| import trusts a caller-named id | n/a | no | n/a | **no — explicitly dropped** | no (but a lockfile path reaches `rm`) |
| replayable into another install | n/a | **yes** | n/a | **yes** | **yes** |
| import disk write confined | n/a | slug allow-list, unbounded root | n/a | **caller-named root, deny-list** | slug allow-list; **none** on lock path |

- **P2 (a marker written out and never read back) — PHYSICS, and it is unanimous among the three
  repos that have a real round trip.** `brainiac` stamps `okf_version: "0.1"` into `index.md`
  (`crates/brainiac-publish/src/okf.rs:178`) and its importer **explicitly skips `index.md` at every
  level** (`crates/brainiac-pipeline/src/okf_ingest.rs:214`) — the only version marker in the format
  is the one file the reader refuses to open. `vibeman` writes `vibemanKnowledgeBundle: 1`
  (`KnowledgeBasePanel.tsx:80`) and its importer accepts **a bare top-level array**
  (`:100-105`), never reading the field; the format assertion exists only in the failure toast at
  `:134`. `ascent` emits `x-ascent-content-sha256` on two CSVs (`api/audit/route.ts:76`,
  `api/history/route.ts:102`) that nothing recomputes, and writes a per-row HMAC `_sig` whose
  verifier `verifyAudit` (`src/lib/db/audit-integrity.ts:76`) **has no production call site** — and
  ascent's own docs already record it (`docs/harness/bug-ui-scan-2026-06-20/security-posture-audit-log.md:35`:
  *"Per-row HMAC tamper-evidence is write-only — nothing in the app ever verifies `_sig`."*).
  **Personas contributes the fourth and fifth instances** — `bundle.rs`'s `sig_valid` (§0.1) and its
  `content_hash` (§7.B) — **and it is the only one of the five where the unverified marker is a
  cryptographic signature over executable configuration.** Five codebases, five teams, one shape.
- **P4 (the refusal in the view) — the counter-example is `personas-cloud` and it is the only repo
  in six that gets this right.** `verifyKafkaMessage` (`packages/shared/src/crypto.ts:157`) is
  branched at `packages/orchestrator/src/kafka.ts:222-224` — `if (verified === null)` → warn +
  dead-letter — and `verifyWorkerPayload` (`crypto.ts:230`) at
  `packages/orchestrator/src/workerPool.ts:138-141` → drop, with a timing-safe compare (`:197`), a
  5-minute replay window (`:176`), topic binding (`:181`) and nonce dedupe (`:202-207`). It has no
  archive, so it is not an archive counter-model — **but it proves the branch is the cheap part.**
- **P5 / P6 (a boolean success type; a filter with no floor) — CONVERGENT AS A DEFECT, 3 instances
  in 2 repos, and `ascent` names the anti-pattern in a comment and then commits it once.**
  `ascent`'s org export hardened three of its four CSV kinds to **404** rather than emit an empty
  file, with the reason written at `src/app/api/org/export/route.ts:40-42` — *"Returning a header-only
  200 in the null case is success theater"* — and the fourth, `passports`, does
  `(rollup?.repos ?? []).filter(r => r.passport)` at `:57-58`, so an org that has never run a
  passport scan downloads a header-only CSV that reads as "we have no repos". `vibeman` exports its
  KB with `WHERE status = 'active'` (`knowledge.repository.ts:207`) and then **deletes the on-disk
  markdown file** for any domain that came back empty (`knowledgeExporter.ts:167-171`), and caps its
  bundle at `limit=1000` (`KnowledgeBasePanel.tsx:73`) while the success toast reports the truncated
  length as complete (`:88`). **Personas' `export_credentials` is the fourth and the worst**, because
  the emptied class is the credential vault and the artifact still looks like an encrypted backup.
  *"Success theater"* is `ascent`'s phrase and it is the right one.
- **P9 (a caller-named root reaching a write) — CONVERGENT, 3 of 5, and two of the three write agent
  instruction files.** `vibeman` runs a real pre-check (`route.ts:134-139` →
  `validateProjectPath` / `validateSafeBasePath`, `pathSecurity.ts:197/215`) — absolute, no
  traversal, forbidden-system-prefix deny-list — and then writes into
  `path.join(projectPath, '.claude', 'knowledge')` (`knowledgeExporter.ts:143`) and `unlinkSync`s
  under it (`:169`), **without** calling `validatePathWithinAllowedRoots` (`pathSecurity.ts:70`), the
  function in the same file that would confine it to a registered project root. `brainiac` guards the
  **slug** with a `..`/`/`/`\` check (`okf.rs:159-161`) whose comment says the slug *"comes from our
  own database"*, leaves `repo_path` unbounded (`:27/:63`), and writes `AGENTS.md`/`CLAUDE.md` at that
  root (`pointer::write_pointer_files`, `:252-257`). `ascent` slugs the server-supplied skill name
  soundly (`scripts/ascent-skills.mjs:66-69`) and then re-reads `.file` straight out of the lockfile
  into `rm(join(cfg.dir, prev.file))` (`:120`, `:130-131`) with **no re-validation**. **Personas'
  `is_dir()`-and-nothing-else on `root_path` (§7.C) is the fourth, and it is the weakest of the four:
  three repos apply *some* check to the root and this one applies existence.** Nobody in six
  codebases canonicalizes and `starts_with`s a managed root on this path.
- **P10 (identity mutated by the importer) — NO TRACE, and `vibeman` is the counter-model to copy.**
  `KnowledgeBasePanel.tsx:111-128` rebuilds an explicit per-entry payload that **drops** `id`,
  `created_at`, `updated_at`, `times_applied`, `status` and `source_project_id`, and **forces**
  `source_type: 'import'` (`:126`); the server mints its own id and timestamps
  (`knowledge.repository.ts:87`). `brainiac` does the same with `Uuid::new_v4()` at
  `okf_ingest.rs:284` and an org from `principal.org_id` (`:287`). Neither renames what it lands.
  **Personas is the only repo of six whose importer mutates the entity's own match key**, and §0.5 is
  the receipt.
- **P11 (a KDF in front of a weak minimum) — NO EXTERNAL WARRANT, because Personas is the only repo
  of six with an encrypted export at all.** `brainiac`'s `pg_dump` archive is written plaintext
  (`scripts/backup.sh:77-78`) and shipped to S3 as-is (`scripts/backup-offsite.sh:182`) — with
  careful credential *handling* around it (keys exported only into the `aws` subshell, `:143-150`;
  `PGPASSWORD` via `docker compose exec -e`, `backup.sh:72`) and **no encryption and no checksum on
  the artifact**. `vibeman` and `ascent` carry no secrets in exports and have no envelope concept.
  `personas-cloud` has the identical primitive — **PBKDF2-SHA256 at 600,000 iterations**
  (`packages/shared/src/crypto.ts:8/29`) + AES-256-GCM (`:40`) — pointed at credentials **at rest**,
  never at a transport envelope. **Personas is ahead of its whole fleet on §2's central clause**, the
  same posture the corpus recorded for the DST-correct schedule evaluator. Report P11 as
  strongly-reasoned and externally untested; the 8-character floor is the part with no defender.
- **The format-version gate — PERSONAS IS THE ONLY REPO OF SIX THAT REFUSES ONE.**
  `run_bundle_import` hard-rejects anything that is not format 2 or 3
  (`data_portability.rs:2236-2241`) before a single row is read. All three sibling round trips accept
  an absent version. This is the one clause where the oracle inverts in Personas' favour, and §2 keeps
  it on that evidence.
- **P3 (a signature that does not reach the payload) — NO TRACE.** No sibling separates a signed
  manifest from an unsigned payload member, because no sibling signs an archive at all. Retained in
  §2 on mechanism, not on vote: the enclave format in this very repo demonstrates the compliant shape
  (`engine/src/enclave.rs:241`), which is the strongest argument available and it is a local one.

> **The transferable sentence.** Across six codebases the recurring failure is not a missing check —
> it is a check that **ran, produced a correct answer, and was written to a field.** `okf_version`
> into a skipped file, `vibemanKnowledgeBundle` into an unread key, `_sig` into a column with no
> verifier, `signature_verified` into a provenance row. **The work of verification is done; only the
> `if` is missing**, which is why it survives review — a diff that adds a hash looks like a diff that
> adds integrity.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "let the user export their workspace / back up their data / take their agents with them"
- "we need an import for the file the export writes" · "round-trip the bundle"
- "sign the bundle so they know who made it" · "put a hash in the manifest"
- "share a persona by link / clipboard / file"
- "the export should skip the built-in ones" · "only export what they actually configured"
- "let them password-protect the export"
- **The "about to write X" test:** you are about to type `-> Result<bool, AppError>` on a command
  whose name starts with `export_`, `serde_json::to_vec(&bundle)` after a loop with a `continue`,
  `format!("{} (imported)", x.name)`, `content_hash: hex::encode(...)` on a struct you are about to
  serialize, `let (sig_valid, _) = verify…`, `Path::new(caller_supplied).is_dir()`, or
  `passphrase.len() >= 8`.

**Not this path:** *is this incoming object legal* is
[untrusted-definition-validation](./untrusted-definition-validation.md); *the secret at rest in a
column* is [column-encryption-at-rest](./column-encryption-at-rest.md); *the secret on the IPC wire
or the clipboard* is [secret-display-and-transfer](./secret-display-and-transfer.md); *may this
caller call this command* is [ipc-command-authorization](./ipc-command-authorization.md); *the
confirm dialog itself* is [informed-consent-gate](./informed-consent-gate.md); *path containment as
a primitive* is [filesystem-boundary](./filesystem-boundary.md).

---

## 2. The one way

**Write the artifact as a rebuild, read it back with a refusal, and make the success type carry the
count.** In order: **(a)** build every section by naming the fields you emit — never
`to_value(&row)`, and treat a `metadata` / `config` / `*_json` column as a *row you have not
rebuilt yet*, because copying a blob is copying a row; **(b)** give the format a version and
**refuse an unrecognised one before reading anything** (`run_bundle_import:2236-2241` is the shape,
and it is the one clause where this repo leads its fleet); **(c)** for every marker you put in the
manifest — version, digest, signature, count — **write the `if` that refuses in the same commit, on
the backend**, and verify over the **exact bytes** you read from the archive rather than a
re-serialisation of the struct you parsed from them (`enclave.rs:216-236` versus
`bundle.rs:405,:540`); **(d)** chain the digest to the payload: if the signature covers a manifest
and the data lives in another archive member, recompute the member's hash against the manifest's
before you touch it, or the archive is signed and the payload is not; **(e)** make the export's
success type a struct of counts — `{written, skipped, dropped, bytes}` — and never `bool`, so a
filter that empties the artifact cannot render as success; **(f)** when the export has an inclusion
policy, put a post-condition on what survived it, and if a "unified" variant exists beside a
standalone one, make them share one implementation or assert they emit the same set; **(g)** forecast
the *importer's* limits at export time in the unit the limit is expressed in — bytes if the limit is
bytes; **(h)** never let the artifact name a directory: resolve its target against entities the user
already has, and canonicalize + `starts_with` a managed root before any write, especially one landing
in `.claude/`; **(i)** mint ids on the import side and match on something you do not mutate, so the
second round trip is the same shape as the first; **(j)** seal credential material in a passphrase
envelope with a real KDF — this repo's `encrypt_section` (`:9162`) is correct and is the only one in
six codebases — and make the passphrase floor a **strength** check measured the same way on both
sides of the wire, not a byte-length check on one side and a code-unit check on the other. If you
must get one right first: **(c)**. Every other clause leaves a trace someone can find; a marker that
is computed and stored leaves a trace that *looks like the fix*.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
|---|---|
| **`data_portability.rs:9162` — `encrypt_section<T>(value, passphrase, format)`** + **`:9194` `decrypt_section`** | **The one thing in this document to copy, and the only encrypted export envelope in six codebases.** AES-256-GCM under PBKDF2-HMAC-SHA256 at **600,000** iterations (`:9498`), a fresh 16-byte salt and 12-byte nonce per call from `OsRng` (`:9171-9174`), and a `format` marker checked **first** on decrypt (`:9199-9204`) so a section pasted into the wrong slot fails loudly instead of becoming a confusing serde error. Three sections use it with three independent salts. |
| **`data_portability.rs:9240` — `seal_sensitive_sections`** | The fail-rather-than-downgrade posture, with its reasoning in its own doc comment: a passphrase-less export carrying twins or Athena returns `Err`, *"cheaper than discovering the omission in a shipped plaintext bundle"* (`:9236-9239`). Its partner `SensitiveSections` (`:2331`) declines to *collect* the plaintext at all when there is no passphrase to seal it — **the data never enters memory**, which is stronger than sealing it later. |
| **`data_portability.rs:1900` — `require_passphrase_for_selection`** | **The P4 primitive, and the sentence the rest of the module should have read.** Refuses an export that *asked* for twins/Athena without a passphrase, parses the tier list unconditionally so a typo cannot be masked by the passphrase error (`:1905-1908`), and says in prose why the frontend's identical check is not enough (`:1898-1899`). |
| **`data_portability.rs:2236-2241` — the format-version gate** | Refuses anything but format 2 or 3 **before** decryption, validation or any read. Measured: **the only version refusal in six codebases.** |
| **`data_portability.rs:4968` — `read_zip_bundle`** | Three-layer zip-bomb guard: declared `size()` checked against `MAX_DECOMPRESSED_SIZE` (`:4977`), then a `Read::take(MAX+1)` capped reader *"so even a lying size header cannot exhaust memory"* (`:4988`), then a post-read length check (`:4992`). The right shape. **Its gap is that the sibling `.json` branch (`:2229`) has none of it** — §7.F. |
| **`data_portability.rs:1757` — `push_truncation_warning`** + **`PortabilityBundle.export_warnings` (`:259`)** | The channel that carries the exporter's own losses *inside the artifact* to the importing human. Its doc comment records the state before it existed: *"the caps dropped data with no signal on either end while the import side hard-rejected the very same overflow."* **This is P5 solved for truncation and not for emptiness** — which is exactly the hole §0.3 fell through. |
| **`engine/src/enclave.rs:216-241` — the verification `verify()` performs** | Three things `bundle.rs` does not: verifies over the **raw `manifest.json` bytes** kept by `parse_enclave` (`:283-286`, with the regression it fixes written down at `:218-223`); **binds the embedded public key to the claimed `peer_id`** before using it (`:226-229`, *"an attacker could sign with their own key but claim a trusted peer's id"*); and computes **`content_intact`** by re-hashing the payload against the manifest's digest (`:241`). **Copy the computation. Do not copy the consumption — see §12.3.** |
| **`network/bundle.rs:352` — `verify_share_link_hash`** | The TOCTOU pin for the one import path that fetches over the network, with the hashless case decided **explicitly and differently** for the two producers: a `personas://share` deep link without `hash=` is **refused** (`:375-379`) because `create_share_link` always emits one; a pasted raw HTTP URL warns and proceeds (`:380-387`). Unit-tested four ways (`:453-492`). |
| **`network/bundle.rs:88-110` — the preview-to-apply hash pin** | `preview_id` present ⇒ `expected_bundle_hash` **mandatory** (`:89-95`), then a byte re-hash (`:96-110`). Prevents a file/clipboard swap between the dialog and the import. Duplicated correctly at `:240-262` for the clipboard door. **This is what a marker with an `if` looks like**, in the same file as one without. |
| **`import_export.rs:280` — `import_persona -> Result<Option<ImportResult>, AppError>`** | **The compliant success type, 40 lines below the violating one.** `None` = the user cancelled the dialog; `Some(ImportResult { persona_id, warnings })` = what happened. Every one of this repo's **16** data-movement commands that is not an export uses this shape. Copy it into §9's five. |
| **`db/src/repos/resources/recipes.rs` + `engine/recipe_seed.rs:241`** | The withholding precedent, cited by [untrusted-definition-validation](./untrusted-definition-validation.md) §3 and applicable here verbatim: `CreateRecipeInput` has no `is_builtin` *"(user create paths must not mint builtin rows)"*. The import types in this module should be the same shape. |

**Do NOT exist — this path names them:**

- **Any backend refusal on a bundle signature.** `sig_valid` is computed at `engine/bundle.rs:406`
  and consumed at `:497` as data. Grepped: `signature_valid` / `sig_valid` reach **no conditional**
  in `src-tauri`.
- **Any verification of `BundleManifest.content_hash`.** The field is declared (`:79`), computed
  (`:247`) and stored (`:257`). **Those are its only three occurrences in the repo.** §7.B.
- **Any post-condition on what an export carried.** No `entries.is_empty()`, no count in any export's
  return type, no test asserting `export_credentials` and `build_encrypted_credentials` agree.
- **Any byte-size forecast at export time.** `compute_export_stats` forecasts 7 count caps and 0 size
  caps against a byte-denominated import ceiling. §0.2.
- **Any containment on the skills root.** `Path::new(root_path).is_dir()` (`:8848`) and nothing else.
  The primitive exists — [filesystem-boundary](./filesystem-boundary.md)'s
  `managed_root` → `resolve_safe` → `exists` (`drive.rs:1414-1422`) — and is not used here.
- **Any passphrase strength check.** `usable_passphrase` (`:1783`) is `p.len() >= 8`, in **bytes**;
  its frontend twin (`useExportPicker.ts:368`) is `.length >= 8`, in **UTF-16 code units**. §7.H.
- **Any cap on the skills section.** Per-file 256 KiB (`:201`) and nothing else — no file count, no
  skill count, no total bytes. It is 27% of this install's bundle.

---

## 4. Steps

1. **Write down who will read this artifact**, before you write a serializer. Another copy of this
   app on another machine; a future version of this app; a person with a text editor; an attacker who
   obtained the file. Only the first is the one you are designing for, and the fourth is the one that
   decides what may be in it in the clear.
2. **Build every section by naming its fields.** A blob column is a row you have not rebuilt — if you
   are about to write `metadata: row.metadata.clone()`, open the blob and enumerate the keys you mean
   to send. §0.4 is 89,757 bytes of what happens otherwise.
3. **Version the format and refuse an unknown version before reading anything.**
   `run_bundle_import:2236-2241`. An absent version is not "version 1"; it is "written by something
   you have not seen".
4. **For every marker, write its refusal in the same commit — on the backend.** A digest with no
   comparison, a signature with no branch, a count with no assertion. If the refusal has to live in
   the UI for product reasons, the backend still refuses by default and the UI passes an explicit
   `acknowledged_unsigned: true`, so the consent is a value on the wire and not the absence of a
   caller.
5. **Chain the digest to the payload and verify over the bytes that were signed.** Keep the raw
   manifest bytes (`enclave.rs:283-286`), not a re-serialisation. Then recompute the payload member's
   hash against the manifest's digest before you use it.
6. **Ask the type question now, before §9.** For this leaf the answer is yes and it is one line per
   command — see below.
7. **Put a post-condition on every inclusion policy.** If a filter can empty the artifact, say so in
   the result and consider refusing to write it.
8. **Forecast the importer's caps in the importer's unit.** If the ceiling is bytes, the preview
   counts bytes.
9. **Never let the artifact name a directory.** Resolve to an entity the user already has, or make
   the user pick the root. Then canonicalize + `starts_with` a managed root. Then write.
10. **Mint ids on import; match on a field you do not mutate.** If you must rename, keep a stable
    `origin_id` and dedupe on that.
11. **Seal secrets with a real KDF and gate the passphrase on strength, measured identically on both
    sides.** Byte length and code-unit length are different gates.
12. **And then stop.** Whether the object is legal is
    [untrusted-definition-validation](./untrusted-definition-validation.md); whether the caller may
    call the door is [ipc-command-authorization](./ipc-command-authorization.md); where the secret
    lives afterwards is [column-encryption-at-rest](./column-encryption-at-rest.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, twice, and one of them is the cheapest correct fix in this document. The third place a type
is wanted, it cannot reach — and that is a finding.**

**Fix 1 — the export's success type. `-> Result<bool>` → `-> Result<ExportOutcome>`.** The defect in
§0.3 is not the builtin filter; it is that a total loss and a success are the same value. Held
against the doctrine's seven qualifications:

- **Q1 (a type carries only what it encodes).** `ExportOutcome { written: u32, skipped: u32, path_chosen: bool, warnings: Vec<String> }`
  encodes what was carried and whether the dialog was cancelled — **exactly the two facts `bool`
  conflates and nothing more.** It does not encode that the *right* rows were chosen; the filter bug
  stays a bug, it just stops being invisible.
- **Q2 (requiredness ≠ closedness).** Neither applies. The failure is *expressiveness*: the type's
  domain is smaller than the outcome space.
- **Q3 (a type nobody constructs constrains nothing).** **5 construction sites, all enumerated in
  §9**, all in 2 files. Small, real, and each is a `return Ok(true)` today.
- **Q4 (a type anyone can construct authenticates nothing).** Does not apply — the value is produced
  by the command, not supplied by a caller. This is the case where Q4 is vacuous, which is worth
  saying: not every type-over-gate answer needs a private field.
- **Q5 (withholding beats requiring).** **The exact fit.** You are not requiring the author to report
  the count; you are **withholding the ability not to** — there is no `true` to return.
- **Q6 (withhold the dangerous freedom, not the answer).** The freedom removed is "collapse the
  outcome to one bit". `path_chosen: bool` keeps the cancel signal, which is the half the callers
  legitimately need (`useDataPortability.ts:233`).
- **Q7 (relaxing is inert where the caller supplies the bad value).** Does not apply; the command
  produces it.

**The compliant type already exists in the same file.** `import_persona` (`import_export.rs:280`)
returns `Result<Option<ImportResult>>` — `None` for cancel, a struct for the outcome — 40 lines below
`export_persona`'s `Result<bool>`. **Measured: 0 of 16 data-movement commands that are not exports
report a boolean; 5 of 5 that do are exports.** The repo already knows the answer and applies it in
one direction only.

**Fix 2 — the signature verdict. `bool` → a type the writer cannot be constructed without.**
Mirroring [ipc-session-token-race](./ipc-session-token-race.md) §4's `Validated(())`:

```rust
// engine/bundle.rs — withhold the un-refused import instead of recording that it happened
pub struct VerifiedBundle { manifest: BundleManifest, bytes: Vec<u8> }   // private fields
pub fn verify_or_refuse(pool, bytes, consent: UnsignedConsent) -> Result<VerifiedBundle, AppError>;
pub fn apply_import(pool: &DbPool, bundle: VerifiedBundle, options: BundleImportOptions) -> …;
```

`apply_import` then cannot be called on unverified bytes, because nothing else constructs its
argument (Q4 holds: private fields, one constructor, `engine::bundle` is not `pub` beyond the crate).
`UnsignedConsent` is where the product decision lives — an explicit value the UI must pass — which
turns "the user clicked Import anyway" from *the absence of a caller* into *a value on the wire*.
**3 construction sites** (`apply_bundle_import`, `apply_bundle_from_clipboard`,
`import_from_share_link`), all in one file. Q3 passes.

**Where the type does not reach**, stated as findings:

1. **The blob columns.** `metadata: Option<String>` on `CredentialMetaExport` is `String` because the
   column is `TEXT`. No Rust type reaches inside it, which is
   [untrusted-definition-validation](./untrusted-definition-validation.md) §8 gap 5 arriving from the
   outbound side. The fix is not a type; it is enumerating the keys.
2. **The byte ceiling.** `MAX_DECOMPRESSED_SIZE` is a runtime property of a `String` produced by
   `serde_json::to_string_pretty`. No signature can express "this will serialize under 50 MiB".
   §7.G's fix is an assertion at write time, not a type.
3. **The passphrase floor.** `&str` cannot carry "strong enough". A `Passphrase` newtype with a
   private field and a validating constructor **does** close the byte/code-unit split (§7.H) by
   making one implementation the only one — but it cannot encode entropy. Half a fix, honestly.

**So: ship both types, ship the count type first — it is five `Ok(true)`s and one struct — and ship
§9 as the ratchet that holds the export half of the line.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A bulk-data command that returns `bool`** | `true` means "the save dialog returned a path". `export_credentials` skipped **25 of 25** credentials and returned `Ok(true)`; `useDataPortability.ts:233` rendered `'success'`. **5 sites, all exports; 0 of 16 imports do it.** |
| **A verification computed and stored instead of tested** | `engine/bundle.rs:406` → `:497 signature_verified: sig_valid`. The row records that it was not verified. Convergent in 3 of 3 sibling round trips; `ascent`'s own docs call its instance *"write-only"*. |
| **A digest in a manifest that nothing recomputes** | `BundleManifest.content_hash` — declared `:79`, computed `:247`, stored `:257`, **three occurrences, no fourth**. The signature covers the manifest; the payload lives in `personas/<id>.json`; the only thing binding them is the digest nobody checks. **The bundle is signed and the personas are not.** |
| **Verifying a re-serialisation of what you parsed** | `bundle.rs:327,:405,:540` re-run `to_string_pretty(&manifest)`, so any field the on-disk manifest carries that the struct does not is silently outside the signature. `enclave.rs:283-286` keeps the raw bytes and its comment records the outage the round-trip caused. |
| **The refusal in the view** | `BundleImportDialog.tsx:400-427` is the only thing that stops an unsigned import. The neighbouring module wrote *"the frontend is not the boundary — anything that can invoke can skip it"* (`data_portability.rs:1898`). |
| **An inclusion policy as a bare `continue`** | `if builtin_names.contains(…) { continue; }` (`:9582`). The class was "non-builtin"; the world became 134-of-134 builtin; nothing measured the survivors. Convergent: `ascent`'s passports CSV, `vibeman`'s `WHERE status='active'`. |
| **Two doors to one dataset with two inclusion policies** | `export_credentials` (`:9556`, filters) and `build_encrypted_credentials` (`:9347`, does not) build the same `CredentialExportBundle` from the same repo calls. 0 vs 25 on the same database. No test compares them. |
| **A blob column copied verbatim into an artifact** | `metadata: c.metadata.clone()` (`:2596`) under a doc comment reading *"Non-secret credential metadata"*. 89,757 bytes, 72,889 of it verbatim remote-API probe output, in the **plaintext** section. |
| **An importer that renames what it lands and dedupes on the new name** | `format!("{} (imported)", c.name)` (`:6017`) matched against `"{} (imported)"` (`:9447`). **11 of 25 live rows read `(imported) (imported)`.** |
| **A cap enforced only on the read side** | `MAX_DECOMPRESSED_SIZE` guards `read_zip_bundle` and nothing guards `save_bundle_to_file`. This install is at **99.7%** of it. |
| **A guard on the payload's names and not on its root** | `is_safe_skill_segment` / `is_safe_skill_rel_path` (`:8783`, `:8795`) are thorough; `root_path` gets `is_dir()` (`:8848`). Convergent with `brainiac/git.rs`, `vibeman/knowledgeExporter.ts`, `ascent/ascent-skills.mjs`. |
| **A cross-store reference committed before the row it points at** | `tx.commit()` on the user DB (`:8182`) writes `knowledge_bases.credential_id` **NOT NULL**; the row it names is inserted into the *app* DB nine lines later as `let _ = conn.execute("INSERT OR IGNORE …")` (`:8189`). A failure there is unobservable and leaves a KB pointing at nothing. |
| **A length check that means different things on the two sides** | `usable_passphrase` bounds **bytes** (`:1784`); `useExportPicker.ts:368` bounds **UTF-16 code units**. The same divergence [untrusted-definition-validation](./untrusted-definition-validation.md) measured in the tour validator, here on the gate protecting the vault. |
| **A hard `LIMIT` with no warning channel** | `build_persona_bundle` reads memories with `Some(5000)` (`import_export.rs:180`) and has no `export_warnings` equivalent — while its big sibling built exactly that channel and explains why (`:1753-1756`). |

---

## 6. Evidence

### The one site to copy: `data_portability.rs:9162-9275` — `encrypt_section` + `seal_sensitive_sections`

Read them together; the envelope is only half the pattern.

```rust
// :9171-9189 — fresh salt AND nonce per call, format marker inside the envelope
let mut salt = [0u8; 16]; let mut nonce_bytes = [0u8; 12];
OsRng.fill_bytes(&mut salt); OsRng.fill_bytes(&mut nonce_bytes);
let key = derive_key(passphrase, &salt);                   // PBKDF2-HMAC-SHA256, 600_000 (:9498)
Ok(CredentialExportEnvelope { format: format.into(), salt: B64.encode(salt), … })

// :9199-9204 — the marker is checked FIRST, before any crypto work
if envelope.format != format { return Err(AppError::Validation(format!(
    "Unexpected encrypted section format: {} (expected {format})", envelope.format))); }
```

…and then `seal_sensitive_sections` (`:9240`), which **returns `Err` rather than emitting an unsealed
bundle** (`:9249-9253`) and whose doc comment states the trade in one sentence: *"cheaper than
discovering the omission in a shipped plaintext bundle."* Its partner `SensitiveSections::from_passphrase`
(`:2338`) is stronger still — a passphrase-less export never *collects* the twin or Athena data,
*"and worse, would leave the plaintext sitting in memory for no reason"* (`:2329-2330`).

**Also exemplary:**

- **`data_portability.rs:1900-1926` — `require_passphrase_for_selection`.** Parses the tier list
  unconditionally so a typo'd tier fails identically with or without a passphrase, refuses a
  selection that asked for always-encrypted sections, and writes down that the frontend is not the
  boundary. **This is P4 implemented correctly, in the same module as §0.1.**
- **`engine/src/enclave.rs:216-241`.** Raw-bytes verification with the regression it fixes recorded
  in-line; key↔peer-id binding with the attack it prevents named; and `content_intact` computed at
  all. Three improvements over `bundle.rs`, in a file four directories away. (What it does with the
  three: §12.3.)
- **`network/bundle.rs:332-388` — `verify_share_link_hash`.** A TOCTOU pin whose *hashless* case is
  decided differently for the two producers, with 25 lines of prose saying why, and four unit tests
  covering both arms (`:463`, `:470`, `:480`, `:489`).
- **`data_portability.rs:4977-4995` — `read_zip_bundle`.** Declared size, capped reader, post-read
  check. The comment *"so even a lying size header cannot exhaust memory"* is the whole doctrine of
  reading a foreign archive in twelve words.
- **`import_export.rs:280` — `import_persona`.** The success type this document is asking for,
  already written, 40 lines below the one it is asking you to stop writing.

### The replay (the measurement, not a reading)

Read-only copies of `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB), taken with
their `-wal`/`-shm` at 2026-08-16 16:20. The export's own selection and serialization logic was
re-implemented against them, section by section, from the same columns `build_export_bundle` reads.

```
export_credentials  builtin-skip replay
  connector_definitions                   134 rows, is_builtin=1 on 134
  persona_credentials                      25 rows, 23 distinct service_type
  service_type ∈ builtin connector names   23 of 23
  → emitted                                 0 credentials / 0 fields
build_encrypted_credentials (same data, no filter)
  → emitted                                25 credentials / 42 fields (36 sensitive, 6 iv='')

bundle size, real JSON.stringify per section
  personas(+6535 memories)  32,653,604   project_skills(1598 files) 14,072,899
  workspace_knowledge        2,473,251   dev graph                   1,670,003
  teams                        395,451   credentials(plaintext)         99,622
  kpis                          32,880   tool_definitions               36,520
  ────────────────────────────────────────────────────────────────────────────
  compact 51,434,230 (49.05 MiB)   pretty ≈52,262,000 (49.84 MiB)   cap 52,428,800

credential metadata, plaintext section       89,757 B over 25 rows, 21 distinct keys
  healthcheck_results 72,889 B · healthcheck_last_message 1,491 B · [secret] markers 2 rows
literal credential shapes (11 families, template-vs-literal classified)
  credentials.metadata 0 · workspace_knowledge 0 · persona_memories 2 (labelled assignments)

round-trip idempotence, "(imported)" occurrences per name
  persona_credentials  0→12  1→2  2→11        personas 0/78 · teams 0/8 · projects 0/14
```

**A negative result of my own, recorded because the instrument nearly lied.** My first
`workspace_knowledge` credential scan reported **clean** — because the query named a `summary` column
that does not exist (it is `statement`), the helper returned `[]` on the error, and the scan
therefore examined **zero rows** and reported zero findings. That is the doctrine's "assert the
instrument" failure committed inside this composition. Re-run with the real columns
(`detail_md`, `statement`, `title`, `provenance`) over all **1,306** rows: still zero, now honestly.

### What the live databases hold

- **`persona_credentials`: 25 rows; `encrypted_data` and `iv` are the empty string on all 25** — the
  retired blob, as [column-encryption-at-rest](./column-encryption-at-rest.md) established. The
  secrets are the **42 `credential_fields`** rows (36 sensitive, 6 legitimately plaintext).
- **`dev_projects`: 14 rows, 14 absolute `C:` roots** — so the bundle importer's UNIQUE match key is
  a live absolute path on every row, and the 13 that exist on disk hold **1,598** skill files.
- **`persona_memories`: 6,535** across 78 personas (max 292 on one) — under `MAX_MEMORIES` (500), so
  `validate_bundle` would accept this bundle. **The count caps are all satisfied; the byte cap is
  the one at 99.7%.**
- **`dev_kpis`: 65** (28 active, 11 paused, 21 proposed, 5 archived) — 39 travel, and the exporter's
  status filter is the *correct* form of the §0.3 pattern: it has a stated rule (`is_exportable_kpi`,
  `:1775`) and the preview counts it (`:1631`).
- **`import_transactions`: 155** (145 committed, 10 rolled back).

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is one question never asked:
> **"what would make this artifact fail?"** Asked of the writer it produces the missing
> post-conditions — an emptied filter, an unbounded section, a byte ceiling nobody forecasts. Asked
> of the reader it produces the missing refusals — a signature, a digest, a root, a name. The module
> asks it well exactly twice: once at `require_passphrase_for_selection` (which refuses on the write
> side) and once at the format-version gate (which refuses on the read side). Everywhere else the
> answer was written into a field.

### 7.A — P0: `export_credentials` emits an empty envelope and reports success

| Path | Fact |
|---|---|
| `data_portability.rs:9553` | doc: *"Export **all** credential secrets to a password-protected encrypted file."* |
| `:9572-9577` | `builtin_names` = lowercased `name` of every `is_builtin` connector definition |
| `:9582-9584` | `if builtin_names.contains(&cred.service_type.to_lowercase()) { continue; }` |
| **measured** | **134 of 134 connector definitions are `is_builtin`; 23 of 23 credential `service_type`s match one; 0 of 25 credentials survive** |
| `:9604-9634` | the envelope is built, PBKDF2'd and AES-GCM'd unconditionally — no `entries.is_empty()` check |
| `:9560` / `:9661` | `-> Result<bool>`; `Ok(true)` on "the user picked a path" |
| `useDataPortability.ts:232-233` | `setCredExportStatus(saved ? 'success' : 'idle')` |
| `:9347` | `build_encrypted_credentials` — same loop, **no filter** — emits 25 |

**Reachability.** `export_credentials` is `#[requires(privileged)]` **and commented out of
`PRIVILEGED_COMMANDS`** (`ipc_auth.rs:430`), so per
[ipc-session-token-race](./ipc-session-token-race.md) §0 finding 4 its only authorization statement
cannot return `Err`. That path owns the door; **this path owns what is behind it, and what is behind
it is an empty file named like a vault backup.**

**Fix, in order:** (1) delete the builtin filter — the two doors must not disagree, and the unified
door's behaviour (export everything the user has) is the correct one, since a credential's
`service_type` naming a builtin connector says nothing about whether its *secret* is worth carrying;
(2) change the success type to a count struct (§4 fix 1) so the class of defect cannot recur silently;
(3) add a Rust test asserting `export_credentials` and `build_encrypted_credentials` select the same
set from one fixture database — the only mechanism that keeps two doors on one dataset honest.

### 7.B — P0: the bundle signature does not reach the payload, and nothing refuses on it either way

Two independent gaps that compose into "signed" meaning nothing:

| Path | Fact |
|---|---|
| `engine/bundle.rs:406` | `let (sig_valid, _signer_trusted) = verify_against_trusted_key(…)` in `apply_import` |
| `:497` | `signature_verified: sig_valid` — its **only** consumer, a provenance field |
| **grep** | `sig_valid` / `signature_valid` reach **no conditional** anywhere in `src-tauri` |
| `:79`, `:247`, `:257` | `BundleManifest.content_hash` — declared, computed, stored. **Three occurrences repo-wide. No fourth.** |
| `:454-464` | `apply_import` reads `personas/<id>.json` from the ZIP and parses it. No hash. |
| `:327`, `:405`, `:540` | the signature is verified over `to_string_pretty(&manifest)` — a **re-serialisation** of the parsed struct, not the archive's bytes |

So: the signature covers a re-serialisation of the manifest; the manifest names a `content_hash`; the
`content_hash` covers the persona payloads; **and nothing recomputes it.** Replace
`personas/<id>.json` in a trusted peer's bundle and `verify_bundle` still reports
`signature_valid: true`, `signer_trusted: true`. The three consumers of that verdict —
`apply_bundle_import` (`network/bundle.rs:112`), `apply_bundle_from_clipboard` (`:264`),
`import_from_share_link` (`:421`) — import regardless. The refusal is `BundleImportDialog.tsx:400-427`.

`import_persona_from_value` then writes a persona whose `system_prompt`, `structured_prompt`,
`design_context`, trigger `config` and `notification_channels` become instructions the app executes.

**Fix, in order:** (1) recompute the content blob's SHA-256 in `apply_import` and refuse on
mismatch — the exporter's construction is deterministic and already documented as such (`:240-247`);
(2) verify over the raw `manifest.json` bytes, copying `parse_enclave`'s shape
(`enclave.rs:283-286`) and the reason it records; (3) make `apply_import` take a `VerifiedBundle`
(§4 fix 2) so the UI's consent becomes an explicit `UnsignedConsent` value rather than the absence of
a check. This subsumes [untrusted-definition-validation](./untrusted-definition-validation.md) §7.D,
which named the missing branch; the missing **digest chain** is new here and is the larger half.

### 7.C — P1: the bundle names the directory its skills land in, and the guard is `is_dir()`

Extends [untrusted-definition-validation](./untrusted-definition-validation.md) §7.C with the control
flow that reaches it, which changes the severity.

| Component | Guard |
|---|---|
| `skill.name` (a directory segment) | `is_safe_skill_segment` (`:8783`) — rejects empty, `.`, `..`, `/`, `\`, `:` |
| `file.rel_path` (nested segments) | `is_safe_skill_rel_path` (`:8795`) — not absolute, every segment safe, never the provenance sidecar |
| **`root_path`** — which disk, which tree | **`Path::new(root_path).is_dir()` (`:8848`). That is the whole check.** |

The path to it, which §7.C did not trace: `find_project_conflict` (`:6791`) matches on
`root_path` (UNIQUE) and falls back to `name`. **A `root_path` that matches no existing project takes
`ProjectImportMode::Fresh` (`:6504`), which is `(p.id, p.name, p.root_path)` verbatim (`:6938`) with
no conflict entry, no resolution prompt and no second pass** — then `pending_skills.push((final_root_path, …))`
(`:6547`) and, **after `tx.commit()`** (`:6650`), `write_project_skills(&root_path, …)` (`:6657`)
writes `<root_path>/.claude/skills/<name>/SKILL.md`.

**Computed, not performed.** This machine's 14 project roots are all `C:\Users\mkdol\dolla\…`,
`C:\Users\mkdol\xprice\…` or `C:\Users\mkdol\.personas\…`. **`C:\Users\mkdol` is not among them, it
exists, and `C:\Users\mkdol\.claude\skills` currently holds 15 user-level skills** — the ones every
Claude Code session on this machine loads, including this one. A bundle declaring
`root_path: "C:\\Users\\mkdol"` therefore takes the Fresh path, prompts nothing, and lands agent
instruction files in the machine-wide skills directory. *(Nothing was written. The composition was
computed from the live `dev_projects` rows and a directory listing.)*

Two mitigations, neither a containment boundary: `overwrite` is false outside a `replace` resolution,
so an existing same-named skill with different content is skipped with a warning (`:8894-8900`,
`:8928-8934`) — **a new name is still written**; and the post-commit placement means a write failure
is a warning, not a rollback, which makes the *failure* soft and the *success* silent.

**Fix:** resolve `root_path` against `dev_projects` rows that already exist — the bundle names a
project the user has, or the user picks the root — then canonicalize + `starts_with` a managed root
before any write, per [filesystem-boundary](./filesystem-boundary.md)'s
`managed_root` → `resolve_safe` → `exists` (`drive.rs:1414-1422`). **A bundle must not be able to
name a directory.**

### 7.D — P1: the plaintext `credentials` section carries the whole `metadata` blob

`CredentialMetaExport` (`:451-458`) is documented *"Non-secret credential metadata … Secrets are NOT
included"*; `:2596` is `metadata: c.metadata.clone()`. Measured: **89,757 bytes over 25 rows, 21
distinct keys, of which `healthcheck_results` is 72,889 bytes of verbatim remote-API probe output and
`healthcheck_last_message` is 1,491 bytes of whatever the remote API last said.** **2 of the 25 blobs
carry a `[secret]` mask marker**, i.e. the write-path sanitizer (`credentials.rs:642`) has already
fired on this channel — and that sanitizer masks **7 of 20** real token shapes
([column-encryption-at-rest](./column-encryption-at-rest.md) §3).

Three consequences, in severity order:

1. **It travels in the clear.** This section is `PortabilityBundle.credentials`, not
   `encrypted_credentials`. A passphrase-less `export_full` writes it into a plain zip.
2. **It travels twice.** `CredentialExportEntry` (`:9512`) also carries `metadata`, so a bundle with
   a passphrase ships the blob in plaintext *and* inside the envelope.
3. **The import writes it verbatim** (`:6048`) into the new shell's `metadata`. Checked, and this is
   the *narrower* half: `always_active` and `allow_private_network` are read from
   `connector_definitions.metadata`, **not** from `persona_credentials.metadata`
   (`core/models/connector.rs:249`; `engine/api_proxy.rs:265`), so
   [untrusted-definition-validation](./untrusted-definition-validation.md) §7.A's SSRF channel is
   **not** reachable from a bundle. What *is* written is a foreign machine's
   `healthcheck_last_state` / `_last_success` / `usage_count` / `anomaly_score` — and
   `healthcheck_last_success == Some(false)` **blocks** readiness at
   `commands/design/connector_readiness.rs:1042`, while `mcp_gateways.rs:109` reads
   `json_extract(c.metadata, '$.healthcheck_last_state')` for the vault list. **A bundle plants the
   inputs to a verdict [credential-readiness-resolution](./credential-readiness-resolution.md) owns.**

**Fix:** enumerate the keys. `CredentialMetaExport.metadata` should be a rebuilt object carrying
`description` and nothing else — health and usage telemetry is *state about a running installation*,
which this very module already declared non-portable for Athena (`:146-150`, reason 3). The exclusion
list is written down for one section and not applied to the one holding remote output.

### 7.E — P1: a NOT NULL cross-store reference is committed before the row it names

```rust
// data_portability.rs:8098-8115   USER database, inside a transaction
tx.execute("INSERT INTO knowledge_bases (id, credential_id, …) VALUES (?1,?2,…)", …)
// :8182
tx.commit()?;                       // ← the reference is now durable
// :8189                           APP database, after the commit
let _ = conn.execute("INSERT OR IGNORE INTO persona_credentials …", …);
```

`credential_id` is `format!("kb-cred-{new_kb_id}")` (`:8089`) and the row it names is created in the
**other** store, after the commit, with the result discarded. A failure is unobservable: the KB
exists, its vault shell does not, and Connections shows nothing to delete. The `let _ =` is not
covered by any existing census rule — `unverified-effect-dispatch` requires an `emit`,
`discarded-sync-watermark-write` a watermark noun, `discarded-guard-verdict` a compare-and-set
`UPDATE`. This is [second-database](./second-database.md)'s territory arriving through the importer.

**Fix:** insert the shell **before** the user-DB transaction commits (it is `INSERT OR IGNORE`, so a
rollback leaves a harmless orphan shell rather than a dangling FK), and bind the result — a failure
here should push a warning, which the function already has a channel for.

### 7.F — P2: the byte-size guard covers one of the two containers the same command accepts

`import_portability_bundle` filters for `["zip", "json"]` (`:1965`). `run_bundle_import` branches:

```rust
let content = if path.extension().is_some_and(|ext| ext == "zip") {
    read_zip_bundle(path)?                      // :2227 — declared size + capped reader + post-check
} else {
    std::fs::read_to_string(path)               // :2229 — no cap of any kind
};
```

`MAX_DECOMPRESSED_SIZE` (50 MiB) protects the compressed container and not the uncompressed one, which
is the wrong way round — and the module has the right shape elsewhere:
`MAX_CREDENTIAL_IMPORT_BYTES` (2 MiB) is checked with `fs::metadata` **before** `read_to_string`
(`:9705-9714`), with its reasoning written out at `:49-57`.

**Fix:** four lines, copied from `import_credentials`.

### 7.G — P2: the export enforces none of the importer's limits and forecasts the wrong ones

`compute_export_stats` (`:1605`) produces a pre-flight forecast and is careful about it — its comment
at `:1651-1656` distinguishes caps that **truncate** from caps that **reject**, and calls the
asymmetry out as pre-existing. All seven forecasts are **counts** (`:1673-1684`). The limit this
install is at **99.7%** of is **bytes** (§0.2), and it is not forecast, not enforced at write time,
and not reported anywhere. The two sections carrying 90% of the bundle — `persona_memories` (63%) and
`project_skills` (27%) — are the two the exporter does not cap at all, while twins are capped at 10
and KPI measurements at 100.

**Fix:** measure `json.len()` in `save_bundle_to_file` (`:4914`) against `MAX_DECOMPRESSED_SIZE`
before writing and refuse with the number, and add a byte estimate to `ExportStats.warnings`. Then
cap the skills section by total bytes, since per-file 256 KiB × unbounded files is not a cap.

### 7.H — P2: the passphrase floor is 8, measured in two different units, with no strength check

| Site | Check | Unit |
|---|---|---|
| `data_portability.rs:1784` `usable_passphrase` | `p.len() >= 8` | **bytes** |
| `:9562` `export_credentials` | `passphrase.len() < 8` | **bytes** |
| `useExportPicker.ts:368-370` | `passphrase.length >= 8` | **UTF-16 code units** |

A four-character CJK passphrase is 12 bytes and 4 code units: the backend accepts it, the frontend
refuses it. Since the backend is the more permissive side and the frontend is not the boundary
(`:1898`), the effective floor for any direct caller is **8 bytes** — three emoji. And 600,000 PBKDF2
iterations in front of an 8-character human passphrase is a rounding error against an offline attack
on a file the user was encouraged to move off the machine.

**Fix:** one `Passphrase` newtype with a private field and a validating constructor, used on both
sides via the bindings, checking a real strength floor (length **in graphemes** plus a zxcvbn-style
score), and the UI showing the same verdict the backend will apply.

### 7.I — P3: `build_persona_bundle` truncates at 5,000 with no channel to say so

`import_export.rs:174-183` reads a persona's memories with `Some(5000)`. Its big sibling built
`push_truncation_warning` + `export_warnings` precisely because *"the caps dropped data with no signal
on either end"* (`:1753-1756`) and did not carry the pattern to the single-persona exporter. Latent
today (max 292 memories on one persona), and it feeds the `Result<bool>` in §9.

### 7.J — P3: a bundle's declared skill `content_hash` decides a branch and is never checked against its own files

`write_project_skills` computes `differs` from the **incoming** `skill.content_hash` against the local
directory's hash (`:8921-8927`), and never recomputes the incoming files' hash against the value the
bundle declared. A bundle that declares a hash equal to the local one has its (different) files
**skipped**; a bundle that declares a mismatching one is written under `overwrite`. The exploitable
direction is only "cause a skip", so severity is low — but it is the same P2 shape one level down:
a digest is present, and it is compared to the wrong thing.

### 7.K — what this path CLEARED

Four things the brief, the neighbouring paths, or the obvious reading predict, which measurement
refutes:

- **"An export can be replayed into a different install to steal the vault."** Only with the
  passphrase, and the envelope is correct: `get_decrypted_fields` (`:9362`) → `encrypt_section`
  (`:9391`) → AES-256-GCM under PBKDF2-SHA256 at 600,000 iterations with a fresh salt and nonce.
  **A bundle does carry credential secrets in a form another install can use** — that is the feature,
  the import re-encrypts them under the target's own master key (`:9462`), and every decrypt is
  audit-logged (`:9363`). **The weakness is the 8-byte floor (§7.H), not the construction.**
- **"The plaintext bundle leaks credential values."** Not in the credential section: **0 literal
  credential-shaped values in 89,757 bytes of `metadata` across 25 rows**, and 0 in 1,306
  `workspace_knowledge` rows (re-run after my own instrument failure). The two that *do* travel are in
  `persona_memories.content`, and they are [column-encryption-at-rest](./column-encryption-at-rest.md)'s
  finding reaching a new channel, not a new leak.
- **"The plaintext `app_settings` secrets travel."** They do not. `PortabilityBundle` (`:215-272`) has
  no `app_settings` section, and the Athena import writes settings through a **three-key allowlist**
  declared as *"a SECURITY BOUNDARY, not a convenience … enforced twice"* (`:119-128`), asserted by a
  test. [secret-display-and-transfer](./secret-display-and-transfer.md)'s clearance holds and this
  path re-confirms it.
- **"`export_full` writes a bundle its own validator rejects."** No. Every **count** cap is satisfied
  on this install — 78/200 personas, max 292/500 memories, 0 personas over 100 triggers, 0 oversize
  `design_context` or `system_prompt`, 0 `metadata` over `MAX_SCHEMA_LEN`. `validate_bundle` would
  pass it. **The cap it is about to breach is the byte cap in `read_zip_bundle`, which
  `validate_bundle` never sees** — and that inversion is why §7.G is a deviation rather than a
  cleared item.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **A signature cannot tell you the payload is *safe*, only that it is *unchanged*.** `bundle.rs:739`
   already says this in a comment — *"signature verification only proves who built the bundle"*. The
   digest chain in §7.B closes authenticity; it does nothing about a trusted peer sending a hostile
   `system_prompt`. That belongs to
   [untrusted-definition-validation](./untrusted-definition-validation.md), and the two paths compose:
   verify **then** reconstruct, in that order, because reconstructing an unauthenticated payload
   normalises an attacker's object into a well-formed one.
2. **A count in the success type cannot tell you the count is *right*.** `ExportOutcome { written: 0 }`
   makes §0.3 visible; it does not make the filter correct. The gate on the *destination's default* is
   the shared-implementation test in §7.A's fix (3), not a type.
3. **A byte forecast is an estimate.** `serde_json::to_string_pretty`'s output size cannot be known
   without producing it; §7.G's fix measures the real string before writing, which is exact but too
   late to *plan* around. An accurate pre-flight forecast would need a second serialization pass over
   a 50 MB structure — real cost, and the honest reason the forecast counts rows instead.
4. **`is_dir()` on `root_path` is TOCTOU-racy and cannot not be** (named in
   [untrusted-definition-validation](./untrusted-definition-validation.md) §8.7). Low value locally;
   named so the next reader does not mistake a containment fix for a race fix.
5. **The census cannot assert an absence, and every largest finding here is one.** *"No import
   proceeds on an unverified signature"*, *"no manifest field goes unread"*, *"no export writes an
   empty artifact"* are statements about what does **not** happen. §9 counts a countable proxy for one
   of them and says so; the other two need a Rust test (§9's second mechanism).
6. **A newtype cannot encode passphrase strength.** It can force one implementation of the length
   check (closing §7.H's unit split); entropy needs a library and a product decision about what to
   refuse.
7. **Idempotent round trips need a stable identity the format does not have.** Fixing §0.5 means
   adding an `origin_id` to the export types and matching on it — a format change, i.e. a
   `format_version` bump, which is exactly the cost the module has been avoiding by using
   `#[serde(default)]` for every additive field (`:227`, `:233`, `:243`). The additive convention that
   made this format pleasant to extend is what makes an identity fix expensive.

---

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes — two types, and §4 holds both against all seven qualifications.** The count type
(`Result<bool>` → `Result<ExportOutcome>`, **5 sites, 2 files**) lands on **Q5 with Q4 vacuous**; the
`VerifiedBundle` newtype (**3 sites, 1 file**) lands on **Q5 with Q4 satisfied by a private field**.
**Ship the count type first** — it is the one that turns a total silent failure into a number, and it
is five `Ok(true)`s. The gate below is the ratchet that holds the export half while that lands, and
it is deliberately the half a regex can see.

### The condition this signal is a proxy for

> *A command that moves a whole dataset across the process boundary reports an outcome its type
> cannot express, so "it carried nothing" and "it worked" are the same value.*

**An adopting repo must re-derive its own proxy and must NOT port this pattern.** The precondition
here is specific: this repo declares its data-movement doors as `#[tauri::command]` Rust functions
returning `Result<T, AppError>`, and spells the defect as `T = bool`. In a Next.js app the same
condition wears `return new Response(csv)` with no row count and a 200 on an empty body (`ascent`'s
passports CSV, `api/org/export/route.ts:57`); in a React client it wears a success toast keyed on a
resolved promise (`vibeman`'s `KnowledgeBasePanel.tsx:88`, reporting a `limit=1000`-truncated length
as complete); in a shell script it wears `exit 0` (`brainiac`'s `backup.sh` is the counter-example —
it refuses at `:81-85` on a size floor). **This pattern scores zero on all three.**

### Not already gated — the neighbours I checked

I ran **all 119 rules in `scripts/census/rules.json`** over my two match files (119 regexes over 2
files — not the full-registry census run, which the doctrine forbids a composer). Five existing rules
fire in `data_portability.rs` at all, **one** of them within ±12 lines of any of my five functions,
and **zero** fire anywhere in `import_export.rs`:

| rule | matches in my files | on my functions |
|---|---:|---|
| `unfalsifiable-tier-guard` (ipc-session-token-race) | 5 | **2** — `:1799`, `:9555`, the `#[requires]` attribute lines above `export_full` / `export_credentials` |
| `persistence-handle-in-command-tree` | 11 | 0 |
| `unverifiable-conflict-clause` | 10 | 0 |
| `optional-store-handle` | 9 | 0 |
| `hand-rolled-emptiness-refusal` | 2 | 0 |
| *(any rule at all in `import_export.rs`)* | **0** | — |

The one overlap is on **two of five functions, at a different line, for a different condition and a
different fix**: `unfalsifiable-tier-guard` asks *can the guard behind this attribute return `Err`*
(fix: delete the guard); this rule asks *can the success type report what was carried* (fix: change
the return type). A command can be, and `export_credentials` is, both. Also checked and non-colliding
by construction: `untyped-command-payload` (keys on command **parameters**),
`secret-as-bare-string-field` (struct fields), `discarded-guard-verdict` /
`discarded-sync-watermark-write` / `unverified-effect-dispatch` (all `let _ =` shapes),
`silent-row-skip` (`query_map` adapters), `empty-sample-as-confident-zero` (numeric metrics).

### Precision and recall

**Precision: 5 of 5 hand-read, all true positives.** `export_full` (`:1800`), `export_selective`
(`:1833`), `export_selective_to_path` (`:2128`), `export_credentials` (`:9556`), `export_persona`
(`import_export.rs:240`). Every one writes a caller-chosen file, every one returns `Ok(true)` for
"path chosen" and `Ok(false)` for "cancelled", and **none can express what it carried** — which for
`export_credentials` is measurably 0 of 25 (§0.3) and for the other four is a bundle whose truncations
ride *inside* the artifact (`export_warnings`) and therefore reach the importing human but never the
exporting one.

**Recall is deliberately partial and stated.** The pattern requires the fn name to *begin* with a
data-movement verb, so it does not see `artist_cancel_export` (correctly — that is a cancel) nor a
future `save_workspace_archive` or `write_backup`. Widening the verb list to a suffix match adds
`artist_cancel_export` and drops precision to 5/6 for one name that is not a data-movement door at
all; **the prefix form was chosen for precision over recall and the trade is stated here so the next
reader does not "fix" it.** It also cannot see the same defect expressed as `-> Result<()>` or
`-> Result<String>` where the string is a path — a real instance of the condition that this proxy
misses by design, because a returned path *is* information.

### Two implementations — exact agreement on the partition, ±2 on the population

A brace-matched line walker and a whole-file non-consuming regex, no shared code, both stripping
`#[cfg(test)] mod` blocks by **brace matching** (never a line threshold) and excluding
`/tests/`, `/bindings/`, `*_test.rs`, `*_tests.rs`:

```
impl #1 (line walker):   1,658 commands   125 -> Result<bool>
impl #2 (content regex): 1,656 commands   124 -> Result<bool>
both:  5 data-movement commands returning bool   16 returning a named type   ← identical membership
```

The ±2 on the population is the same reconciliation
[untrusted-definition-validation](./untrusted-definition-validation.md) §12.7 recorded (commands
inside a `#[cfg(…)]` arm counted once by one method and twice by another) and does not touch the
partition, which is what the rule measures. **The useful output is the method, not the number.**

### The positive control partitions the anchor

Both rules key on the same anchor — `#[tauri::command]` above a fn whose name begins with a
data-movement verb. The violating arm takes `Result<bool,`; the control takes `Result<` **not**
followed by `bool,`. **Disjoint by construction** (a negative lookahead on the same position), and
together they are the whole population:

```
21  #[tauri::command] fns named (export|import|backup|restore|dump)_*
 5  -> Result<bool, _>                       <- violating   (5 of 5 are EXPORTS)
16  -> Result<NamedType, _>                  <- compliant   (the control; 12 of 16 are IMPORTS)
```

**The data says the discriminator is not in the pattern.** The regex does not distinguish export from
import — the codebase does: **every bool is an export, and no import is a bool.** A control returning
~0 would mean the repo has no compliant form and the rule measures house style. It returns 16 in 11
files, including `import_persona` 40 lines from `export_persona` in the same file.

```json
{"rules":[{"id":"opaque-artifact-outcome","goldenPath":"docs/concepts/golden-paths/portable-export-bundle.md","title":"A data-movement command reports a bare bool, so it cannot say what it carried","roots":["src-tauri"],"extensions":[".rs"],"signal":{"pattern":"#\\[tauri::command\\](?:[ \\t]*\\r?\\n[ \\t]*#\\[[^\\]\\n]*\\][ \\t]*)*[ \\t]*\\r?\\n[ \\t]*(?:pub[ \\t]+)?(?:async[ \\t]+)?fn[ \\t]+(?:export|import|backup|restore|dump)_[a-z0-9_]+[ \\t]*\\([^{}]{0,900}?\\)[ \\t]*->[ \\t]*Result[ \\t]*<[ \\t]*bool[ \\t]*,","flags":"g","ignoreCommentLines":true,"description":"A #[tauri::command] whose fn name BEGINS with a bulk data-movement verb (export/import/backup/restore/dump) and whose success type is `bool`. PROXY FOR the stack-free condition: a command that moves a whole dataset across the process boundary reports an outcome its type cannot express, so 'it carried nothing' and 'it worked' are the same value. THE COST IS MEASURED, NOT ARGUED: export_credentials (commands/core/data_portability.rs:9556, doc comment 'Export ALL credential secrets to a password-protected encrypted file') skips every credential whose service_type names a builtin connector (:9582). Replayed against a READ-ONLY COPY of the operator's live personas.db on 2026-08-16: connector_definitions holds 134 rows with is_builtin=1 on 134 of 134; persona_credentials holds 25 rows over 23 distinct service_type values; 23 of 23 match a builtin connector name; so the command emits 0 credentials and 0 fields. Its unified-export twin build_encrypted_credentials (:9347) is the SAME loop over the SAME cred_repo::get_all + get_decrypted_fields MINUS the eight-line filter, and emits 25 credentials / 42 fields. Nothing checks entries.is_empty() before the envelope is PBKDF2'd, AES-256-GCM'd and written (:9604-9661), and the command returns Ok(true) meaning ONLY 'the user picked a save path' (:9661) versus Ok(false) 'cancelled' (:9664). The client reads it exactly that way: useDataPortability.ts:232-233 does setCredExportStatus(saved ? 'success' : 'idle'), so a vault export that carried nothing renders as success. PARTITION, NOT A RATIO: the anchor (a #[tauri::command] fn whose name begins with a data-movement verb) matches 21; this rule takes 5 and its positive control takes the other 16; 5 + 16 = 21 exactly, with no unexamined third population. The regex does NOT distinguish export from import — the CODEBASE does: all 5 bool-returning doors are EXPORTS (export_full :1800, export_selective :1833, export_selective_to_path :2128, export_credentials :9556, commands/core/import_export.rs:240 export_persona) and 0 of the 16 compliant doors is an export-only shape; 12 of the 16 are imports. THE COMPLIANT TYPE IS 40 LINES AWAY: import_persona (import_export.rs:280) returns Result<Option<ImportResult>> — None for 'the user cancelled the dialog', a struct for what happened — which is precisely the two facts `bool` conflates. PRECISION 5/5 hand-read: every match writes a caller-chosen file and returns Ok(true) for 'path chosen'. RECALL is deliberately partial: requiring the verb as a PREFIX excludes artist_cancel_export (a cancel, not a data movement) which a suffix form would wrongly include, and misses the same condition worn as -> Result<()> or -> Result<String>; the prefix form was chosen for precision over recall and the trade is stated so the next reader does not 'fix' it. THE PARAMETER-LIST FILL MUST NOT BE A CONSUMING WILDCARD: [^{}]{0,900}? cannot cross a function body (which opens with `{`), so a match can never slide from one fn's signature into a later fn's return type — the composition failure the doctrine records for [\\s\\S]{0,N}? windows. TWO INDEPENDENT IMPLEMENTATIONS (a brace-matched line walker and a whole-file content regex, no shared code, both stripping #[cfg(test)] mod blocks by BRACE MATCHING and excluding /tests/, /bindings/, *_test.rs, *_tests.rs) reconcile at 1,658 vs 1,656 commands and 125 vs 124 Result<bool> overall, and agree EXACTLY on this rule's 5 and the control's 16 with identical membership. DOES NOT OVERLAP its nearest neighbour by file: all 119 existing rules were run over both match files; five fire in data_portability.rs, only unfalsifiable-tier-guard lands within +/-12 lines of any of these functions (at :1799 and :9555, the #[requires] ATTRIBUTE lines above export_full and export_credentials), and it asks a different question (can the guard behind this attribute return Err — fix: delete the guard) with a different fix (change the return type); ZERO existing rules fire anywhere in import_export.rs. Also non-colliding by construction with untyped-command-payload (keys on command PARAMETERS), secret-as-bare-string-field (struct fields), discarded-guard-verdict / discarded-sync-watermark-write / unverified-effect-dispatch (all `let _ =` shapes), silent-row-skip (query_map adapters). LEGAL FIX: change the success type to a struct of counts — ExportOutcome { written, skipped, dropped, path_chosen, warnings } — mirroring import_persona. Held against the doctrine's seven qualifications this lands on Q5 (withholding beats requiring: there is no `true` to return) with Q4 vacuous (the value is produced by the command, not supplied by a caller) and Q3 satisfied (5 enumerable construction sites in 2 files). DO NOT silence a match by renaming the function, by wrapping bool in a type alias, or by returning Result<()> — all three preserve the defect. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero — the runner fails structurally on zero matches, by design. PRECONDITION (re-derive per repo, do NOT port): this repo declares data-movement doors as #[tauri::command] Rust fns returning Result<T, AppError> and spells the defect as T = bool. In Next.js the same condition wears a 200 on an empty body (ascent api/org/export/route.ts:57 filters every repo without a passport out of the CSV and returns a header-only file, while the three sibling branches were hardened to 404 with the anti-pattern named in the comment at :40-42, 'Returning a header-only 200 in the null case is success theater'); in a React client it wears a success toast keyed on a resolved promise (vibeman KnowledgeBasePanel.tsx:88 reports a limit=1000-truncated length as complete); in a shell script it wears exit 0 (brainiac scripts/backup.sh:81-85 is the counter-example — it refuses on a size floor). THIS PATTERN SCORES ZERO ON ALL THREE."},"baseline":{"files":2,"matches":5},"floor":500},{"id":"opaque-artifact-outcome-positive-control","goldenPath":"docs/concepts/golden-paths/portable-export-bundle.md","title":"POSITIVE CONTROL — the compliant half: the same door reports a named result type","roots":["src-tauri"],"extensions":[".rs"],"signal":{"pattern":"#\\[tauri::command\\](?:[ \\t]*\\r?\\n[ \\t]*#\\[[^\\]\\n]*\\][ \\t]*)*[ \\t]*\\r?\\n[ \\t]*(?:pub[ \\t]+)?(?:async[ \\t]+)?fn[ \\t]+(?:export|import|backup|restore|dump)_[a-z0-9_]+[ \\t]*\\([^{}]{0,900}?\\)[ \\t]*->[ \\t]*Result[ \\t]*<[ \\t]*(?!bool[ \\t]*,)","flags":"g","ignoreCommentLines":true,"description":"POSITIVE CONTROL: the identical anchor — a #[tauri::command] fn whose name begins with a data-movement verb — in its COMPLIANT form, where the success type is a named result type that can report what was carried. Disjoint from the violating rule by construction: the two differ only by a negative lookahead at the same position, so no command can match both. Measured 2026-08-16 at cd9d094d9: 16 matches in 11 files, against the violating rule's 5 in 2 files; 5 + 16 = 21 = the whole anchor population. Exemplars: import_persona (commands/core/import_export.rs:280) -> Result<Option<ImportResult>>, which sits 40 lines below export_persona's Result<bool> in the SAME FILE and encodes exactly the two facts bool conflates (None = the user cancelled the dialog, Some(struct) = what happened); import_portability_bundle (commands/core/data_portability.rs:1950) -> Result<Option<PortabilityImportResult>>; export_bundle_to_clipboard (commands/network/bundle.rs:142) -> Result<ClipboardExportResult>. Must be non-zero: a control near zero would mean the repo has no compliant form and the violating rule is measuring house style rather than a choice the codebase makes both ways. It returns 16, and the way it returns them is the finding — every bool in the anchor is an export, and no import in the tree is a bool."},"floor":500}]}
```

### Validation — run 2026-08-16 via `node scripts/census/run-census.mjs --rules <scratch> --check`

Validated in a **private scratch registry with a filename unique to this composer**
(`peb-rules-scratch.json`). **The full registry was NOT run.**

| # | Scenario | Expected | Observed | Exit |
|---|---|---|---|---|
| 1 | Rule + control as shipped, `--check` | baseline holds; control non-zero | `OK opaque-artifact-outcome 2/2 files, 5/5 matches, 963 walked, floor 500` · `OK …-positive-control 11 files, 16 matches` | **0** |
| 2 | Fault: **rise** — baseline claims 1/4 | must fail | `files rose 1 -> 2 (+1)` · `matches rose 4 -> 5 (+1)` | **1** |
| 3 | Fault: **silent drop** — baseline claims 3/6 | must fail | `files dropped 3 -> 2 (-1) without the baseline moving. A silent drop is a broken matcher more often than fixed code` | **1** |
| 4 | Fault: **broken matcher** — `roots` narrowed to `src-tauri/src/commands/network` | must fail structurally | `walked 9 files but floor is 500. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| 5 | Fault: **zero match** — verb replaced with a nonexistent token | must fail structurally | `matched zero files anywhere … DELETE the rule rather than baselining it at zero` | **1** |
| 6 | **Re-extracted from this document** and re-run | identical | identical to #1 | **0** |

### Where it executes

**`npm run census:check`, which is chained inside `npm run check` AND is a `pre-push` lefthook job**
(`lefthook.yml`, `golden-path-census`). Per the brief's calibration that distinction is the point:
`ci.yml` runs its Rust tests but is red on 10 pre-existing failures, so a gate that only lives there
effectively runs nowhere. The hook was added on 2026-08-16 with its reason in the file — *"Added
because it was enforced NOWHERE: `census:check` lives only inside `npm run check`, which nothing runs
automatically."* The runner's own fail-loud contract (floor, zero-match, stale-exclude, rise, silent
drop) is what makes this a gate rather than a report; rows 2–5 are that contract exercised.

### What this gate does NOT catch — and the second mechanism, specified

It ratchets **one** of this path's three largest findings and none of the others, because the other
two are **absences** and the census cannot express an absence:

- **§7.B (the signature that reaches no branch, and the digest that reaches nothing at all).** The
  honest instrument is a **Rust unit test in `engine/bundle.rs`'s own `#[cfg(test)]` module**, and it
  must assert its instrument first, in the shape `ipc_auth.rs:1039-1044` established: build a bundle,
  flip one byte of `personas/<id>.json`, assert `apply_import` returns `Err` **and** assert the
  unmodified bundle still imports (so a test that refuses everything fails loudly). A second test
  asserts an unknown signer is refused without an explicit `UnsignedConsent`. **Two tests, one file,
  and neither is expressible as a count.**
- **§0.2 / §7.G (a byte ceiling nobody forecasts).** A `debug_assert` or a hard refusal in
  `save_bundle_to_file` comparing `json.len()` to `MAX_DECOMPRESSED_SIZE` — a runtime property, not a
  countable token.
- **§7.A's real fix.** The gate counts the *type*; it cannot see that two doors select different sets.
  That needs the shared-fixture test named in §7.A fix (3).

And per the contract's fifth failure mode: **this gate points at a destination whose default must be
right.** `ExportOutcome` is only worth arriving at if the field that matters is **required** — a
struct with `written: Option<u32>` relocates the concern instead of concentrating it. Make every
count required and non-defaulted, or the green check moves and the silence stays.

Ship all of it, and ship the count type first.

---

## 12. Corrections to the brief

The brief made five priming claims plus a calibration. **Three hold as written, one is wrong in a way
that matters to two documents, and one turned out to be a smaller half of a bigger finding.**

1. **"`export_credentials` — whose own doc says 'Export all credential secrets' — has exactly one
   authorization statement, and that statement cannot return `Err`."** **Confirmed, and already owned
   by [ipc-session-token-race](./ipc-session-token-race.md), so not re-derived here.** The brief's
   instruction to *go past it* was right and §0.3 is what is past it: **the ungated door, when
   called, exports 0 of this install's 25 credentials and returns `Ok(true)`.** The authorization
   finding and the emptiness finding are independent — fixing either leaves the other.

2. **"`bundle.rs:406` computes `sig_valid` and `:497` stores it, and nothing branches on it. Four
   files away, `enclave.rs:213` does the same thing correctly."** **The first half is confirmed. The
   second half is wrong, and it is wrong in
   [untrusted-definition-validation](./untrusted-definition-validation.md) §7.D too**, which says
   `enclave.rs` *"verifies an Ed25519 signature over the exact raw manifest bytes **and refuses**
   (`enclave.rs:213,:278`)"*. Measured at `src-tauri/engine/src/enclave.rs` (322 lines, unchanged
   since 2026-07-27, one file — there is no `src-tauri/src/engine/enclave.rs`):
   - `pub fn verify` is at **`:209`** (`:213` is inside it); **`:278` is a comment inside
     `parse_enclave`**, a ZIP reader.
   - `verify` **returns `Ok(EnclaveVerifyResult { signature_valid, content_intact, creator_trusted, … })`**
     at `:253-265`. **It contains no refusal.** There is no `if` on any of the three flags in the file.
   - Its **only** caller is `verify_enclave` (`commands/network/enclave.rs:39-46`), which hands the
     struct to the frontend. **The enclave format has exactly two commands — `seal_enclave` and
     `verify_enclave` — and no importer at all**, so there is nothing for it to refuse.

   **So `enclave.rs` is not the compliant counter-example; it is the same defect with one more field
   computed.** What it genuinely does better, and what §3 cites it for, is the *computation*: raw-bytes
   verification instead of a re-serialisation (`:216-223`), key↔peer-id binding (`:226-229`), and
   `content_intact` existing at all (`:241`). **Three real improvements, zero branches.** That
   sharpens the leaf rather than softening it: **in this repo, two independent archive formats compute
   a verification verdict and both hand it to React.** It is also why the convergence result reads as
   physics — the same shape recurs in three sibling repos, and the "good" local example turned out to
   be a fourth instance.

3. **"The skills bundle names a `root_path`: skill file names are guarded, the root gets `is_dir()`,
   and writes land in `<root>/.claude/skills/` — where CLI agents read instructions — after the DB
   commit."** **Confirmed in every particular, and worse than stated in one:** the brief implies a
   conflict flow. There isn't one. A `root_path` matching no existing project takes
   `ProjectImportMode::Fresh` (`:6504`, `:6938`) — **no conflict entry, no resolution prompt, first
   pass** — and this machine's 14 project roots leave `C:\Users\mkdol` unclaimed while
   `C:\Users\mkdol\.claude\skills` holds 15 live machine-wide agent skills. §7.C, computed and not
   performed.

4. **"`import_composition_workflows` takes the persisted row model … 0 live rows; the command is
   unregistered."** **Confirmed and already owned** by
   [untrusted-definition-validation](./untrusted-definition-validation.md) §7.B, including the
   cheapest-fix-is-deletion conclusion. Not re-derived. One addition from this side: it is the **only**
   data-movement command in the tree that returns a bare `u32`, so it is in §9's positive control on
   a technicality — it reports a count, which is the right shape, applied to the wrong door.

5. **"`data_portability.rs:8182→8189` commits a NOT NULL `credential_id` to one store, then inserts
   the credential into the other with `let _ =`."** **Confirmed exactly, and it is not covered by any
   of the three existing `let _ =` census rules** (`unverified-effect-dispatch` needs an `emit`,
   `discarded-sync-watermark-write` a watermark noun, `discarded-guard-verdict` a compare-and-set
   `UPDATE`). §7.E.

6. **The brief's four "questions worth answering", answered by measurement.** *What an export
   contains* — §0.2, replayed section by section, and the headline is a size nobody forecasts, not a
   field nobody expected. *Whether secrets are re-encrypted for transport* — **yes, correctly**:
   decrypted from the local master key and re-sealed under PBKDF2-SHA256 at 600,000 iterations with a
   per-section salt and nonce, which is the **only** encrypted export in six codebases. *What an
   import trusts* — a format version (refused, and Personas is alone in refusing one), a hash
   (refused, on the TOCTOU path only), a signature (**not** refused), a content digest (**never
   read**), and a filesystem root (`is_dir()`). *Whether an export can be replayed into a different
   install* — **yes, entirely; nothing binds a bundle to an installation**, which is the feature, and
   the only thing standing between a stolen bundle and a cloned vault is an 8-**byte** passphrase
   floor (§7.H).

7. **A prediction of my own, disproved and recorded.** I expected `export_full` to already exceed
   `validate_bundle`'s caps on this workspace — the module's own comment at `:1651-1656` sets that
   expectation up by distinguishing caps that truncate from caps that reject. **Every count cap is
   satisfied** (78/200 personas, max 292/500 memories, 0 oversize fields). The cap this install is at
   **99.7%** of is the **byte** ceiling in `read_zip_bundle`, which `validate_bundle` never sees and
   the pre-flight preview does not forecast. The wrong hypothesis is what produced §0.2, and the
   correction is the finding: **the exporter enumerates seven caps and the binding one is not among
   them.**

8. **An instrument failure of my own, recorded because it nearly shipped.** My first credential-shape
   scan of `workspace_knowledge` reported clean. It had queried a `summary` column that does not exist
   (the column is `statement`); the helper swallowed the error and returned `[]`, so the scan examined
   **zero of 1,306 rows** and reported zero findings — a checker that measured nothing and passed. Re-run
   over the real columns: still zero, now earned. This is the doctrine's *"assert the instrument before
   you trust the result"* committed inside the composition that cites it.

9. **On the command count.** Mine are **1,658** (line walker) and **1,656** (content regex) — a third
   and fourth figure beside the corpus's 1,661 and 1,662. Method: `#[tauri::command]` followed by an
   optional run of attribute lines and then a `fn` declaration, over `src-tauri/**/*.rs` excluding any
   path containing `/tests/` or `/bindings/` and any file matching `*_test.rs` / `*_tests.rs`, with
   `#[cfg(test)] mod` blocks removed by **brace matching**. The spread across four measurements is
   ±6 on ~1,660 and it has never touched a partition any rule depends on. **Stop measuring it; state
   the method.**

**Scratch artifacts.** The database copies, the replay harness, the two command scanners, the
overlap checker and the scratch rule registry live in the session scratchpad and were not written
into the working tree. The only file this composition adds is this document.
`scripts/census/rules.json` was **not** edited — both rules ship as the fenced JSON above, per the
contract's concurrent-composer rule.
