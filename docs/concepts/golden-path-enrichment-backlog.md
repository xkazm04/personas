# Golden-path enrichment backlog — from the sibling field test

Handoff from the portability field test (run 1, 2026-08-17): the Personas
golden-path corpus was applied as a lens against three sibling repos
(`gravitone-gcloud`, `politicas`, `pumper`) using the identical protocol in
`<repo>/docs/knowledge-library-field-report.md`. This file is the **flow-back**:
practices those repos already have that the corpus should adopt, plus two
cross-repo defects and one hygiene item.

Owned by the corpus (this repo). Each item names a target — an existing path to
refine, or a new leaf to write. Evidence lives in the sibling repo at the cited
`file:line`; read it there.

> Note on independence: `politicas` co-evolved with this corpus (it keeps its
> own `scripts/census/rules.json` and a four-state adherence ledger against it),
> so treat its agreement as weaker evidence of physics than `gravitone` or
> `pumper`, which are independent adopters.

## Two convergent DEFECTS — 4 of 4 repos including this one

These are physics-grade (convergence on a *defect*), and the first is live.

- **C1 — no working content secret scanner, anywhere.** personas (gitleaks never
  installed, 3,186 commits), gravitone (name-only), politicas (stale gitleaks
  comment → nonexistent `secret-scan.mjs`), pumper (none). Four repos, four ways
  to have only name-based `.gitignore` defence. **Live consequence:** the
  `sk-ant-oat01-` token in the public `personas-cloud` repo that this gap failed
  to catch. Already owned by [`secret-leak-scanning`](./golden-paths/secret-leak-scanning.md);
  this field test raises it from "personas problem" to "ecosystem problem".
- **C2 — the ratcheting gate machinery is built and unwired, 4 of 4.** Every
  repo authored gates that exit non-zero correctly and sited them in no
  enforcement boundary (personas: warn-level enforces nothing; politicas:
  `census --check`/`library:check` in an uninvoked `npm run check`; gravitone:
  by hand; pumper: CI-only). Owned by
  [`commit-path-gates`](./golden-paths/commit-path-gates.md); the field test is
  the cross-repo confirmation.

## Flow-backs — adopt into the corpus, ranked

### Take first (each answers a known corpus gap)

- **F1 — supply-chain / dependency-audit gate → WRITE THE UNWRITTEN LEAF.**
  The spine has `supply-chain-policy` (platform-delivery/gates-and-conventions,
  r5) with no path written. **pumper is the reference implementation:**
  `deny.toml` + `ci.yml:70-84` runs `cargo-deny check advisories bans sources`,
  every waiver carrying a reasoned exposure + upgrade path + drop-follow-up, and
  `sources` hard-denies non-crates.io. Physics: any redistributable binary
  ingesting untrusted input reinvents these four checks. Compose `supply-chain-policy`
  from pumper's evidence; TS analogue is `npm audit`/`osv-scanner` + a lockfile
  policy. **Not in corpus today.**

- **F2 — set-equality inventory test → FIX A NAMED LIMITATION.** The doctrine
  records "a diff-shaped gate cannot see an absence"
  ([`cross-artifact-drift-gate`](./golden-paths/cross-artifact-drift-gate.md),
  and the orphan-bindings case). **Two siblings independently built the fix:**
  pumper `routes/mod.rs:530-655` regenerates the OpenAPI spec and compares by
  `BTreeSet ==` to a hand-kept `EXPECTED` set (symmetric — catches removals and
  orphans a diff misses); `removal_guard.rs` is a second instance; politicas has
  the same shape. Adopt as the prescribed form in `cross-artifact-drift-gate`
  §2, and consider a census rule for diff-shaped gates that should be
  set-equality. **This directly resolves the 29-orphan-bindings problem** the
  corpus can only currently detect by inventory.

- **F3 — four-state adherence ledger + upstream backflow → ADOPT THE
  META-PROTOCOL.** politicas maintains adopted / satisfied / declined /
  unreviewed per corpus rule, with hash-drift detection on the ported engine, a
  recurrence-ranked unreviewed report, and an `upstream` field that flags
  contributions back. `scripts/census/rules.json` (politicas). This is the
  portability-tracking layer the corpus's own field test wants; fold it into the
  field-test kit and consider it for the corpus's own rule ledger.

