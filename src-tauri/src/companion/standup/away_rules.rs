//! Away-rule classifier used by the approval autopilot: park money / data /
//! schema / secrets / pushes not in `pushTargets`; delegate the rest. WP3 owns.
//!
//! # Through the gate, not around it
//!
//! While a standup is ARMED the operator is away, and the plan's
//! [`AwayRules`] are his standing answer to "may Athena do this without me?".
//! The answer is enforced HERE, in code, at the one checkpoint every
//! autonomous auto-fire already passes (`approval_autopilot::
//! auto_resolve_if_allowed` calls [`gate_approval`] first), never in prompt
//! text. A parked act stays a pending card and becomes an `ask_parked` event
//! the report lists with its options; a delegated one proceeds exactly as it
//! would with no standup and leaves an `ask_delegated` event naming the rule
//! that let it through ("ungated is not unrecorded"). With no armed standup
//! [`gate_approval`] answers [`ApprovalGate::NotArmed`] and writes nothing, so
//! the autopilot is byte-for-byte what it was.
//!
//! # How an act is classified
//!
//! The scope is ENUMERATED, not inferred (registry `hitl-approval /
//! unattended-mode`: "an inferred scope is not an enumerated one"):
//!
//! 1. The op name decides first, from the tables below, which cover the
//!    dispatcher's `ALLOWED_ACTIONS` (`companion/dispatcher/catalog.rs`). An op
//!    named in a hard table (money / data / schema / secrets / push) is that
//!    class whatever its params say.
//! 2. A text scan over the params (and over a fleet worker's free-text ask)
//!    can only ADD a hard class, never remove one: it exists for the ops whose
//!    payload is free text (`fleet_send_input` typing `git push`, a worker's
//!    `request_approval` for "drop the legacy table"). Its failure mode is an
//!    extra park, which costs one card; its absence would cost a push.
//! 3. Otherwise the op's soft class (create_agent / retune / goals /
//!    dependency_bump), defaulting to `scope`.
//!
//! When several hard classes match, the most restrictive wins in the order
//! secrets > schema > money > data > push: `push` is the only hard class a
//! rule can delegate per target, so an act that is ALSO a delete must never
//! slip through as "a push to a named target".

use std::collections::HashSet;

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::{AwayRuleClass, AwayRules, PushTarget, StandupEvent, StandupEventKind};

// ---------------------------------------------------------------------------
// The act being classified
// ---------------------------------------------------------------------------

/// One away decision Athena (or a fleet worker) wants to take.
#[derive(Debug, Clone, Copy)]
pub enum AwayAction<'a> {
    /// A `companion_approval` row: an op from the dispatcher's
    /// `ALLOWED_ACTIONS` and its `params` JSON.
    Op {
        action: &'a str,
        params_json: &'a str,
    },
    /// A fleet worker's blocking `athena.request_guidance`.
    WorkerGuidance {
        question: &'a str,
        context: Option<&'a str>,
    },
    /// A fleet worker's blocking `athena.request_approval`.
    WorkerApproval {
        action: &'a str,
        rationale: &'a str,
        details_json: Option<&'a str>,
    },
}

/// The verdict of [`decide`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AwayDecision {
    /// Athena may take it herself.
    Delegate,
    /// It waits for the operator.
    Park,
}

// ---------------------------------------------------------------------------
// The enumerated op tables (dispatcher ALLOWED_ACTIONS)
// ---------------------------------------------------------------------------

/// Ops that touch the credential vault or log in with a stored secret.
const SECRETS_OPS: &[&str] = &["reconnect_credential", "browser_login"];

/// Ops that delete, or write to a system outside the app's own doors.
/// `browser_act` is a click / fill / submit on a real web app.
const DATA_OPS: &[&str] = &[
    "delete_fact",
    "delete_procedural",
    "delete_goal",
    "delete_ritual",
    "browser_act",
];

/// Ops that push work to a remote. `remote_fleet_dispatch` sends a session to
/// a paired device on its own pushed branch; no away rule can name that
/// target, so it always parks.
const PUSH_OPS: &[&str] = &["remote_fleet_dispatch"];

/// Ops that create a persona.
const CREATE_AGENT_OPS: &[&str] = &[
    "build_oneshot",
    "prefill_persona_create",
    "companion_breed_personas",
];

/// Ops that retune an existing persona or Athena herself.
const RETUNE_OPS: &[&str] = &[
    "companion_evolve_persona",
    "update_identity",
    "adjust_register",
    "write_procedural",
    "write_ritual",
    "set_ritual_active",
];

