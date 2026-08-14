# Golden path — Status token vocabulary: from column to badge

> Situation node: `ui-system/copy-and-vocabulary/status-and-severity-badges` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. **Two-sided** — this leaf was fused during the seam pass from a backend
> `closed-vocabulary-column` leaf and a frontend badge leaf, because the SQLite `CHECK` constraint,
> the IPC token, the `en.json` label and the rendered pill are one chain and every defect below
> lives at a joint. Recurrence ~238.
>
> Ground truth: **66 unique closed vocabularies** at the schema layer (38 distinct columns,
> 184 distinct tokens), **88 ts-rs string-literal union types**, **26 `status_tokens` categories /
> 156 labels**, **80 feature-local token→presentation maps across 70 files**, and a
> **convergence check against `personas-web` and `brainiac`** (two stacks, no shared document).
> Repo denominators come from [`shared-facts.json`](../shared-facts.json) — 2,104 `.tsx` of the
> 4,829 TypeScript files under `src`, and 963 Rust files — rather than being re-derived here.
>
> **Scope split.** [`typed-error-contract.md`](./typed-error-contract.md) owns codes that describe a
> *failure* and route through `resolveErrorTranslated`. This path owns codes that describe a
> *state* and route through `tokenLabel`. [`schema-change.md`](./schema-change.md) owns the
> migration mechanics of adding the column; this path owns what the column's **vocabulary** must
> do once it exists. The layer model both sides obey is [`src/i18n/CONTRACT.md`](../../../src/i18n/CONTRACT.md).

## Trigger

- "I'm adding a new status to this table — where do I put the badge colour?"
- "This chip is showing `dead_letter` / `auto_fix_pending` instead of English."
- "The badge is blank / grey for one of the values."
- "I need a severity pill; there's a map three files over that almost does it."
- "I'm about to write `const STATUS_CONFIG: Record<string, {label, color}> = { … }`."
- "I'm about to add a value to a `CHECK(status IN (…))` list."
- "I'm about to add `#[derive(TS)]` to an enum whose variants a user will read."
- "Which of these two `severity` scales is the real one?" *(there are two — see Deviations D.)*

## The one way

**A closed vocabulary is one artifact with four obligations, and you discharge all four in the same
commit or you have shipped a bug.** Define the members **once**, in Rust, as a `#[derive(TS)]` enum —
not as a `String` field with a `CHECK` constraint guarding it, because a `CHECK` constraint stops bad
writes and teaches the frontend nothing. Mirror the enum in the schema so the database rejects what
the type already forbids. Let ts-rs carry it across the wire as a **string-literal union**, which is
the only artifact in the chain that both sides can typecheck. Then, on the frontend, resolve the two
halves of presentation from **one** table keyed by that union: the **label** through
`tokenLabel(t, '<category>', token)` reading `status_tokens.<category>` in `en.json` — never an
English literal at the call site — and the **colour** through `StatusBadge`'s `variant`/`accent` or
`STATUS_PALETTE`, never a fresh Tailwind literal. Type that table `Record<TheUnion, …>` so a new
variant is a **compile error**, not a grey pill. And decide, explicitly and in writing, which way an
unrecognised token degrades: **toward the value that demands attention, never toward the calm one** —
a token you do not know is a token you cannot vouch for, and rendering it green or rendering its raw
snake_case is the same lie told two ways.

**Warrant tags** (per the [portability test](../research/portability-test.md), so an adopting repo can
sort physics from local habit):

- *Physics* — the badge API takes the **token**, not a colour (both siblings converged on this
  independently). One vocabulary has one presentation table. An unknown member must not render as the
  reassuring member. Raw machine text on screen is a defect in any language.
- *Ergonomics* — colour and label belong in the **same** table keyed by the same union, because two
  parallel tables drift (this repo has a source comment recording exactly that drift; see Evidence).
- *Local calibration* — the `tokenLabel` / `status_tokens` / `STATUS_PALETTE` names; the 26-category
  taxonomy; the ts-rs mechanism. `brainiac` uses `openapi-typescript`, `personas-web` uses
  hand-written unions, and both reach the same place.
- *Scale condition* — the catalog indirection (`tokenLabel`) pays from the first locale. The
  **shared** colour palette pays from roughly ten surfaces; below that, a local `Record<Union, …>` is
  correct and consolidating is over-engineering. `brainiac` has ~12 such maps and a shared `band()`
  and is right; `personas-web` has 22 maps and a 2-consumer palette and is not.

## Mandated primitives

**Backend (Layer 1 — `src-tauri`)**

