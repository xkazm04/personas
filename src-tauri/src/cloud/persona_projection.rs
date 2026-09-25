//! The cloud persona projection, and the one door every cloud push goes through.
//!
//! A cloud deployment is a claim that a specific persona reached the
//! orchestrator. Two things make that claim: WHAT is shipped (the assembled
//! prompt plus a 16-field persona body, built here by [`project`] and nowhere
//! else) and a durable record THAT it shipped (a `deployment_history` row with
//! `target = 'cloud'`, written by [`record_sync`] for success and failure).
//!
//! Every persona write path that can move a projected field pushes through
//! [`sync_if_deployed`] (via [`spawn_sync_if_deployed`] for the fire-and-forget
//! paths), so coverage is by construction rather than by memory.

use std::borrow::Cow;
use std::panic::AssertUnwindSafe;
use std::sync::LazyLock;

use futures_util::FutureExt;
use regex::Regex;

use crate::cloud::client::{CloudClient, CloudDeployment};
use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{deployment_history, tools as tool_repo};
use crate::db::DbPool;
use crate::engine;
use crate::error::AppError;
use crate::utils::extract_panic_message;
use crate::AppState;

/// `deployment_history.target` for every cloud row.
pub const CLOUD_TARGET: &str = "cloud";
/// Cloud deploys have no GitLab project; `project_id` is a 0 sentinel.
pub const CLOUD_PROJECT_ID: i64 = 0;

/// What a cloud push ships: the assembled prompt, and the persona body that
/// carries it as `systemPrompt`.
#[derive(Debug, Clone, PartialEq)]
pub struct CloudPersonaProjection {
    pub prompt: String,
    pub body: serde_json::Value,
}

/// Build the cloud projection of a persona. The ONLY place the cloud body is
/// assembled; a field added here reaches every push at once.
pub fn project(persona: &Persona, tools: &[PersonaToolDefinition]) -> CloudPersonaProjection {
    // v1: living-agent sections are not exported (responsibilities/episodes
    // stay None; `## Core` still renders from the persona snapshot).
    let prompt = engine::prompt::assemble_prompt(
        persona,
        tools,
        None,
        None,
        None,
        None,
        #[cfg(feature = "desktop")]
        None,
    );
    let body = serde_json::json!({
        "id": persona.id,
        "name": persona.name,
        "description": persona.description,
        "systemPrompt": prompt,
        "structuredPrompt": persona.structured_prompt,
        "icon": persona.icon,
        "color": persona.color,
        "enabled": persona.enabled,
        "maxConcurrent": persona.max_concurrent,
        "timeoutMs": persona.timeout_ms,
        "modelProfile": persona.model_profile,
        "maxBudgetUsd": persona.max_budget_usd,
        "maxTurns": persona.max_turns,
        "designContext": persona.design_context,
        "homeTeamId": persona.home_team_id,
        "coreProfile": persona.core_profile,
    });
    CloudPersonaProjection { prompt, body }
}

/// The prompt assembler wraps untrusted sections in XML tags whose names carry
/// a fresh nonce on EVERY call (`<untrusted_persona_description_1a2b...>`), so
/// two assemblies of an unchanged persona are never byte-equal. Matches the
/// nonce suffix of such a tag.
static BOUNDARY_NONCE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(</?untrusted_[A-Za-z0-9_]*?)_[0-9a-f]{16}>").expect("static regex")
});

/// The prompt with its per-call boundary nonces removed: what the persona
/// actually says. Used only to decide whether a push moved the prompt; the
/// stored snapshot is always the prompt exactly as it shipped.
pub fn prompt_identity(prompt: &str) -> Cow<'_, str> {
    BOUNDARY_NONCE_RE.replace_all(prompt, "$1>")
}

/// Why a push happened. Becomes `deployment_history.method`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncCause {
    /// A new deployment was created; its id is recorded in `agent_id`, which
    /// `cloudReconcileDeployments` reads to tell known deployments from orphans.
    Deploy { deployment_id: String },
    /// The user asked for a sync.
    Sync,
    /// A local persona write pushed the new projection on its own.
    AutoSync,
}

