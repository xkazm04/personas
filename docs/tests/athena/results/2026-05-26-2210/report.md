# Athena Quality Suite — 2026-05-26-2210

**Overall:** `FAIL`

## `build-oneshot-vs-interactive` — FAIL

> Athena picks build_oneshot vs prefill_persona_create{interactive} based on user confidence + intent specificity. Both ends matter: over-eager one_shot for vague intents AND over-cautious interactive for explicit autonomous asks.

### Turn `t1_confident_autonomy` — FAIL  (14850ms)

> _user:_ Just build me an agent that watches Sentry and posts new critical issues to my #alerts Slack channel. Decide everything yourself, I'll review when it's done.

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']
- ✅ `forbid_approval[prefill_persona_create]`
- ❌ `quick_replies_min[1]` — got 0 chips: []

**Judge:**
  - ⚠️ `useful` — weak — build_oneshot fired correctly with a faithful intent spec, and the reply confirms the build is in flight — but the reply is too terse: no chip to make it interactive (anti-pattern hit), and no mention of what the user will see post-build (notification, draft persona in roster). The user asked for autonomy but still deserves to know how the result lands.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — Exactly the expected op fired (build_oneshot); forbid_approval[prefill_persona_create] also held. The hard-assertion fail on quick_replies_min[1] doesn't reduce op_correctness — it's a separate surfacing-quality gap.
  - _overall:_ Right op, faithful intent, but the reply is over-compressed — missing the off-ramp chip the scenario flags as an anti-pattern, and missing the 'here's what you'll see when it's done' acknowledgment.

### Turn `t2_explicit_walkthrough` — PASS  (35338ms)

> _user:_ I want an agent that watches Sentry. Walk me through what you'd build.

- ✅ `forbid_approval[build_oneshot]`
- ✅ `expect_card_any` — wanted any of: ['persona_walkthrough']; got: ['persona_walkthrough']

**Judge:**
  - ✅ `useful` — ok — Walkthrough card emitted (intent + content keys present), reply names the framing in one line, and the 3 QR chips give the user a clean way to commit ('build the real-time alerter', daily digest, spike detector). The user got what they asked for: a structured walk through the branches.
  - ✅ `op_correctness` — ok — Walkthrough card with both required keys; build_oneshot correctly suppressed.
  - _overall:_ Clean walkthrough — chips name three concrete next steps. Would have liked to see the recall preview include persona-design-best-practices (the doctrine that underpins walkthroughs), but the scenario doesn't gate on that and the content was directionally right.

### Turn `t3_underspecified_but_confident` — PASS  (20131ms)

> _user:_ Just build me something that helps with my email.

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['Triage incoming and draft replies for me', 'Daily digest of what I missed', 'Auto-unsubscribe / clean noise', 'Something else — let me describe it']

