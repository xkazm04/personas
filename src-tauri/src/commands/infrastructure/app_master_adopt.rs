//! **Headless App-Master adoption** — one door that turns a registered
//! software project into an App Master: a persona bound to the project,
//! holding one charter per chosen recipe, enrolled in the living-agent
//! attention loop.
//!
//! # Why this is not the kp hire path
//!
//! [`crate::commands::companion::approvals::app_master_hire`] builds an App
//! master from an inbound kp job: it invents the project from the job's repo
//! block, seeds KPIs from the job's objectives, installs the job's cadence
//! triggers and puts the project on probation. This door starts from a project
//! that ALREADY exists and from recipes the operator names, so none of that
//! applies. What the two share is the mandate — the same
//! [`personas_engine::app_master::Mandate`] types, the same rung ladder, the
//! same forbidden-class vocabulary — which is why the manifest law rendered
//! below quotes the engine's own text instead of inventing a second version of
//! it.
//!
//! # The two rules inherited from the hire path
//!
//! **Partial success is reported, never rounded up.** A manifest section that
//! could not be written is a [`AppMasterAdoption::notes`] entry, not a silent
//! success and not an aborted adoption. The persona and its charters are real
//! by then; pretending otherwise would be a worse lie than a degraded state.
//!
//! **Nothing is invented to fill a gap.** A recipe's `recommendedTrigger` may
//! say `time` or `event`, and this door installs NO trigger for either: it has
//! no cron and no event name to install, and a plausible-looking subscription
//! would fire on the wrong thing. Every charter here is `attentionEnabled`
//! instead — the App Master decides when to act, which is the whole point of
//! the role — and the recommendation survives verbatim in the charter's own
//! description.
//!
//! # Idempotency
//!
//! The persona is keyed by `(design_context.devProjectId, name)`; each charter
//! by `(persona_id, spec.recipeRef.slug)`. A second call with the same body
//! updates in place and creates nothing. A slug dropped from the body
//! **suspends** its charter — never deletes it, because the charter carries
//! the coverage memory (`spec.pacing`) the attention loop wrote, and a
//! re-adoption should resume rather than restart.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use personas_engine::app_master::{
    ForbiddenClass, Mandate, ALL_FORBIDDEN_CLASSES, MAX_GRANTABLE_RUNG, RUNG_BRANCH, RUNG_READ,
    RUNG_RETRY,
};
use personas_engine::responsibility::DOMAIN_SOFTWARE_ENGINEERING;

use crate::commands::design::template_adopt::charter_input_from_recipe;
use crate::db::models::{
    CreatePersonaInput, DevProject, DevWorkspace, Persona, PersonaResponsibility, RecipeRef,
    RecipeSpec, ResponsibilityStatus, UpdatePersonaInput, UpdatePersonaResponsibilityInput,
};
use crate::db::repos::core::personas as personas_repo;
use crate::db::repos::core::responsibilities as resp_repo;
use crate::db::repos::dev::projects as projects_repo;
use crate::db::repos::dev_workspaces as workspaces_repo;
use crate::db::repos::resources::recipes as recipes_repo;
use crate::db::DbPool;
use crate::engine::persona_brain::manifest;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// The connector every App Master charter reaches for. `codebase` is a
/// GlobalProbe builtin (`builtin-codebase`), so it needs no credential row —
/// it resolves the persona's pinned `devProjectId` at runtime.
const CODEBASE_CONNECTOR: &str = "codebase";

/// The name prefix that marks a persona as this door's App Master. Used to
/// recognise an incumbent whose name the operator has since changed.
const APP_MASTER_NAME_PREFIX: &str = "App Master";

/// The same, for the workspace-bound Architect (`architect_adopt`).
pub(crate) const ARCHITECT_NAME_PREFIX: &str = "Architect";

/// Default model tier when the body names none.
const DEFAULT_MODEL_SLUG: &str = "opus";

/// Default parallel session ceiling for an App Master.
const DEFAULT_MAX_CONCURRENT: i32 = 2;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// One recipe the App Master should hold, with the operator's ordering.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppMasterRecipeRequest {
    /// The v3 recipe's `slug` (`recipe_definitions.prompt_template.$.slug`).
    pub slug: String,
    /// 1 (highest) .. 5 (lowest). Absent lets the persona decide.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<u8>,
}

/// The adoption request.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AdoptAppMasterInput {
    /// A `dev_projects` id, name, or `root_path` — whichever the caller has.
    pub project: String,
    /// The recipes this App Master holds. An empty list is accepted and
    /// suspends every recipe charter it currently holds.
    #[serde(default)]
    pub recipes: Vec<AppMasterRecipeRequest>,
    /// A tier slug (`haiku` | `sonnet` | `opus`) or a full `claude-*` model
    /// id. Defaults to `opus`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub model: Option<String>,
    /// `personas.max_concurrent`. Defaults to 2.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub max_concurrent: Option<i32>,
    /// Mandate rung, clamped to the grantable ceiling (3, merge). Defaults to 2:
    /// a holder merges only by an explicit grant.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scope_rung: Option<u8>,
    /// `personas.enabled`. Defaults to FALSE — adoption prepares the App
    /// Master, a separate act starts it running.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub enabled: Option<bool>,
    /// Persona name. Defaults to `App Master <project name>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
}

/// One charter as this adoption left it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppMasterCharterOutcome {
    pub id: String,
    pub slug: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub priority: Option<u8>,
    pub status: String,
    /// True when this call minted the charter; false when it updated one.
    pub created: bool,
}

/// What the adoption actually did. Every field is a fact; `notes` carries
/// everything that did not happen and why.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppMasterAdoption {
    pub persona_id: String,
    pub persona_name: String,
    pub project_id: String,
    /// True when this call created the persona; false when it updated one.
    pub created: bool,
    pub charters: Vec<AppMasterCharterOutcome>,
    /// Recipe slugs whose charter this call suspended because the request no
    /// longer names them. Suspended, never deleted.
    pub suspended: Vec<String>,
    /// `None` when the manifest could not be seeded — see `notes`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub manifest_path: Option<String>,
    pub notes: Vec<String>,
    /// Questions this App Master has put to the operator that nobody has
    /// answered. Empty on the adopt path — an adoption has not woken yet, so it
    /// cannot have asked anything.
    #[serde(default)]
    pub open_asks: Vec<AppMasterOpenAsk>,
    /// The App Master's own last word about where it stands: the newest
    /// coverage note its decision lane wrote. `None` when it has never decided.
    ///
    /// Reported here because a terminal reading this route is otherwise looking
    /// at charter titles and statuses — none of which say *the loop is blocked
    /// and here is what it needs*, which is the one thing the note carries.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_note: Option<String>,
    /// How many personas the machine is RUNNING and the ceiling on that (G17),
    /// as measured when this response was built.
    ///
    /// A concurrency reading, not a headcount: since 2026-09-08 nothing here
    /// refuses an adoption or a hire. It is reported so a headless caller can
    /// see how busy the machine is and pace itself — a full machine means the
    /// personas it starts will WAIT, which is a reason to finish work in flight
    /// before widening the front, not a reason not to hire.
    pub active_personas: personas_engine::active_persona_cap::ActivePersonaHeadroom,
}

/// One unanswered ask, as the state route reports it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AppMasterOpenAsk {
    /// The `persona_manual_reviews` row the operator answers.
    pub review_id: String,
    /// `accept_ideas` | `decision` | `unblock`.
    pub kind: String,
    /// The question itself, without the `App Master <project>: ` display prefix.
    pub title: String,
    pub created_at: String,
}

// ---------------------------------------------------------------------------
// What the adopted persona binds to
// ---------------------------------------------------------------------------
//
// Everything from here to `adopt_bound` is the GENERALISED half of this door,
// added for the Grand Simulation's Architect (`architect_adopt`, gap G1). The
// App Master path below is one instantiation of it and behaves exactly as it
// did before: a project binding, the `App Master ` prefix, the codebase
// connector, the mandate law this file already rendered.

/// What an adopted persona — and every charter it holds — binds to.
///
/// A project binding is the App Master's: the decision reads that codebase's
/// ideas, contexts and KPIs. A workspace binding is the Architect's: the
/// decision reads every project in the workspace. The two are stored in
/// different columns and `personas_engine::responsibility::validate` refuses a
/// charter carrying both, so this enum is the only place the choice is made.
///
/// `DevProject` is boxed: it is ~536 bytes against `DevWorkspace`'s handful, and
/// an unboxed pair makes every `Binding` the size of the larger one
/// (`clippy::large_enum_variant`). The enum is passed by reference everywhere,
/// so the indirection costs one pointer hop on a path that already opened a
/// database connection.
pub(crate) enum Binding {
    Project(Box<DevProject>),
    Workspace(DevWorkspace),
}

impl Binding {
    fn id(&self) -> &str {
        match self {
            Self::Project(p) => &p.id,
            Self::Workspace(w) => &w.id,
        }
    }

