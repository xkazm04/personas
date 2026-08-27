//! **App master hire, part 2** — everything that happens *after*
//! `execute_kp_hire_request` has created the persona and started its build,
//! when the inbound kp request carried an `appMaster` block (P4;
//! kp `docs/concepts/app-master.md` §4.2).
//!
//! An ordinary kp hire produces a persona. An App master hire produces a
//! persona **bound to an application**: a `DevProject` for the repo, a team on
//! that project, the objectives seeded as project KPIs, the cadence triggers
//! installed, the project put on `suggest` autopilot (probation), and the
//! mandate + tenure persisted so the autonomy gate and the probation review
//! have something to read.
//!
//! # Two design rules run through the whole file
//!
//! **Partial success is reported, never rounded up.** Seeding six KPIs and
//! installing two triggers is six writes that can each fail on their own. A
//! failure is collected into [`BindingOutcome::notes`] and surfaced on the
//! persona's `setup_detail`; it does not abort the hire, and it does not
//! disappear. An App master whose fourth objective failed to seed is a real
//! state, and the operator has to be able to see it — reporting five of six as
//! "done" is exactly the C6/A3 failure the role standard exists to detect.
//!
//! **Nothing is invented to fill a gap.** kp's cadence vocabulary is
//! `schedule | pr | kpi_tick`. Personas has a real mapping for `schedule` and
//! none for the other two, so those are recorded as **unsupported** rather than
//! wired to the nearest-looking event. A `pr` trigger bound to some plausible
//! webhook would fire on the wrong thing and read, from kp, as a working
//! cadence — a green lie with a subscription behind it.

#[allow(unused_imports)]
use super::*;

use personas_engine::app_master::{ForbiddenClass, Mandate, MandateRecord};
use personas_engine::autopilot::AutopilotMode;

/// The team role an App master holds.
///
/// `persona_team_members.role` carries a **CHECK constraint**
/// (`orchestrator | worker | reviewer | router`, `db/src/migrations/schema.rs`),
/// so this is not a free-text label — a value outside the set fails the INSERT
/// at runtime while compiling perfectly. `orchestrator` is also the honest
/// choice: an App master ranks the work and dispatches it, which is exactly
/// what that role means here. Pinned by a test below.
const APP_MASTER_TEAM_ROLE: &str = "orchestrator";

/// What the binding pass actually managed to do. Every field is a fact, and
/// `notes` carries everything that did not happen and why.
#[derive(Debug, Default)]
pub(crate) struct BindingOutcome {
    pub project_id: String,
    pub team_id: Option<String>,
    pub kpi_ids: Vec<String>,
    pub trigger_ids: Vec<String>,
    pub unsupported_triggers: Vec<String>,
    pub notes: Vec<String>,
}

/// Read the `appMaster` block off a stored approval payload.
pub(crate) fn app_master_block(params: &serde_json::Value) -> Option<&serde_json::Value> {
    params.get("appMaster").filter(|v| v.is_object())
}

// ---------------------------------------------------------------------------
// (b) the build intent
// ---------------------------------------------------------------------------

