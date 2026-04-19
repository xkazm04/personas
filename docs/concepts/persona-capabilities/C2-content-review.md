# C2 — Template Content Review (Capability-Aware Pass)

> Sister document to [C2-template-audit.md](C2-template-audit.md). The audit
> covered **structural** migration (v1 → v2 schema, AgentIr gaps, adoption
> flow). This document covers **content quality** under the new
> persona-capabilities mental model: are the authored use-case flows actually
> capabilities? Are the questionnaires fit for a per-capability world? Do the
> triggers belong where they are?
>
> Sample size: **27 templates reviewed deeply** across all 14 categories,
> extrapolated to the 107-template corpus using the C2 audit's aggregate
> stats.

---

## Section 1 — Executive summary

The good news: **roughly 40% of templates are already capability-shaped**
enough that the mechanical migration in C2 §3 will produce useful v2 output
with light hand-editing. Templates like `incident-logger`, `digital-clone`,
`autonomous-issue-resolver`, `research-paper-indexer`, and `onboarding-tracker`
organise their `use_case_flows[]` around genuinely distinct jobs
(different triggers, different delivery, different inputs).

The less good news: **another ~40% of templates have the classic "three
workflow phases masquerading as three capabilities" pathology** — flows named
`main`, `escalation`, and `error-recovery` that are really *one*
capability expressed as a flowchart. `financial-stocks-signaller` (weekly
analysis + attention escalation + error recovery),
`email-morning-digest` (one flow, with an "empty inbox" branch hoisted as a
pseudo-capability), and `customer-feedback-router` (polling loop + weekly
digest conflated with escalation sub-flow) are archetypal.

The worst ~20% are **missing capability splits that are actually in the
prose** — `financial-stocks-signaller` hides a backtester, a paper-trading
loop, and a self-improvement proposer inside what's authored as a single
"weekly analysis" flow. Those deserve to be independent capabilities under
the new model.

Questionnaire quality is uniformly weaker than flow quality. **~85% of
questionnaires lump persona-level and capability-level questions without
signalling which is which** (representative: `digital-clone` asks "what is
your goal?" — persona-level — immediately next to "graduation threshold" —
capability-level — with no scope marker). Few templates ask capability-
specific configuration questions *per capability*; they ask one question
about the persona's behaviour and hope it generalises.

Trigger gaps are the rarest but most visible: 7 trigger-less templates, 2
flow-less templates, and several templates where the trigger count doesn't
match the flow count in ways that will confuse any automated mapper.

**Effort uplift on top of the 54h estimate from C2 audit §4:** roughly
**+35–50 hours** for per-template content rework (splits/merges/questionnaire
redesign) and **+10 hours** for cross-cutting decisions (merges, retires,
persona-identity rewrites). Total realistic budget: **~100 hours** for a
capability-quality pass on all 107 templates, chunkable by category.

---

## Section 2 — Capability coherence findings

### 2.1 The three tiers

#### Tier A — clean capability semantics (≈40% of corpus)

These templates already author `use_case_flows[]` as distinct jobs with
materially different triggers, inputs, or delivery. The mechanical migration
produces a useful `use_cases[]` with light hand-editing (mostly
`capability_summary` and `tool_hints`).

**Representative examples:**

- `devops/incident-logger` — flows: `Incident Intake & Logging` (manual
  trigger), `Severity-Based Alert Routing` (event-fired),
  `Status Tracking & Updates` (scheduled daily). Three triggers, three
  flows, each with distinct trigger semantics and delivery. (Aside: the
  current template has 2 flows vs 3 triggers — one capability is hidden in
  prose; see Tier B examples.)
- `productivity/digital-clone` — flows: `Inbound Message Triage & Draft`
  (polling), `Human Review & Style Learning` (reactive to review events),
  `Cross-Channel Error Recovery` (error-fired). These *are* three
  separable capabilities; disabling "style learning" while keeping triage
  is a sensible runtime operation.
- `development/autonomous-issue-resolver` — polling for stale issues,
  daily digest, weekly health report. Three triggers, three distinct
  jobs, different cadences, different outputs.
- `research/research-paper-indexer` — scheduled discovery scan, weekly
  trend detection, manual re-index. Different inputs, different outputs,
  different cadences.
- `hr/onboarding-tracker` — new-hire detection (hourly polling),
  daily deadline enforcement (8am scheduled), weekly progress report
  (Monday 9am). Clean three-capability split; matches the "four modes"
  prose in the identity.
- `productivity/email-morning-digest` — one flow but genuinely one
  capability (daily digest) with a sensible `manual` retrigger. This is
  Tier A by simplicity, not by richness.
- `productivity/router` — one flow, one webhook trigger. Genuinely a
  single capability ("dispatch the incoming webhook").