    /// The name the persona, its description and its manifest law are titled
    /// after.
    fn name(&self) -> &str {
        match self {
            Self::Project(p) => &p.name,
            Self::Workspace(w) => &w.name,
        }
    }

    fn project_id(&self) -> Option<&str> {
        match self {
            Self::Project(p) => Some(p.id.as_str()),
            Self::Workspace(_) => None,
        }
    }

    fn workspace_id(&self) -> Option<&str> {
        match self {
            Self::Project(_) => None,
            Self::Workspace(w) => Some(w.id.as_str()),
        }
    }
}

/// The role the adoption installs. Everything that differs between an App
/// Master and an Architect is one of these five answers; nothing else in
/// [`adopt_bound`] branches on the role.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AdoptedRole {
    AppMaster,
    Architect,
}

impl AdoptedRole {
    /// The name prefix that recognises an incumbent whose name the operator
    /// has since changed.
    fn name_prefix(self) -> &'static str {
        match self {
            Self::AppMaster => APP_MASTER_NAME_PREFIX,
            Self::Architect => ARCHITECT_NAME_PREFIX,
        }
    }

    /// The connector every charter of this role reaches for, if any.
    ///
    /// `codebase` is a GlobalProbe builtin that resolves the persona's pinned
    /// `devProjectId` at runtime — which the Architect does not have. Binding
    /// it anyway would silently resolve the globally-first project, so the
    /// Architect gets nothing here and reaches its projects through the
    /// dev-tools bridge instead.
    fn default_connector(self) -> Option<&'static str> {
        match self {
            Self::AppMaster => Some(CODEBASE_CONNECTOR),
            Self::Architect => None,
        }
    }

    fn description(self, binding_name: &str) -> String {
        match self {
            Self::AppMaster => format!(
                "App Master for {binding_name} — accountable owner of the codebase's \
                 continuing value."
            ),
            Self::Architect => format!(
                "Architect for the {binding_name} workspace — designs the solution and \
                 directs the projects that carry it."
            ),
        }
    }

    fn seed_system_prompt(self, binding_name: &str) -> String {
        match self {
            Self::AppMaster => seed_system_prompt(binding_name),
            Self::Architect => architect_seed_system_prompt(binding_name),
        }
    }

    fn mandate_law(self, binding_name: &str, mandate: &Mandate) -> String {
        match self {
            Self::AppMaster => render_mandate_law(binding_name, mandate),
            Self::Architect => render_architect_mandate_law(binding_name, mandate),
        }
    }

    fn boundaries_law(self) -> &'static str {
        match self {
            Self::AppMaster => BOUNDARIES_LAW,
            Self::Architect => ARCHITECT_BOUNDARIES_LAW,
        }
    }
}

/// The options both adoption doors share. The binding itself is separate
/// because that is the one field the two wire shapes spell differently
/// (`project` vs `workspace`).
pub(crate) struct AdoptionOptions<'a> {
    pub recipes: &'a [AppMasterRecipeRequest],
    pub model: Option<&'a str>,
    pub max_concurrent: Option<i32>,
    pub scope_rung: Option<u8>,
    pub enabled: Option<bool>,
    pub name: Option<&'a str>,
    /// The `dev_projects.id` a WORKSPACE-bound persona calls home — where its
    /// documents go and which project its project-shaped verbs default to.
    /// Written as `design_context.homeProjectId` beside the workspace pin.
    ///
    /// `None` on the App Master path and it always will be: a project-bound
    /// persona already has `devProjectId`, which
    /// `design_context::working_project_id` prefers, so a home pin there would
    /// be a second answer to a question already answered.
    pub home_project_id: Option<&'a str>,
}

/// What one adoption did, before either door dresses it in its own wire type.
/// Deliberately carries no `project_id` / `workspace_id`: the caller already
/// holds the binding it passed in, and duplicating it here is how the two
/// shapes would start to disagree.
pub(crate) struct BoundAdoption {
    pub persona_id: String,
    pub persona_name: String,
    pub created: bool,
    pub charters: Vec<AppMasterCharterOutcome>,
    pub suspended: Vec<String>,
    pub manifest_path: Option<String>,
    pub notes: Vec<String>,
}

// ---------------------------------------------------------------------------
// Project + model resolution
// ---------------------------------------------------------------------------

/// Resolve `needle` to a project by id, then exact `root_path`, then name
/// (exact before case-insensitive). The same lenient order
/// `apply_codebase_pin_from_design` accepts, because a caller that has a name
/// should not have to look up an id first.
fn resolve_project(pool: &DbPool, needle: &str) -> Result<DevProject, AppError> {
    let needle = needle.trim();
    personas_core::validation::require_non_empty("project", needle)?;

    match projects_repo::get_project_by_id(pool, needle) {
        Ok(p) => return Ok(p),
        Err(AppError::NotFound(_)) => {}
        Err(e) => return Err(e),
    }
    if let Some(p) = projects_repo::get_project_by_path(pool, needle)? {
        return Ok(p);
    }
    let all = projects_repo::list_projects(pool, None)?;
    if let Some(p) = all.iter().find(|p| p.name == needle) {
        return Ok(p.clone());
    }
    if let Some(p) = all
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(needle) || p.root_path.eq_ignore_ascii_case(needle))
    {
        return Ok(p.clone());
    }
    Err(AppError::Validation(format!(
        "No dev project matches `{needle}` by id, name or root_path. Register it first \
         (POST /dev-tools/projects), or list the known ones (GET /dev-tools/projects)."
    )))
}

/// Resolve `needle` to a workspace by id, then by name (exact before
/// case-insensitive) — the same lenient order [`resolve_project`] accepts, for
/// the same reason: a caller who has the workspace's name should not have to
/// look up a uuid first.
pub(crate) fn resolve_workspace(pool: &DbPool, needle: &str) -> Result<DevWorkspace, AppError> {
    let needle = needle.trim();
    personas_core::validation::require_non_empty("workspace", needle)?;

    match workspaces_repo::get_workspace_by_id(pool, needle) {
        Ok(w) => return Ok(w),
        Err(AppError::NotFound(_)) => {}
        Err(e) => return Err(e),
    }
    let all = workspaces_repo::list_workspaces(pool)?;
    if let Some(w) = all.iter().find(|w| w.name == needle) {
        return Ok(w.clone());
    }
    if let Some(w) = all.iter().find(|w| w.name.eq_ignore_ascii_case(needle)) {
        return Ok(w.clone());
    }
    Err(AppError::Validation(format!(
        "No dev workspace matches `{needle}` by id or name. Create it first, or list the \
         known ones (dev_workspaces_list)."
    )))
}

/// A tier slug or a full model id, as the id that gets stored. Anything else
/// is refused rather than silently falling through to the CLI account default.
fn resolve_model_id(raw: Option<&str>) -> Result<String, AppError> {
    let wanted = raw.map(str::trim).filter(|s| !s.is_empty());
    let wanted = wanted.unwrap_or(DEFAULT_MODEL_SLUG);
    if let Some(id) = personas_engine::prompt::tier_slug_to_model_id(wanted) {
        return Ok(id.to_string());
    }
    if wanted.starts_with("claude-") {
        return Ok(wanted.to_string());
    }
    Err(AppError::Validation(format!(
        "Unknown model `{wanted}`: use a tier slug (haiku | sonnet | opus) or a full \
         `claude-*` model id"
    )))
}

// ---------------------------------------------------------------------------
// The manifest law
// ---------------------------------------------------------------------------

/// The `# Mandate` law body for an App Master, rendered from the engine's own
/// mandate types.
///
/// Every sentence below is the wording
/// [`crate::commands::companion::approvals::app_master_hire::app_master_intent`]
/// already uses for the same rung and the same forbidden class. That function
/// cannot be called here — it renders one string from a kp `appMaster` JSON
/// block, folding in objectives, cadence, gates and tenure this door has none
/// of, and it is not decomposed into per-section helpers. So this is the same
/// prose over the typed `Mandate`, and NOTHING is added to it.
fn render_mandate_law(app_name: &str, mandate: &Mandate) -> String {
    let mut out = format!(
        "You are the APP MASTER for `{app_name}` — the single accountable owner of that \
         application's continuing value.\n\n\
         Your standing question at the start of every cycle is \"which of my objectives can I \
         move this cycle, and is it true that it moved?\" — not \"what task was I given?\".\n\n\
         MANDATE — how far you may go on your own:\n"
    );
    out.push_str(match mandate.scope_rung {
        RUNG_READ => {
            "- Rung 0 (read). Observe, measure and report. You may NOT write to the \
             repository at all — not a branch, not a retry. Everything else is a proposal \
             you hand to your owner.\n"
        }
        RUNG_RETRY => {
            "- Rung 1 (retry). You may re-run existing work (a failed job, a flaky gate). \
             You may NOT author a new change.\n"
        }
        RUNG_BRANCH => {
            "- Rung 2 (open branch/PR). You may author a change and propose it on a \
             branch. You may NOT merge, deploy, or push to the default branch — a human \
             merges. Never commit to main/master.\n"
        }
        _ => {
            "- Rung 3 (merge). You may author a change, run the project's own gates on \
             the result, and merge it to the project's default branch yourself, with the \
             certification on record. Merge authority on this project is yours: do not \
             ask who merges. It is yours across EVERY charter you hold, not the delivery \
             charter's alone: a green branch that any of your charters cut is merged by \
             that same run, from the project's main checkout, and never parked for \
             another charter or a person to land. What the gates refuse stays unmerged \
             until the gate is green; you may NOT change a gate you run, and you may NOT \
             deploy.\n"
        }
    });
    out.push_str(
        "- Rung 4 (change the gates) is never granted to anyone in this version. Do not \
         ask for it and do not route around it.\n",
    );
    if !mandate.forbidden_classes.is_empty() {
        out.push_str(
            "\nFORBIDDEN CHANGES — these are blocked mechanically at dispatch, counted as \
             violations, and never rewritten into an allowed shape. Stop at the line and \
             ask instead:\n",
        );
        for class in &mandate.forbidden_classes {
            out.push_str(forbidden_class_line(*class));
        }
    }
    out
}