impl SyncCause {
    fn method(&self) -> &'static str {
        match self {
            SyncCause::Deploy { .. } => "deploy",
            SyncCause::Sync => "sync",
            SyncCause::AutoSync => "auto_sync",
        }
    }

    fn agent_id(&self) -> Option<&str> {
        match self {
            SyncCause::Deploy { deployment_id } => Some(deployment_id.as_str()),
            SyncCause::Sync | SyncCause::AutoSync => None,
        }
    }
}

/// What a push attempt came to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncOutcome {
    /// The persona has no cloud deployment; nothing was shipped or recorded.
    NotDeployed,
    /// The deployment list could not be read, so whether the persona is
    /// deployed is unknown. Nothing is recorded: a row would claim a
    /// deployment this install cannot see.
    Unreachable(String),
    /// The orchestrator accepted the projection.
    Synced,
    /// The persona is deployed and the push failed.
    Failed(String),
}

/// The two orchestrator calls a push needs. Implemented by [`CloudClient`];
/// faked in tests.
#[async_trait::async_trait]
pub trait PersonaSyncTarget: Send + Sync {
    async fn list_deployments(&self) -> Result<Vec<CloudDeployment>, AppError>;
    async fn upsert_persona(&self, body: &serde_json::Value) -> Result<(), AppError>;
}

#[async_trait::async_trait]
impl PersonaSyncTarget for CloudClient {
    async fn list_deployments(&self) -> Result<Vec<CloudDeployment>, AppError> {
        CloudClient::list_deployments(self).await
    }

    async fn upsert_persona(&self, body: &serde_json::Value) -> Result<(), AppError> {
        CloudClient::upsert_persona(self, body).await
    }
}

/// Record a push in the audit trail. Returns the new row id, or `None` when
/// nothing was written.
///
/// The row stores exactly what cloud rows always stored: the assembled prompt
/// as `snapshot_prompt`, no credentials, and no error text (a failure's
/// message goes to the log, never to the table).
///
/// A sync or auto-sync is deduped against the persona's NEWEST cloud row on
/// `(snapshot_prompt, deploy_result)`, comparing prompts by
/// [`prompt_identity`]: editor saves that do not move the prompt cannot flood
/// the trail, while a failed push followed by a successful retry of the same
/// prompt still records the success. A deploy is never deduped: each one is a
/// new deployment whose id `agent_id` carries.
pub fn record_sync(
    db: &DbPool,
    persona: &Persona,
    projection: &CloudPersonaProjection,
    outcome: &SyncOutcome,
    cause: &SyncCause,
) -> Result<Option<String>, AppError> {
    let result = match outcome {
        SyncOutcome::Synced => "success",
        SyncOutcome::Failed(_) => "failed",
        SyncOutcome::NotDeployed | SyncOutcome::Unreachable(_) => return Ok(None),
    };
    let prompt = projection.prompt.as_str();
    if !matches!(cause, SyncCause::Deploy { .. }) {
        let newest =
            deployment_history::list_by_persona_project(db, &persona.id, CLOUD_PROJECT_ID, 1)?;
        let identity = prompt_identity(prompt);
        let unchanged = newest.first().is_some_and(|last| {
            last.target == CLOUD_TARGET
                && last.deploy_result == result
                && last
                    .snapshot_prompt
                    .as_deref()
                    .is_some_and(|snap| prompt_identity(snap) == identity)
        });
        if unchanged {
            return Ok(None);
        }
    }
    deployment_history::insert(
        db,
        &persona.id,
        &persona.name,
        CLOUD_PROJECT_ID,
        cause.method(),
        0,
        result,
        cause.agent_id(),
        None,
        Some(prompt),
        None,
        CLOUD_TARGET,
    )
    .map(Some)
}