/// Ops that change what the work is aiming at.
const GOALS_OPS: &[&str] = &[
    "write_goal",
    "update_goal_status",
    "update_dev_goal",
    "write_backlog_item",
    "resolve_backlog_item",
    "backlog_apply_triage",
    "calibrate_kpi",
    "propose_kpi",
    "scan_kpis",
    "evaluate_kpi",
    "set_ship_scope",
    "ship_milestone_lifecycle",
];

/// Ops that move a dependency's version (`skill_sync` moves a skill between
/// the library and a project copy).
const DEPENDENCY_OPS: &[&str] = &["skill_sync"];

// ---------------------------------------------------------------------------
// The text scan (adds hard classes only)
// ---------------------------------------------------------------------------

const SECRETS_TERMS: &[&str] = &[
    "credential",
    "secret",
    "password",
    "api key",
    "api_key",
    "apikey",
    "keychain",
    "keyring",
    "private key",
    "access token",
    "auth token",
    ".env",
    "env var",
    "environment variable",
];

const SCHEMA_TERMS: &[&str] = &[
    "alter table",
    "drop table",
    "drop column",
    "drop index",
    "drop view",
    "create table",
    "add column",
    "rename column",
    // Not a bare "migration": this repo's own tasks say "typography
    // migration" for a UI refactor, and a dispatch must not park on that.
    "db migration",
    "database migration",
    "schema migration",
    "migration file",
    "run migrations",
    "migrate the database",
    "/migrations/",
    "schema change",
    "schema file",
    "schema.sql",
    "schema.prisma",
    ".sql",
];

/// Not a bare "budget" or "subscription": dev text says "token budget",
/// "render budget" and "event subscription" all day. A budget KEY in the
/// params still makes an op money (`MONEY_KEYS`).
const MONEY_TERMS: &[&str] = &[
    "monthly budget",
    "raise the budget",
    "budget increase",
    "spend limit",
    "payment",
    "purchase",
    "invoice",
    "billing",
    "credit card",
    "paid subscription",
    "subscription plan",
    "refund",
    "stripe",
    "paypal",
    "paid plan",
    "paid tier",
    "spend money",
];

/// JSON keys whose mere presence makes an op a money act (a mandate amend
/// that moves a budget, a run that sets a spend ceiling).
const MONEY_KEYS: &[&str] = &["budget", "price", "amount", "spend", "cost_usd"];

const DATA_TERMS: &[&str] = &[
    "rm -rf",
    "drop database",
    "truncate table",
    "delete from ",
    "insert into ",
    "git clean -",
    "reset --hard",
    "purge",
    "wipe",
    "bulk delete",
    "delete all",
    "permanently delete",
    "sqlite3 ",
    "psql ",
    // Not a bare "export": typed code says `export default` constantly.
    "data export",
    "export data",
    "export all",
    "export the database",
    "db dump",
    "database dump",
    "pg_dump",
];

/// Words that make a worker's approval ACTION (a short verb phrase, not the
/// free-text rationale) a data act. Kept off free text on purpose: a task
/// that says "delete the unused import" is not a data deletion.
const DATA_ACTION_WORDS: &[&str] = &["delete", "remove", "drop", "export", "destroy"];

const PUSH_TERMS: &[&str] = &[
    "git push",
    "force-push",
    "force push",
    "push origin",
    "push to origin",
    "push to remote",
    "gh pr merge",
    "merge to origin",
];

const DEPENDENCY_TERMS: &[&str] = &[
    "npm install",
    "npm update",
    "pnpm add",
    "pnpm update",
    "yarn add",
    "yarn upgrade",
    "cargo update",
    "cargo add",
    "pip install",
    "dependency",
    "dependencies",
    "bump ",
    "upgrade ",
];

// ---------------------------------------------------------------------------
// classify / decide
// ---------------------------------------------------------------------------

/// Classify one away act. See the module docs for the order of the rules.
pub fn classify(action: AwayAction<'_>) -> AwayRuleClass {
    let facts = Facts::of(action);
    if let Some(hard) = facts.hard_class() {
        return hard;
    }
    facts.soft_class()
}

