//! **Responsibility engine** (spark `living-agent-core`, WP3) — the ONE
//! accessor module between the `persona_responsibilities` table and everything
//! that used to read the legacy App-master mandate out of `app_settings`.
//!
//! # What generalized what
//!
//! [`crate::app_master`] enforces a *software-engineering* mandate: a scope
//! rung, forbidden change classes, approval gates, an owner, probation-shaped
//! tenure. WP1 promoted that shape to a first-class table
//! (`persona_responsibilities`) that also carries domains OTHER than software
//! (outcomes, objectives, cadence). This module is the seam:
//!
//! * software rows convert **losslessly** to/from [`MandateRecord`]
//!   ([`to_mandate_record`] / [`from_mandate_record`]) — including the
//!   probation bookkeeping, which rides in [`ResponsibilityTenure`];
//! * every legacy reader (`autonomy::mandate_permits_for`, the probation /
//!   reconcile ticks, the overnight budget governor, the kp reporter, the gate
//!   sourcing, the diff chokepoint) now reads through [`mandate_for_project`] /
//!   [`load_mandate_map`], so the TABLE is the storage and `app_settings` rows
//!   are legacy input to [`migrate_legacy_mandates`] only;
//! * the probation carry-outs write their decisions back through
//!   [`store_mandate_record`], and the kp hire door inserts through
//!   [`record_hire`].
//!
//! # What a mandate is, in table terms — documented, not implied
//!
//! A project's mandate is its newest **`status = 'active'`** charter with
//! `domain = 'software_engineering'` and a non-NULL `project_id`. Suspended and
//! retired charters grant nothing: like a project with no row at all, they read
//! as *unmandated*, and every mandate gate in this codebase is additive — an
//! unmandated project keeps its previous behaviour exactly. Note the two
//! retirements are different doors on purpose: a probation decision of
//! `retired` stamps the TENURE bookkeeping and leaves the charter row active
//! (exactly what the legacy record did, so `retire_persona_db` and
//! `tenure_window` keep behaving byte-identically), while retiring the
//! *charter* (`retire_persona_responsibility`, or a re-hire replacing it)
//! removes the mandate from every reader.
//!
//! # Where the VERDICTS stay
//!
//! This module hands out records; it never answers "may this action run".
//! The permit doors remain [`crate::autonomy::mandate_permits`] /
//! [`crate::autonomy::mandate_permits_for`] and [`Mandate::permits_rung`] —
//! the autonomy front door the census rule guards.

use std::collections::HashMap;

use personas_core::error::AppError;
use personas_core::validation::contract::{self, ValidationError};
use personas_core::validation::persona::MAX_PROMPT_BYTES;
use personas_db::models::{
    CreatePersonaResponsibilityInput, PersonaResponsibility, ResponsibilityCadence,
    ResponsibilitySpec, ResponsibilityStatus, ResponsibilityTenure,
    UpdatePersonaResponsibilityInput,
};
use personas_db::repos::core::responsibilities as repo;
use personas_db::DbPool;

use crate::app_master::{self, ForbiddenClass, Mandate, MandateRecord, MAX_GRANTABLE_RUNG};

// ---------------------------------------------------------------------------
// Domains and their refusal-class libraries
// ---------------------------------------------------------------------------

/// The domain whose rows ARE App-master mandates.
pub const DOMAIN_SOFTWARE_ENGINEERING: &str = "software_engineering";
/// The default domain for operator-authored charters.
pub const DOMAIN_GENERAL: &str = "general";

/// kp's six forbidden change classes, in wire spelling — kept in lockstep with
/// [`ALL_FORBIDDEN_CLASSES`] by a unit test below, so a seventh class added to
/// the enum cannot silently be missing from the library.
pub const SOFTWARE_ENGINEERING_CLASSES: [&str; 6] = [
    "test_deletion_or_skip",
    "suppression_directive",
    "gate_configuration",
    "dependency_bump_to_satisfy_check",
    "credentials_or_permissions",
    "delivery_configuration",
];

/// The general-domain refusal library — coarse action families rather than
/// diff shapes, because a general charter has no diff to scan.
pub const GENERAL_CLASSES: [&str; 4] = [
    "ExternalSend",
    "CredentialUse",
    "DataDeletion",
    "PublicPublish",
];

/// Free-form refusal classes are accepted when spelled `custom:<anything>`,
/// so an operator can name a line the libraries do not — while a bare unknown
/// string (usually a typo of a library class) is refused at intake.
pub const CUSTOM_CLASS_PREFIX: &str = "custom:";

/// The declared domain → refusal-class-library table.
pub const DOMAIN_CLASS_SETS: [(&str, &[&str]); 2] = [
    (DOMAIN_SOFTWARE_ENGINEERING, &SOFTWARE_ENGINEERING_CLASSES),
    (DOMAIN_GENERAL, &GENERAL_CLASSES),
];

/// The refusal-class library for a domain. Any domain without a library of its
/// own (charters are an open vocabulary — 'docs', 'support', …) gets the
/// general library: it names action families, not code shapes, so it is the
/// one that transfers.
pub fn classes_for_domain(domain: &str) -> &'static [&'static str] {
    DOMAIN_CLASS_SETS
        .iter()
        .find(|(d, _)| *d == domain)
        .map(|(_, set)| *set)
        .unwrap_or(&GENERAL_CLASSES)
}

fn class_is_valid(class: &str) -> bool {
    let c = class.trim();
    SOFTWARE_ENGINEERING_CLASSES.contains(&c)
        || GENERAL_CLASSES.contains(&c)
        || c.strip_prefix(CUSTOM_CLASS_PREFIX)
            .is_some_and(|rest| !rest.trim().is_empty())
}

// ---------------------------------------------------------------------------
// Intake validation
// ---------------------------------------------------------------------------

/// Highest (most urgent) charter priority the decision lane accepts.
pub const MIN_CHARTER_PRIORITY: u8 = 1;
/// Lowest charter priority the decision lane accepts.
pub const MAX_CHARTER_PRIORITY: u8 = 5;

