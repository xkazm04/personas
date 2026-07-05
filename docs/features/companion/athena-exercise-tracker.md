# Athena feature exercise tracker (living doc)

> **Purpose.** Michal and Athena are walking every companion capability one
> by one — exercising each, confirming it works as documented, and
> fine-tuning behavior (up to and including code changes via dev mode).
> This doc is the durable checklist + session log so progress survives
> across chat sessions and memory resets.
>
> **Derived from** `docs/features/companion/README.md` +
> `athena-usecases.md` (constitution v41). When those docs and observed
> behavior disagree, the behavior wins — note the delta in the session log.

## Legend

- `[ ]` not started
- `[~]` in progress (being exercised now)
- `[x]` confirmed working / tuned to satisfaction
- `[!]` broken or diverges from docs — needs a fix (link the dev op)

Each item, when touched, gets a one-line note in **Session log** with the
date, what we observed, and any change made.

---

## Phase 0 — Conversation substrate (everything rides on this)
- [x] Streaming chat + token-level streaming
- [x] `PROGRESS:` in-turn beats (always-on, text + voice)
- [x] `TTS:` spoken summary line
- [x] `QR:` quick-reply chips
- [x] Refine chips (Shorter / More detail / Code only)
- [x] Slash-command palette (`/`)
- [x] Mid-stream Stop (interrupt) + failed-turn retry
- [x] Autonomous mode toggle + `continue_autonomously` chaining
- [x] Reset conversation (transcript vs disk episodes)
- [x] Chat polish: search removed · copy-beside-message · day separators · narration-trail polish (all merged)

## Phase 1 — Memory & identity (the foundation everything cites)
- [ ] `write_fact` / `delete_fact` (+ supersede)
- [ ] `write_procedural` / `delete_procedural`
- [ ] `write_goal` / `update_goal_status` / `delete_goal`
- [ ] `write_ritual` / `set_ritual_active` / `delete_ritual`
- [ ] `write_backlog_item` / `resolve_backlog_item`
- [ ] `update_identity` (anchored diffs + full-content intake)
- [ ] Intake interview ("get to know me")
- [ ] Recall-preview strip + Brain Viewer + linked-memory chips
- [ ] Correction loop ("that's wrong") + profile synthesis / adaptations

## Phase 2 — Proactivity (reads Phase 1, produces nudges)
- [ ] Trigger kinds: goal_target, backlog_aging, cadence_due, on_this_day, ambient_match
- [ ] `schedule_proactive` (future check-in)
- [ ] Gating: quiet hours, daily budget, dedupe
- [ ] Arrival-TTS on nudge delivery

## Phase 3 — Connectors (acting on the world)
- [ ] `gmail` — list threads (read) / mark read / send (write, gated)
- [ ] `discord` — list messages / post (gated)
- [ ] `notion` — list / get / delete page (gated)
- [ ] `local_drive` — list / count / write file (gated)
- [ ] `personas_database` — list/describe/select + mutation (gated)
- [ ] `operations_database` — `query_operations` views
- [ ] `elevenlabs` — list voices / generate TTS
- [ ] Connector-call live status cards + wired-vs-stub honesty

## Phase 4 — Observability & UI control
- [ ] `open_route` (+ `monitor` pseudo-route grid)
- [ ] Inline cards: `show_persona_overview` / `show_connected_services` / `show_decisions` / `show_recent_decisions`
- [ ] `compose_dashboard` (9 widget kinds)
- [ ] `compose_cockpit` (6 widget kinds) + pin-to-cockpit
- [ ] `explain_in_cockpit` (decision-0 explainer)
- [ ] Daily brief (Sunrise button)
- [ ] `analyze_fleet` (Radar button)
- [ ] Activity tray / orb dots / live-ops strip / turn-usage ledger

## Phase 5 — Persona design surfaces
- [ ] `show_design_capabilities`
- [ ] `show_persona_walkthrough`
- [ ] `show_template_suggestions`
- [ ] `show_use_case_set` / `show_trigger_set`
- [ ] `show_model_tier_choice`
- [ ] `show_observability_plan`
- [ ] `show_decision_log` / `show_persona_ready`
- [ ] `show_persona_creation_offer` / `show_walkthrough_offer`

## Phase 6 — Building & genome (commits)
- [ ] `prefill_persona_create` (interactive)
- [ ] `build_oneshot` (autonomous build)
- [ ] `run_persona` / `run_arena`
- [ ] `companion_breed_personas` / `companion_evolve_persona`
- [ ] `resolve_human_review`

## Phase 7 — Dev Tools / project lifecycle
- [ ] `register_project`
- [ ] `enqueue_dev_job` (context scan)
- [ ] `open_test_env`
- [ ] `run_browser_test` + `show_browser_test_report`
- [ ] `update_dev_goal`
- [ ] KPI suite: `propose_kpi` / `scan_kpis` / `evaluate_kpi` / `calibrate_kpi`

