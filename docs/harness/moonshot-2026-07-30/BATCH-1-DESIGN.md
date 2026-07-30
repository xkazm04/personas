# Batch 1 Design — "Command Surfaces" (2026-07-30)

> Five moonshot v1 slices built in parallel by five builders, landing as ONE coherent package:
> **"You open Personas and the fleet is legible and drivable in minutes — from your desk or your
> pocket."** Branch: `vibeman/moonshot-batch1-2026-07-30`. Baselines: tsc 0 errors; vitest +
> cargo check recorded by orchestrator.

## The package story (why these five are one feature)

1. **Generative Cockpit** — agent output becomes interactive UI (the vocabulary).
2. **Morning Director** — the Home tab opens with an Athena-composed, *actionable* briefing (the
   ritual).
3. **Autonomous NOC** — alerts fire server-side, become incidents, arrive pre-diagnosed (the
   feed the briefing draws from).
4. **Generative Tours** — any "show me how" becomes a live spotlight walkthrough (the teacher).
5. **Fleet Command Anywhere** — the rare human moments become phone-answerable (the leash).

A user should experience them as one upgrade: *the app now talks to you in surfaces, briefs you,
pre-diagnoses its own problems, teaches you, and reaches you anywhere.*

## Shared UX contracts (ALL builders MUST follow)

- **Design system only.** Every visual element comes from the blessed catalog
  (`src/features/shared/components/CATALOG.md`), `designTokens.ts` / `statusTokens.ts`, and
  `motionPresets.ts`. No hand-rolled buttons/modals/colors. ESLint enforces this — do not
  disable rules.
- **Athena provenance badge.** Anything composed/diagnosed/handled by Athena carries the shared
  `<AthenaComposedBadge />` (`src/features/shared/components/feedback/AthenaComposedBadge.tsx`,
  created by the orchestrator — import it, do not fork it). Variants: `composed` (briefing,
  tours), `diagnosed` (NOC root-cause), `handled` (NOC autonomous lane).
- **One action grammar.** Every agent-proposed action is: explicit affordance → one click →
  confirm if destructive/spendy → executes → recorded (to `companion_decisions` where the
  companion is involved). NOTHING auto-runs from a rendered surface without consent. Reuse
  `DecisionAction` / `DispatchChooser` patterns rather than inventing new ones.
