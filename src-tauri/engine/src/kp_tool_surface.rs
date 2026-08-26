//! kp-bridge requested surface — the allowed-tool **and allowed-connector**
//! constraint a kp hire carries.
//!
//! # Why this exists
//!
//! A kp hire request names the surface it wants: `spec.connectors` is
//! typically `["github"]` for an App master. The one-shot build's design pass
//! is free-running though — it reads the intent and invents whatever tool
//! vocabulary it likes, and on the 2026-08-24 live bench two of five real
//! builds came back carrying `text_analysis`, `data_processing`,
//! `ai_generation`, `code_analysis` and `execute_sql`, none of which the
//! request asked for and none of which the platform recognises as a built-in.
//!
//! The verification gate (`build_session::oneshot::evaluate_promote_gate`)
//! then did exactly its job: those tools were *reported as available* and
//! never actually called, so it counted them `unverified` and HELD promotion.
//! The gate was right. The build was over-provisioning.
//!
//! The fix is subtractive and lives in data, not in prompt wording: a kp hire
//! stamps what it asked for onto [`KpLink`], and the build's two IR-consuming
//! chokepoints — the verification pass and the promote-time attach — run the
//! IR through [`constrain_agent_ir`] first. Entries outside the requested
//! surface are dropped before they can be counted, so the gate exercises a
//! small, real surface instead of holding on an invented one.
//!
//! # Connectors, and why they came second (2026-08-26)
//!
//! The 2026-08-24 pass deliberately stopped at tools and left
//! `required_connectors` alone — the bench evidence named tools, and
//! connectors additionally drive credential injection, connector readiness and
//! `setup_detail`. Bench sweep #23 (2026-08-26, the first hire on the `ascent`
//! repo) then produced the connector-shaped version of the same defect: the
//! codebase mentions GCP, so the design pass attached a **Google** connector,
//! and the build died outright on
//!
//! ```text
//! Validation error: Google OAuth client credentials are missing.
//! Set one of: GCP_DESKTOP_CLIENT_ID/… — the hire only asked for ["github"].
//! ```
//!
//! An over-provisioned *tool* costs a held promotion. An over-provisioned
//! *connector* costs more, because the connector is what carries a **credential
//! requirement** into every downstream pass: `run_tool_tests`' connector-driven
//! injection walks `required_connectors` and reaches the OAuth resolvers per
//! connector, and promote resolves the same list into `credentialLinks`,
//! `setup_status` and `setup_detail`.
//!
//! One honest limit on that post-mortem, so nobody reads more into this module
//! than it earns: the frame that *propagated* sweep #23's string was never
//! pinned down (most of the build path `.ok()`s the OAuth resolver's error, and
//! the one chain that propagates it sits behind `PERSONAS_SCRIPTED_TOOL_TESTS`,
//! set nowhere in the repo). The fix is not "we found the `?`" — it is that a
//! connector the hire never requested has no business being in the IR on any of
//! those paths.
//!
//! So the same rule now applies to `required_connectors` — and to the
//! `service_flow` steps
//! [`AgentIr::effective_connectors_json`] falls back to when
//! `required_connectors` is empty, which would otherwise re-mint the connector
//! the trim had just removed.
//!
//! # The allowed set — tools
//!
//! A tool survives when **any** of these holds:
//!
//! 1. It belongs to a **requested connector** — its name or its
//!    `requires_credential_type` matches one of `spec.connectors`, using the
//!    same bidirectional-substring rule the promote path's
//!    `infer_credential_type` uses so the two agree on what "a github tool" is.
//! 2. It is a **credential-free transport** ([`TRANSPORT_TOOLS`]). These own no
//!    credential — the connector behind them does — and the verification gate
//!    exercises them with a real curl, so they can never mint a false green.
//!    Stripping them would only cut the persona's route to the connector it
//!    *was* granted.
//! 3. It is on the **hire baseline** ([`BASELINE_TOOLS`]): `file_read` /
//!    `file_write`. An App master is hired to read and change an application's
//!    own source; that is the one thing it cannot do without. Both are on the
//!    gate's `PLATFORM_BUILTIN_TOOLS` list, so allowing them costs the gate
//!    nothing — they pass on a code-authored claim, not a model-authored one.
//! 4. It is a **command runner** ([`COMMAND_TOOLS`]) *and* the hire's mandate
//!    named approval-gate commands (`appMaster.mandate.approvalGates`, e.g.
//!    `npm run test:unit`). Those gates are literally shell commands the App
//!    master must run before it may propose a diff — without a runner the
//!    mandate is unenforceable. When the mandate names no gates, no runner is
//!    allowed.
//!
//! Everything else is dropped.
//!
//! # The allowed set — connectors
//!
//! A connector (`agent_ir.required_connectors[]`, and the `service_flow` steps
//! that stand in for it) survives when **either**:
//!
//! 1. it belongs to a **requested connector** — its name or its declared
//!    `service_type` matches one of `spec.connectors`, by the same
//!    [`matches_connector`] rule the tool pass uses, so "a github connector"
//!    and "a github tool" mean the same thing; or
//! 2. it **binds no user credential**, and therefore cannot reach the
//!    credential/OAuth validation this constraint exists to keep off a hire's
//!    path. Two sources, unioned: the code-authored [`BASELINE_CONNECTORS`]
//!    (platform-internal names the backend recognises itself), and whatever
//!    the caller resolved out of the live connector catalog as non-`Credential`
//!    class — `codebase`, `local_drive`, `twin`, … See
//!    [`KpToolSurface::with_credential_free_connectors`]. A name the catalog
//!    does not know is treated as credential-bearing and dropped: fail closed,
//!    because a model-invented connector name is exactly the case that
//!    produced sweep #23.
//!
//! # One runner, not five (2026-08-26)
//!
//! Rule 4 admits a command runner, and `COMMAND_TOOLS` lists five spellings of
//! it. Sweep #23's kp-default hire had the design pass emit two — `run_command`
//! *and* `bash` — and the verification pass ran its commands through one of
//! them. The gate counted the other "reported as available but never actually
//! called" and held the build: the same over-provisioning P6d removed, one level
//! down. The build was not asking for two capabilities; it was spelling one
//! twice.
//!
//! So exactly one runner survives — see [`canonical_command_runner`], which
//! decides across tools and `tool_hints` together and picks by [`COMMAND_TOOLS`]
//! order. No other allowed family gets this treatment, and none should invent
//! one: [`BASELINE_TOOLS`] are on `PLATFORM_BUILTIN_TOOLS` and pass on a
//! code-authored claim, and [`TRANSPORT_TOOLS`] are each exercised with a real
//! curl, so neither family can leave a sibling uncalled.
//!
//! # What this deliberately does NOT do
//!
//! * It never **adds** anything. The pass is purely subtractive: an allowed
//!   name that the design pass did not emit stays absent — including the
//!   canonical runner, which is only ever *chosen from* what the build named.
//! * It does nothing at all without a [`KpLink`]. A build that did not
//!   originate from a kp hire is untouched, by construction: the caller has no
//!   surface to hand this function.