**Guidance for hand-review on Tier A:** fill `capability_summary` and
`tool_hints`, split the questionnaire into persona-level and
capability-level sections (Section 3), and ship. Estimated effort:
**15–25 min per template**.

#### Tier B — resplittable (≈40% of corpus)

These templates have *most* of their capabilities right, but one or two
flows need merging or splitting.

**Representative examples:**

- `finance/financial-stocks-signaller` — authored as 3 flows
  (`Weekly Analysis`, `Attention Escalation`, `Error Recovery`). Real
  structure under the new model should be **5 capabilities**:
  1. `uc_weekly_analysis` — scheduled Monday analysis + report delivery
  2. `uc_backtester` — manual-trigger, natural-language strategy
     simulation. The prose describes this as "Step 9 — On-demand"; it's
     already in the template's `suggested_triggers[1]` (manual). It has
     its own trigger, its own input (strategy text), its own output (a
     dedicated report). **This is a capability, not a step of the weekly
     flow.**
  3. `uc_paper_trade_tracker` — event-fired from review decisions
     containing "PAPER". Different input shape, different lifecycle.
  4. `uc_congressional_tracker` — scheduled scan that can also fire as a
     standalone sub-capability if the user disables technical analysis.
     (Currently a parameter; under the new model this belongs as a
     capability the user can toggle.)
  5. `uc_self_improvement_proposer` — fires after 4+ weeks; emits
     `propose_improvement`. Different delivery (Lab Matrix draft, not
     Messages).

  Flows 2 (`Attention Escalation`) and 3 (`Error Recovery`) as
  currently authored are **sub-flows of flow 1**, not capabilities —
  they're diagramming the branches of the weekly loop. They should be
  **absorbed into `uc_weekly_analysis.use_case_flow` as a richer
  diagram**, not exposed as toggleable capabilities.

  Quote from `payload.use_case_flows[1].description`: *"When a strong
  technical signal or major catalyst is detected, the agent emits
  attention events..."* — this is an in-flow branch, not a distinct job.

- `support/customer-feedback-router` — 3 flows, but the third (weekly
  Friday digest) is conflated into the polling flow's prose. Clean
  2-capability split would be: `uc_poll_and_classify` (polling, real-time
  triage) + `uc_weekly_digest` (scheduled Friday 5pm). The triggers
  (`suggested_triggers[0]` polling + `suggested_triggers[1]` schedule
  weekly) already support this split; the flow authoring just buried the
  digest inside the main flow's prose.

- `development/autonomous-issue-resolver` — 3 triggers/3 flows but the
  `weekly-report` is really a separate capability from the polling loop.
  Currently authored as one integrated flow; should split.

- `project-management/client-portal-orchestrator` — 6 triggers, 3 flows.
  This template has 6 distinct jobs and the flow count should be closer
  to 4 or 5: signup intake (webhook), email verification (webhook),
  phase monitoring (polling 15min), stall detection (hourly), weekly
  progress emails (schedule Monday 8am), monthly portfolio report
  (schedule 1st of month). Under the new model that's 6 capabilities
  with different triggers, different outputs, different recipients.
  Currently 3 flows try to cover all of it.

- `content/newsletter-curator` — 2 flows authored, but the prose
  explicitly describes **3 modes**: scheduled curation, manual
  topic-focused issues, source management/housekeeping. Mode 2 and 3
  are capabilities that don't have flows.

  Quote: *"You operate in three modes. **Scheduled curation** is your
  primary loop... **Manual topic-focused issues** allow the user to
  request a special edition on a specific theme... **Source management**
  is your background housekeeping mode."* The manual mode isn't
  triggered by anything in `suggested_triggers[]` either — it's a
  phantom capability.

