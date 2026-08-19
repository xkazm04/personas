---
layer: application
subject: status-vocabulary
technique: status-color-mapping
stack: react
---

# React application — status color mapping

## The one file that does the whole chain

`src/features/overview/sub_certification/components/VerdictBadge.tsx` is
the exemplar to copy: one `VERDICT_CONFIG` carrying accent **and**
`tokenKey` together (`:16`), label via `tokenLabel(t, 'verdict', tokenKey)`
(`:42`), render via `StatusBadge` (`:44`), a dash for the null state
(`:33`) — and a docstring (`:5-14`) that is a post-mortem of the exact
drift the technique names: *"the accent color and the
`status_tokens.verdict` token key were two independently hand-maintained
literal maps in this file — a new verdict added to one but not the other
degraded silently."* Its residual gaps are instructive too:
`Record<string, …>` instead of `Record<Verdict, …>` (`:40`) and the
`?? verdict.toLowerCase()` raw-token fallback (`:41`).

## The palette and the best-typed table

- `src/lib/design/statusTokens.ts` — `STATUS_PALETTE` /
  `STATUS_PALETTE_EXTENDED`: 5 + 4 semantic slots, each a 5-field
  `StatusToken` (`text`/`bg`/`border`/`ring`/`icon`), declared
  `as const satisfies Record<string, StatusToken>` (literal key inference
  *and* shape checking — the right way to declare a palette). Threshold
  mappers (`rateToHealth`, `latencyToHealth`) and `healthScale()` derive
  scales instead of forking them.
- `src/lib/design/eventTokens.ts:111,134` — `EVENT_STATUS_COLORS` and
  `EVENT_STATUS_ICONS`, both typed `Record<PersonaEventStatus, …>`, so
  all 8 wire members are covered by construction, with the WCAG 1.4.1
  shape-not-color rule stated in-source. Best-formed table in the repo;
  its label half does not exist.
- Unknown-direction evidence: `EXECUTION_STATUS_MAP`'s
  `DEFAULT_STATUS_ENTRY` (`src/lib/utils/formatters.ts:155-170`) is
  deliberately grey — commented *"(gray badge, not red)"* — correct for a
  state vocabulary. The severity-direction argument the technique quotes
  is `brainiac`'s `console/src/docs/facets.ts:10-16` (unknown policy →
  `needs_review`, never `auto_published`); the counter-specimens are
  `personas-web`'s `HealthIssueRow.tsx:15` (unknown severity → low/blue)
  and `EventsListColumns.tsx:85` (unknown status → emerald).

## The measured decay

- **Fragmentation:** 80 feature-local token→presentation maps across 70
  files; 29 keyed `Record<string, …>` (exhaustiveness off), 16 with no
  type annotation at all. `STATUS_PALETTE` itself is named in 10 files.
  241 entries across 38 files pair an English `label:` with a color class
  in one object literal — untranslatable by construction (census rule
  `untranslatable-token-label`, baseline 38/241).
- **The slot-starvation fork, live:** `sub_health` carries three
  competing `Record<HealthGrade, …>` palettes —
  `heartbeats/model.ts:22` (`GRADE_THEME`, 8 slots, self-described
  "single source of truth"), `HeartbeatIndicator.tsx:15` (`GRADE_COLORS`,
  3 slots, raw palette classes), `StatusPageView.tsx:24` (`GRADE_META`,
  English labels + icons). Each type-safe, collectively unmaintainable —
  the shared `StatusToken` has five slots and these consumers want
  eight, plus raw hex for canvas (`HEALTH_HEX`, `GraphCanvas.tsx:29`).
  Widen the slot set; do not fork.
- **Severity duplicated 3×** across the design layer — registered as
  deferred-fix anchor **#w3-design-tokens**.
- **Raw tokens on screen:** 79 sites in 55 files render `{row.status}` /
  `{issue.severity}` directly — including the structurally exemplary
  `HealingIssueStatusBadge.tsx` (`:70`, `:100`), whose `variant`-prop
  shape is worth copying and whose body is not. And
  `VerdictBadge.test.tsx:26-30` asserts the raw-token render of an
  unknown verdict — the defect enshrined as specified behavior.

## Convergence

Three repos, three stacks, one signature: `personas-web`'s
`StatusBadge.tsx:67` and `brainiac`'s `Stamp({status})` both take the
**token** and keep the table private. This repo's `StatusBadge` takes
`children` + a color — the outlier — which is why it needs 44 hand-wired
call sites and why the missing `<TokenBadge category token/>` primitive
is the single absence generating most of the fragmentation above.
