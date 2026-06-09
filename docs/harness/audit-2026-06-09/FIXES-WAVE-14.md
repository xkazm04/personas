# Audit Fix Wave 14 — Error-blind / missing-state highs, cont. (Tier-3)

> 2 commits, 2 more missing-state highs closed (continuing Wave 13). These needed a hook/data field surfaced, not just a flag threaded.
> Baseline preserved: `tsc --noEmit` 0; eslint 0 errors.
> Branch: `vibeman/audit-2026-06-09`.

## Commits

| Commit | Finding | Files |
|---|---|---|
| `8dc44b6d2` | creative #2 — artist gallery has no error state | `plugins/artist/hooks/useArtistAssets.ts`, `plugins/artist/sub_gallery/GalleryPage.tsx` |
| `e221bad7d` | lab #1 — scenario matrix blind to per-cell run status | `agents/sub_lab/components/arena/ArenaResultsView.tsx` |

## What was fixed

1. **creative #2** — a failed asset load was swallowed into a toast (`toastCatch`) and the gallery rendered the same "no images yet" empty state as a genuinely empty folder. Added an `error` field to `useArtistAssets` (set in the `loadAssets` catch, cleared on start/success, exposed alongside `loadAssets`) and an error + Retry card in `GalleryPage`, gated before the empty branch.
2. **lab #1** — the model-comparison matrix rendered a running, partial, or errored cell with the same score-style glyph as a completed low score, so the most comparison-critical surface conflated fail / low-score / in-progress. `LabArenaResult.status` was already on the data (just unused in the matrix); branch the cell: `running`/`queued`/`pending` → spinner + "running"; `failed`/`error` → `AlertTriangle` + `text-status-error` + a `bg-red-500/5` cell tint; `completed` → the existing score block. The cell stays clickable to open the detail panel in every state.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `eslint` (staged) | 0 errors (warnings only) |
| `cargo check` | n/a (no Rust this wave) |

## Remaining missing-state highs (~12)

- **settings/byom #3** (two-part) — `EngineSettings` only gates on `loaded`, sitting on "Detecting providers…" forever on a capability-detection failure (needs `useEngineCapabilities` to expose an `error`); and `ByomApiKeyManager`'s bulk key load does `.catch(() => ({}))`, swallowing a backend error into an empty-keys render (capture the error in state + show a banner; the render area + a hook change make this a focused two-file pass).
- **credential-vault #4** — `PickerGrid` needs a `loading` prop threaded from the connector-definitions resolver (CredentialPicker receives `connectors` as a prop; the loading flag lives further up).
- **deployment #3, evolution #1, onboarding #2, research-lab #6, test-suites #2, credential-recipes #1, persona-chat #2, triggers #2, companion #2, cloud-sync #2** — each a loading/error/verdict branch on its own surface; see the per-context reports.

## Patterns reinforced (catalogue, continued)

51. **Status is often already on the data.** `LabArenaResult.status` was fetched and threaded to the detail panel but never consulted in the matrix — the fix was a render branch, no new state or fetch. Before adding a flag, check whether the row already carries the verdict.
52. **`toastCatch` is not an error state.** A `.catch(toastCatch(...))` (or `.catch(() => ({}))`) fires a transient toast and leaves the surface looking empty/normal. For a surface where empty is meaningful, capture the error in component/hook state and render a persistent error+retry branch instead.

## Cumulative status

| Tier | Waves | Theme | Closed |
|---|---|---|---|
| 1 | 1–6 | Reliability criticals | 33/41 C |
| 2 | 7–9 | UI criticals | 16/19 C |
| 3 | 10 | Color-only status | 5/6 H |
| 3 | 11 | Programmatic labeling | 6/6 H |
| 3 | 12 | Duplicated markup (low-risk subset) | 3/14 H |
| 3 | 13–14 | Error-blind / missing-state | 5/17 H |
| | | **Criticals fixed** | **49** |
| | | **Highs fixed (Tier-3)** | **19** |

Tier-3 remaining: ~150 highs. Still-open themes: ~12 more missing-state, keyboard-reachability a11y (~5), 11 component-extractions (deferred), hardcoded-i18n (~10), token/contrast drift (~15), visual-hierarchy/consistency highs.
