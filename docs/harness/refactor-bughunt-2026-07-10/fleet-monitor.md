> Context: fleet/monitor
> Total: 10
> Critical: 0  High: 1  Medium: 3  Low: 6

## 1. Fabricated "Active goals" with fake progress shown as real data
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: success-theater
- **File**: src/features/fleet/monitor/triage/triageModel.ts:70-102, src/features/fleet/monitor/triage/MonitorProjectColumns.tsx:114,146-163
- **Scenario**: The default Monitor surface (`viewMode === 'fleet'`) renders `MonitorProjectColumns`, whose every team column shows an "Active goals" section with titles and progress bars. Those goals come from `mockGoalsForGroup(tm.id)` — a deterministic hash over the team id that picks 1–3 strings from a hardcoded `GOAL_POOL` and derives a bogus percentage (`(h >>> (i+2)) % 100`). Nothing is fetched. A user sees e.g. "Migrate billing to the new schema — 47%" presented identically to real UI, with no "placeholder"/"demo" affordance.
- **Root cause**: A round-1 prototype placeholder (`PLACEHOLDER — consolidation wires real DevGoals`) was shipped into the production default view instead of being gated or hidden until the team↔project map exists.
- **Impact**: Users make triage decisions against fabricated project state; erodes trust the moment the fiction is noticed. Data-integrity / UX.
- **Fix sketch**: Hide the "Active goals" block entirely until a real goals source is wired (render only `Needs attention`), or feed `col.goals` from the real DevGoals store keyed by dev project. Do not display mock progress to end users.

## 2. Live-overlay `dismissed` Set grows without bound over a long session
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: memory-leak
- **File**: src/features/fleet/monitor/live/LiveChannelOverlay.tsx:88-104,132-151
- **Scenario**: With live mode on for hours, each pop-up that auto-expires or is dismissed adds its id to `dismissed`. `incoming` is bounded (`slice(0, CAP=30)`) so old messages fall out of `incoming`, but their ids are never removed from `dismissed`. On a busy fleet the set accumulates one entry per channel item forever; it is only cleared when live mode is toggled off (the `!enabled` effect).
- **Root cause**: `dismissed` is used as a permanent tombstone set but is never pruned to the currently-live window; only `incoming` and the `seen` dedupe set (line 59) are bounded.
- **Impact**: Slow unbounded memory growth in a long-lived always-on overlay. Reliability.
- **Fix sketch**: After computing `live`, prune `dismissed` to ids still present in `incoming` (e.g. in the auto-timeout tick, `next` = intersection of `dismissed` with `incomingRef.current` ids), or cap it like `seen`.

## 3. Composer sends on Enter mid-IME-composition
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/features/fleet/monitor/channels/ChannelTimelineWorkspace.tsx:257
- **Scenario**: `onKeyDown={(e) => { if (e.key === 'Enter') send(); }}`. When a CJK/IME user presses Enter to CONFIRM a composition candidate (not to submit), the handler fires `send()` and posts a half-composed directive to the team channel + potentially triggers the `@athena` companion prompt. This app is i18n-heavy (many locales), so IME input is a normal path.
- **Root cause**: The Enter handler does not consult `e.nativeEvent.isComposing` (or `e.keyCode === 229`), so composition-confirm Enters are treated as submit.
- **Impact**: Premature/garbled channel posts for IME users. UX / data-quality.
- **Fix sketch**: `if (e.key === 'Enter' && !e.nativeEvent.isComposing) send();`.

## 4. VirtualStream `seenRef.clear()` mid-render re-animates later rows in the same frame
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/fleet/monitor/channels/VirtualStream.tsx:86-91
- **Scenario**: Inside the virtual-item map, when a recent row makes `seenRef.current.size > 600`, `seenRef.current.clear()` runs. Any *other* recent (<8s) rows rendered later in the SAME map pass are now absent from the freshly-cleared set, so they compute `fresh = true` and replay the entrance animation even though they were already shown.
- **Root cause**: The dedupe set is mutated (cleared) during render while it is still being read by subsequent iterations of the same loop.
- **Impact**: Occasional cosmetic double-animation flash on a burst of fresh rows. UX (minor).
- **Fix sketch**: Move the cap/clear out of the per-row loop (e.g. clear in a post-render effect, or only when adding would exceed the cap swap to a new Set seeded with the current viewport ids after the loop).

## 5. `MergedChannels` retains items/presence for deselected teams
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src/features/fleet/monitor/channels/mergedFeed.tsx:33-63
- **Scenario**: `onData` sets `itemsByTeam[teamId]`/`presenceByTeam[teamId]` but nothing deletes a team's entry when it leaves `teams` (deselected). The `merged`/`byTeam` memo only iterates the current `teams`, so stale entries don't corrupt output — but `presenceByTeam` is passed whole to the render-prop, and `ChannelTimelineWorkspace` computes `working` by iterating ALL of `presenceByTeam.values()`, including deselected teams. So the "N working" count can include personas on teams the user filtered out.
- **Root cause**: Accumulator maps are only ever added to, never pruned to the live `teams` set.
- **Impact**: "working" stat over-counts after deselecting a team; minor unbounded map retention. UX / correctness (minor).
- **Fix sketch**: In the `merged` memo (or a small effect on `teams`), drop map keys not in the current `teams`; or compute `working` only over `feedTeams` ids rather than every `presenceByTeam` value.