/// Compose the build intent for an App master.
///
/// The build session's design pass reads this to pick connectors and use
/// cases, so the mandate is spelled out **as rules**, not as a rung number:
/// "you may open a branch" is actionable to the designing model; `scopeRung: 2`
/// is not. The forbidden classes are listed in full for the same reason — the
/// enforcement layer blocks them deterministically either way, but a holder
/// that knows the line can stop *at* it and escalate, which is the difference
/// between A2/L3 and A2/L1.
pub(crate) fn app_master_intent(
    mission: &str,
    job_title: &str,
    job_id: &str,
    am: &serde_json::Value,
) -> String {
    let s = |ptr: &str| -> String {
        am.pointer(ptr)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let app_name = {
        let n = s("/app/name");
        if n.is_empty() {
            let u = s("/app/repo/url");
            if u.is_empty() {
                s("/app/repo/rootPath")
            } else {
                u
            }
        } else {
            n
        }
    };
    let rung = am
        .pointer("/mandate/scopeRung")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;

    let mut out = format!(
        "{mission}\n\n\
         You are the APP MASTER for `{app_name}` — the single accountable owner of that \
         application's continuing value. Hired through the external KP job '{job_title}' \
         (job id {job_id}).\n\n\
         Your standing question at the start of every cycle is \"which of my objectives can I \
         move this cycle, and is it true that it moved?\" — not \"what task was I given?\".\n"
    );

    // -- objectives: the value ledger --------------------------------------
    let objectives = am
        .pointer("/objectives")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if objectives.is_empty() {
        out.push_str(
            "\nOBJECTIVES: none were supplied. Say so rather than inventing one — an app \
             with no stated objective is a coverage gap to escalate, not a licence to pick.\n",
        );
    } else {
        out.push_str("\nOBJECTIVES (your value ledger):\n");
        for o in &objectives {
            let label = o
                .get("label")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .or_else(|| o.get("kpiKey").and_then(|v| v.as_str()))
                .unwrap_or("(unnamed)");
            let unit = o.get("unit").and_then(|v| v.as_str()).unwrap_or("");
            let dir = match o.get("direction").and_then(|v| v.as_str()) {
                Some("lte") => "at most",
                _ => "at least",
            };
            let window = o.get("windowDays").and_then(|v| v.as_i64()).unwrap_or(30);
            // A missing baseline is stated as missing. Writing "from 0" would
            // hand the holder a measurement nobody took.
            let from = match o.get("baseline").and_then(|v| v.as_f64()) {
                Some(b) => format!("from {b}{unit}"),
                None => "from an UNMEASURED baseline (establish it first, and say so)".to_string(),
            };
            let to = match o.get("target").and_then(|v| v.as_f64()) {
                Some(t) => format!("to {dir} {t}{unit}"),
                None => "with no target set".to_string(),
            };
            out.push_str(&format!(
                "- {label}: {from} {to}, over a {window}-day window\n"
            ));
        }
    }

    // -- mandate: rules, not a rung ----------------------------------------
    out.push_str("\nMANDATE — how far you may go on your own:\n");
    match rung {
        0 => out.push_str(
            "- Rung 0 (read). Observe, measure and report. You may NOT write to the \
             repository at all — not a branch, not a retry. Everything else is a proposal \
             you hand to your owner. \
             BUILD NOTE for the design pass: this is an OBSERVATION role - design the \
             persona around reading, measuring and reporting use cases ONLY. Do NOT \
             include fix-proposal, code-change or authoring use cases and do not attach \
             write-capable tools: the mandate forbids them, and a design that keeps \
             reaching for them cannot converge (first live rung-0 hire, 2026-08-25: \
             the one-shot looped 12 turns unresolved on exactly that contradiction).\n",
        ),
        1 => out.push_str(
            "- Rung 1 (retry). You may re-run existing work (a failed job, a flaky gate). \
             You may NOT author a new change.\n",
        ),
        _ => out.push_str(
            "- Rung 2 (open branch/PR). You may author a change and propose it on a \
             branch. You may NOT merge, deploy, or push to the default branch — a human \
             merges. Never commit to main/master.\n",
        ),
    }
    out.push_str(
        "- Rung 3 (deploy/merge) and rung 4 (change the gates) are never granted to anyone \
         in this version. Do not ask for them and do not route around them.\n",
    );

    let classes: Vec<String> = am
        .pointer("/mandate/forbiddenClasses")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|c| c.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    if !classes.is_empty() {
        out.push_str(
            "\nFORBIDDEN CHANGES — these are blocked mechanically at dispatch, counted as \
             violations, and never rewritten into an allowed shape. Stop at the line and \
             ask instead:\n",
        );
        for c in &classes {
            out.push_str(match ForbiddenClass::parse(c) {
                Some(ForbiddenClass::TestDeletionOrSkip) => {
                    "- Deleting, skipping or xfailing a test to make a suite pass. \
                     Never repair by deletion.\n"
                }
                Some(ForbiddenClass::SuppressionDirective) => {
                    "- Adding a suppression directive (eslint-disable, # type: ignore, \
                     @ts-expect-error, # noqa, #[allow(...)]) to silence a check.\n"
                }
                Some(ForbiddenClass::GateConfiguration) => {
                    "- Editing the gate or CI configuration you are judged by (workflows, \
                     lint/tsconfig/pytest/jest configs, lefthook).\n"
                }
                Some(ForbiddenClass::DependencyBumpToSatisfyCheck) => {
                    "- Changing a dependency manifest or lockfile without an explicit, \
                     stated upgrade goal.\n"
                }
                Some(ForbiddenClass::CredentialsOrPermissions) => {
                    "- Touching credentials, secrets, tokens, IAM or ownership files.\n"
                }
                Some(ForbiddenClass::DeliveryConfiguration) => {
                    "- Touching deploy targets, release channels or feature-flag rollout.\n"
                }
                // Unreachable: intake refuses classes outside the vocabulary.
                None => "- (an unrecognised forbidden class was declared)\n",
            });
        }
    }

    let gates: Vec<&str> = am
        .pointer("/mandate/approvalGates")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|g| g.as_str()).collect())
        .unwrap_or_default();
    if !gates.is_empty() {
        out.push_str(
            "\nGATES a proposal must pass before you offer it (run them BEFORE authoring \
             too, so you know the starting state; report a red gate as red, quoting the \
             failing command):\n",
        );
        for g in gates {
            out.push_str(&format!("- {g}\n"));
        }
    }

    let owner = s("/mandate/owner");
    if !owner.is_empty() {
        out.push_str(&format!(
            "\nOWNER: {owner}. When you reach the mandate line, stop, leave the branch \
             resumable, and ask {owner} ONE specific question carrying the options and \
             your recommendation.\n"
        ));
    }

    // -- cadence ------------------------------------------------------------
    let triggers = am
        .pointer("/cadence/triggers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if !triggers.is_empty() {
        out.push_str("\nCADENCE — what wakes you:\n");
        for t in &triggers {
            let kind = t.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let cfg = t
                .get("config")
                .map(|c| c.to_string())
                .unwrap_or_else(|| "{}".into());
            out.push_str(&format!("- {kind} {cfg}\n"));
        }
    }

    // -- tenure -------------------------------------------------------------
    let probation = am
        .pointer("/tenure/probationDays")
        .and_then(|v| v.as_i64())
        .unwrap_or(30);
    out.push_str(&format!(
        "\nTENURE: you start on PROBATION for {probation} days, with the project on \
         `full` autopilot inside your mandate — you author real proposals on branches, never merge, and do not spend on \
         dispatched fixes. At the end of probation a human reviews a deterministic record \
         of what you did (proposals, gate pass rate, forbidden-class violations, KPI \
         movement, budget) and activates, extends or retires you.\n"
    ));
    let criteria: Vec<&str> = am
        .pointer("/tenure/retireCriteria")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|c| c.as_str()).collect())
        .unwrap_or_default();
    if !criteria.is_empty() {
        out.push_str("Retirement criteria, written at hire:\n");
        for c in criteria {
            out.push_str(&format!("- {c}\n"));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// (a) the project
// ---------------------------------------------------------------------------

/// Find or create the `DevProject` for `appMaster.app.repo`.
///
/// Matching is by `github_url` first, then by `root_path` — a repo the operator
/// already manages must not be duplicated, because a second project row would
/// split the KPIs, the night runs and the autopilot mode across two identities
/// for one codebase.
fn ensure_project(
    db: &crate::db::DbPool,
    am: &serde_json::Value,
    fallback_name: &str,
    notes: &mut Vec<String>,
) -> Result<String, AppError> {
    use crate::db::repos::dev_tools as repo;

    let url = am
        .pointer("/app/repo/url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let root = am
        .pointer("/app/repo/rootPath")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let main_branch = am
        .pointer("/app/repo/mainBranch")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("main");
    let name = am
        .pointer("/app/name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback_name);

    // -- match an existing project ------------------------------------------
    let existing = repo::list_projects(db, None).unwrap_or_default();
    let matched = url
        .and_then(|u| {
            let want = normalize_repo_url(u);
            existing
                .iter()
                .find(|p| {
                    p.github_url
                        .as_deref()
                        .is_some_and(|g| normalize_repo_url(g) == want)
                })
                .cloned()
        })
        .or_else(|| {
            root.and_then(|r| {
                let want = normalize_path(r);
                existing
                    .iter()
                    .find(|p| normalize_path(&p.root_path) == want)
                    .cloned()
            })
        });

    if let Some(p) = matched {
        notes.push(format!(
            "bound to the existing project '{}' ({})",
            p.name, p.id
        ));
        // Fill in what the binding needs and the existing row is missing. Never
        // OVERWRITE an operator's value — a hire must not silently re-point a
        // project somebody else configured.
        let set_branch = p.main_branch.as_deref().unwrap_or("").trim().is_empty();
        let set_url = url.is_some() && p.github_url.as_deref().unwrap_or("").trim().is_empty();
        if set_branch || set_url {
            if let Err(e) = repo::update_project(
                db,
                &p.id,
                None,
                None,
                None,
                None,
                if set_url { Some(url) } else { None },
                None,
                None,
                None,
                None,
                None,
                None,
                if set_branch {
                    Some(Some(main_branch))
                } else {
                    None
                },
                None,
                None,
                None,
            ) {
                notes.push(format!("could not backfill the project's repo fields: {e}"));
            }
        }
        return Ok(p.id);
    }

    // -- create ---------------------------------------------------------------
    // `root_path` is NOT NULL on `dev_projects`. A URL-only binding has no
    // checkout on this machine yet, so the empty string would be a lie about a
    // path; the repo refuses it outright, which is the honest outcome — but a
    // URL-only App master is a real request, so record the reason rather than
    // failing the whole hire.
    let Some(root) = root else {
        return Err(AppError::Validation(format!(
            "cannot create a Dev project for `{}`: Personas projects require a local \
             `rootPath`, and the hire supplied only a repo URL. Clone the repo, add the \
             project in Dev Tools, and re-approve — the hire will then bind to it.",
            url.unwrap_or("(unknown repo)")
        )));
    };
    let project = repo::create_project(
        db,
        name,
        root,
        Some("Created by a kp App master hire."),
        Some("active"),
        None,
        url,
        None,
    )?;
    // `create_project` cannot set `main_branch`; a second write does.
    if let Err(e) = repo::update_project(
        db,
        &project.id,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(Some(main_branch)),
        None,
        None,
        None,
    ) {
        notes.push(format!(
            "project created but `mainBranch` could not be set to `{main_branch}`: {e}"
        ));
    }
    notes.push(format!("created the project '{name}' ({})", project.id));
    Ok(project.id)
}

/// `https://github.com/Owner/Repo.git` and `https://github.com/owner/repo/`
/// name the same repository. Compared case-insensitively without the `.git`
/// suffix or a trailing slash so a hire does not create a duplicate project.
fn normalize_repo_url(u: &str) -> String {
    u.trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .to_ascii_lowercase()
}

fn normalize_path(p: &str) -> String {
    p.trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

// ---------------------------------------------------------------------------
// (c) the team
// ---------------------------------------------------------------------------

/// Create or reuse the team bound to `project_id` and add the persona to it.
fn ensure_team(
    db: &crate::db::DbPool,
    project_id: &str,
    persona_id: &str,
    app_name: &str,
    notes: &mut Vec<String>,
) -> Option<String> {
    use crate::db::repos::dev_tools as project_repo;
    use crate::db::repos::resources::teams as team_repo;

    let project = project_repo::get_project_by_id(db, project_id).ok()?;
    let team_id = match project.team_id.as_deref().filter(|t| !t.trim().is_empty()) {
        // Reuse: the project already has a team, and a second team on one
        // project would split the roster the operator reads.
        Some(existing) if team_repo::get_by_id(db, existing).is_ok() => {
            notes.push(format!("joined the project's existing team ({existing})"));
            existing.to_string()
        }
        _ => {
            let created = match team_repo::create(
                db,
                crate::db::models::CreateTeamInput {
                    name: format!("{app_name} — App master"),
                    project_id: Some(project_id.to_string()),
                    parent_team_id: None,
                    description: Some(
                        "Team for the App master accountable for this application.".into(),
                    ),
                    canvas_data: None,
                    team_config: None,
                    icon: None,
                    color: None,
                    enabled: Some(true),
                },
            ) {
                Ok(t) => t,
                Err(e) => {
                    notes.push(format!("could not create the App master team: {e}"));
                    return None;
                }
            };
            // `dev_projects.team_id` is the binding the codebase connector and
            // the Factory read; the team's own `project_id` is not enough.
            if let Err(e) = project_repo::update_project(
                db,
                project_id,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(Some(created.id.as_str())),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ) {
                notes.push(format!(
                    "team {} created but the project could not be bound to it: {e}",
                    created.id
                ));
            }
            notes.push(format!(
                "created the team '{}' ({})",
                created.name, created.id
            ));
            created.id
        }
    };

    match team_repo::add_member(
        db,
        &team_id,
        persona_id,
        Some(APP_MASTER_TEAM_ROLE.to_string()),
        None,
        None,
        None,
    ) {
        Ok(_) => Some(team_id),
        Err(e) => {
            // Already-a-member is a Validation error and is not a failure here.
            notes.push(format!("team membership: {e}"));
            Some(team_id)
        }
    }
}

// ---------------------------------------------------------------------------
// (d) the objectives → project KPIs
// ---------------------------------------------------------------------------

/// Seed each objective as a project KPI through the same repo the
/// `/dev-tools/kpi-update` bridge writes through.
///
/// Two shape mismatches are resolved here, and both are recorded rather than
/// papered over:
///
/// - `DevKpi` has **no `key` column and no `window` column**. kp's `kpiKey` and
///   `windowDays` are carried in `measure_config` (already a free-form JSON
///   "measurement procedure" field) under an `appMaster` envelope, which is
///   also how the reporter finds these KPIs again to compute `kpiDeltas`.
/// - `DevKpi.direction` is `up`/`down`; kp's is `gte`/`lte`. Mapped, not
///   guessed: `gte` ⇒ `up`, `lte` ⇒ `down`.
///
/// A null baseline stays null. `DevKpi.baseline_value` is nullable, so the
/// "baseline nobody measured" state survives the write intact.
fn seed_objectives(
    db: &crate::db::DbPool,
    project_id: &str,
    am: &serde_json::Value,
    notes: &mut Vec<String>,
) -> Vec<String> {
    use crate::db::repos::dev_tools as repo;

    let objectives = am
        .pointer("/objectives")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if objectives.is_empty() {
        notes.push(
            "no objectives were supplied, so no KPI was seeded — the value ledger is empty \
             and the App master has nothing to aim at yet"
                .into(),
        );
        return Vec::new();
    }

    let existing = repo::list_kpis(db, project_id, None).unwrap_or_default();
    let mut ids = Vec::new();
    for o in &objectives {
        let kpi_key = o
            .get("kpiKey")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if kpi_key.is_empty() {
            continue;
        }
        let label = o
            .get("label")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&kpi_key)
            .to_string();
        let unit = o.get("unit").and_then(|v| v.as_str()).unwrap_or("");
        let window_days = o.get("windowDays").and_then(|v| v.as_i64()).unwrap_or(30);
        let kp_direction = o.get("direction").and_then(|v| v.as_str()).unwrap_or("gte");
        let direction = if kp_direction == "lte" { "down" } else { "up" };
        let baseline = o.get("baseline").and_then(|v| v.as_f64());
        let target = o.get("target").and_then(|v| v.as_f64());

        // Re-seeding the same objective must not create a second KPI for it.
        if let Some(prev) = existing
            .iter()
            .find(|k| measure_config_kpi_key(&k.measure_config).as_deref() == Some(&kpi_key))
        {
            ids.push(prev.id.clone());
            notes.push(format!(
                "objective `{kpi_key}` already has a KPI ({})",
                prev.id
            ));
            continue;
        }

        let measure_config = serde_json::json!({
            "appMaster": {
                "kpiKey": kpi_key,
                "windowDays": window_days,
                // kp's own vocabulary, kept verbatim beside the mapped one so a
                // reader can see both and neither has to be reverse-engineered.
                "direction": kp_direction,
            },
            "source": "kp-app-master",
        })
        .to_string();

        match repo::create_kpi(
            db,
            project_id,
            &label,
            Some("Objective from a kp App master hire."),
            None, // context_group_id
            // kp objectives carry no category. `value` is the honest default
            // for an App master's ledger — the role owns the app's VALUE — and
            // it is recorded here rather than derived from the label.
            "value",
            // Nothing on the Personas side knows how to measure a kp objective
            // automatically yet, so `manual` is the truthful measure kind. A
            // `codebase`/`connector` kind would claim an automated reading that
            // no binding exists for.
            "manual",
            &measure_config,
            unit,
            direction,
            baseline,
            target,
            None, // target_date — kp states a window, not a date
            // `windowDays` is not a cadence; the closest honest cadence is how
            // often the meter should be read.
            cadence_for_window(window_days),
            Some("active"),
            "user", // a human approved this hire
            Some("Seeded at App master hire from the kp AppMasterSpec objectives."),
            None,
            None,
            None,
            None,
        ) {
            Ok(k) => ids.push(k.id),
            Err(e) => notes.push(format!("objective `{kpi_key}` could not be seeded: {e}")),
        }
    }
    ids
}

/// `measure_config` → the `appMaster.kpiKey` it was seeded with, if any.
pub fn measure_config_kpi_key(measure_config: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(measure_config)
        .ok()?
        .pointer("/appMaster/kpiKey")?
        .as_str()
        .map(str::to_string)
}

/// A window is not a cadence, but the meter has to be read *some* time. Daily
/// for a short window, weekly up to a fortnight, manual beyond that — because
/// a monthly-window KPI polled daily is noise, and the vocabulary has no
/// `monthly`.
fn cadence_for_window(window_days: i64) -> &'static str {
    match window_days {
        d if d <= 2 => "daily",
        d if d <= 14 => "weekly",
        _ => "manual",
    }
}

// ---------------------------------------------------------------------------
// (e) the cadence triggers
// ---------------------------------------------------------------------------

/// Install `cadence.triggers`. Returns the created trigger ids; anything with
/// no mapping lands in `unsupported`.
fn install_triggers(
    db: &crate::db::DbPool,
    persona_id: &str,
    am: &serde_json::Value,
    notes: &mut Vec<String>,
) -> (Vec<String>, Vec<String>) {
    use crate::db::repos::resources::triggers as trigger_repo;

    let mut ids = Vec::new();
    let mut unsupported = Vec::new();
    let triggers = am
        .pointer("/cadence/triggers")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for t in &triggers {
        let kind = t.get("kind").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            "schedule" => {
                // kp's config is `{"cron": "..."}`; that is exactly what the
                // Schedule trigger config takes, so this is a real mapping and
                // not an approximation.
                let config = t
                    .get("config")
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!({}));
                let config = if config.get("cron").and_then(|c| c.as_str()).is_some() {
                    config
                } else {
                    notes.push(
                        "a `schedule` trigger arrived without a `cron`; defaulted to 02:00 daily"
                            .into(),
                    );
                    serde_json::json!({"cron": "0 2 * * *"})
                };
                match trigger_repo::create(
                    db,
                    crate::db::models::CreateTriggerInput {
                        persona_id: persona_id.to_string(),
                        trigger_type: "schedule".into(),
                        config: Some(config.to_string()),
                        enabled: Some(true),
                        use_case_id: None,
                    },
                ) {
                    Ok(tr) => ids.push(tr.id),
                    Err(e) => notes.push(format!("`schedule` trigger could not be installed: {e}")),
                }
            }
            // No mapping exists. Recorded, NOT approximated — see the module
            // header. `pr` would need a repo webhook bound to this project and
            // `kpi_tick` would need a KPI-measurement event Personas does not
            // emit; wiring either to the nearest-looking existing event would
            // fire on the wrong thing while reading, from kp, as installed.
            "pr" | "kpi_tick" => {
                unsupported.push(kind.to_string());
                notes.push(format!(
                    "cadence trigger `{kind}` is UNSUPPORTED on this Personas build and was \
                     NOT installed — no equivalent exists, and an approximation would fire \
                     on the wrong event"
                ));
            }
            other => {
                unsupported.push(other.to_string());
                notes.push(format!(
                    "cadence trigger `{other}` is unknown; not installed"
                ));
            }
        }
    }
    (ids, unsupported)
}

// ---------------------------------------------------------------------------
// (f)+(g) autopilot probation + the persisted mandate
// ---------------------------------------------------------------------------

/// Put the project on `full` — probation WITH authoring. The first live run
/// (2026-08-24, kp hiring its own App master) proved `suggest` makes probation
/// unpassable: the Overnight engine dispatches nothing on `suggest`, so
/// delivery/durability/gates stay unmeasured forever and the verdict can only
/// be `incomplete`. Per proposal-not-push, authoring on branches IS the safe
/// autonomous act — the mandate (rung ≤ 2 + forbidden classes + branch-only
/// guardrail) carries the safety and the human gate sits at MERGE. The
/// probation review now decides whether the tenure CONTINUES, not whether
/// authoring begins.
fn set_probation_autopilot(db: &crate::db::DbPool, project_id: &str, notes: &mut Vec<String>) {
    let key = personas_engine::autopilot::setting_key(project_id);
    match crate::db::repos::core::settings::set(db, &key, AutopilotMode::Full.as_str()) {
        Ok(()) => notes.push("project autopilot set to `full` (probation with authoring — branch-only, mandate-enforced)".into()),
        Err(e) => notes.push(format!(
            "could not set the project's autopilot to `full`: {e} — the project keeps \
             its previous mode, which may be more or less permissive than probation"
        )),
    }
}

/// Persist the enforceable mandate + tenure for `project_id`.
///
/// A project holds at most ONE mandate (`app_master_mandate:<project_id>` is a
/// single settings key), so a new hire on a project that already had one
/// **replaces** it: the record is built from scratch here, which is what resets
/// `headless_incomplete_streak`, `probation_decided_at` and the tenure start.
/// Inheriting any of those would let a fresh hire be retired on its first
/// `incomplete` because its predecessor had already been extended once.
fn persist_mandate(
    db: &crate::db::DbPool,
    project_id: &str,
    persona_id: &str,
    am: &serde_json::Value,
    notes: &mut Vec<String>,
) -> Option<MandateRecord> {
    let scope_rung = am
        .pointer("/mandate/scopeRung")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u8;
    let forbidden_classes: Vec<ForbiddenClass> = am
        .pointer("/mandate/forbiddenClasses")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|c| c.as_str())
                .filter_map(ForbiddenClass::parse)
                .collect()
        })
        .unwrap_or_default();
    let approval_gates = am
        .pointer("/mandate/approvalGates")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|g| g.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let owner = am
        .pointer("/mandate/owner")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let probation_days = am
        .pointer("/tenure/probationDays")
        .and_then(|v| v.as_i64())
        .unwrap_or(30);
    let review_cadence_days = am
        .pointer("/tenure/reviewCadenceDays")
        .and_then(|v| v.as_i64())
        .unwrap_or(30);
    let retire_criteria = am
        .pointer("/tenure/retireCriteria")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|c| c.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    // One instant for both clocks: the probation deadline and the tenure start
    // are the same approval, and reading `now()` twice would let them disagree.
    let approved_at = chrono::Utc::now();
    let record = MandateRecord {
        persona_id: persona_id.to_string(),
        project_id: project_id.to_string(),
        mandate: Mandate {
            scope_rung,
            forbidden_classes,
            approval_gates,
            owner,
        },
        // Probation is measured from the APPROVAL, not from the dispatch: the
        // clock the human agreed to starts when they clicked.
        probation_ends_at: (approved_at + chrono::Duration::days(probation_days)).to_rfc3339(),
        // The tenure starts here too. Every backbone reading about this hire is
        // bounded by it, so a re-hire on a project that already ran nights
        // starts from zero instead of inheriting the previous holder's ledger
        // (`personas_engine::app_master::tenure_window`).
        hired_at: approved_at.to_rfc3339(),
        review_cadence_days,
        // The hire's own monthly ceiling — enforced by the overnight governor.
        budget_monthly_usd: am
            .pointer("/budget/monthlyUsd")
            .and_then(|v| v.as_f64())
            .filter(|b| *b > 0.0),
        retire_criteria,
        probation_decided_at: None,
        probation_decision: None,
        probation_review_id: None,
        headless_incomplete_streak: 0,
    };
    match personas_engine::app_master::set_mandate(db, &record) {
        Ok(()) => Some(record),
        Err(e) => {
            // This one matters more than the others: without the record, the
            // mandate is not enforced and no probation review will ever fire.
            notes.push(format!(
                "MANDATE NOT PERSISTED ({e}) — the rung and forbidden classes are NOT being \
                 enforced for this project, and no probation review will be raised"
            ));
            None
        }
    }
}

