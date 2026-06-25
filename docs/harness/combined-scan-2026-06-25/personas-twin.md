# Personas Twin — Combined Scan (ambiguity-guardian + bug-hunter)
> Context: personas-twin | Group: First-Party Plugins
> Total: 5 | Critical: 0 | High: 1 | Medium: 2 | Low: 2

## 1. Brain milestone can never be `'empty'` — auto-generated `obsidian_subpath` permanently inflates every twin's readiness
- **Severity**: High
- **Lens**: ambiguity-guardian
- **Category**: readiness-correctness / undocumented-threshold
- **File**: src/features/plugins/twin/useTwinReadiness.ts:75-77 (root cause cross-refs src-tauri/src/db/repos/twin.rs:139)
- **Scenario**: Create any twin through the normal wizard. `create_profile` always writes `obsidian_subpath = "personas/twins/{slug}"` (twin.rs:138-139); the column is never null for a real twin. In `deriveReadiness`, `brain` is `'complete'` only with a bound KB, otherwise `'partial'` when `obsidian_subpath` is non-empty, else `'empty'`. Because the subpath is always populated, the brain milestone is **never** `'empty'` for any backend-created twin — a brand-new twin with zero brain setup shows brain as amber "partial / in progress".
- **Root cause**: The readiness model treats "has an obsidian_subpath" as a signal that the user started brain configuration, but the subpath is an auto-derived default folder name set at creation, not a user action. The unit test only passes the brain-empty case because its fixture forces `obsidian_subpath: ''` (useTwinReadiness.test.ts:23), which no production row ever has — so the divergence is masked.
- **Impact**: Permanent, universal wrong readiness: every twin's score is inflated by ~8 points (`0.5/6` rounded) regardless of brain setup; the brain dot in `TwinReadinessRibbon` is never grey; `buildGaps` never emits the severity-1 `brainEmpty` gap, so the gap popover/next-step nudge tells users they are "in progress" on a brain they never touched and under-prioritises it.
- **Fix sketch**: Don't treat the default subpath as progress. Gate brain `'partial'` on a real signal (KB bound = complete; ingested docs / a non-default subpath / pending-KB state = partial; otherwise empty). Simplest: require `knowledge_base_id` for complete and some actual brain artifact for partial, and update the fixture to use a realistic non-empty subpath so the test reflects production.
- **Value**: impact=6 effort=3

## 2. Readiness surfaces show `0` / all-empty during the per-twin hydration window — no "loading" vs "empty" distinction
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition / stale-readiness
- **File**: src/features/plugins/twin/useTwinReadiness.ts:142-152 (doc at 55-61: "treated as empty")
- **Scenario**: Switch the active twin (or first-load the Twin page). `useHydrateActiveTwin` fires the tones/channels/voice/approved-memories fetches asynchronously. Until they land, the store slices still hold the *previous* twin's rows, which the hook filters out by `twin_id` (lines 147-150) → `scopedTones/Channels/Memories/Voice` are all empty. So a fully-configured twin transiently renders score `0`, all-grey milestone dots, and `ReadinessGapPopover` lists every milestone as a gap; `ProfilesAtelier` shows the dashboard at 0%.
- **Root cause**: `deriveReadiness` has no loading flag — "not yet fetched" and "genuinely unconfigured" are indistinguishable, by documented design. The codebase already knows this ramp is real: `useReadinessCelebration` hard-codes a 2.5s `HYDRATION_WINDOW_MS` to suppress it, but the ribbon/popover/dashboard have no equivalent guard.
- **Impact**: Wrong readiness shown on every twin switch and initial load (self-correcting in <2.5s). Misleading deep-link nudges ("set up Voice", "add a Brain") for layers that are actually configured; jarring 0%→real flicker.
- **Fix sketch**: Thread per-layer loading flags (already in the store: `twinTonesLoading`, etc.) into the hook and return a `loading` boolean, or have the surfaces render a skeleton/neutral state while `activeTwinId` has fetches in flight, instead of rendering derived-from-empty readiness.
- **Value**: impact=5 effort=4

