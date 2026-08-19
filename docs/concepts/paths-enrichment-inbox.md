# Paths enrichment inbox — flow-back from the full-corpus transplant test

Handoff for the `docs/concepts/paths/` owner. This is the **adoption / flow-back**
half of the v3 full-corpus transplant test (2026-08-18): the 105-subject corpus
was applied as a lens to three sibling repos — **gravitone-gcloud** (Next.js
imaging/AI, IndexedDB, no backend), **politicas** (Next.js + PGlite civic data),
**pumper** (Rust axum job-queue backend, zero lineage) — via 12 read-only shards
(4 category-bundles × 3 repos). Method + kit in the fork scratch
(`v3-fulltest-kit.md`, `v3-fulltest-FINAL.md`); this file is the actionable
distillation.

**Author does NOT edit `paths/`** — that is the hierarchy owner's territory. Each
item below names the exact frontmatter edge it adds so it can be applied
mechanically. Evidence lives in the sibling repo at the cited `file:line`.

> **Headline result (context for these edits):** the corpus physics held.
> **27/27 law-cells hold across all three repos, 0 violations** — pumper's 9/9 at
> zero lineage is the strongest evidence. Every applicable subject that held in a
> foreign repo is now **eligible for `status: transplant-tested`** (your call — you
> own the frontmatter). The convergence oracle fired cleanly: independent repos
> reinvented the same invariants (id-tiebreaker sorts, dispatch-time single-flight
> with identity-carrying claims, refuse-don't-advance).

---

## A. NEW-LAW candidates (for `_laws.md` — apex, rarest)

### A1. vocabulary-evolution / version-at-the-identity-boundary — **CONFIRMED 3/3 REPOS**
The 9 laws govern a vocabulary *at rest* (`one-authority-per-vocabulary`); none
governs a vocabulary *changing over time*. Three independent repos hit exactly
this gap — the signature of real physics:
- **gravitone IMPLEMENTS** — `RETIRED_PHASES = { motion: "frames" }` + read-seam
  `migrateProject` remaps stored refs idempotently, worst-news-first (a retired
  member's blocked status can't vanish). `lib/projects.ts:57-82,247`.
- **politicas IMPLEMENTS (differently)** — version is part of the identity:
  `politicas:schranka:v1` storage key + `*-cz-v1` verdict tags, "změna tvaru = nový
  klíč, žádná migrace" (shape change = new key, no migration). 5+ sites:
  `features/schranka/followCodec.ts:26`, `verdict.ts:33`, `kg-verdict.ts:73`,
  `law-verdict.ts:24`, `report.ts:12`.
- **pumper NAMES THE GAP** — event `kind` has one dispatch door but payloads are
  not schema-versioned; `is_terminal` duplicated across 5 sites (`webhook.rs:16`,
  `events.rs:253` + 4 more). Enumerable ≠ versioned.

**Proposed statement:** *A closed vocabulary versions its changes. A retired member
names its heir and stored references migrate forward at one read seam; a changed
member mints a new identity (key / wire tag / schema id), never an in-place edit —
so a consumer of old data gets a clean miss, not a silent misread.* Suggested
anchor id `vocabulary-versions-its-changes`. Extends `one-authority-per-vocabulary`
along the temporal axis.

### A2. egress-parity / "sanitization follows the value" (gravitone, 2 bundles)
A scrub applied at one egress must apply at **every** egress the same value
reaches. `api.ts:102-127` + `log.ts:24-40`: an API key leaked in the HTTP response
because the *log* was scrubbed and the *body* was not — same `ImagingError.message`,
one defended, one not. Closest of the 9 is `one-validation-door`, but that governs
writes-IN; this governs untrusted-values-OUT. Candidate anchor
`sanitization-follows-the-value`.

### A3. honest-unavailable-vs-absent trichotomy (politicas) — or a `failure-not-empty-success` refinement
Empty must not lie about *why*: DB-busy → HTTP 200 `DataUnavailable`; genuine-missing
→ `notFound()` 404; missing is never drawn as a value.
`features/shared/components/DataUnavailable.tsx:6-13`, `HeadToHead.tsx:19-24`. Adds
a THIRD state (temporarily-unreachable) the binary empty/failed lacks. May fold
into `failure-not-empty-success` rather than stand alone.

### A4. `failure-not-empty-success` statement broadening (pumper) — refinement, not new law
From "a scanner that finds nothing vs can't run" to **any derived/measured
quantity**: `ClaudeSpend.cost_usd: Option` (None=unknown ≠ $0), `doc_count: Option`
(not folded to 0), omitted job stages, simhash sentinel-vs-honest-zero. Same physics
one level up. `error.rs:10-56`, `doctor.rs:92,389`, `events.rs:37`.

---

## B. NEW-TECHNIQUE candidates (add to a subject's `techniques:` list)

| under subject | technique | evidence | law it cites |
|---|---|---|---|
| scheduling | **misfire-cutoff = last completed pass, not a config constant** | pumper `scheduler.rs:730` | derivation-names-recomputation |
| scheduling | **derive-next-fire-at-tick** (makes "NULL=gone" structurally impossible) | pumper `scheduler.rs` | — (fixes personas' own 349-NULL next_trigger_at) |
| prompt-assembly | **named-withholding-with-refusal-gate** (name what was withheld; post-parse gate refuses any plan acting on withheld ids) | gravitone `recalibrate/route.ts` | gate-sees-target + failure-not-empty-success |
| prompt-safety | **shim-transport metacharacter refusal** (refuse, don't sanitise, an empirically-measured hostile set at the transport boundary) | pumper `engine-claude/lib.rs:637-720` | one-validation-door |
| quality-gates | **four-state ledger + `satisfied` state** (met-by-a-named-mechanism-with-a-rerunnable-command) — the C2 fix | politicas `scripts/census/rules.json` | gate-sees-target |
| structured-output | **map-by-id-with-positional-fallback + dropped-row backfill to a re-processing default** | politicas `hybrid-bench/semop.ts` | identity-survives-reuse |
| eval-harness | **deterministic-truth-as-gold** + **benchmarked non-LLM floor as a first-class arm** | politicas `hybrid-bench/derived.ts`, `predicates.ts` | — |
| web-scraping | **differential-replay observatory** (per-(plugin,site) drift with bisect naming the flip point) | pumper `extraction.md:149,193` | — |
| realtime-events | **bounded replay ring with explicit Reset-vs-empty** (non-durable fan-out with a first-class "you lost events, reset") | pumper `events.rs:75-217` | failure-not-empty-success |
| client-state | **version-in-the-storage-key** (eliminates the migration class — no migration code can be wrong because none exists) | politicas `followCodec.ts:26` | (A1) |
| data-viz | **lint-as-provenance-gate** (every rendered number cites its source, static rule, precision-first) | politicas `require-source-citation.cjs` | count-carries-predicate |
| accessibility | **sr-only-clip compact mode** (dense view hides via clip, never display:none — Ctrl+F/AT still find it) | politicas `LeaderboardTable.tsx:380-397` | — |

---

## C. BETTER-APPLICATION / counter_evidence (add an `applications/<stack>--<technique>.md` or a `counter_evidence:` witness)

- **@concurrency-guards/cross-process-exclusion** — unique-index `add` as CAS
  (`store.add` + ConstraintError = atomic claim where localStorage has no CAS).
  gravitone `projects.ts:287-324`.
- **@concurrency-guards/single-flight** — browser multi-tab single-flight with the
  irreducible CAS window documented exactly. gravitone `jobs.tsx:245-300`.
- **@error-handling/structured-propagation** — capture-phase tx listener recovers a
  null `tx.error` (+ counter_evidence: "the platform hands you a null error at the
  door"). gravitone `studioDb.ts:127-153`.
- **@cost-metering/usage-ledgers** — meter a **failed** call's spend (the expensive
  failures are exactly the ones whose cost normally vanishes). pumper `app.rs:243`.
- **@cost-metering** — cost-basis provenance (`unpriced ≠ $0`) + share-split-not-
  replicate attribution (sums exactly to source). gravitone `pricing.ts`, `impact.ts:80`.
- **@audit-logging/append-only-design** — tamper-evident sha256 hash-chain + Merkle,
  with an external-auditor-runnable PURE verifier. politicas `ledger.ts`.
- **@migrations/pre-migration-snapshots** — `VACUUM INTO` (WAL-consistent) gated by a
  named `BackupDecision` enum, retention-bounded. pumper `backup.rs`.
- **@data-access/batching-and-n-plus-one** — PGlite chunked upsert with an
  empirically-derived width cap (≤500 rows / ≤30k binds near the 65535-param WASM
  ceiling). politicas `internals.ts:112-165`.
- **@ipc-contract/drift-gates** — EXPECTED-set diff generalized beyond the route set
  to any scoped-router invariant (body-ceiling); source-scanning error-vocab gate.
  pumper `routes/mod.rs:655,677`, `error.rs:330-452`.
- **@p2p-networking/exposure-controls** — "auth says who, target-policy says what":
  loopback/link-local/private/CGNAT block + scheme allowlist + 422-not-200 on absent
  session. pumper `remote.rs:145-200`.
- **@supply-chain/dependency-policy-gates** — `deny.toml` where every waiver carries
  reasoned exposure + upgrade path + drop-condition. pumper `deny.toml` (the reference
  impl for the personas leaf that was never written).
- **@realtime-events/push-vs-refetch-reconciliation** — owner-identity-beats-absence
  merge ("interrupted is a statement about the observer, not the job"). gravitone
  `jobs.tsx:205-231`.
- **@migrations/data-migrations** — read-seam migration, idempotent, retired→heir
  worst-news-first. gravitone `projects.ts:50-92`.
- **@design-tokens/token-enforcement** — unread token = drift, delete don't warm.
  gravitone `tokens.ts:84-115`.
- **@data-viz/metric-identity** — machine-readable ClaimReview JSON-LD metric
  contract, emitted ONLY for verified claims ("a dash must not testify"). politicas
  `CitableNumber.tsx:36-53`.
- **@canvas-graph/graph-layout** — deterministic hash-seed (FNV-1a) layout so the
  picture reproduces SSR/CSR/all-users (shareable permalinks). politicas `lib/kg/layout.ts`.

---

## D. DIRECT PERSONAS-DEFECT flow-backs (actionable on personas itself, not paths/)

These are cases where a sibling already fixed a defect personas' own docs record as open:

- **pumper's `check-doc-sync.mjs` FIXES the exact `evt.type==='user'` turn-boundary
  bug personas' identical hook has** — personas' own `.claude/CLAUDE.md` documents
  "THIS HOOK HAS NEVER FIRED." pumper's 3-signal layered predicate (content-shape +
  `toolUseResult` annotation + `isMeta`, reject-on-any) is **replay-proven over 31
  transcripts / 1,136 edits**. `pumper/scripts/docs/check-doc-sync.mjs:18-50` is a
  drop-in reference for the personas fix (which `golden-path-deferred-fixes.md`
  currently defers on purpose — the fix now has a proven implementation to copy).
- **politicas' four-state `satisfied` ledger** → the corpus's own **C2** (gates
  built-and-unwired): a gate that asserts its own instrument before reporting health.
- **EXPECTED-set / set-equality drift gates** (pumper ×4, politicas) → the corpus's
  **29-orphan-bindings** problem (a diff-shaped gate cannot see an absence). `BTreeSet ==`
  a hand-kept EXPECTED set catches removals a diff misses.

---

## E. Load-bearing cautions (confirmed by the run — do not regress these)

- **cooldown-and-debounce's "fifth shape beats time-windows" escape hatch is
  load-bearing.** pumper AND politicas satisfy rate-safety via DB-idempotency, not a
  timer — a mechanical "is there a cooldown timer?" check false-flags both.
- **Every forged subject MUST keep a strong definitional opener.** It resolved every
  subject-boundary judgment call ("is a CSS-grid a table?", "is a localStorage record
  a scheduler?"). It is what makes the finer unit portable.

---

## Round 2 — full-contexts × whole-corpus coverage (2026-08-18)

Exhaustive follow-up to the sampling transplant test: **104 contexts × 105 subjects**,
pruned to **875 live cells (8%)**, all scanned (T2, 22 group-agents). **808 cells:
706 holds · 96 partial · 1 violates · 119 n/a-confirmed.** 53 findings → 32
problem-classes (**20 FIX applied, 33 DEFER**). Full pairing ledger + per-site detail
in the fork scratch (`phaseC-pairing-ledger.txt`, `findings-*.json`). **142 enrichment
candidates** surfaced; the corpus-shaping ones below.

### New-law candidate (5th)
- **externally-derived-enforcement-must-expire** (pumper `sync-replication`,
  `datahub.rs` `expire_stale_pauses`/`pauses_are_stale`): enforcement derived from an
  external signal must EXPIRE when that signal goes unobservable, not freeze at its
  last value. A pause/ban/gate keyed off a feed that stops reporting must not persist
  forever on stale evidence. Distinct from the 9; candidate anchor
  `derived-enforcement-expires-with-its-signal`.

### High-value new-techniques (by subject) — 31 total, top picks
- **quality-gates / source-census extinction gate** (pumper): a `#[cfg(test)]` test
  walks its own `src/`, comment/whitespace-stripped, and asserts an anti-pattern idiom
  is *extinct*, with a floor-assertion so a truncated scan fails loudly. The
  self-enforcing version of the census idea.
- **quality-gates / unmeasured-as-first-class-verdict** (gravitone): a gate emits FOUR
  verdicts (pass / violation / not-applicable / **unmeasured**), and the vacuous pass
  is NOT counted as enforced.
- **realtime-events / epoch-zero for backfilled bitemporal CDC** (politicas
  `changeEvents.ts`): a versionless full-snapshot source that gains change-tracking sets
  an epoch so the first diff doesn't emit the entire corpus as "changed".
- **audit-logging / total-vs-chained counts beside the verifier** (politicas
  `countReviewAudit`): return `{total, chained}` next to `verifyReviewChain()` so an
  erased chain is distinguishable from a never-used one (empty ≠ erased).
- **scoring-rubrics / formula-ref-as-recompute-edge** (politicas `contribution.ts`): a
  stored derived score carries the *name* of the formula that authored it; a write-guard
  refuses cross-ref overwrite; read surfaces render "stale, not silently wrong" when
  store-ref ≠ code-ref. `derivation-names-recomputation` as a runtime edge.
- **subprocess-lifecycle / kill_process_tree** + **prompt-safety / check_shim_argv** +
  **prompt-safety / env_clear-allowlist** (pumper engine-claude): the three-part Windows
  shim hardening (tree-kill the money-spending grandchild; measured metacharacter
  refusal across a cmd.exe re-parse; env scrub against injection exfil).
- **cost-metering / spend-survives-failure-channel** (pumper): the paid tier can spend
  money and THEN fail; the error carries the spend so the ledger records it.
- **accessibility / role-withdrawal** (gravitone): DROP `role=menu` rather than ship a
  role whose keyboard contract isn't met — an honest-absence a11y move.
- **app-shell / shell-owned single skip-to-content target** (politicas) instead of
  per-page ids.
- **observability-telemetry / outcome-independent-loss-tally** (pumper): count a
  durability loss at the failure site, never on the 1-of-N success arm.

### New problem-shapes worth a corpus deviation/technique (the DEFER design-gaps)
`schema-drift-by-presence-not-version` (a drift gate that tests field *presence* passes a
type change — a `gate-sees-target` instance), `hand-mirrored-wire-type-drops-additive-fields`
(serde mirror silently drops future fields — the vocabulary-versioning law again),
`total-zero-with-records-reads-complete` (missing `UnknownTotal` arm), `retry-classifies-nonretryable`
(no transient/permanent split — appears in pumper webhook + politicas ingest), `backoff-without-jitter`.

### Re-confirmed direct personas flow-back
pumper's `check-doc-sync.mjs` fixing personas' never-fired Stop-hook surfaced AGAIN
(independently, in the job-orch shard) — the drop-in reference is real and repeated.

---

## Round 3 — dynamic verification lane pilot (gravitone, 2026-08-18)

First run of the two dynamic lanes (measured-performance + functional/LLM exercise)
that upgrade "holds (by pattern)" to "holds (proven by a run)". Probes committed to
gravitone `53478cc` (local). Thesis: dynamic found what static structurally can't —
modestly but really. The corpus-feedback items (the whole point of closing the
one-directional loop):

### CORPUS DEMOTIONS / boundary-sharpening (technique claims that don't survive a run)
- **render-budget → SPLIT into two techniques.** The static "holds" was true only on
  the **DOM-weight** axis (per-row element count bounded). MEASURED: a single 1-of-N
  update rebuilds ALL N rows + re-sorts (zero memoization) — "render-budget" silently
  implied **reconciliation efficiency**, which does not hold. A pattern scan cannot see
  this. Corpus fix: `render-budget` (DOM weight) and `reconciliation-budget` (re-render
  cost under a single logical update) are DIFFERENT claims and must be separate
  techniques under the performance/perf-instrumentation subjects, each with its own
  `verified_by` probe. This is the first demotion produced by application, exactly the
  feedback edge the analysis flagged as missing.
- **structured-output / schema-vs-runtime divergence.** A declared JSON-Schema constant
  (`additionalProperties:false`) that the runtime parser never enforces reads as
  "enforced" to a static scan. Add a technique note: a schema is a claim only if a
  runnable probe proves the runtime honors it; `evidence:` (the schema constant) is not
  `verified_by:` (the enforcement).

### The `verified_by:` edge (operationalizing the `satisfied` state)
Every technique whose claim is a QUANTITY (perf) or an OUTCOME (functional/LLM) should
carry a `verified_by:` runnable command beside its `evidence:` file:line. The pilot
produced three concrete ones (render-budget, sort-stability, edit-plan-parse probes).
Where a perf/functional technique has no `verified_by`, that is the scan-depth gap —
the lane fills it. A probe that FAILS is triaged BUG (→ fix + the probe is its
regression test) or DEMOTION (→ corpus, above).

### Static over-count corrected by a run
The "gravitone 15 sort sites missing an id-tiebreaker" DEFER was over-stated: running
all 15 shows 14 already carry the tiebreaker and the 15th sorts distinct strings
(total order already). Dynamic enumeration + execution corrected a static count — the
same class of error the census `count-carries-predicate` law warns about, now caught
in the scan's own findings.

---

## Round 4 — deeper-fix triage demotions (2026-08-18)

The 33 DEFERs were triaged (a)/(b)/(c) and the (a)-class fixed behind probes (16
behavior-changing fixes shipped with fail-before/pass-after regression tests:
gravitone 2 local, politicas 9 pushed, pumper 5 pushed). The (c)-class — corpus
lessons that over-reach and were demoted by application, NOT repo bugs:

- **wizard-flows / step-commit-gate** (gravitone, 2 sites) — the "steppers need a
  per-step commit gate" claim applies to TRANSACTIONAL/data-entry wizards where later
  steps depend on earlier commits; it must NOT fire on CREATIVE-ITERATION pipelines that
  treat non-linear navigation as a feature. Boundary: gate the claim on "later step
  reads earlier step's committed state".
- **client-fetch-cache / warm-remount-and-SWR** (gravitone, 2 sites) — the cost this
  technique eliminates is a NETWORK round-trip. Against a cheap local store (IndexedDB /
  PGlite) a warm module cache isn't warranted. Boundary: scope the warm-remount/SWR claim
  to network-backed surfaces, not local-first stores.
- **toasts-notifications / render-in-context** (gravitone, 1 site) — centralized toast/
  bell rendering in app-shell chrome is CORRECT architecture; flagging it "out-of-context"
  is a context-scan artifact. Boundary: only fire when the in-context PRODUCER is also wrong.
- **inline-copy-bypasses-catalog** (politicas, scan-precision) — false positive from a
  stale CODE COMMENT; the strings already go through `t()`. The problem_shape must key on
  rendered strings, not comments.
- pumper: 0 demotions — every technique transplanted cleanly.

Combined with round 3's **render-budget → split (DOM-weight vs reconciliation-budget)** and
the **schema-vs-runtime** note, application produced **~6 corpus demotions/boundary-
sharpenings** — the feedback edge (sibling application → corpus status) is now demonstrably
live. Every one is a "possibly-damaging lesson" that a pattern scan would keep at full
strength and that only a RUN could falsify.

---

## Round 5 — LightTrack compatibility proof + corpus gaps (2026-08-19)

Proved the coverage wiring end-to-end against a NEW target (LightTrack, Rust
LLM-observability backend) sourcing the corpus from the **ai-registry clone** (not
personas paths/). All 34 contexts mapped, 167 live cells / 3570 naive (95.3%
pruned); the registry-sourced `subject-index.json` loaded cleanly (105 subjects,
matched categories.json). **The registry is a valid corpus source; a new repo with
a context-map runs unchanged.** Matrix: fork scratch `coverage-matrix-lighttrack.json`.
Top batch subjects for LightTrack: usage-analytics, scoring-rubrics, background-jobs,
error-handling, eval-harness, job-coordination, table, cost-metering (6-7 contexts each).

### NEW-SUBJECT candidates — corpus gaps for the LLM-observability-PLATFORM domain
LightTrack *is* the observability/eval platform (it observes and judges OTHER apps'
LLM calls), a domain the corpus — grown from an app that *consumes* LLMs — doesn't cover:

- **judge-reliability / inter-rater-calibration** — Cohen's κ, Pearson, MAE/RMSE drift
  sentinels between judges and against gold. `eval-harness` and `scoring-rubrics` exist
  but carry no inter-rater-reliability technique. Candidate new subject (or a technique
  cluster under eval-harness): *how you know your judge is trustworthy over time*.
- **observability-as-a-service (the platform, not the observed)** — `observability-telemetry`
  describes a service instrumenting its OWN logs/crashes. It has no subject for "you are
  the platform other apps send their traces to" (ingest contract, tenant isolation,
  cardinality/retention economics of foreign traces). Genuine domain the corpus lacks.
- **redaction-pipeline** — PII/secret scrubbing as a first-class pipeline stage mapped
  weakly to `credential-vault` / `prompt-safety` / `usage-analytics`; none is a direct hit.
  Candidate: a `redaction` subject or a cross-cutting technique.

Correctly NOT gaps (subject exists, domain doesn't use it → n/a, not a corpus hole):
streaming-output, retrieval, agent-memory, agent-chaining — LightTrack is batch/
fire-and-forget and observes rather than does these.

These are forge candidates for the REGISTRY (the corpus's new home). Forging them is
the migration/corpus-owner session's call; recorded here as the first evidence that
running coverage against a NEW domain surfaces real corpus growth, not just repo fixes.

---

## Round 6 — LightTrack FULL coverage (2026-08-19), via the new runner

First full A→B→C→D coverage run through `scripts/census/coverage/` on a NEW repo
(LightTrack, Rust LLM-observability platform), corpus sourced from the registry.
34 contexts → 167 live cells → 8 scan agents (155 cells: 133 holds/42 partial/1
violates) → pairing ledger (30 problem-classes, 2 FIX/28 DEFER) → triage-with-probes.

**Shipped (pushed to github.com/xkazm04/lighttrack):** 9 (a)-class fixes, each behind
a Rust regression probe (fail-before/pass-after), 7 commits — subprocess wall-clock
timeout+reaper, constant-time secret compare (via the repo's own `secret_eq`),
sort-tiebreaker, structural (non-substring) status classification, a `RelayStatus`
enum authority, `Status::ALL`-driven validators, hoisted `RECURRENCE_KEY`, revenue
predicate-echo, trace `unpriced_spans` count. **Convergence datapoint:** the remote
had INDEPENDENTLY made the same `secret_eq` swap — a fourth-party reinvention of a
corpus-predicted fix.

**~18 (b) decision-queue items** (auth/billing/lease/schema product calls) recorded
for the LightTrack owner.

### (c) corpus feedback

- **LAW-boundary refinement — `one-authority-per-vocabulary` over-reaches at a
  deliberate zero-dependency module boundary.** `render/md.rs::status_glyph` keeps a
  second copy of the status vocabulary, but `render` intentionally has NO `core`
  dependency and its `_ =>` arm degrades to a neutral `·` (distinct, not a crash),
  documented. Proposed: the law should treat *a documented zero-dependency boundary
  whose fallback degrades gracefully* as accepted counter-evidence, not a violation.
  Same shape as the render-budget demotion. (This edits `_laws.md` — apex contract —
  so it's the corpus owner's call, recorded here rather than forged directly.)

### New-technique candidates — the observability-PLATFORM domain (corpus gap, confirmed)

The corpus's tracing/cost subjects are EMITTER-authored (you instrument your own app);
LightTrack is the PLATFORM others send traces to. Four concrete new-technique candidates:
- **trace-ingestion-trust-boundary** — receiver stamps `received_at`, stamps+strips
  `api_key_id` so attribution can't be forged, canonicalizes OTLP+SDK ids.
- **server-owned-accounting-clock** — every budget window keys on server `received_at`,
  not client `ts`, so a skewed client clock can't move a cap.
- **recomputation-worthiness-classification** (Grown/Changed/unknown-digest) — decides
  WHEN recomputing a derived verdict is worth paying for. `refines derivation-names-recomputation`.
- **k-anonymity-over-sources-before-projection** + differencing-rate-limit — cross-tenant
  aggregation where the push *sequence* is a side channel even when payloads are scrubbed.

Plus ~40 better-application witnesses across the 8 shards (FX money-honesty, breaker
around paid spawns, RedactionCache, dual sqlite/pg atomic-claim, judge-bias suite,
determinism provenance) — full detail in the `findings-lighttrack-*.json`.
