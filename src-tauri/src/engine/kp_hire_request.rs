//! Outbound hire — Personas asks kp for a role.
//!
//! The mirror of [`super::kp_reporter`], and the direction that did not exist
//! until now. The wire ran kp → Personas only: kp composed a role and POSTed
//! `/api/kp/persona-requests`, and Personas' single outbound call was the
//! report push. A persona that noticed one of its own responsibilities had no
//! holder had no way to say so to the product whose job is composing roles.
//!
//! This module is the other half: `POST {base_url}/api/agents/hire-from-need`
//! with a need in prose, and kp runs its own machinery — repo scan when the
//! path is allow-listed, intake, composer, dispatch — and comes back with the
//! persona request it queued on Personas. The hire therefore lands through the
//! SAME door it always did (`execute_kp_hire_request`), which is the point:
//! nothing about approval, budget or mandate changes because the asker was a
//! persona rather than a person.
//!
//! Ground rules, and where they differ from the reporter's:
//! - **`crate::SHARED_HTTP`, never `SSRF_SAFE_HTTP`** — same reason
//!   (`kp_reporter.rs:13`): kp runs on localhost, and the SSRF resolver refuses
//!   private addresses at connection time, so adopting it would break every
//!   deployment this feature has.
//! - **Failures are RETURNED, not swallowed.** This is the one place the
//!   reporter's discipline is wrong for the job. A report push is telemetry and
//!   a lost one costs nothing; a hire is a request the asking persona is
//!   waiting on, and a silent failure would show up as a role that simply never
//!   arrived, with nothing anywhere saying why.
//! - **The token is an environment variable, never a settings row.**
//!   `app_settings.value` is plain `TEXT NOT NULL` with no encryption on the
//!   write path. `KP_AUTOMATION_TOKEN` unset means the door is CLOSED — this
//!   never defaults open, and the refusal names the variable.
//! - **The URL never carries the credential**, unlike the reporter's (whose
//!   report token is a path segment). It goes in an `x-kp-automation-token`
//!   header, so a logged URL leaks nothing. Errors are still logged through
//!   `without_url()`, because a base URL an operator configured is their
//!   business and not the log's.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::DbPool;
use personas_core::crypto::SecureString;
use personas_core::error::AppError;
use personas_core::validation::require_non_empty;

impl From<HireRequestInput> for HireRequest {
    fn from(i: HireRequestInput) -> Self {
        Self {
            persona_id: i.persona_id,
            project_id: i.project_id,
            need: i.need,
            budget_usd: i.budget_usd,
            dry_run: i.dry_run.unwrap_or(false),
        }
    }
}

/// Env var holding the shared secret kp checks against its own
/// `KP_AUTOMATION_TOKEN`. Unset = this install may not ask kp for anything.
pub(crate) const AUTOMATION_TOKEN_ENV: &str = "KP_AUTOMATION_TOKEN";

/// Header the token travels in. Mirrors kp's `x-comms-secret` shape — a header,
/// never a query parameter, so it cannot land in an access log or a referrer.
const AUTOMATION_TOKEN_HEADER: &str = "x-kp-automation-token";

/// How long kp gets to compose a role.
///
/// Far longer than the reporter's 5 s, and deliberately: kp's own route may run
/// a repository scan, an intake sync and a composer, each of which can be an
/// LLM call. kp's bench driver allows 300 s per call for the same sequence.
/// Under this ceiling the request is still one HTTP call the caller awaits — a
/// hire that takes four minutes is slow, but a hire that times out at five
/// seconds is a hire that never happens.
const HIRE_TIMEOUT: Duration = Duration::from_secs(240);

/// Hard bound on the need text, matching
/// [`super::subscription::attention_decide::MAX_HIRE_NEED_CHARS`].
///
/// Restated here rather than imported because this door is reachable from the
/// bridge and the Tauri command too, and a bound that only the attention loop
/// applies is not a bound.
pub(crate) const MAX_NEED_CHARS: usize = 1200;

