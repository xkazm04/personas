//! The single definition of the hook vocabulary.
//!
//! Everything that consumes the vocabulary — the dispatchers in
//! [`super`], the registration refusals, this module's own pairing test —
//! derives from the two enums here. A second hand-maintained list of "points
//! that can change things" drifts the first time someone adds a fifth.
//!
//! # The rule this module exists to enforce
//!
//! **A point enters an enum in the same change that adds its emit site.** Not
//! before, not "for later", not to reserve the vocabulary. A declared point
//! with no emitter is a promise with no payer: registration succeeds, the
//! contribution believes itself installed, and nothing ever calls it. The
//! failure is silent by construction and is normally found months later by a
//! contributor wondering why their observer never fired.
//!
//! [`pairing_sources`] is how that is checked mechanically rather than
//! remembered: it lists the source files that are allowed to contain emit
//! sites, and the test `every_declared_point_has_a_live_emit_site` fails the
//! build when a declared variant is not named in any of them.

/// Points at which the runner reports. Purely observational — see
/// [`super::Observer`].
///
/// The four here are the task-level stages `HOOKS_DESIGN.md` names, and
/// **nothing else**. In particular there is no stream-line point yet: the
/// design's v2 catalogue (`HOOKS_DESIGN.md` §"v2 scope reference") lists
/// `pre_tool_call` and friends, and every one of them would be a name without
/// an emitter today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ObservationPoint {
    /// The run has been validated and is about to spawn. Emitted from
    /// `run_execution`'s Validate stage.
    TaskStart,
    /// The run reached a terminal state and the CLI succeeded.
    TaskSuccess,
    /// The run reached a terminal state and the CLI failed.
    TaskFailure,
    /// The run's terminal status has been persisted; the execution identity is
    /// finished being written. Last point of the run.
    SessionEnd,
}

impl ObservationPoint {
    pub const ALL: &'static [ObservationPoint] = &[
        ObservationPoint::TaskStart,
        ObservationPoint::TaskSuccess,
        ObservationPoint::TaskFailure,
        ObservationPoint::SessionEnd,
    ];

    /// Stable key for logs and trace queries. Same discipline as
    /// `RunnerStage::key` in the sibling `stages` module — a rename here is a
    /// breaking change to anything querying traces.
    pub fn key(self) -> &'static str {
        match self {
            Self::TaskStart => "task_start",
            Self::TaskSuccess => "task_success",
            Self::TaskFailure => "task_failure",
            Self::SessionEnd => "session_end",
        }
    }

    /// The identifier a pairing check looks for at an emit site.
    #[cfg_attr(not(test), allow(dead_code))] // Used by the pairing test.
    pub fn emit_marker(self) -> &'static str {
        match self {
            Self::TaskStart => "ObservationPoint::TaskStart",
            Self::TaskSuccess => "ObservationPoint::TaskSuccess",
            Self::TaskFailure => "ObservationPoint::TaskFailure",
            Self::SessionEnd => "ObservationPoint::SessionEnd",
        }
    }
}

impl std::fmt::Display for ObservationPoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.key())
    }
}

/// Points at which a contribution may change behaviour. Closed vocabulary —
/// see [`super::Interceptor`].
///
/// One variant, because one live emit site exists. The v2 catalogue in
/// `HOOKS_DESIGN.md` is a *reference*, not a reservation: `pre_tool_call`,
/// `transform_tool_result` and `pre_llm_call` are absent here because personas
/// runs the CLI under `-p` and has no per-call seam inside the spawned binary
/// to attach them to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum MutationPoint {
    /// Wraps a credential-relayed API request in
    /// `engine::api_proxy::execute_api_request`. The host's policy path — SSRF
    /// validation and `scope_enforcement::evaluate` — runs *inside* the
    /// continuation, so a frame's rewrite is always the value the gate judges.
    ApiRequest,
}

impl MutationPoint {
    // Read by `HookRegistry::register_interceptor` and the pairing test; both
    // are ahead of the first shipped interceptor by design.
    #[allow(dead_code)]
    pub const ALL: &'static [MutationPoint] = &[MutationPoint::ApiRequest];

    pub fn key(self) -> &'static str {
        match self {
            Self::ApiRequest => "api_request",
        }
    }

    #[cfg_attr(not(test), allow(dead_code))] // Used by the pairing test.
    pub fn emit_marker(self) -> &'static str {
        match self {
            Self::ApiRequest => "MutationPoint::ApiRequest",
        }
    }
}

impl std::fmt::Display for MutationPoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.key())
    }
}

/// Every source file permitted to contain an emit site, inlined at compile
/// time so the pairing check reads the code that actually ships rather than a
/// list someone maintains.
///
/// Adding a file here is how a new dispatch site becomes legal. Removing a
/// dispatch site without removing its point turns the pairing test red — which
/// is the entire purpose: the drift this catches is introduced by a change that
/// touches neither this module nor any contribution.
///
/// `cfg(test)` because the sources are inlined verbatim: this is a build-time
/// check, and there is no reason to carry 200 KB of source text in the shipped
/// binary to run it.
#[cfg(test)]
pub(crate) fn pairing_sources() -> [(&'static str, &'static str); 2] {
    [
        ("engine/runner/mod.rs", include_str!("../mod.rs")),
        ("engine/api_proxy.rs", include_str!("../../api_proxy.rs")),
    ]
}

/// Paths that plausibly fall under a lifecycle point and deliberately do
/// **not** emit, each with the reason.
///
/// An absence recorded here is a decision the next reader can find. An absence
/// not recorded here is a hole. These are also the reason the surface has no
/// timeout policy to write down yet: nothing on it can delay a decision, so
/// there is no handler whose abandonment direction has to be classified.
#[cfg_attr(not(test), allow(dead_code))] // A documented table; the test reads it.
pub(crate) const NON_FIRE: &[(&str, &str)] = &[
    (
        "execution cancellation",
        "The operator's escape hatch on a run already in flight. A hook here \
         would let a slow or wrong extension become a way to lose control of a \
         live execution; cancellation must stay a path nothing can extend.",
    ),
    (
        "resource governor pause",
        "Same reason as cancellation: the governor exists to take control back, \
         so it cannot be a point that hands control out.",
    ),
    (
        "Claude Code's own SessionStart / Stop / PreCompact",
        "Delegated to the child's hook system by engine::hooks_sidecar, which \
         writes them into a per-run .claude/settings.json. Those fire in the \
         spawned CLI's process, not in personas'; merging the two surfaces \
         would put one name on two different processes' lifecycles.",
    ),
];