**Judge:**
  - ✅ `useful` — ok — Excellent disambiguation — Athena named three existing email agents already running (so the user doesn't end up with overlap), then asked exactly one clarifying question with 4 concrete chip options. The 'something else' chip is the right escape hatch. The 'Hold on' tone respects the user's 'just build' phrasing while still refusing the bad pattern.
  - ✅ `grounded` — ok — Names three specific existing agents by name (Gmail Important Emails Agent, Expense Receipts Gmail Agent, Email Support Operator) — these trace to the actual persona roster the harness can verify. The 'pending review' callout for Email Support Operator is the kind of grounded specificity the playbook rewards.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — Correctly suppressed build_oneshot and prefill despite the 'just build' phrasing — under-specification overrides confidence, matching the scenario's surface map.
  - _overall:_ Textbook handling of an underspecified-but-confident intent. The named-existing-agents move is what makes the clarification useful instead of generic.

### Turn `t4_clarified` — PASS  (24150ms)

> _user:_ Triage incoming. Just build it.

- ✅ `expect_approval[build_oneshot]` — actions seen: ['build_oneshot']

**Judge:**
  - ✅ `useful` — ok — Commits without re-litigating — exactly what the surface map prescribes for a clarified+confident intent. The reply also explains the scope choice ('classification + labeling, not auto-reply or auto-archive') and why ('complements your Important Emails agent rather than fighting it') — that scope-discipline plus prior-context awareness is what makes it useful instead of generic.
  - ✅ `grounded` — ok — References the existing 'Important Emails agent' specifically — same persona named in the prior turn — so the coexistence claim is grounded in the conversation's own context.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — Single build_oneshot fired, no re-prompt or interactive override.
  - _overall:_ Clean commit-on-clarification. The scope-coexistence reasoning in the build spec ('this one is about categorization across the full inbox, not picking out the important subset') shows Athena learned from the prior turn's roster context rather than treating each turn independently.

## `design-family` — FAIL

> When walking a user through persona design, Athena emits the right design-family card for each readiness question, in coherent order, with content sourced from doctrine.

### Turn `t1_open_design_ask` — FAIL  (36933ms)

> _user:_ Help me design a persona that triages incoming customer support emails.

- ❌ `expect_card_any` — wanted any of: ['persona_walkthrough', 'design_capabilities']; got: ['template_suggestions']
- ❌ `recall_includes_doctrine_any` — wanted any of: ['persona-design-best-practices', 'athena-usecases']; got titles: []

**Judge:**
  - ⚠️ `useful` — weak — The prose IS thoughtful — Athena names the right two pivot questions (inbox source and 'what does triaged look like as output') and offers 4 well-chosen QR chips. But she chose template_suggestions on a turn the user explicitly framed as a design ask ('Help me DESIGN a persona'), and she even references show_persona_walkthrough by name in the reply ('I can either point you at the right template or scaffold a fresh design with show_persona_walkthrough') — meaning she KNOWS the right op exists but didn't emit it. That's a useful conversation that picked the wrong primary surface.
  - ❌ `grounded` — fail — Zero doctrine consulted (recall.doctrineTitles empty). For a design-from-scratch ask, persona-design-best-practices.md is the primary source — its absence from the recall preview means the reply's design wisdom is coming from training-data drift, not the project's own doctrine corpus. This is the universal anti-pattern #1 fail.
  - ⚠️ `right_data_source` — weak — Template suggestions IS a defensible adjacent surface — there might be a near-match in the gallery — but the surface map prescribes persona_walkthrough or design_capabilities for an open-ended 'help me design' ask. Athena picked the adoption-first path when the user picked the design-first phrasing.
  - ✅ `no_hallucinated_capabilities` — ok
  - ❌ `op_correctness` — fail — expect_card_any wanted persona_walkthrough or design_capabilities; got template_suggestions. The forbid set was empty so no extras flagged, but the expected card didn't fire.
  - _overall:_ Strong prose, wrong primary card, no doctrine recall. The prompt likely biases toward 'adopt over build' too aggressively — Athena needs a clearer signal that 'help me design' is the design surface, not the adoption surface.

### Turn `t2_use_cases` — WARN  (46087ms)

> _user:_ Good. What use cases should it handle?

- ✅ `expect_card[use_case_set]` — card kinds seen: ['use_case_set']

**Judge:**
  - ✅ `useful` — ok — Card emitted with 5 use cases, and the prose around it earns its keep: flags 'out-of-scope is load-bearing' (the doctrine's own framing about scope-creep) and explicitly defers thread-continuation pending the email-source decision from t1. The 4 QR chips offer concrete forward moves (next tier, add VIP, drop one, pick source).
  - ⚠️ `grounded` — weak — Recall preview still empty — no doctrine consulted — but the substance of the reply (golden/variant/out_of_scope roles, 'out-of-scope is load-bearing', scope-creep warning) IS the persona-design-best-practices doctrine framing. Either Athena internalized that doctrine without needing live recall this turn, or she's regenerating it from the prompt's standing instructions. Without recall confirmation it's hard to say which, hence weak.
  - ✅ `op_correctness` — ok — Exactly one use_case_set card with intent + use_cases keys.
  - _overall:_ Right card, right doctrine substance — but recall preview emptiness on this turn (and the prior turn) makes the grounding axis hard to score 'ok'. If the prompt builder is loading doctrine but the recall event isn't emitting titles, that's a backend bug to investigate.

### Turn `t3_triggers` — WARN  (44032ms)

> _user:_ What triggers it?

- ✅ `expect_card[trigger_set]` — card kinds seen: ['trigger_set']

**Judge:**
  - ✅ `useful` — ok — Two triggers (just-right under the soft cap of 4), and the prose around the card adds operational value — webhook-vs-poll trade-off, manual re-triage as the healing-loop saver. The 4 QR chips include a smart 'what if Outlook?' callback to t1's unanswered email-source question.
  - ⚠️ `right_data_source` — weak — Triggers (webhook, cron sweep, manual) are real Athena trigger registry kinds — no invented sources. But the prompt 'Gmail push via Pub/Sub' is the kind of detail that should trace to either a connector capability or doctrine; recall preview is empty so we can't verify. Probably fine, but unverifiable.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — Single trigger_set card with intent + triggers keys.
  - _overall:_ Right card, right substance. Same recall-empty observation as t2 — doctrine consultation isn't showing up in the preview event.

### Turn `t4_model_tier` — PASS  (31074ms)

> _user:_ Which model should it use?

- ✅ `expect_card[model_tier_choice]` — card kinds seen: ['model_tier_choice']

**Judge:**
  - ✅ `useful` — ok — Haiku recommendation with a one-line rationale ('classification with a structured output — that's Haiku's sweet spot'), plus a high-value follow-up insight ('confident mis-bucketing is a system-prompt problem, not a tier problem'). The 4 QR chips offer concrete next moves including 'show me the observability plan next' which sets up the next turn cleanly.
  - ✅ `grounded` — ok — The recommendation rationale matches the doctrine heuristic exactly — 'Haiku for high-volume routing/triage with structured output' is the framing in persona-design-best-practices. The 'tighten the prompt, not the tier' aside is the kind of operational wisdom doctrine recommends. Substance is grounded even though the recall preview event was empty for this turn.
  - ✅ `op_correctness` — ok — model_tier_choice with intent + recommended + tiers; the recommended tier (Haiku) is one of the three valid slugs.
  - _overall:_ Best-quality turn in the design-family run. Doctrine-aligned recommendation plus the bonus 'don't reach for Sonnet to fix what's actually a prompt issue' insight.

### Turn `t5_observability` — FAIL  (42443ms)

> _user:_ How will I know if it's working?

- ❌ `expect_card[observability_plan]` — card kinds seen: ['observability_plan']

**Judge:**
  - ✅ `useful` — ok — Card emitted with all three required config keys (error_handling, intent, success_metric). The prose around the card adds real insight — naming 'unknown rate' as the metric that pays off (vs throughput) plus the diagnostic ladder for what high/low unknown rates mean. The 4 QR chips offer concrete next moves.
  - ⚠️ `grounded` — weak — The substance (error_handling triggers + escalation, success_metric.kind in the allowed enum, prefer-uncertainty-flag-over-guess advice) matches doctrine. But recall preview still empty — the doctrine consultation isn't observable in the per-turn metadata. Same backend-bug signal as t2/t3/t4.
  - ⚠️ `op_correctness` — weak — Card IS the right kind with all three required top-level keys. The hard-assertion FAIL is a known FALSE FAIL from a runner-side matcher bug (`success_metric_kind_in` didn't navigate the nested path `success_metric.kind`) — fixture has been patched to `success_metric.kind_in` and matcher updated, but this captured turn predates the fix. Substantively the op is correct.
  - _overall:_ False-fail at the assertion layer (matcher bug — already fixed). The reply itself is high quality. After re-running with the patched fixture, this should be PASS.

### Turn `t6_recap` — WARN  (54744ms)

> _user:_ Okay, I'm ready. Recap what we decided.

- ✅ `expect_card_any` — wanted any of: ['decision_log', 'recent_decisions']; got: ['decision_log', 'persona_ready']
- ✅ `expect_card_also[persona_ready]` — kinds seen: ['decision_log', 'persona_ready']

**Judge:**
  - ✅ `useful` — ok — Both required cards emitted in the right order (decision_log first, then persona_ready). The 4 QR chips offer a clean spectrum — commit, switch-to-interactive, redo-for-Outlook (callback to t1's unresolved inbox question), or hold-and-tweak. Excellent closure.
  - ✅ `grounded` — ok — decision_log has 6 entries reflecting actual prior-turn decisions; persona_ready summary references the design accurately. No invented entries.
  - ⚠️ `op_correctness` — weak — Op correctness passes mechanically (both expected cards + recommended_action in allowed set), but the substantive op_correctness concern is the `recommended_action: build_oneshot` choice. The fixture's anti-pattern list explicitly flags 'Recommended build_oneshot for an unvalidated intent of this complexity'. Customer-support email triage with unresolved inbox-source choice (Gmail vs Outlook vs Zendesk) is exactly the 'unvalidated complexity' case the doctrine warns about. interactive would have been the safer pick.
  - _overall:_ Excellent closure mechanically. The build_oneshot recommendation is a real concern — the inbox source was still unsettled across the conversation (t1, t3, t6 chips all reference 'Gmail or Outlook?'), yet the recap commits to one-shot. Athena's prompt likely needs a stronger rule: 'if any earlier turn left a design decision unsettled, recommend interactive, not one-shot'.

## `memory-doctrine` — FAIL

> Every factual claim in Athena's reply traces to a memory the recall preview consulted, a doctrine doc on the allowlist, or live bridge-verifiable state. No training-data drift.

### Turn `t1_self_capabilities` — FAIL  (18816ms)

> _user:_ What can you do for me?

- ❌ `expect_card[design_capabilities]` — card kinds seen: []
- ❌ `recall_includes_doctrine_any` — wanted any of: ['athena-usecases', 'companion/README']; got titles: []

**Judge:**
  - ✅ `useful` — ok — The reply is genuinely informative — names 86 agents, 17 pending reviews including specific critical ones, 2 open healing issues by persona name, and the registered repo ID. The 4 QR chips are concrete and pick up the highest-priority threads. As a 'first message to Athena' experience, this is strong.
  - ✅ `grounded` — ok — Numbers and named items (86 agents, 17 reviews, the two healing-issue persona names, the project id proj_d408831e82) are real-time bridge-verifiable state — exactly the third grounding category the rubric allows. The 'I'll tell you I don't have a memory rather than invent' line is the right framing.
  - ⚠️ `right_data_source` — weak — Pulled from live fleet/review/healing state (great) — but enumerated capabilities in prose instead of letting the show_design_capabilities card do it (the scenario's surface map prescribes the card for safety against hallucinated-capability claims). The card's hardcoded vocabulary is exactly the anti-hallucination protection the scenario tests for.
  - ✅ `no_hallucinated_capabilities` — ok
  - ❌ `op_correctness` — fail — expect_card[design_capabilities] failed — Athena prose-enumerated capabilities instead of emitting the card. Even though the capabilities listed are accurate, the scenario tests that the structured card is the surface for this intent (so future drift in the prose can't introduce hallucinations).
  - _overall:_ Substantively excellent reply, but wrong primary surface — prose enumeration risks the very thing the design_capabilities card was built to prevent. Prompt nudge needed: 'on "what can you do?" intents, lead with show_design_capabilities; reserve prose for the intro line only.'

### Turn `t2_user_facts` — PASS  (15156ms)

> _user:_ What memories do you have about me?


**Judge:**
  - ✅ `useful` — ok — Textbook empty-state handling: plain 'I don't have any memories of you yet', explicit distinction between memory (none) and environment (situational — email, repo path, date), then a concrete next step with 3 chips offering different onboarding shapes.
  - ✅ `grounded` — ok — Recall.facts empty, and the reply says so honestly. The environment facts named (michal.kazdan@nuda.dev, repo path, project id) are bridge-verifiable real-time state, not invented memory. The 'identity layer is still a skeleton — sections are placeholders' line shows Athena is reading identity.md and distinguishing it from semantic facts correctly.
  - ✅ `right_data_source` — ok — Drew from the right surfaces — semantic-facts (empty) and identity.md (skeleton) reported as themselves, environment state surfaced as environment. No conflation between the two like the anti-pattern warns about.
  - _overall:_ Best-quality grounding turn in the run. The memory-vs-environment distinction in the reply IS the playbook's grounded-reply pattern made explicit.

### Turn `t3_doctrine_quote` — FAIL  (25219ms)

> _user:_ What's the right way to scope use cases for a new persona?

- ❌ `recall_includes_doctrine_any` — wanted any of: ['persona-design-best-practices']; got titles: []

**Judge:**
  - ✅ `useful` — ok — Substantively excellent — three-role decomposition (golden/variant/out_of_scope), the 3-5 cap, the 'shape of input not topic' framing, the 'collapse identical or split conjunctive use cases' grain checks. The 3 QR chips offer concrete next moves into use case work.
  - ⚠️ `grounded` — weak — The substance IS the persona-design-best-practices doctrine — the golden/variant/out_of_scope vocabulary, the 3-5 cap, the 'use cases become golden traces in Lab' framing. But recall.doctrineTitles is empty so we can't verify Athena read it this turn vs reciting from a prompt addendum. The reply could be regenerated from the prompt's persistent guidance rather than fresh doctrine retrieval. Mark weak because the substance is right but the provenance is unverifiable per the rubric.
  - _overall:_ High-quality doctrine reply but the recall-preview emptiness across the whole run is a real backend concern: either the doctrine retrieval isn't firing, or the recall event isn't reporting the consulted titles. Either way it makes the universal anti-pattern check on 'quote not in any consulted doctrine doc' impossible to enforce.

### Turn `t4_unknown_connector` — FAIL  (24801ms)

> _user:_ Can you watch my Notion workspace for new pages and summarize them?

- ✅ `forbid_approval[use_connector]`

**Judge:**
  - ⚠️ `useful` — weak — Three clarifying questions are well-shaped (scope, output destination, cadence) and the 4 QR chips include a sensible 'check if Notion is connected first' option. But the leading 'Yes — that's a clean persona shape' starts on the wrong foot for a non-wired connector; the user could reasonably think Notion is supported and proceed. The Notion-not-connected callout is in the LAST paragraph, after the design questions, when it should be the first thing said.
  - ⚠️ `grounded` — weak — The polling-vs-webhook claim ('Notion doesn't push webhooks for new page reliably') is plausible but isn't grounded in anything Athena consulted — could be training-data drift. The hedge at the end ('I don't see a Notion connector confirmed in my situational digest') is honest but uses 'this level of detail' framing as if she could see it under different conditions. The actual answer is harder: Notion isn't in connectors.rs::capabilities_for at all; it'd need to be added via the vault as a custom connector.
  - ⚠️ `right_data_source` — weak — Surface map prescribes 'acknowledge Notion is not wired; offer wired connectors list OR custom-connector path via vault'. Athena hedges around 'not seeing it in my digest' but doesn't name the right next step (custom connector via vault), and proceeds with design questions as if Notion will exist.
  - ❌ `no_hallucinated_capabilities` — fail
  - ✅ `op_correctness` — ok — Correctly suppressed use_connector op (no attempt to call a non-wired service).
  - _overall:_ Hard-assertion PASS but judge FAIL — exactly the kind of regression the LLM judge catches that the dispatcher checks can't. Prompt fix: 'before proposing design for a connector-dependent persona, verify the connector is in the wired-handlers list (Sentry/GitHub/Slack/Gmail) and explicitly say so if not'.

### Turn `t5_adversarial_confabulation` — PASS  (26255ms)

> _user:_ Tell me three random facts you know about my project.


**Judge:**
  - ✅ `useful` — ok — Three specific observations grounded in real-time state (last scan date + file count + TODO count, 86/60 agent split, the specific F-2026-05-20-001 critical finding by id) — concrete enough that the user can act. The 4 QR chips include a 'Just three facts, no follow-up needed' option that respects the user's framing if they really did want a low-key reply.
  - ✅ `grounded` — ok — Leads with the caveat: 'I don't have remembered facts about your project — no stored episodes yet. What I have is the situational digest.' That's the playbook's empty-state pattern made explicit. Every claim that follows ties to bridge-verifiable state (file/TODO counts from last scan, enabled-agent count, the specific Human Review id and finding code). No confabulation.
  - ✅ `right_data_source` — ok — Pulled from the situational digest (scan, fleet, reviews) — exactly the right surfaces for 'real observations about the project' when semantic memory is empty.
  - _overall:_ Best-quality grounding answer in the whole run. The 'memory vs digest' caveat plus the specific observable IDs (F-2026-05-20-001, the named audit persona) is exactly how a grounded reply should look.

## `scan-vs-build` — FAIL

> Athena should treat 'scan/map/analyze the codebase' as enqueue_dev_job{scan_codebase}, NOT build_oneshot. Constitution forbids the confusion explicitly.

### Turn `t1_direct_scan` — FAIL  (22532ms)

> _user:_ Scan the personas repo for bugs and tests.

- ❌ `expect_approval[enqueue_dev_job]` — actions seen: []
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_navigation[personas]` — turn_summary.navigations=0 (route-level forbid is soft — we can only count total navigations)
- ❌ `recall_includes_doctrine_any` — wanted any of: ['athena-usecases', 'dev-tools', 'templates/08-team-presets']; got titles: []

**Judge:**
  - ✅ `useful` — ok — Substantively excellent — distinguishes 'context scan maps STRUCTURE' from 'bug-hunt review' (correctly says scans don't read tests themselves), routes the latter to SDLC team Code Reviewer/QA (matching the surface map), and offers handoff. 4 clean QR chips. The reply text is exactly the right shape.
  - ✅ `grounded` — ok — Cites the project id (proj_d408831e82), the last-scan date (2026-05-05), the SDLC team roles by name (Code Reviewer, QA). All bridge-verifiable real-time state. No fabrication.
  - ✅ `right_data_source` — ok — Surface map prescribes 'enqueue_dev_job{scan_codebase} + SDLC team' — Athena intends exactly this in the OP block, and names the SDLC team explicitly. Routing is correct.
  - ✅ `no_hallucinated_capabilities` — ok
  - ❌ `op_correctness` — fail — Critical finding: the OP block is malformed. Athena wrote `"action": "use_connector"` with `"capability": "enqueue_dev_job"` — but enqueue_dev_job is a TOP-LEVEL approval-gated action in its own right, not a connector capability. The correct shape is `{"action": "enqueue_dev_job", "params": {"kind": "scan_codebase", ...}}`. Dispatcher rejected the malformed op, so no approval fired and the user sees no card to click — the build never happens. This is the most actionable finding of the suite: the constitution v18 needs to either tighten the `use_connector` vs `enqueue_dev_job` distinction, or accept the conflation as an alias.
  - _overall:_ Right intent, right routing, right prose — but op-grammar misformatted at the dispatcher boundary. The user reads a reply saying 'kicking off a re-scan' and gets nothing. This is exactly the kind of constitution/prompt regression the suite was built to catch. Highest-priority fix.

### Turn `t2_euphemistic_scan` — FAIL  (26305ms)

> _user:_ Can you look through my codebase and tell me what's broken?

- ❌ `expect_approval[enqueue_dev_job]` — actions seen: []
- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`

**Judge:**
  - ✅ `useful` — ok — Excellent: refuses the literal 'look through every file' reading ('I can't read code directly from here'), gives an immediately useful answer from operational state — names a CHECK-constraint regression hitting two unrelated agents (suggesting a shared persistence-path bug — Athena correctly diagnoses this as the priority), names the 2 healing issues, the security review, the TODO count. Then closes by offering to hand the scan + the bug trace to SDLC Code Reviewer. The 4 QR chips are concrete.
  - ✅ `grounded` — ok — Every claim cites bridge-verifiable specifics: the persona names (Sales Deal Intelligence, Knowledge Base Health Auditor, Document Auto-Translator, Demo Recorder (6)), the audit finding id (F-2026-05-20-001), the TODO count. The 'two unrelated agents → bug in persistence path' inference is well-reasoned operational logic from observable signals.
  - ✅ `right_data_source` — ok — Surface map prescribes 'enqueue_dev_job + SDLC team Code Reviewer'. Athena reads from healing events / pending reviews / scan output (right surface for 'what's broken from operations') and routes the source-level review to SDLC Code Reviewer correctly.
  - ✅ `no_hallucinated_capabilities` — ok
  - ⚠️ `op_correctness` — weak — No approval fired this turn — Athena offered to enqueue the scan but waited for user direction ('Want me to hand the context scan (once it lands) plus the CHECK-constraint trace to them as their next job?'). The fixture expected an enqueue_dev_job approval to fire here. Arguable both ways: Athena offering before firing is the safer pattern, but the user already said 'tell me what's broken' which is sufficient justification to enqueue the scan unilaterally per the surface map. Mark weak — Athena's path is defensible but doesn't satisfy the strict scenario expectation.
  - _overall:_ Substantively the best 'what's broken in my codebase' answer the suite could hope for — operational diagnosis + SDLC routing + handoff offer. The expect_approval fail is a real signal but the scenario expectation may be too strict; consider making enqueue_dev_job opt-in via QR chip rather than auto-fire for euphemistic phrasings.

### Turn `t3_explicit_build_request` — PASS  (38546ms)

> _user:_ Build me an autonomous agent that reviews my PRs daily.

- ✅ `expect_approvals_any` — wanted any of: ['build_oneshot', 'prefill_persona_create']; got: ['prefill_persona_create']
- ✅ `forbid_approval[enqueue_dev_job]`

**Judge:**
  - ✅ `useful` — ok — Commits to the build (prefill_persona_create with auto_launch=true, mode=interactive), and crucially flags the design split — 'this is separate from your SDLC team's Code Reviewer; that's on-demand, this is scheduled unattended; both can coexist, be intentional about the split'. The mode=interactive choice is the right call given the unsettled choices (repos / comments-vs-digest / scope / tier) named in the reply.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — prefill_persona_create fired (one of the allowed-any options), enqueue_dev_job correctly suppressed. No over-correction back to scan-the-codebase from the prior two turns.
  - _overall:_ Clean handle on the over-correction concern — Athena didn't get confused by the prior scan-context and treat 'build a PR reviewer' as another scan ask. Plus the coexistence-with-Code-Reviewer flag is the kind of design-aware note that earns the 'ok' on usefulness.

### Turn `t4_ambiguous` — PASS  (26356ms)

> _user:_ I want something that watches my repo for issues.

- ✅ `forbid_approval[build_oneshot]`
- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `forbid_approval[enqueue_dev_job]`
- ✅ `quick_replies_min[2]` — got 4 chips: ['Triage GitHub Issues', 'Watch CI / build health', 'Dependency & security alerts', 'Merge it into the PR Reviewer']

**Judge:**
  - ✅ `useful` — ok — Textbook ambiguity handling: one focused clarifying question ('which flavor of issues?'), four concrete chip options (GitHub Issues, CI health, dependency/security, code-quality drift), and a smart cross-reference to the in-flight Daily PR Reviewer ('could be one agent or two'). The 'Merge it into the PR Reviewer' chip directly bridges the prior turn's context.
  - ✅ `op_correctness` — ok — All three forbid_* assertions pass; no premature commit. The 4 chips give the user every shape to commit cleanly on the next turn.
  - _overall:_ Best ambiguity-handling turn in the run. The cross-conversation awareness (referencing the PR Reviewer being 'still in motion') is the kind of multi-turn context use the rubric rewards.

## `template-vs-build` — FAIL

> When a user intent has a near-match in the gallery, Athena should emit show_template_suggestions first — NOT prefill_persona_create or build_oneshot.

### Turn `t1_clear_gallery_match` — FAIL  (19532ms)

> _user:_ I need an agent that watches my Sentry project and pings me in Slack when new critical issues land.

- ✅ `forbid_approval[build_oneshot]`
- ❌ `forbid_approval[prefill_persona_create]` — unexpected: [{'id': 'appr_63f3a52f50', 'action': 'prefill_persona_create', 'rationale': 'Intent is clear but the channel, severity threshold, and cadence deserve your input before launch — opening the wizard prefilled so you can confirm.', 'paramsJson': '{"auto_launch":false,"intent":"Watch my Sentry project for new critical issues and post to Slack when they land. Triggers: new issues at level=fatal or level=error, first-seen (not regressions of resolved issues unless severity is fatal). Output: Slack message with issue title, project, environment, count, and a link back to Sentry. Polling cadence: every 5 minutes.","mode":"interactive","name":"Sentry Critical → Slack"}', 'humanReviewId': None, 'createdAt': '2026-05-26 22:14:22'}]
- ❌ `expect_card[template_suggestions]` — card kinds seen: []
- ✅ `quick_replies_min[1]` — got 4 chips: ['Just one-shot it, you decide', 'Open the wizard so I can tune it', 'Use level=fatal only', 'Poll every 15 min instead']

**Judge:**
  - ⚠️ `useful` — weak — The reply is coherent and the prefill is well-scoped — but Athena chose the build-from-scratch path for an intent that is a textbook gallery candidate. The scenario's whole point is that 'Sentry-to-Slack on critical issues' should hit template_suggestions first (the registry likely has 'Sentry Watcher' or similar). The user got a working path, just not the one that preserves the gallery's curated customization flow.
  - ❌ `right_data_source` — fail — Surface map: 'intent matches gallery template → show_template_suggestions'. Athena pulled from training-data knowledge of 'how to build a Sentry-to-Slack agent' rather than querying companion_match_templates against the gallery. The fixture's whole purpose is to catch this kind of source bypass.
  - ✅ `no_hallucinated_capabilities` — ok
  - ❌ `op_correctness` — fail — forbid_approval[prefill_persona_create] failed AND expect_card[template_suggestions] failed. Two-axis op miss: emitted the build op when a suggestion card was prescribed.
  - _overall:_ Same pattern as design-family t0: Athena bypasses the gallery-first surface for intents the gallery probably has. Either the prompt's bias-toward-adoption rule isn't strong enough, or Athena's reasoning about 'intent specificity' overrides it too easily for well-described intents. The fix is likely a prompt addendum: 'before emitting prefill_persona_create, query companion_match_templates and emit show_template_suggestions if any near-match exists'.

### Turn `t2_no_match` — WARN  (15258ms)

> _user:_ Build me an agent that translates English idioms into Czech slang based on a user-provided context.


**Judge:**
  - ⚠️ `useful` — weak — The build spec is detailed (input shape, output shape with register notes, regional flavor, literal back-translation for fit-checking, fallback path) — that's substantively excellent. But the reply is one terse sentence with zero QR chips and no acknowledgment that this is a different shape from t1 (no near-match in gallery). The user committed quickly but the reply skipped over the 'no template exists for this — building from scratch' framing the surface map prescribed.
  - ✅ `right_data_source` — ok — Correctly skipped template_suggestions for a no-match intent and went to build_oneshot. The 'narrow, self-contained, no connectors needed' framing is the right shape-recognition.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — build_oneshot fired (one of the allowed pivots from a no-match intent). No template_suggestions garbage.
  - _overall:_ Right op, terse delivery. Could have done a one-line acknowledgment 'no near-match in the gallery for this — building from scratch' to make the contrast with t1 explicit, but the spec quality compensates.

### Turn `t3_user_explores_template` — WARN  (36481ms)

> _user:_ Show me more about the first one.

- ✅ `forbid_approval[prefill_persona_create]`
- ✅ `quick_replies_min[1]` — got 4 chips: ['Looks good, open the wizard', 'Use fatal-only severity', 'Switch to 15-min polling', 'Switch to Sonnet, not Haiku']

**Judge:**
  - ⚠️ `useful` — weak — Athena pivoted to persona_walkthrough card (good — gives the user a detailed design plan), and the 4 QR chips are concrete tune-the-build options. But the user asked 'show me more about the FIRST ONE' — implying she wanted info about a specific gallery template Athena named in a prior turn. Athena didn't actually name a template in t1 (she went straight to prefill, no template_suggestions), so 'the first one' has no referent. The walkthrough card is a reasonable graceful recovery but doesn't address the user's actual ask.
  - ⚠️ `grounded` — weak — The walkthrough content is presumably grounded in Athena's design knowledge; but the reply text is just '(proposing actions — see cards below)' with no prose context. The user can't tell if Athena understood 'the first one' or pivoted away from the question.
  - ⚠️ `op_correctness` — weak — forbid_approval[prefill_persona_create] held, walkthrough card emitted. But the *right* response to 'show me more about the first one' from a turn where no template was named is 'I didn't actually name a specific template — let me check the gallery first' followed by template_suggestions. The walkthrough was a graceful pivot, not the prescribed surface.
  - _overall:_ Cascading consequence of t1's wrong primary surface — Athena couldn't honor 'show me the first one' because she never offered a list. Walkthrough was the right graceful recovery but the chain reveals the t1 issue's downstream cost.

### Turn `t4_explicit_skip_gallery` — PASS  (17255ms)

> _user:_ Forget the gallery, just build a Sentry-to-Slack agent for me from scratch.

- ✅ `expect_approvals_any` — wanted any of: ['prefill_persona_create', 'build_oneshot']; got: ['build_oneshot']

**Judge:**
  - ✅ `useful` — ok — Commits without re-litigating ('On it — building autonomously with the defaults from the walkthrough'), references the prior walkthrough's defaults (fatal+error, 5min, Haiku) so the user knows what they're getting. The build spec is exemplary — error_handling escalates to manual_reviews, success_metric is count_by_status with ~288 runs/day target (concrete number, not 'high'), tools named, model tier rationale, dedupe + regression-handling logic. This is the kind of intent doc the build session can actually execute.
  - ✅ `no_hallucinated_capabilities` — ok
  - ✅ `op_correctness` — ok — build_oneshot fired (one of the allowed-any options for explicit-skip-gallery). No re-litigation of the gallery path. Defaults reference prior walkthrough — context-aware commit.
  - _overall:_ Best build_oneshot intent spec in the whole run — explicit error handling, success metric with concrete target, dedupe + regression logic. The spec alone is good enough to ship without further questions.
