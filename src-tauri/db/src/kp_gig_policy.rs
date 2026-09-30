//! The gig persona policy — the operator's standing approval for kp's
//! one-persona-per-gig hires (`kp.gig_persona_policy`).
//!
//! **Why.** kp (the sibling gig desk) moved from one reusable specialist
//! persona serving many gigs to ONE persona per gig: created when the operator
//! accepts a gig's plan, retired when the gig ends. At a hundred open gigs the
//! per-hire click in the approval inbox becomes a hundred clicks that each say
//! the same thing. So the operator approves a bounded POLICY once, and a kp
//! hire that lies entirely inside it is approved on the operator's behalf.
//!
//! **The bound.** A hire request is inside the policy only when ALL hold
//! ([`evaluate`]):
//!
//! 1. the policy is `enabled`;
//! 2. the request's top-level `fit.kind` is [`FIT_KIND`];
//! 3. when the policy names a `maxBudgetUsd` cap, `spec.maxBudgetUsd` is
//!    present and `<=` it; a policy whose `maxBudgetUsd` is `null` (or absent)
//!    has NO CAP — the request's budget is then neither required nor compared
//!    (one that carries a budget is still inside);
//! 4. `spec.modelProfile.model` is one of `allowedModels`;
//! 5. `placement.projectId` names a project whose folder lies STRICTLY inside
//!    `rootPath` (component-wise, both sides canonicalised — the same
//!    containment [`crate::execution_project::is_strictly_inside`] the
//!    project-bound runs use).
//!
//! Anything that misses one condition waits for the operator exactly as every
//! kp hire did before this existed. Nothing here approves anything: the
//! management API asks [`evaluate_request`], and on `Ok` claims the row and runs
//! the approval executor the operator's own Approve reaches.
//!
//! **Who may move it: the operator only.** The key is operator-only
//! (`settings_keys::is_operator_only`): the generic settings writers — and so
//! every management-API settings route a kp key could reach — refuse it. A
//! malformed stored value is read as DISABLED, never as "anything goes".

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::execution_project::is_strictly_inside;
use crate::repos::dev::projects as project_repo;
use crate::DbPool;
#[cfg(test)]
use personas_core::model_ids::{OPUS_5_5, SONNET_CURRENT};

/// The `fit.kind` a request must carry to be considered at all.
pub const FIT_KIND: &str = "kp.gig-persona.v1";

/// The actor recorded on an approval the policy decided
/// (`companion_approval.payload.decidedBy`).
pub const POLICY_ACTOR: &str = "policy:kp.gig_persona_policy";

/// At most this many allowed models. A policy is a short list by nature.
pub const MAX_ALLOWED_MODELS: usize = 16;
/// Longest model id accepted in the list (same bound as the wire's
/// `spec.modelProfile.model`).
pub const MAX_MODEL_CHARS: usize = 100;
/// Longest `rootPath` accepted.
pub const MAX_ROOT_PATH_CHARS: usize = 1024;
/// The per-hire budget ceiling a policy may name. A sanity bound, not a
/// recommendation: it only keeps a typo from reading as an open cheque. A
/// policy that wants no cap says so with `null`, never with a large number.
pub const MAX_POLICY_BUDGET_USD: f64 = 10_000.0;

/// The stored policy. Every field defaults, so the absent row is the disabled
/// policy ([`GigPersonaPolicy::default`]). Unknown keys are refused — this is
/// an operator-typed security boundary, and a misspelled key silently ignored
/// would read as a bound that is not enforced.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export)]
pub struct GigPersonaPolicy {
    #[serde(default)]
    pub enabled: bool,
    /// The per-hire budget cap in USD. `None` (`null` or an absent key) is
    /// NO CAP: the operator decided gig personas run unbudgeted, so a request
    /// needs no `spec.maxBudgetUsd` to be inside the policy.
    #[serde(default)]
    pub max_budget_usd: Option<f64>,
    #[serde(default)]
    pub allowed_models: Vec<String>,
    #[serde(default)]
    pub root_path: String,
}

/// Parse and shape-check a stored value. Pure — the filesystem half (the root
/// must be an existing absolute directory) belongs to the operator's write
/// door, which can touch the disk; [`evaluate`] re-checks containment at every
/// use anyway.
pub fn parse(raw: &str) -> Result<GigPersonaPolicy, String> {
    let policy: GigPersonaPolicy = serde_json::from_str(raw)
        .map_err(|e| format!("gig persona policy is not valid JSON for its schema: {e}"))?;
    validate_shape(&policy)?;
    Ok(policy)
}