- **A Rust enum with `#[derive(TS)] #[ts(export)]` + `#[serde(rename_all = "snake_case")]`** — the
  single definition. This repo already has **88** of these exported as string-literal unions
  (`src/lib/bindings/*.ts`); `AutomationRunStatus`, `BuildPhase`, `ErrorCategory`, `ToolErrorKind`,
  `RemoteJobStatus`, `ExecutionState`, `PersonaEventStatus` are all real examples. This is the
  primitive that already exists and is under-used — see Deviations A.
- **`CHECK(col IN (…))` in the migration** — the schema mirror. 82 occurrences across
  `src-tauri/db/src/migrations/incremental.rs` and siblings, covering 66 unique vocabularies. It is a
  **write guard, not a contract**: nothing downstream can read it.
- **`validate_one_of(value, allowed, label)`** (`src-tauri/db/src/repos/dev_workspaces.rs:260`) — the
  door check, returning `AppError::Validation` with the allowed list in the message. It exists in
  exactly **one** file with **6** call sites; treat it as the pattern to lift, not a widely-adopted
  helper (Gaps 3).

**Wire (Layer 2)**

- **`src/lib/bindings/<Enum>.ts`** — the generated union. Regenerate with
  `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` and commit; CI fails on drift via
  the binding-drift job.

**Frontend (Layers 3–4)**

- **`tokenLabel(t, category, token)` / `tToken`** (`src/i18n/tokenMaps.ts:35`) — the Layer-1→Layer-4
  resolver. Signature `(t: Translations, category: TokenSection, token: string) => string`. Falls back
  to the **raw token** with a DEV-only `console.warn`. 48 calls across 30 files.
- **`status_tokens.<category>` in `src/i18n/locales/en.json`** — 26 categories, 156 labels. The
  generated type (`src/i18n/generated/types.ts:12690`) renders each category as a **closed object
  type** (`verdict: { production: string; promising: string; not_ready: string; broken: string }`),
  which is what makes the type-level parity check in step 7 possible.
- **`display/StatusBadge`** (`src/features/shared/components/display/StatusBadge.tsx`) — 44 call
  sites. A discriminated union of props: `variant` (6 semantic values) **xor** `accent` (15 palette
  colours), plus `icon`, `size`, `pill`, `title`. It renders `children`; it does **not** know your
  vocabulary. Pair it with your token table — do not put English inside it.
- **`display/StatusDot`** — 4 call sites, for the colour-only case.
- **`STATUS_PALETTE` / `STATUS_PALETTE_EXTENDED` / `HEALTH_STATUS_TOKEN` / `healthScale()` /
  `healthClasses()`** (`src/lib/design/statusTokens.ts`) — 5 + 4 semantic slots, each a 5-field
  `StatusToken` (`text`/`bg`/`border`/`ring`/`icon`). `healthScale()` adds `dot` and `line`. This is
  the answer to "each consumer needs a different slot subset": add the slot to `StatusToken`, do not
  fork the palette.
- **`EXECUTION_STATUS_MAP` / `getStatusEntry()`** (`src/lib/utils/formatters.ts:155,166,169`) — the
  execution vocabulary's icon+colour table, with a `DEFAULT_STATUS_ENTRY` that is deliberately grey,
  not red. Its `label:` fields are English and are a deviation; its **fallback discipline is correct
  and worth copying**.
- **`EVENT_STATUS_COLORS` / `EVENT_STATUS_ICONS`** (`src/lib/design/eventTokens.ts:111,134`) — both
  typed `Record<PersonaEventStatus, …>`, so all 8 wire members are covered by construction, and the
  in-source comment states the WCAG 1.4.1 rule: **each status must be distinguishable by shape, not
  colour alone.** This is the best-formed table in the repo. Its label half does not exist.

There is **no** shared "token badge" component that takes a category + token and renders the whole
thing. That absence is the root cause of most of section 7; see Gaps 1.

## Steps

1. **Find out whether the vocabulary already exists.** `grep` `src/lib/bindings/` for a union with
   your members and `en.json`'s `status_tokens` for a category. Two `severity` scales already ship
   (`ErrorSeverity` = info|low|medium|high|critical, `AlertSeverity` = info|warning|critical) against
   **one** `status_tokens.severity`, and `warning` has no label. Do not make it three.
2. **Define it in Rust as an enum, not a `String`.** `#[derive(Serialize, Deserialize, TS)]`,
   `#[serde(rename_all = "snake_case")]`, `#[ts(export)]`. If the value is already persisted as
   `TEXT`, the enum still owns it — implement `as_str()` and a `parse(&str) -> Option<Self>` that
   **rejects** rather than coerces (`brainiac` does this on 22 enums and it is the right shape).