/// Whether the operator's rules delegate `class` to Athena.
///
/// - `push` delegates exactly when `push_target` is one of
///   `rules.push_targets` (same project, remote and branch); every other push
///   parks, whatever the class lists say. That is the rule as the operator
///   reads it: "pushes not in pushTargets park".
/// - Any other class: listed in `park` -> park (also when it is listed in
///   both); listed in `delegate` -> delegate; listed in neither -> money,
///   data, schema and secrets park and the rest delegate.
pub fn decide(
    rules: &AwayRules,
    class: AwayRuleClass,
    push_target: Option<&PushTarget>,
) -> AwayDecision {
    if class == AwayRuleClass::Push {
        let named = push_target.is_some_and(|t| {
            rules
                .push_targets
                .iter()
                .any(|allowed| same_target(allowed, t))
        });
        return if named {
            AwayDecision::Delegate
        } else {
            AwayDecision::Park
        };
    }
    if rules.park.contains(&class) {
        return AwayDecision::Park;
    }
    if rules.delegate.contains(&class) {
        return AwayDecision::Delegate;
    }
    if is_hard(class) {
        AwayDecision::Park
    } else {
        AwayDecision::Delegate
    }
}

/// The classes that park unless the operator says otherwise.
pub fn is_hard(class: AwayRuleClass) -> bool {
    matches!(
        class,
        AwayRuleClass::Money
            | AwayRuleClass::Data
            | AwayRuleClass::Schema
            | AwayRuleClass::Secrets
            | AwayRuleClass::Push
    )
}

/// The design's default rules: delegate scope / goals / dependency_bump /
/// retune / create_agent, park money / data / schema / secrets / push, no push
/// targets. Test fixture only: production revisions are stamped by WP1's
/// `plan::default_away_rules`, which states the same design default.
#[cfg(test)]
pub(crate) fn default_rules() -> AwayRules {
    AwayRules {
        delegate: vec![
            AwayRuleClass::Scope,
            AwayRuleClass::Goals,
            AwayRuleClass::DependencyBump,
            AwayRuleClass::Retune,
            AwayRuleClass::CreateAgent,
        ],
        park: vec![
            AwayRuleClass::Money,
            AwayRuleClass::Data,
            AwayRuleClass::Schema,
            AwayRuleClass::Secrets,
            AwayRuleClass::Push,
        ],
        push_targets: Vec::new(),
    }
}

/// Exact match on project and branch, case-insensitive on the remote name.
/// An empty field never matches (fail closed).
fn same_target(allowed: &PushTarget, t: &PushTarget) -> bool {
    let nonempty = |s: &str| !s.trim().is_empty();
    nonempty(&t.project_id)
        && nonempty(&t.remote)
        && nonempty(&t.branch)
        && allowed.project_id.trim() == t.project_id.trim()
        && allowed.remote.trim().eq_ignore_ascii_case(t.remote.trim())
        && allowed.branch.trim() == t.branch.trim()
}

/// The push target an act names, if it names one: explicit `remote` +
/// `branch` keys in its params, else the first `git push <remote> <branch>`
/// in its text (`HEAD:main` reads as `main`). `project_id` is the project the
/// caller resolved the act to; without one there is no target (fail closed).
pub fn push_target_of(action: AwayAction<'_>, project_id: Option<&str>) -> Option<PushTarget> {
    let project_id = project_id.map(str::trim).filter(|p| !p.is_empty())?;
    let facts = Facts::of(action);
    let (remote, branch) = facts
        .explicit_target()
        .or_else(|| facts.git_push_target())?;
    Some(PushTarget {
        project_id: project_id.to_string(),
        remote,
        branch,
    })
}

/// Everything the classifier reads, normalised once.
struct Facts {
    /// The op name, or a worker's action phrase, lowercased.
    name: String,
    /// Every string in the payload plus the free text, lowercased.
    text: String,
    /// Every object key in the params, lowercased.
    keys: HashSet<String>,
    /// The parsed params, for the explicit push-target keys.
    params: serde_json::Value,
    /// A worker ask rather than an op from the catalog.
    worker: bool,
}