/// The one-line rule for a forbidden class — the hire path's wording, verbatim.
fn forbidden_class_line(class: ForbiddenClass) -> &'static str {
    match class {
        ForbiddenClass::TestDeletionOrSkip => {
            "- Deleting, skipping or xfailing a test to make a suite pass. \
             Never repair by deletion.\n"
        }
        ForbiddenClass::SuppressionDirective => {
            "- Adding a suppression directive (eslint-disable, # type: ignore, \
             @ts-expect-error, # noqa, #[allow(...)]) to silence a check.\n"
        }
        ForbiddenClass::GateConfiguration => {
            "- Editing the gate or CI configuration you are judged by (workflows, \
             lint/tsconfig/pytest/jest configs, lefthook).\n"
        }
        ForbiddenClass::DependencyBumpToSatisfyCheck => {
            "- Changing a dependency manifest or lockfile without an explicit, \
             stated upgrade goal.\n"
        }
        ForbiddenClass::CredentialsOrPermissions => {
            "- Touching credentials, secrets, tokens, IAM or ownership files.\n"
        }
        ForbiddenClass::DeliveryConfiguration => {
            "- Touching deploy targets, release channels or feature-flag rollout.\n"
        }
    }
}

/// The `# Boundaries` law body — the two limits this door is the author of.
const BOUNDARIES_LAW: &str = "- Ship to the default branch only through the operator's \
     authenticated GitHub login and only when the mandate rung allows.\n\
     - Never repair by deletion.\n";

/// The `# Mandate` law body for an **Architect** — the cross-project role of
/// the Grand Simulation (`docs/architecture/grand-simulation.md` §2).
///
/// Rendered from the same typed [`Mandate`] as the App Master's, and it quotes
/// the engine's own forbidden-class wording verbatim through
/// [`forbidden_class_line`] for exactly the reason
/// [`render_mandate_law`] does: there must be ONE spelling of a class in this
/// repository, and a second paraphrase of it would be a second rule.
///
/// What differs is the standing question and the six verbs. The Architect's
/// scope rung governs the same ladder — it may not merge or deploy either —
/// but the interesting limit is not the rung: it is that the Architect does
/// not write application code at all. Its recipes write documents and call
/// doors, and the projects it creates are where the code goes.
fn render_architect_mandate_law(workspace_name: &str, mandate: &Mandate) -> String {
    let mut out = format!(
        "You are the ARCHITECT of the `{workspace_name}` workspace — the single reader who \
         sees every project in it at once.\n\n\
         Your standing question at the start of every cycle is \"does the portfolio still \
         match the design, and what did the projects' own evidence change?\" — not \"what \
         task was I given?\".\n\n\
         MANDATE — what the role is:\n\
         - You design and direct; you do not write application code.\n\
         - You create projects, adopt App Masters, set goals, speak with authority, \
         request roles, adjust scope.\n\
         - Everything a project builds is built by its App Master and the roles hired into \
         it. If you find yourself editing an application's source, you have taken \
         somebody's work rather than directing it.\n\n\
         MANDATE — how far you may go on your own:\n"
    );
    out.push_str(match mandate.scope_rung {
        RUNG_READ => {
            "- Rung 0 (read). Observe, measure and report. You may NOT write to the \
             repository at all — not a branch, not a retry. Everything else is a proposal \
             you hand to your owner.\n"
        }
        RUNG_RETRY => {
            "- Rung 1 (retry). You may re-run existing work (a failed job, a flaky gate). \
             You may NOT author a new change.\n"
        }
        RUNG_BRANCH => {
            "- Rung 2 (open branch/PR). You may author a change and propose it on a \
             branch. You may NOT merge, deploy, or push to the default branch — a human \
             merges. Never commit to main/master.\n"
        }
        _ => {
            "- Rung 3 (merge). You may author a change, run the project's own gates on \
             the result, and merge it to the project's default branch yourself, with the \
             certification on record. Merge authority on this project is yours: do not \
             ask who merges. It is yours across EVERY charter you hold, not the delivery \
             charter's alone: a green branch that any of your charters cut is merged by \
             that same run, from the project's main checkout, and never parked for \
             another charter or a person to land. What the gates refuse stays unmerged \
             until the gate is green; you may NOT change a gate you run, and you may NOT \
             deploy.\n"
        }
    });
    out.push_str(
        "- Rung 4 (change the gates) is never granted to anyone in this version. Do not \
         ask for it and do not route around it.\n",
    );
    if !mandate.forbidden_classes.is_empty() {
        out.push_str(
            "\nFORBIDDEN CHANGES — these are blocked mechanically at dispatch, counted as \
             violations, and never rewritten into an allowed shape. Stop at the line and \
             ask instead:\n",
        );
        for class in &mandate.forbidden_classes {
            out.push_str(forbidden_class_line(*class));
        }
    }
    out
}

/// The Architect's `# Boundaries` law body.
const ARCHITECT_BOUNDARIES_LAW: &str = "- Direct through goals and the workspace channel, \
     never by editing another persona's work.\n\
     - Ask for a role rather than doing the role's work yourself.\n\
     - Never repair by deletion.\n";

/// The `# Operation defaults` law body: what the adoption configured.
fn render_operation_defaults(
    model_id: &str,
    max_concurrent: i32,
    charters: &[AppMasterCharterOutcome],
) -> String {
    let mut out = format!(
        "- Model: {model_id}\n- Max parallel sessions: {max_concurrent}\n- Charters (recipe \
         slug, priority):\n"
    );
    if charters.is_empty() {
        out.push_str("  - (none adopted)\n");
        return out;
    }
    for c in charters {
        let priority = match c.priority {
            Some(p) => p.to_string(),
            None => "unset (the persona decides)".to_string(),
        };
        out.push_str(&format!("  - {}: priority {priority}\n", c.slug));
    }
    out
}

// ---------------------------------------------------------------------------
// The adoption
// ---------------------------------------------------------------------------

/// A resolved recipe request: the row's v3 payload plus the operator's
/// priority. Built for EVERY requested slug before anything is written, so an
/// unknown slug refuses the whole request having changed nothing.
struct ResolvedRecipe {
    spec: RecipeSpec,
    slug: String,
    priority: Option<u8>,
}

fn resolve_recipes(
    pool: &DbPool,
    requests: &[AppMasterRecipeRequest],
) -> Result<Vec<ResolvedRecipe>, AppError> {
    let mut unknown: Vec<String> = Vec::new();
    let mut not_v3: Vec<String> = Vec::new();
    let mut out: Vec<ResolvedRecipe> = Vec::new();
    let mut seen: BTreeSet<String> = BTreeSet::new();

    for req in requests {
        let slug = req.slug.trim().to_string();
        personas_core::validation::require_non_empty("recipes[].slug", &slug)?;
        if let Some(p) = req.priority {
            if !(1..=5).contains(&p) {
                return Err(AppError::Validation(format!(
                    "Recipe `{slug}` has priority {p}: the range is 1 (highest) to 5 \
                     (lowest), or omit it to let the persona decide"
                )));
            }
        }
        if !seen.insert(slug.clone()) {
            return Err(AppError::Validation(format!(
                "Recipe `{slug}` is named twice in one request"
            )));
        }
        let Some(row) = recipes_repo::get_by_slug(pool, &slug)? else {
            unknown.push(slug);
            continue;
        };
        // The v3 payload IS the row's `prompt_template`. A row whose payload
        // is v1/v2 or free prose cannot mint a charter here — `charter_input_
        // from_recipe` reads fields those shapes do not have, and defaulting
        // them would produce a charter that claims a recipe it never read.
        let payload: serde_json::Value = match serde_json::from_str(&row.prompt_template) {
            Ok(v) => v,
            Err(_) => {
                not_v3.push(slug);
                continue;
            }
        };
        if !RecipeSpec::looks_like_v3(&payload) {
            not_v3.push(slug);
            continue;
        }
        let mut spec: RecipeSpec = serde_json::from_value(payload).map_err(|e| {
            AppError::Validation(format!("Recipe `{slug}` has an unreadable v3 payload: {e}"))
        })?;
        if spec.slug.trim().is_empty() {
            spec.slug = slug.clone();
        }
        out.push(ResolvedRecipe {
            spec,
            slug,
            priority: req.priority,
        });
    }

    if !unknown.is_empty() || !not_v3.is_empty() {
        let mut parts: Vec<String> = Vec::new();
        if !unknown.is_empty() {
            parts.push(format!("no recipe with slug: {}", unknown.join(", ")));
        }
        if !not_v3.is_empty() {
            parts.push(format!("not a v3 recipe payload: {}", not_v3.join(", ")));
        }
        return Err(AppError::NotFound(format!(
            "App Master adoption wrote nothing — {}",
            parts.join("; ")
        )));
    }
    Ok(out)
}