use personas_core::models::{parse_design_context, KpLink};
use personas_db::models::agent_ir::{AgentIr, AgentIrConnector, AgentIrTool, AgentIrUseCase};

// ============================================================================
// The policy lists
// ============================================================================

/// Credential-free transport tools — conduits, not credential subjects.
///
/// Mirrors `commands::design::build_sessions::GENERIC_TOOL_NAMES`, which is the
/// promote path's own copy of the same idea (it uses the list to fall a generic
/// tool back onto the agent's primary connector). Kept as a separate list
/// rather than shared because this one is a *policy* about what a kp hire may
/// attach, not a mechanism — but the two are meant to name the same tools, so
/// change them together.
pub const TRANSPORT_TOOLS: &[&str] = &[
    "http_request",
    "http",
    "api_call",
    "rest_api",
    "api_request",
    "fetch",
    "curl",
    "request",
];

/// The hire baseline: reading and writing the application's own source.
///
/// Both names are on `build_session::tool_tests::PLATFORM_BUILTIN_TOOLS`, so
/// the verification gate counts them as passes on the strength of a
/// code-authored allow-list — no external service, no credential, nothing a
/// curl could exercise. Allowing them therefore cannot re-create the hold this
/// module exists to remove.
pub const BASELINE_TOOLS: &[&str] = &["file_read", "file_write"];

/// Command runners — allowed only when the mandate names approval gates, and
/// then **only one of them** (see [`canonical_command_runner`]).
///
/// **Order is load-bearing.** These are aliases for one capability, and the
/// earliest surviving entry is the one kept. `run_command` leads on the only
/// direct evidence there is: in bench sweep #23 the design pass attached both
/// `run_command` and `bash`, and the verification pass exercised `run_command`
/// and left `bash` uncalled — which is what held the build.
///
/// Recorded because it cuts the other way and the next reader deserves it:
/// `connector_readiness::is_native_cli_capability` — also code-authored — lists
/// `bash` and `shell` as capabilities Claude Code provides natively and does
/// **not** list `run_command`. Neither name is on
/// `tool_tests::PLATFORM_BUILTIN_TOOLS`, so neither gets a free pass from the
/// gate. The two lists disagree about which spelling is real; this order
/// follows what was observed to actually run, not what a list asserts. If a
/// later sweep shows the CLI exercising `bash` instead, reorder here — that is
/// the whole reason the preference is a list order and not an `if`.
pub const COMMAND_TOOLS: &[&str] = &[
    "run_command",
    "execute_command",
    "shell_command",
    "bash",
    "shell",
];

/// Is this name one of the command-runner aliases? Exact match — a
/// `github_run_command` is a github tool, not a runner.
fn is_command_tool(lower: &str) -> bool {
    COMMAND_TOOLS.contains(&lower)
}

/// Platform-internal connector names that never bind a user credential.
///
/// Mirrors `build_session::tool_tests::PLATFORM_CONNECTORS`, which is the
/// verification gate's own copy of the same idea (it uses the list to decide
/// which connectors are the backend's rather than the user's). Kept separate
/// for the same reason as [`TRANSPORT_TOOLS`] — this one is a *policy* about
/// what a kp hire may declare, not a mechanism — but the two are meant to name
/// the same connectors, so change them together.
///
/// Matched EXACTLY, deliberately: the gate's list carries the same warning,
/// because a prefix test let a model-authored `personas_gmail` mint itself an
/// auto-pass.
pub const BASELINE_CONNECTORS: &[&str] = &[
    "personas_database",
    "personas_messages",
    "personas_vector_db",
    "messaging",
    "database",
    "builtin",
];

// ============================================================================
// The surface
// ============================================================================

