# C3 — 4-template redesign proposal (vision alignment check)

> Compact decompositions for four templates under schema v3.1
> (`C3-schema-v3.1-delta.md`). Not a full rewrite — a proposal the user
> can approve or redirect before I hand-author the JSON.
>
> Format per template: unifying goal → use cases (with emit events) →
> connectors (required/optional with fallback) → composition →
> adoption questions → notable removals.

---

## 1. Web Marketing — `scripts/templates/marketing/web-marketing.json`

**Unifying goal**: cross-channel marketing intelligence — detect what's
working, propose optimizations, carry the proposal history forward.

**Use cases (3)** — `trigger_composition: shared` (weekly Mon 9am),
`message_composition: combined` (one weekly report):

1. **uc_performance_scan** — weekly baseline: pull campaign performance
   + SEO metrics + cross-channel comparison.
   Emits: `marketing.report.delivered`, `marketing.performance.declining`.
   Review: `never`. Memory: `enabled` (metric baselines for trend).
2. **uc_optimization_proposals** — generate 3-5 concrete proposals
   (budget reallocations, A/B tests, landing-page fixes) per week;
   human reviews each → accept/reject → reason memorized.
   Emits: `marketing.optimization.proposed`,
   `marketing.optimization.accepted`, `marketing.optimization.rejected`.
   Review: `always`. Memory: `enabled` (proposal acceptance history).
3. **uc_cannibalization_watch** — weekly scan for paid-vs-organic
   cannibalization on tracked keywords. Was an internal flow in v1;
   promoted because it's a distinct user-toggleable job.
   Emits: `marketing.cannibalization.detected`.
   Review: `on_low_confidence`. Memory: `disabled` (stateless).

**Connectors**:
- `ad_platform` — required; user picks Google Ads / Meta / LinkedIn / Mailchimp at adoption via pick-or-choose on the connector credential step.
- `analytics_tool` — required; user picks GA4 / Search Console / PostHog / Mixpanel.
- No fallback — this persona is specifically about real data.

**Questions (5)**:
- `aq_ad_platform` — scope: connector[ad_platform]
- `aq_analytics_tool` — scope: connector[analytics_tool]
- `aq_business_type` — scope: persona (context for proposal framing)
- `aq_proposal_count` — use_case_ids: [uc_optimization_proposals]
- `aq_report_depth` — use_case_ids: [uc_performance_scan, uc_cannibalization_watch]

**Removals**: `flow_error_recovery` (internal mechanics → `error_handling`
prose). No adoption questions need removal — v1 didn't have UC-toggle
questions.

---

## 2. Game Character Animator — `scripts/templates/content/game-character-animator.json`

**Unifying goal**: turn one anchor character image into a complete
animation set ready to drop into a 2D game engine.

**Use cases (2)** — `trigger_composition: per_use_case` (both manual),
`message_composition: per_use_case`:

1. **uc_generate_sprites** — AI-generated sprite sheets for requested
   animation set (idle / walk / run / attack / crouch / death).
   Emits: `game.animation.generated` (per animation),
   `game.sprite_set.complete` (when all requested animations ship).
   Review: `always` (user approves each sheet before the next
   generates — 2D art iteration is subjective).
   Memory: `enabled` (style choices + rejection reasons per character).
2. **uc_procedural_idle** — programmatic breathing idle loop (no AI —
   vertex-shift on the anchor frame). Independent: user can enable
   this alone without uc_generate_sprites if they only want the
   procedural polish on an existing sprite set.
   Emits: `game.idle.rendered`.
   Review: `never`. Memory: `disabled`.

**Connectors**:
- `image_ai` — required only when `uc_generate_sprites` is enabled.
  User picks Leonardo AI / OpenAI Images at the connector credential
  step.
- No fallback (image AI is load-bearing for that capability).

**Questions (4)**:
- `aq_art_style` — use_case_ids: [uc_generate_sprites, uc_procedural_idle]
  (both need style; shared across both)
- `aq_frame_size` — use_case_ids: [uc_generate_sprites, uc_procedural_idle]
- `aq_animation_set` — use_case_ids: [uc_generate_sprites]
- `aq_image_model` — scope: connector[image_ai]

**Removals**: none — current v1 is tight.

---

## 3. Daily Personal Briefer — `scripts/templates/productivity/daily-standup-compiler.json`

> Filename is misleading — this is the Daily Personal Briefer.

**Unifying goal**: start each day informed, accountable, and focused.

**Use cases (3)** — `trigger_composition: per_use_case`,
`message_composition: combined` (when multiple UCs fire on the same
tick, concatenate; decision support fires alone so it's one message
anyway):

1. **uc_morning_briefing** — daily 7am consolidated briefing: niche
   news research + pending work review + goal progress check +
   prioritized actions for today. One message, multiple sections.
   Emits: `briefer.morning.delivered`, `briefer.goal.at_risk`.
   Review: `never` (briefing is informational; goal flags are
   notifications, not approvals).
   Memory: `enabled` (topic yield history, goal tracking ledger,
   prioritization patterns).
2. **uc_decision_support** — manual trigger: user invokes with a
   decision to structure. Produces a matrix (options × criteria),
   identifies principal tradeoffs, surfaces precedent from memory.
   Emits: `briefer.decision.analyzed`.
   Review: `always` (user picks the chosen option; outcome memorized).
   Memory: `enabled` (decision ledger for precedent lookup).
3. **uc_weekly_review** — Sunday 6pm: goal retrospective + idea
   backlog surfacing from the week's captures.
   Emits: `briefer.weekly.delivered`, `briefer.idea.captured`.
   Review: `always` (user triages ideas → memorized).
   Memory: `enabled`.