/// What the caller asks for.
#[derive(Debug, Clone, Default)]
pub(crate) struct HireRequest {
    /// The persona doing the asking. Its ledger records the outcome, its
    /// `design_context.kpLink` is the first place the kp base URL is looked
    /// for, and kp echoes the id back so the hired persona's setup notes can
    /// name who asked for it.
    pub persona_id: String,
    /// The project the role would belong to.
    pub project_id: String,
    /// The work, the evidence, and the acceptance, in prose.
    pub need: String,
    /// A monthly ceiling the asker proposes. Advisory — kp's composer owns the
    /// budget block.
    pub budget_usd: Option<f64>,
    /// Compose and return without dispatching. Nothing is queued on Personas
    /// and no persona is minted; the caller sees what kp WOULD have sent.
    pub dry_run: bool,
}

/// The wire-facing input both outward doors take — the bridge route
/// `POST /dev-tools/hire` and the Tauri command `request_hire_from_kp`.
///
/// Separate from [`HireRequest`] because that one is the module's internal
/// argument (already-resolved ids, no serde) while this is what a caller sends.
/// Keeping them apart is what lets `project_id` be optional here and required
/// there: the door resolves it, the operation never guesses.
#[derive(Debug, Clone, Default, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HireRequestInput {
    /// The persona doing the asking.
    pub persona_id: String,
    /// The project the role would belong to.
    pub project_id: String,
    /// The work, the evidence, and the acceptance, in prose.
    pub need: String,
    #[serde(default)]
    #[ts(optional)]
    pub budget_usd: Option<f64>,
    /// Compose at kp and return without dispatching.
    #[serde(default)]
    #[ts(optional)]
    pub dry_run: Option<bool>,
}

/// What kp answered.
///
/// Modelled on [`super::kp_reporter::RollupSummary`] — camelCase, and the
/// things that did not happen are data rather than an absence.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HireRequestOutcome {
    /// kp's intake row this need became.
    pub intake_id: String,
    /// kp's `hired_agents` row. Empty on a dry run.
    #[serde(default)]
    pub agent_id: String,
    /// The `persona_requests` id kp queued back on Personas. Empty on a dry
    /// run — and empty is the honest answer, because on a dry run kp really did
    /// not queue one.
    #[serde(default)]
    pub persona_request_id: String,
    /// kp's own word for where the request got to.
    pub status: String,
    /// The role kp composed, as a title and a one-line summary.
    #[serde(default)]
    pub job_title: String,
    #[serde(default)]
    pub job_summary: String,
    /// Whether this was a rehearsal.
    #[serde(default)]
    pub dry_run: bool,
}

/// The wire body. Field names are kp's route contract; changing one here
/// without changing it there is a silent 400.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HireWireBody<'a> {
    need: &'a str,
    project: HireWireProject<'a>,
    population: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    budget_usd: Option<f64>,
    /// Tells kp's route to mark the queued request as part of the simulation,
    /// which is what enrols the hired App Master in the attention loop. Always
    /// true from this door: a hire Personas asked for on its own is by
    /// definition an unattended one.
    simulation: bool,
    /// Echoed back through kp into the persona request, so the hired persona's
    /// setup notes can name the persona that asked for it.
    origin_persona_id: &'a str,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    dry_run: bool,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HireWireProject<'a> {
    name: &'a str,
    root_path: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    main_branch: Option<&'a str>,
}

/// Where to send the hire, and with what credential.
///
/// The token is a [`SecureString`], not a `String`: it is zeroized on drop and
/// renders as `[REDACTED]` through both `Debug` and `Display`, so this struct
/// can be logged or `{:?}`-formatted — which a `Debug` derive invites — without
/// the credential riding along. It also has no `Serialize` impl, which makes
/// putting this type on a wire a compile error rather than a leak.
///
/// No `Clone`: `SecureString` deliberately offers an explicit `duplicate()`
/// instead, so every extra copy of a credential is a line someone wrote on
/// purpose. Nothing here needs one — the endpoint is passed by reference.
#[derive(Debug)]
pub(crate) struct KpEndpoint {
    pub base_url: String,
    pub token: SecureString,
}