/// Merge the binding's pin into a persona's `design_context` without
/// clobbering whatever else it holds (`useCases`, `summary`, the twin pin, …).
///
/// A project binding writes `devProjectId` — the key the `codebase` connector
/// resolves. A workspace binding writes `workspaceId` beside it, which is what
/// `personas::list_by_dev_workspace` reads to find the incumbent Architect.
/// Only the binding's OWN key is written: clearing the other one would unpin a
/// codebase the operator bound by hand.
///
/// `home_project_id` is written beside the workspace pin when the caller
/// resolved one. It is written only when present, for the same reason: a
/// re-adoption that names no home must not clear a home an earlier one set.
fn design_context_with_pin(
    existing: Option<&str>,
    binding: &Binding,
    home_project_id: Option<&str>,
) -> String {
    let mut dc: serde_json::Value = existing
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str(s).ok())
        .filter(serde_json::Value::is_object)
        .unwrap_or_else(|| serde_json::json!({}));
    if let Some(obj) = dc.as_object_mut() {
        // `DesignContextData` is `rename_all = "camelCase"` → `devProjectId`,
        // `workspaceId` and `homeProjectId`.
        let key = match binding {
            Binding::Project(_) => "devProjectId",
            Binding::Workspace(_) => "workspaceId",
        };
        obj.insert(
            key.to_string(),
            serde_json::Value::String(binding.id().to_string()),
        );
        if let Some(home) = home_project_id.map(str::trim).filter(|h| !h.is_empty()) {
            obj.insert(
                "homeProjectId".to_string(),
                serde_json::Value::String(home.to_string()),
            );
        }
    }
    dc.to_string()
}

/// The seed prompt for a freshly created App Master. Short on purpose: the
/// standing law lives in `manifest.md` (`# Mandate` / `# Boundaries` /
/// `# Operation defaults`), which prompt assembly reads, and duplicating it
/// into `system_prompt` would give the persona two copies that drift.
fn seed_system_prompt(app_name: &str) -> String {
    format!(
        "You are the App Master for `{app_name}`: the single accountable owner of that \
         application's continuing value. Your mandate, your boundaries and your operating \
         defaults are your manifest's law sections — read them as binding. Each charter you \
         hold names one recipe's worth of standing work; you decide which one moves this \
         cycle and you report whether it actually moved."
    )
}

/// The Architect's seed prompt — short for the same reason: the standing law
/// lives in `manifest.md`, and a second copy in `system_prompt` would drift.
fn architect_seed_system_prompt(workspace_name: &str) -> String {
    format!(
        "You are the Architect of the `{workspace_name}` workspace: the single reader who \
         sees every project in it at once. Your mandate, your boundaries and your operating \
         defaults are your manifest's law sections — read them as binding. You design and \
         direct; you do not write application code. Each charter you hold names one recipe's \
         worth of standing work; you decide which one moves the portfolio this cycle and you \
         report whether it actually moved."
    )
}

/// Find the incumbent holder of `binding`, if any: the persona already pinned
/// to it, by exact name first and then by the role's name prefix (so an
/// operator's rename does not mint a second one).
fn find_incumbent(
    pool: &DbPool,
    role: AdoptedRole,
    binding: &Binding,
    desired_name: &str,
) -> Result<Option<Persona>, AppError> {
    let pinned = match binding {
        Binding::Project(p) => personas_repo::list_by_dev_project(pool, &p.id)?,
        Binding::Workspace(w) => personas_repo::list_by_dev_workspace(pool, &w.id)?,
    };
    let by_name = pinned.iter().find(|p| p.name == desired_name).cloned();
    if by_name.is_some() {
        return Ok(by_name);
    }
    Ok(pinned
        .into_iter()
        .find(|p| p.name.starts_with(role.name_prefix())))
}

/// Adopt (or re-adopt) the App Master for one project. The whole operation,
/// with no Tauri or HTTP in sight — the command and the bridge route are both
/// adapters over this.
pub fn adopt(pool: &DbPool, input: &AdoptAppMasterInput) -> Result<AppMasterAdoption, AppError> {
    let binding = Binding::Project(Box::new(resolve_project(pool, &input.project)?));
    let project_id = binding.id().to_string();
    let done = adopt_bound(
        pool,
        AdoptedRole::AppMaster,
        &binding,
        &AdoptionOptions {
            recipes: &input.recipes,
            model: input.model.as_deref(),
            max_concurrent: input.max_concurrent,
            scope_rung: input.scope_rung,
            enabled: input.enabled,
            name: input.name.as_deref(),
            // A project-bound persona already carries `devProjectId`, which the
            // working-project read prefers. A home pin here would be a second
            // answer to a question already answered.
            home_project_id: None,
        },
    )?;

    Ok(AppMasterAdoption {
        persona_id: done.persona_id,
        persona_name: done.persona_name,
        project_id,
        created: done.created,
        charters: done.charters,
        suspended: done.suspended,
        manifest_path: done.manifest_path,
        notes: done.notes,
        // An adoption has not woken yet, so it has asked nothing and decided
        // nothing. Reported empty rather than omitted: the shape is the same on
        // both paths, and a reader never has to ask which one produced it.
        open_asks: Vec::new(),
        last_note: None,
        // Re-read rather than reusing the pre-write measurement: this adoption
        // may have just consumed a slot, and a caller deciding whether to hire
        // again must see the count AFTER its own effect.
        active_personas: personas_engine::active_persona_cap::active_persona_headroom(pool)?,
    })
}

/// Adopt (or re-adopt) the holder of ONE binding. The generalised body both
/// doors run: the App Master's project adoption above and the Architect's
/// workspace adoption in `architect_adopt`.
///
/// The two rules in this module's header hold for both roles — partial success
/// is reported in `notes` rather than rounded up, and nothing is invented to
/// fill a gap — and so does the idempotency key: the persona by
/// `(binding pin, name)`, each charter by `(persona_id, spec.recipeRef.slug)`.
pub(crate) fn adopt_bound(
    pool: &DbPool,
    role: AdoptedRole,
    binding: &Binding,
    opts: &AdoptionOptions<'_>,
) -> Result<BoundAdoption, AppError> {
    let model_id = resolve_model_id(opts.model)?;
    let max_concurrent = opts.max_concurrent.unwrap_or(DEFAULT_MAX_CONCURRENT);
    let enabled = opts.enabled.unwrap_or(false);
    let scope_rung = opts
        .scope_rung
        .unwrap_or(RUNG_BRANCH)
        .min(MAX_GRANTABLE_RUNG);
    let mut notes: Vec<String> = Vec::new();
    if opts.scope_rung.is_some_and(|r| r > MAX_GRANTABLE_RUNG) {
        notes.push(format!(
            "Requested scope rung {} is above the grantable ceiling; clamped to {}",
            opts.scope_rung.unwrap_or(scope_rung),
            MAX_GRANTABLE_RUNG
        ));
    }

    // Every recipe resolves BEFORE the first write, so an unknown slug leaves
    // the database untouched rather than half-adopted.
    let resolved = resolve_recipes(pool, opts.recipes)?;

    let desired_name = opts
        .name
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("{} {}", role.name_prefix(), binding.name()));

    let model_profile = serde_json::json!({ "model": model_id }).to_string();
    let incumbent = find_incumbent(pool, role, binding, &desired_name)?;
    let created = incumbent.is_none();

    // G17 (2026-09-08): adopting an App Master is never refused for capacity.
    // The cap this door used to consult counted enabled ROWS; it now counts
    // personas that are RUNNING and is enforced in the attention loop's
    // admission ladder. An Architect may therefore give every project in its
    // workspace an App Master, and the machine paces how many of them wake at
    // once rather than refusing the workforce it was asked to build.

    let persona = match incumbent {
        Some(p) => personas_repo::update(
            pool,
            &p.id,
            UpdatePersonaInput {
                name: Some(desired_name.clone()),
                // A re-adoption refreshes charters; it does not switch a
                // running persona off. `enabled` moves only when the request
                // says so.
                enabled: opts.enabled,
                max_concurrent: Some(max_concurrent),
                model_profile: Some(Some(model_profile.clone())),
                design_context: Some(Some(design_context_with_pin(
                    p.design_context.as_deref(),
                    binding,
                    opts.home_project_id,
                ))),
                lifecycle: Some(
                    crate::db::models::PersonaLifecycle::Active
                        .as_str()
                        .to_string(),
                ),
                source: Some("other".to_string()),
                ..Default::default()
            },
        )?,
        None => personas_repo::create(
            pool,
            CreatePersonaInput {
                name: desired_name.clone(),
                system_prompt: role.seed_system_prompt(binding.name()),
                description: Some(role.description(binding.name())),
                enabled: Some(enabled),
                max_concurrent: Some(max_concurrent),
                model_profile: Some(model_profile),
                design_context: Some(design_context_with_pin(None, binding, opts.home_project_id)),
                lifecycle: Some(
                    crate::db::models::PersonaLifecycle::Active
                        .as_str()
                        .to_string(),
                ),
                project_id: None,
                structured_prompt: None,
                icon: None,
                color: None,
                timeout_ms: None,
                max_budget_usd: None,
                max_turns: None,
                notification_channels: None,
            },
        )?,
    };

    let (charters, suspended, charter_notes) = sync_charters(
        pool,
        &persona.id,
        role,
        binding,
        scope_rung,
        &model_id,
        &resolved,
    )?;
    notes.extend(charter_notes);

    let mandate = Mandate {
        scope_rung,
        forbidden_classes: ALL_FORBIDDEN_CLASSES.to_vec(),
        ..Mandate::default()
    };
    let manifest_path = write_manifest_law(
        pool,
        &persona.id,
        role,
        binding.name(),
        &mandate,
        &model_id,
        max_concurrent,
        &charters,
        &mut notes,
    );

    file_under_a_team(pool, role, binding, &persona.id, &mut notes);

    Ok(BoundAdoption {
        persona_id: persona.id,
        persona_name: persona.name,
        created,
        charters,
        suspended,
        manifest_path,
        notes,
    })
}