## 3. `record_interaction` silently swallows pending-memory creation failure (`let _ = …`)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / dropped-data
- **File**: src-tauri/src/db/repos/twin.rs:598-606
- **Scenario**: A caller records an interaction with `create_memory = true` (the channels/outbox approve path). If `create_pending_memory` fails (DB lock/`SQLITE_BUSY`, transient I/O), the result is discarded via `let _ = create_pending_memory(...)`. `record_interaction` still returns `Ok(communication)`, so the caller and UI believe a review item was queued.
- **Root cause**: Fire-and-forget on a write whose whole purpose is to enqueue a human-review row. The error is neither propagated nor logged.
- **Impact**: A memory the user expected to review never appears, with no error surfaced. Because approved memories feed the `memories` readiness milestone, a swallowed insert also silently undercounts readiness. Low frequency but data-loss-shaped and invisible.
- **Fix sketch**: Capture the result and at minimum log on error (`if let Err(e) = create_pending_memory(...) { log/return }`); ideally run the communication insert + memory insert in one transaction so the promised review row is atomic with the interaction, or propagate the error so the caller can retry/surface it.
- **Value**: impact=5 effort=3

## 4. `counts.memoriesPending` is structurally always `0` in production — advertised as renderable, masked by the unit test
- **Severity**: Low
- **Lens**: ambiguity-guardian
- **Category**: misleading-API / dead-value
- **File**: src/features/plugins/twin/useTwinReadiness.ts:91 + 137-149 (source: twinSlice.ts:507-510)
- **Scenario**: The `useTwinReadiness` hook feeds `twinReadinessApproved` into `deriveReadiness`. That slice is fetched with `listPendingMemories(twinId, 'approved')` (twinSlice.ts:509) — approved rows only. `deriveReadiness` then computes `memoriesPending = memories.filter(m => m.status === 'pending').length`, which over an approved-only corpus is always `0`. The `TwinReadiness.counts` doc (line 31-39) advertises these counts as "safe to render in tooltips/chips."
- **Root cause**: The integration (hook → approved-only source) contradicts the pure function's assumption that it receives a mixed-status corpus. The test `useTwinReadiness.test.ts:199` asserts `memoriesPending === 2`, but only by passing a hand-built mixed array to the pure function — so the always-0 production behaviour is never exercised.
- **Impact**: Currently only consumed in tests (no production UI reads `memoriesPending`), so it is a latent trap: the next developer who renders "N pending review" from `readiness.counts.memoriesPending` will always display 0 even when a review backlog exists. Misleading contract.
- **Fix sketch**: Either drop `memoriesPending` from `counts` (and the doc) since the readiness corpus is approved-only, or compute it from the real pending source rather than the approved slice. At minimum, annotate that this field is always 0 under the current hook wiring.
- **Value**: impact=3 effort=2

## 5. TwinPicker: stale `highlightIdx` after the list reorders/shrinks while open → Enter activates a different twin than the one highlighted
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: picker-desync (currently latent — component is unwired)
- **File**: src/features/plugins/twin/shared/TwinPicker.tsx:130-132, 172-179
- **Scenario**: Open the picker, arrow-down to highlight the row at index 2. While it is open, `profiles` updates — e.g. `fetchTwinProfiles({ force: true })` after a mutation, or the 10s freshness refetch returns rows reordered because another twin's `updated_at` bumped (the `recency` sort at lines 117-124 reshuffles). `ordered`/`filtered` recompute but `highlightIdx` is only reset on `[query, open]` (line 132), not on list change. Pressing Enter selects `filtered[highlightIdx]` (line 174) — now a *different* twin than the one visually highlighted.
- **Root cause**: The highlight index is a positional pointer into a list that can change identity underneath it without a reset. (Note: `TwinPicker` is not currently rendered anywhere — the `TwinSelector` it documents replacing no longer exists — so impact is latent until it is wired in.)
- **Impact**: When wired, an Enter keypress can activate the wrong twin (a real "selects a stale twin" desync); every downstream surface then reflects the wrong active twin. Today: dead-code-latent only.
- **Fix sketch**: Track the highlight by twin id rather than index, or reset/clamp `highlightIdx` whenever `filtered` identity changes (add `filtered` to the reset effect deps and re-find the previously highlighted id). Also prune deleted ids from the pinned localStorage set while iterating.
- **Value**: impact=4 effort=3
