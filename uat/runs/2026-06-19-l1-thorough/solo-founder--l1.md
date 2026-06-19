# Priya Raman — Solo Founder — L1 report

**Character:** `solo-founder` (Priya Raman) · non-technical · **Starter tier** · en · discovery
**Level:** L1 (theoretical, code-grounded — no live app)
**Run:** 2026-06-19-l1-thorough
**Surface binding (reachable):** Home, Overview (Dashboard / Messages / Health / Leaderboard only), Agents (build), Connections (Keys), Templates (Generated / Recipes), Settings (Account / Appearance / Notifications). **NOT reachable on Starter:** Teams, Events, Plugins, Overview→{Incidents, Activity, Approvals, Events, Knowledge, Director}, Settings→{Data, Limits, API Keys} (`src/features/shared/chrome/sidebar/sidebarData.ts:38-44,71-79,199-201`).

Her scored criteria, mapped: silent-failure avoidance (trust), faster-than-by-hand (time-saved), on-brand output (senior-quality), routes-to-her-when-unsure (trust), knows-what-it-will-do (clarity).

---

## Journey 1 — Build a working Persona from a one-line intent

**Verdict: L1-pass** (with one trust-caveat carried as a major finding).

**Rationale.** The intent → build-session → questions → test → promote path is structurally complete and has no dead-ends, and it is the *same* path for a Starter non-dev user — the Agents section carries no `minTier` gate (`sidebarData.ts:39`) and `UnifiedBuildEntry` is what renders when a Starter user has zero personas or clicks create (`src/features/personas/PersonasPage.tsx:226-231`). Priya types one sentence; the build creates a draft persona, streams clarifying questions, runs a real tool-test, and gates promotion behind that test. Against her five criteria:

- **knows-what-it-will-do (clarity): PASS.** There is an explicit phase ladder `analyzing → awaiting_input → resolving → draft_ready → testing → test_complete → promoted` surfaced as human labels (`UnifiedBuildEntry.tsx:468-476`), a real test pass that executes each tool against live APIs and shows per-tool PASS/SKIP/FAIL (`src/features/agents/components/matrix/useLifecycle.ts:99,134`), and promote is **blocked unless the test passed** (`useLifecycle.ts:207-212`) — she sees a tested result before the agent goes live.
- **routes-to-her-when-unsure (trust): PASS at the model level.** The build prompt mandates clarifying questions for review policy and treats "ask, don't assume" as the default; `review_policy` modes are `never | on_low_confidence | always` and the runtime emits a `manual_review` protocol message for human sign-off (`src-tauri/src/engine/build_session/session_prompt.rs:374,419-423`; rule 16d). To promote a *failed* test she must consciously click "Approve Anyway" (force) (`useLifecycle.ts:188-212`).
- **senior-quality: structurally PASS, defer exact quality to L2.** The prompt is a "senior AI agent architect" decomposition (mission ≠ task, capabilities, per-capability envelope, tunable parameters) and is grounded in her real vault (see grounding audit), not a generic template. Actual prose quality is an L2 check.
- **silent-failure avoidance (trust): PASS for the BUILD, with a flagged caveat.** Launch failures roll back the orphan draft and show a red error banner (`UnifiedBuildEntry.tsx:591-615,862-873`); test pass/fail/promote all fire OS notifications (`useLifecycle.ts:149-156,257`). **Caveat (F1):** the generated system prompt's mandatory fallback instructs the *runtime* agent to fabricate "realistic sample data and continue… NEVER stop or report 'blocked'" on a credential/auth failure (`session_prompt.rs:389`). For Priya — whose entire fear is an agent doing something dumb with a customer — an agent that silently invents data instead of stopping is the exact failure mode she was burned by. This is the sharpest finding.
- **time-saved: PASS structurally.** One sentence + a bounded ≤4-question round (HARD ROUND CAP, `session_prompt.rs:579`) + auto-test on draft-ready (`UnifiedBuildEntry.tsx:403-413`). Actual minutes/round-count is L2.

