# Max Nilsson — Hobbyist / Power-Automator — L1 report

- **Character:** `hobbyist-power` (Max Nilsson — power-automator, Home Assistant/n8n tinkerer; finds the edge of every tool in a weekend; pushes chains/triggers/teams/KPIs/the long tail; evangelist-or-scathing-post)
- **Level:** L1 (theoretical, code-grounded thought experiment over a surface model built from the code; nothing run)
- **Tier reachability:** Builder — reaches everything incl. Cloud + Dev Tools. No surface in any journey was found tier-gated above him (teams/goals/KPI/chains all ungated; see findings).
- **Run:** 2026-06-19 L1 thorough
- **Scope checked:** adopt-template, set-trigger-automate, run-and-review-execution, synthesize-team, track-goal-kpi — with a composition/depth + silent-stall + KPI-reality lens.

> Note on the surface model: `context-map.json` is auto-generated and partly drifted. Several paths it cites are idealized (e.g. trigger commands are at `src-tauri/src/commands/tools/triggers.rs`, not `communication/triggers.rs`; the trigger scheduler tick lives in `engine/background.rs`, not `engine/scheduler.rs`; there is no `ChainBuilder.tsx` — chains are built in the Trigger "Chain Studio"). All file:line evidence below is against the **real** tree, hand-verified for the load-bearing claims.

---

## Per-journey verdicts

### 1. adopt-template — **L1-conditional**
The gallery is genuinely legible and the adopt path is wired far deeper than a "dump you into a half-agent" antipattern: event subscriptions and connector suggestions are baked into the agent IR *at seed time* (`ChronologyAdoptionView.tsx` applies them before `create_adoption_session`), and credential bindings are deferred but real. Max gets a working-or-clearly-blocked persona. **The one major:** when a required credential is missing, the corresponding questionnaire question is *filtered out / hidden* rather than surfaced with a "you must wire X" CTA — so a power user can complete adoption believing it's whole, then hit a hard substitution error at first test. That violates the journey's explicit "didn't dump me into a half-configured agent that silently fails on first run" clause. Completes, but with an adoption-time blind spot.

### 2. set-trigger-automate — **L1-pass**
The strongest journey for Max. Both schedule (cron/interval) and event (webhook/file/poll/clipboard/listener) triggers are reachable, form-validated, and legible. Enabled/disabled is unmistakable (toggle + countdown). Next-fire time is *real* — computed backend-side from the cron expression with timezone + anchor-to-prior-fire drift correction (`scheduler.rs::compute_next_trigger_at`), and the tick loop (`background.rs:1629+`) atomically marks-and-fires with a CAS on `trigger_version`. Trigger→event→execution genuinely connects. The only soft spot is a cosmetic client-side fallback for next-fire on cold start, and the silent-stall risk shared with teams (below). Structurally sound; he'd trust it's armed.

### 3. run-and-review-execution — **L1-pass**
Execute is a non-blocking spawn; the runner UI shows elapsed time, a determinate progress bar keyed to typical duration, an amber over-budget sweep, and a "Stuck?" guidance affordance — so a 30–215s run reads as progress, not hang. Status (success/failed/cancelled) is visibly color-coded. The accept/reject loop is the highlight: a resolved review **feeds memory** — `runner/mod.rs:797` injects prior human decisions into the next prompt ("Repeat what was approved; do NOT repeat what was rejected") — and **resumes** held team assignments (`reviews.rs` `react_to_review_decision`), or dispatches a follow-up run for advisory reviews, raising an *incident* (not silent) if dispatch is blocked. The one caveat (minor at L1, flagged for L2): review is **agent-initiated** via the `request_review` protocol tool, not a deterministic confidence threshold — "asks when unsure" is only as reliable as the model self-reporting uncertainty.

### 4. synthesize-team — **L1-conditional**
Roles and handoff flow are legible on the canvas (PersonaNode role badges, typed ConnectionEdges + legend). Handoff genuinely composes at the second hop: `team_handoff.rs` wires the visual graph into emitter/receiver chain+listener triggers, and a completed member's event dispatches the next member (`chain.rs` → `bus.rs` → `background.rs` execution spawn). The disabled-member-swallows-handoff bug from this app's history **has been guarded** — `background.rs:997` detects a handoff targeting a disabled persona and writes a "cascade stalled here" breadcrumb to the delivered event; a `FleetLivenessWatchdog` raises a deduped incident after 2h idle. **But the major remains for Max:** the breadcrumb is marked `Delivered` (not routed to the Dead-Letter queue) and **no team-canvas or node UI reads it** — the canvas shows all roles intact with zero indication that a chain silently dead-ended. A senior automation engineer staring at a healthy-looking canvas while work has stalled is exactly Max's top pet peeve. Completes, but the liveness story is backend-only.