/// Upsert an already-built projection and record the outcome, success or
/// failure. Returns the upsert's own result so a caller that must report the
/// error (the manual sync command) keeps its original variant.
pub async fn push_projection<T: PersonaSyncTarget + ?Sized>(
    target: &T,
    db: &DbPool,
    persona: &Persona,
    projection: &CloudPersonaProjection,
    cause: &SyncCause,
) -> Result<(), AppError> {
    let upsert = target.upsert_persona(&projection.body).await;
    let outcome = match &upsert {
        Ok(()) => {
            tracing::info!(
                persona_id = %persona.id,
                method = cause.method(),
                "Persona projection pushed to cloud"
            );
            SyncOutcome::Synced
        }
        Err(e) => {
            tracing::warn!(
                persona_id = %persona.id,
                method = cause.method(),
                error = %e,
                "Cloud persona push failed"
            );
            SyncOutcome::Failed(e.to_string())
        }
    };
    // Best-effort: a failed history write must not turn a delivered push
    // into an error.
    if let Err(e) = record_sync(db, persona, projection, &outcome, cause) {
        tracing::warn!(persona_id = %persona.id, error = %e, "Failed to record cloud sync in history");
    }
    upsert
}

/// Push a persona's projection if (and only if) it has a cloud deployment.
///
/// Infallible by signature: the caller's local write has already committed,
/// and nothing that happens on the wire may undo or fail it. Every outcome
/// the persona's deployment could observe is recorded by [`push_projection`].
pub async fn sync_if_deployed<T: PersonaSyncTarget + ?Sized>(
    target: &T,
    db: &DbPool,
    persona: &Persona,
    cause: SyncCause,
) -> SyncOutcome {
    let deployments = match target.list_deployments().await {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(persona_id = %persona.id, error = %e, "Cloud sync could not list deployments");
            return SyncOutcome::Unreachable(e.to_string());
        }
    };
    if !deployments.iter().any(|d| d.persona_id == persona.id) {
        return SyncOutcome::NotDeployed;
    }
    let tools = match tool_repo::get_tools_for_persona(db, &persona.id) {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!(persona_id = %persona.id, error = %e, "Cloud sync could not read the persona's tools");
            return SyncOutcome::Failed(e.to_string());
        }
    };
    let projection = project(persona, &tools);
    match push_projection(target, db, persona, &projection, &cause).await {
        Ok(()) => SyncOutcome::Synced,
        Err(e) => SyncOutcome::Failed(e.to_string()),
    }
}