/// What a kp hire asked for, as the build's tool constraint.
///
/// Built from the [`KpLink`] the approval executor stamped onto the persona's
/// `design_context` at hire time — so it is durable, survives the build, and is
/// readable at every point the IR's tools are consumed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KpToolSurface {
    /// `spec.connectors` from the hire request, verbatim (e.g. `["github"]`).
    pub requested_connectors: Vec<String>,
    /// The mandate named approval-gate commands, so a command runner is part
    /// of the mandated surface.
    pub runs_commands: bool,
    /// Connector names that bind no user credential, resolved by the caller
    /// from the live connector catalog (`ConnectorClass` other than
    /// `Credential`: `codebase`, `local_drive`, `twin`, …).
    ///
    /// Not part of what the hire *requested* — part of what the constraint has
    /// no reason to take away. This module is pure and the catalog lives in
    /// SQLite, so the DB glue fills it via
    /// [`Self::with_credential_free_connectors`]. Empty is the safe default:
    /// the constraint then falls back to [`BASELINE_CONNECTORS`] alone and
    /// drops more, never less.
    pub credential_free_connectors: Vec<String>,
}

impl KpToolSurface {
    /// Read the surface off the typed kp link.
    pub fn from_kp_link(link: &KpLink) -> Self {
        Self {
            requested_connectors: link
                .requested_connectors
                .iter()
                .map(|c| c.trim().to_lowercase())
                .filter(|c| !c.is_empty())
                .collect(),
            runs_commands: link.runs_commands,
            credential_free_connectors: Vec::new(),
        }
    }

    /// Add the catalog-resolved credential-free connector names.
    ///
    /// Builder-shaped because [`Self::from_design_context`] is the parse step
    /// and this is the DB step: the caller that has a pool attaches it, and a
    /// caller that does not simply constrains harder.
    pub fn with_credential_free_connectors<I, S>(mut self, names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        self.credential_free_connectors = names
            .into_iter()
            .map(|n| n.as_ref().trim().to_lowercase())
            .filter(|n| !n.is_empty())
            .collect();
        self
    }

    /// Does this persona's `design_context` carry a kp hire's tool surface?
    ///
    /// `None` for **every** persona that was not hired through kp — which is
    /// what makes the constraint a no-op for ordinary builds: with no surface
    /// there is nothing to hand [`constrain_agent_ir`], so the IR is never
    /// touched. Kept here rather than at the call sites so that "which builds
    /// are constrained" is one testable predicate instead of two.
    pub fn from_design_context(design_context: Option<&str>) -> Option<Self> {
        parse_design_context(design_context)
            .kp_link
            .as_ref()
            .map(Self::from_kp_link)
    }

    /// Is `name` (with its optional declared credential type) inside the set?
    pub fn allows(&self, name: &str, requires_credential_type: Option<&str>) -> bool {
        let lower = name.trim().to_lowercase();
        if lower.is_empty() {
            // An unnamed tool is not a tool. Dropping it is the same call
            // `prepare_tool_actions` already makes.
            return false;
        }

        if BASELINE_TOOLS.contains(&lower.as_str()) || TRANSPORT_TOOLS.contains(&lower.as_str()) {
            return true;
        }
        if self.runs_commands && COMMAND_TOOLS.contains(&lower.as_str()) {
            return true;
        }

        let cred = requires_credential_type
            .map(|c| c.trim().to_lowercase())
            .filter(|c| !c.is_empty());

        self.requested_connectors
            .iter()
            .any(|connector| matches_connector(&lower, cred.as_deref(), connector))
    }

    /// Is this **connector** (with its optional declared `service_type`) inside
    /// the set?
    ///
    /// Same matching rule as [`Self::allows`] — connector name or credential
    /// type, bidirectional substring, short-name guard — over a different
    /// baseline: a connector is never "transport" and never a command runner,
    /// but it *is* allowed when it binds no user credential and so can never
    /// reach the credential validation this constraint protects.
    pub fn allows_connector(&self, name: &str, service_type: Option<&str>) -> bool {
        let lower = normalize_connector_name(name);
        if lower.is_empty() {
            // An unnamed connector is not a connector — and it is exactly what
            // `SetupKind::Misconfigured` exists to fail closed on downstream.
            return false;
        }

        if self.is_credential_free(&lower) {
            return true;
        }

        let service = service_type
            .map(normalize_connector_name)
            .filter(|s| !s.is_empty());
        if service
            .as_deref()
            .is_some_and(|s| self.is_credential_free(s))
        {
            return true;
        }

        self.requested_connectors
            .iter()
            .any(|connector| matches_connector(&lower, service.as_deref(), connector))
    }

    /// Does this connector name bind no user credential?
    fn is_credential_free(&self, lower: &str) -> bool {
        BASELINE_CONNECTORS.contains(&lower)
            || self.credential_free_connectors.iter().any(|c| c == lower)
    }
}

/// Fold a connector name to the form the rest of the pipeline uses.
///
/// `AgentIr::effective_connectors_json` derives a connector from a
/// `service_flow` step with exactly this normalization (`"Google Drive"` →
/// `google_drive`), so matching on anything else would let a flow step and the
/// connector it mints disagree about whether they were requested.
fn normalize_connector_name(raw: &str) -> String {
    raw.trim().to_lowercase().replace(' ', "_")
}

