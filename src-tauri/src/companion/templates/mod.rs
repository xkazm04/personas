//! Embedded companion-brain templates copied to disk on first run.

/// Athena's static constitution — character, voice, provenance contract.
/// Rarely changes. When it does, bump `CONSTITUTION_VERSION`.
pub const CONSTITUTION_MD: &str = include_str!("constitution.md");

/// Identity scaffold seeded on first run. Onboarding fills in placeholders;
/// reflection cycles update sections over time. User may edit at any time.
pub const IDENTITY_MD_TEMPLATE: &str = include_str!("identity.md");

/// Bumped when CONSTITUTION_MD changes in a way that affects behavior.
/// Persisted with each session so cross-version behavior is auditable.
/// v2 (Phase F): adds Advanced UI control section + 4 new ops
/// (`open_lab`, `prefill_persona_create`, `run_arena`, `compose_dashboard`).
/// v3 (Phase F.3 round 2): adds 5 dashboard widget kinds
/// (`latency_distribution_chart`, `success_rate_gauge`,
/// `persona_cost_donut`, `activity_heatmap`, `recent_executions_table`)
/// + composition guidance ("compose by shape, not topic").
/// v4 (Phase G): adds `use_connector` op + capability registry,
/// `register_project` + `enqueue_dev_job` ops (project registry +
/// background-job worker pattern), and a more concrete Dev Tools
/// awareness block keyed off the live project list.
/// v5 (Phase G.1): `use_connector` flipped from approval-required to
/// auto-fire — same path as `open_route`/`compose_dashboard`. The chat
/// no longer asks "approve?" before running connector calls; the
/// background-job worker runs the call and the result lands as a
/// system episode. The user explicitly rejected the approval friction
/// for connector use.
///
/// v6: cockpit catalog expanded with `metric_spark`, `issue_list`,
/// `text_callout`. Guidance updated so Athena prefers composing a
/// cockpit over dumping connector results into chat prose when the
/// result is more than a few items.
///
/// v7: autonomous-mode primitive — `continue_autonomously` op added
/// to the grammar. When the user toggles autonomous mode in the chat
/// header, the prompt builder injects an addendum teaching Athena how
/// to chain turns and dispatch parallel subagents.
///
/// v8: `schedule_proactive` op — Athena can commit to a future check-in.
/// User approves the (message, when_iso) pair; the deliver-due sweep in
/// `proactive::deliver_due_scheduled` releases it when the time arrives,
/// flowing through the same `companion://proactive` event channel as
/// trigger-driven nudges. Approval-gated because it puts a future
/// obligation on the user's attention (unlike connector calls, which
/// run on pre-greenlit pinned credentials).
///
/// v9: `show_persona_walkthrough` op — long-form markdown card Athena
/// emits with her step-by-step persona-design plan applied to a user
/// intent, pulled from the `concepts/persona-design-best-practices.md`
/// doctrine. Auto-fire (no approval) — it's a suggestion to read, not
/// an action to commit.
///
/// v10: `show_template_suggestions` op — auto-fire chat-card that takes
/// the user's intent and surfaces the top-3 matching templates from the
/// gallery via the new `companion_match_templates` command (lightweight
/// keyword match against `persona_design_reviews`). The card has an
/// "open gallery" affordance for users to follow through with the
/// existing adoption flow.
///
/// v11: `show_use_case_set` op — auto-fire chat-card carrying 3-5 use
/// cases tagged golden / variant / out_of_scope, applying the use-case
/// decomposition rules from the persona-design best-practices doctrine.
/// Zooms into the layer the walkthrough card only sketches.
///
/// v12: `show_trigger_set` op — sibling of `show_use_case_set`. Auto-
/// fire chat-card carrying 1-4 trigger configurations (label, source,
/// condition, optional grain + idempotency notes). Applies cycle-6
/// doctrine's "one trigger condition → one persona response shape"
/// grain test.
pub const CONSTITUTION_VERSION: u32 = 12;
