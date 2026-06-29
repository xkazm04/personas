# Combined-Scan Fix Wave 14 — Plugins / FE tail

> 6 atomic fix-commits, 6 findings closed (all High) — no deferrals (persona-templates full questionnaire→apply wiring noted as a follow-up; the schema-filter fix is complete on its own).
> Mixed stack (2 Rust, 4 FE). Baseline preserved: **tsc 0; vitest 1988 pass / 7 pre-existing fail (no regressions); cargo team_preset_loader 9/0, artist 28/0 + full compile**. No ts-rs binding drift.

## Commits

| # | Commit | Finding | Stack |
|---|---|---|---|
| 1 | `b1e11adc9` | artist #1 (deleted-asset file leak) | Rust |
| 2 | `5f0f5c4ff` | artist #2 (blob-cache OOM) | FE |
| 3 | `b64f43ea7` | google-drive IPC-loop | FE |
| 4 | `1a68c404b` | design-reviews crash | FE |
| 5 | `3b198e658` | persona-templates questionnaire | Rust |
| 6 | `2e5902e9a` | personas-twin milestone | FE |

## What was fixed

1. **Deleted assets leaked their files forever.** `artist_delete_asset` removed only the DB row, so every deleted image/3D asset's file stayed under `~/Personas` indefinitely, and deleting a non-existent id silently "succeeded". Now it fetches the row, root-validates the stored path is inside the managed Artist directory, removes the file (ignoring `NotFound`) **before** the DB delete, and returns `Err(NotFound)` for an unknown id.
2. **Gallery blob cache grew until the renderer OOM'd.** `useLocalImage` cached decoded object URLs in an unbounded map that never released, so a long gallery browse held every thumbnail it ever decoded. Now a ~96 MB byte-budget cache with refcount-aware unmount eviction; the hook's public API is unchanged.
3. **Open Drive column = infinite `drive_list` IPC loop.** `AsyncColumnEntries`'s effect depended on the whole `props` object (a fresh reference every render), so each `drive_list` result triggered the next call — a tight loop pinning a CPU core. Narrowed deps to the stable `[props.path, props.cachedEntriesFor]`.
4. **A null `activeFlow.nodes` crashed the whole reviews page.** `ActivityDiagramModal` read `activeFlow.nodes` directly; a review whose flow lacked a nodes array threw and blanked `DesignReviewsPage`. Now `?? []` + an `Array.isArray` guard, and the modal is wrapped in an `ErrorBoundary` so a malformed flow degrades to an inline error instead of unmounting the page.
5. **Questionnaire asked for inputs that went nowhere.** `get_adoption_schema` returned every adoption question, including ones no preset parameter or codebase pin ever consumes. Added `is_consumed_adoption_question` and filtered the schema to parameter-mapped + codebase-pin questions only (+3 tests). The full questionnaire→apply pipeline wiring is a separate follow-up; the schema no longer advertises dead inputs.
6. **Brain milestone credited a default vault path.** `useTwinReadiness` marked the brain step `partial` whenever `obsidian_subpath` was set — but it's seeded to the default `personas/twins/<slug>` at creation, so a twin that never configured a real vault showed progress. Now `partial` requires `obsidian_subpath` to differ from that default; the fixture uses the production default so the test reflects real state.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 |
| `vitest run` | 1988 pass / 7 pre-existing fail (no regressions) |
| cargo (team_preset_loader / artist) | 9/0 · 28/0 + full compile |
| ts-rs bindings | no drift |

## Pattern catalogue (items 41–43)

41. **Delete the row, leak the file** — a delete command that drops the DB record but not the managed on-disk artifact leaks storage forever and lets a bogus id report success. Fetch-then-validate-path-then-remove-file before the row delete, and return NotFound for an unknown id.
42. **Unbounded decode cache on a glanceable surface** — caching decoded blobs/object URLs without a budget or eviction grows until the renderer OOMs on a long session. Bound by bytes with refcount-aware eviction; keep the API the same.
43. **Effect depending on a fresh-every-render object** — listing the whole `props` (or any new-identity value) in a deps array that the effect itself re-triggers makes a self-perpetuating IPC/fetch loop. Depend on the stable primitive fields only.

## Cumulative status (Waves 1–14)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–13 | security → backend orchestration | 74 (6C/68H, 2C mitigated) |
| 14 | Plugins / FE tail | 6 (6H) |

**Total: 80 findings addressed across ~96 commits, 0 regressions** (+1 pre-existing Rust test fixed in W13). 6/6 scan Criticals fixed-or-mitigated; **74 of 81 Highs closed.**
**Remaining: ~7 High** for a final wave — capabilities budget UI/server, google-drive sandbox-not-real-Drive, i18n RTL never applied, recipes suggestion threshold 0.90 unreachable, state-mgmt design-context selector ref-stability, tauri-ipc TwinChannelKind enum drift, tauri-ipc orphaned mutation on timeout. Next: Wave 15 — final High tail.
