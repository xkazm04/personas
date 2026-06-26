# Combined-Scan Fix Wave 9 — Companion/voice/fleet + orchestration

> 5 atomic fix-commits, 6 findings closed (all High) — no deferrals.
> Dispatched as 5 parallel edit-only fix-subagents (STT #2+#3 grouped). One regression caught + fixed by the gate (see below).
> Baseline preserved: **cargo proactive 64/0, team_assignment 14/0, pipeline 16/1-preexisting + full compile; tsc 0; vitest 1979 pass / 7 pre-existing fail (no regressions)**.

## Commits

| # | Commit | Finding(s) | Stack |
|---|---|---|---|
| 1 | `b7dbef403` | cockpit-voice #2 + #3 | FE + Rust |
| 2 | `4a7908472` | companion-brain #2 | Rust |
| 3 | `154201134` | fleet-control #1 | FE (+ its test) |
| 4 | `6f46f3620` | pipeline #1 | Rust |
| 5 | `d2c3fea72` | team-assignment #1 | Rust |

## What was fixed

1. **STT broken on WebKit + unbounded voice sidecars.** WebKit ignores the `AudioContext sampleRate:16000` request, so the WAV carried 44.1/48 kHz and the Rust validator rejected it (on-device STT 100% broken). Added client-side `resampleTo16k` before encode (Chromium is a no-op). Also added per-engine `tokio::Semaphore` (cap 1) around the TTS/STT sidecar spawns + a monotonic transcribe id so a stale result can't clobber a newer turn.
2. **Ignored proactive nudges never re-fire + table grows unbounded.** `delivered` only exits via resolve(), so an ignored card blocks re-nudging forever and the prune skips it. Added a sweep that ages `delivered` rows older than 7 days to `expired` (unblocks dedupe + makes them prunable). No migration.
3. **Fleet→brain bridge silently no-op.** The bridge resolved sessions against a store only the Fleet page refreshed, so it recorded nothing until the user opened that tab. It now `fleetRefresh()`es on mount and on a coalesced (150 ms) `FLEET_REGISTRY_CHANGED`/cache-miss, so sessions resolve without the tab.
4. **Pipeline conditional-skip fed downstream the global input.** A skipped node was absent from `node_outputs`, so a sequential child fell back to the original `pipeline_input` and ran on wrong data, reporting completed. Added a `skipped` set; a node whose every predecessor is skipped is now itself skipped (`upstream_skipped`).
5. **Manual review Edit/Reassign left the cascade-skipped tail dead.** Only the autonomous retry path called `restore_cascade_skipped_dependents`; the two manual resolvers didn't, so review/QA-merge stayed `skipped` and the assignment was marked done with the PR stranded. Both manual resolvers now restore the cascade tail before resuming.

## Regression caught by the gate (and fixed)

The fleet-bridge fix added an imperative `useSystemStore.getState().fleetRefresh()`, but the existing `useFleetCompanionBridge.test.tsx` mock only covered the reactive hook form → `getState is not a function` failed all 6 of its tests (vitest dropped to 1971/13). A follow-up reconciled the mock (`getState`/`fleetRefresh`) and updated the assertions to the new behavior (mount-refresh, refresh-on-registry-change, race-protection refresh) without weakening them — 8/8 in that file, full suite back to 1979/7. **No production code was wrong; pure test-mock drift.**

## Verification

| Gate | Result |
|---|---|
| cargo (proactive / team_assignment / pipeline) | 64/0 · 14/0 · 16/1-preexisting + full compile |
| `tsc --noEmit` | 0 |
| `vitest run` | 1979 pass / 7 pre-existing fail (fleet test now 8/8; +2 new) |

## Patterns established (catalogue items 27–29)

27. **A status that only exits on user action grows unbounded + starves dedupe** — `delivered` with no time-based escape blocks re-enqueue forever and defeats the prune. Add an age-out sweep to a terminal/expired state.
28. **A passive cache nobody refreshes makes an always-on consumer a silent no-op** — a bridge that reads a store only one screen populates records nothing off-screen. Make the consumer refresh the cache itself (mount + event-driven, coalesced).
29. **A behavior fix that adds an imperative store access breaks reactive-only test mocks** — when production starts calling `store.getState()`, a mock that only stubbed the hook form throws on mount. Update the mock to mirror the real store (callable + `getState`).

## Cumulative status (Waves 1–9)

| Wave | Theme | Closed/addressed |
|---|---|---:|
| 1–8 | security → credential/vault | 44 (6C/38H, 2C mitigated) |
| 9 | Companion/voice/fleet + orchestration | 6 (6H) |

**Total: 50 findings addressed across ~64 commits, 0 regressions.** 6/6 scan Criticals fixed-or-mitigated; **44 of 81 Highs closed.**
**Remaining:** ~37 High + Med/Low tail. Next: Wave 10 — Knowledge/memory + data integrity (memory merge deletes pinned core memories, LLM review clobbers user importance, messages first-sub backlog flood, webhooks concurrent-delivery 500 + Slack burst skip, trigger event-type mismatch).