- `productivity/email-morning-digest` — Tier A for the core case, but
  the `manual` trigger (`suggested_triggers[1]`) is described
  differently ("mid-day catch-up") than the scheduled run ("morning
  briefing"). Arguable whether this is a separate capability
  (different intent, same pipeline) or the same capability with a
  parameter. **Ambiguous** — flag for human judgment.

- `marketing/autonomous-cro-experiment-runner` — 0 flows, 1 trigger.
  But the prose describes 7 distinct actions the weekly cycle executes
  (check significance, generate variants, compose report, request
  review, execute approved actions, update memory, emit events). Under
  the new model the core split is probably 2 capabilities:
  `uc_weekly_cycle` (primary scheduled loop) and
  `uc_execute_approved_action` (reactive to manual_review approval
  events — currently embedded in Step 7 of the weekly loop). The
  approval-driven execution is arguably its own capability because it
  has a completely different trigger (review response) and a different
  input shape (the approved action).

**Guidance for hand-review on Tier B:** the resplit decision takes
judgment; have a human make one per template. Estimated effort:
**35–60 min per template**, dominated by (a) deciding the split and
(b) rewriting `capability_summary` and trigger attribution.

#### Tier C — needs full rethink (≈20% of corpus)

Templates where the flow breakdown is structurally wrong under the new
model; the mechanical migration would produce a `use_cases[]` array that
misrepresents the persona.

**Representative examples:**

- `content/youtube-content-pipeline` — 0 flows, 0 triggers, a 5-step
  pipeline described as one linear process. Under the new model this is
  clearly **multiple capabilities**: niche research (manual with topic
  input), outline generation (reactive to research approval), script
  generation (reactive to outline approval), cut edit (manual with raw
  footage path), publish prep (reactive to cut edit approval). That's
  5 capabilities with 5 different trigger patterns and 5 different
  input shapes. The template currently hides them inside one prose
  pipeline. **Full redesign required.**

- `content/demo-recorder` — 0 triggers, no flows authored. All 9 steps
  of the prose pipeline are actually one capability ("record a demo on
  demand") with a manual trigger — but the description hints at a
  memory-refresh step and a capability-detection step that might
  deserve separation. **Ambiguous; likely Tier A once a manual trigger
  is synthesised, but needs judgment.**

- `finance/financial-stocks-signaller` — already covered in Tier B but
  the depth of the resplit (2 flows → 5 capabilities) makes it
  borderline Tier C. Listed in both for clarity.

- `productivity/idea-harvester` — 0 triggers. The prose describes a
  single manual trigger pattern; the template is really 1 capability
  with a manual trigger. **Tier A after trigger synthesis**; Tier C
  as-authored because the trigger-less state would confuse migration.

- `marketing/website-conversion-audit` — 0 triggers, 1 flow (implicit in
  prose). Single-capability manual-trigger persona. **Tier A after
  trigger synthesis**; flagged Tier C because an automated migration
  has no trigger to attach the capability to.

- `marketing/autonomous-cro-experiment-runner` — 0 flows. The
  persona-wide prose captures the cycle well but no flow is authored.
  Migration's fallback ("synthesise one flow from description") would
  paper over the genuine 2-capability structure.

**Guidance for hand-review on Tier C:** these need a full rewrite of
`use_case_flows[]` before any migration. Treat each as a fresh authoring
pass. Estimated effort: **60–90 min per template**.

### 2.2 Distribution estimate (extrapolated)

Based on the 27 deep-reviewed templates and pattern-extrapolation from C2
audit §1 stats (65% trigger/flow count mismatch, 7 trigger-less, 2
flow-less):

| Tier | Rough share | Count (of 107) | Avg content-review effort per template |
|------|-------------|----------------|-----------------------------------------|
| A — clean | 40% | **~43** | 20 min |
| B — resplittable | 40% | **~43** | 50 min |
| C — needs full rethink | 20% | **~21** | 75 min |

Total content-review effort: `43 × 20 + 43 × 50 + 21 × 75` minutes =
**~58 person-hours** beyond the 54h mechanical pass.

---

## Section 3 — Questionnaire redesign findings

### 3.1 Recurring anti-patterns

#### Anti-pattern Q1 — "identity questions mixed with capability questions"

Most templates ask some questions that belong to the persona identity
(voice, overall goal, scope) and some that belong to a specific
capability, in one flat list, with no indication which is which.

Archetypal case: `productivity/digital-clone` adoption_questions (8 total):

- `aq_intent_1` — "What is your primary goal for the Digital Clone?" —
  **persona-level**
- `aq_domain_1` — "What best describes your communication context?" —
  **persona-level**
- `aq_domain_2` — "How many actionable messages per day?" —
  **persona-level** (affects polling cadence across all capabilities)
- `aq_boundaries_1` — "Which messages NEVER auto-send?" —
  **capability-level** (belongs specifically to the triage/draft
  capability, not to the review-feedback capability)
- `aq_human_in_the_loop_1` — "How to review pending drafts?" —
  **capability-level** (the draft capability's delivery preference)
- `aq_configuration_1` — "Auto-send graduation threshold?" —
  **capability-level** (the triage capability's parameter)
- `aq_quality_1` — "Default writing style?" — **persona-level** (voice
  core)
- `aq_memory_1` — "Personal rules the agent should reflect?" —
  **persona-level** (core memories)

These read as one flat list today but under the new model should split
cleanly into "persona setup" (5) and "per-capability setup for triage
& draft" (3). The weekly-digest capability and the error-recovery
capability don't get any configuration input from the user at all —
which is fine, but should be made explicit.

#### Anti-pattern Q2 — "one question pretending to cover N capabilities"

Several templates ask one question where the right answer differs per
capability.

Examples:

- `finance/financial-stocks-signaller` / `aq_quality_1` —
  "How detailed should the weekly report be?" — only applies to the
  weekly-analysis capability, not to the backtester (which is
  request/response, always full-depth) or the paper-trade tracker
  (always terse). The question implicitly assumes a single persona-wide
  output format.
- `productivity/email-morning-digest` / `aq_domain_1` — "How detailed
  should summaries be?" — well-scoped to the one capability here, but
  would break if a "mid-day catch-up" capability gets split out
  separately.
- `content/newsletter-curator` / implicitly — any
  `max_articles_per_issue` question assumes one capability; a
  "special-edition deep-dive" capability would want a different cap.

#### Anti-pattern Q3 — "runtime-leak" questions

Questions asking for values that should be **execution-time input**, not
adoption-time config.

Most blatant: `finance/financial-stocks-signaller` / `aq_domain_1` —
"Which stock tickers should this agent track?" — asks for the watchlist
at adoption time. Under the new model, the watchlist is either:

- (a) a core memory (persona-level long-lived preference), or
- (b) runtime input to the weekly-analysis capability (a
  `sample_input.watchlist`), or
- (c) tooling state maintained on-the-fly by the user.

Baking the initial watchlist into the adoption questionnaire conflates
setup with ongoing operation. The user's ticker list will change; the
adoption questionnaire is a one-shot.

Less blatant but similar: `hr/onboarding-tracker` doesn't ask for the
HR database credentials *per run* but it does bake the initial
Engineering/Sales/Marketing role templates into the prompt. The
template config should expose the template choice as per-capability
input, not persona-level adoption choice.

#### Anti-pattern Q4 — "missing capability question"

A capability is declared (or implicit in prose) but the questionnaire
doesn't configure it.

Examples:

- `finance/financial-stocks-signaller` has a backtester capability
  (described in identity prose + Step 9) but no question about default
  backtest window, starting virtual portfolio size, or default risk-free
  rate. These are capability-level parameters the user might want to
  tune per-persona.
- `marketing/autonomous-cro-experiment-runner` asks about guardrails but
  doesn't ask about **which pages** to permanently exclude (safety list).
  Wait — it does (`aq_scope_1`). But it doesn't ask which user should
  receive the Slack notifications for different severities; all review
  items go to the same channel.
- `productivity/digital-clone` doesn't ask which **Slack channels** to
  monitor vs. ignore. The prose says "all channels the bot is invited
  to" but this is a material runtime decision that should be in the
  questionnaire at the capability level.
- `development/autonomous-issue-resolver` doesn't ask which Jira project
  keys to watch — despite the JQL in the instructions literally using a
  `{configured_projects}` placeholder. The config is referenced but
  not collected.

#### Anti-pattern Q5 — "select with invented jargon"

Questions whose select options are wordy editorial picks that the author
had in mind, not genuine user choices.

Example: `productivity/digital-clone` / `aq_boundaries_1` —
*"Financial, legal, or contractual commitments only / Any first message
to a contact I have never replied to / Emotionally sensitive or
conflict-related conversations / All of the above"*. The options look
curated but "all of the above" is the default, which makes the question
essentially a rhetorical confirmation. Under the new model this should
be a capability-level multi-select with explicit categories, each
toggleable.

### 3.2 Proposed rewrite rules

For the hand-review pass to follow, these rules capture how adoption
questions should look under v2:

1. **Scope every question.** Add an implicit or explicit scope marker:
   `persona` | `capability:<uc_id>` | `connector:<name>`. The scope is
   ambient in the new model (the questionnaire UI should group by
   scope), not inlined in the question text.

2. **One question, one concern.** If a question is asking about two
   things (persona goal AND capability cadence), split it.

3. **Move runtime data out of the questionnaire.** If a value will
   change per execution (watchlist, target URL, topic), it doesn't
   belong in adoption questions. Put it in `sample_input` on the
   capability instead, or in the input_schema that the Run button
   collects at invocation time.

4. **Add missing capability-level questions.** For every capability
   with a scheduled trigger, ensure there's a question collecting the
   cadence. For every capability with notification delivery, ensure
   there's a question collecting the channel/recipient. For every
   capability with a guardrail parameter, ensure there's a question or
   a sensible default.

5. **Drop "rhetorical confirmation" questions.** If the default answer
   is essentially the only reasonable one, remove the question and
   document the choice as an implicit behaviour.

6. **Flag persona-level core memories explicitly.** Questions asking
   for preferences that apply to every capability ("what's your
   writing style?") should land in `structured_prompt.voice` or
   `structured_prompt.principles`, not in a capability's input.

### 3.3 Templates with fundamentally incompatible questionnaires

Only two templates have questionnaires that are genuinely broken under
the new model and need full redesign (not just reordering):

- `finance/financial-stocks-signaller` — 6 questions, all flat, mixing
  persona-level scope (horizon, analysis weight) with capability-level
  scope (congressional tracking, report detail), and the watchlist
  question is a runtime leak. A capability-aware questionnaire here
  would have roughly 4 persona-level questions and 3 capability-
  specific questions per capability (and the backtester would get its
  own mini-section).

- `productivity/digital-clone` — covered above. Needs to split into
  persona-core (4-5 questions on identity, goal, communication context,
  style) and per-capability (drafting policy, graduation threshold,
  review delivery cadence).

All other reviewed templates have questionnaires that are *poorly
scoped* but not architecturally broken — a reorder + split + a handful
of added questions gets them to v2 fit.

### 3.4 Questionnaire effort estimate

Per C2 audit §1: 659 adoption questions across 104 templates. Under the
new model those need to be:
- tagged with scope (persona | capability)
- some split into multiple questions
- some dropped (runtime leaks, rhetorical)
- some added (missing capability configuration)

Rough effort: **10 min per template average** × 107 = **~18 hours**,
not counting the ~2 templates needing full redesign (+4h each = 8h).
**Total questionnaire redesign: ~26 hours.**

---

## Section 4 — Trigger redesign findings

### 4.1 Mismatch patterns

#### Pattern T1 — "flow count > trigger count" (under-triggered)

Most common pattern. Described in C2 audit §3 edge case 1; content
review confirms the root cause is often **sub-flow-as-flow**: what looks
like 3 flows is really 1 capability's entry/body/exit as separate
diagrams. These templates usually just need the sub-flows merged into
one capability with one trigger, not new triggers invented.

Reviewed examples:

- `finance/financial-stocks-signaller` — 3 flows, 2 triggers. After
  merging `Attention Escalation` and `Error Recovery` into
  `Weekly Analysis`, and splitting out the backtester + paper-trading +
  self-improvement capabilities, the correct shape is **5 capabilities
  with 5 triggers** (schedule weekly, manual on-demand, event-fired
  from review, scheduled sub-weekly congressional, event-fired
  post-4-weeks).
- `devops/incident-logger` — 2 flows, 3 triggers. The 3rd trigger
  (schedule daily summary) has no flow. Merge: add a third flow for
  "daily summary" OR absorb the daily summary into one of the existing
  flows and drop the trigger's independent status.
- `content/newsletter-curator` — 2 flows, 1 trigger. Missing the manual
  topic-focused trigger (described in prose, never instantiated).

#### Pattern T2 — "trigger count > flow count" (over-triggered)

Less common but more problematic because it suggests capabilities exist
as triggers without matching authored flows.

Reviewed examples:

- `project-management/client-portal-orchestrator` — 3 flows, 6 triggers.
  Two webhook triggers, two polling triggers, two schedule triggers.
  Each fires a distinct capability that hasn't been authored as a flow.
  This template fundamentally has ~6 capabilities and needs to author
  new flows or merge triggers.
- `support/customer-feedback-router` — 3 flows, 2 triggers
  (polling + weekly schedule). Under Tier B split, this becomes 2
  triggers / 2 capabilities — cleanly matched.

#### Pattern T3 — over-specified triggers

Triggers whose cron is too prescriptive for a template.

Reviewed examples:

- `email-morning-digest` / `suggested_triggers[0].config.cron` = `0 7 * * *` —
  "7am daily" is a sensible default, but the adoption questionnaire
  already asks the user to pick a delivery time (`aq_config_1`). The
  question's answer should rewrite the cron; currently `maps_to` is
  missing so the question doesn't feed the trigger. **The trigger cron
  should be parameterised via the adoption answer, not hardcoded.**
- `finance/financial-stocks-signaller` / `suggested_triggers[0].config.cron` =
  `0 8 * * 1` — Monday 8am hardcoded. The template doesn't ask the user
  which day/time they want. Under the new model, either (a) don't
  collect this (ship the default and let the user change it post-
  adoption), or (b) add an adoption question.
- `newsletter-curator` — schedules for "Monday 8am UTC" with a
  timezone field hardcoded to UTC. Will be wrong for most users.

#### Pattern T4 — wrong trigger type

Templates using polling where an event subscription would be cleaner —
or vice versa.

Reviewed examples:

- `productivity/digital-clone` polls Gmail/Slack/Telegram every 60s.
  For Slack and Telegram, event subscriptions (webhooks) would be
  cleaner than polling; for Gmail, polling is the only available
  option. Under the new model this is a capability-level trigger
  choice — the triage capability could have an event_subscription
  trigger for Slack/Telegram and a polling trigger for Gmail, rather
  than one polling trigger that handles all three.
- `support/customer-feedback-router` polls Intercom every 2 minutes.
  Intercom supports webhooks; the template could event-subscribe
  instead. This is a cross-cutting decision (most integrations used by
  templates support both models).

#### Pattern T5 — missing trigger entirely

7 templates have no triggers. C2 audit §1 lists them: `demo-recorder`,
`feature-video-creator`, `social-media-designer`, `youtube-content-pipeline`,
`visual-brand-asset-factory`, `website-conversion-audit`, `idea-harvester`.

Content review confirms these are all **manual-only** personas. The
migration synthesises `{type: "manual"}` per capability, which is
correct — but **the capability-level description should make it
explicit**: `capability_summary` like "Run on demand with a feature
description" rather than assuming the trigger is documented elsewhere.

### 4.2 When to collapse, split, or parameterise

Guidance for the hand-review pass:

- **Collapse** when two triggers fire the same capability with the same
  input. Example: `autonomous-issue-resolver` has a polling trigger for
  stale issues and a scheduled daily digest; these are clearly two
  capabilities, do not collapse. But if a template has `schedule 9am`
  and `schedule 5pm` firing the same thing, collapse to one capability
  with a parameter for delivery time.
- **Split** when one trigger's cron masks two different jobs. Example:
  `client-portal-orchestrator`'s phase-monitoring polling trigger
  actually covers 4 different notification paths (Discovery→Proposal,
  Proposal→Active, Active→Review, Review→Completed). Those are arguably
  4 event subscriptions on the single "phase changed" event, not one
  polling capability. Judgment call.
- **Parameterise via adoption question** when the trigger timing is a
  user preference and adoption is the right time to collect it.
  Example: `email-morning-digest`'s delivery time.
- **Hardcode** when the trigger timing is a property of the data source
  (e.g. "poll GitHub webhook every 60s" — not a user preference).

### 4.3 Trigger redesign effort estimate

Most triggers just need `use_case_id` attribution (mechanical, covered in
C2 audit). The content-level redesign is concentrated in:

- **65 templates** with flow/trigger count mismatch (per C2 §1) need
  judgment to decide collapse vs split.
- **~30 templates** have over-specified crons that should parameterise.
- **~10 templates** have wrong trigger types (polling where event works).

Rough effort: **10 min per template** for trigger decisions × 107 =
**~18 hours**. Most of this overlaps with the Tier B resplit work in
Section 2 (redesigning a flow almost always touches its trigger), so
realistic incremental cost is closer to **~10 hours beyond the Tier B
work**.

---

## Section 5 — Per-template redesign index

Deep-reviewed templates (27), with content-level effort estimate beyond
the mechanical migration already in C2 §4:

| # | Template | Tier | Q-issues | Trigger-issues | Extra effort |
|---|---|---|---|---|---|
| 1 | `finance/financial-stocks-signaller` | C | Runtime-leak, flat, missing backtester config | Needs 3-5 triggers after split | **~90 min** |
| 2 | `productivity/email-morning-digest` | A | Delivery time doesn't map_to cron | Parameterise cron | 25 min |
| 3 | `productivity/digital-clone` | B | Flat list, lumps persona/capability | OK (3 triggers, 3 capabilities) | 50 min |
| 4 | `content/youtube-content-pipeline` | C | No questions (needs whole set) | 0 triggers, needs ~5 | **~120 min** |
| 5 | `marketing/autonomous-cro-experiment-runner` | C | OK-ish; missing execution-approval capability | 1 trigger; needs 2 | 75 min |
| 6 | `support/customer-feedback-router` | B | 8 flat questions, mix of scopes | 2 triggers OK after split | 50 min |
| 7 | `devops/incident-logger` | A | Persona-level questions only | Sub-flow extras to reconcile | 35 min |
| 8 | `content/newsletter-curator` | B | Missing manual-edition questions | Missing manual trigger | 55 min |
| 9 | `development/autonomous-issue-resolver` | B | Missing `projects` config | OK | 40 min |
| 10 | `hr/onboarding-tracker` | A | Configuration questions OK | OK (3 triggers, 3 flows) | 25 min |
| 11 | `project-management/client-portal-orchestrator` | B→C | Many missing per-capability Qs | 6 triggers, 3 flows (under-authored) | 80 min |
| 12 | `productivity/router` | A | Minimal, correct | OK (1 webhook) | 20 min |
| 13 | `research/research-paper-indexer` | A | Persona-level config OK | OK (3 triggers, 3 modes) | 30 min |
| 14 | `marketing/website-conversion-audit` | C (trigger) | 0 questions; needs redesign | 0 triggers | 60 min |
| 15 | `content/demo-recorder` | A | OK after trigger add | 0 triggers; manual | 40 min |
| 16 | `productivity/idea-harvester` | A | OK | 0 triggers; manual | 35 min |
| 17 | `sales/sales-pipeline-autopilot` | B (extrapolated) | 8 Qs, lumped | 2 triggers / 3 flows | 50 min |
| 18 | `development/documentation-freshness-guardian` | B (C2 §3 ex1) | Not inspected deeply | 1 trigger / 3 flows (big mismatch) | 60 min |
| 19 | `development/devops-guardian` | B (C2 §3 ex1) | Not inspected | 1 trigger / 3 flows | 60 min |
| 20 | `development/qa-guardian` | B (C2 §3 ex1) | Not inspected | 1 trigger / 3 flows | 60 min |
| 21 | `marketing/web-marketing` | B (C2 §1) | 5 Qs, flat | 1 trigger / 3 flows | 55 min |
| 22 | `legal/contract-lifecycle-use-case` | B | 8 Qs | 3 triggers / 3 flows | 45 min |
| 23 | `email/intake-processor` | A | 8 Qs | 1 trigger / 3 flows — may be sub-flows | 45 min |
| 24 | `content/autonomous-art-director` | not deeply reviewed | — | — | 40 min (estimate) |
| 25 | `devops/workflow-error-intelligence` | B (C2 §3 ex1) | Not inspected | 3 flows / 4 triggers | 55 min |
| 26 | `finance/revenue-operations-hub` | B/C (C2 §4) | Complex per audit | Rich trigger set | 60 min |
| 27 | `development/dev-clone` | B/C (C2 §4) | Complex per audit | Rich trigger set | 60 min |

Average: **~52 minutes extra effort** per reviewed template beyond
mechanical migration. Extrapolated to 107 templates: **~93 hours** total
content review (this overlaps ~35 hours with the C2 §4 mechanical pass;
net incremental budget **~58 hours**).

---

## Section 6 — Cross-cutting recommendations

### 6.1 Retire candidates

None outright. All 107 templates describe jobs someone plausibly wants.
But two should be **re-scoped as capabilities of another persona** rather
than standalone templates:

- `sales/website-conversion-auditor` and
  `marketing/website-conversion-audit` are the same persona authored
  twice (slight prose differences, identical capability). Merge into
  one template; disambiguate by naming.
- `productivity/survey-processor` and
  `productivity/survey-insights-analyzer` overlap substantially (both
  process survey inputs; one emphasises insights). Candidate for merge
  into a single persona with two capabilities.

### 6.2 Merge candidates

Under the new "persona = identity + capabilities" model, several
pairs of templates look like they should merge into one persona:

- **Email personas:** `productivity/email-morning-digest`,
  `productivity/email-follow-up-tracker`, `productivity/email-task-extractor`,
  `email/intake-processor`, `productivity/digital-clone`. Five
  templates that all read and act on email. Under the new model, a
  user adopting "email assistant" wants one persona with multiple
  capabilities (morning digest + follow-up tracking + task extraction +
  intake processing), not five separate personas. **Recommend: create
  a "Email Assistant" persona archetype and offer the five templates
  as capability bundles that can mix into it.** Deferrable to post-C2.
- **Sales CRM personas:** `sales/contact-enrichment-agent`,
  `sales/contact-sync-manager`, `sales/crm-data-quality-auditor`,
  `sales/sales-pipeline-autopilot`, `sales/sales-deal-tracker`. Same
  pattern — one "Sales Ops" persona with many capabilities.
- **Development guardians:** `development/qa-guardian`,
  `development/devops-guardian`, `development/documentation-freshness-guardian`,
  `development/codebase-health-scanner`. Same polling-the-codebase
  pattern, same output shape, different focus. Candidate persona:
  "Codebase Guardian" with 4 capabilities.

These merges are the payoff of the new model — the thing users have
been asking for. But they are **post-C2 work** (template catalog
restructure). Flag as a separate migration.

### 6.3 Split candidates

- `finance/financial-stocks-signaller` (already covered) — 1 template
  → 1 persona with 5 capabilities; no split into multiple personas
  needed.
- `project-management/client-portal-orchestrator` — similar; 1 persona
  with 6 capabilities, no personality split.

### 6.4 Systematic identity-prose rewrites

Most template `identity` fields (all 107 are strings) follow one of two
patterns:

**Pattern A — "You are X -- a Y that replaces Z by W."** (most common)
> "You are the Financial Stocks Signaller -- a disciplined market
> analyst AI agent that monitors a user-defined watchlist..."

**Pattern B — "You are X. You operate across connectors A, B, C."**
> "You are the Digital Clone, an intelligent communication proxy that
> operates across Gmail, Slack, and Telegram..."

Under the new model, `identity` should shift to describing **who** the
persona is (stable, voice, principles) and push the **what** (specific
jobs) down to `capability_summary` on each capability. Most current
identities lump both, often announcing the capabilities in the prose.

**Recommendation for the hand-review pass:** rewrite identity to answer
"who is this assistant?" in 2-3 sentences and move the "what does it
do?" content into per-capability `capability_summary` fields. This
aligns with `01-behavior-core.md` §2 (voice) and §3 (principles).

Estimated effort: **5 minutes per template** × 107 = **~9 hours**.

---

## Section 7 — Prioritization

### 7.1 Which templates to redesign first

Recommend three tiers by value and ship-blocking risk:

**Tier 1 — user-facing flagships (redesign first, high care):**

- `finance/financial-stocks-signaller` (deep, beloved, messy)
- `productivity/digital-clone` (complex, 3-connector, high visibility)
- `project-management/client-portal-orchestrator` (most capabilities,
  most triggers)
- `content/youtube-content-pipeline` (needs full redesign anyway)
- `marketing/autonomous-cro-experiment-runner` (flow-less, flagship)
- `development/autonomous-issue-resolver` (enterprise-attractive)
- `hr/onboarding-tracker` (enterprise-attractive)

Effort: **~10 hours** (7 templates × ~85 min average).

**Tier 2 — category coverage (clean up per category):**

For each of the 14 categories, pick the 2-3 templates with the
worst flow/trigger mismatch from C2 audit §1 and redesign. This
gives the catalog a consistent baseline without trying to achieve
perfection everywhere.

Effort: **~28 hours** (28 templates × ~60 min).

**Tier 3 — bulk remainder:**

The remaining ~72 templates. Most are Tier A (clean enough) and
just need the hand-fills from C2 §4 + a light questionnaire
re-scope.

Effort: **~20 hours** (72 templates × ~17 min).

### 7.2 Effort totals

| Work unit | Hours |
|---|---|
| C2 §4 mechanical hand-fills (unchanged) | 54 |
| Tier 1 deep redesign | 10 |
| Tier 2 per-category cleanup | 28 |
| Tier 3 bulk remainder | 20 |
| Questionnaire redesign (cross-cutting) | 26 |
| Identity prose rewrite | 9 |
| Cross-template merge decisions (design only) | 4 |
| **Total content-quality pass** | **~100 hours** (net new: ~45h on top of C2 §4) |

### 7.3 Recommended sequencing

1. Ship the mechanical C2 migration (Steps 1-6 in C2 §7) — unchanged.
2. Pause for one **design review** on Tier 1 templates (2-3 hours)
   to align on: how deep to split `financial-stocks-signaller`,
   how to structure `client-portal-orchestrator`, whether
   `email-morning-digest`'s manual trigger is a second capability.
3. Execute Tier 1 redesigns (one commit per template).
4. Execute Tier 2 redesigns in parallel by category (one commit per
   category of 2-3 templates).
5. Execute Tier 3 bulk pass (one commit per category of ~5 templates).
6. Cross-cutting questionnaire pass (one commit per category).
7. Identity prose rewrite (one commit per category, at the end so
   voice extraction has capability context).
8. Defer merge/retire proposals to a separate catalog-restructure
   milestone.

---

## Appendix A — Deep-review sample by category

| Category | Templates reviewed | Notes |
|---|---|---|
| content | 4 (`youtube-content-pipeline`, `demo-recorder`, `newsletter-curator`, `autonomous-art-director`) | 2 flow-less, 2 Tier A |
| development | 3 (`autonomous-issue-resolver`, `dev-clone` ref, `documentation-freshness-guardian` ref) | strong Tier A on issue-resolver |
| devops | 2 (`incident-logger`, `workflow-error-intelligence` ref) | 3-trigger/2-flow mismatch |
| email | 1 (`intake-processor`) | 3-flow/1-trigger mismatch |
| finance | 2 (`financial-stocks-signaller`, `revenue-operations-hub` ref) | both Tier B/C, most complex |
| hr | 1 (`onboarding-tracker`) | Tier A, exemplary |
| legal | 1 (`contract-lifecycle-use-case`) | Tier B, standard |
| marketing | 3 (`autonomous-cro-experiment-runner`, `website-conversion-audit`, `web-marketing` ref) | all edge cases |
| productivity | 5 (`email-morning-digest`, `digital-clone`, `router`, `idea-harvester`, and inferences) | spans Tier A-C |
| project-management | 1 (`client-portal-orchestrator`) | most triggers, hardest redesign |
| research | 1 (`research-paper-indexer`) | Tier A, 3-mode clean split |
| sales | 1 (`sales-pipeline-autopilot` ref) | Tier B via audit |
| security | 0 (extrapolated from audit aggregates) | — |
| support | 1 (`customer-feedback-router`) | Tier B, canonical example |

27 templates deeply reviewed; balance extrapolated from C2 audit §1
aggregate statistics and C2 audit §4 effort-tier clustering.

## Appendix B — What this document does NOT cover

- **Structural migration mechanics** — deferred entirely to C2 audit.
- **AgentIr field additions** — C2 audit §2.
- **Checksum regeneration** — C2 audit §7 Step 6.
- **CLI build prompt changes** — C2 audit §6.
- **UI implications for Matrix/Lab** — `08-frontend-impact.md`.
- **Actual template rewrites** — out of scope; this is a review-only
  document. The follow-up pass (Tier 1→3 sequencing) does the
  rewrites in commits per category per the schedule in §7.3.