/// Resolve the kp base URL for this asker.
///
/// Two sources, in this order, and the order is the whole design:
/// 1. the asking persona's own `design_context.kpLink.baseUrl` — a persona kp
///    hired belongs to a specific kp instance, and that is the one it should
///    talk back to;
/// 2. the [`settings_keys::KP_BASE_URL`] setting — the answer for a persona kp
///    never hired (the Architect, an operator-adopted App Master), which has no
///    link of its own.
///
/// Returns `Ok(None)` when neither is set: an install with no kp is not an
/// error until something actually tries to hire.
pub(crate) fn resolve_base_url(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Option<String>, AppError> {
    // A missing persona is not an error HERE: the settings fallback below may
    // still answer, and the caller's own "which persona is asking" check is a
    // better place to refuse an unknown id than a base-URL lookup is.
    if let Ok(p) = crate::db::repos::core::personas::get_by_id(pool, persona_id) {
        if let Some(link) = p.parsed_design_context().kp_link {
            let b = link.base_url.trim().to_string();
            if !b.is_empty() {
                return Ok(Some(b));
            }
        }
    }
    let from_settings =
        crate::db::repos::core::settings::get(pool, personas_db::settings_keys::KP_BASE_URL)?
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
    Ok(from_settings)
}

/// Read the automation token, or say why there is none.
///
/// Fail-closed by construction: an unset variable is a refusal, never a request
/// sent without a credential. An EMPTY variable is treated as unset — the two
/// mean the same thing to an operator and conflating them the other way would
/// send an empty header kp answers 401 to, hiding a configuration mistake
/// behind an authentication failure.
pub(crate) fn resolve_token() -> Result<SecureString, AppError> {
    match std::env::var(AUTOMATION_TOKEN_ENV) {
        Ok(v) if !v.trim().is_empty() => Ok(SecureString::new(v.trim().to_string())),
        _ => Err(AppError::Forbidden(format!(
            "asking kp for a hire is disabled: set the {AUTOMATION_TOKEN_ENV} environment \
             variable to the same value as kp's KP_AUTOMATION_TOKEN"
        ))),
    }
}

/// Resolve both halves of the endpoint, or refuse with the reason.
pub(crate) fn resolve_endpoint(pool: &DbPool, persona_id: &str) -> Result<KpEndpoint, AppError> {
    let base_url = resolve_base_url(pool, persona_id)?.ok_or_else(|| {
        AppError::Validation(format!(
            "no kp instance is configured: the asking persona carries no kpLink, and the \
             `{}` setting is unset",
            personas_db::settings_keys::KP_BASE_URL
        ))
    })?;
    Ok(KpEndpoint {
        base_url,
        token: resolve_token()?,
    })
}

/// The project facts kp needs to scan and name the app.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct ProjectFacts {
    pub name: String,
    pub root_path: String,
    pub main_branch: Option<String>,
}

/// Read the project row into the shape the wire wants.
fn project_facts(pool: &DbPool, project_id: &str) -> Result<ProjectFacts, AppError> {
    let p = crate::db::repos::dev::projects::get_project_by_id(pool, project_id)?;
    Ok(ProjectFacts {
        name: p.name,
        root_path: p.root_path,
        main_branch: p.main_branch.filter(|b| !b.trim().is_empty()),
    })
}

/// Validate a need the way every door onto this module must.
///
/// Bounds rather than rejects an over-long need, for the same reason the
/// decision parser bounds its strings: the caller's request is still a request,
/// and throwing it away over its length would be a worse answer than sending
/// the first [`MAX_NEED_CHARS`] characters of it. An EMPTY need is refused,
/// because there is nothing for kp to compose from.
pub(crate) fn bound_need(raw: &str) -> Result<String, AppError> {
    // `require_non_empty` rather than an open-coded `is_empty()` with its own
    // hand-written sentence: the shared vocabulary keeps the FIELD NAME in the
    // refusal, which is exactly what an inline check destroys at the moment it
    // is applied (census `hand-rolled-emptiness-refusal`).
    require_non_empty("need", raw)?;
    Ok(raw.trim().chars().take(MAX_NEED_CHARS).collect())
}