/// The shape rules every stored policy obeys.
pub fn validate_shape(policy: &GigPersonaPolicy) -> Result<(), String> {
    if let Some(cap) = policy.max_budget_usd {
        if !cap.is_finite() || !(0.0..=MAX_POLICY_BUDGET_USD).contains(&cap) {
            return Err(format!(
                "`maxBudgetUsd` must be null (no cap) or a number between 0 and {MAX_POLICY_BUDGET_USD}"
            ));
        }
    }
    if policy.allowed_models.len() > MAX_ALLOWED_MODELS {
        return Err(format!(
            "`allowedModels` holds at most {MAX_ALLOWED_MODELS} entries"
        ));
    }
    for m in &policy.allowed_models {
        let t = m.trim();
        if t.is_empty() || t.chars().count() > MAX_MODEL_CHARS {
            return Err(format!(
                "every `allowedModels` entry must be 1..{MAX_MODEL_CHARS} characters"
            ));
        }
    }
    if policy.root_path.chars().count() > MAX_ROOT_PATH_CHARS {
        return Err(format!(
            "`rootPath` exceeds {MAX_ROOT_PATH_CHARS} characters"
        ));
    }
    if policy.enabled && policy.root_path.trim().is_empty() {
        return Err("an enabled policy needs a `rootPath`".into());
    }
    Ok(())
}

/// The policy in force right now. Missing row ⇒ disabled; unreadable or
/// malformed row ⇒ disabled, logged — fail closed.
pub fn load(pool: &DbPool) -> GigPersonaPolicy {
    match crate::repos::core::settings::get(pool, crate::settings_keys::KP_GIG_PERSONA_POLICY) {
        Ok(None) => GigPersonaPolicy::default(),
        Ok(Some(raw)) => parse(&raw).unwrap_or_else(|e| {
            tracing::warn!(error = %e, "gig persona policy is malformed; treating it as disabled");
            GigPersonaPolicy::default()
        }),
        Err(e) => {
            tracing::warn!(error = %e, "could not read the gig persona policy; treating it as disabled");
            GigPersonaPolicy::default()
        }
    }
}

/// Why a request is NOT inside the policy. Each maps to one stable code, which
/// the intake logs and appends to the approval card so the operator can see
/// why a gig hire is waiting for them.
#[derive(Debug, Clone, PartialEq)]
pub enum PolicyMiss {
    Disabled,
    FitKind,
    NoBudget,
    OverBudget { asked: f64, cap: f64 },
    NoModel,
    ModelNotAllowed(String),
    NoProject,
    ProjectNotFound(String),
    ProjectOutsideRoot,
}

impl PolicyMiss {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Disabled => "policy_disabled",
            Self::FitKind => "fit_kind_mismatch",
            Self::NoBudget => "budget_missing",
            Self::OverBudget { .. } => "budget_over_policy",
            Self::NoModel => "model_missing",
            Self::ModelNotAllowed(_) => "model_not_allowed",
            Self::NoProject => "project_missing",
            Self::ProjectNotFound(_) => "project_not_found",
            Self::ProjectOutsideRoot => "project_outside_policy_root",
        }
    }

    /// One sentence for the approval card and the log.
    pub fn reason(&self) -> String {
        match self {
            Self::Disabled => "the gig persona policy is off".into(),
            Self::FitKind => format!("the request's `fit.kind` is not `{FIT_KIND}`"),
            Self::NoBudget => "the request names no `spec.maxBudgetUsd`".into(),
            Self::OverBudget { asked, cap } => {
                format!("its budget ${asked} is over the policy's ${cap}")
            }
            Self::NoModel => "the request names no `spec.modelProfile.model`".into(),
            Self::ModelNotAllowed(m) => format!("model `{m}` is not on the policy's list"),
            Self::NoProject => "the request names no `placement.projectId`".into(),
            Self::ProjectNotFound(id) => format!("project {id} could not be resolved"),
            Self::ProjectOutsideRoot => {
                "its project folder is not inside the policy's root folder".into()
            }
        }
    }
}

/// What the policy reads off a hire request.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GigHireFacts {
    pub fit_kind: Option<String>,
    pub max_budget_usd: Option<f64>,
    pub model: Option<String>,
    pub project_id: Option<String>,
}

impl GigHireFacts {
    /// Read the four facts off the raw request body (`fit.kind`,
    /// `spec.maxBudgetUsd`, `spec.modelProfile.model`, `placement.projectId`).
    /// A value of the wrong type reads as absent.
    pub fn from_body(body: &Value) -> Self {
        let text = |ptr: &str| {
            body.pointer(ptr)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
        };
        Self {
            fit_kind: text("/fit/kind"),
            max_budget_usd: body.pointer("/spec/maxBudgetUsd").and_then(Value::as_f64),
            model: text("/spec/modelProfile/model"),
            project_id: text("/placement/projectId"),
        }
    }
}

