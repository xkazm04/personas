//! kp-bridge tool surface — the allowed-tool constraint a kp hire carries.
//!
//! # Why this exists
//!
//! A kp hire request names the tool surface it wants: `spec.connectors` is
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
//! stamps what it asked for onto [`KpLink`], and the build's two tool-consuming
//! chokepoints — the verification pass and the promote-time attach — run the
//! IR through [`constrain_agent_ir`] first. Tools outside the requested surface
//! are dropped before they can be counted, so the gate exercises a small, real
//! surface instead of holding on an invented one.
//!
//! # The allowed set
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
//! # What this deliberately does NOT do
//!
//! * It never **adds** a tool. The pass is purely subtractive: an allowed name
//!   that the design pass did not emit stays absent.
//! * It does not touch `required_connectors`. An over-provisioned *connector*
//!   can also produce an unverified entry, but the bench evidence named tools,
//!   and connectors additionally drive credential injection, connector
//!   readiness and `setup_detail`. Narrowing them is a separate, larger change.
//! * It does nothing at all without a [`KpLink`]. A build that did not
//!   originate from a kp hire is untouched, by construction: the caller has no
//!   surface to hand this function.

use personas_core::models::{parse_design_context, KpLink};
use personas_db::models::agent_ir::{AgentIr, AgentIrTool, AgentIrUseCase};

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

/// Command runners — allowed only when the mandate names approval gates.
pub const COMMAND_TOOLS: &[&str] = &[
    "run_command",
    "execute_command",
    "shell_command",
    "bash",
    "shell",
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
        }
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
}

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
}

impl ToolSurfaceTrim {
    /// Nothing was outside the allowed set.
    pub fn is_empty(&self) -> bool {
        self.removed_tools.is_empty() && self.removed_tool_hints.is_empty()
    }

    /// Total entries dropped across both lists.
    pub fn len(&self) -> usize {
        self.removed_tools.len() + self.removed_tool_hints.len()
    }
}

/// Constrain a kp hire's built IR to the tool surface the request asked for.
///
/// Subtractive only — see the module docs for the allowed set. Returns what was
/// dropped so the caller can log and count it.
pub fn constrain_agent_ir(ir: &mut AgentIr, surface: &KpToolSurface) -> ToolSurfaceTrim {
    let mut trim = ToolSurfaceTrim::default();

    ir.tools.retain(|tool| {
        let name = tool.name().to_string();
        let cred = match tool {
            AgentIrTool::Structured(d) => d.requires_credential_type.as_deref(),
            AgentIrTool::Simple(_) => None,
        };
        if surface.allows(&name, cred) {
            true
        } else {
            trim.removed_tools.push(name);
            false
        }
    });

    for uc in ir.use_cases.iter_mut() {
        let AgentIrUseCase::Structured(d) = uc else {
            continue;
        };
        let Some(hints) = d.tool_hints.as_mut() else {
            continue;
        };
        hints.retain(|hint| {
            if surface.allows(hint, None) {
                true
            } else {
                trim.removed_tool_hints.push(hint.clone());
                false
            }
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
    use personas_db::models::agent_ir::{AgentIrToolData, AgentIrUseCaseData};

    fn github_surface() -> KpToolSurface {
        KpToolSurface {
            requested_connectors: vec!["github".to_string()],
            runs_commands: false,
        }
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

    #[test]
    fn short_connector_names_do_not_wave_everything_through() {
        let s = KpToolSurface {
            requested_connectors: vec!["x".to_string()],
            runs_commands: false,
        };
        assert!(!s.allows("execute_sql", None));
        assert!(!s.allows("text_analysis", None));
        assert!(s.allows("x", None));
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
        // because the call site never gets a surface to pass.
        let ir = AgentIr {
            tools: vec![
                simple("text_analysis"),
                simple("execute_sql"),
                simple("slack_post_message"),
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