/// Bring the persona's recipe charters in line with the request: create what
/// is new, update what exists, suspend what the request dropped.
#[allow(clippy::type_complexity)]
#[allow(clippy::too_many_arguments)]
fn sync_charters(
    pool: &DbPool,
    persona_id: &str,
    role: AdoptedRole,
    binding: &Binding,
    scope_rung: u8,
    model_id: &str,
    resolved: &[ResolvedRecipe],
) -> Result<(Vec<AppMasterCharterOutcome>, Vec<String>, Vec<String>), AppError> {
    let mut notes: Vec<String> = Vec::new();
    let held = resp_repo::list_by_persona(pool, persona_id, false)?;
    // Keyed by the charter's own recipe pointer — the adoption identity.
    let by_slug: HashMap<String, PersonaResponsibility> = held
        .iter()
        .filter_map(|r| {
            r.spec
                .recipe_ref
                .as_ref()
                .map(|rr| rr.slug.trim().to_string())
                .filter(|s| !s.is_empty())
                .map(|s| (s, r.clone()))
        })
        .collect();

    let requested: BTreeSet<String> = resolved.iter().map(|r| r.slug.clone()).collect();
    let mut outcomes: Vec<AppMasterCharterOutcome> = Vec::new();

    for item in resolved {
        let mut charter = charter_input_from_recipe(persona_id, &item.spec, None);
        // ONE of the two, never both — `validate` refuses the pair, and the
        // binding enum is what makes that unrepresentable here.
        charter.project_id = binding.project_id().map(str::to_string);
        charter.workspace_id = binding.workspace_id().map(str::to_string);
        charter.domain = Some(DOMAIN_SOFTWARE_ENGINEERING.to_string());
        charter.scope_rung = scope_rung;
        charter.status = Some(ResponsibilityStatus::Active.as_str().to_string());
        // EVERY charter this door installs is self-paced. A recipe that
        // recommends `time` or `event` carries no cron and no event name, so
        // there is nothing to install; the recommendation stays readable in
        // the charter's copied description.
        charter.cadence.attention_enabled = true;
        charter.spec.priority = item.priority;
        charter.spec.model_override = Some(model_id.to_string());
        charter.spec.recipe_ref = Some(RecipeRef {
            slug: item.slug.clone(),
            // A draft recipe has no version; the slug alone is the pointer.
            version: item.spec.version.clone().filter(|v| !v.trim().is_empty()),
        });
        apply_role_grants(role, &item.slug, &mut charter.spec);
        apply_worker_engine(&item.slug, &mut charter.spec);
        if let Some(connector) = role.default_connector() {
            if !charter.connectors.iter().any(|c| c == connector) {
                charter.connectors.insert(0, connector.to_string());
            }
        }

        let outcome = match by_slug.get(&item.slug) {
            Some(existing) => {
                // The coverage memory the attention loop wrote between wakes
                // is the charter's, not the recipe's — carry it across.
                charter.spec.pacing = existing.spec.pacing.clone();
                let updated = personas_engine::responsibility::update_from_input(
                    pool,
                    &existing.id,
                    UpdatePersonaResponsibilityInput {
                        title: Some(charter.title.clone()),
                        domain: charter.domain.clone(),
                        outcomes: Some(charter.outcomes.clone()),
                        scope_rung: Some(charter.scope_rung),
                        cadence: Some(charter.cadence.clone()),
                        project_id: Some(charter.project_id.clone()),
                        workspace_id: Some(charter.workspace_id.clone()),
                        connectors: Some(charter.connectors.clone()),
                        procedure: Some(charter.procedure.clone()),
                        spec: Some(charter.spec.clone()),
                        ..Default::default()
                    },
                )?;
                // `update_from_input` deliberately never moves status; a
                // charter this request names again is active again.
                let status = if updated.status == ResponsibilityStatus::Active.as_str() {
                    updated.status.clone()
                } else {
                    resp_repo::set_status(pool, &updated.id, ResponsibilityStatus::Active)?;
                    ResponsibilityStatus::Active.as_str().to_string()
                };
                AppMasterCharterOutcome {
                    id: updated.id,
                    slug: item.slug.clone(),
                    title: updated.title,
                    priority: item.priority,
                    status,
                    created: false,
                }
            }
            None => {
                let row = personas_engine::responsibility::create_from_input(pool, &charter)?;
                AppMasterCharterOutcome {
                    id: row.id,
                    slug: item.slug.clone(),
                    title: row.title,
                    priority: item.priority,
                    status: row.status,
                    created: true,
                }
            }
        };
        outcomes.push(outcome);
    }

    let mut suspended: Vec<String> = Vec::new();
    for (slug, row) in &by_slug {
        if requested.contains(slug) || row.status == ResponsibilityStatus::Suspended.as_str() {
            continue;
        }
        resp_repo::set_status(pool, &row.id, ResponsibilityStatus::Suspended)?;
        suspended.push(slug.clone());
    }
    suspended.sort();

    // Charters with no recipe pointer are NOT this door's to suspend — it
    // keys on the slug, and a hand-authored charter has none. Say so rather
    // than leaving the operator to wonder why they survived.
    let unkeyed = held
        .iter()
        .filter(|r| {
            r.spec
                .recipe_ref
                .as_ref()
                .map(|rr| rr.slug.trim())
                .unwrap_or("")
                .is_empty()
        })
        .count();
    if unkeyed > 0 {
        notes.push(format!(
            "{unkeyed} charter(s) on this persona carry no recipe pointer and were left \
             untouched — this door only owns charters it can key by recipe slug"
        ));
    }

    Ok((outcomes, suspended, notes))
}

/// The recipe slug whose charter carries the hiring grant. Named here rather
/// than inferred from the recipe's own text: a grant that turns itself on
/// because a description mentioned hiring is a grant nobody decided.
const HIRING_RECIPE_SLUG: &str = "workforce-planning";

/// Stamp the role's standing grants onto a charter's spec.
///
/// `authority` says this charter's holder speaks with authority in channels —
/// the Architect's directives are instructions, not suggestions. `canHire` says
/// this charter may request a hire from kp, and only the workforce-planning
/// charter carries it: the Architect's other four design, compose, direct and
/// reflect, and none of them has a reason to open a job.
///
/// An App Master gets neither, and both stay ABSENT rather than `false` on its
/// charters — the wire rule this repo already follows for an unadopted field.
fn apply_role_grants(
    role: AdoptedRole,
    slug: &str,
    spec: &mut crate::db::models::ResponsibilitySpec,
) {
    if role != AdoptedRole::Architect {
        return;
    }
    spec.authority = Some(true);
    if slug == HIRING_RECIPE_SLUG {
        spec.can_hire = Some(true);
    }
}

/// The maintenance lane (operator, 2026-09-15): the `codebase-stewardship`
/// recipe is carried by the codex CLI on a coding model, not by the engine
/// that decides. Keyed by slug like [`HIRING_RECIPE_SLUG`] — a recipe payload
/// has no engine field and does not need one while exactly one recipe rides
/// this lane — and applied AFTER the door's model stamp, so the lane keeps its
/// own model instead of the persona's.
pub const CODEX_LANE_RECIPE_SLUG: &str = "codebase-stewardship";
/// The coding model the lane runs on. The operator's capacity is on this
/// model; the deciding App Master stays on its own.
pub const CODEX_LANE_DEFAULT_MODEL: &str = personas_core::model_ids::CODEX_MAINTENANCE;
/// `ResponsibilitySpec::worker_engine` token for the lane; the fleet's
/// `headless::CODEX_ENGINE` pins itself to it.
pub const WORKER_ENGINE_CODEX: &str = "codex";