/// Validate a charter at intake — the same posture as the App-master mandate:
/// refuse rather than store-and-remember-to-ignore.
///
/// * rung 3+ is refused exactly like [`Mandate`] intake refuses it (a holder
///   who can deploy or edit its own gates is grading its own exam);
/// * the title must say something;
/// * the status must be one of the four the DB CHECK admits;
/// * every refusal class must be a library class or `custom:`-prefixed — an
///   unknown bare string is almost always a typo, and storing it would produce
///   a charter that LOOKS stricter than it is;
/// * a charter carries a `project_id` OR a `workspace_id`, never both — the
///   two are different scopes for the same holder and nothing downstream has a
///   rule for which would win.
pub fn validate(input: &PersonaResponsibility) -> Result<(), AppError> {
    // Through the validation contract so the {field, rule} identity survives
    // (command-input-validation golden path), not an open-coded refusal.
    contract::check(
        [
            input.title.trim().is_empty().then(|| {
                ValidationError::new(
                    "title",
                    "required",
                    "A responsibility needs a title: the charter is the operator's record of \
                     what this persona holds, and an unnamed one cannot be reviewed",
                )
            }),
            // The procedure is prompt-shaped text; it shares the prompt's
            // byte ceiling rather than inventing a second one.
            (input.procedure.len() > MAX_PROMPT_BYTES).then(|| {
                ValidationError::new(
                    "procedure",
                    "max_length",
                    format!(
                        "Procedure exceeds maximum size of {} KB",
                        MAX_PROMPT_BYTES / 1024
                    ),
                )
            }),
            input
                .connectors
                .iter()
                .any(|c| c.trim().is_empty())
                .then(|| {
                    ValidationError::new(
                        "connectors",
                        "required",
                        "Every connector entry must be a non-empty connector id",
                    )
                }),
            // The decision lane reads `priority` as an ORDER, so an
            // out-of-band value would silently sort somewhere nobody meant.
            // `None` stays legal and means "the persona decides".
            input
                .spec
                .priority
                .filter(|p| !(MIN_CHARTER_PRIORITY..=MAX_CHARTER_PRIORITY).contains(p))
                .map(|p| {
                    ValidationError::new(
                        "spec.priority",
                        "range",
                        format!(
                            "Charter priority {p} is out of range: use \
                             {MIN_CHARTER_PRIORITY} (highest) .. {MAX_CHARTER_PRIORITY} \
                             (lowest), or omit it to let the persona decide"
                        ),
                    )
                }),
            // A charter binds to ONE thing. `project_id` gives the decision a
            // codebase to be about; `workspace_id` gives it a portfolio (the
            // Architect, Grand Simulation G1). A row carrying both would make
            // `is_app_master` true for two different reasons and leave every
            // reader to guess which scope the charter actually governs — so it
            // is refused at intake rather than resolved by precedence.
            (input
                .project_id
                .as_deref()
                .is_some_and(|p| !p.trim().is_empty())
                && input
                    .workspace_id
                    .as_deref()
                    .is_some_and(|w| !w.trim().is_empty()))
            .then(|| {
                ValidationError::new(
                    "workspace_id",
                    "conflict",
                    "A charter binds to a project OR to a workspace, never both: clear one \
                     of them. A project-bound charter is an App Master's; a workspace-bound \
                     one is the Architect's and sees every project in the workspace",
                )
            }),
        ]
        .into_iter()
        .flatten()
        .collect(),
    )?;
    if input.scope_rung > MAX_GRANTABLE_RUNG {
        return Err(AppError::Validation(format!(
            "Scope rung {} ({}) is not grantable: rung {} ({}) is the ceiling, same as the \
             App master mandate intake",
            input.scope_rung,
            app_master::rung_label(input.scope_rung),
            MAX_GRANTABLE_RUNG,
            app_master::rung_label(MAX_GRANTABLE_RUNG),
        )));
    }
    input.status.parse::<ResponsibilityStatus>()?;
    for class in &input.refusal_classes {
        if !class_is_valid(class) {
            return Err(AppError::Validation(format!(
                "Unknown refusal class `{class}`: use a library class \
                 (software_engineering: {}; general: {}) or prefix a free-form one with \
                 `{CUSTOM_CLASS_PREFIX}`",
                SOFTWARE_ENGINEERING_CLASSES.join(", "),
                GENERAL_CLASSES.join(", "),
            )));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// MandateRecord <-> PersonaResponsibility (lossless for software rows)
// ---------------------------------------------------------------------------

fn tenure_from_record(rec: &MandateRecord) -> ResponsibilityTenure {
    ResponsibilityTenure {
        hired_at: (!rec.hired_at.is_empty()).then(|| rec.hired_at.clone()),
        probation_ends_at: (!rec.probation_ends_at.is_empty())
            .then(|| rec.probation_ends_at.clone()),
        review_cadence_days: Some(rec.review_cadence_days),
        retire_criteria: rec.retire_criteria.clone(),
        probation_decided_at: rec.probation_decided_at.clone(),
        probation_decision: rec.probation_decision.clone(),
        probation_review_id: rec.probation_review_id.clone(),
        headless_incomplete_streak: (rec.headless_incomplete_streak != 0)
            .then_some(rec.headless_incomplete_streak),
    }
}

/// Convert a software charter row into the [`MandateRecord`] every legacy
/// consumer speaks. Lossless for rows this module wrote: every mandate field
/// has a column or a tenure key, and the round trip is unit-tested below.
///
/// A refusal class outside the six-value software vocabulary (a `custom:`
/// entry, or a general-domain class on a mixed row) is **dropped from the
/// enum list**, deliberately: [`app_master::scan_diff`] cannot enforce a class
/// it does not understand, and carrying it would produce a mandate that looks
/// stricter than it is — the exact thing `ForbiddenClass::parse` refuses.
pub fn to_mandate_record(r: &PersonaResponsibility) -> MandateRecord {
    let forbidden_classes: Vec<ForbiddenClass> = r
        .refusal_classes
        .iter()
        .filter_map(|c| {
            let parsed = ForbiddenClass::parse(c);
            if parsed.is_none() {
                tracing::debug!(
                    responsibility_id = %r.id,
                    class = %c,
                    "responsibility: refusal class outside the software vocabulary — \
                     not enforceable by scan_diff, dropped from the mandate view"
                );
            }
            parsed
        })
        .collect();
    MandateRecord {
        persona_id: r.persona_id.clone(),
        project_id: r.project_id.clone().unwrap_or_default(),
        mandate: Mandate {
            scope_rung: r.scope_rung,
            forbidden_classes,
            approval_gates: r.approval_gates.clone(),
            owner: r.owner.clone(),
        },
        probation_ends_at: r.tenure.probation_ends_at.clone().unwrap_or_default(),
        hired_at: r.tenure.hired_at.clone().unwrap_or_default(),
        review_cadence_days: r.tenure.review_cadence_days.unwrap_or(0),
        budget_monthly_usd: r.budget_monthly_usd,
        retire_criteria: r.tenure.retire_criteria.clone(),
        probation_decided_at: r.tenure.probation_decided_at.clone(),
        probation_decision: r.tenure.probation_decision.clone(),
        probation_review_id: r.tenure.probation_review_id.clone(),
        headless_incomplete_streak: r.tenure.headless_incomplete_streak.unwrap_or(0),
    }
}

/// The inverse of [`to_mandate_record`]: a `domain = 'software_engineering'`
/// charter carrying the record's every field. `id` / `created_at` /
/// `updated_at` come back empty — storage assigns them at insert — and the
/// default title / `source = 'migration'` are placeholders the two real
/// writers ([`record_hire`], [`migrate_legacy_mandates`]) override.
pub fn from_mandate_record(rec: &MandateRecord, persona_id: &str) -> PersonaResponsibility {
    PersonaResponsibility {
        id: String::new(),
        persona_id: persona_id.to_string(),
        title: format!("App master for {}", rec.project_id),
        domain: DOMAIN_SOFTWARE_ENGINEERING.to_string(),
        outcomes: Vec::new(),
        objectives: Vec::new(),
        scope_rung: rec.mandate.scope_rung,
        refusal_classes: rec
            .mandate
            .forbidden_classes
            .iter()
            .map(|c| c.as_str().to_string())
            .collect(),
        approval_gates: rec.mandate.approval_gates.clone(),
        owner: rec.mandate.owner.clone(),
        // Attention stays OFF in v1: hiring must not silently enrol a persona
        // in a loop that does not ship until WP5.
        cadence: ResponsibilityCadence::default(),
        budget_monthly_usd: rec.budget_monthly_usd,
        tenure: tenure_from_record(rec),
        status: ResponsibilityStatus::Active.as_str().to_string(),
        project_id: (!rec.project_id.is_empty()).then(|| rec.project_id.clone()),
        // A mandate record IS a project's; the workspace binding has no place
        // in it and must stay absent rather than borrow the project id.
        workspace_id: None,
        source: "migration".to_string(),
        connectors: Vec::new(),
        procedure: String::new(),
        spec: ResponsibilitySpec::default(),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

// ---------------------------------------------------------------------------
// The accessors legacy readers moved to
// ---------------------------------------------------------------------------

/// One project's mandate, read from the TABLE. `Ok(None)` for a project with
/// no active software charter — the common case, and never an error.
pub fn mandate_for_project(
    pool: &DbPool,
    project_id: &str,
) -> Result<Option<MandateRecord>, AppError> {
    let rows = repo::list_by_project_domain(pool, project_id, DOMAIN_SOFTWARE_ENGINEERING, true)?;
    if rows.len() > 1 {
        tracing::warn!(
            project_id,
            rows = rows.len(),
            "responsibility: a project holds more than one active software charter; \
             the newest one is the mandate (a hire is supposed to REPLACE)"
        );
    }
    Ok(rows.first().map(to_mandate_record))
}

/// [`mandate_for_project`] with the legacy `get_mandate` posture: a row that
/// cannot be read is treated as **absent** and logged, never as a permissive
/// mandate — and, because every mandate gate is additive, absent means the
/// project keeps its previous behaviour exactly.
pub fn mandate_for_project_or_none(pool: &DbPool, project_id: &str) -> Option<MandateRecord> {
    match mandate_for_project(pool, project_id) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(
                project_id,
                error = %e,
                "responsibility: mandate read failed; treating the project as unmandated"
            );
            None
        }
    }
}

/// Every project-bound active software charter, as mandate records.
pub fn load_all_mandates(pool: &DbPool) -> Result<Vec<MandateRecord>, AppError> {
    Ok(
        repo::list_active_project_bound(pool, DOMAIN_SOFTWARE_ENGINEERING)?
            .iter()
            .map(to_mandate_record)
            .collect(),
    )
}

/// [`load_all_mandates`] in the shape the tick loops consume — the same
/// project-keyed map (and the same never-fails posture) the legacy
/// `app_master::load_mandates` had: a read failure logs and yields an empty
/// map, so a tick over a briefly-unreadable database stays a no-op instead of
/// a crash. Rows are ordered oldest-first, so on the (repaired-loudly) shape
/// of two active charters on one project the NEWEST wins the map slot,
/// matching [`mandate_for_project`].
pub fn load_mandate_map(pool: &DbPool) -> HashMap<String, MandateRecord> {
    let mut map = HashMap::new();
    match load_all_mandates(pool) {
        Ok(records) => {
            for record in records {
                map.insert(record.project_id.clone(), record);
            }
        }
        Err(e) => {
            tracing::warn!(
                error = %e,
                "responsibility: could not load mandates; this tick sees none"
            );
        }
    }
    map
}

// ---------------------------------------------------------------------------
// The write doors
// ---------------------------------------------------------------------------

fn create_from_responsibility(
    pool: &DbPool,
    resp: &PersonaResponsibility,
    source: &str,
) -> Result<PersonaResponsibility, AppError> {
    repo::create(
        pool,
        personas_db::repos::core::responsibilities::CreateResponsibilityInput {
            persona_id: &resp.persona_id,
            title: &resp.title,
            domain: &resp.domain,
            outcomes: &resp.outcomes,
            objectives: &resp.objectives,
            scope_rung: resp.scope_rung,
            refusal_classes: &resp.refusal_classes,
            approval_gates: &resp.approval_gates,
            owner: &resp.owner,
            cadence: &resp.cadence,
            budget_monthly_usd: resp.budget_monthly_usd,
            tenure: &resp.tenure,
            status: &resp.status,
            project_id: resp.project_id.as_deref(),
            workspace_id: resp.workspace_id.as_deref(),
            source,
            connectors: &resp.connectors,
            procedure: &resp.procedure,
            spec: &resp.spec,
        },
    )
}

/// Retire every active software charter on the record's project, then insert a
/// fresh one — the table spelling of the legacy single-key overwrite: a new
/// hire REPLACES, which is what resets the probation bookkeeping and the
/// tenure start (`app_master.rs` documents why inheriting either is wrong).
/// Returns the created row, storage-assigned `id` included.
fn replace_active(
    pool: &DbPool,
    record: &MandateRecord,
    title: Option<&str>,
    source: &str,
) -> Result<PersonaResponsibility, AppError> {
    for row in
        repo::list_by_project_domain(pool, &record.project_id, DOMAIN_SOFTWARE_ENGINEERING, true)?
    {
        repo::set_status(pool, &row.id, ResponsibilityStatus::Retired)?;
    }
    let mut resp = from_mandate_record(record, &record.persona_id);
    if let Some(t) = title {
        resp.title = t.to_string();
    }
    validate(&resp)?;
    create_from_responsibility(pool, &resp, source)
}

/// Write a mandate record back to its charter row — the door the probation
/// carry-outs use (`apply_app_master_probation_decision`, the raise pass's
/// review-id stamp). The same holder's active row is updated in place; a
/// record naming a DIFFERENT holder (or a project with no row) goes through
/// the replace path, which is exactly what the legacy `set_mandate` overwrite
/// did.
pub fn store_mandate_record(pool: &DbPool, record: &MandateRecord) -> Result<(), AppError> {
    contract::check(
        record
            .project_id
            .trim()
            .is_empty()
            .then(|| {
                ValidationError::new(
                    "project_id",
                    "required",
                    "A mandate record needs a project id: an unbound mandate governs nothing",
                )
            })
            .into_iter()
            .collect(),
    )?;
    let rows =
        repo::list_by_project_domain(pool, &record.project_id, DOMAIN_SOFTWARE_ENGINEERING, true)?;
    if let Some(row) = rows.first().filter(|r| r.persona_id == record.persona_id) {
        repo::update(
            pool,
            &row.id,
            personas_db::repos::core::responsibilities::UpdateResponsibilityInput {
                scope_rung: Some(record.mandate.scope_rung),
                refusal_classes: Some(
                    record
                        .mandate
                        .forbidden_classes
                        .iter()
                        .map(|c| c.as_str().to_string())
                        .collect(),
                ),
                approval_gates: Some(record.mandate.approval_gates.clone()),
                owner: Some(record.mandate.owner.clone()),
                budget_monthly_usd: Some(record.budget_monthly_usd),
                tenure: Some(tenure_from_record(record)),
                ..Default::default()
            },
        )?;
        return Ok(());
    }
    // No row for this holder: a fresh write. `kp-hire` because MandateRecord
    // IS the hire contract's shape — the operator door never passes this way.
    replace_active(pool, record, None, "kp-hire").map(|_| ())
}

/// The hire door's insert: replace the project's charter with this hire's,
/// titled for the operator (`source = 'kp-hire'`).
///
/// Returns the created charter row so the hire flow can stamp its
/// storage-assigned id (`resp_…`) onto the persona's
/// `design_context.appMaster.mandateKey` — the pointer every later reader of
/// the link follows back to this row.
pub fn record_hire(
    pool: &DbPool,
    record: &MandateRecord,
    title: &str,
) -> Result<PersonaResponsibility, AppError> {
    contract::check(
        record
            .project_id
            .trim()
            .is_empty()
            .then(|| {
                ValidationError::new(
                    "project_id",
                    "required",
                    "A hire needs a project id: an unbound mandate governs nothing",
                )
            })
            .into_iter()
            .collect(),
    )?;
    replace_active(pool, record, Some(title), "kp-hire")
}

// ---------------------------------------------------------------------------
// The operator doors (commands delegate here)
// ---------------------------------------------------------------------------

/// Create an operator-authored charter: validate, then insert with
/// `source = 'operator'`.
pub fn create_from_input(
    pool: &DbPool,
    input: &CreatePersonaResponsibilityInput,
) -> Result<PersonaResponsibility, AppError> {
    let resp = PersonaResponsibility {
        id: String::new(),
        persona_id: input.persona_id.clone(),
        title: input.title.clone(),
        domain: input
            .domain
            .clone()
            .filter(|d| !d.trim().is_empty())
            .unwrap_or_else(|| DOMAIN_GENERAL.to_string()),
        outcomes: input.outcomes.clone(),
        objectives: input.objectives.clone(),
        scope_rung: input.scope_rung,
        refusal_classes: input.refusal_classes.clone(),
        approval_gates: input.approval_gates.clone(),
        owner: input.owner.clone(),
        cadence: input.cadence.clone(),
        budget_monthly_usd: input.budget_monthly_usd,
        tenure: input.tenure.clone(),
        status: input
            .status
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| ResponsibilityStatus::Active.as_str().to_string()),
        project_id: input.project_id.clone(),
        workspace_id: input.workspace_id.clone(),
        source: "operator".to_string(),
        connectors: input.connectors.clone(),
        procedure: input.procedure.clone(),
        spec: input.spec.clone(),
        created_at: String::new(),
        updated_at: String::new(),
    };
    validate(&resp)?;
    create_from_responsibility(pool, &resp, "operator")
}

/// Partial update through the same validation the create door runs: the row
/// is fetched, the patch applied, and the MERGED charter validated — so a
/// domain change re-judges the classes it now stands next to.
pub fn update_from_input(
    pool: &DbPool,
    id: &str,
    input: UpdatePersonaResponsibilityInput,
) -> Result<PersonaResponsibility, AppError> {
    let Some(existing) = repo::get_by_id(pool, id)? else {
        return Err(AppError::NotFound(format!("Responsibility {id}")));
    };
    let merged = PersonaResponsibility {
        title: input.title.clone().unwrap_or(existing.title),
        domain: input.domain.clone().unwrap_or(existing.domain),
        outcomes: input.outcomes.clone().unwrap_or(existing.outcomes),
        objectives: input.objectives.clone().unwrap_or(existing.objectives),
        scope_rung: input.scope_rung.unwrap_or(existing.scope_rung),
        refusal_classes: input
            .refusal_classes
            .clone()
            .unwrap_or(existing.refusal_classes),
        approval_gates: input
            .approval_gates
            .clone()
            .unwrap_or(existing.approval_gates),
        owner: input.owner.clone().unwrap_or(existing.owner),
        cadence: input.cadence.clone().unwrap_or(existing.cadence),
        budget_monthly_usd: match input.budget_monthly_usd {
            Some(v) => v,
            None => existing.budget_monthly_usd,
        },
        tenure: input.tenure.clone().unwrap_or(existing.tenure),
        project_id: match input.project_id.clone() {
            Some(v) => v,
            None => existing.project_id,
        },
        workspace_id: match input.workspace_id.clone() {
            Some(v) => v,
            None => existing.workspace_id,
        },
        connectors: input.connectors.clone().unwrap_or(existing.connectors),
        procedure: input.procedure.clone().unwrap_or(existing.procedure),
        spec: input.spec.clone().unwrap_or(existing.spec),
        ..PersonaResponsibility {
            id: existing.id,
            persona_id: existing.persona_id,
            status: existing.status,
            source: existing.source,
            created_at: existing.created_at,
            updated_at: existing.updated_at,
            ..Default::default()
        }
    };
    validate(&merged)?;
    repo::update(
        pool,
        id,
        personas_db::repos::core::responsibilities::UpdateResponsibilityInput {
            title: input.title,
            domain: input.domain,
            outcomes: input.outcomes,
            objectives: input.objectives,
            scope_rung: input.scope_rung,
            refusal_classes: input.refusal_classes,
            approval_gates: input.approval_gates,
            owner: input.owner,
            cadence: input.cadence,
            budget_monthly_usd: input.budget_monthly_usd,
            tenure: input.tenure,
            project_id: input.project_id,
            workspace_id: input.workspace_id,
            connectors: input.connectors,
            procedure: input.procedure,
            spec: input.spec,
        },
    )
}

// ---------------------------------------------------------------------------
// Legacy migration (boot-time, idempotent)
// ---------------------------------------------------------------------------

/// Move every legacy `app_master_mandate:<project_id>` `app_settings` row into
/// the `persona_responsibilities` table (`source = 'migration'`), deleting the
/// settings row once its content is durably in the table.
///
/// Returns the number of legacy rows fully migrated (table row present AND
/// settings row deleted) **this run** — on a healthy second boot that is `0`,
/// because there is nothing left to move.
///
/// Idempotent by construction: the existence guard is "(persona_id,
/// project_id) already has a charter row", so a crash between insert and
/// delete re-runs as a plain delete. Two shapes are left in place, warned
/// about, and never counted:
///
/// * a row whose JSON does not parse — deleting it would destroy the only
///   copy of whatever it was;
/// * a row whose persona no longer exists — the table's FK (`personas(id)`,
///   CASCADE) cannot represent it. The legacy storage kept such orphans
///   visible and the probation tick deferred on them forever; post-migration
///   they are simply inert, which is the one deliberate behaviour change here.
pub fn migrate_legacy_mandates(pool: &DbPool) -> Result<usize, AppError> {
    let rows = personas_db::repos::core::settings::get_by_prefix(
        pool,
        app_master::APP_MASTER_MANDATE_PREFIX,
    )?;
    let mut migrated = 0usize;
    for (key, value) in rows {
        let Some(key_project_id) = key.strip_prefix(app_master::APP_MASTER_MANDATE_PREFIX) else {
            continue;
        };
        let mut record = match serde_json::from_str::<MandateRecord>(&value) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    project_id = key_project_id,
                    error = %e,
                    "responsibility migration: legacy mandate row does not parse; \
                     left in app_settings"
                );
                continue;
            }
        };
        if record.project_id != key_project_id {
            tracing::warn!(
                key_project_id,
                record_project_id = %record.project_id,
                "responsibility migration: key and record disagree on the project; \
                 the key wins (it is what the legacy readers keyed the map by)"
            );
            record.project_id = key_project_id.to_string();
        }
        let already = repo::exists_for_persona_project(pool, &record.persona_id, key_project_id)?;
        if !already {
            let mut resp = from_mandate_record(&record, &record.persona_id);
            // Best-effort project name for the operator-facing title; the id
            // is the honest fallback.
            if let Ok(project) =
                personas_db::repos::dev::projects::get_project_by_id(pool, key_project_id)
            {
                resp.title = format!("App master for {}", project.name);
            }
            if let Err(e) = create_from_responsibility(pool, &resp, "migration") {
                tracing::warn!(
                    project_id = key_project_id,
                    persona_id = %record.persona_id,
                    error = %e,
                    "responsibility migration: could not insert the charter row \
                     (persona deleted?); the legacy app_settings row stays put"
                );
                continue;
            }
        }
        match personas_db::repos::core::settings::delete(pool, &key) {
            Ok(_) => migrated += 1,
            Err(e) => tracing::warn!(
                project_id = key_project_id,
                error = %e,
                "responsibility migration: charter row written but the legacy \
                 app_settings row could not be deleted; next boot retries the delete"
            ),
        }
    }
    Ok(migrated)
}