**Connectors**:
- None strictly required. Optional future connectors
  (google_calendar, slack) documented but not wired this pass.

**Questions (6)**:
- `aq_role_business` — scope: persona (context across all UCs)
- `aq_niche_keywords` — use_case_ids: [uc_morning_briefing]
- `aq_goals` — use_case_ids: [uc_morning_briefing, uc_weekly_review]
  (goals drive morning check-ins AND weekly retrospective)
- `aq_briefing_length` — use_case_ids: [uc_morning_briefing]
- `aq_briefing_time` — scope: persona (maps to shared 7am default; user overrides via trigger quick-setup if the TriggerComposition UI is shipped)
- `aq_content_type` — use_case_ids: [uc_weekly_review]

**Removals**: none from v1 questions. `flow_daily_briefing` was the
only flow; stays as the sum of the three UC flows.

---

## 4. Dev Clone — `scripts/templates/development/dev-clone.json`

**Unifying goal**: autonomous senior-developer clone — scans the
backlog, implements accepted items, reacts to PR feedback, bundles
releases.

**Use cases (4)** — `trigger_composition: per_use_case` (hourly scan
+ webhook + manual release + event-chained implementation),
`message_composition: per_use_case`:

1. **uc_backlog_scan** — hourly scan of the codebase for TODOs, tech
   debt, risk patterns. Produces candidate items for triage.
   Trigger: hourly polling.
   Emits: `dev.backlog.candidate` per finding.
   Review: `never` (triage happens in the next UC).
   Memory: `enabled` (architecture patterns, previously-triaged
   similar items).
2. **uc_triage** — event-listen on `dev.backlog.candidate`. Present
   each to human; accept/reject with memorized reasoning.
   Emits: `dev.backlog.triaged` (accepted or rejected).
   Review: `always`.
   Memory: `enabled` (triage ledger drives future scan filters).
3. **uc_implementation** — event-listen on `dev.backlog.triaged`
   (accepted only). Implement the change, open PR, manage review
   cycle. Reacts to PR comments via GitHub webhook sub-listener.
   Emits: `dev.pr.created`, `dev.pr.updated`, `dev.pr.merged`.
   Review: `always` (user approves PR merge; autonomy level modulates
   how much the agent does unattended).
   Memory: `enabled` (code style learned from review comments).
4. **uc_release_management** — manual trigger OR event-listen on a
   user-defined release cadence. Bundles merged PRs since last
   release, drafts release notes, holds for user approval.
   Emits: `dev.release.proposed`, `dev.release.accepted`.
   Review: `always`.
   Memory: `enabled` (release cadence + past note patterns).

**Connectors**:
- `github` — required. Auth: GitHub PAT with repo + pull_request scopes.
- `codebase` — required. Local codebase access via the codebase connector (same shape as Idea Harvester).
- No optional connectors.

**Questions (5)**:
- `aq_github_repo` — scope: connector[github]
- `aq_codebase` — scope: connector[codebase] with `ui_component: "CodebaseSelector"` (same selector Idea Harvester uses)
- `aq_improvement_scope` — use_case_ids: [uc_backlog_scan] (what the scan looks for: TODOs only / + tech debt / + risk patterns)
- `aq_autonomy_level` — scope: persona (affects review gate behavior across uc_implementation and uc_release_management)
- `aq_release_cadence` — use_case_ids: [uc_release_management] (weekly Friday / bi-weekly / on-demand only)

**Removals**: `flow_backlog_scan` + `flow_build_cycle` + `flow_pr_comment_reaction`
internal flows collapse into per-UC `use_case_flow` diagrams (≤10
nodes each per P6). `aq_config_2 (autonomy level)` rescoped from
capability to persona. No question deletions.

---

## Aggregate observations (to confirm with user)

1. **Event namespacing**: proposed namespaces — `marketing.*`,
   `game.*`, `briefer.*`, `dev.*`. Consistent with the
   `<domain>.<subdomain>.<action>` syntax from P7.
2. **Event-chained use cases are becoming a pattern**: Idea Harvester,
   Dev Clone, (and likely others) have UCs that event-listen on a
   previous UC's emit. The adoption UI needs to render event triggers
   without the quick-setup picker (they're not user-configurable).
3. **`review_policy: always` correlates with memory policy enabled**.
   Every review outcome persists as training data for the owning
   capability. This is true for every UC in the 4 proposals. Worth
   codifying: if `review_policy.mode != "never"`, the author SHOULD
   set `memory_policy.enabled: true` with an explicit context.
4. **Connector categories emerge**: `ad_platform`, `analytics_tool`,
   `image_ai`, `codebase`, `github` all behave like "service type
   registries" where the user picks a specific provider. The adoption
   UI should surface this via the connector credential step (pick
   provider → credentials for that provider) rather than requiring the
   template to pre-declare which provider.
5. **Persona-level questions that shape all UCs** (e.g.,
   `aq_business_type`, `aq_role_business`, `aq_autonomy_level`) land
   in the questionnaire before per-UC steps, scoped `persona`.

---

## What to check before I hand-author

- Does the use-case decomposition match your intent for each of the 4?
  (Specifically: should Web Marketing keep `uc_cannibalization_watch`
  as its own capability, or roll it into `uc_performance_scan`? Should
  Dev Clone split `uc_implementation` + `uc_triage` into two UCs, or
  fold triage into the scan?)
- Are the event namespaces right? Any domain you'd rename?
- Any questions missing that you'd expect a user to be asked?
- Anything you'd descope like we did with `uc_strategy_backtest` in
  Financial?

If the proposal looks aligned, I'll hand-author all 4 JSONs per v3.1.
If parts are off, redirect and I'll adjust this doc first.