- **F5 — dead-reference affordance → FILL entity-picker P4.**
  [`entity-picker`](./golden-paths/entity-picker.md) P4 reports the
  "tell the user a referenced entity is gone" affordance as **unmet across all
  six of its own siblings**. gravitone `StudioView.tsx:31-113` implements it —
  plus a shared-machine non-disclosure sub-clause (don't leak who-else). Cite it
  as the found-in-a-sibling answer; it is the first positive P4 datapoint.

### Take next — net-new paths

- **F4 — SSR/RSC deterministic number formatting.** politicas `lib/format.ts`
  avoids `Intl`/`toLocaleString` server-side because the thousands-separator byte
  (U+00A0 vs U+202F) drifts by ICU version and breaks React hydration.
  [`number-and-cost-formatting`](./golden-paths/number-and-cost-formatting.md)
  has zero `hydrat` hits — add this as a physics sub-clause for any SSR/RSC repo.

- **F7 — `no-server-import-in-client` lint.** politicas forbids *value* imports
  of server modules in `"use client"` files (allows `import type`) — the RSC
  bundle/security boundary as an enforceable rule. No corpus path owns this
  bundle/leak invariant. Candidate new leaf.

### Take as refinements / convergence datapoints

- **F6 — provenance-as-lint** (politicas `require-source-citation` build-fails on
  a figure without `<SourceNote>`, `formatCitable` byte-identical machine claim)
  → refines `data-provenance-disclosure` with the enforcement + byte-identity
  angle.
- **F8 — redact-by-live-value** (gravitone `log.ts:17-74`: redact by the live
  secret *value*, never log `detail`) → a value-based backstop for
  `secret-and-pii-redaction` / `telemetry-scrubbing`, complementing the
  pattern-based approach (which C1 shows is incomplete).
- **F9 — skipped-CI-step-reads-as-green** (politicas `sentinel.yml`; gravitone
  convergence) → convergence datapoint for `adding-a-ci-gate`, and a live
  personas problem (installer-test.yml: 8 runs, all skipped).
- **F10 — fail-open-observability** (pumper `main.rs:183-211`: a fail-open
  guarantee announces its degradation loudly at boot) → convergence for an
  error-surfacing policy.

## Corpus hygiene

- Every Principle head cites `docs/research/portability-test.md`, which **does
  not exist** — a dangling reference across ~189 paths. The field-test kit is its
  natural fill; promote the kit there.
- Universal-core leaves (`swallowed-error-telemetry`, `commit-path-gates`, etc.)
  use `## The one way` instead of `## Principle`; three field-test agents had to
  handle both. Either normalize the heading or document the two styles.

---

## v2 full-scope additions (2026-08-17)

The v2 run scanned the **full applicable corpus** (204 leaves, 9 domain shards ×
3 repos) with per-leaf independence flagging. It reconfirmed C1/C2 and every v1
flow-back, and added these — full evidence in each repo's
`docs/field-report-v2/<domain>.md`. **Both convergent defects are now confirmed
at shard depth in all four repos**, and the corpus physics itself is validated:
**pumper (independent Rust, zero lineage) holds 58 corpus clauses with 0
self-match** — physics that survives transplant into an unrelated stack.

**Fixes a documented personas defect:**

- **F11 — derive-next-fire-at-tick.** pumper derives a schedule's next fire time
  *at tick* rather than storing it at write, which makes "NULL = gone"
  **structurally impossible** — the architectural fix for the corpus's own
  **349-NULL-`next_trigger_at`** defect. `refines` scheduled-trigger-firing.
- **F12 — checksummed forward-only migration ledger.** pumper's `_sqlx_migrations`
  makes editing an already-applied migration a boot-time checksum error, an
  immutability property `run_incremental` **structurally cannot have**
  (`schema-change` already notes personas lacks a ledger). `built-elsewhere`.
- **F13 — a gate that asserts its own instrument before reporting health.**
  politicas' four-state ledger was built explicitly to avoid "gates running
  green while checking nothing" — the **C2 fix**, and it adds a `satisfied`
  fourth state (met-by-a-named-mechanism-with-a-re-runnable-command), earned
  because gates-written-from-a-principle scored 0 true positives. `refines` the
  meta-protocol.
- **F14 — structural LLM chokepoint by visibility, not convention.** pumper makes
  the metering bypass a **compile error** (`EngineSet::claude` is `pub(crate)`)
  plus an inventory test. `refines` headless-model-call P6.

**Net-new practices (no corpus leaf):**

- **F15 — automatic pre-migration WAL-consistent backup** (`VACUUM INTO` before
  the migrator, gated by a pure decision fn returning named outcomes,
  retention-bounded, unit-tested). `absent`.
- **F16 — WASM operator-plugin sandbox** (fresh Store + fuel + memory cap + empty
  Linker). `refines` untrusted-definition-validation.
- **F17 — civic-data provenance cluster** (politicas): content-fingerprinted
  claim receipts that self-announce staleness; a tamper-evident audit chain that
  distinguishes empty-from-erased; blindness-disclosure as a typed detector
  state. `refines` data-provenance-disclosure / audit-trail-view / anomaly-marker.
- **F18 — "named, never hidden" withheld-payload gate** (gravitone): prove a
  model plan did not reason about material it was deliberately not given. `absent`.
- **F19 — migration DDL carries the prior migration's post-mortem** (pumper 0020
  cites 0004's sentinel that silently disabled dedup over 3,367 rows). `absent`.
- **F20 — retention as a pin-graph reachability veto** ("age alone is not
  permission"; preview == executor). `refines` retention-and-pruning.
- **F21 — durable transactional outbox + DLQ + replay** (pumper). `refines`
  post-write-side-effects.

**APPLY-lane defects found in the sibling repos (reported, not fixed — sibling
repos, and their maintainers' call):**

- pumper — **`credential-injection-into-child` (med-high, security):** engines
  spawn child processes inheriting the full unsanitized env (API keys, Sentry
  DSN, webhook secrets) while running a model over untrusted scraped content; no
  `.env_clear()`. The corpus's own physics, violated in an independent repo.
- pumper — webhook HMAC secrets stored plaintext at rest; spend ceiling defaults
  to unlimited (`budget_usd: Option`, `None` = unlimited).
- gravitone — unauthenticated money-spending `/api/imaging/*` routes with no
  ceiling (held: single-operator today).