/// Which single command-runner alias this build gets to keep, if any.
///
/// `COMMAND_TOOLS` are five spellings of one capability. The design pass has no
/// reason to prefer one, and on bench sweep #23's kp-default hire it emitted two
/// — `run_command` and `bash`. The verification pass then ran the commands it
/// had to run through **one** of them, and the gate counted the other
/// "reported as available but never actually called", holding promotion. This is
/// the same shape as the over-provisioning P6d removed, one level down: the
/// build was not asking for two capabilities, it was spelling one twice.
///
/// So: scan every runner alias the build names — tools **and** `tool_hints`,
/// because `run_tool_tests` unions the hints into the set it tests — and return
/// the winner by [`COMMAND_TOOLS`] order. `None` when the mandate names no
/// approval gates (no runner is allowed at all) or the build named none.
fn canonical_command_runner(ir: &AgentIr, surface: &KpToolSurface) -> Option<String> {
    if !surface.runs_commands {
        return None;
    }
    let mut best: Option<usize> = None;
    let mut consider = |name: &str| {
        let lower = name.trim().to_lowercase();
        if let Some(idx) = COMMAND_TOOLS.iter().position(|c| *c == lower) {
            best = Some(best.map_or(idx, |b: usize| b.min(idx)));
        }
    };

    for tool in &ir.tools {
        consider(tool.name());
    }
    for uc in &ir.use_cases {
        if let AgentIrUseCase::Structured(d) = uc {
            for hint in d.tool_hints.iter().flatten() {
                consider(hint);
            }
        }
    }

    best.map(|idx| COMMAND_TOOLS[idx].to_string())
}

/// The connector a `service_flow` step names, if it names one.
///
/// Two shapes reach here. The current design prompt emits objects
/// (`{"connector_name": "...", "action_label": ..., "order": ...}`); legacy
/// payloads emit bare service strings, which is the shape
/// `effective_connectors_json` reads. A step that names nothing is left alone —
/// it declares no connector, so it cannot over-provision one.
fn flow_step_connector(step: &serde_json::Value) -> Option<String> {
    let raw = if let Some(s) = step.as_str() {
        s.to_string()
    } else {
        let mut found = None;
        for key in ["connector_name", "connector", "name", "service"] {
            if let Some(s) = step.get(key).and_then(|v| v.as_str()) {
                if !s.trim().is_empty() {
                    found = Some(s.to_string());
                    break;
                }
            }
        }
        found?
    };
    // The two names `effective_connectors_json` itself refuses to derive a
    // connector from. A step that mints no connector cannot over-provision
    // one, so it is not this pass's business.
    if FLOW_STEPS_WITHOUT_CONNECTORS.contains(&normalize_connector_name(&raw).as_str()) {
        return None;
    }
    Some(raw)
}

/// `service_flow` steps that name a platform capability rather than a
/// connector. Mirrors the two exclusions in
/// `AgentIr::effective_connectors_json`.
const FLOW_STEPS_WITHOUT_CONNECTORS: &[&str] = &["local_database", "in-app_messaging"];

/// Does this tool belong to `connector`?
///
/// Bidirectional substring, deliberately the same shape as the promote path's
/// `infer_credential_type` — `github_create_pr` and `create_github_issue` both
/// belong to `github`, and a tool that declared
/// `requires_credential_type: "github"` belongs to it outright. Connector names
/// shorter than three characters are matched only for equality: a two-letter
/// connector substring-matches almost anything and would wave the whole
/// over-provisioned set straight through.
fn matches_connector(tool_lower: &str, cred_lower: Option<&str>, connector_lower: &str) -> bool {
    if connector_lower.is_empty() {
        return false;
    }
    if connector_lower.len() < 3 {
        return tool_lower == connector_lower || cred_lower == Some(connector_lower);
    }
    if let Some(cred) = cred_lower {
        if cred.contains(connector_lower) || connector_lower.contains(cred) {
            return true;
        }
    }
    tool_lower.contains(connector_lower) || connector_lower.contains(tool_lower)
}

// ============================================================================
// The constraint pass
// ============================================================================

/// What [`constrain_agent_ir`] removed. Every entry is logged by the caller so
/// an over-provisioned build leaves a trail rather than silently shrinking.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ToolSurfaceTrim {
    /// `agent_ir.tools[]` entries dropped, by name.
    pub removed_tools: Vec<String>,
    /// `agent_ir.use_cases[].tool_hints[]` entries dropped, by name. Reported
    /// separately because the verification pass unions the hints into the tools
    /// it tests — a hint left behind would re-introduce the tool the gate then
    /// holds on.
    pub removed_tool_hints: Vec<String>,
    /// `agent_ir.required_connectors[]` entries dropped, by name. These are the
    /// expensive ones: a connector reaches credential injection and connector
    /// readiness, and an unrequested OAuth connector can fail the hire outright
    /// (bench sweep #23).
    pub removed_connectors: Vec<String>,
    /// Redundant command-runner aliases dropped, by name — everything but the
    /// one canonical runner. Reported separately from `removed_tools` because
    /// these were *inside* the requested surface: the hire is allowed a runner,
    /// it was allowed too many spellings of it. See
    /// [`canonical_command_runner`].
    pub removed_duplicate_runners: Vec<String>,
    /// `agent_ir.service_flow[]` steps dropped, by the connector they named.
    /// Reported separately because `effective_connectors_json` derives
    /// connectors from these when `required_connectors` is empty — a step left
    /// behind would re-mint the connector this pass had just removed.
    pub removed_flow_steps: Vec<String>,
}

impl ToolSurfaceTrim {
    /// Nothing was outside the allowed set.
    pub fn is_empty(&self) -> bool {
        self.removed_tools.is_empty()
            && self.removed_tool_hints.is_empty()
            && self.removed_connectors.is_empty()
            && self.removed_flow_steps.is_empty()
            && self.removed_duplicate_runners.is_empty()
    }

