//! Dev Tools repositories, split by table family.
//!
//! This tree replaces the single 10k-line `repos::dev_tools` module. Each child
//! owns one coherent set of tables (see the module-level notes below); nothing
//! here is a rewrite — the functions are the same ones `dev_tools.rs` held, moved
//! verbatim to the module that owns the tables they touch.
//!
//! `repos::dev_tools` survives as a re-export shim so existing call sites keep
//! resolving while they are migrated wave by wave.

/// The attention queue and undispatched-idea feed — a read model over many tables.
pub mod attention;
/// `dev_auto_runs` — durable record of a backlog-draining wave.
pub mod auto_runs;
/// Headless bench seeding — writes `dev_ideas` rows (plus the one auto-accept
/// `dev_triage_rules` row) in exactly the shape the overnight engine's triage
/// pass reads, so a bench night has real work to dispatch.
pub mod bench_seed;
/// `dev_competitions` and `dev_competition_slots`.
pub mod competitions;
/// `dev_contexts` and its caches: groups, relationships, file hashes, fingerprints,
/// and `context_health_snapshots`.
pub mod contexts;
/// `cross_project_relations` plus the portfolio health / tech radar / risk matrix
/// read models of the Codebases connector.
pub mod cross_project;
/// `dev_goals`, `dev_goal_signals`, `dev_goal_items`, `dev_goal_dependencies`.
pub mod goals;
/// `dev_ideas` — the backlog, its dedup spine and the triage page.
pub mod ideas;
/// `dev_kpis`, `dev_kpi_measurements`, `dev_kpi_bindings`.
pub mod kpis;
/// `dev_milestones` and `dev_milestone_items`.
pub mod milestones;
/// `dev_pipelines` — idea-to-execution.
pub mod pipelines;
/// Cross-project read models over goals/KPIs/projects (portfolio + pending work).
pub mod portfolio;
/// `dev_projects` — the project row itself and its per-project config columns.
pub mod projects;
/// `dev_scans`.
pub mod scans;
/// `dev_standards` — golden-standard scan findings (pipeline stage 3b).
pub mod standards;
/// `dev_tasks` — the run desk.
pub mod tasks;
/// `dev_triage_rules`.
pub mod triage_rules;
/// `dev_use_cases` and `dev_use_case_contexts`.
pub mod use_cases;