/// The rung a charter actually runs at: its own, lifted by the holder's
/// software-engineering MANDATE for the same ground (the same project, or the
/// same workspace for a workspace-bound charter), capped at
/// [`MAX_GRANTABLE_RUNG`].
///
/// Rung 3 became grantable on 2026-09-09, and the charters adopted before it
/// were created at [`app_master::RUNG_BRANCH`] with nothing raising them
/// afterwards. A rung-3 mandate that says "you merge" therefore sat beside
/// rung-2 charters that say "never merge" — the holder read both, believed the
/// charter, and parked its branches (88a6d09d). Resolving the rung where it is
/// READ (and where the dispatch decides) keeps the two in agreement without a
/// migration that would rewrite the operator's own rows.
///
/// A mandate never LOWERS a charter, and a charter bound to neither a project
/// nor a workspace is never lifted: there is no ground to match it on.
///
/// Takes the holder's charters as an ITERATOR of references so the two callers
/// that hold them differently — the prompt renderer's `&[PersonaResponsibility]`
/// and the attention loop's `&[&PersonaResponsibility]` — reach the same rule
/// instead of one of them growing its own copy.
pub fn effective_scope_rung<'a, I>(charter: &PersonaResponsibility, persona_charters: I) -> u8
where
    I: IntoIterator<Item = &'a PersonaResponsibility>,
{
    let ground = |r: &PersonaResponsibility| -> Option<(bool, String)> {
        if let Some(p) = r
            .project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            return Some((true, p.to_string()));
        }
        r.workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|w| (false, w.to_string()))
    };
    let Some(mine) = ground(charter) else {
        return charter.scope_rung.min(MAX_GRANTABLE_RUNG);
    };
    let mandate_rung = persona_charters
        .into_iter()
        .filter(|r| {
            r.domain == DOMAIN_SOFTWARE_ENGINEERING
                && r.status == ResponsibilityStatus::Active.as_str()
                && ground(r).as_ref() == Some(&mine)
        })
        .map(|r| r.scope_rung)
        .max()
        .unwrap_or(0);
    charter.scope_rung.max(mandate_rung).min(MAX_GRANTABLE_RUNG)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_master::ALL_FORBIDDEN_CLASSES;
    use personas_db::init_test_db;

    fn insert_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    fn record(persona_id: &str, project_id: &str) -> MandateRecord {
        MandateRecord {
            persona_id: persona_id.into(),
            project_id: project_id.into(),
            mandate: Mandate {
                scope_rung: 2,
                forbidden_classes: vec![
                    ForbiddenClass::TestDeletionOrSkip,
                    ForbiddenClass::GateConfiguration,
                ],
                approval_gates: vec!["npm test".into()],
                owner: "ana@example.com".into(),
            },
            probation_ends_at: "2026-09-22T00:00:00+00:00".into(),
            hired_at: "2026-08-23T00:00:00+00:00".into(),
            review_cadence_days: 30,
            budget_monthly_usd: Some(5.0),
            retire_criteria: vec!["no merged proposal in two windows".into()],
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: Some("rev-1".into()),
            headless_incomplete_streak: 1,
        }
    }

    /// A charter at rung R, on the given ground, in the given domain.
    fn rung_charter(
        id: &str,
        domain: &str,
        rung: u8,
        project_id: Option<&str>,
        workspace_id: Option<&str>,
    ) -> PersonaResponsibility {
        PersonaResponsibility {
            id: id.into(),
            persona_id: "p1".into(),
            domain: domain.into(),
            scope_rung: rung,
            status: ResponsibilityStatus::Active.as_str().to_string(),
            project_id: project_id.map(str::to_string),
            workspace_id: workspace_id.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn a_mandate_lifts_only_its_own_ground_and_never_lowers_a_charter() {
        let mandate = rung_charter("m", DOMAIN_SOFTWARE_ENGINEERING, 3, Some("proj_a"), None);
        let low = rung_charter("c1", "docs", 2, Some("proj_a"), None);
        let elsewhere = rung_charter("c2", "docs", 2, Some("proj_b"), None);
        let unbound = rung_charter("c3", "docs", 2, None, None);
        let held = [
            mandate.clone(),
            low.clone(),
            elsewhere.clone(),
            unbound.clone(),
        ];

        assert_eq!(effective_scope_rung(&low, &held), 3, "same project lifts");
        assert_eq!(
            effective_scope_rung(&elsewhere, &held),
            2,
            "another project is another ground"
        );
        assert_eq!(
            effective_scope_rung(&unbound, &held),
            2,
            "no ground, nothing to match on"
        );
        assert_eq!(
            effective_scope_rung(&mandate, &held),
            3,
            "the mandate reads at its own rung"
        );

        // A LOW mandate never pulls a higher charter down.
        let low_mandate = rung_charter("m0", DOMAIN_SOFTWARE_ENGINEERING, 0, Some("proj_a"), None);
        let high = rung_charter("c4", "docs", 3, Some("proj_a"), None);
        assert_eq!(effective_scope_rung(&high, [&low_mandate, &high]), 3);

        // A SUSPENDED mandate grants nothing.
        let mut suspended = mandate.clone();
        suspended.status = ResponsibilityStatus::Suspended.as_str().to_string();
        assert_eq!(effective_scope_rung(&low, [&suspended, &low]), 2);

        // A workspace-bound holder matches on its workspace.
        let ws_mandate = rung_charter(
            "mw",
            DOMAIN_SOFTWARE_ENGINEERING,
            3,
            None,
            Some("ws_grand_sim"),
        );
        let ws_charter = rung_charter("c5", "docs", 2, None, Some("ws_grand_sim"));
        assert_eq!(
            effective_scope_rung(&ws_charter, [&ws_mandate, &ws_charter]),
            3
        );

        // Nothing ever exceeds the grantable ceiling.
        let over = rung_charter("c6", "docs", 9, Some("proj_a"), None);
        assert_eq!(effective_scope_rung(&over, [&over]), MAX_GRANTABLE_RUNG);
    }

    #[test]
    fn the_software_library_is_the_forbidden_class_enum_verbatim() {
        let from_enum: Vec<&str> = ALL_FORBIDDEN_CLASSES.iter().map(|c| c.as_str()).collect();
        assert_eq!(
            from_enum,
            SOFTWARE_ENGINEERING_CLASSES.to_vec(),
            "a class added to ForbiddenClass must be added to the library in the same change"
        );
        assert_eq!(
            classes_for_domain(DOMAIN_SOFTWARE_ENGINEERING),
            &SOFTWARE_ENGINEERING_CLASSES[..]
        );
        assert_eq!(classes_for_domain(DOMAIN_GENERAL), &GENERAL_CLASSES[..]);
        assert_eq!(
            classes_for_domain("docs"),
            &GENERAL_CLASSES[..],
            "an unlibraried domain gets the general set"
        );
    }

    /// `spec.priority` is an ORDER the App Master decision lane reads, so an
    /// out-of-band value would sort somewhere nobody meant. Absent stays legal
    /// and means "the persona decides" — it is NOT coerced to a middle rank.
    #[test]
    fn validate_bounds_charter_priority_and_leaves_absence_alone() {
        let base = from_mandate_record(&record("p1", "proj-1"), "p1");
        assert_eq!(base.spec.priority, None);
        validate(&base).expect("no declared priority is valid");

        for ok in [MIN_CHARTER_PRIORITY, 3, MAX_CHARTER_PRIORITY] {
            let mut r = base.clone();
            r.spec.priority = Some(ok);
            validate(&r).unwrap_or_else(|e| panic!("priority {ok} must be valid: {e}"));
        }

        for bad in [0u8, MAX_CHARTER_PRIORITY + 1, 200] {
            let mut r = base.clone();
            r.spec.priority = Some(bad);
            let err =
                validate(&r).unwrap_err_or_else_panic(&format!("priority {bad} must be refused"));
            assert!(err.to_string().contains("priority"), "{err}");
        }
    }

    /// Small helper so the loop above reads as one assertion per case.
    trait UnwrapErrOrPanic {
        fn unwrap_err_or_else_panic(self, msg: &str) -> AppError;
    }
    impl UnwrapErrOrPanic for Result<(), AppError> {
        fn unwrap_err_or_else_panic(self, msg: &str) -> AppError {
            match self {
                Err(e) => e,
                Ok(()) => panic!("{msg}"),
            }
        }
    }

    #[test]
    fn validate_refuses_rung_4_blank_titles_bad_status_and_unknown_classes() {
        let mut resp = from_mandate_record(&record("p1", "proj-1"), "p1");
        validate(&resp).expect("a hire-shaped charter is valid");

        // Rung 3 (merge) is grantable since 2026-09-09 (the App Master merges);
        // rung 4 (change the gates) is still refused at intake.
        let mut merge = resp.clone();
        merge.scope_rung = 3;
        validate(&merge).expect("a rung-3 charter is valid");

        let mut high = resp.clone();
        high.scope_rung = 4;
        let err = validate(&high).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        assert!(err.to_string().contains("rung"), "{err}");

        let mut untitled = resp.clone();
        untitled.title = "  ".into();
        assert!(matches!(validate(&untitled), Err(AppError::Validation(_))));

        let mut zombie = resp.clone();
        zombie.status = "zombie".into();
        assert!(matches!(validate(&zombie), Err(AppError::Validation(_))));

        resp.refusal_classes.push("custom: never touch prod".into());
        resp.refusal_classes.push("ExternalSend".into());
        validate(&resp).expect("custom-prefixed and general-library classes are accepted");
        resp.refusal_classes.push("test_deleton_or_skip".into()); // typo
        assert!(matches!(validate(&resp), Err(AppError::Validation(_))));
        resp.refusal_classes.pop();

        // Manifest columns: a blank connector id and an oversized procedure
        // are refused; a well-formed pair passes.
        let mut blank_connector = resp.clone();
        blank_connector.connectors = vec!["slack".into(), "  ".into()];
        assert!(matches!(
            validate(&blank_connector),
            Err(AppError::Validation(_))
        ));
        let mut long_procedure = resp.clone();
        long_procedure.procedure = "x".repeat(MAX_PROMPT_BYTES + 1);
        assert!(matches!(
            validate(&long_procedure),
            Err(AppError::Validation(_))
        ));
        resp.connectors = vec!["slack".into()];
        resp.procedure = "Read the channel, post a digest.".into();
        validate(&resp).expect("manifest columns within bounds");
    }

    /// A charter binds to a project OR to a workspace, never both. Each alone
    /// is valid — that is what makes the pair a real refusal rather than a
    /// side effect of the workspace column existing — and a blank string on
    /// either side is not a binding, so it cannot conflict with the other.
    #[test]
    fn validate_refuses_a_charter_bound_to_both_a_project_and_a_workspace() {
        let project_bound = from_mandate_record(&record("p1", "proj-1"), "p1");
        validate(&project_bound).expect("a project-bound charter is valid");

        let mut workspace_bound = project_bound.clone();
        workspace_bound.project_id = None;
        workspace_bound.workspace_id = Some("ws-bank".into());
        validate(&workspace_bound).expect("a workspace-bound charter is valid — the Architect");

        let mut both = project_bound.clone();
        both.workspace_id = Some("ws-bank".into());
        let err = validate(&both).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        assert!(
            err.to_string().contains("project OR to a workspace"),
            "the refusal says which two bindings collided: {err}"
        );

        // A blank is not a binding: neither of these is the conflict above.
        let mut blank_workspace = project_bound.clone();
        blank_workspace.workspace_id = Some("   ".into());
        validate(&blank_workspace).expect("a blank workspace id does not conflict");
        let mut blank_project = workspace_bound.clone();
        blank_project.project_id = Some(String::new());
        validate(&blank_project).expect("a blank project id does not conflict");

        // And an unbound charter — what every hand-authored one is — stays
        // legal with neither.
        let mut unbound = project_bound;
        unbound.project_id = None;
        validate(&unbound).expect("an unbound charter is valid");
    }

    #[test]
    fn the_mandate_round_trip_is_lossless_including_probation_bookkeeping() {
        let mut rec = record("p1", "proj-1");
        rec.probation_decided_at = Some("2026-08-29T00:00:00+00:00".into());
        rec.probation_decision = Some("extended".into());
        let back = to_mandate_record(&from_mandate_record(&rec, "p1"));
        assert_eq!(back, rec);

        // Legacy blank-tenure rows survive too ("" means "unknown start").
        let mut legacy = record("p1", "proj-1");
        legacy.hired_at = String::new();
        legacy.headless_incomplete_streak = 0;
        legacy.probation_review_id = None;
        assert_eq!(
            to_mandate_record(&from_mandate_record(&legacy, "p1")),
            legacy
        );
    }

    #[test]
    fn store_read_and_replace_behave_like_the_legacy_single_key() {
        let pool = init_test_db().unwrap();
        insert_persona(&pool, "p-old").unwrap();
        insert_persona(&pool, "p-new").unwrap();

        assert_eq!(mandate_for_project(&pool, "proj-t").unwrap(), None);

        let mut first = record("p-old", "proj-t");
        store_mandate_record(&pool, &first).unwrap();
        assert_eq!(
            mandate_for_project(&pool, "proj-t").unwrap(),
            Some(first.clone())
        );

        // Same holder: an in-place update (the probation carry-out's write).
        first.probation_decided_at = Some("2026-08-30T00:00:00+00:00".into());
        first.probation_decision = Some("activated".into());
        first.headless_incomplete_streak = 0;
        store_mandate_record(&pool, &first).unwrap();
        assert_eq!(
            mandate_for_project(&pool, "proj-t").unwrap(),
            Some(first.clone())
        );

        // A different holder REPLACES: probation state resets with the row.
        let second = MandateRecord {
            probation_decided_at: None,
            probation_decision: None,
            probation_review_id: None,
            headless_incomplete_streak: 0,
            ..record("p-new", "proj-t")
        };
        let hired = record_hire(&pool, &second, "App master for Proj T").unwrap();
        // The returned row is the stored charter itself: the storage-assigned
        // id the hire flow stamps onto `AppMasterLink.mandate_key`.
        assert!(hired.id.starts_with("resp_"), "{}", hired.id);
        let rows = repo::list_by_project_domain(&pool, "proj-t", DOMAIN_SOFTWARE_ENGINEERING, true)
            .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, hired.id);
        let back = mandate_for_project(&pool, "proj-t").unwrap().unwrap();
        assert_eq!(back, second);

        let map = load_mandate_map(&pool);
        assert_eq!(map.len(), 1);
        assert_eq!(map.get("proj-t"), Some(&second));
        assert_eq!(load_all_mandates(&pool).unwrap(), vec![second]);
    }

    #[test]
    fn migration_moves_legacy_rows_verbatim_deletes_them_and_is_idempotent() {
        let pool = init_test_db().unwrap();
        insert_persona(&pool, "p1").unwrap();

        // Seed the LEGACY storage and capture what the legacy reader said.
        let rec = record("p1", "proj-legacy");
        app_master::set_mandate(&pool, &rec).unwrap();
        let legacy_view = app_master::load_mandates(&pool);
        assert_eq!(legacy_view.get("proj-legacy"), Some(&rec));

        assert_eq!(migrate_legacy_mandates(&pool).unwrap(), 1);

        // The table serves the identical record the settings key used to.
        assert_eq!(load_all_mandates(&pool).unwrap(), vec![rec.clone()]);
        assert_eq!(
            load_mandate_map(&pool).get("proj-legacy"),
            legacy_view.get("proj-legacy")
        );
        assert_eq!(
            mandate_for_project(&pool, "proj-legacy").unwrap(),
            Some(rec)
        );
        // The legacy row is gone, and a second run has nothing to do.
        assert!(app_master::load_mandates(&pool).is_empty());
        assert_eq!(migrate_legacy_mandates(&pool).unwrap(), 0);
        assert_eq!(load_all_mandates(&pool).unwrap().len(), 1, "no duplicate");
    }

    #[test]
    fn migration_leaves_unparsable_and_orphaned_rows_in_place() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        insert_persona(&pool, "p1")?;

        // Unparsable JSON: stays, warned, uncounted. (`set` validates
        // well-formedness, so malformed legacy bytes are planted raw.)
        pool.get()?.execute(
            "INSERT INTO app_settings (key, value) VALUES ('app_master_mandate:proj-bad', '{broken')",
            [],
        )?;
        // A holder that no longer exists: FK insert fails, row stays.
        app_master::set_mandate(&pool, &record("p-gone", "proj-orphan")).unwrap();
        // A healthy one, to prove the sweep continues past the failures.
        app_master::set_mandate(&pool, &record("p1", "proj-ok")).unwrap();

        assert_eq!(migrate_legacy_mandates(&pool).unwrap(), 1);
        assert_eq!(load_all_mandates(&pool).unwrap().len(), 1);
        let leftovers = personas_db::repos::core::settings::get_by_prefix(
            &pool,
            app_master::APP_MASTER_MANDATE_PREFIX,
        )
        .unwrap();
        let mut keys: Vec<&str> = leftovers.iter().map(|(k, _)| k.as_str()).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "app_master_mandate:proj-bad",
                "app_master_mandate:proj-orphan"
            ]
        );
        Ok(())
    }

    #[test]
    fn operator_doors_create_validate_and_merge_validate() {
        let pool = init_test_db().unwrap();
        insert_persona(&pool, "p1").unwrap();

        let created = create_from_input(
            &pool,
            &CreatePersonaResponsibilityInput {
                persona_id: "p1".into(),
                title: "Keep the changelog honest".into(),
                refusal_classes: vec!["ExternalSend".into()],
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(created.domain, DOMAIN_GENERAL, "domain defaults to general");
        assert_eq!(created.status, "active", "status defaults to active");
        assert_eq!(created.source, "operator");

        // The create door refuses what validate refuses.
        let err = create_from_input(
            &pool,
            &CreatePersonaResponsibilityInput {
                persona_id: "p1".into(),
                title: "Too mighty".into(),
                scope_rung: 4,
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");

        // Update validates the MERGED row: raising the rung past the ceiling
        // fails even though every provided field is individually well-formed.
        let err = update_from_input(
            &pool,
            &created.id,
            UpdatePersonaResponsibilityInput {
                scope_rung: Some(3),
                ..Default::default()
            },
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");

        let renamed = update_from_input(
            &pool,
            &created.id,
            UpdatePersonaResponsibilityInput {
                title: Some("Keep the release notes honest".into()),
                budget_monthly_usd: Some(Some(3.0)),
                connectors: Some(vec!["github".into()]),
                procedure: Some("Diff the changelog against merged PRs.".into()),
                spec: Some(ResponsibilitySpec {
                    worker_engine: None,
                    engine_mode: Some("agentic".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(renamed.title, "Keep the release notes honest");
        assert_eq!(renamed.budget_monthly_usd, Some(3.0));
        assert_eq!(renamed.refusal_classes, vec!["ExternalSend"]);
        assert_eq!(renamed.connectors, vec!["github"]);
        assert_eq!(renamed.procedure, "Diff the changelog against merged PRs.");
        assert_eq!(renamed.spec.engine_mode.as_deref(), Some("agentic"));

        assert!(matches!(
            update_from_input(&pool, "resp_missing", Default::default()),
            Err(AppError::NotFound(_))
        ));
    }
}