3. **Mirror it in the migration** as `CHECK(col IN (…))` in the same commit, so the database rejects
   what the type forbids. Widening later is a one-line CHECK rewrite; adding a member to a Postgres
   `ENUM` is not — which is why `brainiac` made 2 enum types in migration 0001 and then chose CHECK
   26 times in a row.
4. **Validate at the door** with `validate_one_of` before the write, so a bad value from a command
   payload becomes `AppError::Validation` with the allowed list, not a raw
   `SQLITE_CONSTRAINT_CHECK`. Users can act on the first; nobody can act on the second.
5. **Regenerate bindings and commit them.** `cargo test --manifest-path src-tauri/Cargo.toml
   export_bindings`, then commit `src/lib/bindings/`. **This is the step that makes the vocabulary
   exist for the frontend.** Skipping it is what produces the 155 status-shaped fields currently
   typed `string` across 136 binding files.
6. **Add every member to `status_tokens.<category>` in `en.json` and translate all 13 other locales
   in the same commit** — `node scripts/i18n/translate-extract.mjs` → one Sonnet subagent per locale
   → `node scripts/i18n/translate-merge.mjs`. The `i18n-no-gaps` pre-commit hook blocks the commit
   otherwise. Write the *human* phrasing, not Title-Case of the token: `brainiac` renders
   `in_flight` as "decided, not yet shipped", and that editorial gap is precisely why nobody notices
   `queued → "Queued"` was never translated.
7. **Make the coverage a compile error.** Add one line beside the union — measured working, exact
   output below:

   ```ts
   type Covers<Labels, Union extends string> =
     [Exclude<Union, keyof Labels>] extends [never]
       ? true
       : { MISSING_LABELS_FOR: Exclude<Union, keyof Labels> };

   const _event: Covers<Translations['status_tokens']['event'], PersonaEventStatus> = true;
   ```

   Run against this repo today, `build`/`automation` compile clean and `event` fails with
   `Type 'boolean' is not assignable to type '{ MISSING_LABELS_FOR: "delivered" | "completed" |
   "skipped" | "dead_letter" | "discarded"; }'`. The error **names the missing tokens.** See §9.
8. **Build ONE presentation table keyed by the union**, carrying colour *and* the token key together:
   `const CONFIG: Record<TheUnion, { accent: BadgeAccent; tokenKey: string }>`. Not two tables. The
   canonical implementation and the source comment explaining why are at
   `VerdictBadge.tsx:16` — read it before writing yours.
9. **Render through `StatusBadge`**, feeding it `accent`/`variant` from the table and
   `tokenLabel(t, category, token)` as the child. **And then stop** — `StatusBadge` owns the
   geometry, the border, the size ramp and the `processing` ping. Do not re-declare padding, radius
   or border classes at the call site.
10. **Choose the unknown-token direction, out loud, in a comment.** The default for a state badge is
    grey + the `unknown` label (`DEFAULT_STATUS_ENTRY`, `EVENT_STATUS_FALLBACK`). The default for a
    *severity* or an *approval* vocabulary is the **most severe / least-approved** member.
    `brainiac`'s `console/src/docs/facets.ts:10-16` argues this explicitly — an unknown policy
    degrades to `needs_review`, never `auto_published`, so "a future enum value must never make this
    UI claim a revision published itself when a human is in fact still owed a decision." Copy the
    reasoning, not just the fallback.
11. **If the surface genuinely needs a different visual density**, parameterise with a `variant`
    prop and keep the branch logic in one component — `HealingIssueStatusBadge.tsx:33` is the repo's
    only instance of this move and its docstring explains it. Do **not** fork the component.

## Anti-patterns

- **`Record<string, …>` for a closed vocabulary.** This is the single highest-leverage error in the
  path: it silently disables the exhaustiveness the key type would have given you. Measured on
  no-fallback lookups: **54 are exhaustive by type** (a missing case is a compile error) and **19 are
  not** (a missing case is `undefined` → a badge with no classes). Both siblings made the identical
  mistake — `personas-web` has 4 (`HealthIssueRow.tsx:6`, `EventsListColumns.tsx:10`, …), `brainiac`
  has one (`StationModules.tsx:151`). *Failure mode: the type system was right there and you turned
  it off.*
- **`label: 'Completed'` inside the presentation table.** Puts English at Layer 3, which the i18n
  contract's I1 forbids. 241 such entries across 38 files. *Failure mode: 13 locales render an
  English word forever, and the coverage script cannot see it because the string was never a key.*
- **Two parallel tables — one for colour, one for the i18n key.** *Failure mode: a member added to
  one and not the other degrades silently. This is not hypothetical; `VerdictBadge.tsx:8-14` is a
  post-mortem of it.*
- **Rendering the token as the label** — `{issue.severity}`, `{row.status}`. 79 sites in 55 files.
  *Failure mode: the user reads `dead_letter`. In 14 languages.*