### 5. track-goal-kpi — **L1-pass**
The crux question — is KPI a placebo dashboard? — comes back **grounded**. `kpi_eval.rs::measure_derived` runs real SQL over `persona_executions`, `team_assignment_events`, `audit_incidents`, and `team_assignments` (qa_bounce_rate, exec_failure_rate, incident_rate, parked_review_age_days), and *refuses to record a falsely-perfect 0%* when there's no data in the window (returns an "insufficient data" error instead). Codebase KPIs run real shell commands; connector KPIs do deterministic HTTP replay against vault credentials. Goals link to assignments with `goal_id` and to-do titles mirror onto steps. This is the opposite of a placebo — it's the surface most likely to convert Max to evangelist. Minor gaps: the to-do close-loop is soft-linked by title-matching (drifts silently if a title changes), and the UI doesn't yet put "ran 47 times / number didn't move" side-by-side.

---

## Findings

### F1 — [major][missing] missing-feature — Adoption hides missing-credential questions instead of surfacing the blocker
- **expected:** When a template needs a credential Max doesn't have, adoption tells him "this is the one thing left to wire" (journey DoD; his criterion #5 "reason about what's wired to what").
- **got:** `matchVaultToQuestions` computes `blockedQuestionIds` and the questionnaire **filters those questions out of the render** — they silently disappear. `QuickAddCredentialModal` is imported but not surfaced as a blocker CTA in this flow. The capability is quietly half-configured; the failure only appears at `test_build_draft` time when `{{param.X}}` has no answer.
- **evidence:** `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx:656` (`matchVaultToQuestions(...).blockedQuestionIds`), `:809-821` (blocked questions filtered from render); `src-tauri/src/engine/adoption_answers.rs:56` (`substitute_variables` is where the unfilled param later breaks).
- **code_check:** `confirmed-absent` (no blocked-credential CTA component wired into the adoption questionnaire; `QuestionnaireBlockedCredentialCta.tsx` exists in tree but is not the rendered path here).
- **reachable:** yes (Builder, any adopt of a template requiring an unowned credential).
- **l2_priority:** HIGH — confirm live that a template needing an unowned connector completes adoption "clean" and then errors on first test (the exact "silently fails on first run" the journey forbids).

