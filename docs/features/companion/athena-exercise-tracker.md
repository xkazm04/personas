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
- [ ] `TTS:` spoken summary line
- [ ] `QR:` quick-reply chips
- [ ] Refine chips (Shorter / More detail / Code only)
- [ ] Slash-command palette (`/`)
- [ ] Mid-stream Stop (interrupt) + failed-turn retry
- [ ] Autonomous mode toggle + `continue_autonomously` chaining
- [ ] Reset conversation (transcript vs disk episodes)
- [ ] Chat polish: search, copy-conversation, day separators, narration trail

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