## Phase 8 — Guided walkthroughs & pointing
- [ ] `start_guided_walkthrough` (6 topics)
- [ ] `point_at` (single anchor)
- [ ] `compose_walkthrough` (multi-stop tour)

## Phase 9 — Fleet & team orchestration
- [ ] `assign_team`
- [ ] `fleet_send_input` / `broadcast` / `kill` / `spawn` / `dispatch`
- [ ] `fleet_intervene` / `fleet_redirect_op`
- [ ] `fleet_wake` / `fleet_resume`
- [ ] MCP server tools + batched MCP request panel
- [ ] Autonomous signal economy (exec triage + message triage)

## Phase 10 — Dev mode (self-development — the "change your own code" clause)
- [ ] `dev_improve` (frontend hot-reload vs backend worktree)
- [ ] `dev_merge` handshake
- [ ] Dev-op ledger + verdict chips + reflection turns

## Phase 11 — Voice & avatar depth
- [ ] TTS engines: ElevenLabs (cloud) vs Piper (local)
- [ ] STT engines: browser vs whisper (local)
- [ ] Voice controls popover + per-bubble read-aloud
- [ ] Footer avatar hold-to-talk + floating orb (drag/dock, audio-reactive glow, message reaction, progress dots)

## Phase 12 — Subagents & desktop-awareness (advanced)
- [ ] Subagents: persona-auditor / backlog-scout / doc-reader / web-researcher
- [ ] WebSearch / WebFetch
- [ ] Ambient bridge + CLI-session awareness (Phase 3c / Phase 5)

## Known limits to confirm (not chase)
- [ ] `personas-daemon` doesn't run the job worker yet — app-quit kills in-flight jobs
- [ ] Autonomous chains hard-cap at 20 ticks
- [ ] Unwired connectors return stub markdown (only some capabilities are real handlers)

---

## Session log

### 2026-07-04
- Created this tracker. Started Phase 0.
- **0.1 Streaming** — CONFIRMED behavior B (status line + `PROGRESS:` beats; full
  reply lands whole on `finished`). Deltas ARE consumed (`--include-partial-messages`
  → `extractAssistantTextDelta` → `flushDeltaBuffer` → `streamingText`) but only to
  fire beats live + dedupe the trailing whole message; the bubble deliberately does
  not render token prose (`CompanionPanel.tsx` ~L2034 — it leaked `OP:/QR:/TTS:`).
  Michal: good as-is. Docs fix: reconciled stale README claims (L113 + the
  "Token-level streaming" section → renamed "Stream deltas") to match code;
  `conversation-orchestration.md` was already accurate. ✅
- **0.2 PROGRESS beats** — CONFIRMED. `progress_addendum()` (`prompt.rs:1383`) is
  appended unconditionally; only the `TTS:` grammar in that slot is voice-gated.
  Beats are NOT discarded: `dispatcher.rs:361` strips them from the final reply +
  captures them in order, then `session.rs:695` re-persists each as its own
  append-only assistant episode (`PROGRESS:` sentinel → `Bubble.tsx:95` dim aside).
  Live/in-flight beats also fire into the narration timeline + spoken when voice on
  (`beatFiredRef` suppresses the generic ack/heartbeat). Michal: good as-is (2–4/turn).
  Docs fix: README L419 said only "stripped from the persisted reply" — completed it
  to reflect the re-persist-as-aside path. `athena-usecases.md` A10 was already right. ✅
