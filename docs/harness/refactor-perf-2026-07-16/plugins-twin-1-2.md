# plugins/twin [1/2] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 6 findings (0 critical / 0 high / 5 medium / 1 low)
> Context group: Plugins & Companion | Files read: 34 | Missing: 0

## 1. `Stat` KPI micro-component duplicated byte-for-byte in 6 atelier files (plus 2 drifted variants)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/twin/sub_training/TrainingAtelier.tsx:511
- **Scenario**: The identical `function Stat({ label, value, accent })` (violet/emerald/amber tone map + typo-data-lg stack) is defined locally in TrainingAtelier.tsx:511, KnowledgeAtelier.tsx:496, ToneAtelier.tsx:426, ChannelsAtelier.tsx:390, IdentityAtelier.tsx:325 and BrainAtelier.tsx:325. ProfilesAtelier's `KpiCell` (line 344) and ToneConsole's `Tile` (line 259) are near-identical siblings that have already drifted (different border treatment, ACCENT_TEXT record vs ternary).
- **Root cause**: Each atelier page was authored as a standalone design pass and copied its header KPI cell instead of extracting it; the shared/ directory already exists for exactly this (TwinHeaderBand, decorations).
- **Impact**: 8 copies of one presentational contract — any accent/typography change (e.g. a design-token migration) must be applied 8 times, and this module's own history (channels.ts header comment: 7-way channel-meta dup broke credential matching) shows these copies drift into real bugs.
- **Fix sketch**: Add `shared/Stat.tsx` exporting the 6-line component (accent: 'violet' | 'emerald' | 'amber'), replace the six local definitions with the import, and fold `KpiCell` into it (it is the same signature). Leave ToneConsole's `Tile` if its bordered-tile look is intentional, otherwise parameterize with a `bordered` prop.