- **`?? token` / `|| status` as the fallback.** 186 occurrences in 115 files. This is the same defect
  wearing a resolver's clothes, and `tokenLabel` itself does it (`tokenMaps.ts:50`). *Failure mode:
  the fallback path is the untranslated path, so the tokens you forgot are exactly the ones users
  see raw.*
- **A `CHECK` constraint as the only definition.** *Failure mode: 49 of this repo's 66 vocabularies
  have zero label coverage, because a constraint in a migration string is invisible to every layer
  above it. The database is safe and the UI is broken.*
- **Degrading an unknown token to the calm value.** `personas-web` does this twice —
  `HealthIssueRow.tsx:15` sends an unknown severity to `low`/blue, `EventsListColumns.tsx:85` sends
  an unknown status to emerald. *Failure mode: the one state you did not anticipate is rendered as
  the one state that needs no attention.*
- **Forking the badge because you need a different slot.** *Failure mode: `sub_health` now has
  **three** `Record<HealthGrade, …>` tables with 8, 3, and 2 slots. Adding a grade means editing
  three files and the compiler only tells you about the ones you already found.*
- **A parity test instead of a parity type.** Two exist (`chainStopReasons.parity.test.ts`,
  `VerdictBadge.test.tsx`) for 26 categories, and both are hand-maintained mirrors of a Rust list.
  *Failure mode: it works, and it does not scale to 26, and the drift it catches is caught at
  test-time rather than at the keystroke.*
- **Asserting the bug in the test.** `VerdictBadge.test.tsx:26-30` asserts that an unknown verdict
  renders `something_new` on screen. *Failure mode: the raw-token render is now a specified
  behaviour and the next person cannot fix it without "breaking" a test.*

## Evidence

**Copy this one: `src/features/overview/sub_certification/components/VerdictBadge.tsx`.**
It is the only file in the repo that does the whole chain: one `VERDICT_CONFIG` carrying accent
**and** `tokenKey` together (`:16`), label via `tokenLabel(t, 'verdict', tokenKey)` (`:42`), render
via `StatusBadge` (`:44`), a null-state that is a dash rather than an empty pill (`:33`), and a
docstring (`:5-14`) that names the failure it was built to fix — *"the accent color and the
`status_tokens.verdict` token key were two independently hand-maintained literal maps in this file —
a new verdict added to one but not the other degraded silently."* Its two residual gaps are
`Record<string, …>` instead of `Record<Verdict, …>` and the `?? verdict.toLowerCase()` fallback at
`:41`; step 7 closes both.

Also worth reading:

- `src/lib/design/eventTokens.ts:111,134` — `Record<PersonaEventStatus, …>` for **both** colour and
  icon, so all 8 wire members are covered by construction, plus the WCAG 1.4.1 shape-not-colour rule
  stated in-source. The best-typed table here; it just has no label half.
- `src/lib/utils/formatters.ts:155-170` — `EXECUTION_STATUS_MAP` + `getStatusEntry()` +
  `DEFAULT_STATUS_ENTRY`, with the fallback deliberately grey and commented *"(gray badge, not
  red)"*. Correct unknown discipline; English labels.
- `src/features/overview/sub_observability/components/HealingIssueStatusBadge.tsx:8-20,33` — the
  `variant` move: shared four-way branch logic, per-surface density as a prop rather than a fork.
  **The shape is exemplary and the content is not** — it hardcodes seven English strings and renders
  `{issue.severity}` raw at `:70` and `:100`. Take the structure, not the body.
- `src/lib/design/statusTokens.ts:26-105` — `as const satisfies Record<string, StatusToken>`, which
  gives literal key inference *and* shape checking. The right way to declare a palette.
- `src/i18n/__tests__/chainStopReasons.parity.test.ts:4-14` — the hand-written mirror, whose comment
  is the clearest statement of the whole problem in the repo: *"`reason_token` is a raw `String`
  (not a ts-rs enum), so nothing typechecks it… a new Rust `stop_reason` const ships to production
  as an untranslated raw token in all 14 locales, with no build signal."*
- `src-tauri/db/src/repos/dev_workspaces.rs:260-269` — `validate_one_of`, the door check.

## Deviations

Counts are from a full sweep of `src` (4,829 files walked) and `src-tauri`, comments excluded.

**A. The vocabulary never becomes a type — the root deviation.** **155** status-shaped fields
(`status`/`severity`/`state`/`verdict`/`phase`/`health`/`priority`/`grade`) are typed **`string`**
across **136** binding files, against **88** unions that did it right. Every deviation below is
downstream of this one: with the union absent, `Record<string, …>` is the only thing that compiles.