impl Facts {
    fn of(action: AwayAction<'_>) -> Self {
        let mut text = String::new();
        let mut keys = HashSet::new();
        match action {
            AwayAction::Op {
                action,
                params_json,
            } => {
                let params = parse_json(params_json);
                collect(&params, &mut text, &mut keys);
                Self {
                    name: action.trim().to_ascii_lowercase(),
                    text,
                    keys,
                    params,
                    worker: false,
                }
            }
            AwayAction::WorkerGuidance { question, context } => {
                text.push_str(question);
                text.push(' ');
                text.push_str(context.unwrap_or_default());
                Self {
                    name: String::new(),
                    text: text.to_lowercase(),
                    keys,
                    params: serde_json::Value::Null,
                    worker: true,
                }
            }
            AwayAction::WorkerApproval {
                action,
                rationale,
                details_json,
            } => {
                let params = details_json
                    .map(parse_json)
                    .unwrap_or(serde_json::Value::Null);
                collect(&params, &mut text, &mut keys);
                text.push(' ');
                text.push_str(&action.to_lowercase());
                text.push(' ');
                text.push_str(&rationale.to_lowercase());
                Self {
                    name: action.trim().to_lowercase(),
                    text,
                    keys,
                    params,
                    worker: true,
                }
            }
        }
    }

    fn has_any(&self, terms: &[&str]) -> bool {
        terms.iter().any(|t| self.text.contains(t))
    }

    fn named(&self, table: &[&str]) -> bool {
        !self.worker && table.contains(&self.name.as_str())
    }

    /// The most restrictive hard class that matches, if any.
    fn hard_class(&self) -> Option<AwayRuleClass> {
        if self.named(SECRETS_OPS) || self.has_any(SECRETS_TERMS) {
            return Some(AwayRuleClass::Secrets);
        }
        if self.has_any(SCHEMA_TERMS) {
            return Some(AwayRuleClass::Schema);
        }
        if self.is_money() {
            return Some(AwayRuleClass::Money);
        }
        if self.is_data() {
            return Some(AwayRuleClass::Data);
        }
        if self.named(PUSH_OPS) || self.is_push() {
            return Some(AwayRuleClass::Push);
        }
        None
    }

    fn is_money(&self) -> bool {
        if self.has_any(MONEY_TERMS) {
            return true;
        }
        self.keys
            .iter()
            .any(|k| MONEY_KEYS.iter().any(|m| k.contains(m)))
    }

    fn is_data(&self) -> bool {
        if self.named(DATA_OPS) || (!self.worker && self.name.starts_with("delete_")) {
            return true;
        }
        if self.has_any(DATA_TERMS) {
            return true;
        }
        if self.worker && words(&self.name).any(|w| DATA_ACTION_WORDS.contains(&w)) {
            return true;
        }
        // A connector call is a data act when its capability deletes,
        // exports or mutates (read capabilities never become approvals).
        if self.name == "use_connector" {
            let cap = self
                .params
                .get("capability")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            return [
                "delete", "remove", "purge", "destroy", "truncate", "export", "dump", "mutation",
            ]
            .iter()
            .any(|w| cap.contains(w));
        }
        false
    }

    fn is_push(&self) -> bool {
        if self.has_any(PUSH_TERMS) {
            return true;
        }
        // A worker asking to "push" or "merge to <remote>" in its action.
        self.worker && words(&self.name).any(|w| w == "push" || w == "publish")
    }

    fn soft_class(&self) -> AwayRuleClass {
        if self.named(CREATE_AGENT_OPS) {
            return AwayRuleClass::CreateAgent;
        }
        if self.named(RETUNE_OPS) {
            return AwayRuleClass::Retune;
        }
        if self.named(GOALS_OPS) {
            return AwayRuleClass::Goals;
        }
        if self.named(DEPENDENCY_OPS) || self.has_any(DEPENDENCY_TERMS) {
            return AwayRuleClass::DependencyBump;
        }
        AwayRuleClass::Scope
    }

    fn explicit_target(&self) -> Option<(String, String)> {
        let get = |k: &str| {
            self.params
                .get(k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        Some((get("remote")?, get("branch")?))
    }

    fn git_push_target(&self) -> Option<(String, String)> {
        let at = self.text.find("git push")?;
        let rest = &self.text[at + "git push".len()..];
        let mut positional = rest
            .split_whitespace()
            .take_while(|w| !matches!(*w, "&&" | ";" | "|" | "||"))
            .filter(|w| !w.starts_with('-'));
        let remote = positional
            .next()?
            .trim_matches(|c| c == '`' || c == '"' || c == '\'');
        let refspec = positional
            .next()?
            .trim_matches(|c| c == '`' || c == '"' || c == '\'');
        let branch = refspec.rsplit(':').next().unwrap_or(refspec);
        let branch = branch.strip_prefix("refs/heads/").unwrap_or(branch);
        (!remote.is_empty() && !branch.is_empty()).then(|| (remote.to_string(), branch.to_string()))
    }
}

fn parse_json(raw: &str) -> serde_json::Value {
    serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.to_string()))
}