    /// Total entries dropped across every list.
    pub fn len(&self) -> usize {
        self.removed_tools.len()
            + self.removed_tool_hints.len()
            + self.removed_connectors.len()
            + self.removed_flow_steps.len()
            + self.removed_duplicate_runners.len()
    }

    /// Operator-readable lines for `setup_detail.notes`.
    ///
    /// Same shape as `DesignHygieneReport::notes()`: one flat list of "what the
    /// build had to change on your behalf". Three of the five lists are reported
    /// — a dropped *tool* outside the requested surface is invisible to the
    /// operator's setup decisions, while a dropped connector is precisely the
    /// thing that would otherwise show up as a credential blocker they are being
    /// asked to fix, and a dropped duplicate runner changes which spelling of
    /// "run a command" the promoted persona actually carries.
    pub fn notes(&self) -> Vec<String> {
        let mut out = Vec::with_capacity(
            self.removed_connectors.len()
                + self.removed_flow_steps.len()
                + self.removed_duplicate_runners.len(),
        );
        for name in &self.removed_duplicate_runners {
            out.push(format!(
                "kp hire: dropped duplicate command runner `{name}` — one runner is kept so the verification pass exercises what it counts"
            ));
        }
        for name in &self.removed_connectors {
            out.push(format!(
                "kp hire: dropped connector `{name}` — the hire request did not ask for it"
            ));
        }
        for name in &self.removed_flow_steps {
            out.push(format!(
                "kp hire: dropped service-flow step for `{name}` — the hire request did not ask for it"
            ));
        }
        out
    }
}