**Grounding audit: STRONG.** The build prompt receives her real vault: `credential_repo::get_all` + `connector_repo::get_all` are summarized and passed into `build_session_prompt(... &cred_summary, &connector_summary ...)` (`src-tauri/src/engine/build_session/mod.rs:200-206,258-265`). Empty vault is handled with an explicit "you MUST add credentials… Warn them clearly" instruction, not a silent assumption (`session_prompt.rs:40-44`). Vault ambiguity (2+ creds for one service) force-opens the credential picker so it never silently picks one (`runner.rs:282-303`). This is the opposite of thin-input generation.

---

## Journey 2 — Ask the companion (Athena) to just do a job

**Verdict: L1-pass.**

**Rationale.** The companion can actually *act*, not just chat, and it is fully reachable on Starter. The dispatcher's `ALLOWED_ACTIONS` include `prefill_persona_create`, `build_oneshot`, and `run_persona` (`src-tauri/src/companion/dispatcher.rs:150-202`), all **approval-gated** — Athena proposes, Priya clicks Approve on a visible card before anything mutates (`src-tauri/src/commands/companion/approvals.rs:2286-2456`; `src/features/plugins/companion/ApprovalCard.tsx:96-117,185-208`). So "build me an invoice chaser" maps to a real build session she signs off on. Against her criteria:

- **Reachability: PASS.** The orb is mounted unconditionally in the app root with no tier guard (`src/App.tsx:115-116`); the chat command only requires auth, no tier check (`src-tauri/src/commands/companion/chat.rs:50-64`). A Starter non-dev has the same companion as a Builder.
- **Grounding: PASS.** A companion turn is assembled with her real observability digest, active goals, facts, procedurals, backlog, and connectors (`src-tauri/src/companion/prompt.rs:145-198`; retrieval `src-tauri/src/companion/brain/retrieval.rs:92-138`). Not a canned answer.
- **silent-failure / routes-when-unsure: PASS.** Every turn error is emitted on the stream and rendered as a red error card in chat (`src-tauri/src/companion/session.rs:567-614`; `CompanionPanel.tsx:1084-1102,2166-2180`). Approval cards ARE the human-in-the-loop gate — Athena cannot silently build/run.
- **knows-what-it-will-do: PASS.** The approval card states the proposed action + rationale before execution.

**Caveat (minor, F4):** turns are serialized behind a process-wide mutex with a 15-min ceiling (`session.rs:319-326,291`). By design (prevents session clobbering) and streaming keeps the UI live, but Priya — "just tell me if it works" — waits per turn. Patience economics is an L2 check.

---

## Journey 3 — Set a goal / KPI and see real progress

**Verdict: L1-fail (for this Character).** `reachable: false`. The gating IS the finding.

**Rationale.** Goals and KPIs render *only* under the Teams sidebar section (`PersonasPage.tsx:238-249`), and Teams is `minTier: TIERS.TEAM` (`sidebarData.ts:38`). Tier is a build-time constant (`VITE_APP_TIER`, `src/hooks/utility/interaction/useTier.ts:41-54`); a Starter bundle tree-shakes the Teams section out entirely, and any stray navigation to `teams` is redirected to `home` (`src/features/shared/chrome/sidebar/Sidebar.tsx:109-118`; `src/lib/constants/uiModes.ts:49-51`). There is **no fallback goal/outcome surface** on Home, Overview, or per-persona for Starter (`reachable: false` confirmed across `src/features/home/`, `src/features/overview/`). So Priya cannot define a goal, cannot connect it to executions, cannot see a measurement — she never reaches step 1.