/// Fire-and-forget auto-sync after a local persona write. `snapshot` is the
/// persona as the write returned it (so a racing update cannot make the push
/// read stale data); `None` re-reads it after the write committed.
///
/// The task owns its outcome through the durable history row
/// [`sync_if_deployed`] writes; a panic is caught and logged rather than
/// dying silently with a discarded handle.
pub fn spawn_sync_if_deployed(state: &AppState, persona_id: &str, snapshot: Option<Persona>) {
    let cloud_client = state.cloud_client.clone();
    let db = state.db.clone();
    let persona_id = persona_id.to_string();
    tauri::async_runtime::spawn(async move {
        let pid = persona_id.clone();
        let work = AssertUnwindSafe(async move {
            let Some(client) = cloud_client.lock().await.clone() else {
                return;
            };
            let persona = match snapshot {
                Some(p) => p,
                None => match persona_repo::get_by_id(&db, &persona_id) {
                    Ok(p) => p,
                    Err(e) => {
                        tracing::warn!(persona_id = %persona_id, error = %e, "Cloud auto-sync could not read the persona");
                        return;
                    }
                },
            };
            sync_if_deployed(client.as_ref(), &db, &persona, SyncCause::AutoSync).await;
        })
        .catch_unwind()
        .await;
        if let Err(panic) = work {
            tracing::error!(persona_id = %pid, panic = %extract_panic_message(panic), "Cloud auto-sync task panicked");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{CreatePersonaInput, UpdatePersonaInput};
    use crate::db::repos::execution::metrics as prompt_repo;
    use std::sync::Mutex;

    // ── fixtures ────────────────────────────────────────────────────────

    fn seed_persona(pool: &DbPool, name: &str) -> Persona {
        let p = persona_repo::create(
            pool,
            CreatePersonaInput {
                name: name.to_string(),
                system_prompt: "You are a cloud projection test persona.".to_string(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .expect("seed persona");
        // Give the nullable projected fields real values so the body compare
        // is not a comparison of nulls.
        persona_repo::update(
            pool,
            &p.id,
            UpdatePersonaInput {
                description: Some(Some("desc".into())),
                icon: Some(Some("bot".into())),
                color: Some(Some("#123456".into())),
                max_budget_usd: Some(Some(2.5)),
                max_turns: Some(Some(7)),
                design_context: Some(Some(
                    r#"{"use_cases":[{"id":"uc1","title":"Cap","enabled":true}]}"#.into(),
                )),
                ..Default::default()
            },
        )
        .expect("enrich persona")
    }

    /// The body the four hand-built sites constructed before this module
    /// existed (cloud.rs deploy + sync, personas.rs update + parameters),
    /// captured verbatim so the refactor is pinned to be byte-identical.
    fn legacy_body(persona: &Persona, prompt: &str) -> serde_json::Value {
        serde_json::json!({
            "id": persona.id,
            "name": persona.name,
            "description": persona.description,
            "systemPrompt": prompt,
            "structuredPrompt": persona.structured_prompt,
            "icon": persona.icon,
            "color": persona.color,
            "enabled": persona.enabled,
            "maxConcurrent": persona.max_concurrent,
            "timeoutMs": persona.timeout_ms,
            "modelProfile": persona.model_profile,
            "maxBudgetUsd": persona.max_budget_usd,
            "maxTurns": persona.max_turns,
            "designContext": persona.design_context,
            "homeTeamId": persona.home_team_id,
            "coreProfile": persona.core_profile,
        })
    }

    fn deployment_for(persona_id: &str) -> CloudDeployment {
        CloudDeployment {
            id: format!("dep-{persona_id}"),
            project_id: "proj".into(),
            persona_id: persona_id.into(),
            slug: "slug".into(),
            label: "label".into(),
            status: "active".into(),
            webhook_enabled: false,
            webhook_secret: None,
            invocation_count: 0,
            last_invoked_at: None,
            max_monthly_budget_usd: None,
            current_month_cost_usd: None,
            budget_month: None,
            created_at: "2026-09-24T00:00:00Z".into(),
            updated_at: "2026-09-24T00:00:00Z".into(),
        }
    }

    struct FakeTarget {
        deployed: Vec<CloudDeployment>,
        upsert_error: Mutex<Option<String>>,
        received: Mutex<Vec<serde_json::Value>>,
    }

    impl FakeTarget {
        fn new(deployed_for: Option<&str>, upsert_error: Option<&str>) -> Self {
            Self {
                deployed: deployed_for.map(deployment_for).into_iter().collect(),
                upsert_error: Mutex::new(upsert_error.map(str::to_string)),
                received: Mutex::new(Vec::new()),
            }
        }
        fn set_upsert_error(&self, e: Option<&str>) {
            *self.upsert_error.lock().expect("lock") = e.map(str::to_string);
        }
        fn upserts(&self) -> Vec<serde_json::Value> {
            self.received.lock().expect("lock").clone()
        }
    }

    #[async_trait::async_trait]
    impl PersonaSyncTarget for FakeTarget {
        async fn list_deployments(&self) -> Result<Vec<CloudDeployment>, AppError> {
            Ok(self.deployed.clone())
        }
        async fn upsert_persona(&self, body: &serde_json::Value) -> Result<(), AppError> {
            self.received.lock().expect("lock").push(body.clone());
            match self.upsert_error.lock().expect("lock").clone() {
                Some(e) => Err(AppError::Cloud(e)),
                None => Ok(()),
            }
        }
    }

    fn cloud_rows(
        pool: &DbPool,
        persona_id: &str,
    ) -> Vec<crate::db::models::GitLabDeploymentRecord> {
        deployment_history::list_by_persona_project(pool, persona_id, CLOUD_PROJECT_ID, 100)
            .expect("list rows")
    }

    /// A body with its prompt reduced to [`prompt_identity`], so two
    /// projections of the same persona compare equal.
    fn stable(body: &serde_json::Value) -> serde_json::Value {
        let mut b = body.clone();
        let prompt = b["systemPrompt"]
            .as_str()
            .expect("systemPrompt")
            .to_string();
        b["systemPrompt"] = serde_json::json!(prompt_identity(&prompt));
        b
    }

    fn block_on<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(f)
    }

    // ── case 1 ──────────────────────────────────────────────────────────

    #[test]
    fn persona_projection_case1_body_is_the_legacy_literal() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Proj");
        let tools = tool_repo::get_tools_for_persona(&pool, &persona.id).expect("tools");
        let projection = project(&persona, &tools);

        let expected_prompt = engine::prompt::assemble_prompt(
            &persona,
            &tools,
            None,
            None,
            None,
            None,
            #[cfg(feature = "desktop")]
            None,
        );
        // The assembler stamps a fresh nonce into each untrusted-section tag,
        // so equality with an independent assembly holds modulo the nonce...
        assert_ne!(
            projection.prompt, expected_prompt,
            "fixture must exercise a nonce-bearing section"
        );
        assert_eq!(
            prompt_identity(&projection.prompt),
            prompt_identity(&expected_prompt)
        );
        // ...and the body carries exactly the prompt the projection returns.
        assert_eq!(
            projection.body["systemPrompt"],
            serde_json::json!(projection.prompt)
        );

        let obj = projection.body.as_object().expect("body is an object");
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        let mut want = vec![
            "id",
            "name",
            "description",
            "systemPrompt",
            "structuredPrompt",
            "icon",
            "color",
            "enabled",
            "maxConcurrent",
            "timeoutMs",
            "modelProfile",
            "maxBudgetUsd",
            "maxTurns",
            "designContext",
            "homeTeamId",
            "coreProfile",
        ];
        want.sort_unstable();
        assert_eq!(keys, want);

        let legacy = legacy_body(&persona, &projection.prompt);
        assert_eq!(projection.body, legacy);
        assert_eq!(
            serde_json::to_string(&projection.body).expect("ser"),
            serde_json::to_string(&legacy).expect("ser"),
            "wire bytes must not change"
        );
    }

    // ── case 2 ──────────────────────────────────────────────────────────

    #[test]
    fn persona_projection_case2_not_deployed_ships_and_records_nothing() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Undeployed");
        let fake = FakeTarget::new(Some("someone-else"), None);
        let outcome = block_on(sync_if_deployed(
            &fake,
            &pool,
            &persona,
            SyncCause::AutoSync,
        ));
        assert_eq!(outcome, SyncOutcome::NotDeployed);
        assert!(fake.upserts().is_empty());
        assert!(cloud_rows(&pool, &persona.id).is_empty());
    }

    // ── case 3 ──────────────────────────────────────────────────────────

    #[test]
    fn persona_projection_case3_auto_sync_success_writes_one_row() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Deployed");
        let fake = FakeTarget::new(Some(&persona.id), None);
        let outcome = block_on(sync_if_deployed(
            &fake,
            &pool,
            &persona,
            SyncCause::AutoSync,
        ));
        assert_eq!(outcome, SyncOutcome::Synced);

        let tools = tool_repo::get_tools_for_persona(&pool, &persona.id).expect("tools");
        let projection = project(&persona, &tools);
        let received: Vec<_> = fake.upserts().iter().map(stable).collect();
        assert_eq!(received, vec![stable(&projection.body)]);

        let rows = cloud_rows(&pool, &persona.id);
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r.target, "cloud");
        assert_eq!(r.project_id, 0);
        assert_eq!(r.method, "auto_sync");
        assert_eq!(r.deploy_result, "success");
        assert_eq!(r.agent_id, None);
        let snap = r.snapshot_prompt.as_deref().expect("snapshot");
        assert_eq!(prompt_identity(snap), prompt_identity(&projection.prompt));
        // The row stores the prompt exactly as it shipped.
        assert_eq!(fake.upserts()[0]["systemPrompt"], serde_json::json!(snap));
    }

    // ── case 4 ──────────────────────────────────────────────────────────

    #[test]
    fn persona_projection_case4_auto_sync_failure_writes_failed_row() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Flaky");
        let fake = FakeTarget::new(Some(&persona.id), Some("timeout"));
        let outcome = block_on(sync_if_deployed(
            &fake,
            &pool,
            &persona,
            SyncCause::AutoSync,
        ));
        let expected = AppError::Cloud("timeout".into()).to_string();
        assert_eq!(outcome, SyncOutcome::Failed(expected));
        let rows = cloud_rows(&pool, &persona.id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].deploy_result, "failed");
        assert_eq!(rows[0].method, "auto_sync");
        // The error text is logged, never stored: the row carries only what
        // existing cloud rows already carry.
        assert_eq!(rows[0].web_url, None);
    }

    // ── case 5 (with coordinator revision) ──────────────────────────────

    #[test]
    fn persona_projection_case5_dedupes_on_prompt_and_result() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Chatty");
        let fake = FakeTarget::new(Some(&persona.id), None);

        block_on(sync_if_deployed(
            &fake,
            &pool,
            &persona,
            SyncCause::AutoSync,
        ));
        block_on(sync_if_deployed(
            &fake,
            &pool,
            &persona,
            SyncCause::AutoSync,
        ));
        assert_eq!(
            cloud_rows(&pool, &persona.id).len(),
            1,
            "same prompt, same result: one row"
        );

        let changed = persona_repo::update(
            &pool,
            &persona.id,
            UpdatePersonaInput {
                system_prompt: Some("You are a CHANGED persona.".into()),
                ..Default::default()
            },
        )
        .expect("update");
        block_on(sync_if_deployed(
            &fake,
            &pool,
            &changed,
            SyncCause::AutoSync,
        ));
        assert_eq!(
            cloud_rows(&pool, &persona.id).len(),
            2,
            "changed prompt: a second row"
        );

        // Coordinator revision: a failure then a successful retry of the SAME
        // prompt must still record the success.
        fake.set_upsert_error(Some("timeout"));
        block_on(sync_if_deployed(
            &fake,
            &pool,
            &changed,
            SyncCause::AutoSync,
        ));
        fake.set_upsert_error(None);
        block_on(sync_if_deployed(
            &fake,
            &pool,
            &changed,
            SyncCause::AutoSync,
        ));
        let rows = cloud_rows(&pool, &persona.id);
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].deploy_result, "success");
        assert_eq!(rows[1].deploy_result, "failed");
    }

    // ── case 6 ──────────────────────────────────────────────────────────

    #[test]
    fn persona_projection_case6_no_hand_built_body_outside_the_module() {
        let personas_src = include_str!("../commands/core/personas.rs");
        let cloud_src = include_str!("../commands/infrastructure/cloud.rs");
        let hits = personas_src.matches("\"coreProfile\"").count()
            + cloud_src.matches("\"coreProfile\"").count();
        assert_eq!(
            hits, 0,
            "the cloud body is built only by persona_projection::project"
        );
    }

    /// Prompt rollback and the use-case toggles push through the same door,
    /// and never upsert on their own.
    #[test]
    fn persona_projection_rollback_and_toggles_route_through_the_door() {
        let prompt_lab = include_str!("../commands/communication/observability/prompt_lab.rs");
        let use_cases = include_str!("../commands/core/use_cases.rs");
        let personas_src = include_str!("../commands/core/personas.rs");
        assert_eq!(prompt_lab.matches("spawn_sync_if_deployed(").count(), 1);
        assert_eq!(use_cases.matches("spawn_sync_if_deployed(").count(), 2);
        assert_eq!(personas_src.matches("spawn_sync_if_deployed(").count(), 2);
        for src in [prompt_lab, use_cases, personas_src] {
            assert_eq!(src.matches("upsert_persona(").count(), 0);
        }
    }

    // ── case 7 [guard] ──────────────────────────────────────────────────

    #[test]
    fn persona_projection_case7_deploy_records_agent_id() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Deploy");
        let projection = project(&persona, &[]);
        let cause = SyncCause::Deploy {
            deployment_id: "d1".into(),
        };
        let id = record_sync(&pool, &persona, &projection, &SyncOutcome::Synced, &cause)
            .expect("record");
        assert!(id.is_some());
        // A second deploy of the same prompt is a new deployment: never deduped.
        let cause2 = SyncCause::Deploy {
            deployment_id: "d2".into(),
        };
        record_sync(&pool, &persona, &projection, &SyncOutcome::Synced, &cause2).expect("record");
        let rows = cloud_rows(&pool, &persona.id);
        assert_eq!(rows.len(), 2);
        let ids: Vec<_> = rows.iter().filter_map(|r| r.agent_id.clone()).collect();
        assert!(ids.contains(&"d1".to_string()) && ids.contains(&"d2".to_string()));
        assert!(rows
            .iter()
            .all(|r| r.target == "cloud" && r.method == "deploy"));
    }

    // ── the user's local write survives a failed sync ───────────────────

    #[test]
    fn persona_projection_failed_sync_after_rollback_keeps_the_rollback() {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Rollback");
        let version = prompt_repo::create_prompt_version(
            &pool,
            &persona.id,
            None,
            Some("You are the ROLLED BACK prompt.".into()),
            Some("v1".into()),
        )
        .expect("version");
        crate::commands::communication::observability::prompt_lab::apply_prompt_rollback(
            &pool,
            &version.id,
        )
        .expect("rollback succeeds");

        let after = persona_repo::get_by_id(&pool, &persona.id).expect("persona");
        let fake = FakeTarget::new(Some(&persona.id), Some("timeout"));
        let outcome = block_on(sync_if_deployed(&fake, &pool, &after, SyncCause::AutoSync));
        assert!(matches!(outcome, SyncOutcome::Failed(_)));

        let rows = cloud_rows(&pool, &persona.id);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].deploy_result, "failed");
        let still = persona_repo::get_by_id(&pool, &persona.id).expect("persona");
        assert_eq!(still.system_prompt, "You are the ROLLED BACK prompt.");
    }

    #[test]
    fn persona_projection_failed_sync_after_toggle_keeps_the_toggle(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let pool = crate::db::init_test_db().expect("db");
        let persona = seed_persona(&pool, "Toggle");
        {
            let mut conn = pool.get()?;
            crate::commands::core::use_cases::testable::cascade_use_case_toggle(
                &mut conn,
                &persona.id,
                "uc1",
                false,
            )
            .expect("toggle succeeds");
        }
        let after = persona_repo::get_by_id(&pool, &persona.id).expect("persona");
        let fake = FakeTarget::new(Some(&persona.id), Some("timeout"));
        let outcome = block_on(sync_if_deployed(&fake, &pool, &after, SyncCause::AutoSync));
        assert!(matches!(outcome, SyncOutcome::Failed(_)));
        assert_eq!(cloud_rows(&pool, &persona.id).len(), 1);
        assert_eq!(cloud_rows(&pool, &persona.id)[0].deploy_result, "failed");

        let still = persona_repo::get_by_id(&pool, &persona.id).expect("persona");
        let dc = still.design_context.expect("design_context");
        assert!(dc.contains("\"enabled\":false"), "toggle persisted: {dc}");
        Ok(())
    }
}
