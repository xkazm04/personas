# Ambiguity Audit — Fix Wave 2: Silent failure / lying state

> 6 commits, 6 critical findings closed. 1 already-fixed (sticky-throttle, prior wave).
> Baseline preserved: tsc 0 errors → 0 errors; vitest 241 passed → 241 passed.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `d3408198` | `health-validation-network.md` #6 | critical | `stores/slices/agents/healthCheckSlice.ts` |
| 2 | `f0c81fe5` | `agent-editor-configuration.md` #1 | critical | `features/agents/sub_editor/libs/EditorDocument.tsx` |
| 3 | (already-fixed) | `recipes-pipelines.md` #2 (sticky throttle) | critical | (no commit — was fixed in `0125fe5c` wave-8a) |
| 4 | `65a7fbb9` | `settings.md` #3 (BYOM open-access default) | critical | `features/settings/sub_byom/libs/useByomSettings.ts` |
| 5 | `d4cae50a` | `settings.md` #12 (config panel fake loading) | critical | `features/settings/sub_config/components/ConfigResolutionPanel.tsx` |
| 6 | `5b8e2442` | `deployment-sharing-plugins.md` #1 (clipboard wipe) | critical | `features/sharing/components/BundleExportDialog.tsx` |
| 7 | `ee14244d` | `persona-templates-catalog.md` #1 (dead index) | critical | `lib/personas/templateIndex.ts` (deleted), `scripts/generate-template-index.mjs` (deleted) |

## What was fixed (grouped by sub-pattern)

1. **Empty `catch{}` violating own policy doc.** `useHealthCheck.ts:1-22` documents the rule for best-effort sub-checks: route through `silentCatch` for a Sentry breadcrumb, return a partial-status check with an info-severity issue noting the gap, never silently disappear. `healthCheckSlice.checkSinglePersona` did exactly the opposite — empty `catch {}` returning `null`, which made the failing persona vanish from the digest entirely. Replaced with a policy-compliant handler: `silentCatch` for the breadcrumb, return a `partial`-status `PersonaHealthCheck` whose issues array contains one info-severity entry naming the failure. The persona now appears in the digest with a visible "score is incomplete" signal. Function return type narrowed from `PersonaHealthCheck | null` to `PersonaHealthCheck` since the handler now always produces a value.

2. **`saveAll` fabricating an "all saved" toast for tabs without save callbacks.** When `saveAll` iterated dirty tabs and found one whose `saveMap` entry was missing, it pushed the tab to `savedTabs` and cleared its dirty flag without calling any IPC. The user saw "all saved" while the tab's edits were never persisted. Replaced the `if (!save) { savedTabs.push(...); dirtyMap.set(tab, false); continue }` block with a failure path that mirrors the existing catch block: log the missing wiring loudly, throw `TabSaveError` listing this tab as failed, leave the dirty flag intact. A dirty tab without a save callback is almost always a programmer bug; the new behavior surfaces it.

3. **Sticky-true throttle (already-fixed in tree).** The audit's `recipes-pipelines.md #2` claim about `entry.queueDepth > 0 || prev.isThrottled` was stale — `commit 0125fe5c` (a prior fix wave) already replaced the formula with `entry.queueDepth > 0 || entry.cooldownUntil > Date.now()` and added an inline comment explicitly explaining the prior sticky-true bug. No code change needed; recorded as an already-existed catch.

4. **BYOM falling back to open-access default on transient load failures.** `useByomSettings`'s mount effect surfaced the load error via `corruptPolicyError` but the in-memory `policy` state stayed as `defaultPolicy()` (empty allow-lists, enabled:false, no routing/compliance rules). `handleSave` had no gate, so a user clicking Save before reading the corrupt-error banner would `setByomPolicy` the empty default — silently overwriting whatever strict policy was on disk. Since BYOM controls which providers see persona secrets, this is a security boundary regression. Added a refusal gate at the top of `handleSave`: if `!loaded || corruptPolicyError !== null`, surface a toast naming the failure and return without writing. The user must reload the panel (retrying the load) before any write is permitted.

5. **`ConfigResolutionPanel` rendering failures as loading skeletons.** When `Promise.allSettled` returned `rejected` for a persona, the row's `config` was `null` and `loading` was `false` — but the cell-render branch `if (row.loading || !row.config)` collapsed both states into the same `animate-pulse` skeleton. The panel exposes which model+budget+turns each persona will use, so a silent failure here mislead the user about effective configuration. Added `error: string | null` to `PersonaRow`, populate it from the rejection reason, and split the cell render into three branches: `loading` → skeleton (existing); `error/!config` → first cell renders "Failed to resolve" with an `AlertTriangle` icon and the failure reason in `title=`, subsequent cells render an em-dash; happy path → unchanged.