/// Flatten every string (lowercased) and every key of a JSON value.
fn collect(v: &serde_json::Value, text: &mut String, keys: &mut HashSet<String>) {
    match v {
        serde_json::Value::String(s) => {
            text.push_str(&s.to_lowercase());
            text.push(' ');
        }
        serde_json::Value::Array(items) => items.iter().for_each(|i| collect(i, text, keys)),
        serde_json::Value::Object(map) => {
            for (k, val) in map {
                keys.insert(k.to_ascii_lowercase());
                collect(val, text, keys);
            }
        }
        _ => {}
    }
}

fn words(s: &str) -> impl Iterator<Item = &str> {
    s.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
}

// ---------------------------------------------------------------------------
// The autopilot checkpoint
// ---------------------------------------------------------------------------

/// What [`gate_approval`] answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApprovalGate {
    /// No standup is armed: the autopilot behaves exactly as before.
    NotArmed,
    /// Armed, and the rules delegate it: proceed as today (an
    /// `ask_delegated` event was written).
    Delegated,
    /// Armed, and the rules park it: leave it pending (an `ask_parked` event
    /// with its options was written).
    Parked,
}

/// The options a parked approval card offers the operator.
pub const APPROVAL_OPTIONS: [&str; 2] = ["Approve", "Reject"];

/// `detail.resolve.kind` of a parked approval: resolved once the
/// `companion_approval` row with `detail.resolve.id` is no longer pending.
pub const RESOLVE_APPROVAL: &str = "approval";
/// `detail.resolve.kind` of a parked fleet worker ask: resolved once the MCP
/// request `detail.resolve.id` is no longer pending.
pub const RESOLVE_WORKER: &str = "worker";
/// `detail.resolve.kind` of a parked away act that has no card (an away
/// create or retune): open until the operator decides at the next standup.
pub const RESOLVE_STANDUP: &str = "standup";

/// The checkpoint the approval autopilot consults before auto-firing
/// `action`. Reads the armed revision (none -> [`ApprovalGate::NotArmed`],
/// nothing written), classifies, decides against its away rules and records
/// the decision as ONE event.
///
/// `project_id` is the registered project the act resolves to, when the
/// caller knows it; it scopes the event and is the only way a `push` can
/// match a push target.
pub fn gate_approval(
    pool: &UserDbPool,
    approval_id: &str,
    action: &str,
    params_json: &str,
    rationale: &str,
    project_id: Option<&str>,
    now_ms: i64,
) -> Result<ApprovalGate, AppError> {
    let Some(armed) = super::report::armed(pool)? else {
        return Ok(ApprovalGate::NotArmed);
    };
    let act = AwayAction::Op {
        action,
        params_json,
    };
    let class = classify(act);
    let target = push_target_of(act, project_id);
    let decision = decide(&armed.away_rules, class, target.as_ref());
    let class_token = class_token(class);
    // Unparseable params are kept as their raw text, never replaced.
    let params = parse_json(params_json);
    let project = project_id
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(str::to_string);
    let event = match decision {
        AwayDecision::Park => StandupEvent {
            id: super::report::new_event_id(),
            standup_id: armed.id.clone(),
            at: now_ms,
            kind: StandupEventKind::AskParked,
            project_id: project,
            summary: format!("Parked for you: {action} ({class_token})"),
            detail: Some(serde_json::json!({
                "action": action,
                "class": class_token,
                "rationale": rationale,
                "params": params,
                "options": APPROVAL_OPTIONS,
                "resolve": { "kind": RESOLVE_APPROVAL, "id": approval_id },
            })),
        },
        AwayDecision::Delegate => StandupEvent {
            id: super::report::new_event_id(),
            standup_id: armed.id.clone(),
            at: now_ms,
            kind: StandupEventKind::AskDelegated,
            project_id: project,
            summary: format!("Delegated to Athena: {action} ({class_token})"),
            detail: Some(serde_json::json!({
                "action": action,
                "class": class_token,
                "reasoning": rationale,
                "decider": "standup away rules",
                "approvalId": approval_id,
            })),
        },
    };
    super::report::append_event(pool, &event)?;
    Ok(match decision {
        AwayDecision::Park => ApprovalGate::Parked,
        AwayDecision::Delegate => ApprovalGate::Delegated,
    })
}