/// Ask kp for a role.
///
/// The whole operation: resolve the endpoint, read the project, POST, and
/// record what happened in the asking persona's attention ledger and — on a
/// real hire — in the project's memory.
///
/// Recording is best-effort and never fails the hire: kp has already composed
/// and queued the role by the time these run, so a failed local write must not
/// be reported to the caller as a failed hire. That asymmetry is deliberate and
/// is the opposite of the HTTP call's, which IS propagated.
pub(crate) async fn request_hire(
    pool: &DbPool,
    req: HireRequest,
) -> Result<HireRequestOutcome, AppError> {
    let need = bound_need(&req.need)?;

    // THE CAP, checked before anything leaves the process.
    //
    // A hire that lands mints a persona, so it raises the counted population —
    // `raises_count = true`. Refusing HERE rather than at the arriving
    // persona-request is what makes the cap mean something: kp would otherwise
    // run a repository scan, an intake and a composer (all of them LLM calls,
    // all of them billed) to produce a role Personas was always going to
    // refuse. The refusal text comes from `active_persona_cap` so an operator
    // meets one sentence at every door rather than a paraphrase per door.
    //
    // A DRY RUN is exempt: it mints nothing, and the whole point of a rehearsal
    // is to see the role a full roster would have asked for.
    if !req.dry_run {
        personas_engine::active_persona_cap::check_active_persona_headroom(pool, true)?;
    }

    let endpoint = resolve_endpoint(pool, &req.persona_id)?;
    let facts = project_facts(pool, &req.project_id)?;

    let body = HireWireBody {
        need: &need,
        project: HireWireProject {
            name: &facts.name,
            root_path: &facts.root_path,
            main_branch: facts.main_branch.as_deref(),
        },
        population: "agent",
        budget_usd: req.budget_usd,
        simulation: true,
        origin_persona_id: &req.persona_id,
        dry_run: req.dry_run,
    };

    let ledger_id = open_ledger_row(pool, &req.persona_id);
    let result = post_hire(&endpoint, &body).await;

    match &result {
        Ok(outcome) => {
            close_ledger_row(pool, ledger_id.as_deref(), Ok(outcome));
            if !req.dry_run {
                record_project_memory(pool, &req.project_id, &need, outcome);
            }
        }
        Err(e) => close_ledger_row(pool, ledger_id.as_deref(), Err(e)),
    }
    result
}