/// Is a request with these facts inside the policy? `project_root` is the
/// folder of the project `facts.project_id` names (resolved by the caller;
/// `None` when it could not be). Checks run in a fixed order so the reported
/// miss is deterministic. Pure apart from canonicalising the two paths.
pub fn evaluate(
    policy: &GigPersonaPolicy,
    facts: &GigHireFacts,
    project_root: Option<&Path>,
) -> Result<(), PolicyMiss> {
    if !policy.enabled {
        return Err(PolicyMiss::Disabled);
    }
    if facts.fit_kind.as_deref() != Some(FIT_KIND) {
        return Err(PolicyMiss::FitKind);
    }
    // No cap: the request's budget is neither required nor compared.
    if let Some(cap) = policy.max_budget_usd {
        let Some(asked) = facts.max_budget_usd.filter(|b| b.is_finite()) else {
            return Err(PolicyMiss::NoBudget);
        };
        if asked > cap {
            return Err(PolicyMiss::OverBudget { asked, cap });
        }
    }
    let Some(model) = facts.model.as_deref() else {
        return Err(PolicyMiss::NoModel);
    };
    if !policy
        .allowed_models
        .iter()
        .any(|m| m.trim().eq_ignore_ascii_case(model))
    {
        return Err(PolicyMiss::ModelNotAllowed(model.to_string()));
    }
    let Some(project_id) = facts.project_id.as_deref() else {
        return Err(PolicyMiss::NoProject);
    };
    let Some(project_root) = project_root else {
        return Err(PolicyMiss::ProjectNotFound(project_id.to_string()));
    };
    let root = canonical(Path::new(policy.root_path.trim()));
    let project = canonical(project_root);
    match (root, project) {
        (Some(root), Some(project)) if is_strictly_inside(&project, &root) => Ok(()),
        _ => Err(PolicyMiss::ProjectOutsideRoot),
    }
}

fn canonical(p: &Path) -> Option<PathBuf> {
    if p.as_os_str().is_empty() {
        return None;
    }
    std::fs::canonicalize(p).ok()
}

/// [`evaluate`] against the policy in force and the project the request names.
pub fn evaluate_request(pool: &DbPool, body: &Value) -> Result<(), PolicyMiss> {
    evaluate_request_with(&load(pool), pool, body)
}

