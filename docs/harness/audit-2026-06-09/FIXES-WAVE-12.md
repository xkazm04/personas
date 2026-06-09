# Audit Fix Wave 12 — Duplicated component markup (Tier-3 highs, low-risk subset)

> 3 commits, 3 of the 14 component-extraction highs closed — the **"consume the existing shared primitive / delete the dead fork"** subset. The 11 remaining are genuine multi-file refactors with visual-shift or new-primitive risk; documented and deferred to focused sessions with visual QA.
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors.
> Branch: `vibeman/audit-2026-06-09`.

## Why a subset

Component-extraction is the highest-regression theme in the audit: most findings ask for a *new* shared primitive plus rewiring 3-4 call sites, or migrating hand-rolled controls to a shared `<Button>`/`<StatusBadge>` whose padding/radius/loading behavior differs (an intended but visible shift that wants visual QA). Rather than rush those at scale, this wave takes the three that are **provably safe**: two that swap a hand-roll for a primitive that already exists (and that this audit already touched), and one that deletes a confirmed-dead duplicate. The rest are catalogued below with concrete sketches.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `0bae92123` | dev-ideas #2 — effort/impact/risk pill re-inlined in SwipeCard | `plugins/dev-tools/sub_triage/IdeaTriagePage.tsx` |
| `4ad18c8fa` | triggers #3 — webhook copy controls re-implement CopyButton | `triggers/sub_cloud_webhooks/CloudWebhooksTab.tsx` |
| `ed2b51410` | events-messages #2 — dead duplicate config with divergent colors | `overview/sub_messages/messageListConstants.ts` (deleted) |

## What was fixed

1. **dev-ideas #2** — `SwipeCard` re-inlined the effort/impact/risk pill (`levelColor` + raw `<span>` loop) instead of the exported `LevelBadge`, so it drifted from the scanner card and missed the `low/med/high` severity cue added in Wave 10. Now consumes `LevelBadge`; both surfaces share one badge. Dropped the now-unused `levelColor` import.
2. **triggers #3** — Cloud Webhooks hand-rolled two copy controls (URL icon button + Secret text toggle) with their own copied-state flash, while the sibling Smee tab uses the shared `<CopyButton>`. Replaced both with `CopyButton` in **managed mode** (`copied`/`onCopy` preserve the row's existing `copiedId` state); the labeled variant covers the secret. Dropped the orphaned `Copy`/`Check` imports.
3. **events-messages #2** — `messageListConstants.ts` was a stale fork of `libs/messageHelpers.ts` defining `priorityConfig`/`deliveryStatusConfig` with **divergent** values (e.g. `delivered` = `text-status-success` vs `text-emerald-400`), imported nowhere in `src/`. Deleted it so `messageHelpers.ts` is the single source of truth.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors |
| `cargo check` | n/a (no Rust this wave) |

## Deferred (11 of 14 — need a focused refactor pass + visual QA)

- **templates #2 + #3 — n8n wizard → shared `<Button>`.** ~8 hand-rolled buttons across `N8nWizardFooter.tsx` + `N8nUploadStep.tsx` with state-dependent variant/loading (Test Persona has 4 states; the primary CTA toggles emerald/violet + spinner). `<Button variant="accent" accentColor=… loading=…>` covers all of them and fixes the missing focus rings (#3) for free, but the padding/radius shift wants a visual pass. One file, one sitting.
- **execution-engine #3 — extract `ExecutionStatusBadge`.** The badge is already shared *within* `ExecutionListRow` (computed once, used in desktop + mobile); the cross-file consumer the report named (`ExecutionSummaryCard.tsx`) **no longer exists**, so extraction has little remaining value until a second real consumer appears.
- **New-primitive extractions** (each = create component + rewire N sites): companion #4 (`CompanionActionButton`/`NumberedChip`, 4 components), reviews #5 (`DecisionRow`/`DecisionToolbar`/`DecisionSummary`, 2 entry points), research-lab #3 (source/finding/hypothesis cards), persona-chat #3 (bubble/avatar ×4), persona-use-cases #2 (subscription row ×3), agent-memories #4 (memory page sub-components), onboarding #3 (`cockpit` card shell), overview #2 (chart-card primitive), settings/byom #5 (`SettingsCard`/`StatusActionButton`), mcp #2 (`QueryOutput`).
- **Orphaned/uncertain:** composition #3 (node `StatusBadge`) targets the `sub_canvas` ReactFlow surface, which is **unmounted dead UI** (see Wave 8 deferral) — skip until the canvas is wired in. p2p #2 (trust-badge) is on the p2p network surface and pairs with the deferred p2p #1 handshake work.

## Patterns reinforced (catalogue, continued)

44. **Prefer "consume the existing primitive" over "extract a new one."** The lowest-risk dedup is swapping a hand-roll for a shared component that already ships (`LevelBadge`, `CopyButton`, `Button`, `EmptyState`). Grep for the primitive before writing or extracting one.
45. **`CopyButton` managed mode preserves external copy state.** Pass `copied` + `onCopy` (instead of `text`) to keep a row's existing `useKeyedCopyFlag` state and any side effects, while still unifying the visual/affordance. Wrap in a `stopPropagation` span when the parent row is itself clickable.
46. **A dead duplicate is the safest dedup — verify, then delete.** Grep the symbol/filename across `src/`; zero references means it's a latent drift trap (a maintainer edits the obvious-named file and sees nothing change). Delete it rather than reconciling.
47. **Reconcile the report against reality before extracting.** A named cross-file consumer (`ExecutionSummaryCard`) may have been deleted since the scan — if the duplication is gone, so is the reason to extract. Confirm the second site exists first.

## Cumulative status

| Tier | Waves | Theme | Closed |
|---|---|---|---|
| 1 | 1–6 | Reliability criticals | 33/41 C |
| 2 | 7–9 | UI criticals | 16/19 C |
| 3 | 10 | Color-only status | 5/6 H |
| 3 | 11 | Programmatic labeling | 6/6 H |
| 3 | 12 | Duplicated markup (low-risk subset) | 3/14 H |
| | | **Criticals fixed** | **49** |
| | | **Highs fixed (Tier-3)** | **14** |

Tier-3 remaining: ~155 highs (incl. 11 deferred component-extractions that want a focused refactor pass). Other clean themes still open: keyboard-reachability a11y (~5), error-blind/missing-state highs (~10), hardcoded-i18n (~10), token/contrast drift (~15).