**B. 66 closed vocabularies at the schema, 0 with complete label coverage.** 82 `CHECK(col IN (…))`
occurrences reduce to **66 unique** (col + token-set) across **38 distinct columns / 184 distinct
tokens**. Against the 26 `status_tokens` categories: **0 fully covered, 17 partial, 49 with zero
coverage.** The 49 include `verdict = helpful|wrong|outdated` (`incremental.rs:4423`),
`state = na|proposed|to_process|dispatched|adopted|diverged` (`:6801`),
`status = observed|proposed|adopted|deprecated|rejected` (`:6782`),
`state = na|unverified|adopted|violating` (`:8104`).

**C. Where a union and a category do pair, they drift.** Pairing each category against its
highest-overlap union: **9 exact, 13 mismatched, 4 with no union at all.** The mismatches are live
raw-token renders:

| Category | Union | Union members with no label |
| --- | --- | --- |
| `event` | `PersonaEventStatus` (8) | `delivered`, `completed`, `skipped`, `dead_letter`, `discarded` — **5 of 8** |
| `execution` | `ExecutionState` (6) | `incomplete` |
| `healing_status` | `IncidentStatus` (5) | `in_progress`, `dismissed` |
| `dev` | `ExecutionState` (6) | `incomplete`, `cancelled` |
| `test` | `AutomationRunStatus` (5) | `timeout` |
| `deployment` | `AutomationDeployStatus` (4) | `draft`, `error` |
| `goal_state` | `AutomationRunStatus` (5) | `failed`, `timeout` |

Plus dead labels in the other direction — `status_tokens.event` defines `processed` and `retrying`,
which `PersonaEventStatus` cannot emit. And there is **no declared link** between a category and its
union anywhere in the repo: the pairing above had to be inferred from member overlap, which is why
four categories (`verdict`, `chain_stop`, `circuit_breaker`, `event_reason`) pair with nothing.

**D. Two `severity` vocabularies, one category.** `ErrorSeverity` = info|low|medium|high|critical;
`AlertSeverity` = info|warning|critical. `status_tokens.severity` has the first five. **`warning` has
no label**, and `AlertRulesPanel.tsx:194` renders `{… : rule.severity}` — the raw token — as its
fallback, in the very file that declares the vocabulary (`:30,39`).

**E. 80 feature-local token→presentation maps across 70 files.** 74 carry Tailwind colour literals,
5 carry raw hex, 12 carry English `label:` fields (56 literals). **29 are `Record<string, …>`**
(exhaustiveness off), 30 are `Record<Union, …>`, **16 have no type annotation at all**
(`AUTOMATION_STATUS_CONFIG` at `automationTypes.ts:15`, `STATUS_CONFIG` at `connectorTypes.ts:134`,
`HEALTH_CONFIG` at `ScheduleRow.tsx:66` and again at `ConnectorReadiness.tsx:30`, `SEVERITY_CONFIG`
at `Banner.tsx:47` and again at `ErrorRecoveryBanner.tsx:27`, …).

**F. `sub_health` carries three competing `HealthGrade` palettes.** `heartbeats/model.ts:22`
`GRADE_THEME` (8 slots, semantic `text-status-error` tokens, self-described as *"Single source of
truth for grade → semantic-token styling"*); `HeartbeatIndicator.tsx:15` `GRADE_COLORS` (3 slots,
raw `border-emerald-400` palette classes — also a design-token violation); `StatusPageView.tsx:24`
`GRADE_META` (English `label` + `Icon`). All three are `Record<HealthGrade, …>`, so all three are
individually type-safe and collectively unmaintainable — the exact "different slot subset" root cause
the discovery predicted, confirmed.

**G. `STATUS_PALETTE` reaches 10 files.** 19 files import from `@/lib/design/statusTokens` at all;
`STATUS_PALETTE` itself is named in **10**, of which 2 are the palette module and the drift checker.
Against 70 files holding a local map. Two of the seven real consumers are the two forked
`SEVERITY_CONFIG` banners (E).

**H. Untranslatable labels: 241 entries across 38 files** pair an English `label:` with a colour class
in one object literal. Concentrations: `traceHelpers.ts` (36) and `traceInspectorTypes.ts` (12) are
**two copies of the same trace-category table**; `formatters.ts` (18); `eventSourceTemplates.ts` (13);
`colorTokens.ts` (11); `triggerStudioConstants.ts` (9). `sub_factory` alone holds **150** English
`label:` literals across 16 files (repo-wide: 1,529 across 174), though most of those are filter and
chart labels rather than status tokens — the status-token subset is the 241 above.