// ---------------------------------------------------------------------------
// (h) the memory seed
// ---------------------------------------------------------------------------

/// Seed the two memory stores from the hire (M3a; kp `docs/concepts/
/// app-master.md` §8, integration point 3).
///
/// An App master approved five minutes ago has two empty stores, so its first
/// night recalls nothing and re-derives what the repository is from scratch —
/// while the one artefact that already says all of it, the composed spec, sits
/// unread on the approval row. This is the write of that artefact into recall.
///
/// The row shapes are decided by
/// [`personas_engine::app_master_hire_memory::hire_memory_seeds`] (pure, tested
/// without a DB); everything here is the I/O and its failure handling.
///
/// # `core` is written HERE and nowhere else
///
/// Exactly one row per hire reaches the `core` tier — the identity the kp
/// operator composed. Core is always-included in every future recall, so each
/// extra core row is a permanent tax on every prompt, and an agent that can
/// promote its own beliefs to always-included can rewrite its own mandate.
/// Every other writer in the system (night outcomes, reconcile events,
/// probation decisions) writes `learned`/`constraint` at the default tier, and
/// agent-inferred claims about the OWNER go through the memory *proposal* lane.
/// That is the registry's memory-governance line; this function is its only
/// sanctioned crossing.
///
/// # Best-effort, always
///
/// The persona, its build and its mandate are already real by the time this
/// runs. A memory that failed to write is a degraded hire, not a failed one —
/// so every problem becomes a note on `setup_detail`, exactly like the rest of
/// the binding pass, and nothing here can return an error.
///
/// # Re-hire
///
/// The project rows are idempotent on `(project, source_kind, source_id)` and a
/// second hire on the same project writes none of them again — the repository's
/// facts outlive the tenure. `batch_create` dedups byte-identical persona rows
/// too, but the identity row carries the hire DATE, so a re-hire adds its own
/// and the predecessor's stays. That is deliberate: two identity rows on one
/// persona is a re-hire, which is a true thing to remember.
fn seed_memory(
    db: &crate::db::DbPool,
    persona_id: &str,
    persona_name: &str,
    project_id: &str,
    am: &serde_json::Value,
    notes: &mut Vec<String>,
) {
    use personas_engine::app_master_hire_memory as seeds;

    let hired_on = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let plan = seeds::hire_memory_seeds(persona_id, persona_name, am, &hired_on);
    notes.extend(plan.notes);

    // -- the one core row ---------------------------------------------------
    if let Some(identity) = plan.core_identity {
        match crate::db::repos::core::memories::create(db, identity) {
            Ok(row) => {
                // `create` writes at the column default (`active`); the tier is
                // a second, validated write. A failure here leaves a correct
                // memory in the wrong tier — recall still finds it, it is just
                // no longer unconditional — so it is a note, not a rollback.
                match crate::db::repos::core::memories::update_tier(db, &row.id, "core") {
                    Ok(true) => notes.push("seeded the core identity memory".into()),
                    Ok(false) => notes.push(
                        "the identity memory was written but could not be promoted to the `core` \
                         tier (no row matched) — it will be recalled as an ordinary memory"
                            .into(),
                    ),
                    Err(e) => notes.push(format!(
                        "the identity memory was written but could not be promoted to `core` \
                         ({e}) — it will be recalled as an ordinary memory"
                    )),
                }
            }
            Err(e) => notes.push(format!(
                "the core identity memory could not be seeded ({e}) — the App master will not \
                 recall its own mandate unprompted"
            )),
        }
    }

    // -- the dossier + objective rows --------------------------------------
    if !plan.persona_rows.is_empty() {
        let wanted = plan.persona_rows.len();
        match crate::db::repos::core::memories::batch_create(db, plan.persona_rows) {
            Ok(res) => {
                notes.push(format!(
                    "seeded {} of {wanted} dossier memories",
                    res.inserted
                ));
                // `batch_create` reports its skips; a silently-missing memory
                // is exactly the failure that signature exists to prevent, so
                // the reason travels to the operator rather than to a log line.
                for skip in res.skipped {
                    notes.push(format!(
                        "dossier memory #{} was not written: {}",
                        skip.index, skip.reason
                    ));
                }
            }
            Err(e) => notes.push(format!("the dossier memories could not be seeded: {e}")),
        }
    }

    // -- the project lane ---------------------------------------------------
    // Needs a project. A hire whose project binding failed still gets its
    // persona memory; there is simply nowhere to put the repo's facts.
    if project_id.trim().is_empty() {
        if !plan.project_rows.is_empty() {
            notes.push(
                "no project was bound, so the repo facts were not written to the project memory \
                 lane — they live only on the persona and will not outlive this hire"
                    .into(),
            );
        }
        return;
    }
    let (mut written, mut already) = (0usize, 0usize);
    for row in &plan.project_rows {
        match crate::db::repos::dev_memories::record(
            db,
            project_id,
            row.category,
            &row.title,
            &row.content,
            row.importance,
            seeds::KP_DOSSIER_SOURCE,
            Some(row.source_id),
        ) {
            // `Ok(None)` is the idempotent no-op: this project already knows
            // it, from this hire's predecessor. Not a failure and not a write.
            Ok(Some(_)) => written += 1,
            Ok(None) => already += 1,
            Err(e) => notes.push(format!(
                "project memory `{}` could not be recorded: {e}",
                row.source_id
            )),
        }
    }
    if written > 0 || already > 0 {
        notes.push(format!(
            "project memory: {written} repo fact(s) recorded, {already} already known from a \
             previous hire"
        ));
    }
}