## 6. Dev "Mock pop-up" harness shipped in the production channel top strip
- **Lens**: code-refactor
- **Severity**: medium
- **Category**: leftover-debug
- **File**: src/features/fleet/monitor/channels/ChannelTimelineWorkspace.tsx:17-18,294-296,395-404; src/features/fleet/monitor/live/liveDevHarness.ts
- **Scenario**: The Channels → Timeline top strip renders an always-visible amber "Mock" button (`FlaskConical`) wired to `emitMockLiveMessage()`, which force-enables live mode and injects synthetic agent chatter ("Shipped v2.4.0 to staging", "Login regresses on Safari 17…"). This is a dev-only harness (`liveDevHarness.ts`, self-described "TEMP (prototype)… Remove with liveDevHarness") exposed to every end user.
- **Root cause**: A prototype affordance for exercising the overlay was left inline in the production component rather than gated behind a dev flag.
- **Impact**: End users can inject fake channel messages; confusing, unprofessional. Maintainability / UX.
- **Fix sketch**: Gate the Mock button + `emitMockLiveMessage` import behind `import.meta.env.DEV`, or delete `liveDevHarness.ts` and its two call sites now that the "Bubble" presentation has won.

## 7. `cleanName` / SDLC-prefix strip triplicated
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/fleet/monitor/channels/ChannelTimelineWorkspace.tsx:34; src/features/fleet/monitor/grid/fleetGridModel.ts:57; src/features/fleet/monitor/channels/MergedRow.tsx:86
- **Scenario**: The same `name.replace(/^SDLC[ —-]*/i, '') || name` cleanup exists three times: `cleanName` in ChannelTimelineWorkspace, the richer `cleanName` in fleetGridModel (also strips `^T:\s*`), and an inline copy in MergedRow's team-label render. `liveModel.projectChannelItem` additionally does `persona.name.replace(/^T: /, '')`. They can drift (fleetGridModel handles `T:`, the others don't).
- **Root cause**: A shared display helper was re-implemented per-file instead of imported.
- **Impact**: Inconsistent team/persona labels across the monitor; maintenance drift. Maintainability.
- **Fix sketch**: Export one `cleanName` (the fleetGridModel version) from a shared monitor util and import it in ChannelTimelineWorkspace, MergedRow, and liveModel.

## 8. `triageModel.COPY` hardcodes English, bypassing i18n
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/fleet/monitor/triage/triageModel.ts:8-14; src/features/fleet/monitor/triage/MonitorProjectColumns.tsx:117,125,149,171,176
- **Scenario**: The Project Columns view renders `COPY.actionEmpty` ("Nothing needs you right now"), `COPY.needsAttention`, `COPY.activeGoals`, `COPY.noTeam`, `COPY.allClear` as raw English constants, while the rest of the same component uses `t.monitor.*`. Comment says "Promote to `t.monitor.*` at consolidation."
- **Root cause**: Prototype copy left as inline constants instead of translation keys.
- **Impact**: Untranslated strings in every non-English locale on the default Monitor view. UX / i18n.
- **Fix sketch**: Add `t.monitor.*` keys for these five strings and replace `COPY` usages; delete the `COPY` object.

## 9. `avatarTint`/`avatarBg` author-color mapping duplicated
- **Lens**: code-refactor
- **Severity**: low
- **Category**: duplication
- **File**: src/features/fleet/monitor/live/liveModel.tsx:53-60; src/features/fleet/monitor/channels/MergedRow.tsx:69-73
- **Scenario**: The author→background-tint map (athena→violet, director→sky, directive→emerald, default→secondary/60) exists as `avatarTint()` in liveModel and again inline as `avatarBg` in MergedRow. Both are meant to keep the same author looking identical in the Timeline row and the corner pop-up, but they are maintained separately and can diverge (MergedRow's default is `bg-secondary/60`, matching, but any future tweak must be made twice).
- **Root cause**: The tint resolution wasn't hoisted to a shared helper when the live overlay reused MergedRow's `resolveCompact`.
- **Impact**: Risk of visual drift between the two surfaces. Maintainability.
- **Fix sketch**: Have MergedRow import `avatarTint` from liveModel (or move both to a shared `collabRender`/monitor util) and drop the inline `avatarBg`.

## 10. Process attribution can misattribute by label==persona-name collision
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/features/fleet/monitor/monitorModel.ts:225-237
- **Scenario**: When a process has no `personaId` and no `navigateTo.personaId`, attribution falls back to `nameToId.has(proc.label)`. `proc.label` is a free-form display string (also used as the human label in SystemBand/activity rows). If a system/app process's label happens to equal a persona's `name`, it is silently attributed to that persona's card (inflating its running/queued counts and live cost), and two personas sharing a name make `nameToId` keep only the last.
- **Root cause**: Using a display label as a lookup key for ownership; names are not unique or namespaced.
- **Impact**: Occasional mis-attributed process counts / live cost on a card. Correctness (minor).
- **Fix sketch**: Prefer id-based attribution only; if a label fallback is needed, guard it (e.g. only when exactly one persona matches and the process domain is persona-scoped), or drop the label branch.