fn apply_worker_engine(slug: &str, spec: &mut crate::db::models::ResponsibilitySpec) {
    if slug == CODEX_LANE_RECIPE_SLUG {
        spec.worker_engine = Some(WORKER_ENGINE_CODEX.to_string());
        spec.model_override = Some(CODEX_LANE_DEFAULT_MODEL.to_string());
    }
}
/// The team a workspace-bound persona is filed under.
///
/// An Architect holds charters across every project in its workspace, so it
/// belongs to no project's team and filing it under one would misread it as
/// that project's App Master. It gets a team of its own instead, named for the
/// workspace, which is what makes the Monitor's grid answer the operator's
/// actual question: which agents are app-specific and which are cross-project.
fn cross_project_team_name(workspace_name: &str) -> String {
    format!("{workspace_name} — cross-project")
}

/// Put the adopted persona in the Monitor's grid.
///
/// Until 2026-09-09 this door did no team work whatsoever, while the
/// human-approved hiring door did it carefully — so which door adopted a
/// persona decided whether the operator could see it grouped, and every
/// persona the Grand Simulation's Architect adopted landed in the ungrouped
/// tray. Best-effort by construction, like the manifest above: the persona and
/// its charters are already real, and a grid that groups badly is not a reason
/// to fail an adoption that otherwise succeeded.
fn file_under_a_team(
    pool: &DbPool,
    role: AdoptedRole,
    binding: &Binding,
    persona_id: &str,
    notes: &mut Vec<String>,
) {
    use crate::db::repos::resources::teams as team_repo;

    match binding {
        // A project-bound App Master joins its project's team — the same team
        // the hiring door creates, reached through the same function so the
        // two doors cannot drift apart again.
        Binding::Project(p) => {
            crate::commands::companion::approvals::app_master_hire::ensure_team(
                pool, &p.id, persona_id, &p.name, notes,
            );
        }
        // A workspace-bound holder (the Architect) gets the cross-project team.
        Binding::Workspace(w) => {
            let name = cross_project_team_name(&w.name);
            let existing = team_repo::get_all(pool)
                .ok()
                .and_then(|ts| ts.into_iter().find(|t| t.name == name));
            let team_id = match existing {
                Some(t) => t.id,
                None => match team_repo::create(
                    pool,
                    crate::db::models::CreateTeamInput {
                        name: name.clone(),
                        // Deliberately no project: this team's whole meaning is
                        // that its members answer to the workspace instead.
                        project_id: None,
                        parent_team_id: None,
                        description: Some(format!(
                            "Personas whose charters span every project in the {} workspace.",
                            w.name
                        )),
                        canvas_data: None,
                        team_config: None,
                        icon: None,
                        color: None,
                        enabled: Some(true),
                    },
                ) {
                    Ok(t) => t.id,
                    Err(e) => {
                        notes.push(format!("could not create the cross-project team: {e}"));
                        return;
                    }
                },
            };
            if let Err(e) = team_repo::add_member(
                pool,
                &team_id,
                persona_id,
                Some(role.name_prefix().to_string()),
                None,
                None,
                None,
            ) {
                // Already-a-member is a Validation error, not a failure.
                notes.push(format!("cross-project team membership: {e}"));
            }
            if let Err(e) =
                crate::db::repos::core::personas::set_home_team(pool, persona_id, &team_id)
            {
                notes.push(format!(
                    "cross-project team joined but the home could not be set ({e}) — \
                     it will render in the Monitor's ungrouped tray"
                ));
            }
        }
    }
}

/// Seed the manifest and write its three law sections. Best-effort by
/// construction: the persona and its charters are already real, so every
/// failure becomes a note and `None` is returned for the path.
#[allow(clippy::too_many_arguments)]
fn write_manifest_law(
    pool: &DbPool,
    persona_id: &str,
    role: AdoptedRole,
    app_name: &str,
    mandate: &Mandate,
    model_id: &str,
    max_concurrent: i32,
    charters: &[AppMasterCharterOutcome],
    notes: &mut Vec<String>,
) -> Option<String> {
    let path = match manifest::ensure(pool, persona_id) {
        Ok(p) => p,
        Err(e) => {
            notes.push(format!(
                "MANIFEST NOT SEEDED ({e}) — the mandate is NOT in the persona's law sections, \
                 so a run will not read it"
            ));
            return None;
        }
    };
    let sections = [
        ("Mandate", role.mandate_law(app_name, mandate)),
        ("Boundaries", role.boundaries_law().to_string()),
        (
            "Operation defaults",
            render_operation_defaults(model_id, max_concurrent, charters),
        ),
    ];
    for (section, body) in sections {
        if let Err(e) = manifest::update_law(pool, persona_id, section, &body) {
            notes.push(format!(
                "manifest law section `{section}` not written ({e}) — the seeded text stands"
            ));
        }
    }
    Some(path.to_string_lossy().to_string())
}

/// The current adoption state for a project: the App Master persona, its
/// recipe charters and their status. `None` when no persona is pinned to the
/// project under this door's naming.
pub fn current(pool: &DbPool, project: &str) -> Result<Option<AppMasterAdoption>, AppError> {
    let project = resolve_project(pool, project)?;
    let pinned = personas_repo::list_by_dev_project(pool, &project.id)?;
    let Some(persona) = pinned
        .into_iter()
        .find(|p| p.name.starts_with(APP_MASTER_NAME_PREFIX))
    else {
        return Ok(None);
    };
    let responsibilities = resp_repo::list_by_persona(pool, &persona.id, false)?;
    // Read from EVERY live charter, not only the recipe-backed ones the list
    // below keeps: `write_back_pacing` stamps the note on every charter the
    // decision considered, and a charter without a recipe slug carries it just
    // as well as one with.
    let last_note = crate::engine::subscription::newest_coverage_note_for(&responsibilities);
    let charters: Vec<AppMasterCharterOutcome> = responsibilities
        .into_iter()
        .filter_map(|r| {
            let slug = r
                .spec
                .recipe_ref
                .as_ref()
                .map(|rr| rr.slug.trim().to_string())
                .filter(|s| !s.is_empty())?;
            Some(AppMasterCharterOutcome {
                id: r.id,
                slug,
                title: r.title,
                priority: r.spec.priority,
                status: r.status,
                created: false,
            })
        })
        .collect();
    let open_asks: Vec<AppMasterOpenAsk> =
        crate::engine::subscription::list_open_asks(pool, &persona.id)
            .into_iter()
            .map(|a| AppMasterOpenAsk {
                review_id: a.review_id,
                kind: a.kind,
                title: a.title,
                created_at: a.created_at,
            })
            .collect();
    let suspended: Vec<String> = charters
        .iter()
        .filter(|c| c.status == ResponsibilityStatus::Suspended.as_str())
        .map(|c| c.slug.clone())
        .collect();
    // Read-only: the path is reported only when the file already exists, so a
    // GET never seeds a manifest as a side effect.
    let manifest_path = manifest::read(&persona.id)
        .and(manifest::manifest_path(&persona.id).ok())
        .map(|p| p.to_string_lossy().to_string());
    Ok(Some(AppMasterAdoption {
        persona_id: persona.id,
        persona_name: persona.name,
        project_id: project.id,
        created: false,
        charters,
        suspended,
        manifest_path,
        notes: Vec::new(),
        open_asks,
        last_note,
        active_personas: personas_engine::active_persona_cap::active_persona_headroom(pool)?,
    }))
}

// ---------------------------------------------------------------------------
// The Tauri command (adapter)
// ---------------------------------------------------------------------------