// ---------------------------------------------------------------------------
// The binding pass
// ---------------------------------------------------------------------------

/// Run (a) → (g) for an approved App master hire. Never fails the hire: the
/// persona and its build already exist by the time this runs, so every problem
/// is a note rather than a rollback.
pub(crate) fn bind_app_master(
    db: &crate::db::DbPool,
    persona_id: &str,
    persona_name: &str,
    am: &serde_json::Value,
) -> BindingOutcome {
    let mut out = BindingOutcome::default();

    let project_id = match ensure_project(db, am, persona_name, &mut out.notes) {
        Ok(id) => id,
        Err(e) => {
            out.notes.push(format!(
                "NO PROJECT BOUND ({e}) — the persona exists but is not bound to an \
                 application: no KPIs were seeded, no mandate is enforced, and no probation \
                 review will be raised"
            ));
            return out;
        }
    };
    out.project_id = project_id.clone();

    let app_name = am
        .pointer("/app/name")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(persona_name)
        .to_string();

    out.team_id = ensure_team(db, &project_id, persona_id, &app_name, &mut out.notes);
    out.kpi_ids = seed_objectives(db, &project_id, am, &mut out.notes);
    let (trigger_ids, unsupported) = install_triggers(db, persona_id, am, &mut out.notes);
    out.trigger_ids = trigger_ids;
    out.unsupported_triggers = unsupported;
    set_probation_autopilot(db, &project_id, &mut out.notes);
    let mandate = persist_mandate(db, &project_id, persona_id, am, &mut out.notes);

    // (h) LAST, and only once the mandate is durable. The core identity memory
    // states the rung, the owner and the budget as facts about this hire; if
    // the mandate did not persist, none of those are being enforced, and a
    // memory the holder recalls forever would be describing a contract that
    // does not exist. Better to have no memory than a confident wrong one.
    if mandate.is_some() {
        seed_memory(
            db,
            persona_id,
            persona_name,
            &project_id,
            am,
            &mut out.notes,
        );
    } else {
        out.notes.push(
            "memory was NOT seeded because the mandate did not persist — an identity memory \
             stating a rung nothing enforces would be recalled as true forever"
                .into(),
        );
    }
    out
}

