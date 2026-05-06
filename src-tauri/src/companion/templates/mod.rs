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
pub const CONSTITUTION_VERSION: u32 = 5;