**I. Raw machine text on screen: 79 sites in 55 files.** Including the exemplar —
`HealingIssueStatusBadge.tsx:70,100` and `HealingIssueModal.tsx:190` render `{issue.severity}`;
`ActivityList.tsx:145,148`, `DeploymentCard.tsx:69-70`, `StandardsScanCard.tsx:91`,
`ProjectTeamPreviewModal.tsx:386-387`, `CloudExecutionRow.tsx:40`, `EventLogList.tsx:251`,
`PipelineRow.tsx:27`.

**J. `?? <token>` fallbacks: 186 occurrences in 115 files** — including `tokenMaps.ts:50` itself, and
`VerdictBadge.tsx:41`.

**K. Missing-case-is-`undefined`: 19 no-fallback lookups in 17 files** key a `Record<string, …>` or an
unannotated map by a status value with no `??` — `VerdictBadge.tsx:40`, `HEALTH_DOT` at
`AgentsSidebarNav.tsx:57`, `SEVERITY_CONFIG` at `Banner.tsx:98` and `ErrorRecoveryBanner.tsx:72`,
`STATUS_ICON`/`STATUS_COLOR` at `ConnectorReadiness.tsx:156-157`, `HEALTH_CONFIG` at
`ScheduleRow.tsx:120`, `STATE_ICON` at `PracticeRolloutModal.tsx:129`, `STATUS_DOT`-alikes elsewhere.

**L. The door check is one file wide.** `validate_one_of` has **1** definition and **6** call sites,
all in `dev_workspaces.rs`, against 66 vocabularies. Everywhere else, an invalid token reaches SQLite
and comes back as a constraint error.

**M. Parity is guarded by hand, twice.** `chainStopReasons.parity.test.ts` (a byte-for-byte mirror of
`src-tauri/db/src/chain.rs:45-81`, written after `healing_capped` shipped as a raw token) and
`VerdictBadge.test.tsx`. Two of 26. And the second one **asserts the defect**: `:26-30` expects
`something_new` to appear on screen.

**N. `tokenMaps.ts`'s own docstring is stale.** `:13-15` instructs you to "add the token → i18n key
mapping in the relevant `*_TOKENS` record" and to put the English "in `src/i18n/en.ts`". There are no
`*_TOKENS` records — the file resolves straight off `t.status_tokens[category]` — and `en.ts` is a
back-compat proxy over `locales/en.json`. A developer following the mandated primitive's own
instructions cannot succeed.

## Gaps

1. **There is no `TokenBadge` primitive.** `StatusBadge` takes `children`, so every consumer must
   independently wire `tokenLabel` + a colour table. The missing component is
   `<TokenBadge category="event" token={row.status} />` with a `Record<Union, BadgeAccent>` map
   registered per category. This one absence generates deviations E, H, I and K. It is buildable
   today from parts that all exist; nothing blocks it but nobody has written it.
2. **`tokenLabel`'s third parameter is `string`.** `tokenMaps.ts:35` accepts any string for any
   category, so `tokenLabel(t, 'severity', executionState)` compiles. The union is generated, the
   category is typed, and the one place they could have been related is not. Narrowing it needs a
   declared category→union map, which is gap 3.
3. **No artifact declares which union a `status_tokens` category labels.** The 26 categories and the
   88 unions live in separate trees with no link. That is why the pairing in Deviation C is a
   heuristic and four categories pair with nothing. The fix is a single map file
   (`Record<TokenSection, string-literal union>`), which then makes gaps 1, 2 and the §9 type check
   mechanical rather than per-site.
4. **`StatusToken` has five slots and consumers want eight.** `heartbeats/model.ts:22` needs
   `bar`/`track`/`soft`/`chip`; SVG and canvas consumers need raw hex, which the class-based token
   cannot supply — hence `STATE_HEX` (`displayUseCase.ts:101`), `HEALTH_HEX` (`GraphCanvas.tsx:29`)
   and `GOAL_STATUS_META`'s hex fields. **This is a real limitation, and it is the root cause of
   Deviation F, not laziness.** The fix is to widen `StatusToken` with the missing slots plus a
   `hex` field and derive the class strings from it — not to keep forking.
5. **`validate_one_of` lives in a repo module, not a shared crate**, and takes `&[&str]` rather than
   deriving the list from the enum. Once vocabularies are enums, the check should be
   `T::parse(s).ok_or(...)` and this helper becomes unnecessary for typed columns.