/// Constrain a kp hire's built IR to the surface the request asked for.
///
/// Subtractive only — see the module docs for the allowed sets. Returns what
/// was dropped so the caller can log, count and report it.
///
/// Order matters twice. Connectors are trimmed **before** `service_flow`, so a
/// build whose `required_connectors` the trim empties cannot fall back through
/// [`AgentIr::effective_connectors_json`] onto flow steps that name the
/// connector just removed. And the canonical command runner is decided **before**
/// anything is dropped, over tools and `tool_hints` together, so the two lists
/// cannot settle on different spellings.
pub fn constrain_agent_ir(ir: &mut AgentIr, surface: &KpToolSurface) -> ToolSurfaceTrim {
    let mut trim = ToolSurfaceTrim::default();
    let canonical_runner = canonical_command_runner(ir, surface);

    ir.required_connectors.retain(|connector| {
        let (name, service_type) = match connector {
            AgentIrConnector::Simple(s) => (s.clone(), None),
            AgentIrConnector::Structured(d) => (
                d.name.clone().unwrap_or_default(),
                d.service_type.as_deref(),
            ),
        };
        if surface.allows_connector(&name, service_type) {
            true
        } else {
            trim.removed_connectors.push(name);
            false
        }
    });

    ir.service_flow
        .retain(|step| match flow_step_connector(step) {
            None => true,
            Some(name) => {
                if surface.allows_connector(&name, None) {
                    true
                } else {
                    trim.removed_flow_steps.push(name);
                    false
                }
            }
        });

    ir.tools.retain(|tool| {
        let name = tool.name().to_string();
        let cred = match tool {
            AgentIrTool::Structured(d) => d.requires_credential_type.as_deref(),
            AgentIrTool::Simple(_) => None,
        };
        if !surface.allows(&name, cred) {
            trim.removed_tools.push(name);
            return false;
        }
        // Inside the surface, but is it the second spelling of a capability the
        // hire only has once? The gate counts every name it was told about.
        let lower = name.trim().to_lowercase();
        if is_command_tool(&lower) && canonical_runner.as_deref() != Some(lower.as_str()) {
            trim.removed_duplicate_runners.push(name);
            return false;
        }
        true
    });

    for uc in ir.use_cases.iter_mut() {
        let AgentIrUseCase::Structured(d) = uc else {
            continue;
        };
        let Some(hints) = d.tool_hints.as_mut() else {
            continue;
        };
        hints.retain(|hint| {
            if !surface.allows(hint, None) {
                trim.removed_tool_hints.push(hint.clone());
                return false;
            }
            // `run_tool_tests` unions hints into the set it tests, so a hint
            // naming the runner alias the tools just lost would put the
            // uncalled name straight back in front of the gate.
            let lower = hint.trim().to_lowercase();
            if is_command_tool(&lower) && canonical_runner.as_deref() != Some(lower.as_str()) {
                trim.removed_duplicate_runners.push(hint.clone());
                return false;
            }
            true
        });
        if hints.is_empty() {
            // `filter(|h| !h.is_empty())` is how the promote projection already
            // treats an empty hint list; normalize so a fully-trimmed list does
            // not persist as `[]`.
            d.tool_hints = None;
        }
    }

    trim
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use personas_db::models::agent_ir::{
        AgentIrConnectorData, AgentIrToolData, AgentIrUseCaseData,
    };

    fn github_surface() -> KpToolSurface {
        KpToolSurface {
            requested_connectors: vec!["github".to_string()],
            runs_commands: false,
            credential_free_connectors: Vec::new(),
        }
    }

    fn connector(name: &str, service_type: Option<&str>) -> AgentIrConnector {
        AgentIrConnector::Structured(AgentIrConnectorData {
            name: Some(name.to_string()),
            service_type: service_type.map(str::to_string),
            ..Default::default()
        })
    }

    fn simple(name: &str) -> AgentIrTool {
        AgentIrTool::Simple(name.to_string())
    }

    fn structured(name: &str, cred: Option<&str>) -> AgentIrTool {
        AgentIrTool::Structured(AgentIrToolData {
            name: Some(name.to_string()),
            requires_credential_type: cred.map(str::to_string),
            ..Default::default()
        })
    }

    fn uc_with_hints(hints: &[&str]) -> AgentIrUseCase {
        AgentIrUseCase::Structured(AgentIrUseCaseData {
            id: Some("uc_x".to_string()),
            title: Some("x".to_string()),
            tool_hints: Some(hints.iter().map(|h| h.to_string()).collect()),
            ..Default::default()
        })
    }

    /// The live-bench shape: connectors `["github"]`, and the design pass came
    /// back with five generic tools nobody asked for. Every survivor must be
    /// inside the allowed set.
    #[test]
    fn bench_shape_is_trimmed_to_the_requested_surface() {
        let mut ir = AgentIr {
            tools: vec![
                simple("github_create_pr"),
                simple("text_analysis"),
                simple("data_processing"),
                simple("ai_generation"),
                simple("code_analysis"),
                simple("execute_sql"),
                simple("file_read"),
            ],
            ..Default::default()
        };
        let surface = github_surface();
        let trim = constrain_agent_ir(&mut ir, &surface);

        let kept: Vec<String> = ir.tools.iter().map(|t| t.name().to_string()).collect();
        assert_eq!(kept, vec!["github_create_pr", "file_read"]);
        assert_eq!(
            trim.removed_tools,
            vec![
                "text_analysis",
                "data_processing",
                "ai_generation",
                "code_analysis",
                "execute_sql"
            ]
        );
        assert_eq!(trim.len(), 5);
        // The surviving set is a subset of what the surface allows.
        assert!(ir.tools.iter().all(|t| surface.allows(t.name(), None)));
    }

    #[test]
    fn connector_match_is_bidirectional_and_reads_credential_type() {
        let s = github_surface();
        assert!(s.allows("github_search_issues", None));
        assert!(s.allows("create_github_issue", None));
        assert!(s.allows("github", None));
        // Declared credential type wins even when the name says nothing.
        assert!(s.allows("open_pull_request", Some("github")));
        assert!(!s.allows("open_pull_request", None));
        assert!(!s.allows("slack_post_message", None));
    }

    #[test]
    fn transport_and_baseline_survive_an_empty_connector_list() {
        let s = KpToolSurface::default();
        assert!(s.allows("http_request", None));
        assert!(s.allows("file_read", None));
        assert!(s.allows("file_write", None));
        assert!(!s.allows("execute_sql", None));
        assert!(!s.allows("web_search", None));
    }

    #[test]
    fn command_runner_needs_the_mandate_to_name_gates() {
        let without = github_surface();
        assert!(!without.allows("run_command", None));

        let with = KpToolSurface {
            requested_connectors: vec!["github".to_string()],
            runs_commands: true,
            ..Default::default()
        };
        assert!(with.allows("run_command", None));
        assert!(with.allows("bash", None));
        // Still subtractive elsewhere.
        assert!(!with.allows("execute_sql", None));
    }

    #[test]
    fn tool_hints_are_trimmed_too_and_emptied_lists_normalize_to_none() {
        let mut ir = AgentIr {
            use_cases: vec![
                uc_with_hints(&["github_create_pr", "ai_generation"]),
                uc_with_hints(&["text_analysis"]),
                AgentIrUseCase::Simple("a plain use case".to_string()),
            ],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &github_surface());

        assert_eq!(
            trim.removed_tool_hints,
            vec!["ai_generation", "text_analysis"]
        );
        match &ir.use_cases[0] {
            AgentIrUseCase::Structured(d) => {
                assert_eq!(
                    d.tool_hints.as_deref(),
                    Some(&["github_create_pr".to_string()][..])
                )
            }
            _ => panic!("use case 0 should still be structured"),
        }
        match &ir.use_cases[1] {
            AgentIrUseCase::Structured(d) => assert!(d.tool_hints.is_none()),
            _ => panic!("use case 1 should still be structured"),
        }
    }

    #[test]
    fn an_already_matching_surface_is_left_alone() {
        let mut ir = AgentIr {
            tools: vec![
                structured("github_list_prs", Some("github")),
                simple("http_request"),
            ],
            use_cases: vec![uc_with_hints(&["github_list_prs"])],
            ..Default::default()
        };
        let before = ir.tools.len();
        let trim = constrain_agent_ir(&mut ir, &github_surface());

        assert!(trim.is_empty());
        assert_eq!(ir.tools.len(), before);
    }

    // ------------------------------------------------------------------
    // One canonical command runner (sweep #23, kp-default)
    // ------------------------------------------------------------------

    /// The live shape: the mandate named approval gates, so a runner is
    /// allowed — but the design pass emitted `run_command` AND `bash`, the
    /// verification pass exercised one, and the gate held on
    /// "1 tool(s) reported as available but never actually called (bash)".
    #[test]
    fn duplicate_command_runners_collapse_to_one() {
        let surface = KpToolSurface {
            requested_connectors: vec!["github".to_string()],
            runs_commands: true,
            ..Default::default()
        };
        let mut ir = AgentIr {
            tools: vec![
                simple("github_create_pr"),
                simple("run_command"),
                simple("bash"),
            ],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &surface);

        let kept: Vec<String> = ir.tools.iter().map(|t| t.name().to_string()).collect();
        assert_eq!(kept, vec!["github_create_pr", "run_command"]);
        assert_eq!(trim.removed_duplicate_runners, vec!["bash"]);
        // Not an out-of-surface drop — it was allowed, just redundant.
        assert!(trim.removed_tools.is_empty());
        assert_eq!(
            trim.notes(),
            vec![
                "kp hire: dropped duplicate command runner `bash` — one runner is kept so the verification pass exercises what it counts"
            ]
        );
    }

    /// No approval gates ⇒ rule 4 admits no runner at all, so neither alias
    /// survives and neither is reported as a *duplicate*.
    #[test]
    fn without_gates_neither_runner_survives() {
        let mut ir = AgentIr {
            tools: vec![simple("run_command"), simple("bash")],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &github_surface());

        assert!(ir.tools.is_empty());
        assert_eq!(trim.removed_tools, vec!["run_command", "bash"]);
        assert!(trim.removed_duplicate_runners.is_empty());
    }

    /// A single runner is left exactly as the build spelled it — the pass picks
    /// a winner, it never renames or injects one.
    #[test]
    fn a_lone_runner_is_kept_whatever_its_spelling() {
        for alias in ["bash", "shell", "execute_command", "shell_command"] {
            let surface = KpToolSurface {
                requested_connectors: vec!["github".to_string()],
                runs_commands: true,
                ..Default::default()
            };
            let mut ir = AgentIr {
                tools: vec![simple(alias)],
                ..Default::default()
            };
            let trim = constrain_agent_ir(&mut ir, &surface);
            assert_eq!(
                ir.tools.iter().map(|t| t.name()).collect::<Vec<_>>(),
                vec![alias],
                "a lone `{alias}` must survive"
            );
            assert!(trim.is_empty(), "a lone `{alias}` must not be trimmed");
        }
    }

    /// `run_tool_tests` unions `tool_hints` into the set it tests, so the hints
    /// have to agree with the tools about which spelling survived — including
    /// when the alias appears ONLY as a hint.
    #[test]
    fn tool_hints_agree_with_tools_on_the_canonical_runner() {
        let surface = KpToolSurface {
            requested_connectors: vec!["github".to_string()],
            runs_commands: true,
            ..Default::default()
        };
        let mut ir = AgentIr {
            tools: vec![simple("bash")],
            // `run_command` is named only here — it still wins on list order,
            // which is what stops the two lists disagreeing.
            use_cases: vec![uc_with_hints(&["run_command", "bash", "shell"])],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &surface);

        assert!(
            ir.tools.is_empty(),
            "the tool-side `bash` loses to the hint-side `run_command`"
        );
        match &ir.use_cases[0] {
            AgentIrUseCase::Structured(d) => assert_eq!(
                d.tool_hints.as_deref(),
                Some(&["run_command".to_string()][..])
            ),
            _ => panic!("use case 0 should still be structured"),
        }
        assert_eq!(
            trim.removed_duplicate_runners,
            vec!["bash", "bash", "shell"]
        );
    }

    // ------------------------------------------------------------------
    // Connectors (sweep #23)
    // ------------------------------------------------------------------

    /// The live shape of bench sweep #23: the hire asked for `["github"]`, the
    /// `ascent` codebase mentions GCP, and the design pass attached a Google
    /// connector on top. The build then died on
    /// `Google OAuth client credentials are missing`.
    #[test]
    fn sweep_23_shape_drops_the_unrequested_google_connector() {
        let mut ir = AgentIr {
            required_connectors: vec![
                connector("github", Some("github")),
                connector("google_calendar", Some("google")),
            ],
            tools: vec![simple("github_create_pr"), simple("file_read")],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &github_surface());

        let kept: Vec<&str> = ir
            .required_connectors
            .iter()
            .filter_map(|c| c.name())
            .collect();
        assert_eq!(kept, vec!["github"]);
        assert_eq!(trim.removed_connectors, vec!["google_calendar"]);
        // The tools the hire DID ask for are untouched by the connector pass.
        assert_eq!(ir.tools.len(), 2);
        // And the operator is told, in the surface they read setup from.
        assert_eq!(
            trim.notes(),
            vec![
                "kp hire: dropped connector `google_calendar` — the hire request did not ask for it"
            ]
        );
    }

    #[test]
    fn connector_match_reads_the_declared_service_type() {
        let s = github_surface();
        // Name says nothing; the declared service_type does.
        assert!(s.allows_connector("source_control", Some("github")));
        assert!(!s.allows_connector("source_control", None));
        // Bidirectional substring, same as the tool rule.
        assert!(s.allows_connector("github_enterprise", None));
        assert!(!s.allows_connector("gmail", None));
        assert!(!s.allows_connector("google_drive", Some("google")));
        // Blank names are dropped, not waved through.
        assert!(!s.allows_connector("", None));
        assert!(!s.allows_connector("   ", None));
    }

    #[test]
    fn credential_free_connectors_are_never_taken_away() {
        // Code-authored baseline (mirrors tool_tests::PLATFORM_CONNECTORS).
        let s = github_surface();
        assert!(s.allows_connector("personas_messages", None));
        assert!(s.allows_connector("database", None));
        // …and whatever the caller resolved out of the catalog as non-Credential.
        let with_catalog =
            github_surface().with_credential_free_connectors(["Codebase", "local_drive", "  "]);
        assert_eq!(
            with_catalog.credential_free_connectors,
            vec!["codebase", "local_drive"]
        );
        assert!(with_catalog.allows_connector("codebase", None));
        assert!(with_catalog.allows_connector("local_drive", None));
        // Fail closed on a name no catalog knows.
        assert!(!with_catalog.allows_connector("google_drive", None));
        // Exact match only — a model-authored `personas_gmail` mints nothing.
        assert!(!s.allows_connector("personas_gmail", None));
    }

    /// `AgentIr::effective_connectors_json` derives connectors from
    /// `service_flow` when `required_connectors` is empty — so a flow step left
    /// behind would re-mint exactly the connector the trim just removed.
    #[test]
    fn service_flow_cannot_re_mint_a_dropped_connector() {
        let mut ir = AgentIr {
            required_connectors: vec![connector("google_drive", Some("google"))],
            service_flow: vec![
                serde_json::json!("Google Drive"),
                serde_json::json!("Local Database"),
                serde_json::json!({"connector_name": "github", "action_label": "Open PR", "order": 0}),
                serde_json::json!({"connector_name": "gmail", "action_label": "Send mail", "order": 1}),
                serde_json::json!({"action_label": "Think", "order": 2}),
            ],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &github_surface());

        assert_eq!(trim.removed_connectors, vec!["google_drive"]);
        assert_eq!(trim.removed_flow_steps, vec!["Google Drive", "gmail"]);
        assert!(ir.required_connectors.is_empty());
        // The fallback now derives nothing outside the requested surface.
        let derived = ir.effective_connectors_json();
        let names: Vec<String> = derived
            .as_array()
            .expect("array")
            .iter()
            .filter_map(|c| c.get("name").and_then(|n| n.as_str()).map(str::to_string))
            .collect();
        assert!(
            !names.iter().any(|n| n.contains("google") || n == "gmail"),
            "the service_flow fallback re-minted a dropped connector: {names:?}"
        );
        // The connector-less step and the platform step both survive.
        assert_eq!(ir.service_flow.len(), 3);
    }

    #[test]
    fn short_connector_names_do_not_wave_everything_through() {
        let s = KpToolSurface {
            requested_connectors: vec!["x".to_string()],
            runs_commands: false,
            ..Default::default()
        };
        assert!(!s.allows("execute_sql", None));
        assert!(!s.allows("text_analysis", None));
        assert!(s.allows("x", None));
        // Same guard on the connector side.
        assert!(!s.allows_connector("google_drive", None));
        assert!(s.allows_connector("x", None));
    }

    #[test]
    fn unnamed_tools_are_dropped() {
        let mut ir = AgentIr {
            tools: vec![structured("", None), simple("   ")],
            ..Default::default()
        };
        let trim = constrain_agent_ir(&mut ir, &github_surface());
        assert!(ir.tools.is_empty());
        assert_eq!(trim.removed_tools.len(), 2);
    }

    /// The no-behavior-change guarantee for every build that is not a kp hire:
    /// no `kp_link` ⇒ no surface ⇒ nothing to constrain with.
    #[test]
    fn a_non_kp_build_has_no_surface_and_is_left_untouched() {
        for design_context in [
            None,
            Some(""),
            Some("{}"),
            Some(r#"{"summary":"an ordinary build"}"#),
            Some(r#"{"devProjectId":"proj-1","archetypeId":"guardian"}"#),
            Some("not json at all"),
        ] {
            assert!(
                KpToolSurface::from_design_context(design_context).is_none(),
                "design_context {design_context:?} must not produce a kp tool surface"
            );
        }

        // And the IR a non-kp build produces is byte-identical before/after,
        // because the call site never gets a surface to pass — connectors and
        // service flow included, which is what an ordinary Google-connector
        // build depends on.
        let ir = AgentIr {
            tools: vec![
                simple("text_analysis"),
                simple("execute_sql"),
                simple("slack_post_message"),
            ],
            required_connectors: vec![
                connector("google_calendar", Some("google")),
                connector("slack", None),
            ],
            service_flow: vec![
                serde_json::json!("Google Drive"),
                serde_json::json!({"connector_name": "slack", "order": 0}),
            ],
            use_cases: vec![uc_with_hints(&["ai_generation"])],
            ..Default::default()
        };
        let before = serde_json::to_string(&ir).expect("serialize");
        let mut after_ir = ir;
        if let Some(surface) = KpToolSurface::from_design_context(Some(r#"{"summary":"x"}"#)) {
            constrain_agent_ir(&mut after_ir, &surface);
        }
        assert_eq!(
            before,
            serde_json::to_string(&after_ir).expect("serialize"),
            "a build without a kp_link must not be modified"
        );
    }

    #[test]
    fn a_kp_build_yields_a_surface_from_its_design_context() {
        let surface = KpToolSurface::from_design_context(Some(
            r#"{"kpLink":{"jobId":"j1","jobTitle":"t","baseUrl":"http://x","reportToken":"tok","requestedConnectors":["github"],"runsCommands":true}}"#,
        ))
        .expect("kp_link must yield a surface");
        assert_eq!(surface.requested_connectors, vec!["github"]);
        assert!(surface.runs_commands);
    }

    #[test]
    fn from_kp_link_lowercases_and_drops_blanks() {
        let link = KpLink {
            job_id: "j1".into(),
            job_title: "t".into(),
            base_url: "http://localhost:3001".into(),
            report_token: "tok".into(),
            requested_connectors: vec!["GitHub".into(), "  ".into(), " Slack ".into()],
            runs_commands: true,
        };
        let s = KpToolSurface::from_kp_link(&link);
        assert_eq!(s.requested_connectors, vec!["github", "slack"]);
        assert!(s.runs_commands);
    }
}