6. **Clipboard auto-clear silently leaving a secret behind.** `scheduleSensitiveClipboardClear` waited 30s, attempted to read the clipboard, and only overwrote it if the contents still matched the original payload. The catch block had no body and a comment "skip wipe". On Tauri/Windows the read can fail intermittently (permission/focus), and on those failures the secret bundle bytes or share-link tokens stayed in the OS clipboard indefinitely. The original "don't trample a verified-different later copy" guard is correct on the success path, but on the read-fail branch security must win: an exfiltrated secret cannot be undone, while a benign re-copy is trivial. Force-wipe in the read-fail branch, log the read failure as a warn breadcrumb, and log a separate error if the write also fails.

7. **Dead `templateIndex.ts` masquerading as canonical.** The file's "DO NOT EDIT MANUALLY" header and exported `allTemplates: any[]` looked authoritative — but it mixed translation overlay siblings (`.ar.json`, `.bn.json`, …) with canonical English templates as if both were first-class catalog entries. The actual loader (`templateCatalog.ts`) uses a Vite glob that filters overlays via `isOverlayFilename`. A repo-wide search for `from '...templateIndex'` returned zero matches, but a future dev repointing to it would silently double-count templates and broadcast translation overlays as standalone personas. Deleted the file together with `scripts/generate-template-index.mjs` (which produced it). The generator was not wired into package.json or CI; its only output was the unconsumed index, so removing both eliminates the trap and any future regeneration of the same misleading file.

## Verification table (before / after)

| Counter | Before Wave 2 | After Wave 2 |
|---|---:|---:|
| `tsc --noEmit` errors | 0 | 0 |
| Tests passing (stores + agents + settings + sharing) | 241 / 241 | 241 / 241 |
| Empty `catch {}` blocks violating policy doc | 1 | 0 |
| `saveAll` paths that mark dirty clean without saving | 1 | 0 |
| BYOM save paths that can overwrite with empty default | 1 | 0 |
| Panel UI states where failure renders as "still loading" | 1 | 0 |
| Sensitive-clipboard read-fail branches that skip wipe | 1 | 0 |
| Dead generated files masquerading as canonical | 1 | 0 |

## Cumulative status (waves so far)

| Wave | Theme | Findings closed | Commits | Lines net |
|---|---|---:|---:|---:|
| 1 | Two-X-coexist (libs/ duplicates) | 3 critical | 3 | +123 / -148 |
| 2 | Silent failure / lying state | 6 critical (+ 1 already-fixed) | 6 + 1 docs | +114 / -342 |
| 3 | Cross-entity scoping | (pending) | — | — |

## Patterns established (additions to the catalogue, items 4-9)

4. **Empty `catch {}` is never acceptable for "best-effort" sub-checks** — when one sub-check failing must not invalidate the whole, route the error through `silentCatch` for a Sentry breadcrumb, return a partial-status result with an info-severity issue naming the gap, never make the entity vanish. Documented policies must be enforced one file over from where they are written.

5. **Don't fabricate clean state to make a toast happy** — if `saveAll` (or any aggregate persistence operation) finds a dirty entity that *cannot* be persisted (no save callback, no resolver, etc.), treat that as a save failure. Throwing is louder than lying.

6. **Refuse writes when reads failed** — for any settings hook that loads-then-edits-then-saves, gate the save path on the load succeeding. A transient load error that silently shows `defaultState()` and then accepts a Save can wipe load-bearing on-disk state. Distinguish "loaded successfully" from "still loading" from "load failed" in the hook's exported flags, and gate save on the first.

7. **Failure UI must be visually distinct from loading UI** — a `null`/`undefined` value that means "we tried and failed" must NOT render the same skeleton/spinner that "still loading" renders. The user's mental model of "this is making progress" outlives the actual progress. Add an explicit `error` field, render an `AlertTriangle` or similar with `title=reason`.

8. **Verify-then-wipe is wrong for sensitive payloads on read-fail** — when the verify step itself fails, fall back to unconditional wipe rather than skipping. Security beats preserving an unverifiable later state. Pair with a warn-level breadcrumb so the failure is visible.

9. **Auto-generated files that aren't consumed are a trap, not a tool** — delete the generator alongside the output. A "DO NOT EDIT MANUALLY" header on an unimported file is exactly the shape that lures a future dev into pointing at it.

## What remains

- **Wave 3** (Cross-entity scoping) — 4 fixes: `enrichProcess` ignores `runId`, `pickNextActiveSessionId` ignores `personaId`, experiment poll vs. realtime race, `hydrateBuildSession` discards lifecycle fields.
- **Out of scope this session** — themes D (validation gates), E (state/cache invalidation), F (sanitization & cross-boundary contracts). Findings remain documented in the per-context reports.
- **Out-of-wave-2 deferrals (lower priority criticals from theme B)** — `agent-lab-matrix-builder.md #3` (`hydrateBuildSession` discards) is also classified under Theme B but moves to Wave 3 because its fix overlaps the scoping concerns. `recipes-pipelines.md #10` (pipeline events dropped on team mismatch) and `deployment-sharing-plugins.md #2` (`dangerConfirmed` shared between distinct danger paths) remain open from Theme B; they were prioritized below the 7 fixes done this wave.