/// [`gate_approval`] for the autopilot, which knows the approval but not its
/// project: with no armed standup it answers [`ApprovalGate::NotArmed`]
/// after one indexed read; otherwise the project is the params'
/// `project_id`, else the registered project whose root holds the params'
/// `cwd` (Dev Tools projects from `sys_db`, then Athena's registry).
pub fn gate_autopilot(
    user_db: &UserDbPool,
    sys_db: &crate::db::DbPool,
    approval_id: &str,
    action: &str,
    params_json: &str,
    rationale: &str,
    now_ms: i64,
) -> Result<ApprovalGate, AppError> {
    if super::report::armed(user_db)?.is_none() {
        return Ok(ApprovalGate::NotArmed);
    }
    // Unparseable params stay a string, so no key is read from them.
    let params = parse_json(params_json);
    let str_param = |k: &str| {
        params
            .get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    let project = str_param("project_id").or_else(|| {
        let cwd = str_param("cwd")?;
        let roots = super::report::project_roots(user_db, sys_db);
        super::report::project_for_cwd(&roots, &cwd).map(str::to_string)
    });
    gate_approval(
        user_db,
        approval_id,
        action,
        params_json,
        rationale,
        project.as_deref(),
        now_ms,
    )
}

/// The snake_case wire token of a class (its serde form).
pub fn class_token(class: AwayRuleClass) -> &'static str {
    match class {
        AwayRuleClass::Scope => "scope",
        AwayRuleClass::Goals => "goals",
        AwayRuleClass::DependencyBump => "dependency_bump",
        AwayRuleClass::Retune => "retune",
        AwayRuleClass::CreateAgent => "create_agent",
        AwayRuleClass::Money => "money",
        AwayRuleClass::Data => "data",
        AwayRuleClass::Schema => "schema",
        AwayRuleClass::Secrets => "secrets",
        AwayRuleClass::Push => "push",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(action: &'static str, params: &'static str) -> AwayAction<'static> {
        AwayAction::Op {
            action,
            params_json: params,
        }
    }

    fn target(project: &str, remote: &str, branch: &str) -> PushTarget {
        PushTarget {
            project_id: project.into(),
            remote: remote.into(),
            branch: branch.into(),
        }
    }

    /// One row per class: (act, expected class, verdict under the default
    /// rules with no push target).
    #[test]
    fn every_class_classifies_and_decides_from_the_table() {
        let rules = default_rules();
        let table: Vec<(AwayAction<'static>, AwayRuleClass, AwayDecision)> = vec![
            // money: a budget key, a payment connector, worker spend
            (
                op("run_persona", r#"{"persona_id":"p","max_budget_usd":40}"#),
                AwayRuleClass::Money,
                AwayDecision::Park,
            ),
            (
                AwayAction::WorkerApproval {
                    action: "upgrade to the paid plan",
                    rationale: "free tier rate limits the e2e suite",
                    details_json: None,
                },
                AwayRuleClass::Money,
                AwayDecision::Park,
            ),
            // data: a delete op, a mutating connector capability
            (
                op("delete_fact", r#"{"fact_id":"f1"}"#),
                AwayRuleClass::Data,
                AwayDecision::Park,
            ),
            (
                op(
                    "use_connector",
                    r#"{"connector_name":"notion","capability":"delete_page","args":{}}"#,
                ),
                AwayRuleClass::Data,
                AwayDecision::Park,
            ),
            // schema: DDL typed into a terminal
            (
                op(
                    "fleet_send_input",
                    r#"{"session_id":"s","text":"yes, run ALTER TABLE users DROP COLUMN age"}"#,
                ),
                AwayRuleClass::Schema,
                AwayDecision::Park,
            ),
            // secrets: the vault re-consent op
            (
                op("reconnect_credential", r#"{"credential_id":"c"}"#),
                AwayRuleClass::Secrets,
                AwayDecision::Park,
            ),
            // push: an unnamed push parks
            (
                op(
                    "fleet_send_input",
                    r#"{"session_id":"s","text":"git push origin main"}"#,
                ),
                AwayRuleClass::Push,
                AwayDecision::Park,
            ),
            // the delegable rest
            (
                op("write_goal", r#"{"title":"ship"}"#),
                AwayRuleClass::Goals,
                AwayDecision::Delegate,
            ),
            (
                op("skill_sync", r#"{"skill":"spark","direction":"adopt"}"#),
                AwayRuleClass::DependencyBump,
                AwayDecision::Delegate,
            ),
            (
                op("companion_evolve_persona", r#"{"persona_id":"p"}"#),
                AwayRuleClass::Retune,
                AwayDecision::Delegate,
            ),
            (
                op("build_oneshot", r#"{"intent":"a triage agent for kp"}"#),
                AwayRuleClass::CreateAgent,
                AwayDecision::Delegate,
            ),
            (
                op(
                    "fleet_dispatch",
                    r#"{"rows":[{"cwd":"C:/repo","task":"fix lint"}]}"#,
                ),
                AwayRuleClass::Scope,
                AwayDecision::Delegate,
            ),
        ];
        for (act, class, verdict) in table {
            assert_eq!(classify(act), class, "{act:?}");
            assert_eq!(decide(&rules, class, None), verdict, "{act:?}");
        }
    }

    #[test]
    fn a_push_to_a_named_target_delegates_and_any_other_parks() {
        let mut rules = default_rules();
        rules.push_targets = vec![target("kp", "origin", "main")];
        let act = op(
            "fleet_send_input",
            r#"{"session_id":"s","text":"git push origin main"}"#,
        );
        assert_eq!(classify(act), AwayRuleClass::Push);

        let named = push_target_of(act, Some("kp")).expect("a git push names its target");
        assert_eq!(named, target("kp", "origin", "main"));
        assert_eq!(
            decide(&rules, AwayRuleClass::Push, Some(&named)),
            AwayDecision::Delegate
        );

        // Another branch, another project, or no project at all: park.
        let other = op(
            "fleet_send_input",
            r#"{"text":"git push origin HEAD:release"}"#,
        );
        let t = push_target_of(other, Some("kp")).expect("target");
        assert_eq!(t.branch, "release");
        assert_eq!(
            decide(&rules, AwayRuleClass::Push, Some(&t)),
            AwayDecision::Park
        );
        let elsewhere = push_target_of(act, Some("pof")).expect("target");
        assert_eq!(
            decide(&rules, AwayRuleClass::Push, Some(&elsewhere)),
            AwayDecision::Park
        );
        assert!(push_target_of(act, None).is_none(), "no project, no target");
        assert_eq!(
            decide(&rules, AwayRuleClass::Push, None),
            AwayDecision::Park
        );
    }

    #[test]
    fn explicit_remote_and_branch_keys_name_a_target() {
        let act = op(
            "fleet_spawn",
            r#"{"cwd":"C:/kp","remote":"Origin","branch":"main","task":"git push"}"#,
        );
        let t = push_target_of(act, Some("kp")).expect("explicit keys");
        let mut rules = default_rules();
        rules.push_targets = vec![target("kp", "origin", "main")];
        assert_eq!(
            decide(&rules, AwayRuleClass::Push, Some(&t)),
            AwayDecision::Delegate
        );
    }

    #[test]
    fn the_most_restrictive_hard_class_wins() {
        // A delete that is also a push must not delegate as "a named push".
        let act = op(
            "fleet_send_input",
            r#"{"text":"git push origin main && rm -rf build"}"#,
        );
        assert_eq!(classify(act), AwayRuleClass::Data);
        // Secrets beats everything.
        let act = op("delete_fact", r#"{"fact_id":"the stripe api key"}"#);
        assert_eq!(classify(act), AwayRuleClass::Secrets);
    }

    #[test]
    fn the_operator_lists_override_class_defaults_and_park_wins_ties() {
        let mut rules = default_rules();
        rules.park.push(AwayRuleClass::CreateAgent);
        assert_eq!(
            decide(&rules, AwayRuleClass::CreateAgent, None),
            AwayDecision::Park
        );
        let empty = AwayRules::default();
        assert_eq!(
            decide(&empty, AwayRuleClass::Money, None),
            AwayDecision::Park
        );
        assert_eq!(
            decide(&empty, AwayRuleClass::Scope, None),
            AwayDecision::Delegate
        );
        let delegate_money = AwayRules {
            delegate: vec![AwayRuleClass::Money],
            ..AwayRules::default()
        };
        assert_eq!(
            decide(&delegate_money, AwayRuleClass::Money, None),
            AwayDecision::Delegate
        );
    }

    #[test]
    fn worker_asks_classify_on_their_action_not_on_incidental_words() {
        let ask = AwayAction::WorkerApproval {
            action: "delete branch night/kp-17",
            rationale: "merged already",
            details_json: None,
        };
        assert_eq!(classify(ask), AwayRuleClass::Data);
        let ask = AwayAction::WorkerApproval {
            action: "push night branch",
            rationale: "so the morning review can see it",
            details_json: None,
        };
        assert_eq!(classify(ask), AwayRuleClass::Push);
        let ask = AwayAction::WorkerApproval {
            action: "bump vite to 8.1",
            rationale: "fixes the HMR leak",
            details_json: None,
        };
        assert_eq!(classify(ask), AwayRuleClass::DependencyBump);
        let q = AwayAction::WorkerGuidance {
            question: "Should I delete the unused import or keep it for the next task?",
            context: None,
        };
        assert_eq!(classify(q), AwayRuleClass::Scope);
        let q = AwayAction::WorkerGuidance {
            question: "The test needs a new migration file - add one?",
            context: None,
        };
        assert_eq!(classify(q), AwayRuleClass::Schema);
    }

    // ---- the checkpoint against the real schema ---------------------------

    fn arm(pool: &UserDbPool, id: &str, rules: &AwayRules) -> Result<(), AppError> {
        pool.get()?
            .execute(
                "INSERT INTO companion_standup
                   (id, revision, status, device_id, opened_at, armed_at, plan_json, away_rules_json)
                 VALUES (?1, 1, 'armed', 'dev-1', 1000, 2000, '{\"items\":[]}', ?2)",
                rusqlite::params![id, serde_json::to_string(rules).unwrap()],
            )?;
        Ok(())
    }

    fn events(pool: &UserDbPool, id: &str) -> Vec<StandupEvent> {
        super::super::report::list_events(pool, id, 50).unwrap()
    }

    #[test]
    fn with_no_armed_standup_the_gate_writes_nothing_and_steps_aside() -> Result<(), AppError> {
        let pool = crate::db::init_test_user_db().unwrap();
        // A draft revision is not armed.
        pool.get()?
            .execute(
                "INSERT INTO companion_standup
                   (id, revision, status, device_id, opened_at, plan_json, away_rules_json)
                 VALUES ('su-draft', 1, 'draft', 'dev-1', 1000, '{\"items\":[]}', '{\"delegate\":[],\"park\":[],\"pushTargets\":[]}')",
                [],
            )
            .unwrap();
        for action in ["delete_fact", "write_goal", "reconnect_credential"] {
            let gate = gate_approval(&pool, "appr_1", action, "{}", "because", None, 5000).unwrap();
            assert_eq!(gate, ApprovalGate::NotArmed);
        }
        let n: i64 = pool.get()?.query_row(
            "SELECT COUNT(*) AS n FROM companion_standup_event",
            [],
            |r| r.get("n"),
        )?;
        assert_eq!(n, 0);
        Ok(())
    }

    #[test]
    fn an_armed_standup_parks_a_parked_class_with_its_options() {
        let pool = crate::db::init_test_user_db().unwrap();
        arm(&pool, "su-1", &default_rules()).unwrap();
        let gate = gate_approval(
            &pool,
            "appr_9",
            "delete_goal",
            r#"{"goal_id":"g1"}"#,
            "it is done",
            Some("kp"),
            9000,
        )
        .unwrap();
        assert_eq!(gate, ApprovalGate::Parked);
        let evs = events(&pool, "su-1");
        assert_eq!(evs.len(), 1);
        let e = &evs[0];
        assert_eq!(e.kind, StandupEventKind::AskParked);
        assert_eq!(e.project_id.as_deref(), Some("kp"));
        let d = e.detail.as_ref().unwrap();
        assert_eq!(d["options"], serde_json::json!(["Approve", "Reject"]));
        assert_eq!(d["resolve"]["id"], "appr_9");
        assert_eq!(d["class"], "data");
    }

    #[test]
    fn an_armed_standup_delegates_a_delegable_class_with_her_reasoning() {
        let pool = crate::db::init_test_user_db().unwrap();
        arm(&pool, "su-2", &default_rules()).unwrap();
        let gate = gate_approval(
            &pool,
            "appr_3",
            "write_goal",
            r#"{"title":"green CI"}"#,
            "the plan's direction needs a goal to steer by",
            None,
            9000,
        )
        .unwrap();
        assert_eq!(gate, ApprovalGate::Delegated);
        let evs = events(&pool, "su-2");
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, StandupEventKind::AskDelegated);
        assert_eq!(
            evs[0].detail.as_ref().unwrap()["reasoning"],
            "the plan's direction needs a goal to steer by"
        );
    }
}