## 2. Four dead decoration exports while three ateliers inline byte-identical copies of the same SVGs
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: dead-code
- **File**: src/features/plugins/twin/shared/decorations.tsx:33
- **Scenario**: `ManuscriptDecoration`, `WaveformDecoration`, `ArchiveDecoration`, and `AntennaDecoration` have zero importers anywhere under src/ (verified by grep; only `ConstellationDecoration` and `BrainDecoration` are used). Meanwhile ToneAtelier.tsx:211-214 inlines the exact waveform paths of `WaveformDecoration`, KnowledgeAtelier.tsx:210-220 inlines the library-shelf SVG of `ArchiveDecoration`, and ChannelsAtelier.tsx:143-155 inlines the broadcast-ring SVG of `AntennaDecoration` — each inside a hand-rolled header band instead of `TwinHeaderBand`.
- **Root cause**: decorations.tsx was built as the shared header-decoration kit, but Tone/Knowledge/Channels ateliers kept bespoke header markup (they need palette-reactive gradients TwinHeaderBand doesn't offer), so the extracted components were never wired and the SVGs were copied inline instead.
- **Impact**: ~90 lines of unreachable exports plus three divergent copies of the same artwork; a visual tweak to a decoration now silently fixes only one of two copies.
- **Fix sketch**: Replace the three inline SVG blocks with `<WaveformDecoration />` / `<ArchiveDecoration />` / `<AntennaDecoration />` (the inline versions differ only in a wrapping `opacity-*` div, which each caller already provides). Delete `ManuscriptDecoration` if IdentityAtelier's manuscript header is intentionally decoration-free, or wire it there too. Cross-context check: grep confirmed no other importers in the repo's src tree.

## 3. Tone form plumbing (`ToneForm`/`EMPTY`/`toneToForm` + save/delete/hydrate) triplicated across the three tone variants
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src/features/plugins/twin/sub_tone/ToneAtelier.tsx:45
- **Scenario**: ToneAtelier.tsx:45-49, ToneConsole.tsx:28-32, and ToneBaseline.tsx:24-28 each define the identical `ToneForm` interface, `EMPTY` constant, and `toneToForm()` mapper, then each re-implement the same `forms` state, tones→forms hydration effect, `getForm`/`setForm`, `handleSave` (upsertTwinTone with identical trim-or-null argument shaping), and `handleDelete` (find tone → `confirm()` → delete → prune form).
- **Root cause**: The A/B variant experiment (TwinVariantTabs keeps all three mounted-able) copied the state machine per variant; the same experiment already extracted `useBrainConnection` for the Brain variants ("was previously duplicated byte-for-byte across all three files — drift is the predictable failure mode") but the tone twin of that hook was never made.
- **Impact**: ~60 LOC × 3 of behavior-bearing code (not just markup); a fix to the save argument shaping or the delete-confirm flow must land three times, and the variants are exactly the surfaces the user diff-tests against each other.
- **Fix sketch**: Extract `sub_tone/useToneForms.ts` returning `{ getForm, setForm, hasTone, handleSave, savingChannel, handleDelete, isLoading }`, mirroring `useBrainConnection`. Each variant keeps only its rendering. This also gives the delete-confirm a single place to later swap `window.confirm` for the app's `ConfirmDialog`.

## 4. Profiles grid fires 3 unbatched IPC calls per twin (3N fan-out) to derive readiness chips
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: n-plus-one
- **File**: src/features/plugins/twin/useProfileDashboards.ts:55
- **Scenario**: Opening the Profiles tab runs `loadOne` for every twin, each issuing `listTones` + `listChannels` + `listPendingMemories(approved)` as separate Tauri IPC round-trips into rusqlite — 30 IPC calls for a 10-twin roster, all launched in the same tick, plus one `setData` state churn per profile (N re-renders of the whole grid while loading).
- **Root cause**: The per-twin dashboard was built on the existing single-twin commands; no batch command exists that returns tones/channels/approved-counts for a list of twin ids.
- **Impact**: Profiles is the landing surface of the plugin; with a growing roster the tab pays N×3 serialization/deserialization plus N sequential grid re-renders. Readiness needs only counts, yet `listPendingMemories` ships full memory bodies per twin.
- **Fix sketch**: Add one Rust command (e.g. `twin_dashboard_summaries(twin_ids)`) that runs three GROUP BY twin_id aggregate queries and returns per-twin counts + channel types; deriveReadiness already only consumes counts for tone/channels/memories (identity comes from the profile row). Alternatively, keep the commands but coalesce the N `setData` calls into one after `Promise.allSettled` over all profiles.

## 5. Typing a reject note re-renders the entire Knowledge atelier: 200-element header SVG plus every animated memory card per keystroke
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:74
- **Scenario**: `rejectNote`, `rejectPreset`, and `rejectingId` live at the top of KnowledgeAtelier, so each keystroke in the inline reject textarea re-renders the whole page: the decorative shelf SVG (5 rows × 40 `<rect>` = 200 elements rebuilt at line 210-220), the full memory timeline (each a `motion.li`), and the conversations column. Framer-motion re-evaluates animate props on every card.
- **Root cause**: The reject-reason picker was added inline under the memory card (good UX) but its draft state was hoisted to the page component instead of a child component scoped to the card being rejected.
- **Impact**: Visible input latency risk on the exact hot path the feature is for (reviewing a backlog of memories, where the list is longest); the 200-rect SVG and N motion cards are pure waste per keystroke.
- **Fix sketch**: Extract the AnimatePresence block (lines ~368-417) into a `RejectReasonForm` child that owns `rejectPreset`/`rejectNote` locally and calls back with the composed reason on confirm; keep only `rejectingId` in the parent. Optionally wrap the header band (static per twin) in a memoized component.

## 6. TrainingAtelier recomputes topic-impact scoring and coverage maps on every keystroke
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: rerender
- **File**: src/features/plugins/twin/sub_training/TrainingAtelier.tsx:110
- **Scenario**: `sessionImpact = scoreTopicTexts(...)` (6 presets × ~10 keywords substring-scanned over all saved Q&A texts), `coverageById = new Map(...)` (line 96), and the `recommendedId` sort (line 102-105) run in the component body with no memoization. The component re-renders on every `answerDraft` keystroke because `useTrainingSession` state lives here, so all three recompute per keypress during the interview phase — even though `sessionImpact` is only rendered in the 'complete' phase and `coverageById`/`recommendedId` only in the 'topic' phase.
- **Root cause**: Derived values were written as plain render-body expressions; phase-gating happens only at JSX level, after the work is done.
- **Impact**: Bounded (≤ ~10 questions × 60 keyword scans per keystroke) — real waste but unlikely to be felt; it compounds with the autosizing textarea handler on the same keystroke path.
- **Fix sketch**: Wrap each in `useMemo` keyed on `session.questions` / `session.topicCoverage` / `session.groundingFacts.length`, or compute them lazily inside the phase-specific JSX branches (e.g. move `sessionImpact` into a small `SessionImpact` component rendered only in the complete phase).