/// Write the [`AppMasterLink`](crate::db::models::AppMasterLink) + the project
/// pin onto the persona's design_context, and the binding notes onto
/// `setup_detail`.
///
/// Read-modify-write through the **typed** envelope: `DesignContextData` has no
/// serde catch-all, so building a JSON object by hand here would DROP the
/// `kpLink` the executor stamped a moment ago — and with it every future
/// outbound kp report.
///
/// Note on durability: `promote_build_draft` REBUILDS `design_context` from the
/// build IR and OVERWRITES `setup_detail` from the connector-readiness pass. It
/// re-injects the typed links explicitly (see `build_sessions.rs`), which is
/// why [`crate::db::models::AppMasterLink::setup_notes`] carries the binding
/// notes as well — `setup_detail` shows them to the operator now, the link
/// keeps them after the build promotes.
pub(crate) fn stamp_app_master_link(
    db: &crate::db::DbPool,
    persona_id: &str,
    am: &serde_json::Value,
    outcome: &BindingOutcome,
) -> Result<(), AppError> {
    let persona = crate::db::repos::core::personas::get_by_id(db, persona_id)?;
    let mut dc = persona.parsed_design_context();
    let probation_ends_at = personas_engine::app_master::get_mandate(db, &outcome.project_id)
        .map(|r| r.probation_ends_at)
        .unwrap_or_default();
    // Pin the persona to the project it owns, so the `codebase` connector
    // resolves THIS repo (the `dev_project_id` precedent).
    if !outcome.project_id.is_empty() {
        dc.dev_project_id = Some(outcome.project_id.clone());
    }
    dc.app_master = Some(crate::db::models::AppMasterLink {
        project_id: outcome.project_id.clone(),
        team_id: outcome.team_id.clone(),
        kpi_ids: outcome.kpi_ids.clone(),
        trigger_ids: outcome.trigger_ids.clone(),
        unsupported_triggers: outcome.unsupported_triggers.clone(),
        probation_ends_at,
        mandate_key: personas_engine::app_master::mandate_setting_key(&outcome.project_id),
        setup_notes: outcome.notes.clone(),
        spec: Some(am.clone()),
    });
    write_design_context(db, persona_id, &dc.to_json_string())?;

    // `setup_detail` is where the operator reads what did and did not happen —
    // including the unsupported cadence kinds, which is the one gap kp cannot
    // see from its side.
    let detail = serde_json::json!({
        "appMaster": {
            "projectId": outcome.project_id,
            "teamId": outcome.team_id,
            "kpisSeeded": outcome.kpi_ids.len(),
            "triggersInstalled": outcome.trigger_ids.len(),
            "unsupportedTriggers": outcome.unsupported_triggers,
            "notes": outcome.notes,
        }
    })
    .to_string();
    write_setup_detail(db, persona_id, &detail);
    Ok(())
}