- **Honest empty/loading states.** Every new surface has a real empty state ("Quiet night —
  nothing needs you"), a skeleton/ghost loading state using existing patterns, and never fakes
  data. Degrade gracefully (missing anchor → skip step; invalid spec → markdown fallback).
- **Copy voice.** Athena speaks first-person, brief, operational ("I retried the failed run —
  it passed"), never cutesy. Match existing companion copy.
- **i18n**: follow the convention of the files you touch. If surrounding code uses i18n keys,
  add keys; keep catalog edits append-only.

## Slices, owners, and file zones

Each builder implements the **v1 slice** below — not the whole moonshot. Full context: read your
section of the source report FIRST (paths below, in `docs/harness/moonshot-2026-07-30/`).

### 1. Generative Cockpit v1 — `shared-ui-components.md` #1
**Slice**: `surfaceSpec.ts` (zod discriminated union: `stat_row | table | decisions | markdown |
gauge | progress | terminal`) + `SurfaceAction` mapped onto `DecisionAction`/`DispatchRequest` →
`<SurfaceRenderer spec>` switch over EXISTING catalog components only → validate/repair on
ingest with MarkdownRenderer fallback → wire into the execution result view so a persona run
whose output parses as a SurfaceSpec renders live → unit tests for schema + renderer fallback.
Consent-gated actions via DispatchChooser; nothing auto-runs.
**Owns**: `src/features/shared/components/surface/**` (new), the execution-result integration
point (find it; likely under execution/overview result rendering), spec docs appended to catalog
pipeline. **Do not touch**: `src/features/home/**`, tours, fleet, `src-tauri/**`.

### 2. Morning Director v1 — `home-dashboard.md` #1
**Slice**: (a) `actions` field on `CompanionCockpitWidget` + 3 real enum-validated actions wired
into existing widgets (issue_list → rerun-failed, verdict → approve/decline pending approval,
persona_overview → pause persona) using EXISTING IPC; (b) since-left delta promoted to a
serializable session-delta doc + `compose_briefing` companion op (Rust) with delta gate ("only
compose when something happened") and deterministic fallback (`composeDefaultCockpit` model);
(c) session-open trigger renders a dated briefing overlay above the persistent cockpit via the
existing `contextualCockpit` overlay path; (d) every briefing action writes to
`companion_decisions`. Narration via `useTourNarration` ONLY if everything else is done.
**Owns**: `src/features/home/sub_cockpit/**` (EXCEPT `widgets/WalkthroughOfferWidget.tsx` —
tours owns it), `src/features/home/sub_welcome/**`, `src/features/home/components/HomePage.tsx`,
`src-tauri/src/companion/brain/cockpit.rs` + new `briefing`-related Rust files.
**Shared-file protocol** applies to the companion dispatcher (below).

### 3. Generative Tours v1 — `home-dashboard.md` #2
**Slice**: (a) build-time anchor manifest script (`scripts/docs/gen-tour-anchors.mjs` or
similar) emitting JSON of stable route-level `data-testid`s + nav enums (seed from
`tourAnchors.test.ts`); (b) `DynamicTourDef` (= `TourStepDef` with inline strings) + new
`companion_tours` table + dynamic-id resolution so `GuidedTour.tsx` plays them UNCHANGED;
(c) `compose_tour` companion op (new Rust module, sibling of compose_cockpit) validating every
step against the manifest — reject unknown anchors; (d) wire `WalkthroughOfferWidget` "Show me"
to compose_tour when no static tour matches, with a "composing your walkthrough…" ghost state +
`<AthenaComposedBadge variant="composed">` on generated tours in the Learning timeline.
**Owns**: `src/stores/slices/system/tourSlice.ts` + its tests, `src/features/onboarding/**`,
`src/features/home/sub_learning/**`, `src/features/home/sub_cockpit/widgets/WalkthroughOfferWidget.tsx`,
`scripts/docs/gen-tour-anchors*`, new Rust `src-tauri/src/companion/**/tours*` + `companion_tours`
migration. **Do not touch**: the rest of `sub_cockpit` (Morning Director owns it).

### 4. Autonomous NOC v1 — `overview-observability.md` #1
**Slice**: (a) port the `useGlobalAlertEvaluator` rule loop server-side — Rust background task
next to the SLA evaluator; fires `PersonaEvent` + notification with UI closed (keep the frontend
evaluator as-is for now; the Rust task is the authority, dedupe double-toasts if trivial);
(b) fired alert / SLA breach auto-opens an `audit_incidents` row via the existing taxonomy,
deduped by chain/persona; (c) on incident open run `run_healing_analysis` + `execution_knowledge`
lookup and attach a root-cause summary to the incident (render with the `AthenaVerdictCard`
shape + `<AthenaComposedBadge variant="diagnosed">`); (d) diagnosis may emit a PROPOSED action
as a pending companion approval — proposal only, NO auto-approve-allowlist expansion in v1;
(e) incidents inbox gets a "handled autonomously" lane (will be sparsely populated in v1 — honest
empty state).
**Owns**: `src/features/overview/sub_incidents/**`, `sub_observability/**` (evaluator + trace
viewer untouched except dedupe), `src/api/overview/**`, new Rust alert-evaluator/incident
modules under `src-tauri/src/commands/` + engine as needed. **Do not touch**: companion
approvals autopilot allowlist, fleet, home.

### 5. Fleet Command Anywhere v1 — `fleet-orchestration.md` #2
**Slice**: (a) replace the `genToken` theatre in `FleetPairDevice.tsx` with a real
`fleet_pair_device` command — device keypair minted + stored, genuine QR (endpoint + token);
(b) token-authenticated `/companion/state` (compact JSON projection reusing `sessionAttention` /
`approvalsForSession` / `liveModel` — they are pure) + `/companion/act` routes on the EXISTING
hooks axum server, LAN-only; `/act` allowlist v1 = approve/reject Athena proposal, canned reply
to `awaiting_input`, wake, kill — each audited to the decisions ledger; (c) minimal installable
PWA served by that axum server: attention inbox, approval cards with Athena rationale, reply,
kill/wake — built with plain responsive HTML/CSS matching Personas' dark visual language (tokens
copied as CSS custom properties; note the PWA cannot import the React catalog — keep it visually
faithful and SIMPLE). Security is the product: device-scoped tokens, per-action allowlist,
constant-time compare, no PTY bytes/credentials ever in the projection.
**Owns**: `src/features/plugins/fleet/FleetPairDevice.tsx` + `FleetMobilePreview.tsx`,
`src-tauri/src/commands/fleet/hooks.rs`/`keys.rs` + new fleet pairing/companion-api modules,
PWA assets dir (new, e.g. `src-tauri/resources/mobile/` or wherever the axum server can serve
from). **Do not touch**: fleet monitor UI beyond what pairing settings need, companion brain.

## Coordination rules (hard)

1. **Same working tree, parallel builders.** Stay strictly inside your file zone. New files
   preferred over editing shared ones.
2. **Shared-file protocol** — these files may be touched by >1 builder ONLY as one-line/append
   registrations: companion dispatcher/op registry (Morning Director + Tours), command
   registration (`lib.rs`/`mod.rs` invoke_handler lists; NOC + Fleet + Tours), event registry,
   migration index (Tours + NOC: number migrations by picking the next free number at the
   moment you write it; if you hit a collision, renumber yours). Make the edit atomic and
   minimal; if an Edit fails because the file changed under you, re-read and re-apply — never
   rewrite whole sections.
3. **No cargo.** Do NOT run `cargo check/build/test` — the orchestrator runs the single
   authoritative `cargo check --features desktop,ml` after harvest (concurrent cargo corrupts
   the target dir / locks). Write Rust carefully; compile errors found at harvest come back to
   you as fixups.
4. **tsc allowed**: `npx tsc --noEmit` scoped runs are fine. Full `npm run check` is NOT (it
   lints all of src/ — wasteful ×5).
5. **No git.** Do NOT commit, stage, branch, or revert. The orchestrator commits per item after
   review. Never touch files outside your zone; uncommitted work from four other builders is in
   the same tree.
6. **New Rust commands** follow the existing binding/export pattern of neighboring commands
   (ts-rs exports, command contract). If a generated-bindings step exists, note it in your
   reply; do not run generators that rewrite `src/lib/bindings` wholesale.
7. **Tests**: add focused unit tests where the surrounding code has them (schema validation,
   pure projections, manifest validation). Do not modify existing tests except your zone's.
8. **Reply format** (<150 words): zone, what shipped vs slice spec, files created/modified
   (paths), shared-file edits made (exact), migrations added (number), what you could NOT finish
   and why, any dispatcher/registration line the orchestrator must verify.

## Acceptance bar (orchestrator review, per item)

- Slice complete per spec above; UI matches the shared UX contracts (badge, action grammar,
  empty states, tokens); no zone violations (checked via `git status` diff paths); tsc clean;
  cargo check clean after harvest; vitest no regressions vs baseline; the five features
  reference each other where designed (briefing shows NOC incidents via existing feeds; tours
  offer works from cockpit; mobile approval cards carry rationale).