/// Adopt an App Master for a registered project. The UI door onto the same
/// operation the `/dev-tools/app-master/adopt` bridge route exposes.
#[tauri::command]
pub async fn adopt_app_master(
    state: State<'_, Arc<AppState>>,
    input: AdoptAppMasterInput,
) -> Result<AppMasterAdoption, AppError> {
    require_auth(&state).await?;
    let db = state.db.clone();
    // The handle is bound and awaited, so a panic inside the blocking task
    // reaches the caller as a `JoinError` turned into an `AppError` — not as a
    // task that vanishes while the command reports success.
    let handle = tokio::task::spawn_blocking(move || adopt(&db, &input));
    handle
        .await
        .map_err(|e| AppError::Internal(format!("adopt_app_master: task failed: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::brain::test_home::TestHome;
    use crate::db::models::CreateRecipeInput;
    use personas_db::init_test_db;

    /// A minimal but VALID v3 recipe payload — four-field description, three
    /// activities, one connector type, a self-paced recommendation. Seeded
    /// through the recipes repo so the row is the production shape.
    fn seed_recipe(pool: &DbPool, slug: &str, title: &str) {
        let payload = serde_json::json!({
            "id": format!("rec-{slug}"),
            "slug": slug,
            "title": title,
            "status": "draft",
            "domain": "software_engineering",
            "description": {
                "need": "The codebase drifts from its own conventions between reviews.",
                "input": "The repository and its context map.",
                "coreAction": "Read the area, judge it against the repo's own standard.",
                "output": "A written verdict with file-level evidence."
            },
            "activities": [
                {"id": "a1", "label": "Read the area", "kind": "observe"},
                {"id": "a2", "label": "Judge against the standard", "kind": "decide"},
                {"id": "a3", "label": "Write the verdict", "kind": "deliver"}
            ],
            "guidance": "Judge what is there, not what you would have written.",
            "connectorTypes": ["source_control"],
            "recommendedTrigger": {"kind": "self_paced", "rationale": "No external clock."}
        });
        recipes_repo::create(
            pool,
            CreateRecipeInput {
                credential_id: None,
                use_case_id: None,
                name: title.to_string(),
                description: None,
                category: None,
                prompt_template: payload.to_string(),
                input_schema: None,
                output_contract: None,
                tool_requirements: None,
                credential_requirements: None,
                model_preference: None,
                sample_inputs: None,
                tags: None,
                icon: None,
                color: None,
                source_template_id: None,
                source_use_case_id: None,
                source_use_case_name: None,
                source_version: None,
            },
        )
        .expect("seed recipe");
    }

    fn seed_project(pool: &DbPool) -> DevProject {
        projects_repo::create_project(
            pool,
            "demo-app",
            "/tmp/demo-app",
            Some("A demo project"),
            None,
            None,
            None,
            None,
        )
        .expect("seed project")
    }

    fn request(project: &str, slugs: &[(&str, Option<u8>)]) -> AdoptAppMasterInput {
        AdoptAppMasterInput {
            project: project.to_string(),
            recipes: slugs
                .iter()
                .map(|(s, p)| AppMasterRecipeRequest {
                    slug: (*s).to_string(),
                    priority: *p,
                })
                .collect(),
            model: None,
            max_concurrent: None,
            scope_rung: None,
            enabled: None,
            name: None,
        }
    }

    #[test]
    /// The Fleet Monitor groups its grid by `personas.home_team_id`, and this
    /// door set none — so every persona an Architect adopted landed in the
    /// ungrouped tray beside every other agent, and the operator could not
    /// tell an app-specific agent from a cross-project one. Measured
    /// 2026-09-09: 14 personas on the install, 0 with a home team.
    #[test]
    fn adopting_an_app_master_files_it_under_its_project_team() {
        let _home = TestHome::new("app_master_adopt_team");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "accepted-idea-delivery", "Accepted idea delivery");

        let adopted = adopt(
            &pool,
            &request(&project.id, &[("accepted-idea-delivery", None)]),
        )
        .expect("adoption");

        let persona = crate::db::repos::core::personas::get_by_id(&pool, &adopted.persona_id)
            .expect("persona");
        let team_id = persona
            .home_team_id
            .expect("the adopted App Master has a home team");
        let team = crate::db::repos::resources::teams::get_by_id(&pool, &team_id)
            .expect("the home team exists");
        assert!(
            team.name.contains(&project.name),
            "the team is named for the project, got `{}`",
            team.name
        );
        assert_eq!(
            team.project_id.as_deref(),
            Some(project.id.as_str()),
            "a project team carries its project"
        );

        // Re-adopting must not strand the persona or mint a second team: the
        // door is called again every time a rung or a recipe list changes.
        let again = adopt(
            &pool,
            &request(&project.id, &[("accepted-idea-delivery", None)]),
        )
        .expect("second adoption");
        let persona2 =
            crate::db::repos::core::personas::get_by_id(&pool, &again.persona_id).expect("persona");
        assert_eq!(
            persona2.home_team_id.as_deref(),
            Some(team_id.as_str()),
            "re-adoption keeps the same home"
        );
    }

    fn adopting_twice_creates_one_persona_and_no_duplicate_charters() {
        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock rather than a
        // fourth private mutex over the same global.
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");
        seed_recipe(&pool, "accepted-idea-delivery", "Accepted idea delivery");

        let body = request(
            &project.id,
            &[
                ("codebase-architecture-review", Some(2)),
                ("accepted-idea-delivery", None),
            ],
        );
        let first = adopt(&pool, &body).expect("first adoption");
        assert!(first.created, "the first call creates the persona");
        assert_eq!(first.charters.len(), 2);
        assert!(first.charters.iter().all(|c| c.created));

        let second = adopt(&pool, &body).expect("second adoption");
        assert!(!second.created, "the second call updates in place");
        assert_eq!(second.persona_id, first.persona_id);
        assert_eq!(second.charters.len(), 2);
        assert!(
            second.charters.iter().all(|c| !c.created),
            "no charter is minted twice"
        );

        let held = resp_repo::list_by_persona(&pool, &first.persona_id, true).expect("charters");
        assert_eq!(held.len(), 2, "still exactly two rows");
        assert!(
            held.iter().all(|r| r.cadence.attention_enabled),
            "every charter is enrolled in the attention loop"
        );
        assert!(
            held.iter()
                .all(|r| r.connectors.iter().any(|c| c == CODEBASE_CONNECTOR)),
            "every charter reaches the codebase connector"
        );
        let priorities: Vec<Option<u8>> = held.iter().map(|r| r.spec.priority).collect();
        assert!(priorities.contains(&Some(2)));
        assert!(priorities.contains(&None));
    }

    #[test]
    fn a_slug_dropped_from_the_request_is_suspended_not_deleted() {
        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock rather than a
        // fourth private mutex over the same global.
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");
        seed_recipe(&pool, "accepted-idea-delivery", "Accepted idea delivery");

        adopt(
            &pool,
            &request(
                &project.id,
                &[
                    ("codebase-architecture-review", None),
                    ("accepted-idea-delivery", None),
                ],
            ),
        )
        .expect("first adoption");

        let second = adopt(
            &pool,
            &request(&project.id, &[("codebase-architecture-review", None)]),
        )
        .expect("second adoption");
        assert_eq!(second.suspended, vec!["accepted-idea-delivery".to_string()]);

        let held = resp_repo::list_by_persona(&pool, &second.persona_id, true).expect("charters");
        assert_eq!(held.len(), 2, "the dropped charter still exists");
        let dropped = held
            .iter()
            .find(|r| {
                r.spec.recipe_ref.as_ref().map(|rr| rr.slug.as_str())
                    == Some("accepted-idea-delivery")
            })
            .expect("the dropped charter row");
        assert_eq!(dropped.status, ResponsibilityStatus::Suspended.as_str());
    }

    #[test]
    fn an_unknown_slug_refuses_the_request_and_writes_nothing() {
        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock rather than a
        // fourth private mutex over the same global.
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");

        let err = adopt(
            &pool,
            &request(
                &project.id,
                &[
                    ("codebase-architecture-review", None),
                    ("no-such-recipe", None),
                ],
            ),
        )
        .expect_err("an unknown slug is refused");
        assert!(
            matches!(err, AppError::NotFound(ref m) if m.contains("no-such-recipe")),
            "the refusal names the unknown slug: {err}"
        );
        assert!(
            personas_repo::list_by_dev_project(&pool, &project.id)
                .expect("personas")
                .is_empty(),
            "nothing was written"
        );
    }

    #[test]
    fn a_priority_outside_one_to_five_is_refused() {
        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock rather than a
        // fourth private mutex over the same global.
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");

        for bad in [0u8, 6, 200] {
            let err = adopt(
                &pool,
                &request(&project.id, &[("codebase-architecture-review", Some(bad))]),
            )
            .expect_err("out-of-range priority is refused");
            assert!(
                matches!(err, AppError::Validation(_)),
                "priority {bad} is a validation refusal, got {err}"
            );
        }
        assert!(
            personas_repo::list_by_dev_project(&pool, &project.id)
                .expect("personas")
                .is_empty(),
            "nothing was written"
        );
    }

    #[test]
    fn the_mandate_gate_opens_at_rung_two_and_stays_shut_at_rung_zero() {
        use personas_engine::autonomy::{mandate_permits_for, Action};

        // `adopt` seeds the persona's manifest on disk, and the brain root is
        // a process-global env var — take the one shared lock rather than a
        // fourth private mutex over the same global.
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");

        let mut body = request(&project.id, &[("codebase-architecture-review", None)]);
        body.scope_rung = Some(RUNG_BRANCH);
        adopt(&pool, &body).expect("rung-2 adoption");
        assert!(
            mandate_permits_for(&pool, &project.id, Action::AttentionLoop).is_ok(),
            "the attention loop is permitted at rung 2"
        );

        body.scope_rung = Some(RUNG_READ);
        adopt(&pool, &body).expect("rung-0 re-adoption");
        assert!(
            mandate_permits_for(&pool, &project.id, Action::AttentionLoop).is_err(),
            "the attention loop is refused at rung 0"
        );
    }

    /// G48: the maintenance recipe rides the codex CLI on its own model, and
    /// the door's model stamp does not overwrite it. Every other slug is
    /// untouched.
    #[test]
    fn the_codebase_stewardship_slug_is_stamped_onto_the_codex_lane() {
        let mut spec = crate::db::models::ResponsibilitySpec::default();
        spec.model_override = Some(personas_core::model_ids::OPUS_CURRENT.to_string());
        apply_worker_engine("accepted-idea-delivery", &mut spec);
        assert_eq!(spec.worker_engine, None);
        assert_eq!(
            spec.model_override.as_deref(),
            Some(personas_core::model_ids::OPUS_CURRENT)
        );
        apply_worker_engine(CODEX_LANE_RECIPE_SLUG, &mut spec);
        assert_eq!(spec.worker_engine.as_deref(), Some(WORKER_ENGINE_CODEX));
        assert_eq!(
            spec.model_override.as_deref(),
            Some(CODEX_LANE_DEFAULT_MODEL)
        );
    }

    /// The owner's decision of 2026-09-09: the App Master merges. Rung 3 is
    /// grantable, the manifest law says so in the holder's own words, and rung
    /// 4 still clamps to the ceiling with the clamp on record.
    #[test]
    fn rung_three_is_grantable_and_the_law_names_it_while_rung_four_clamps() {
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");

        let mut body = request(&project.id, &[("codebase-architecture-review", None)]);
        body.scope_rung = Some(personas_engine::app_master::RUNG_MERGE);
        let done = adopt(&pool, &body).expect("rung-3 adoption");
        assert!(
            !done.notes.iter().any(|n| n.contains("clamped")),
            "a rung-3 grant is not clamped: {:?}",
            done.notes
        );
        // The mandate lives on the charters, read through the same door the
        // autonomy gate uses — not a settings row of its own.
        let stored =
            personas_engine::responsibility::mandate_for_project_or_none(&pool, &project.id)
                .expect("the project holds a mandate after adoption");
        assert_eq!(
            stored.mandate.scope_rung,
            personas_engine::app_master::RUNG_MERGE,
            "the mandate carries rung 3"
        );
        let law = render_mandate_law("demo-app", &stored.mandate);
        assert!(law.contains("Rung 3 (merge)"), "{law}");
        assert!(law.contains("do not ask who merges"), "{law}");
        // 2026-09-15: three App Masters parked green branches for "the delivery
        // charter" to merge — the rung is the persona's, across every charter.
        assert!(law.contains("across EVERY charter you hold"), "{law}");
        assert!(!law.contains("a human merges"), "{law}");
        assert!(
            law.contains("Rung 4 (change the gates) is never granted"),
            "{law}"
        );

        body.scope_rung = Some(4);
        let clamped = adopt(&pool, &body).expect("rung-4 request");
        assert!(
            clamped.notes.iter().any(|n| n.contains("clamped to 3")),
            "rung 4 clamps to the ceiling, on record: {:?}",
            clamped.notes
        );
    }

    #[test]
    fn an_unknown_model_is_refused_and_a_tier_slug_resolves() {
        assert_eq!(
            resolve_model_id(None).expect("default"),
            personas_core::model_ids::OPUS_CURRENT
        );
        assert_eq!(
            resolve_model_id(Some("sonnet")).expect("slug"),
            personas_core::model_ids::SONNET_CURRENT
        );
        assert_eq!(
            resolve_model_id(Some("claude-something-1")).expect("full id"),
            "claude-something-1"
        );
        assert!(resolve_model_id(Some("gpt-5")).is_err());
    }

    #[test]
    fn the_mandate_law_quotes_the_engines_own_forbidden_class_wording() {
        let law = render_mandate_law("demo-app", &Mandate::default());
        assert!(law.contains("which of my objectives can I move this cycle"));
        assert!(law.contains("Rung 2 (open branch/PR)"));
        for class in ALL_FORBIDDEN_CLASSES {
            assert!(
                law.contains(forbidden_class_line(class).trim_start_matches("- ").trim()),
                "the law lists {}",
                class.as_str()
            );
        }
        assert!(
            !law.lines().any(|l| l.trim_start().starts_with("# ")),
            "a law body may not introduce a heading"
        );
    }

    // -- G17: the app-wide concurrency cap, at this door --------------------

    /// Fill every slot the machine has: `cap` DISTINCT personas each holding a
    /// live execution. That is what "full" means since 2026-09-08 — a roster of
    /// idle personas, however large, occupies nothing.
    fn fill_machine_to_cap(pool: &DbPool) {
        let cap = personas_db::settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT;
        for i in 0..cap {
            let p = personas_repo::create(
                pool,
                CreatePersonaInput {
                    name: format!("filler-{i}"),
                    system_prompt: "You are a filler persona.".to_string(),
                    enabled: Some(true),
                    lifecycle: Some("active".to_string()),
                    description: None,
                    structured_prompt: None,
                    icon: None,
                    color: None,
                    max_concurrent: None,
                    timeout_ms: None,
                    model_profile: None,
                    max_budget_usd: None,
                    max_turns: None,
                    design_context: None,
                    notification_channels: None,
                    project_id: None,
                },
            )
            .expect("filler persona");
            personas_db::repos::execution::executions::create(pool, &p.id, None, None, None, None)
                .expect("filler execution");
        }
        assert!(
            personas_engine::active_persona_cap::active_persona_headroom(pool)
                .unwrap()
                .is_full(),
            "every slot is taken"
        );
    }

    /// The behaviour this door had until 2026-09-08, inverted.
    ///
    /// It used to refuse an enabled adoption once the ENABLED ROSTER reached
    /// `max_active_personas`, which made the cap an organisation-size limit and
    /// is what stopped the Grand Simulation's Architect from giving its six
    /// projects six App Masters. An adoption is now never refused for capacity:
    /// the persona is created, switched on as asked, and the attention loop
    /// defers its first wake until the machine has a slot.
    #[test]
    fn adopting_an_enabled_app_master_on_a_full_machine_is_allowed() {
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");
        fill_machine_to_cap(&pool);

        let mut body = request(&project.id, &[("codebase-architecture-review", Some(2))]);
        body.enabled = Some(true);
        let adoption = adopt(&pool, &body).expect("capacity never refuses an adoption");
        assert!(adoption.created);

        let persona = personas_repo::get_by_id(&pool, &adoption.persona_id).unwrap();
        assert!(
            persona.enabled,
            "switched ON as asked — the cap does not ration the roster"
        );
        assert!(
            adoption.active_personas.is_full(),
            "and the response still reports the machine is full, honestly"
        );
    }

    /// A large roster is not a full machine. Twenty enabled personas doing
    /// nothing leave every slot free.
    #[test]
    fn a_large_idle_roster_leaves_the_machine_empty() {
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");
        for i in 0..20 {
            personas_repo::create(
                &pool,
                CreatePersonaInput {
                    name: format!("idle-{i}"),
                    system_prompt: "You are an idle persona.".to_string(),
                    enabled: Some(true),
                    lifecycle: Some("active".to_string()),
                    description: None,
                    structured_prompt: None,
                    icon: None,
                    color: None,
                    max_concurrent: None,
                    timeout_ms: None,
                    model_profile: None,
                    max_budget_usd: None,
                    max_turns: None,
                    design_context: None,
                    notification_channels: None,
                    project_id: None,
                },
            )
            .unwrap();
        }

        let mut body = request(&project.id, &[("codebase-architecture-review", Some(2))]);
        body.enabled = Some(true);
        let adoption = adopt(&pool, &body).expect("adopted");
        assert_eq!(
            adoption.active_personas.running, 0,
            "twenty-one personas exist and none is running"
        );
        assert_eq!(
            adoption.active_personas.free(),
            personas_db::settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT
        );
    }

    /// The state route reports the CONCURRENCY figure, so a headless caller
    /// reading `GET /dev-tools/app-master/{project}` sees how busy the machine
    /// is — not how many personas exist.
    #[test]
    fn the_state_route_reports_the_running_count_not_the_roster() {
        let _home = TestHome::new("app_master_adopt");
        let pool = init_test_db().expect("test db");
        let project = seed_project(&pool);
        seed_recipe(&pool, "codebase-architecture-review", "Architecture review");

        let mut body = request(&project.id, &[("codebase-architecture-review", Some(2))]);
        body.enabled = Some(true);
        let adoption = adopt(&pool, &body).expect("adopted");

        let state = current(&pool, &project.id).unwrap().expect("an adoption");
        assert_eq!(
            state.active_personas.running, 0,
            "adopted and enabled, but it has not started anything yet"
        );

        personas_db::repos::execution::executions::create(
            &pool,
            &adoption.persona_id,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let state = current(&pool, &project.id).unwrap().expect("an adoption");
        assert_eq!(state.active_personas.running, 1, "now it holds a slot");
        assert_eq!(
            state.active_personas.cap,
            personas_db::settings_keys::MAX_ACTIVE_PERSONAS_DEFAULT
        );
        assert_eq!(state.active_personas.free(), 9);
    }
}