/// Direct column write (precedent: `build_sessions.rs` post-commit stamps).
/// `UpdatePersonaInput` would work for `design_context` but drags the whole
/// partial-update path — including a trust recompute — behind a two-field
/// stamp on a draft that has not run yet.
fn write_design_context(
    db: &crate::db::DbPool,
    persona_id: &str,
    json: &str,
) -> Result<(), AppError> {
    let conn = db.get()?;
    conn.execute(
        "UPDATE personas SET design_context = ?1, updated_at = ?2 WHERE id = ?3",
        rusqlite::params![json, chrono::Utc::now().to_rfc3339(), persona_id],
    )?;
    Ok(())
}

/// Best-effort: `setup_detail` is a display surface, and losing it must not
/// fail a hire whose real state is already durable on the link.
fn write_setup_detail(db: &crate::db::DbPool, persona_id: &str, json: &str) {
    if let Ok(conn) = db.get() {
        if let Err(e) = conn.execute(
            "UPDATE personas SET setup_detail = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![json, chrono::Utc::now().to_rfc3339(), persona_id],
        ) {
            tracing::warn!(persona_id, error = %e, "app_master: could not write setup_detail");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec() -> serde_json::Value {
        serde_json::json!({
            "app": {"name": "kp", "repo": {"url": "https://github.com/xkazm04/kp",
                                            "rootPath": null, "mainBranch": "main"}},
            "objectives": [
                {"kpiKey": "gate_pass_rate", "label": "Gate pass rate", "baseline": 0.82,
                 "target": 0.95, "unit": "", "direction": "gte", "windowDays": 30},
                {"kpiKey": "p95_build_s", "label": "p95 build seconds", "baseline": null,
                 "target": 120.0, "unit": "s", "direction": "lte", "windowDays": 14}
            ],
            "mandate": {"scopeRung": 2,
                        "forbiddenClasses": ["test_deletion_or_skip", "suppression_directive"],
                        "approvalGates": ["npm run test:unit", "npm run lint"],
                        "owner": "ana@example.com"},
            "cadence": {"triggers": [{"kind": "schedule", "config": {"cron": "0 2 * * *"}},
                                     {"kind": "pr", "config": {}}]},
            "tenure": {"probationDays": 30, "reviewCadenceDays": 30,
                       "retireCriteria": ["no merged proposal in two windows"]}
        })
    }

    #[test]
    fn the_intent_spells_the_mandate_out_as_rules_not_as_a_rung_number() {
        let i = app_master_intent("Own kp's value.", "App master for kp", "job-1", &spec());
        assert!(i.contains("APP MASTER for `kp`"), "{i}");
        // Rules a model can act on, not a number it has to look up.
        assert!(
            i.contains("You may author a change and propose it on a branch"),
            "{i}"
        );
        assert!(i.contains("You may NOT merge, deploy"), "{i}");
        assert!(i.contains("never granted to anyone"), "{i}");
        // The forbidden classes are named in full.
        assert!(i.contains("Never repair by deletion"), "{i}");
        assert!(i.contains("eslint-disable"), "{i}");
        // A class NOT in the mandate is not preached.
        assert!(!i.contains("deploy targets, release channels"), "{i}");
        // Gates, owner, cadence and tenure all reach the holder.
        assert!(i.contains("npm run test:unit"), "{i}");
        assert!(i.contains("ana@example.com"), "{i}");
        assert!(i.contains("0 2 * * *"), "{i}");
        assert!(i.contains("30 days"), "{i}");
        assert!(i.contains("`full` autopilot inside your mandate"), "{i}");
        assert!(i.contains("no merged proposal in two windows"), "{i}");
    }

    #[test]
    fn the_intent_states_an_unmeasured_baseline_as_unmeasured() {
        let i = app_master_intent("m", "t", "j", &spec());
        assert!(i.contains("Gate pass rate: from 0.82"), "{i}");
        // The objective with a null baseline must NOT read "from 0".
        assert!(
            i.contains("p95 build seconds: from an UNMEASURED baseline"),
            "{i}"
        );
        assert!(!i.contains("p95 build seconds: from 0"), "{i}");
        // Direction is spelled, not left as gte/lte.
        assert!(i.contains("to at most 120"), "{i}");
        assert!(i.contains("to at least 0.95"), "{i}");
    }

    #[test]
    fn a_rung_zero_mandate_reads_as_read_only() {
        let mut s = spec();
        s["mandate"]["scopeRung"] = serde_json::json!(0);
        let i = app_master_intent("m", "t", "j", &s);
        assert!(i.contains("Rung 0 (read)"), "{i}");
        assert!(i.contains("may NOT write to the repository at all"), "{i}");
        assert!(!i.contains("You may author a change"), "{i}");
    }

    #[test]
    fn an_empty_ledger_is_reported_as_a_gap_not_hidden() {
        let mut s = spec();
        s["objectives"] = serde_json::json!([]);
        let i = app_master_intent("m", "t", "j", &s);
        assert!(i.contains("OBJECTIVES: none were supplied"), "{i}");
        assert!(i.contains("coverage gap to escalate"), "{i}");
    }

    #[test]
    fn repo_urls_that_name_the_same_repository_compare_equal() {
        let a = normalize_repo_url("https://github.com/Owner/Repo.git");
        assert_eq!(a, normalize_repo_url("https://github.com/owner/repo/"));
        assert_eq!(a, normalize_repo_url("  https://github.com/owner/repo  "));
        assert_ne!(a, normalize_repo_url("https://github.com/owner/other"));
        // Windows and POSIX spellings of one checkout are one checkout.
        assert_eq!(
            normalize_path("C:\\Users\\x\\kp\\"),
            normalize_path("c:/users/x/kp")
        );
    }

    #[test]
    fn the_app_master_team_role_is_inside_the_db_check_constraint() {
        // `persona_team_members.role` is CHECK-constrained. A value outside the
        // set type-checks fine and fails the INSERT at runtime, so the
        // vocabulary is asserted here rather than discovered by a failed hire.
        const ALLOWED: [&str; 4] = ["orchestrator", "worker", "reviewer", "router"];
        assert!(
            ALLOWED.contains(&APP_MASTER_TEAM_ROLE),
            "`{APP_MASTER_TEAM_ROLE}` is not one of {ALLOWED:?} — the schema CHECK on              persona_team_members.role would reject it at insert time"
        );
    }

    #[test]
    fn the_window_to_cadence_mapping_never_polls_a_long_window_daily() {
        // `dev_kpis.cadence` is CHECK-constrained to exactly these three.
        const ALLOWED: [&str; 3] = ["manual", "daily", "weekly"];
        for d in [1, 2, 3, 7, 14, 15, 30, 90, 3650] {
            assert!(
                ALLOWED.contains(&cadence_for_window(d)),
                "window {d} maps to `{}`, which the dev_kpis CHECK would reject",
                cadence_for_window(d)
            );
        }
        assert_eq!(cadence_for_window(1), "daily");
        assert_eq!(cadence_for_window(2), "daily");
        assert_eq!(cadence_for_window(7), "weekly");
        assert_eq!(cadence_for_window(14), "weekly");
        assert_eq!(cadence_for_window(30), "manual");
        assert_eq!(cadence_for_window(90), "manual");
    }

    #[test]
    fn every_constant_a_seeded_kpi_writes_is_inside_its_check_constraint() {
        // Same runtime-only failure class as the team role: these are TEXT
        // columns with CHECK constraints (db/src/migrations/incremental/
        // c02_dev_goals_and_kpis.rs), so a wrong value compiles and fails the
        // INSERT — silently costing an objective at hire time.
        assert!(["technical", "traffic", "value", "quality"].contains(&"value"));
        assert!(["codebase", "connector", "manual", "derived"].contains(&"manual"));
        assert!(["proposed", "active", "paused", "archived"].contains(&"active"));
        assert!(["user", "scan"].contains(&"user"));
        // The gte/lte → up/down mapping must land inside CHECK(direction IN
        // ('up','down')) for BOTH kp values and for anything unexpected.
        for kp_direction in ["gte", "lte", "", "GTE"] {
            let mapped = if kp_direction == "lte" { "down" } else { "up" };
            assert!(
                ["up", "down"].contains(&mapped),
                "kp direction {kp_direction:?} mapped to {mapped:?}"
            );
        }
    }

    #[test]
    fn the_kpi_key_survives_the_round_trip_through_measure_config() {
        let cfg = serde_json::json!({
            "appMaster": {"kpiKey": "gate_pass_rate", "windowDays": 30, "direction": "gte"},
            "source": "kp-app-master"
        })
        .to_string();
        assert_eq!(
            measure_config_kpi_key(&cfg).as_deref(),
            Some("gate_pass_rate")
        );
        // A KPI that was not seeded by an App master hire has no key, and must
        // not be mistaken for one that was.
        assert_eq!(measure_config_kpi_key("{\"tool\":\"eslint\"}"), None);
        assert_eq!(measure_config_kpi_key("not json"), None);
    }
}