### F2 — [major][trust] broken-flow — Team handoff stall is invisible on the canvas (breadcrumb persisted, never surfaced)
- **expected:** When a team stalls (disabled member swallows a handoff), Max sees a diagnostic — a stalled-phase warning / node health indicator (his criterion #3 "when something stalls there are diagnostics, not a silent deadlock").
- **got:** The guard exists and writes a WHY breadcrumb, but the event is marked `Delivered` (not DLQ), so it appears in neither the Dead-Letter tab nor any canvas indicator. PersonaNode status badges reflect pipeline execution state only — there is no "cascade stalled / downstream member disabled" badge. The canvas looks fully healthy while the chain is dead.
- **evidence:** `src-tauri/src/engine/background.rs:997-1020` (guard sets `dropped_disabled_target`, `tracing::warn!` only), `:1222-1230` (`event_repo::update_status(..., PersonaEventStatus::Delivered, note)` — breadcrumb persisted but status is Delivered, not Failed/DLQ); `src/features/teams/sub_canvas/components/nodes/PersonaNode.tsx:14-37` (status badge set has no stalled-cascade state); `src/features/teams/sub_factory/AttentionBand.tsx` (KPI-health only, no handoff-stall surfacing).
- **code_check:** `present-but-missed` — the diagnostic *data* is captured; the *surface* to show it on the team UI is absent.
- **reachable:** yes (Builder; trivially reproduced by disabling one member of a wired team mid-run).
- **l2_priority:** HIGH — confirm live that disabling a downstream member produces a stalled team with no UI signal, and that the breadcrumb is only findable via DB/event forensics.

### F3 — [major][completion] quality-gap — UI-created chains fire the next persona but do NOT forward the source output (second-hop data break)
- **expected:** Max's signature move — "chain this into that" — the next step receives the previous step's output. His criterion #1: chains compose end-to-end with no second-hop break.
- **got:** The Chain Studio commits a persona→persona link as a real `chain` trigger via `createTrigger`, but `draftLinkToTriggerInput` writes a config of only `{ source_persona_id, condition, event_type }` — it never sets `payload_forward: true`. The engine only injects `source_output` into the next step's input *when `payload_forward` is true* (`chain.rs:242-261`). So a chain built in the UI advances control flow on completion but the second persona gets **no upstream output** — the data hop is silently dropped. Forwarding is reachable only by hand-editing the trigger config JSON.
- **evidence:** `src/features/triggers/sub_studio/libs/studioCommit.ts:43-53` (committed config has no `payload_forward`), `src/features/triggers/sub_studio/StudioSwitchboard.tsx:143-158` (`commitLink` → `createTrigger(input)`); `src-tauri/src/engine/chain.rs:242-261` (output is forwarded ONLY under `payload_forward`); `src/lib/bindings/CreateTriggerInput.ts:3` (`config: string` — so it's expressible, just never set by the UI).
- **code_check:** `present-broken` — the data-forward mechanism exists and works backend-side; the UI commit path doesn't opt into it.
- **reachable:** yes (Builder; any chain drawn in the Chain Studio).
- **l2_priority:** HIGH — confirm live that a Studio-built A→B chain runs B with empty/absent source_output, i.e. B can't see A's result without manual config surgery.

### F4 — [minor][missing] missing-feature — Chain Studio can't commit output-conditional routing (`output_match` deferred)
- **expected:** Power-user conditional routing — "fire B only if A's output matches X" (jsonpath/value). Backend supports a `jsonpath` chain condition.
- **got:** `commitBlocker` returns `'output_match'` and the commit is refused; the studio comment says it's "not yet committable." The backend `jsonpath` predicate is implemented but has no front door.
- **evidence:** `src/features/triggers/sub_studio/libs/studioCommit.ts:13-14,19,24,40` (`output_match` blocker); `src-tauri/src/engine/chain.rs` `evaluate_predicate` supports `"jsonpath"`.
- **code_check:** `confirmed-absent` (UI), `by-design` deferred per docs/plans/studio-supersedes-builder.md Phase 1.
- **reachable:** yes (visible as a non-committable option — a labeled dead-end Max will poke at).
- **l2_priority:** medium — confirm the option is visibly present-but-disabled (a labeled dead-end is better than an invisible gap, but still a ceiling).

### F5 — [minor][senior-quality] quality-gap — Manual review is agent-initiated, not a deterministic confidence threshold
- **expected:** "When it's unsure it asks me instead of guessing" (journey goal) read by Max as a reliable floor (his criterion #3/senior bar).
- **got:** There is no numeric confidence-threshold router. Review happens only when the LLM itself calls the `request_review` protocol tool. If the model is confidently wrong, nothing routes to review. Healing classifies *errors*, not low confidence.
- **evidence:** `src-tauri/src/engine/runner/mod.rs:2148` (`PROTOCOL_TOOLS` includes `request_review`), `:2169` (`request_review` → `ProtocolMessage::ManualReview`); `src-tauri/src/engine/healing.rs:143` (`classify_error` = error taxonomy, not confidence).
- **code_check:** `by-design` (model-judgment-gated routing) — but a gap against a deterministic-floor reading of the criterion.
- **reachable:** yes (every execution).
- **l2_priority:** medium — confirm whether real runs reliably self-route uncertain results to review, or whether confidently-wrong output ships unreviewed.

### F6 — [minor][senior-quality] quality-gap — Goal→to-do close-loop is title-string matched (drifts silently)
- **expected:** Goal progress rigidly tied to executed work (his criterion #4 KPI/goal reflects reality).
- **got:** Goal to-dos map to assignment steps by *title text*; closure relies on title matching rather than a hard FK. If a step title drifts, the to-do silently never checks off.
- **evidence:** `src-tauri/src/engine/goal_advance.rs:147-158` (verbatim title preserved for matching), `:239` (mirror_todo_titles).
- **code_check:** `present-but-missed` — resilient but soft; no rigid close-loop constraint.
- **reachable:** yes (Builder, goal-with-todos advanced by a team).
- **l2_priority:** medium — confirm a real goal advance checks off the right to-dos and doesn't drift.

### F7 — [minor][clarity] confusion — Scheduled-but-currently-outside-active-window trigger reads identically to disabled
- **expected:** Max can distinguish "off forever" from "sleeping until 9am" at a glance.
- **got:** `TriggerCountdown` renders the disabled label for disabled triggers, but a trigger that's enabled yet outside its active window has no "will run in X / sleeping until active hours" affordance; the schedule advances regardless (`background.rs:1676-1680`).
- **evidence:** `src/features/triggers/sub_triggers/TriggerCountdown.tsx:39` (disabled early-return); `src-tauri/src/engine/background.rs:1676-1680` (active-window skip still advances schedule).
- **code_check:** `confirmed-absent` (no "sleeping until active hours" state).
- **reachable:** yes (any trigger with an active-hours window).
- **l2_priority:** low.

### F8 — [polish][missing] missing-feature — No "this run was triggered by a chain from X" breadcrumb in execution detail
- **expected:** When chains compose, Max can trace lineage — see that run B came from A's cascade.
- **got:** Chain depth/trace_id ride in the payload (`chain.rs:254-258`) and cascade metrics are logged via `tracing`, but execution detail UI shows no "triggered by chain from A (depth 1, trace …)" lineage.
- **evidence:** `src-tauri/src/engine/chain.rs:254-258` (`_chain_depth`/`_chain_visited`/`_chain_trace_id` in payload), `:436-449` (CascadeMetrics logged, not streamed to client).
- **code_check:** `present-but-missed` (lineage data exists in payload + logs; not surfaced in UI).
- **reachable:** yes.
- **l2_priority:** low.

---

## What passed (do NOT touch — strengths)

- **KPI grounding is real, not a placebo.** `kpi_eval.rs::measure_derived` (`:291-389`) computes from live `persona_executions` / `team_assignment_events` / `audit_incidents` / `team_assignments`, and *refuses to log a false-perfect 0%* on no data (`:335-338`, `:353-356`). Connector KPIs replay deterministically against vault creds. This is the single biggest evangelism hook for Max.
- **Trigger next-fire is honestly computed.** Backend cron parse + timezone + anchor-to-prior-fire drift correction (`scheduler.rs::compute_next_trigger_at`); atomic CAS-marked fire in the tick loop (`background.rs:1906`). Not a cosmetic countdown.
- **Review→memory→resume close-loop is wired.** Prior human decisions injected into the next prompt (`runner/mod.rs:794-800`); held assignments resume on approval; blocked dispatch raises an *incident* rather than dying silently (`reviews.rs:1303-1340`).
- **Run progress is communicated, not a hang.** Determinate progress bar to typical duration, over-budget amber sweep, "Stuck?" guidance (`PersonaRunner.tsx:152-186`).
- **Team handoff genuinely composes** at the second hop via `team_handoff.rs` → `chain.rs` → `bus.rs` → execution spawn, and the disabled-member case is at least *guarded* (was a silent swallow; now a persisted breadcrumb + FleetLivenessWatchdog incident). The data is captured — only the UI surface is missing (F2).
- **Gallery is legible to a non-dev** — TemplateCard renders goal, difficulty, setup-minutes, capabilities (use-case flows), connector icons, readiness score.
- **Chaining has a real UI front door after all** — the Chain Studio Switchboard commits persona→persona links as real triggers (refutes any "backend-only facade" read on chain *control* flow; the gap is the *data* forward, F3).

---

## Character voice

> Okay, first impressions — this thing has *bones*. I came in expecting a no-code toy and the KPI engine actually runs SQL against my real execution table and *refuses* to lie to me when there's no data. That's the moment I stopped browsing and started leaning in. Next-fire times are computed for real with timezone + drift anchoring, not a fake spinning countdown. The review loop literally pipes my past approvals back into the next prompt. Whoever built this thinks like an automation engineer, not a marketer. I want to evangelize this.
>
> *And then* I wired a chain in the Chain Studio. Drew A → B, committed it, beautiful. Except B can't see A's output — because the UI never sets `payload_forward`, and the engine only forwards output when that flag is on. So the control flow hops but the data doesn't, and the only way to fix it is hand-editing trigger config JSON the UI won't show me. That's a second-hop break, and it's the *exact* thing on my pet-peeves list. Then I disabled one team member to test resilience and watched the canvas sit there looking perfectly healthy while the whole chain quietly dead-ended — the app *knows* (it writes a "cascade stalled here" breadcrumb!) but marks the event "Delivered" and never shows it to me anywhere. The diagnostic exists and they hid it from the one screen I'm staring at.
>
> So I'm split, and that's the most dangerous place for a tinkerer to be. The depth is *clearly* there — this is not a facade, the guards and watchdog and grounded KPIs prove a senior built the engine. But three of my five sharpest tests (output forwarding, stall visibility, missing-cred surfacing) fail at the UI seam, not the engine. Fix F3 (forward output from the Studio), F2 (paint the stall on the canvas), and F1 (tell me which credential to wire) and I write the glowing forum post titled "the first agent platform that doesn't lie to you." Ship it as-is and I write the *other* post — "powerful engine, but it'll silently strand your chains and you won't know until you read the database." Right now it's one weekend of polish away from a rave and one silent stall away from a roast.

**Evangelize-or-roast verdict:** Cautiously pre-evangelist. The engine earns his respect; the UI seams (F1/F2/F3) are what decide which post he writes.