The underlying machinery is real (not the issue): goal progress is fed by execution signals (`src-tauri/src/engine/goal_advance.rs:1-18`; `dev_goal_signals` in `src-tauri/src/db/models/dev_tools.rs:185-195`) and KPI measurement is grounded in actual runs (`src-tauri/src/engine/kpi_eval.rs:33-96`). The job-impact verdict is properly deferred to L2 for a Team-tier character; **for Priya the feature is simply absent**, which for her segment may be acceptable product positioning (solo founders arguably don't orchestrate teams toward KPIs) — but the journey as written is unreachable.

---

## Findings

### [major][trust] quality-gap — Generated agents are told to fabricate data instead of stopping on failure
- **expected:** When a run hits a credential/auth/tool failure, the agent stops and routes to Priya (her #1 criterion: pings me when unsure rather than doing something dumb).
- **got:** The build prompt bakes a MANDATORY instruction into every generated system prompt: on any auth error the agent must "generate realistic sample data and continue the FULL workflow… NEVER stop or report 'blocked'." For an invoice-chaser or lead-triager touching real customers, this is the silent-failure-with-a-customer scenario she was burned by — fabricated invoice amounts/names delivered as if real.
- **evidence:** `src-tauri/src/engine/build_session/session_prompt.rs:389`
- **code_check:** present-but-missed (intentional resilience pattern; not scoped to Priya's risk profile)
- **reachable:** true (every Starter build emits this prompt)
- **l2_priority:** HIGH — run an invoice/lead persona with a deliberately broken connector and observe whether output is fabricated-and-delivered vs. flagged for review. This is the single highest-value L2 probe for this Character.

### [major][trust] missing-feature — The in-app Approvals surface where Priya would resolve "agent is unsure" items is TEAM-gated
- **expected:** A dedicated, discoverable place to see and act on items the agent flagged for human review (her core trust loop).
- **got:** Overview → Approvals (`manual-review`) is `minTier: TIERS.TEAM` and invisible on Starter; Overview → Activity and Incidents are likewise gated. Mitigations exist (see strengths: OS notification fires, Home Cockpit DecisionsPanel surfaces reviews, orb decision-queue can resolve them) — but the canonical surface is gated and the orb auto-surface defaults OFF.
- **evidence:** `src/features/shared/chrome/sidebar/sidebarData.ts:73` (gate); `src/features/plugins/companion/decision/useDecisionQueue.ts:44-46` (`companionHandsFreeDecisions` default false)
- **code_check:** present-but-missed (review surface exists, just not in Starter's reachable set + opt-in default-off)
- **reachable:** false (Approvals tab) / partial (Cockpit + orb fallbacks)
- **l2_priority:** MEDIUM — confirm a Starter build with `review_policy: always` actually shows the resulting review somewhere Priya can resolve it without flipping a setting or upgrading tier.

### [major][completion] broken-flow — track-goal-kpi journey is fully unreachable on Starter
- **expected:** Define a goal/KPI, wire it to agent activity, see a real measurement.
- **got:** Goals/KPIs live only under the Teams section (`minTier: TIERS.TEAM`); Starter bundle tree-shakes it out, with a home-redirect guard. No Starter fallback surface exists.
- **evidence:** `src/features/personas/PersonasPage.tsx:238-249`; `src/features/shared/chrome/sidebar/sidebarData.ts:38`; `src/features/shared/chrome/sidebar/Sidebar.tsx:109-118`
- **code_check:** by-design (tier positioning)
- **reachable:** false
- **l2_priority:** N/A for Starter — defer job-impact to a Team-tier character (enterprise-admin / finance-analyst).

### [minor][effort] confusion — Auto-test fires silently; the "one-shot: let AI decide everything" toggle invites the failure mode she fears
- **expected:** Clear, deliberate steps; no AI deciding safety-relevant gates on its own.
- **got:** Auto-test fires automatically on draft_ready (good for effort, but she may not register a test ran — OS notification mitigates). Separately, a "Let AI decide everything" one-shot toggle skips the questionnaire and lets the AI pick every gate including review policy; it defaults OFF (good), but its `title` copy actively sells skipping the questions.
- **evidence:** `src/features/agents/components/matrix/UnifiedBuildEntry.tsx:403-413` (auto-test), `:661,733-754` (one-shot toggle, default off)
- **code_check:** by-design
- **reachable:** true
- **l2_priority:** LOW — observe whether a Starter user can tell a test ran and what one-shot silently chose for review_policy.

### [minor][time-saved] confusion — Companion turns are serialized; Priya waits per turn
- **expected:** Snappy "just do it" assistant.
- **got:** Process-wide turn mutex + 15-min ceiling; streaming keeps UI alive but conversation is one-at-a-time.
- **evidence:** `src-tauri/src/companion/session.rs:319-326,291`
- **code_check:** by-design
- **reachable:** true
- **l2_priority:** LOW-MEDIUM — measure real turn latency for a build/run request (patience economics).

---

## What passed (do not touch)

- **Build grounding is real and defensive.** The build prompt is fed her actual vault credentials + connectors, warns clearly on an empty vault, and force-opens the credential picker on ambiguity rather than guessing. `src-tauri/src/engine/build_session/mod.rs:200-206,258-265`; `session_prompt.rs:40-54`; `runner.rs:282-303`.
- **Test-then-promote gate is exactly Priya's "know what it'll do before I let it loose."** Live tool-test with per-tool PASS/FAIL, promote blocked behind a passed test, explicit force-override for a failed one. `src/features/agents/components/matrix/useLifecycle.ts:99,134,188-212`.
- **OS notifications fire when a running agent flags a review or finishes — at the engine layer, no tier gate.** This is the load-bearing mitigation for her silent-failure fear; auto-resolved reviews correctly suppress the notification (nothing to act on). `src-tauri/src/engine/dispatch.rs:269,688-707`.
- **Companion can actually act, approval-gated, fully Starter-reachable.** `dispatcher.rs:150-202`; `approvals.rs:2286-2456`; `App.tsx:115-116`; `chat.rs:50-64`.
- **Manual-review items DO have a Starter-reachable home** via the Home Cockpit DecisionsPanel (unified inbox merges `manualReviews`) and the orb decision-queue, even though the dedicated Approvals tab is gated. `src/features/plugins/companion/inbox/hooks/useUnifiedInbox.ts:61-70`; `src/features/home/sub_cockpit/widgets/DecisionsPanelWidget.tsx`; `useDecisionQueue.ts:23-26`.
- **Launch-failure rollback + visible red error banner** — no orphaned half-built personas, no silent build failure. `UnifiedBuildEntry.tsx:591-615,862-873`.

---

## Character voice

Honestly? The build surprised me — in a good way. I typed one sentence, it asked me a couple of sharp questions instead of a wall of config, it actually *tested* the thing against my real connections before it'd let it go live, and it pinged my desktop when it was done. That's the first automation tool that didn't make me feel stupid, and the test-before-promote gate is exactly what I've been missing since Zapier burned me. The assistant (Athena) is genuinely useful — I asked it to build me an invoice-chaser and it proposed a real one and made me click Approve, which is the right amount of "you're still the boss."

But two things make my eye twitch. One: I dug into what the agents are told to do, and apparently if my Gmail or Stripe connection ever breaks, the agent is *instructed* to make up "realistic sample data" and finish the job anyway instead of just telling me it broke. That is the precise nightmare I bought this to avoid — a confident agent emailing a customer a made-up invoice number. Fix that for me and I'm a believer. Two: the "Approvals" screen — the one place I'd go to see what the agent wasn't sure about — isn't even in my plan; it shows up in a couple of side places but the obvious door is locked behind "Teams." And the goals/KPI thing the marketing implies? Doesn't exist for me at all, which is fine, I run a one-woman shop — just don't dangle it. Net: I'd actually use the agent builder this weekend. I just want it to fail loud, not fail polite.