- **Worktree set up** — `worktree-athena-exercise` at `.claude/worktrees/athena-exercise`
  (off master `ebce8a545`). Workflow: CODE changes go in the worktree; a merge to master
  is the deliberate app-refresh/reset point. This tracker stays on master as the
  cross-reset recovery ledger (docs don't HMR-refresh the app). Not registered in
  `.claude/active-runs.md` — another session has it checked out dirty.
- **0.3 TTS line** — CONFIRMED. First `TTS:` wins (`dispatcher.rs:387`; extra ones dropped
  with a "multiple TTS lines, keeping first" warning), stripped from display, grammar
  voice-gated (`voice_addendum_if_needed`). Docs (`athena-usecases.md` A10 + send/arrival-TTS)
  ALREADY accurate — no doc change needed. Michal: good as-is. ✅
- **0.4 QR chips** — CONFIRMED. Backend hard cap is **6** (`dispatcher.rs:405`,
  `quick_replies.len() < 6`), frontend renders all + shows `{i+1}` badges, number
  keys **1–9** fire the matching chip (`QuickReplies.tsx:28`). Michal: good as-is.
  Docs fix: `athena-usecases.md:25` said "2–5 follow-up prompts" — contradicted its
  own A10 ("up to 6") and the code; corrected to "up to 6" + noted the 1–9 keys.
  (`athena-decision-layer-plan.md:18` already said "digits 1-9".) ✅
- **0.5 Refine chips** — CONFIRMED by Michal ("resending the prior message works well").
  Below the latest completed reply, Shorter / More detail / Code only re-send the prior
  user message with a localized steering suffix through the same send() path. No doc fix.
- **Chip plain-language rule (CODE increment #1)** — Michal: keep chips short, no internal
  jargon/IDs, assume regular users don't know the codebase. Adopted immediately + made
  durable: added a "Plain language, no jargon" bullet to the constitution's Quick replies
  section + bumped CONSTITUTION_VERSION 42→43. Staged in the worktree as commit `75de0a5d3`
  (1 commit ahead of `ebce8a545`, clean cherry-pick). NOT merged — awaiting Michal's merge,
  which is a backend rebuild + app restart. ⏳
- **0.6 Slash palette (CODE increment #2)** — Restyled: dropped the per-item description,
  render just the label in normal weight; sorted presets A–Z by label at the source
  (Composer) so palette + keyboard-nav stay aligned; `filterSlashPresets` stays pure (tests
  unaffected). Worktree commit `fe75f84d0`. Not merged. Frontend-only, so hot-reload on merge.
- **Toolbar consolidation (CODE increment #3, PENDING decision)** — Michal wants "What can
  Athena do", Daily Brief, Analyze Fleet moved out of `CompanionToolbar` into the slash menu.
  Finding: capabilities is ALREADY a slash preset (message) → its toolbar button is a pure
  duplicate to remove. Daily Brief + Analyze Fleet are DETERMINISTIC command calls
  (`companion_daily_brief` / `companion_analyze_fleet`), not chat prompts — so they must
  migrate as ACTION presets (run the command on pick), NOT message presets, to keep the
  dedicated-turn behavior. Plan: extend `SlashPreset` with optional `action`; thread the two
  handlers from `CompanionPanel` → `Composer`; remove the 3 toolbar buttons + their props.
  DONE (`25163baef`) — went with the action-preset approach (behavior-preserving). Built via a
  subagent in the worktree; `tsc --noEmit` + eslint clean on all 4 files (+54/−80). Capabilities
  button removed (already a preset) + orphaned `askCapabilities` cleaned up; Daily Brief +
  Analyze Fleet now action presets that run the command on pick; 3 toolbar buttons + unused
  HelpCircle/Radar/Sunrise imports removed. Michal never re-confirmed (resets kept eating the
  ask) so I made the safe, non-lossy call. ✅

- **0.7 Stop + retry** — CONFIRMED by Michal ("both looking good"). Mid-stream Stop button →
  `companion_interrupt_turn` kills the CLI child, partial saved `[interrupted]`, resumes via
  `--resume`; typing anything cancels a pending autonomous tick; failed-send error chip offers
  Retry (re-sends last message). No doc fix needed. ✅
- **Voice-settings persistence bug (CODE increment #4)** — Michal reported VoicePanel selections
  don't survive restart. ROOT CAUSE is NOT the persistence layer (that's correct — all 11 voice
  fields are in systemStore's localStorage partialize): `ElevenLabsVoicePanel`'s "prune credential
  if gone" effect fired during the async credential-load window (the vault store starts `[]`, filled
  by an async fetch), so on cold start it wrongly concluded the saved credential was deleted →
  nulled `companionVoiceCredentialId` + flipped `companionVoiceEnabled` off → persisted the blanks
  over the good values. Fix: `if (credLoading) return;` guard on that effect (`VoicePanel.tsx`,
  +9/−2). Built via subagent; tsc + eslint clean; static-only (a live restart confirms). Worktree
  commit `07cb8af58`. ✅
- **0.8 Autonomous mode** — ACCEPTED as-is per Michal. The loop (`continue_autonomously`,
  ~15s reschedule, 20-turn cap, "── continuation #N ──" divider, type-anything-to-cancel) is
  fine for now; its real stress-test is **Phase 9 (Fleet & team orchestration)**, which already
  has test cases — so we defer the deep autonomous exercise there instead of duplicating it now. ✅
- **0.9 Reset conversation** — CONFIRMED by Michal (ran it successfully before this session: chat
  cleared, memory preserved). Non-destructive to disk episodes / facts / goals / identity by design;
  `reset(true)` also wipes the SQL transcript but disk episodes survive (index re-ingests). No fix. ✅

### Worktree batch (unmerged) as of 0.7
Branch `worktree-athena-exercise`, stacked on `ebce8a545`:
1. `75de0a5d3` — chip plain-language rule (constitution v43) · BACKEND
2. `fe75f84d0` — slash palette restyle + sort · frontend
3. `25163baef` — toolbar → slash consolidation · frontend
4. `285b4b708` — move tracker into the worktree · docs
5. `07cb8af58` — voice-settings persistence fix · frontend
Merging the batch triggers a **cargo rebuild + app restart** (because of the #1 backend change).
Awaiting Michal.