/// [`evaluate_request`] against an explicit policy (tests).
pub fn evaluate_request_with(
    policy: &GigPersonaPolicy,
    pool: &DbPool,
    body: &Value,
) -> Result<(), PolicyMiss> {
    let facts = GigHireFacts::from_body(body);
    let root = facts
        .project_id
        .as_deref()
        .and_then(|id| project_repo::get_project_by_id(pool, id).ok())
        .map(|p| PathBuf::from(p.root_path));
    evaluate(policy, &facts, root.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            let p =
                std::env::temp_dir().join(format!("kp_gig_policy_{tag}_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
        fn child(&self, name: &str) -> PathBuf {
            let c = self.0.join(name);
            std::fs::create_dir_all(&c).unwrap();
            c
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn policy(root: &Path) -> GigPersonaPolicy {
        GigPersonaPolicy {
            enabled: true,
            max_budget_usd: Some(5.0),
            allowed_models: vec![OPUS_5_5.into()],
            root_path: root.to_string_lossy().to_string(),
        }
    }

    fn facts() -> GigHireFacts {
        GigHireFacts {
            fit_kind: Some(FIT_KIND.into()),
            max_budget_usd: Some(3.0),
            model: Some(OPUS_5_5.into()),
            project_id: Some("p1".into()),
        }
    }

    #[test]
    fn a_request_inside_every_bound_is_approved() {
        let root = TempDir::new("ok");
        let project = root.child("security/2026-09-29-audit-abc123");
        assert_eq!(evaluate(&policy(&root.0), &facts(), Some(&project)), Ok(()));
        // The budget bound is inclusive.
        let mut f = facts();
        f.max_budget_usd = Some(5.0);
        assert_eq!(evaluate(&policy(&root.0), &f, Some(&project)), Ok(()));
    }

    #[test]
    fn each_condition_on_its_own_keeps_the_request_waiting() {
        let root = TempDir::new("miss");
        let project = root.child("web/gig");
        let p = policy(&root.0);

        let mut off = p.clone();
        off.enabled = false;
        assert_eq!(
            evaluate(&off, &facts(), Some(&project)),
            Err(PolicyMiss::Disabled)
        );

        let mut f = facts();
        f.fit_kind = Some("kp.gig-specialist.v1".into());
        assert_eq!(evaluate(&p, &f, Some(&project)), Err(PolicyMiss::FitKind));
        let mut f = facts();
        f.fit_kind = None;
        assert_eq!(evaluate(&p, &f, Some(&project)), Err(PolicyMiss::FitKind));

        let mut f = facts();
        f.max_budget_usd = None;
        assert_eq!(evaluate(&p, &f, Some(&project)), Err(PolicyMiss::NoBudget));
        let mut f = facts();
        f.max_budget_usd = Some(5.01);
        assert_eq!(
            evaluate(&p, &f, Some(&project)).unwrap_err().code(),
            "budget_over_policy"
        );

        let mut f = facts();
        f.model = Some(SONNET_CURRENT.into());
        assert_eq!(
            evaluate(&p, &f, Some(&project)).unwrap_err().code(),
            "model_not_allowed"
        );
        let mut f = facts();
        f.model = None;
        assert_eq!(evaluate(&p, &f, Some(&project)), Err(PolicyMiss::NoModel));

        let mut f = facts();
        f.project_id = None;
        assert_eq!(evaluate(&p, &f, Some(&project)), Err(PolicyMiss::NoProject));
        assert_eq!(
            evaluate(&p, &facts(), None).unwrap_err().code(),
            "project_not_found"
        );

        let elsewhere = TempDir::new("elsewhere");
        assert_eq!(
            evaluate(&p, &facts(), Some(&elsewhere.0)),
            Err(PolicyMiss::ProjectOutsideRoot)
        );
        // The root itself is not inside the root, and a sibling prefix is not either.
        assert_eq!(
            evaluate(&p, &facts(), Some(&root.0)),
            Err(PolicyMiss::ProjectOutsideRoot)
        );
        let sibling = PathBuf::from(format!("{}2", root.0.to_string_lossy()));
        std::fs::create_dir_all(&sibling).unwrap();
        let outcome = evaluate(&p, &facts(), Some(&sibling));
        let _ = std::fs::remove_dir_all(&sibling);
        assert_eq!(outcome, Err(PolicyMiss::ProjectOutsideRoot));
    }

    #[test]
    fn a_policy_with_no_cap_neither_requires_nor_compares_a_budget() {
        let root = TempDir::new("nocap");
        let project = root.child("web/gig");
        let mut p = policy(&root.0);
        p.max_budget_usd = None;

        // No budget on the request: inside.
        let mut f = facts();
        f.max_budget_usd = None;
        assert_eq!(evaluate(&p, &f, Some(&project)), Ok(()));
        // Any budget on the request, however large: still inside.
        for asked in [0.0, 3.0, 5.01, 9_999_999.0] {
            let mut f = facts();
            f.max_budget_usd = Some(asked);
            assert_eq!(evaluate(&p, &f, Some(&project)), Ok(()), "{asked}");
        }
        // The other bounds still hold without a cap.
        let mut f = facts();
        f.max_budget_usd = None;
        f.model = Some(SONNET_CURRENT.into());
        assert_eq!(
            evaluate(&p, &f, Some(&project)).unwrap_err().code(),
            "model_not_allowed"
        );
        let mut off = p.clone();
        off.enabled = false;
        assert_eq!(
            evaluate(&off, &facts(), Some(&project)),
            Err(PolicyMiss::Disabled)
        );
    }

    #[test]
    fn facts_are_read_off_the_wire_body() {
        let body = json!({
            "fit": {"kind": "kp.gig-persona.v1", "gigType": "security"},
            "spec": {"maxBudgetUsd": 4, "modelProfile": {"model": format!(" {OPUS_5_5} "), "effort": "high"}},
            "placement": {"workspaceId": "w1", "projectId": "p9"}
        });
        assert_eq!(
            GigHireFacts::from_body(&body),
            GigHireFacts {
                fit_kind: Some(FIT_KIND.into()),
                max_budget_usd: Some(4.0),
                model: Some(OPUS_5_5.into()),
                project_id: Some("p9".into()),
            }
        );
        assert_eq!(GigHireFacts::from_body(&json!({})), GigHireFacts::default());
        // Wrong types read as absent.
        let wrong = json!({"fit": "kp.gig-persona.v1", "spec": {"maxBudgetUsd": "4"}});
        assert_eq!(GigHireFacts::from_body(&wrong), GigHireFacts::default());
    }

    #[test]
    fn stored_values_are_shape_checked_and_default_to_disabled() {
        assert_eq!(parse("{}").unwrap(), GigPersonaPolicy::default());
        assert!(!GigPersonaPolicy::default().enabled);
        assert!(parse(
            r#"{"enabled":true,"maxBudgetUsd":5,"allowedModels":["m"],"rootPath":"/x"}"#
        )
        .is_ok());
        // An enabled policy needs a root; a typo'd key is refused, not ignored.
        assert!(parse(r#"{"enabled":true,"maxBudgetUsd":5,"allowedModels":["m"]}"#).is_err());
        assert!(parse(r#"{"enabled":false,"maxBudget":5}"#).is_err());
        assert!(parse(r#"{"maxBudgetUsd":-1}"#).is_err());
        assert!(parse(r#"{"maxBudgetUsd":10001}"#).is_err());
        assert!(parse(r#"{"maxBudgetUsd":"5"}"#).is_err());
        // `null` and an absent key are both NO CAP; a number is a cap.
        assert_eq!(
            parse(r#"{"maxBudgetUsd":null}"#).unwrap().max_budget_usd,
            None
        );
        assert_eq!(parse(r#"{"enabled":false}"#).unwrap().max_budget_usd, None);
        assert_eq!(
            parse(r#"{"maxBudgetUsd":5}"#).unwrap().max_budget_usd,
            Some(5.0)
        );
        assert!(parse(
            r#"{"enabled":true,"maxBudgetUsd":null,"allowedModels":["m"],"rootPath":"/x"}"#
        )
        .is_ok());
        // No cap round-trips as `null`, not as a dropped key or a zero.
        let json = serde_json::to_value(GigPersonaPolicy::default()).unwrap();
        assert_eq!(json["maxBudgetUsd"], Value::Null);
        assert!(parse(r#"{"allowedModels":["  "]}"#).is_err());
        let many: Vec<String> = (0..=MAX_ALLOWED_MODELS).map(|i| format!("m{i}")).collect();
        assert!(parse(&json!({"allowedModels": many}).to_string()).is_err());
        assert!(parse("not json").is_err());
    }

    #[test]
    fn the_policy_in_force_is_read_from_the_database_and_fails_closed() {
        let pool = crate::init_test_db().unwrap();
        assert_eq!(load(&pool), GigPersonaPolicy::default());
        let root = TempDir::new("db");
        let stored = policy(&root.0);
        crate::repos::core::settings::set_operator_only(
            &pool,
            crate::settings_keys::KP_GIG_PERSONA_POLICY,
            &serde_json::to_string(&stored).unwrap(),
        )
        .unwrap();
        assert_eq!(load(&pool), stored);
        // The generic writer refuses the key: only the operator door moves it.
        assert!(crate::repos::core::settings::set(
            &pool,
            crate::settings_keys::KP_GIG_PERSONA_POLICY,
            "{}"
        )
        .is_err());
    }

    /// The intake's call: the facts off the stored request body, the folder
    /// off the project `placement.projectId` names.
    #[test]
    fn a_request_is_judged_against_the_named_projects_folder() {
        let pool = crate::init_test_db().unwrap();
        let root = TempDir::new("req");
        let inside = root.child("security/2026-09-29-audit");
        let outside = TempDir::new("req_out");
        let reg = |dir: &Path, name: &str| {
            crate::project_identity::register_project(
                &pool,
                name,
                dir.to_str().unwrap(),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap()
            .id
        };
        let in_id = reg(&inside, "inside");
        let out_id = reg(&outside.0, "outside");
        let body = |project: &str| {
            json!({
                "fit": {"kind": FIT_KIND},
                "spec": {"maxBudgetUsd": 5, "modelProfile": {"model": OPUS_5_5, "effort": "high"}},
                "placement": {"workspaceId": "w", "projectId": project}
            })
        };
        let p = policy(&root.0);
        assert_eq!(evaluate_request_with(&p, &pool, &body(&in_id)), Ok(()));
        assert_eq!(
            evaluate_request_with(&p, &pool, &body(&out_id)),
            Err(PolicyMiss::ProjectOutsideRoot)
        );
        assert_eq!(
            evaluate_request_with(&p, &pool, &body("no-such-project"))
                .unwrap_err()
                .code(),
            "project_not_found"
        );
        // Nothing stored: the default policy is off, so nothing is approved.
        assert_eq!(
            evaluate_request(&pool, &body(&in_id)),
            Err(PolicyMiss::Disabled)
        );
    }
}