/// The single send path. Separated from [`request_hire`] so a test can drive it
/// against a loopback listener without a database.
pub(crate) async fn post_hire(
    endpoint: &KpEndpoint,
    body: &HireWireBody<'_>,
) -> Result<HireRequestOutcome, AppError> {
    let url = format!(
        "{}/api/agents/hire-from-need",
        endpoint.base_url.trim_end_matches('/')
    );
    let resp = crate::SHARED_HTTP
        .post(&url)
        .timeout(HIRE_TIMEOUT)
        .header(AUTOMATION_TOKEN_HEADER, endpoint.token.expose_secret())
        .json(body)
        .send()
        .await
        .map_err(|e| {
            // The URL carries no credential (the token is a header), but a
            // reqwest error Display can embed it anyway and the operator's kp
            // host is not the log's business.
            if e.is_timeout() {
                AppError::NetworkOffline(format!(
                    "kp did not answer the hire within {}s",
                    HIRE_TIMEOUT.as_secs()
                ))
            } else {
                AppError::NetworkOffline(format!("kp hire request failed: {}", e.without_url()))
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        // kp answers a refusal as `{error, code}` — surface the code, which is
        // stable, in preference to the prose, which is localised.
        let detail = resp.text().await.unwrap_or_default();
        let code = serde_json::from_str::<serde_json::Value>(&detail)
            .ok()
            .and_then(|v| {
                v.get("code")
                    .and_then(|c| c.as_str())
                    .map(str::to_string)
                    .or_else(|| v.get("error").and_then(|c| c.as_str()).map(str::to_string))
            })
            .unwrap_or_else(|| detail.chars().take(200).collect());
        return Err(match status {
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                AppError::Auth(format!(
                    "kp rejected the automation token ({status}): {code}. Check that \
                     {AUTOMATION_TOKEN_ENV} matches kp's KP_AUTOMATION_TOKEN"
                ))
            }
            reqwest::StatusCode::TOO_MANY_REQUESTS => {
                AppError::RateLimited(format!("kp rate-limited the hire: {code}"))
            }
            reqwest::StatusCode::NOT_FOUND => {
                AppError::NotFound(format!("kp has no hire-from-need route ({status}): {code}"))
            }
            _ => AppError::External(format!("kp refused the hire ({status}): {code}")),
        });
    }

    resp.json::<HireRequestOutcome>().await.map_err(|e| {
        AppError::External(format!(
            "kp accepted the hire but its answer did not parse: {}",
            e.without_url()
        ))
    })
}

// ---------------------------------------------------------------------------
// Local recording (best-effort; never fails the hire)
// ---------------------------------------------------------------------------

/// Ledger lane for an outbound hire. `persona_attention_ledger.lane` is plain
/// nullable TEXT with no CHECK, so a new lane needs no migration — the same
/// note that licensed `LANE_DECIDE`.
pub(crate) const LANE_HIRE: &str = "hire";

fn open_ledger_row(pool: &DbPool, persona_id: &str) -> Option<String> {
    match crate::db::repos::core::attention_ledger::insert_started(
        pool,
        persona_id,
        None,
        "attention",
        Some(LANE_HIRE),
    ) {
        Ok(id) => Some(id),
        Err(e) => {
            tracing::warn!(persona_id, error = %e,
                "kp_hire_request: could not open the hire ledger row — the hire still goes out");
            None
        }
    }
}

fn close_ledger_row(
    pool: &DbPool,
    ledger_id: Option<&str>,
    outcome: Result<&HireRequestOutcome, &AppError>,
) {
    let Some(id) = ledger_id else {
        return;
    };
    let closed = match outcome {
        Ok(o) => {
            let stats = serde_json::json!({
                "lane": LANE_HIRE,
                "intakeId": o.intake_id,
                "agentId": o.agent_id,
                "personaRequestId": o.persona_request_id,
                "jobTitle": o.job_title,
                "status": o.status,
                "dryRun": o.dry_run,
            });
            // A dry run asked for nothing, so it is a `noop` and not an `acted`
            // — the verdict is what a reviewer scans, and a rehearsal that
            // reads as a hire is the one row that would mislead them.
            let verdict = if o.dry_run { "noop" } else { "acted" };
            crate::db::repos::core::attention_ledger::complete(
                pool,
                id,
                verdict,
                "",
                None,
                Some(&stats.to_string()),
                None,
            )
        }
        Err(e) => crate::db::repos::core::attention_ledger::complete(
            pool,
            id,
            "failed",
            &e.to_string(),
            None,
            None,
            None,
        ),
    };
    if let Err(e) = closed {
        tracing::warn!(ledger_id = id, error = %e,
            "kp_hire_request: failed to close the hire ledger row");
    }
}

/// Write what was hired, and why, into the project's own memory.
///
/// `source_id` is kp's intake id, so the partial unique index on
/// `(project_id, source_kind, source_id)` makes a retried hire idempotent
/// rather than duplicated — `Ok(None)` is that no-op and not a failure.
fn record_project_memory(
    pool: &DbPool,
    project_id: &str,
    need: &str,
    outcome: &HireRequestOutcome,
) {
    let title = if outcome.job_title.trim().is_empty() {
        "Asked kp for a role".to_string()
    } else {
        format!("Hired: {}", outcome.job_title.trim())
    };
    let content = format!(
        "This project asked kp for a role.\n\nThe need as it was stated:\n{need}\n\n\
         kp composed `{}` (intake {}, request {}).",
        if outcome.job_title.trim().is_empty() {
            "(untitled)"
        } else {
            outcome.job_title.trim()
        },
        outcome.intake_id,
        if outcome.persona_request_id.is_empty() {
            "(none)"
        } else {
            &outcome.persona_request_id
        }
    );
    match crate::db::repos::dev_memories::record(
        pool,
        project_id,
        "decision",
        &title,
        &content,
        6,
        "hire_request",
        Some(&outcome.intake_id),
    ) {
        Ok(Some(_)) | Ok(None) => {}
        Err(e) => tracing::warn!(project_id, error = %e,
            "kp_hire_request: the hire went through but the project memory was not recorded"),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn endpoint(base: &str) -> KpEndpoint {
        KpEndpoint {
            base_url: base.to_string(),
            token: SecureString::new("tok-test".to_string()),
        }
    }

    fn body<'a>(need: &'a str, dry_run: bool) -> HireWireBody<'a> {
        HireWireBody {
            need,
            project: HireWireProject {
                name: "bank-core",
                root_path: "C:/bank/core",
                main_branch: None,
            },
            population: "agent",
            budget_usd: Some(40.0),
            simulation: true,
            origin_persona_id: "p-architect",
            dry_run,
        }
    }

    // -- the wire contract ---------------------------------------------------

    #[test]
    fn hire_body_matches_the_kp_route_contract() {
        assert_eq!(
            serde_json::to_value(body("reconcile the ledger", false)).unwrap(),
            serde_json::json!({
                "need": "reconcile the ledger",
                "project": { "name": "bank-core", "rootPath": "C:/bank/core" },
                "population": "agent",
                "budgetUsd": 40.0,
                "simulation": true,
                "originPersonaId": "p-architect",
            })
        );
    }

    /// `dryRun` is present only when true, and an unstated budget is ABSENT
    /// rather than null — kp reads an absent budget as "you decide" and a null
    /// one as a value it must validate.
    #[test]
    fn optional_wire_fields_are_omitted_not_nulled() {
        let mut b = body("n", true);
        b.budget_usd = None;
        let v = serde_json::to_value(&b).unwrap();
        assert_eq!(v["dryRun"], serde_json::json!(true));
        let obj = v.as_object().unwrap();
        assert!(
            !obj.contains_key("budgetUsd"),
            "an unstated budget is absent"
        );

        let plain = serde_json::to_value(body("n", false)).unwrap();
        assert!(
            !plain.as_object().unwrap().contains_key("dryRun"),
            "a real hire does not spell dryRun at all"
        );
    }

    #[test]
    fn the_outcome_reads_kps_answer() {
        let o: HireRequestOutcome = serde_json::from_value(serde_json::json!({
            "intakeId": "int-1",
            "agentId": "ag-1",
            "personaRequestId": "pr-1",
            "status": "pending_approval",
            "jobTitle": "Ledger Reconciliation Engineer",
            "jobSummary": "Owns nightly settlement reconciliation.",
        }))
        .unwrap();
        assert_eq!(o.persona_request_id, "pr-1");
        assert_eq!(o.job_title, "Ledger Reconciliation Engineer");
        assert!(!o.dry_run, "an absent dryRun is false, not a parse failure");

        // A dry run answers without the ids it did not mint, and that must
        // parse — an empty string is the honest value for "kp queued nothing".
        let d: HireRequestOutcome = serde_json::from_value(serde_json::json!({
            "intakeId": "int-2", "status": "composed", "dryRun": true,
        }))
        .unwrap();
        assert!(d.dry_run);
        assert!(d.persona_request_id.is_empty());
    }

    // -- bounds and refusals -------------------------------------------------

    #[test]
    fn a_need_is_bounded_in_characters_and_an_empty_one_is_refused() {
        assert_eq!(
            bound_need(&"x".repeat(5_000)).unwrap().chars().count(),
            MAX_NEED_CHARS
        );
        assert_eq!(bound_need("  hire me  ").unwrap(), "hire me");
        let empty = bound_need("   ").expect_err("an empty need is refused");
        assert!(matches!(empty, AppError::Validation(_)));
        assert!(
            empty.to_string().contains("need"),
            "the shared vocabulary keeps the field name in the refusal, got: {empty}"
        );
    }

    /// The door is closed unless the operator opened it, and the refusal says
    /// which variable to set. Serialised against the process env, which is
    /// global: the guard is restored before the assertions that need it unset.
    #[test]
    fn an_unset_token_refuses_and_names_the_variable() {
        let restore = std::env::var(AUTOMATION_TOKEN_ENV).ok();
        // SAFETY: single-threaded within this test; the previous value is put
        // back before returning so no sibling test observes the change.
        unsafe { std::env::remove_var(AUTOMATION_TOKEN_ENV) };
        let unset = resolve_token();

        unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, "   ") };
        let blank = resolve_token();

        unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, " real-token ") };
        let good = resolve_token();

        match restore {
            Some(v) => unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, v) },
            None => unsafe { std::env::remove_var(AUTOMATION_TOKEN_ENV) },
        }

        let err = unset.expect_err("an unset token refuses");
        assert!(
            err.to_string().contains(AUTOMATION_TOKEN_ENV),
            "the refusal names the variable to set, got: {err}"
        );
        assert!(
            blank.is_err(),
            "an empty variable means unset, not an empty credential"
        );
        assert_eq!(
            good.unwrap().expose_secret(),
            "real-token",
            "the value is trimmed"
        );
    }

    // -- the send path, against a real loopback listener ---------------------

    /// One-shot HTTP listener that answers `status` with `body`, and hands back
    /// the request line + headers + body it received.
    ///
    /// The handle is BOUND, not detached: a panic in the server task has to
    /// reach the test, and the census's `unobservable-detached-task` rule names
    /// exactly the shape where it would not.
    async fn one_shot_kp(
        status: u16,
        payload: &'static str,
    ) -> (String, tokio::task::JoinHandle<String>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap();
            let seen = String::from_utf8_lossy(&buf[..n]).to_string();
            let reason = if status == 200 { "OK" } else { "ERR" };
            let resp = format!(
                "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\n\
                 Content-Length: {}\r\nConnection: close\r\n\r\n{payload}",
                payload.len()
            );
            sock.write_all(resp.as_bytes()).await.unwrap();
            sock.flush().await.unwrap();
            seen
        });
        (format!("http://{addr}"), handle)
    }

    #[tokio::test]
    async fn a_successful_hire_sends_the_token_as_a_header_and_reads_the_answer() {
        let (base, server) = one_shot_kp(
            200,
            r#"{"intakeId":"int-9","agentId":"ag-9","personaRequestId":"pr-9",
                "status":"pending_approval","jobTitle":"Reconciliation Engineer"}"#,
        )
        .await;
        let out = post_hire(&endpoint(&base), &body("the ledger has no owner", false))
            .await
            .expect("kp answered");
        assert_eq!(out.persona_request_id, "pr-9");
        assert_eq!(out.job_title, "Reconciliation Engineer");

        let seen = server.await.expect("the server task did not panic");
        assert!(
            seen.contains("POST /api/agents/hire-from-need"),
            "the route is the one kp exposes, got: {seen}"
        );
        assert!(
            seen.to_ascii_lowercase()
                .contains("x-kp-automation-token: tok-test"),
            "the credential travels as a header"
        );
        assert!(
            seen.contains("\"originPersonaId\":\"p-architect\""),
            "the asker rides along so the hire can name who wanted it"
        );
    }

    /// A refused hire is an ERROR the caller sees, not a warn the caller never
    /// hears about — the one place this module deliberately departs from
    /// `kp_reporter`'s swallow-everything discipline.
    #[tokio::test]
    async fn a_rejected_token_is_an_auth_error_naming_the_variable() {
        let (base, server) =
            one_shot_kp(401, r#"{"error":"Unauthorized.","code":"UNAUTHORIZED"}"#).await;
        let err = post_hire(&endpoint(&base), &body("n", false))
            .await
            .expect_err("401 is a failure");
        let _ = server.await;
        assert!(matches!(err, AppError::Auth(_)), "got {err:?}");
        assert!(err.to_string().contains(AUTOMATION_TOKEN_ENV));
    }

    #[tokio::test]
    async fn a_refusal_surfaces_kps_stable_code_not_its_prose() {
        let (base, server) = one_shot_kp(
            409,
            r#"{"error":"Repo root not allow-listed.","code":"HIRE_ROOT_REFUSED"}"#,
        )
        .await;
        let err = post_hire(&endpoint(&base), &body("n", false))
            .await
            .expect_err("409 is a failure");
        let _ = server.await;
        assert!(
            err.to_string().contains("HIRE_ROOT_REFUSED"),
            "the code is what a caller can branch on, got: {err}"
        );
    }

    // -- the DB doors --------------------------------------------------------

    #[tokio::test]
    async fn a_persona_with_no_link_and_no_setting_has_no_kp_to_ask() {
        let pool = crate::db::init_test_db().unwrap();
        assert_eq!(
            resolve_base_url(&pool, "nobody").expect("resolves"),
            None,
            "an unknown persona and an unset setting is 'no kp', not an error"
        );

        crate::db::repos::core::settings::set(
            &pool,
            personas_db::settings_keys::KP_BASE_URL,
            "http://127.0.0.1:3000",
        )
        .expect("the setting is allow-listed and validates");
        assert_eq!(
            resolve_base_url(&pool, "nobody").expect("resolves"),
            Some("http://127.0.0.1:3000".to_string()),
            "the setting answers for a persona kp never hired"
        );
    }

    #[tokio::test]
    async fn the_base_url_setting_refuses_a_value_that_is_not_a_url() {
        let pool = crate::db::init_test_db().unwrap();
        assert!(
            crate::db::repos::core::settings::set(
                &pool,
                personas_db::settings_keys::KP_BASE_URL,
                "127.0.0.1:3000",
            )
            .is_err(),
            "a schemeless host would be read as a RELATIVE url at send time"
        );
    }

    /// The cap is checked BEFORE the network, so a full roster costs kp
    /// nothing — no scan, no intake, no composer, no billed LLM call — and the
    /// operator meets `active_persona_cap`'s own sentence rather than a
    /// paraphrase of it.
    #[tokio::test]
    async fn a_full_active_persona_cap_refuses_the_hire_before_the_network() {
        let pool = crate::db::init_test_db().unwrap();
        // Cap of ONE with one enabled persona already active: the roster is
        // exactly full, so a hire would be the one that overflows it. (Zero is
        // not usable — the setting's own validator refuses it, min 1.)
        {
            use crate::db::PoolExt;
            pool.conn("cap test")
                .unwrap()
                .execute(
                    "INSERT INTO personas (id, name, system_prompt, enabled, created_at, updated_at)
                     VALUES ('p-active', 'p-active', 'sp', 1, datetime('now'), datetime('now'))",
                    [],
                )
                .unwrap();
        }
        crate::db::repos::core::settings::set(
            &pool,
            personas_db::settings_keys::MAX_ACTIVE_PERSONAS,
            "1",
        )
        .expect("the cap is an allow-listed setting");
        // Base URL points at a closed port: if the cap did NOT refuse, the
        // failure would be a transport error, and this test would say so.
        crate::db::repos::core::settings::set(
            &pool,
            personas_db::settings_keys::KP_BASE_URL,
            "http://127.0.0.1:1",
        )
        .unwrap();
        let restore = std::env::var(AUTOMATION_TOKEN_ENV).ok();
        unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, "tok") };

        let err = request_hire(
            &pool,
            HireRequest {
                persona_id: "p1".into(),
                project_id: "any".into(),
                need: "a real need".into(),
                ..Default::default()
            },
        )
        .await
        .expect_err("a full cap refuses");

        match restore {
            Some(v) => unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, v) },
            None => unsafe { std::env::remove_var(AUTOMATION_TOKEN_ENV) },
        }
        assert!(matches!(err, AppError::Validation(_)), "got {err:?}");
        assert!(
            err.to_string().contains("max_active_personas"),
            "the shared refusal names the setting to raise, got: {err}"
        );
    }

    #[tokio::test]
    async fn a_hire_naming_no_project_refuses_before_it_reaches_the_network() {
        let pool = crate::db::init_test_db().unwrap();
        crate::db::repos::core::settings::set(
            &pool,
            personas_db::settings_keys::KP_BASE_URL,
            "http://127.0.0.1:1",
        )
        .unwrap();
        let restore = std::env::var(AUTOMATION_TOKEN_ENV).ok();
        unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, "tok") };

        let err = request_hire(
            &pool,
            HireRequest {
                persona_id: "p1".into(),
                project_id: "no-such-project".into(),
                need: "a real need".into(),
                ..Default::default()
            },
        )
        .await
        .expect_err("an unknown project is a refusal");

        match restore {
            Some(v) => unsafe { std::env::set_var(AUTOMATION_TOKEN_ENV, v) },
            None => unsafe { std::env::remove_var(AUTOMATION_TOKEN_ENV) },
        }
        assert!(matches!(err, AppError::NotFound(_)), "got {err:?}");
    }
}