6. **Nothing verifies that a `CHECK` constraint and its enum agree.** They are mirrored by
   convention. `brainiac` documents the same convention at `library.rs:4-6` (*"every enum mirrors a
   CHECK constraint in the migration"*) and also has no mechanism. Neither repo has solved it; a
   test that parses the migration SQL and diffs against the enum's variants is the obvious move and
   is unwritten in both.
7. **Non-English locales cannot express a status the source does not name.** Since `status_tokens`
   is keyed by machine token, a locale that needs to *split* a token (e.g. gendered forms) has no
   escape hatch short of ICU in the value. Not currently a live problem; noted so the next person
   does not discover it under deadline.

## Convergence

`personas-web` (Next.js/Supabase, no Rust) and `brainiac` (Rust + Postgres + Next.js console) were
measured independently. Neither has seen this document.

**Reinvented in both — treat as physics:**

- **The badge API takes the token, not a colour or a variant.** `personas-web`'s
  `StatusBadge.tsx:67` is `<StatusBadge status={BadgeStatus} />` with the token→presentation table
  private to the file; `brainiac`'s `Stamp({status: Status})` (`library/primitives.tsx:41`) is the
  same. Three repos, three stacks, same signature. This repo is the **outlier** — `StatusBadge` takes
  `children` and a colour, which is exactly why it needs 44 hand-wired call sites.
- **`Record<ClosedUnion, Presentation>` is the enforcement mechanism.** 22 such maps in
  `personas-web`, ~12 in `brainiac`, 30 here. And **all three stop there** — zero `never`
  exhaustiveness checks and (outside `statusTokens.ts`) essentially no `satisfies` on a status map in
  any of the three. The mechanism is universal; nobody has taken the next step.
- **The same escape hatch, in the same proportion.** `Record<string, …>` appears in all three
  (4 in `personas-web`, 1 in `brainiac`, 29 here) and in every case the runtime `??` fallback is what
  the missing type buys back.
- **The seam breaks at serialization, in both repos that have a backend.** `brainiac` built a real
  codegen pipeline (`openapi-typescript` from a server-emitted `openapi.json`) and then defeated it:
  **32 API structs declare `pub status: String`**, so `openapi.json` contains **zero** enums and the
  console has to re-narrow by hand. That is our Deviation A, in a different language, through a
  different codegen tool, at the same joint. A defect two independent teams reach by different routes
  is a property of the seam, not of either team.

**The one divergence worth stealing.** `brainiac` wrote the **failure direction** down and made it a
reviewable decision — `console/src/docs/facets.ts:10-16`: an unknown policy degrades to
`needs_review`, never `auto_published`, because *"a future enum value must never make this UI claim a
revision published itself when a human is in fact still owed a decision."* Two named boundary
functions (`asLifecycle`, `asPolicy`) collapse every unknown string once, at the edge, so unknowns
**cannot reach** the presentation layer. `personas-web` has the identical situation four times and
degrades silently toward the *calmest* value (unknown severity → `low`/blue; unknown status →
emerald). Same architecture, opposite safety direction, and only one repo noticed there was a
direction to choose. That is step 10 above, and it is the clause this path would not have contained
without the convergence check.

**Local to us.** The i18n indirection has no analogue in either sibling — `personas-web` duplicates
severity vocabularies across three `en.ts` blocks and its **shared badge is the one component that
cannot be translated**; `brainiac` has no i18n at all. So `tokenLabel` is not a universal
prescription. But the *condition* it addresses is universal, and both siblings have it: an English
label authored beside a colour, unreachable by any catalog.

## The missing gate

**MANIFESTATION LAYER.** The rule below keys on the shape this repo's deviations happen to wear.
An adopting repo inherits the trigger, the one way, the anti-patterns and the *intent*; it must
re-derive its own proxy. The condition being proxied is stated in the rule's own `description` so
that re-derivation is possible.

### First: the type, not the gate

Per the contract's *Prefer a type over a gate* section, the ratchet is second-best here. **The
constraint can be made unrepresentable, and it was verified working during composition** — a probe
file was added, typechecked with `npx tsc --noEmit`, and removed:

```ts
// src/i18n/tokenParity.ts  (proposed; ~8 lines)
type Covers<Labels, Union extends string> =
  [Exclude<Union, keyof Labels>] extends [never]
    ? true
    : { MISSING_LABELS_FOR: Exclude<Union, keyof Labels> };

type Cat<K extends keyof Translations['status_tokens']> = Translations['status_tokens'][K];

export const _build:      Covers<Cat<'build'>,      BuildPhase>          = true;
export const _automation: Covers<Cat<'automation'>, AutomationRunStatus> = true;
export const _execution:  Covers<Cat<'execution'>,  ExecutionState>      = true;   // fails today
export const _event:      Covers<Cat<'event'>,      PersonaEventStatus>  = true;   // fails today
```

Measured output on `master`, verbatim, with the rest of the repo clean (`tsc --noEmit` reported
exactly these two and nothing else):

```
src/i18n/__probe_tokenParity.ts(20,7): error TS2322: Type 'boolean' is not assignable to
  type '{ MISSING_LABELS_FOR: "incomplete"; }'.
src/i18n/__probe_tokenParity.ts(21,7): error TS2322: Type 'boolean' is not assignable to
  type '{ MISSING_LABELS_FOR: "delivered" | "completed" | "skipped" | "dead_letter" | "discarded"; }'.
```

Three properties make this the right primary mechanism. It **names the missing tokens in the error**,
so the fix is mechanical. It costs one line per category, and this file *is* gap 3's missing
category→union map, so writing it discharges a gap rather than adding maintenance. And it fires in
the editor at the keystroke that adds the Rust variant — not in CI, not at test time.

Two things it cannot do, which is why the census rule still ships: it only works for the **9 exact +
13 mismatched** categories that have a union at all (Deviation A means most vocabularies have none),
and it says nothing about the label being **English at the call site** rather than in the catalog.

Precondition on the type check itself: it depends on `scripts/i18n/gen-types.mjs` continuing to emit
`status_tokens.<category>` as a **closed object type** rather than `Record<string, string>`. If that
codegen ever widens, this check silently passes forever — the exact fail-silent mode the contract
warns about. Guard it with the tautology `const _shape: Cat<'verdict'>['production'] = '' as string;`
plus one line asserting a *known-absent* key errors, or assert it in the codegen's own test.

### Then: the census rule (the ratchet that holds the line until the types land)

Do not add this to `scripts/census/rules.json` from this document; the orchestrator merges it.
**Validated** with `node scripts/census/run-census.mjs --rules <tmpfile> --check` → `census OK`,
exit 0, 4,829 file-visits, 38 files / 241 matches against floor 4,000. Fail-loud verified by raising
`floor` to 99,999, which produced
`[structural] walked 4829 files but floor is 99999. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN`
and exit 1.

```json
{
  "id": "untranslatable-token-label",
  "goldenPath": "docs/concepts/golden-paths/status-and-severity-badges.md",
  "title": "Closed-vocabulary label authored beside its colour instead of resolved from the translation catalog",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\{(?=[^{}]*\\blabel\\s*:\\s*['\"][A-Z][^'\"]*['\"])(?=[^{}]*\\b(?:bg|text|border|ring)-[a-z])[^{}]*\\}",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "ONE object literal that holds BOTH an English `label:` string AND a colour utility class. PROXY FOR the stack-free condition \"the human-readable name of a closed-vocabulary member is authored at the same site as its presentation, so it can never be translated and the vocabulary has no single home\". PRECONDITION (measured, must be re-derived per repo): this repo writes badge/status config as flat single-level object entries on one line, with the key spelled `label` and colours as Tailwind utilities. Where a repo formats those entries across lines with nested objects, or names the key `title`/`text`, or uses CSS-in-JS, this pattern scores ZERO while the condition is present at full scale — the same failure the portability test measured for `tables.md` and `form-field-and-validation.md`. Sibling evidence that the CONDITION is universal but the SHAPE is not: personas-web's shared badge is `label: \"Queued\"` beside `bgColor` at StatusBadge.tsx:11 (would match), brainiac's is a separate `STATUS_LABEL` table with the colour resolved through band() at kb-data.ts:42 (would NOT match, same defect). Legal destinations: `tokenLabel(t, category, token)` for the label + `STATUS_PALETTE` / `StatusBadge variant` for the colour."
  },
  "baseline": { "files": 38, "matches": 241 },
  "floor": 4000
}
```

**No `exclude` entries, deliberately.** The legal destinations (`tokenLabel`, `en.json`,
`STATUS_PALETTE`, `StatusBadge`) do not pair a label with a colour and so cannot match — there is no
primitive to exempt. A stale exemption is a fail condition in this runner, so an empty allowlist that
is genuinely empty is better than a defensive one.

**Honest precision.** Sampled matches are badge-config entries pairing an untranslatable English
label with a colour; the false-positive class is vocabularies that are closed but not *status*
(`ModelBadge.tsx`, `SidebarLevel1.tsx`, `TerminalSearchBar.tsx` — ~15 of 241). Those are still true
positives for the condition as stated (an unreachable-by-catalog label), just outside this leaf's
scope. Recall is bounded by the multi-line/nested-object shape, which this pattern's `[^{}]*` cannot
cross — measured as a small loss here, and it would be near-total in a repo that formats differently.

**What is not gateable.** No countable signal distinguishes a `CHECK` constraint whose vocabulary
*should* surface in the UI from one that is purely internal (`action IN ('insert','update','delete')`
never reaches a user). Deviation B's headline — 49 vocabularies with zero label coverage — is
therefore a finding, not a threshold. The type check in the first half is the only mechanism that can
tell the difference, because a category→union entry is a human asserting "this one is user-visible."
