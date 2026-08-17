# Golden path — Client rule mirroring

> **Topic path:** `client-runtime` › `state-management` › `client-rule-mirroring`
> [situation spine](../situation-spine.md) · recurrence 11 · risk **HIGH** · sides: **client**
> (spine also carries `twoSided: true`, `fusedAcrossSides: false`) · convergence: **diverged**
> (label tested — see [§12.1](#12-corrections-to-the-brief)) ·
> dimensions: **function · resilience · code-quality · ui**
> `mergedFrom`: *Client mirror of backend rules* + *Effective config resolution*
> Composed 2026-08-16 against `master` @ `c47cd36fa`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` and all **963** `.rs` under `src-tauri/`
> (excluding `target/`), each walked by **two independent matchers**. All **1,033** files in
> `src/lib/bindings/` parsed for closed vocabularies. All **14** locale files parsed for every
> `status_tokens` group. Read in full: `core/src/error_taxonomy.rs` (838 lines),
> `src/lib/errorTaxonomy.ts`, `src/lib/errors/__tests__/errorTaxonomy.parity.test.ts`,
> `core/src/types.rs`, `src/lib/execution/executionState.ts`, `src/engine/kpi_derivation.rs`,
> `src/features/teams/sub_kpis/kpiMath.ts`, `core/src/models/trigger.rs`,
> `src/features/triggers/sub_triggers/triggerArmState.ts`,
> `commands/design/connector_readiness.rs`, `core/src/models/connector.rs`,
> `src/features/shared/components/display/connectorRunnability.ts`, `src/engine/background.rs`
> (`EventGateReason`), `src/features/triggers/lib/eventReason.ts`, `db/src/chain.rs`,
> `core/src/models/event.rs`, `scripts/generate-guidance-anchors.mjs`,
> `scripts/docs/gen-tour-anchors.mjs`.
>
> **Measured by EXECUTING both sides on the same input, not by reading.** Five mirrored pairs were
> run head-to-head:
>
> 1. **The error ladder.** `classify_error` (`core/src/error_taxonomy.rs:141-323`) was transcribed
>    into JavaScript and **gated against that file's own `#[cfg(test)]` module — 28 unit assertions,
>    2 flag assertions and 42 `PARITY_FIXTURES`, 0 failures — before being used**; the TypeScript half
>    is the **real `src/lib/errorTaxonomy.ts`**, run under Node's type stripping with only its one
>    aliased import stubbed. Both were then run over both fixture corpora and over every distinct
>    error string in the live database.
> 2. **The KPI off-track rule.** The real `kpiMath.ts` against a transcription of
>    `kpi_derivation.rs::kpi_is_off_track`, over all 65 live `dev_kpis`.
> 3. **The active-window rule.** The real `triggerArmState.ts` (gated against my transcription over
>    7 days × 206 samples, 0 mismatches) against `ActiveWindow::is_active_at`, exhaustively over
>    **35,052** representable overnight windows × 10,080 minute-slots each.
> 4. **Connector readiness.** The real `connectorRunnability.ts` against transcriptions of
>    `normalize_connector_role` and `classify_connector`, over the live catalog.
> 5. **The label layer.** `tokenLabel`'s lookup replayed against every live row of
>    `persona_events`, `persona_executions` and `chain_stop_reasons`.
>
> Plus a **dry run of both code generators** (their `writeFileSync` captured in memory; `git status`
> confirmed nothing was written into the repo) diffed against their committed artifacts.
>
> A read-only **copy** of the operator's live `personas.db` (347 MB, 244 tables, copied 2026-08-16
> 23:23 with its `-wal`/`-shm`; the live file was never opened for write) supplied every row count:
> 78 personas, 2,188 executions, 4,972 `persona_events`, 351 triggers, 65 KPIs, 41 KPI measurements,
> 25 credentials, 134 connector definitions. **The copy was deleted at the end of composition.**
>
> **`cargo` was NOT run** (the operator's app is in daily use). Every Rust claim is static or
> replayed in transcribed JavaScript, and every transcription was gated against the Rust file's own
> tests before use.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. Per the doctrine's new lineage rule, **one of the
> five is a port of this repo and is not counted as a second opinion** (§6).
>
> **Settles:** what to do when one decision has to exist in two languages.

---

## 0. The headline

**One table. One row. One screen. Two machine tokens on it — and one of them resolves to a
sentence in fourteen languages while the other renders as `delivered` to every user on
earth, 4,941 times.**

`persona_events` carries both a `status` and, for a gated event, a *reason*. Both are language-
agnostic tokens minted in Rust. Both are resolved by the same function, `tokenLabel`
(`src/i18n/tokenMaps.ts:35-51`), which returns the raw token when the lookup misses.

Replayed against the operator's live rows:

| | vocabulary | client copy | label copy | live rows that render a RAW MACHINE TOKEN |
|---|---|---|---|---:|
| the **reason** | `EventGateReason`, 9 arms (`src/engine/background.rs:948-991`) | `EVENT_REASON_TOKENS`, **9** (`eventReason.ts:17-27`) | `status_tokens.event_reason`, **9** in all 14 locales | **0 of 25** |
| the **status** | `PersonaEventStatus`, 8 arms (`core/src/models/event.rs:16-33`) | — (the ts-rs binding is imported) | `status_tokens.event`, **5** in all 14 locales | **4,972 of 4,972 — 100 %** |

The status table names `pending, processing, processed, failed, retrying`. The bus writes
`delivered` (**4,941 rows**) and `skipped` (**31 rows**). **Three** of the eight Rust arms have a
label at all, and **two of the five labels name statuses that are not variants of the enum** —
`processed` and `retrying` do not exist in `PersonaEventStatus`. The two most common terminal
statuses in the product have never had a label in any language.

The reason mirror is *three* hand-kept copies deep and has never drifted. The status mirror is one
copy and is 100 % wrong. **The difference is not the number of copies, the language boundary, or the
existence of a generated type — `PersonaEventStatus` HAS a ts-rs binding
(`src/lib/bindings/PersonaEventStatus.ts`, 8 arms, correct). The difference is that the reason's
obligation was written down, on both sides, and the status's was not.** The label table is a mirror
that nobody ever declared was a mirror, so nobody ever maintained it as one.

The same shape, smaller: `status_tokens.execution` has six labels including `error` — which is not
an `ExecutionState` — and lacks `incomplete`, which **20 of 2,188 live executions carry**.
`status_tokens.chain_stop` has 13 labels against `db/src/chain.rs`'s **15** `stop_reason` consts;
`lookup_failed` and `cost_ceiling_corrupt` — the two most recently added, and the two whose
docstrings explain that they *fail restrictive* — have no label in any language. That one is latent:
`chain_stop_reasons` holds 0 rows.

### The measured ladder — what actually predicts survival

Every mirrored pair in this repo that I could execute or count exactly, ordered by the machinery
standing between the two implementations:

| Mechanism | pairs | drifted | evidence |
|---|---:|---:|---|
| **The server sends the verdict** and the client prefers it | 1 | **0** | `AppError`'s serializer emits `category` + `auto_fixable` + `failover_eligible` (`core/src/error.rs:206-215`), computed once via the canonical helpers; `classifyUnknownError` (`errorTaxonomy.ts:259`) reads `err.category` first |
| **The client fetches the value at startup** | 2 | **0** | `lab_get_score_weights` → `evalFramework.ts:56-80`; `getDeadLetterConfig` → `api/overview/events.ts:89` |
| **Codegen, wired into a step that always runs** | 2 | **0** | guidance anchors **12/12** identical to a dry run; n8n limits **2/2** |
| **Codegen, wired into nothing** | 1 | **1** | tour anchors: **127** anchors in the tree absent from the committed allow-list, **4** in the allow-list gone from the tree |
| **Generated union + a Rust set-pinning test naming the TS constant** | 1 | **0** | `ExecutionState::TERMINAL`/`ACTIVE` ↔ `executionState.ts:41-57` |
| **Compiler-total table over a generated union** (`Record<Union, T>` / `satisfies`) | 6 files | **0** | `VALID_TRANSITIONS: Record<ExecutionState, …>` agrees with Rust exactly; `byomHelpers.ts:12,22` |
| **Hand-kept, obligation written on BOTH sides** | 10 sites | **0 executed** | error taxonomy (0 of 42 fixtures, 0 of 285 live rows, 0 of 33 helper comparisons); KPI rule (0 of 65) — **1 latent**, §7 D4 |
| **Hand-kept, obligation written on the CLIENT only** | 30 sites | **≥ 2** | `connectorRunnability.ts` (§7 D2), `triggerArmState.ts` (§7 D3) |
| **No obligation written anywhere** | 26 label groups | **≥ 5** | §0 above, and §7 D1 |

**And the two findings that reframe the rest:**

**(a) Generating a mirror guarantees the two copies agree with each other, not that either agrees
with reality.** `scripts/docs/gen-tour-anchors.mjs` emits two artifacts — a JSON the frontend
validates Athena-composed tours against, and a Rust allow-list `companion::tours` checks before
persisting one — and says in its own header that they are generated together *"so they never
drift."* They don't drift from each other. They are both **127 anchors behind the React tree**,
because the generator is wired into **nothing**: not `package.json`, not `scripts/run-codegen.mjs`'s
8 tasks, not `ci.yml`, not `lefthook.yml`. Its two sibling generators *are* wired, and both are
byte-fresh.

**(b) A "cross-FFI parity test" that runs on one side is a third copy, not a cross-check.** The
error taxonomy is the best-maintained mirror in the repo and it has two tests, one per language,
each headed `MIRRORED PAIR — this list is kept byte-for-byte in sync with …`. Neither test ever
compares the two ladders. `errorTaxonomy.parity.test.ts:63` asserts the **TypeScript** ladder against
the **TypeScript** fixture list; `error_taxonomy.rs:830` asserts the **Rust** ladder against the
**Rust** fixture list. Edit one ladder and its own fixtures consistently and **both suites stay
green while the two implementations diverge**. The apparatus that makes this pair look safe converts
a 2-copy problem into a 4-copy problem and asserts nothing across the boundary.

It is also pointing at a file that does not exist. `errorTaxonomy.ts:5` and the parity test's `:5`
both cite `src-tauri/src/engine/error_taxonomy.rs`; the crate was extracted and the file is
`src-tauri/core/src/error_taxonomy.rs`. **19 of the 56 file paths named inside a sync comment in
this repo (34 %) do not exist, and 17 of those 19 are TS→Rust pointers broken by that one
extraction.** The mirror's only maintenance instrument is a comment naming the other side, and a
single refactor invalidated a third of them at once.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and the clause everything else follows from. Send the verdict, don't send the
> inputs and hope.** When the server has already decided something the client needs to show or
> branch on, put the *decision* on the payload. A second implementation of a decision is a second
> decision; only one of them can be right and neither knows which.
> *Warrant: the one pair here whose verdict travels on the envelope has zero drift across every
> surface that consumes it, while five sibling repos between them hand-keep eleven mirrors and one
> sibling explicitly refuses to re-derive a server verdict and has a test asserting the refusal.*
>
> **P2 — physics. A mirror is not maintained by discipline; it is maintained by the mechanism that
> fails when it drifts.** Rank the available mechanisms by what breaks first and take the highest one
> that reaches: the server sends the answer; the client fetches the answer; a generator writes the
> copy; the compiler sees both sides; a test on the changing side names the file to update. A comment
> is not on this list.
> *Warrant: measured as a monotone ladder here — 0 drift at every rung with a mechanism, drift at
> every rung without one, and the worst outcome at the rung with no written obligation at all.*
>
> **P3 — physics. A generator only holds the line if something runs it.** A generated artifact whose
> generator is not wired into a step that always runs is a hand-kept copy that has stopped being
> hand-kept, and it is worse than one, because its header tells every reader it cannot drift.
> *Warrant: three generators in one repo, two wired and byte-fresh, one wired to nothing and 127
> entries behind the source it claims to project — while remaining perfectly consistent with its own
> twin artifact.*
>
> **P4 — physics. A parity test that runs on one side of the boundary is a third copy.** A test can
> only assert what it can import. When the two implementations are in different languages, a test in
> either language asserts its own side against a hand-written expectation — which is one more thing
> to keep in sync, wearing the costume of the thing that checks.
> *Warrant: the best-instrumented pair in this repo has two such tests, one per language, and neither
> compares the ladders; a sibling repo built the identical shape independently, asserting its client
> transitions against hardcoded literals under a docstring claiming it "mirrors the backend's
> lifecycle transitions exactly."*
>
> **P5 — physics. Write the obligation on BOTH sides, and name a symbol, not a story.** The side that
> changes is the side that needs the reminder, and it is never the side the comment is on.
> *Warrant: both mirrors observed drifting here carry their obligation only on the client, and in both
> cases the server's own comment explains the change that the client never received; 34 % of the file
> paths those comments name do not exist, and 40 % of them name no resolvable symbol at all.*
>
> **P6 — physics. A mirror must fail closed.** Two implementations will disagree eventually. Decide
> now which way: an arm the client does not recognise must degrade to the restrictive answer, never
> the permissive one, and never to a raw machine token on screen.
> *Warrant: independently reasoned in a sibling repo on two separate mirrors — "a drift here fails
> closed; it can only ever be narrower than the truth", and an unknown policy degrading to
> needs-review rather than auto-publish; here, the one client mirror written strictly ("a value is a
> reason ledger ONLY when every part is a token we know") is the one with zero live defects, and the
> one that falls through to the raw token is 100 % broken on live data.*
>
> **P7 — ergonomics. The label layer is a mirror too, and it is the one nobody declares.** A closed
> vocabulary that reaches a screen has three copies, not two: the server's enum, the client's
> handling, and the translation table. The third is written by whoever added the first label and then
> never revisited, in every language at once.
> *Warrant: 26 label groups here, five of them measurably behind the vocabulary they name, the worst
> covering 100 % of a 4,972-row table in 14 languages — and the gap is identical in all 14, because
> it was cloned from the source locale.*
>
> **P8 — ergonomics. Do not mirror to save a round trip you have not measured.** Most of these copies
> exist for instant feedback. That is a real requirement and it is usually satisfiable by fetching
> once and caching, not by re-implementing.
> *Warrant: the two pairs here that fetch instead of copy are both interactive surfaces and both have
> zero drift; the three that re-implement "so warnings appear instantly without an IPC round-trip"
> are the ones this document had to execute to find out whether they still agree.*
>
> **Scale condition.** P1, P2, P3, P6 are correctness on day one. P4 and P5 bite the first time
> someone edits one side. P7 bites the first time a non-English user sees the screen. P8 bites only
> when the mirror is large enough that keeping it costs more than the round trip.

---

## 1. Trigger

- "The backend already checks this, but I want the UI to show it instantly."
- "Keep this in sync with the Rust side." / "mirror of `Foo::bar`" / "exact port of `x.rs`"
- "Why does the badge say armed when the trigger didn't fire?" / "the UI says needs-setup but adoption succeeded"
- "Add a variant to the enum." (…and then: which four other places?)
- "It shows `dead_letter` instead of a real label." / "this word isn't translated"
- "I'll add a parity test so the two can't drift."

**If you are about to type** a comment containing *keep in sync*, *mirrors the Rust*, *must match*,
*in lockstep*, or *exact port of* — **or** a `const` whose members are machine tokens the backend
minted — **or** a predicate named like a Rust function you just read — **you are in this situation.**

You are **not** in this situation when the thing you are copying is a payload *shape*
([`bridge-type-contract`](./bridge-type-contract.md)), when the question is what the token should
*look like* once it exists ([`status-and-severity-badges`](./status-and-severity-badges.md)), or
when a value is genuinely client-only.

### The seam test

> **Would the server give a different answer than your code, or the same answer in a different
> shape?** A different *answer* is this leaf. A different *shape* is not.

| Territory | Owner | Do not restate |
|---|---|---|
| The generated `.ts` file, `bigint`, `rename_all`, orphan bindings, a hand-typed `interface` mirroring a Rust struct | [`bridge-type-contract`](./bridge-type-contract.md) | It owns **the shape crossing the wire**; this path owns **the decision that does not cross it**. The clean split: an `interface` is theirs, a `const`/`function` is mine — which is why §9's signal requires a value declaration. **Measured file overlap with `ipc-payload-typed-inline`: 5.4 %.** Its central fact is upstream of mine: a vocabulary with no `#[derive(TS)]` has no generated union to tether to, and `EventGateReason` is `pub(crate)`. |
| The pill, the tone token, `tokenLabel`, an untranslatable badge | [`status-and-severity-badges`](./status-and-severity-badges.md) | It owns the token you were **given**; this path owns **whether the client is entitled to invent one**. §0's 4,972 raw tokens are a badge-shaped effect with a mirroring-shaped cause: the label table is the third copy of a Rust enum and nothing says so. **Overlap with `untranslatable-token-label`: 2.7 %.** |
| Which tier/plan may see a feature, and where that is decided | [`tier-and-capability-gating`](./tier-and-capability-gating.md) | It owns **one specific mirrored gate** and already ratchets it (`undeclared-tier-branch`, 13 files). **Overlap: 0 %.** This path is the general case; do not re-gate tier. |
| Whether an autonomy verdict is taken outside the front door | [`autonomy-gating`](./autonomy-gating.md) · [`credential-readiness-resolution`](./credential-readiness-resolution.md) | Both are Rust-side rules about a *single* door. Mine is about the *second* implementation of any door, in the other language. |
| What a number is worth, and where the band lives | [`scoring-and-thresholds`](./scoring-and-thresholds.md) | **The nearest neighbour, and its clause 6 — "a client re-derives a verdict the server already computed" — scored PHYSICS 4/4.** It owns the *boundary*: 52 inline band ladders, 10 boundary sets. This path owns the *cross-language duplication* of the whole rule. **Overlap with `inline-verdict-band`: 0 % of files.** Its D7 (`SCORE_WEIGHTS` vs `fitness_driver.rs`) is a mirror **inside one language** and stays there; its exemplar `evalFramework.ts` is *this* path's exemplar too, arriving from the other side. |
| Whether a mirrored *count* is honest | [`metric-definition`](./metric-definition.md) · [`aggregate-count-display`](./aggregate-count-display.md) | Overlap 0 % and 2.7 %. |

---

## 2. The one way

**Do not mirror the rule. Move the answer, and if you cannot move the answer, move the failure.**
In this order, taking the highest rung that reaches: **(a) compute the verdict server-side and put
it on the payload**, the way `AppError` ships `category`, `auto_fixable` and `failover_eligible`
alongside `kind` — the client renders what it was sent and keeps a local classifier only for values
that never crossed the wire. **(b) If the client must recompute interactively, transport the inputs
once at startup** (`lab_get_score_weights` → `evalFramework.ts`) rather than copying them; the
hardcoded values survive only as a pre-fetch fallback and the comment says so. **(c) If the
vocabulary must exist as source in both languages, generate one from the other — and wire the
generator into `scripts/run-codegen.mjs`, which `predev`/`prebuild` always run.** A generator nobody
runs is worse than no generator. **(d) Where a generated ts-rs union already exists, make the client
copy compiler-visible**: type the lookup `Record<GeneratedUnion, T>` or pin the literal with
`satisfies Record<GeneratedUnion, T>`, so adding an arm in Rust is a TypeScript compile error rather
than a silent fall-through. **(e) When none of those reach — and for a vocabulary that crosses as a
bare string inside a free-form column, none of them do — put the tripwire on the side that CHANGES**:
a test beside the Rust definition that pins the exact set and whose failure message names the
TypeScript file to update (`core/src/types.rs:822-843`). **(f) Write the obligation on both sides,
naming a resolvable symbol** — `EventGateReason::token`, not "the Rust side". **(g) Make the client
fall closed**: an unrecognised arm degrades to the restrictive answer and never renders as a raw
token. **(h) Add the label group in the same change**, in `en.json` and every locale, or the mirror
you just built is still one copy short. **(i) Never count a one-language "parity test" as a
cross-check** — say in its own header that it pins one side and that the other side has its own,
unlinked copy.

If you must get one right first: **(a)**. Everything below it is a way of surviving the fact that
you did not do (a).

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`core/src/error.rs:206-215` — the taxonomy fields on the `AppError` envelope** | **The verdict on the wire.** `category`, `auto_fixable`, `failover_eligible`, *"computed once via the canonical `error_taxonomy` helpers so Rust and TS never drift"*. The client branches without running any classifier. **Copy this shape for every rule the server already decided.** | 1 error envelope; **9** frontend modules consume the taxonomy |
| **`src/lib/errorTaxonomy.ts:258-262` — `classifyUnknownError`** | **The correct consumption order, written down**: prefer the backend `category`, fall back to `kind`, and only reach the local string ladder for values that **never crossed IPC** (a JS exception, a fetch failure, a plain string). The mirror exists for the inputs the server never saw — that is the only defensible reason to have one. | 1, and it is the model |
| **`src/lib/eval/evalFramework.ts:56-80` + `commands/execution/lab.rs` `lab_get_score_weights`** | **Transport, not copy.** The frontend fetches the weights at app start; the hardcoded values remain *only* as a pre-fetch fallback, and the comment records that the "keep in sync" mirror it replaced **was** the defect. | 1 |
| **`scripts/generate-guidance-anchors.mjs` → `src-tauri/src/companion/generated_anchors.rs`** | **Codegen, wired, and fail-loud.** The TS catalog is the source of truth; the Rust allow-list is projected from it; the task is registered in `scripts/run-codegen.mjs:60` so `predev`/`prebuild` always run it; and it **refuses to write an empty allow-list** if it parses zero anchors. Dry-run diff: **12/12 identical**. | 1 vocabulary, and it is the template |
| **`core/src/types.rs:822-843` — `terminal_set_matches_expected` / `active_set_matches_expected`** | **The tripwire on the changing side.** Two Rust tests pinning the exact string sets, with the failure message naming the file to fix: *"TERMINAL set changed — update the TS `TERMINAL_STATES` constant"*, plus `terminal_plus_active_covers_all_variants` so a new variant cannot be left unclassified. **This is the answer when nothing else reaches.** | 1 vocabulary |
| **`src/lib/execution/executionState.ts:94-101` — `VALID_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]>`** | **The compiler-visible mirror.** The key type comes from the generated binding, so the table is *total*: adding a Rust variant makes this object a type error. Verified to agree with the Rust `declare_lifecycle!` transition table arm for arm. | 1 |
| **`byomHelpers.ts:12-14`, `:22-26` — `satisfies Record<EngineKind, …>` / `Record<TaskComplexity, …>`** | **The same guarantee for a literal you want to keep inferred.** `satisfies` checks totality without widening the value's type. Repo-wide: **7 sites in 5 files**. | 5 files |
| **`src/features/triggers/lib/eventReason.ts:44-56` — `parseEventReasonTokens`** | **Fail-closed parsing, with the rule stated**: *"a value is a reason ledger ONLY when every comma-separated part is a token we know. Anything else is treated as an error message and rendered verbatim — we never guess at a label for text we did not emit."* The one client mirror in this repo with an explicit unknown-arm policy, and the one with zero live defects. | 1 |
| **`src/engine/background.rs:937-991` + `:4024-4034`** | **The three-copy vocabulary done properly**: a doc comment naming where the token is persisted *and* who renders it, a `const ALL_GATE_REASONS: [EventGateReason; 9]` in the test module so the count is asserted, and a per-arm `token()` assertion. 9 arms, 9 client tokens, 9 labels in 14 locales, 0 raw tokens on 25 live rows. | 1 |

**Explicitly NOT primitives:**

- **`src/lib/errors/__tests__/errorTaxonomy.parity.test.ts` and `error_taxonomy.rs:777-826`.** Two
  fixture lists, each asserted only against its own language's ladder (§0(b)). They are the corpus's
  best-intentioned mirror instrument and they assert nothing across the boundary. Do not copy the
  shape; copy the *idea* into (e) instead, where the assertion lives on the side that changes.
- **`src/lib/fsm.ts:202-216` — `executionStatusFSM`.** A **third** execution lifecycle: 8 states
  (`pending`, `timed_out` and `error` added; **`incomplete` missing**), its own transition table, and
  `entity: 'execution'` — the same entity name the Rust `declare_lifecycle!` claims. **Zero consumers
  anywhere in `src/`.** Do not import it; do not extend it.
- **`src/lib/personas/personaThresholds.ts`.** A faithful transcription of `personas.rs:30-45` — all
  8 values verified equal today — with **6 of its 7 exports unused**, and a file header citing a path
  that does not exist. Already named as a non-primitive by
  [`scoring-and-thresholds`](./scoring-and-thresholds.md) §3; it belongs here too, as the archetype
  of a mirror that cannot drift *loudly* because nothing reads it.

---

## 4. Steps

1. **Before writing anything, ask whether the server can just tell you.** If the answer is a field
   on a response you already receive, add the field. `core/src/error.rs:206-215` is 10 lines.
2. **If the client must compute, fetch the inputs at startup and cache them.** Keep any literal only
   as a labelled pre-fetch fallback, and say so on the line.
3. **If a vocabulary must be source in both languages, generate one side from the other** — and in
   the same commit, register the generator in `scripts/run-codegen.mjs`. **Then verify by running it
   and checking `git diff` is empty.** An unwired generator is this leaf's worst outcome (§7 D5).
4. **If a ts-rs binding exists for the vocabulary, tether to it.** `Record<Union, T>` for a total
   table, `satisfies Record<Union, T>` for an inferred literal, the union itself for a parameter.
   **And then stop** — do not re-spell the arms as string literals beside the import.
5. **If nothing above reaches, write the tripwire in the language that owns the rule**, pinning the
   exact set, with the other file named in the assertion message. Copy `core/src/types.rs:822-843`.
6. **Write the obligation on both sides**, each naming a resolvable symbol. Check the path you cite
   actually exists — a third of them here do not.
7. **Decide the unknown-arm policy explicitly and make it restrictive.** Copy
   `eventReason.ts:44-56`'s strictness, not a `?? raw` fall-through.
8. **Add the label group in the same change** — `en.json` plus all 14 locales
   (`node scripts/i18n/translate-extract.mjs` → per-locale subagents → `translate-merge.mjs`). A
   vocabulary is not shipped until `npm run check:i18n:strict` is clean *and* every arm has a label.
9. **Do not write a one-language "parity test" and call the pair safe.** If you write one anyway, its
   header must say which side it pins and that the other side has an unlinked copy.
10. **Delete the mirror when the reason for it expires.** Two of this repo's mirrors have no
    consumers at all; a copy nobody reads still has to be maintained and cannot fail loudly.

### Can the type make the wrong call impossible? — asked before §9

**Split answer. Yes for the 33 vocabularies that already have a generated union. No for a rule, and
no for a vocabulary that crosses inside a free-form column — and the doctrine's fourth
"where types cannot reach" is exactly why.**

**T1 — tether the client's copy to the generated union.**

```ts
// today, x165 across 102 files:                 // the fix, already present at 7 sites:
const SEVERITY_STYLE: Record<string, string> = { const SEVERITY_STYLE = {
  info: '…', warning: '…', error: '…',             info: '…', warning: '…', error: '…',
};                                               } satisfies Record<DirectorSeverity, string>;
```

Held against the corpus's seven qualifications:

- **Q1 — a required prop carries only what it encodes.** `Record<Union, T>` encodes *totality over
  the arms* and **nothing about the values**. It would have caught every one of the five label-table
  gaps in §0 and **none** of the two behavioural drifts in §7 D2/D3, because those are rules, not
  vocabularies. Two different problems wearing one name; §2 (a)–(c) and (e) are separate mandates
  for that reason.
- **Q2 — requiredness is orthogonal to closedness.** Making the object required changes nothing; the
  wrong value is a *complete-looking* object with five keys.
- **Q3 — a type nobody constructs constrains nothing; this decides the scope.** Measured:
  **89 of 1,033** binding files are string-literal unions, **81** have ≥ 3 arms, and **165
  hand-written re-lists across 102 files spell out every arm of one of 33 of them without importing
  it**. That is a closed, reachable population with a mechanical fix. A general `MirrorOf<T>` wrapper
  across all 40 mirror sites does **not** meet Q3 — there is no such wrapper, and the 30 rule-shaped
  mirrors have nothing to wrap.
- **Q4 — a type anyone can construct authenticates nothing.** `Record<Union, T>` does not stop a
  caller writing the *wrong label* for a right key. Totality is not correctness. That residue is real.
- **Q5/Q6 — withhold the dangerous freedom, not the answer.** The dangerous freedom is **the ability
  to name the arms at all**, not the ability to style them. Compare the two halves of the same
  vocabulary in §0: the event *status* is imported as a type and re-spelled as label keys; the event
  *reason* is imported as a type **and** parsed against a set derived from that same array
  (`TOKEN_SET = new Set(EVENT_REASON_TOKENS)`), so there is exactly one list. The second construction
  is one line different and has never drifted.
- **Q7 — relaxing a requirement is inert where the caller supplies the bad value voluntarily.**
  Nothing *forces* a label table to be `Record<string, string>`. The author volunteers it — usually
  because the table lives in `en.json`, which **is not TypeScript and has no type at all**. For the
  i18n layer T1 is *unreachable*: `status_tokens.event` is JSON, and the generated `types.ts` derives
  its shape from that JSON rather than from Rust. **The only mechanism that reaches the label layer
  is (e) or a script.**

**T2 — the doctrine's fourth unreachable place, and it decides the other half.** `EventGateReason`
is `pub(crate)` with no `#[derive(TS)]`, and its tokens are persisted into
`persona_events.error_message` — a column shared with free-form failure prose. The vocabulary crosses
the boundary **as an untyped string inside a general-purpose column**. No Rust type reaches the
client, no client type reaches the column, and a newtype on either side is downstream of where the
value entered. This is the doctrine's *"on the far side of a serialization boundary"* in its purest
form: the value is unforgeable as an enum and perfectly forgeable as a row. **For this class the
answer is not a type; it is (e) plus (g)** — the tripwire in Rust and the fail-closed parse in TS,
which is precisely the pair that has never drifted.

**Ship T1 across the 33 tethered-able vocabularies (165 sites, 102 files, a legal fix present 7
times). Treat the 30 rule-shaped mirrors as §2 (a)/(b)/(e) work, not type work. And accept that the
label layer needs a script, because it is JSON.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **Re-deriving a verdict the payload already carries** | Two answers, one screen. The repo's own envelope ships `category`/`auto_fixable`/`failover_eligible` precisely so this is unnecessary. Convergent: a sibling renders a server grade in a header and re-derives one for the chart in the same viewport; another sibling *refuses* and has a test asserting the refusal. |
| **A comment as the maintenance mechanism** | **40 sites in 37 files.** A comment cannot fail. 34 % of the paths these comments name do not exist; 40 % name no resolvable symbol. §7 D6. |
| **The obligation written on the client only** | The side that changes is the server, and the server's file says nothing. **Both observed drifts are here**, and in both the Rust comment explains the change the client never got. §7 D2, D3. |
| **A "cross-FFI parity test" that runs on one side** | Manufactures confidence and adds a copy. Both `PARITY_FIXTURES` lists are self-asserted; editing one ladder plus its own fixtures keeps both suites green. §0(b). Convergent 2/2. |
| **A generated mirror whose generator is wired into nothing** | The header says "DO NOT EDIT … they never drift" and the artifact is 127 entries stale. Its twin agrees with it perfectly, which is the trap. §7 D5. |
| **A hardcoded client list standing in for a server rule that is DATA-driven** | `BUILTIN_LOCAL_CONNECTORS` names 4 connectors; `classify_connector` derives `ZeroConfig` from each definition's `metadata` and returns **6** over the live catalog. The client cannot be kept in sync by editing it — the server's answer changes when a row changes. §7 D2. |
| **Mirroring a rule "to avoid an IPC round-trip"** | Three of this repo's mirrors say this. It is a real requirement with a cheaper answer (fetch once, cache). It is also how the *behavioural* drifts got in, not the vocabulary ones. |
| **A label table nobody calls a mirror** | The third copy, in 14 files, maintained by nobody. **100 % of 4,972 live event rows.** §0, §7 D1. |
| **`?? rawToken` as the unknown-arm policy** | Renders a machine identifier to a human, in every language, and looks like a design choice. The alternative is one line: reject unknown input and say "unknown". |
| **Adding an enum arm without walking the copies** | `lookup_failed` and `cost_ceiling_corrupt` were added to `chain.rs` with docstrings explaining they fail restrictive; neither has a label in any locale. `ai-compose` did the same to `t.kpis.measurement_source` (5 arms vs a 6-arm CHECK — [`scoring-and-thresholds`](./scoring-and-thresholds.md) D8). |
| **A second FSM for an entity that already has one** | `fsm.ts:202` declares `entity: 'execution'` with 8 states, drops `incomplete`, invents three, ships its own transition table, and has **zero consumers**. |
| **A mirror with no readers** | `personaThresholds.ts` (6 of 7 exports unused) and `executionStatusFSM` (0 uses). They still cost maintenance and cannot fail loudly. |
| **Trusting a basename to prove a cross-reference** | My own first reciprocity measurement said 15 of 40 pairs were reciprocal; requiring the extension said **10**. `memories.ts` appeared "named back" by 63 Rust files. §12.4. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/core/src/types.rs:10-60` together with
`src/lib/execution/executionState.ts:15-101`.** It is the only place in the repo that uses four
mechanisms at once for one vocabulary, and it is the only vocabulary that is provably identical on
both sides.

```rust
// core/src/types.rs — the server owns the machine, and pins it
crate::declare_lifecycle! { pub enum ExecutionState, entity = "execution" { … } }
impl ExecutionState { pub const TERMINAL: &'static [ExecutionState] = &[…]; }

#[test] fn terminal_plus_active_covers_all_variants()   // a new variant must be classified
#[test] fn terminal_and_active_are_disjoint()
#[test] fn terminal_set_matches_expected() {            // :822-843
    assert_eq!(actual, expected,
        "TERMINAL set changed — update the TS TERMINAL_STATES constant");
}
```

```ts
// executionState.ts — the client imports the type and stays total over it
import type { ExecutionState as RustExecutionState } from '@/lib/bindings/ExecutionState';
export type ExecutionState = RustExecutionState | 'unknown';        // the delta is EXPLICIT
export const VALID_TRANSITIONS: Record<ExecutionState, readonly ExecutionState[]> = { … };
```

Five things to copy: (1) the type crosses via ts-rs, so the **arms** cannot drift; (2) the client's
one addition (`'unknown'`) is a *documented union extension*, not a silent divergence — this is how
to disagree on purpose; (3) `Record<ExecutionState, …>` makes the transition table **total**, so a
new Rust variant is a TypeScript compile error; (4) the sets that ts-rs *cannot* carry are pinned by
a Rust test whose message **names the TypeScript constant to edit**; (5) a coverage assertion means a
new variant cannot be silently left out of both sets. Verified: the client transition table agrees
with the Rust `declare_lifecycle!` arm for arm.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `core/src/error.rs:206-215` | **The verdict on the envelope.** Three additive fields *"computed once via the canonical `error_taxonomy` helpers so Rust and TS never drift"*, and a consumer (`classifyUnknownError:259`) that prefers them. |
| `evalFramework.ts:56-80` ↔ `lab.rs` `lab_get_score_weights` | **Transport beats copy**, with the incident preserved: the "keep in sync" mirror it replaced was the defect. |
| `scripts/generate-guidance-anchors.mjs:43-46` | **A generator with a precondition**: *"Parsed 0 anchors … refusing to write an empty allow-list."* Plus registration at `scripts/run-codegen.mjs:60`, which is the half `gen-tour-anchors.mjs` lacks. |
| `eventReason.ts:10-13, :44-56` | **The fail-closed parse and its stated rule**: *"we never guess at a label for text we did not emit, and we never fabricate a reason for a row that has none."* |
| `background.rs:937-947` | **A doc comment that names the whole chain** — where the token is persisted, which column it shares, and that the frontend resolves it through `tokenLabel(t, 'event_reason', …)`. This is why the reason mirror survived. |
| `errorTaxonomy.ts:115-124` | **The drift admitted in place.** The broad `'not found'` match over-escalates domain 404s; the comment says narrowing it *TS-side alone* would break parity and that a real fix needs both languages in one PR. A known defect held deliberately, in writing — better than a silent unilateral fix. |
| `byomHelpers.ts:12-14, :22-26` | **`satisfies Record<Union, T>`** over two generated unions, in a file that also hand-redeclares a third (`PolicyWarningSeverity`, `:42`). One file, both habits, five lines apart. |

### Convergence — 5 sibling repos, one of which does not count

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Per the doctrine's lineage rule,
**`personas-cloud` contains a port of this repo's code** — its `packages/shared/src/prompt.ts:594`
states it *"mirrors the Rust `build_design_prompt()` from `engine/design.rs`"* and copies that file's
heading vocabulary — so it is reported as a **port**, not as independent corroboration. It also has
**1 test file in the entire repo and no `.github/workflows` directory**, so it could not detect its
own drift under any circumstances; the Rust original has 6 unit tests pinning those exact heading
strings and the port has 0. Cross-language boundary present in **2 of the 4 independent siblings**
(`brainiac`, `vibeman`); the other two are TS↔TS and are counted only where the clause is
language-agnostic.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **Every codebase with a server/client split hand-keeps at least one mirror of a server rule** | **PHYSICS (4/4 independent)** | personas-web 3 (Ko-fi tiers 3/3, feature ids 4/4, the pii claim below); brainiac 4 (scopes **8/8**, lifecycles 3/3, policies 3/3, standards transitions 3/3); vibeman one vocabulary written **four** times plus two full evaluators; ascent 21 scoring arms + a duplicated formula. **Nobody eliminated the mirror; the variance is entirely in what stands behind it.** |
| 2 | **A codegen pipeline carries SHAPES and drops enum ARMS, so mirrors survive codegen** | **PHYSICS, and stated outright by the one repo with a pipeline** | `brainiac/console/src/docs/facets.ts:3-5`: *"The Rust enums serialize as plain strings, so the generated types give the console `string`."* Its OpenAPI pipeline carries **187 schemas / 75 paths / 79 operations** and still leaves 4 hand-kept vocabularies. **Personas is ahead here** — ts-rs emits **89** real string-literal unions — and still has **165 untethered re-lists**, which is the same defect with the excuse removed. |
| 3 | **The strongest guard is asserting the COMMITTED ARTIFACT equals what the code generates** | **`brainiac` ALONE (1/4), and it is the better answer** | `brainiac-server/src/openapi.rs:424` `committed_document_is_current` compares the committed `openapi.json` to what the handlers declare, byte-for-byte, with the regen command in the failure message. **No such check exists in Personas for any of its three generators — and exactly that check is what would have caught the 127-anchor staleness.** §9 refuses to gate this by counting and specifies the instrument instead. |
| 4 | **A "parity test" asserts one side against hardcoded literals** | **PHYSICS (2/2 where such a test exists)** | `brainiac/console/app/console/modules/standards/tree.test.ts:124` — *"mirrors the backend's lifecycle transitions exactly"* — asserts the TS against literals at `:127-131`, never against Rust. Byte-identical shape to this repo's two `PARITY_FIXTURES`. **The failure mode is universal: a test can only import its own language.** |
| 5 | **A mirror should fail CLOSED, and the repos that say so are the ones that don't drift** | **MINORITY (1/4), and it is doctrine** | `brainiac/console/src/lib/scopes.ts:12-14`: *"a drift here fails closed — it can only ever be narrower than the truth"*; `facets.ts:14-16`: an unknown policy degrades to `needs_review`, **never** `auto_published`. brainiac's four mirrors are the only cohort with **zero** measured drift. Here, the one fail-closed client mirror (`eventReason.ts`) is the one with zero live defects. |
| 6 | **A client that recomputes a sent verdict is safe only when it imports the SAME function and pins the no-op identity** | **`ascent` ALONE (1/4), and it is the construction to steal** | `ascent/src/lib/scoring/engine.test.ts:288` asserts that the client's `projectSandbox` with no overrides reproduces the server-sent payload **across 7 fields**, over a self-consistent fixture; the shared module is imported by both the server assembler and the `"use client"` component. Its own counter-example is 30 lines away: `PassportHero.tsx:222-225` re-derives a server score from **21 hand-copied arms with no test**. |
| 7 | **The mirror often exists because the definition was not EXPORTED** | **`ascent`, and it reframes the cause** | Those 21 arms are copied because `passport.ts:272-275` declares them as module-private `const`. **The fix is the word `export`.** Worth checking first in this repo too — it is cheaper than every mechanism in §2. |
| 8 | **A cross-REPO mirror comment can name a counterpart that takes the opposite position** | **`personas-web`, verified against this repo** | `personas-web/src/lib/sentry-pii.ts:4` — *"Mirrors the desktop Rust pii module"* — redacts UUIDs (`:17`). There is no module by that name here; the nearest, `core/src/redact.rs`, has a **named test asserting the opposite**: `preserves_uuids_and_shas`, *"they are identifiers, not secrets"* (`:199-204`). **The pointer does not resolve and the two rules disagree in direction.** |
| 9 | **With no mechanism at all, two live evaluators of one rule disagree in four ways** | **`vibeman`, the fleet's worst case** | 6-field/6-operator triage vocabulary written **4 times**; `triage_cmds.rs::evaluate_condition` vs `triageRulesEngine.ts::evaluateCondition`; **0** tests, and `.github/workflows/ci.yml` never runs `cargo`. A conditionless rule matches **nothing** in TS (`:77`) and **everything** in Rust (`:138`, vacuous `.all()`); a malformed date ages to ~740,000 days in Rust and `NaN` in TS. Currently unreachable — `triage_preview`/`triage_execute` are registered with zero call sites. **A loaded weapon, not a firing one.** |

**Physics — keep as doctrine:** clauses 1, 2, 4, 9. **Reported as MINORITY / this-repo-behind:**
clauses 3, 5, 6. **Personas is ahead** on exactly two things: **ts-rs actually emits the enum arms**
(89 unions, where the only sibling with a pipeline gets `string`), and the **`declare_lifecycle!` +
set-pinning-test construction**, which no sibling has. Personas is **behind `brainiac`** on
fail-closed as a default and on artifact-freshness assertion, and **behind `ascent`** on the identity
test for a legitimately-recomputed verdict.

> **The strongest external result is clause 2 and it is the reason this leaf is not solved by
> codegen.** In the one sibling with a real cross-language pipeline, 187 schemas flow through it and
> **the enum arms do not**, so four hand-mirrors remain and the team wrote down why. Personas'
> generator is better and the outcome is the same shape: 89 unions available, 165 places that spell
> the arms out anyway. **The pipeline was never the binding constraint. What the client does with
> what the pipeline gave it is.**

### The composition defects with the neighbouring paths — offered upward

**(i) with [`scoring-and-thresholds`](./scoring-and-thresholds.md).** Its P6 says *"render the
verdict the system computed; never re-derive one from the number beside it."* That is this path's
§2 (a), and the two prescriptions agree — but its §2 (d) says to put every band boundary *"in one
exported constant next to the formula and import it"*, and following **that** across a language
boundary produces a second exported constant in TypeScript beside the Rust one, which is exactly the
mirror this path is about. **The clause both paths need:** *a shared constant is the right answer
within one language and the wrong one across two — across the boundary, share the RESULT, not the
constant.* `GRADE_THRESHOLDS` is client-only, so no defect exists today; `SCORE_WEIGHTS` is the pair
that crosses, and it is transported rather than exported, which is why it is this path's exemplar and
that path's too.

**(ii) with [`bridge-type-contract`](./bridge-type-contract.md).** Its §2 says *"let the generated
file be the only contract anyone reads"* and *"no local `interface` mirroring a generated type."*
Followed literally that reads as "import the type and you are done" — which is true for a **shape**
and false for a **vocabulary**, because importing `PersonaEventStatus` does not stop you writing five
labels for eight arms in a JSON file the type system never sees. **The clause: importing the
generated type closes the shape and leaves every TABLE KEYED BY IT open; totality
(`Record<Union, T>`) is a separate edit and is the one this leaf needs.**

**(iii) with [`status-and-severity-badges`](./status-and-severity-badges.md).** Its rule ratchets an
untranslatable token label at the render site. §0's 4,972 raw tokens would not be caught by it,
because the render site is correct — it calls `tokenLabel` exactly as prescribed — and the *table* is
short. **The clause: a gate on reaching the label helper is only as good as the helper's table, and
the table is a mirror of a Rust enum with nothing linking the two.** (This is
[`golden-path-contract.md`](../golden-path-contract.md)'s fifth failure mode — the gate that points
at a broken destination — appearing again, one layer further out.)

---

## 7. Deviations

Every entry is live on `master` @ `c47cd36fa`, verified by reading the file and — where a number is
quoted — by executing both implementations against a read-only copy of the operator's database.
All shipped under a green `npm run check` and a green census. **Per the campaign's no-destructive-
applies rule, nothing here was applied.**

### D1 — The label layer is an undeclared third copy, and it is 100 % wrong on the busiest table · **executed, 4,972 of 4,972**

Full replay in §0. Measured across all 14 locale files (every gap is identical in all 14, because it
was cloned from `en.json`):

| group | labels | server vocabulary | live rows rendering a raw token |
|---|---:|---|---:|
| `status_tokens.event` | **5** | `PersonaEventStatus`, **8** (`core/src/models/event.rs:16-33`) | **4,972 / 4,972 (100 %)** — `delivered` 4,941, `skipped` 31 |
| `status_tokens.execution` | **6** (incl. `error`, not a state) | `ExecutionState`, 6 | **20 / 2,188** — `incomplete` |
| `status_tokens.chain_stop` | **13** | `chain.rs::stop_reason`, **15** | 0 (table empty — latent) |
| `status_tokens.goal_state` | **7** aliases | canonical 5 (`dev_tools.rs:1204`) | labels the pre-normalization aliases, not the canonical set |
| `status_tokens.event_reason` | **9** | `EventGateReason`, **9** | **0 / 25** |

**26 `status_tokens` groups exist** and none of them carries a comment naming the Rust enum it
tracks. **Fix (note):** add the missing arms in the same change as the enum arm (step 8), and give
`tokenMaps.ts` an unknown-arm fallback that renders a neutral "Unknown (`token`)" rather than the
bare identifier.

### D2 — Connector readiness: the server changed its mind and told only itself · **executed, 5 of 5 labels on 154 pairs**

`connectorRunnability.ts:1-3` declares itself *"Frontend mirror of the Rust adoption pre-flight in
`commands::design::template_adopt::check_persona_runnability`"*. Two of its three tables disagree
with the server:

**(a) `ROLE_SYNONYMS` — 25 keys against `normalize_connector_role`'s 21.** The four extra all map
`codebase | source_code | vcs | git → source_control`. `connector_readiness.rs:229-231` explains
the removal *on the Rust side only*: *"`codebase` is intentionally NOT mapped here anymore — it is a
first-class `BoundCredential` connector resolved via its Dev Tools project probe, not guessed at via
a `source_control` category match."* The client still guesses.

Replayed over the 5 distinct connector labels the operator's personas actually declare (154
persona-connector pairs):

| label | personas | server normalizes to | client normalizes to |
|---|---:|---|---|
| `Codebase` | **63** | `Codebase` (unmapped — a `GlobalProbe` connector) | **`source_control`** |
| `Messages` | 56 | `Messages` | `messages` |
| `GitHub` | 21 | `GitHub` | `github` |
| `Image AI` | 7 | `Image AI` | `image ai` |
| `Multimodal AI` | 7 | `Multimodal AI` | `multimodal ai` |

**5 of 5 disagree.** Four are the fallthrough-casing difference — Rust's `_ => name` returns the
**original** string while the TS `?? lower` returns the **lowercased** one, so the two functions have
different contracts for every unmapped input; both sides lowercase again downstream, so today only
the first row is behaviour-visible. The `Codebase` row is the real one, on 63 of 78 personas.

**(b) `BUILTIN_LOCAL_CONNECTORS` hardcodes 4 names against a rule that is DATA-driven.**
`classify_connector` (`core/src/models/connector.rs:240-260`) derives `ZeroConfig` from each
definition's `metadata` (`always_active`, or `auth_type: "none"` + `connection_mode: "local"`).
Replayed over the live 134 definitions it returns **6**: the client's four plus **`codebases`** and
**`operations_database`**, which the client therefore sends down the needs-setup ladder. Editing the
client list cannot fix this class — **a new seeded connector changes the server's answer and not the
client's.** (`GlobalProbe` is a third class the client has no concept of at all: `codebase`, `twin`,
`obsidian_memory`.)

Only `NATIVE_CAPABILITIES` matches, 15/15.

### D3 — The active-window rule disagrees on 90.9 % of its input space · **executed, 31,878 of 35,052 · latent**

`triggerArmState.ts:69-78` is headed *"Mirrors Rust `ActiveWindow::is_active_at`"*. It checks day
membership **before** branching on overnight:

```ts
if (!aw.days.includes(weekday)) return false;         // :72  — before the branch
…
return minutes >= start || minutes < end;             // :77  — overnight
```

`core/src/models/trigger.rs:196-208` does the opposite, with the reason in the comment: *"The active
span belongs to the day it opened: after midnight the window is still the previous day's window, so
membership must be tested against `weekday - 1`, not today."*

Exhaustive replay over every representable overnight window (127 day-subsets × 552 start/end hour
pairs, each swept over all 10,080 minute-slots of a week):

| | value |
|---|---:|
| overnight windows enumerated | **35,052** |
| windows where the two disagree on ≥ 1 minute | **31,878 (90.9 %)** |
| worst case | days `[Sun,Tue,Thu]` 23:00→22:00 — **7,920 of 10,080** minute-slots |
| live triggers configuring an `active_window` | **0 of 351** |

Worked example, `days=[Mon] 22:00→06:00`: at **Tue 02:00** the server says active and the row reads
**sleeping**; at **Mon 02:00** the server says inactive and the row reads **armed**. The badge exists
specifically to answer *"why didn't this fire?"* and gives the wrong answer at both ends of the
window. **Latent today and total in its domain** — 0 of 351 live triggers carry the block.

### D4 — The KPI pair agrees on every live row and reads the same timestamp two hours apart · **executed, 0 of 65 · latent**

`kpiMath.ts:39-69` and `kpi_derivation.rs:54-95` each name the other as the mirror. Replayed over all
65 live `dev_kpis`: **0 disagreements** (client distribution: 45 unmeasured, 10 off-track, 8 met, 2
on-track). The three ordered tests, the floor predicate and the 0.1 tolerance all match.

The pace arm does not. Both parse `created_at` from the same SQLite string; **the client reads a
naive `YYYY-MM-DD HH:MM:SS` as local time (`new Date(s.replace(' ','T'))`) and the server reads it as
UTC (`NaiveDateTime … .and_utc()`)** — a **2-hour** offset on this machine, shifting `frac` and
therefore `expected`. **19 of 65** KPIs reach the pace arm; the closest to its own tolerance boundary
would need the pace clock to shift **31.3 hours** to flip. Real, latent, and it will surface as an
inexplicable one-off disagreement rather than a class.

### D5 — Two "lock-step" generated artifacts, perfectly consistent with each other and 127 anchors behind reality · **executed**

`scripts/docs/gen-tour-anchors.mjs` emits `src/features/onboarding/anchors/tourAnchorManifest.json`
(which `dynamicTours.ts` validates Athena-composed tours against) and
`src-tauri/src/companion/generated_tour_anchors.rs` (which `companion::tours` checks **before a
generated tour is persisted**), *"both generated from the same scan so they never drift."*

Dry-run diff (writes captured in memory; `git status` confirmed the repo was untouched):

| | committed | fresh from the tree |
|---|---:|---:|
| `data-testid` anchors | **945** | **1,044** |
| dynamic template prefixes | **269** | **293** |
| anchors present in the tree but **absent from the allow-list** | | **127** |
| anchors in the allow-list that **no longer exist** in the tree | | **4** |

`grep` for the generator across `package.json`, `scripts/run-codegen.mjs` (**14** registered tasks;
this line said 8 until 2026-08-17, when [codegen-task-registration](./codegen-task-registration.md)
enumerated the registry),
`.github/workflows/` and `lefthook.yml` returns **nothing**. Its two sibling generators are both
registered and both byte-fresh. The repo's real anchor-drift gate
(`src/stores/slices/system/__tests__/tourAnchors.test.ts`) walks the live `TOUR_REGISTRY` against the
tree and is excellent — and it does not look at either generated artifact.

**Consequence:** a tour Athena composes against any of the 127 newer anchors is rejected by the Rust
allow-list before it is ever persisted, with no indication that the allow-list is simply old.

### D6 — The mirror's only instrument is a comment, and a third of the comments point at nothing · **measured, 19 of 56**

**76** TS files and **54** Rust files declare a cross-language sync obligation (union of two
independent implementations, which agreed within 7 and 5 files respectively). Of the **56** file
paths those comments name, **19 (34 %) do not exist** — and **17 of the 19 are TS→Rust**, all
casualties of the same crate extraction that `.claude/CLAUDE.md` documents:

```
src/lib/errorTaxonomy.ts:5                      -> src-tauri/src/engine/error_taxonomy.rs   (now core/src/)
src/lib/errors/__tests__/errorTaxonomy.parity.test.ts:5 -> same
src/lib/eventRegistry.ts:1                      -> src-tauri/src/engine/event_registry.rs   (now engine/src/)
src/lib/personas/personaThresholds.ts:4         -> src-tauri/src/db/repos/core/personas.rs  (now db/src/)
src/lib/eval/evalFramework.ts:20,:39            -> src-tauri/src/engine/eval.rs             (gone)
src/api/agents/lab.ts:243                       -> same
src/features/settings/sub_byom/libs/byomHelpers.ts:55 -> src-tauri/src/engine/byom.rs       (now db/src/byom.rs)
src/features/settings/sub_limits/.../LimitsSettings.tsx:17 -> src-tauri/src/db/settings_keys.rs
src/stores/slices/processActivitySlice.ts:134   -> same
src/features/triggers/.../RenameEventDialog.tsx:22 -> src-tauri/src/db/repos/resources/triggers.rs
src/features/triggers/sub_triggers/triggerArmState.ts:3 -> src-tauri/.../db/models/trigger.rs
src/lib/types/terminalEvents.ts:3               -> src-tauri/src/engine/types.rs
… and 5 more, plus 2 RS->TS
```

Reciprocity, strictly measured (the Rust comment must name the TS file **with its extension or
path**): **10 of 40** client mirror sites are named back. **30 are one-way**, and both drifts in this
document (D2, D3) are in the one-way set, while every reciprocal pair I could execute agrees. And
**16 of the 40 comments name no resolvable server symbol at all** — "mirrors the Rust bounds",
"mirrors the Rust const", "must match the Rust registry".

### D7 — 165 client re-lists of a vocabulary that already exists as a generated union · **measured, 102 files, 33 vocabularies**

**89 of 1,033** binding files are pure string-literal unions; **81** have ≥ 3 arms. **187**
non-test files spell out *every* arm of one of them as string literals; **165 of those (in 102
files, across 33 vocabularies) do not import the union.** Only **22** do, and only **7 sites in 5
files** use `satisfies Record<Union, T>` — the construction that would make an added arm a compile
error.

Worst offenders by re-list count: `DirectorSeverity` and `PolicyWarningSeverity` (33 files each),
`ForageConfidence` (21), `AlertSeverity` (15), `HealthProbeState` and `IncidentSeverity` (6 each).
`HealthStatus` (4 arms) has **five** independent hand-declared cousins, none of which matches it:
`PersonaOverviewBadges.tsx:11` (3, no `dormant` — so a dormant persona has no badge style),
`triggerListTypes.ts:1`, `scheduleHelpers.ts:12` (5), `personaHealthSlice.ts:21`,
`agents/sub_health/types.ts:76` (3).

### D8 — The best-instrumented mirror in the repo is instrumented across the wrong axis · **executed, 0 disagreements**

The error taxonomy pair is **in complete agreement**: 42/42 on the Rust fixture corpus, 42/42 on the
TS corpus, **0** disagreements over all 31 distinct error strings in 285 live rows
(`persona_executions` 260 / 30 distinct — 172 `transient_process_failure`, 41 `unknown`, 25
`timeout`, 21 `rate_limit`, 1 `api_error`; `persona_events` 25 / 1 distinct), and **0** across
3 helpers × 11 categories.

What is wrong with it is structural, not arithmetic:

- **Neither "parity" test crosses the boundary** (§0(b)). Both point at a non-existent Rust path.
- **The two `PARITY_FIXTURES` lists are set-identical but not "byte-for-byte in sync" as both headers
  claim** — the order diverges from index 37 (`App restarted while execution was running` sits at
  Rust 38, TS 41). Harmless, and a direct measure of how much the phrase is worth.
- **The signatures differ.** Rust is `classify_error(error, timed_out: bool, session_limit: bool)`;
  TS is `classifyError(error: string)`, arity 1. Two of the server's three inputs have no client
  expression, so the mirror can never be complete — `classify_error(msg, true, false)` is `timeout`
  where `classifyError(msg)` is `unknown`. The Rust file has two tests for exactly those flags.

**Fix (note):** the *pair* needs nothing; the *instrument* does. Replace both self-asserting tests
with one script that parses the two fixture lists and diffs them (§9), and correct the two dead
paths.

### D9 — A second execution lifecycle for the same entity, with zero consumers · **measured**

`src/lib/fsm.ts:202-216` declares `ExecutionStatusState` with **8** arms and `entity: 'execution'` —
the same entity name `core/src/types.rs:24`'s `declare_lifecycle!` claims. It adds `pending`,
`timed_out` and `error`, **drops `incomplete`** (20 live rows), and ships its own transition table:
a fourth opinion, after the Rust macro, the SQL `CHECK` (`schema.rs:108`) and
`executionState.ts:94`'s `VALID_TRANSITIONS`. `grep` for `executionStatusFSM` outside its own file
returns **nothing**. **Fix (note): delete it.**

### D10 — Mirrors nobody reads · **measured**

`personaThresholds.ts` transcribes 8 values from `personas.rs:30-45` — **all 8 verified equal
today** — and **6 of its 7 exports have zero consumers**. `executionStatusFSM`: zero. A mirror with
no readers still has to be maintained, cannot fail loudly, and is indistinguishable from a live one
to the next person who edits the Rust.

### D11 — A cross-repo mirror whose pointer does not resolve and whose rule is inverted · **verified, report only**

`personas-web/src/lib/sentry-pii.ts:4` declares *"Mirrors the desktop Rust pii module"* and redacts
UUIDs at `:17`. **No module of that name exists in this repo**; the nearest, `core/src/redact.rs`,
carries a named test asserting the opposite — `preserves_uuids_and_shas`, *"UUID + 40-char git SHA
must survive (they are identifiers, not secrets)"* (`:199-204`). Per the runbook, findings about
sibling repos are reported and never edited. Recorded here because it is the cleanest specimen of
this leaf's failure mode: **the comment is the mechanism, the mechanism names a file that does not
exist, and the two implementations disagree in direction.**

### D12 — Cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"Hand-kept mirrors drift."** Mostly they do not. Of the ~17 pairs I could execute or count
  exactly, **most agree today**, including the three the brief primed as suspicious. Drift is
  concentrated where a mechanism is absent *and* the rule changed — which is why §0's ladder, not a
  count of mirrors, is the finding.
- **"`EventGateReason` and `EVENT_REASON_TOKENS` are two hand-kept lists with 0 cross-checks."**
  True as stated and **the pair is at 9/9/9 across three copies with 0 raw tokens on 25 live rows**.
  What has no cross-check is the *sibling* vocabulary in the same column (§0).
- **"The generated bindings are the answer."** ts-rs emits 89 correct closed vocabularies and **33
  of them are re-listed by hand anyway**, 165 times. The generator was never the binding constraint.
- **"Codegen means it cannot drift."** Two of three generators here prove it and the third disproves
  it by 127 entries. The property is *"a step that always runs invokes it"*, not *"it is generated"*.
- **A hypothesis I tested and could not support.** I expected **reciprocity** (the obligation written
  on both sides) to predict drift. Directionally it holds — both drifts are one-way and all 9
  executable reciprocal pairs agree — but 28 of the 30 one-way sites are also fine, so the lift is
  weak and I am not publishing it as a rule. The measurement that *does* separate cleanly is the
  presence of a **mechanism** (§0's ladder), and reciprocity is only its cheapest rung.
- **A mis-pairing in my own inventory, caught by hand-verification.** A sweep paired the client's
  `BUILTIN_LOCAL_CONNECTORS` with Rust's `GLOBAL_PROBE_CONNECTORS` and reported "4 vs 3, zero
  overlap". They are **different concepts** (`ZeroConfig` vs `GlobalProbe`). The real counterpart is
  `classify_connector`, and the honest finding is worse than the reported one: the client hardcodes a
  list where the server derives a class from row data (D2b).

---

## 8. Gaps

**Gap 1 — Nothing can assert agreement across the language boundary, so every "parity" instrument in
the repo is a copy.** A vitest file cannot call Rust; a `#[cfg(test)]` module cannot call
TypeScript. Both `PARITY_FIXTURES` lists exist because their authors reached this wall and built the
best thing available on their own side. **The reachable answer is a third program that reads both
files as text and diffs them** — which is what §9 specifies and refuses to express as a census rule.
`brainiac/brainiac-server/src/openapi.rs:424` is the sibling that built it.

**Gap 2 — `en.json` is not TypeScript, so no type reaches the label layer.** `status_tokens` is
JSON; `src/i18n/generated/types.ts` is derived **from that JSON**, so the generated type describes
the mirror rather than constraining it. The one construction that would close §0 —
`Record<PersonaEventStatus, string>` — cannot be written where the data lives. Every other layer of
this leaf has a type-shaped fix and this one has only a script.

**Gap 3 — A vocabulary that crosses inside a free-form column has no crossable type at all.**
`EventGateReason` is `pub(crate)`, derives no `TS`, and is written into
`persona_events.error_message` beside genuine failure prose. This is the doctrine's fourth
"where types cannot reach". The pair survives on a fail-closed parser and a Rust arm-count test —
which is the correct answer and is not a type.

**Gap 4 — The census cannot see a silent mirror, and silent mirrors are the majority.** §9's signal
finds mirrors that **admit to being mirrors**: 37 files. The untethered re-lists number **102 files**
and the label groups **26**, and neither says so. The rule ratchets the honest population and is
blind to the dishonest one — stated here rather than papered over, because a repo adopting this path
must not read a green run as "no mirrors".

**Gap 5 — Nothing in this repo asserts that a generated artifact is current.** Three generators, zero
freshness checks; one is 127 entries stale. This is an **absence**, which the census cannot express
by construction (doctrine §4), and it is the single highest-value missing instrument in this leaf.
Specified in §9 as a script rather than pretended into a pattern.

**Gap 6 — `?? rawToken` is the repo-wide unknown-arm default and it is a per-call-site decision.**
`tokenMaps.ts:35-51` falls through to the machine token, so every one of the 26 groups fails open. A
single change there — render "Unknown (`token`)" or route to a shared `unknown` label — would convert
every present and future label gap from a silent lie into a visible one. It is a behaviour change on
a surface the operator is watching, so it is a note, not an apply.

---

## 9. The missing gate

**The condition to enforce:** *a client-side value re-implements a decision the server owns, and the
only thing holding the two together is a comment saying so.* Not "a mirror exists" — mirrors are
sometimes correct. Not "the two disagree" — that needs both languages executed. The one thing in this
leaf that is a countable string: **the admission**.

**Checked first that it is not already gated.** `scripts/census/rules.json` holds **140 rules**; none
has an `id`, title or signal about cross-language duplication. **File overlap measured exactly** by
running **every one of the 68 TS-side rules with a baseline** against my rule's 37 files:

| neighbour rule | its baseline files | shared with my 37 | % of mine |
|---|---:|---:|---:|
| `undeclared-tier-branch` ([tier-and-capability-gating](./tier-and-capability-gating.md)) | 13 | **0** | **0 %** |
| `inline-verdict-band` ([scoring-and-thresholds](./scoring-and-thresholds.md)) | 37 | **0** | **0 %** |
| `read-failure-as-empty-value` ([partial-failure-read-envelope](./partial-failure-read-envelope.md)) | 32 | **0** | **0 %** |
| `estimate-typed-as-measurement` ([data-provenance-disclosure](./data-provenance-disclosure.md)) | 11 | **0** | **0 %** |
| `untranslatable-token-label` ([status-and-severity-badges](./status-and-severity-badges.md)) | 38 | 1 | 2.7 % |
| `absent-entity-count-as-zero` ([aggregate-count-display](./aggregate-count-display.md)) | 30 | 1 | 2.7 % |
| `asserted-definition-blob` ([untrusted-definition-validation](./untrusted-definition-validation.md)) | 15 | 1 | 2.7 % |
| `ipc-payload-typed-inline` ([bridge-type-contract](./bridge-type-contract.md)) | 12 | 2 | **5.4 %** |
| `hand-rolled-disabled-state` · `native-title-tooltip` ([design-token-usage](./design-token-usage.md), [tooltip](./tooltip.md)) | 361 · 571 | 5 · 5 | 13.5 % |

**47 of the 68 share zero files.** The two at 13.5 % match 361 and 571 of 4,829 files respectively —
any rule keyed on component code overlaps them; the conditions are orthogonal. The nearest
*conceptual* neighbour, `ipc-payload-typed-inline`, is at **5.4 %**, and the seam that produces that
number is the same one §1 states in prose: it owns `interface`, I own `const`.

**Signals I designed, measured, and rejected — the rejections are the finding:**

| Candidate | Result | Why rejected |
|---|---|---|
| a TS file that re-lists every arm of a generated binding union without importing it | **165 matches / 102 files** — the honest population, ~3× the shipped rule's | **The census cannot express it.** It is a *join* between a file's literals and another file's union arms; the engine is a regex over one file's content. This is the rule I would ship if the engine could do it. Specified below as an ESLint rule instead. |
| the obligation phrase alone (`keep in sync`, `mirrors`, `in lockstep`) | 89 files | **~40 % precision.** Dominated by intra-client sync — *"stays in sync with the row's vertical padding"*, *"in lockstep with `concurrentCount`"*. Nothing to do with a language boundary. |
| the same + a cross-language referent | 53 files / 58 matches | Better, still ~90 %: leaks into prose *about* the backend and into mirrored payload shapes. |
| **the same + the referent within 160 chars + a VALUE declaration within 300** | **40 / 37 files, 88.9 % precision raw, 100 % after 5 named exclusions** | **Shipped.** Requiring `const`/`function` rather than `type`/`interface` is what separates this leaf from `bridge-type-contract`; it dropped both surviving shape-mirror false positives. |
| a `Record<string, T>` whose keys are machine tokens | 250+ | Fires on correct content constantly. |
| a `status_tokens` group whose arm count differs from a Rust enum's | — | **A join again, and across languages.** §0's largest finding is not gateable by counting. It needs the script in Gap 5's shape. |

**One trap specific to this rule, and the runner catches it.** This is **the only rule in the
registry whose match STARTS inside a comment**, so `ignoreCommentLines` must stay **off** — the
engine skips a match whose start line is comment-only, and turning it on silently zeroes the rule.
Executed: setting it produces `[structural] matched zero files anywhere` and exit 1. The engine's
own fail-loud contract catches the one mistake this rule invites.

**Validated standalone** against the real engine
(`node scripts/census/run-census.mjs --rules <scratch>/rules-client-rule-mirroring-qZ4m.json --check`):
`comment-kept-cross-language-mirror` → **37 files / 40 matches**, exit 0;
`generated-cross-language-mirror-positive-control` → **16 files / 16 matches**. **The full registry
was NOT run**, per the doctrine.

**Verified by a second independent implementation — and the two disagreed twice, which is how the
pattern got its shape.** The verifier is a private file walker with its own directory traversal, its
own comment-block grouping and its own regex assembly, importing nothing from `lib/engine.mjs`.
(1) A per-comment-line implementation and a comment-block implementation disagreed on 7 TS and 5 Rust
files when measuring the declared-mirror population — the block form wins, because a sync obligation
routinely spans a paragraph and a line-oriented reader sees the phrase without the referent.
(2) Hand-verifying all 45 raw matches found **5** false positives (two mirrored payload *shapes*, one
test title whose "cross-language referent" is the literal string `'Rust'` used as **test data**, one
comment describing backend behaviour rather than declaring a copy, and one file that is the
**compliant** form — `api/overview/events.ts` fetches the value rather than copying it). All five are
excluded by path with prose reasons. **40 remaining, 100 % precision by hand count**, and both
implementations then agree at 37 / 40.

**Fail-loud properties** — not asserted, **executed** against the working tree with exit codes
captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits, 56 surviving violation(s) across 53 file(s)` |
| baseline deflated (a rise) | **1** | `[drift] files rose 5 -> 37 (+32). New violations of …client-rule-mirroring.md` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 99 -> 37 (-62) without the baseline moving` |
| `floor` raised to 9000 | **1** | `[structural] walked 4829 files but floor is 9000` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 2000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 2000` |
| `goldenPath` removed | **1** | `missing grounding — a rule needs "goldenPath" …` |
| `exclude` path renamed | **1** | `[structural] exclude … matched no file. The exemption is stale` |
| `exclude` `reason` shortened to `"x"` | **1** | `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| **`ignoreCommentLines` turned ON (this rule's specific trap)** | **1** | `[structural] matched zero files anywhere` |
| **POSITIVE CONTROL — the violating rule's pattern → the COMPLIANT prose** | **1** | `[drift] files dropped 37 -> 16 without the baseline moving` |
| **control given a baseline** | **1** | `must NOT carry a baseline — it exists to fail` |

**Where this runs.** `npm run census:check` is a **pre-push job** (`lefthook.yml:74`,
`golden-path-census`) and a step of `npm run check`. Both execute on the developer's machine. Per the
campaign's §9 calibration this matters: `ci.yml` is red on pre-existing failures, so a CI-only gate
would run nowhere.

**How this gate could still fail, stated so the next repo can re-derive it.** The signal proxies for
*"one decision, two implementations, nothing asserting they agree"*, and it keys on a property of the
**authors**, not of the code: that they wrote the obligation down. **A repo that hand-keeps silently
scores zero while the condition is present at scale** — measured here, 165 untethered re-lists in 102
files and 26 label groups, of which only 37 files say so. An adopting repo must check the positive
control's population and, before trusting a green run, count its own untethered re-lists by the
method in Gap 4.

**The positive control** carries no `baseline` by design. It exercises the same three-part machinery
— prose alternation, bounded lazy gap, declaration anchor — with the prose naming the **compliant**
mechanism: a value that declares itself machine-generated or re-exported from the generated binding.
16 matches in 16 files (13 motionize-emitted glyph modules, `api/agents/executions.ts`,
`i18n/generated/enSectionStrings.ts`, `lib/personas/templates/templateChecksums.ts`). The two rules
differ in exactly one respect: **whether the comment above the declaration promises that a HUMAN will
keep it in sync, or names the MACHINE that does.** If any regex, walk or engine change broke the
comment-anchored matcher family, the control goes to zero and the run fails structurally — which
matters more here than for most controls, because this is the one rule that runs with
`ignoreCommentLines` off. **It must never be given a baseline.**

**On severity.** This is proposed at the census layer, which is a ratchet, not an `"error"`. The
count may not rise; the existing 40 are a backlog, and most of them are *currently correct*. No
argument from warning volume is made or intended — and specifically, the fact that 38 of the 40 agree
with their server counterpart today is why this is a ratchet: the defect is invisible at every
individual site and legible only as a population of forty promises nothing can keep.

```json
{
  "id": "comment-kept-cross-language-mirror",
  "goldenPath": "docs/concepts/golden-paths/client-rule-mirroring.md",
  "title": "A client-side VALUE re-implements a rule the Rust server owns, and the only thing holding the two implementations together is the comment that says so",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:[Kk]eep(?:ing)?(?: the two| them| it| this| these)? in sync|[Kk]ept in sync|[Mm]ust stay in sync|[Ss]tays? in sync|in lockstep|[Mm]irrors?\\b|[Mm]irror of\\b|MUST match|[Mm]ust match|[Ee]xact port of|[Rr]ust port of|keep the two in step)[\\s\\S]{0,160}?(?:\\bRust\\b|src-tauri|\\b\\w+\\.rs\\b|\\b[A-Za-z_]\\w*::[A-Za-z_]\\w*|\\bts-rs\\b)[\\s\\S]{0,300}?\\n\\s*(?:export\\s+)?(?:const|function|async function)\\s",
    "flags": "g",
    "description": "A TypeScript VALUE declaration (const / function) whose own comment names a Rust symbol, Rust file or src-tauri path as the thing it must agree with. THE THREE PARTS ARE THE DISCRIMINATOR: (1) an obligation phrase, (2) a cross-language referent within 160 chars of it, (3) a value declaration within 300 chars after. Dropping (2) matches 89 files, most of them intra-client sync ('stays in sync with the row's vertical padding', 'in lockstep with concurrentCount'); dropping (3) catches prose about the backend; requiring `const`/`function` rather than `type`/`interface` is what keeps this leaf out of bridge-type-contract's territory, which owns mirrored payload SHAPES and whose rule shares 5.4% of these files. NOTE `ignoreCommentLines` is deliberately OFF: this is the only rule in the registry whose match STARTS in a comment, and the engine skips a match whose start line is comment-only, so setting it zeroes this rule out (executed: exit 1, 'matched zero files anywhere'). PROXY FOR the stack-free condition: one decision is implemented twice, in two languages, with no mechanism asserting the two agree. Measured 2026-08-16 by running both implementations of five pairs on the same input against the operator's live 347 MB database: 40 sites in 37 files, 100% precision by hand count after the five exclusions below. TWO ARE DRIFTED TODAY, both in the subset whose obligation is written only on the client -- connectorRunnability.ts:31 maps `codebase|source_code|vcs|git` to `source_control` where connector_readiness.rs:229 deliberately stopped doing so (CORRECTED 2026-08-17 by credential-slot-binding: the 154-pair / 5-label figure measures design_context.connectorPipeline, a display-label array the normalizer is NEVER CALLED WITH. The corpus the resolvers actually see is 117 pairs / 11 labels, of which 1 of 11 normalizes differently -- and that one is unreachable on both sides, because the server short-circuits at GlobalProbe and the client short-circuits at an exact service_type match. The vocabulary split is real and this rule's condition is unaffected; the quantification was of the wrong corpus), and triggerArmState.ts:72 tests day membership before the overnight branch where trigger.rs:200-207 attributes the post-midnight tail to the previous weekday (31,878 of 35,052 representable overnight windows disagree on at least one minute; 0 of 351 live triggers configure one, so it is latent). LEGAL FIXES, all present in this repo: send the verdict on the payload (core/src/error.rs:206-215 ships category + auto_fixable + failover_eligible 'computed once via the canonical error_taxonomy helpers so Rust and TS never drift'); fetch the value at startup instead of copying it (evalFramework.ts:56-80 via lab_get_score_weights, whose comment records that the hand-kept mirror WAS the defect); generate the copy AND register the generator in scripts/run-codegen.mjs (guidance anchors: 12/12 identical to a dry run; the unregistered gen-tour-anchors.mjs is 127 anchors stale); tether to the generated union with Record<Union,T> or `satisfies Record<Union,T>` (executionState.ts:94, byomHelpers.ts:12,22 -- 7 sites in 5 files repo-wide against 165 untethered re-lists in 102 files); or, where none of those reach, put the tripwire on the side that CHANGES (core/src/types.rs:822-843 pins the exact TERMINAL/ACTIVE sets and its failure message names the TS constant to update). CONVERGENT: all 4 independent siblings hand-keep at least one such mirror. brainiac states why a codegen does not remove them (console/src/docs/facets.ts:3-5, 'the Rust enums serialize as plain strings, so the generated types give the console string') and makes both of its mirrors FAIL CLOSED (scopes.ts:12-14, 'a drift here fails closed -- it can only ever be narrower than the truth'); ascent/src/components/report/PassportHero.tsx:222-225 hand-copies 21 scoring arms only because the originals at passport.ts:272-275 are module-private consts, so the fix there is the word `export`; vibeman is the counter-example with four copies of one triage vocabulary, two live evaluators, zero tests, a CI that never runs cargo, and four measured disagreements including a conditionless rule that matches nothing in TS and everything in Rust. PRECONDITION (must be re-derived per repo): this signal keys on a property of the AUTHORS, not the code -- that they wrote the obligation down. It can only find mirrors that admit to being mirrors. A repo that hand-keeps silently scores zero while the condition is present at scale; here 165 untethered re-lists and 26 i18n label groups mirror a Rust vocabulary and say nothing, against the 37 files that do."
  },
  "exclude": [
    {
      "path": "src/api/templates/n8nTransform.ts",
      "reason": "the match is a mirrored payload SHAPE, not a mirrored rule: the comment describes the JSON that `confirm_n8n_persona_draft` returns as `serde_json::Value`, and the declaration it precedes is an `interface`. Hand-typed mirrors of a Rust struct are owned by bridge-type-contract.md and already counted by its `ipc-payload-typed-inline` rule; this leaf owns duplicated DECISIONS"
    },
    {
      "path": "src/features/plugins/artist/sub_media_studio/types.ts",
      "reason": "same class as n8nTransform.ts — `Mirrors the Rust OverlayEnterInput` documents an `interface OverlayEntrance` whose field types are the mirror; the `const` that follows 200 chars later is unrelated to the comment. A payload shape, owned by bridge-type-contract.md"
    },
    {
      "path": "src/api/overview/events.ts",
      "reason": "this file is the COMPLIANT form and must not be counted as a violation: the comment says the source of truth lives in `events.rs::MAX_MANUAL_RETRIES` and the DLQ tab FETCHES the value on mount, so the client never holds a second definition of the rule — exactly what §2 (b) prescribes"
    },
    {
      "path": "src/features/teams/sub_goals/GoalTaskTable.tsx",
      "reason": "the comment describes what the BACKEND does ('goal_advance.rs mirrors a decomposed goal's steps into dev_goal_items by exact title') rather than declaring a client-side copy of a server rule; the client here consumes the backend's output, it does not re-derive it"
    },
    {
      "path": "src/features/agents/quick-answer/triage/__tests__/triageReach.test.ts",
      "reason": "false positive from test prose: the match is a `describe` title ('mirrors the backend gate') whose cross-language referent is the literal string 'Rust' appearing as TEST DATA in `applicabilityMatches(null, 'Rust')`. Not a declaration and not a mirror"
    }
  ],
  "baseline": { "files": 37, "matches": 40 },
  "floor": 2000
}
```

```json
{
  "id": "generated-cross-language-mirror-positive-control",
  "goldenPath": "docs/concepts/golden-paths/client-rule-mirroring.md",
  "title": "POSITIVE CONTROL - a client-side value that declares itself machine-generated, or re-exported from the generated binding, instead of hand-kept",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:AUTO-GENERATED|auto-generated via ts-rs|DO NOT EDIT|DO NOT EDIT MANUALLY|seeded (?:at|from) (?:app )?startup|fetched at startup|Re-export the generated binding)[\\s\\S]{0,400}?\\n\\s*(?:export\\s+)?(?:const|function|async function)\\s",
    "flags": "g",
    "description": "POSITIVE CONTROL, deliberately carrying NO baseline. It exercises the SAME three-part machinery as `comment-kept-cross-language-mirror` — a prose alternation, a bounded lazy `[\\s\\S]{0,N}?` gap, and the `\\n\\s*(?:export )?(const|function)` declaration anchor — but with the prose naming the COMPLIANT mechanism this path prescribes: a value that is machine-generated or re-exported from the generated binding rather than hand-copied. The two rules differ in exactly one respect: whether the comment above the declaration promises that a HUMAN will keep it in sync, or names the MACHINE that does. Measured 2026-08-16 at 16 matches in 16 files: src/api/agents/executions.ts ('Re-export the generated binding (single source of truth)'), src/i18n/generated/enSectionStrings.ts, src/lib/personas/templates/templateChecksums.ts, and 13 motionize-emitted glyph modules. If any regex, walk or engine change broke the comment-anchored matcher family this control goes to zero and the run fails structurally — which matters more here than for most controls, because the violating rule is the only one in the registry that deliberately runs with `ignoreCommentLines` OFF and would otherwise fail silently in exactly the same way. Recall is deliberately narrow: it does not match runtime transport that carries no banner, nor a `satisfies Record<Union, T>` compiler pin (7 sites in 5 files, the other compliant form) — a liveness probe wants a stable, exactly-understood population, not coverage. It must never be given a baseline."
  },
  "floor": 2000
}
```

**Three conditions in this leaf I am refusing to gate by counting, with the measurement that
justifies each refusal — and a specification for the instrument each one actually needs:**

1. **A generated artifact that is out of date** (§0(a), D5) is the highest-value missing check in this
   leaf and it is an **absence** — "nothing re-ran this generator" — which the census cannot express
   by construction (doctrine §4). **The instrument: a `check:generated` script that runs every task
   in `scripts/run-codegen.mjs` plus every unregistered generator into a temp dir and fails if the
   output differs from the committed file, printing the regen command.** `brainiac`'s
   `openapi.rs:424` `committed_document_is_current` is the working precedent. Wire it into
   `npm run check` beside `census:check`, and register `gen-tour-anchors.mjs` in `run-codegen.mjs` in
   the same change. It would have caught 127 stale anchors, and it is ~40 lines.
2. **A label table shorter than the enum it mirrors** (§0, D1) is a **join across two languages and a
   JSON file**, not a string. **The instrument: extend `scripts/i18n/check-coverage.mjs` with a
   `status_tokens` mode** that parses the Rust `enum`s carrying `#[derive(TS)]` plus each SQL
   `CHECK(... IN (...))`, maps them to their `status_tokens` group via a small declared table, and
   fails on a group with fewer arms than its source. Precondition: fail loudly if it resolves zero
   groups. This is the check that turns §0 from a discovery into a gate.
3. **The 165 untethered re-lists** (D7) need to compare a file's string literals against another
   file's union arms — a join the census engine cannot do. **The instrument: an ESLint rule** (the
   right host when the signal is AST-shaped, per the contract), keyed on an object literal or `as
   const` array whose members are exactly the arms of a union exported from `src/lib/bindings/`,
   reporting *"tether this to `Record<X, …>` or `satisfies Record<X, …>`"*. It can autofix the
   `satisfies` case. **Do not attempt it as a regex** — I measured the population and could not build
   a pattern above 40 % precision for it.

---

## 12. Corrections to the brief

**12.1 — The spine label `convergence: diverged` is right about this repo and wrong about the
practice, and the distinction matters.** Per the doctrine's newly-closed convergence field I treated
the label as a hypothesis. **The result diverged here** — two executed drifts, a 127-entry stale
artifact, and a label layer covering 100 % of a 4,972-row table. **The practice converged
everywhere**: all four independent siblings hand-keep at least one cross-boundary mirror, including
the one with a 187-schema OpenAPI pipeline, which states in writing why the pipeline does not remove
them. So the honest label is *"universally practised, and its outcome here is worse than the
cohort's"*. `brainiac` has four mirrors and **zero** measured drift; this repo has forty and two.
**The variance is not in whether people mirror — it is in what stands behind the mirror**, which is
why §0 ships a ladder and not a prohibition.

**12.2 — Four of the six primed leads belong to a neighbouring path, and citing them here would have
double-counted.** `compute_trust_score` 0.0 vs `computeCompositeHealth` 70 (19 of 78),
`fitness_driver.rs:337-341`'s `(0.3,0.4,0.3)` vs `SCORE_WEIGHTS`, and `t.kpis.measurement_source`'s
5-vs-6 arms are all published in [`scoring-and-thresholds`](./scoring-and-thresholds.md) §0/D7/D8, and
**two of the three are not cross-language mirrors at all** — the trust/health pair is two composites
that never meet, and the weights contradiction is *inside one Rust binary*. `measurement_source`
**is** this leaf's shape (a SQL `CHECK` mirrored by a locale table) and is the same defect class as
§7 D1, so I cite it as corroboration and do not restate it. The two leads that were genuinely mine —
`EventGateReason`/`EVENT_REASON_TOKENS` and the error taxonomy — **both turned out to be in complete
agreement**, which is what sent this document looking for the discriminator instead of the drift.

**12.3 — "Two hand-kept lists, each with its own test, 0 cross-checks" is exactly right and its
implication is the opposite of the one implied.** Both primed pairs have that structure and both are
at 100 % agreement. The finding is not that they drifted; it is that **their tests could not have
told anyone if they had**, and that the vocabulary sitting in the same database column with *no*
declared mirror is the one that is 100 % broken. The brief asked what makes a mirror survive rather
than drift; the answer the measurement gives is **a mechanism that fails**, and a one-language parity
test is not one — it is a third copy with a green checkmark on it.

**12.4 — A correction to my own work, recorded because it is the kind that hides.** My first
reciprocity measurement reported **15 of 40** client mirrors as "named back by the Rust side". It
matched the TS file's **bare stem**, so `memories.ts` appeared to be named back by **63** Rust files
that merely contain the word "memories". Requiring the extension or the full path gives **10 of 40**.
Two implementations, one finding: the loose one is a vocabulary-shaped false positive of exactly the
kind the doctrine warns about, and the tell was the implausible fan-out, not the count. I then
**declined to publish reciprocity as the discriminator at all** (§7 D12) because the lift is weak
once you have all 40 sites — 28 of the 30 one-way mirrors are also fine.

**12.5 — The brief's framing "two implementations of one decision, in two languages" understates the
copy count by one, systematically.** Every vocabulary that reaches a screen has **three**: the Rust
enum, the client's handling, and the label table — and for a mirror with a "parity" test on each
side, **four**. The third copy is the one nobody declares, has no type (it is JSON), has no comment
naming its source, and is the only one that is measurably broken on live data. **P7 exists because
the brief's arithmetic was off by one and the missing copy was the failing one.**

**12.6 — A sibling in the oracle cohort is a port, and the doctrine clause that says so landed while
this document was being composed.** `personas-cloud/packages/shared/src/prompt.ts:594` mirrors this
repo's `engine/design.rs`; it is counted as a **port** rather than as independent corroboration (§6),
which takes the cohort from 5 siblings to **4 independent** ones. The port is also this leaf's purest
specimen: a cross-repo mirror with **1 test file in the entire repository, no CI at all**, and a
counterpart that has kept moving — the Rust original pins those exact heading strings with 6 unit
tests, and the port has none. It cannot know whether it has drifted, and neither can I.
