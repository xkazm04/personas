//! The runner's extension surface — **two** registration surfaces, not one.
//!
//! Personas had no runner-level extension point before this module
//! (`.claude/codebase-stack.md` §"Lifecycle hooks"); the design exploration in
//! [`../HOOKS_DESIGN.md`] recommended Approach B (an in-process Rust trait
//! registry) and this is that registry — with one decision the design did not
//! make: **which surface may change behaviour, and how it says so.**
//!
//! # The split
//!
//! * [`Observer`] **reports.** [`Observer::observe`] returns `()` *by
//!   signature*, so "did this observer change anything?" is not a question a
//!   reader can ask. The emitter has no return channel to read, which is a
//!   stronger statement than a documented convention: an observer cannot
//!   refuse a call, cannot rewrite an argument, cannot delay a decision, and
//!   therefore needs no ordering guarantee against the runner's own gates.
//! * [`Interceptor`] **changes.** It declares — via [`Interceptor::wraps`] —
//!   exactly one [`MutationPoint`] out of a closed vocabulary, and returns a
//!   typed [`Decision`]. A policy denial is [`Decision::Refuse`], never a
//!   returned `Err`: veto-by-error makes a denial and a contributor bug
//!   indistinguishable at every consumer downstream, so the host cannot record
//!   one as a refusal or apply the fail-open rule to the other.
//!
//! A reviewer reading a contribution's registrations knows its blast radius
//! without reading its handlers. That is the whole point of there being two.
//!
//! # The registry is honest
//!
//! No name enters [`ObservationPoint`] or [`MutationPoint`] before a live emit
//! site exists for it. A declared-but-never-fired point is the worst kind of
//! defect: registration succeeds, the contribution reports itself installed,
//! and it does nothing — for months, until someone wonders why their observer
//! never fired. [`registry::pairing_sources`] plus the test
//! `every_declared_point_has_a_live_emit_site` hold that mechanically: every
//! variant must be named at a real dispatch site in the runner or the API
//! proxy. Adding a variant without its emitter turns the build red.
//!
//! Registration for a point the host does not handle is **refused**, not
//! stored — see [`HookRegistry::register_observer`]. Storing it "for forward
//! compatibility" just moves the silent no-op from the host's side to the
//! contributor's.
//!
//! # Ordering: rewrite runs before the gate
//!
//! [`MutationPoint::ApiRequest`] wraps the credential-relayed API request in
//! `engine::api_proxy::execute_api_request`. The frames run **outside** the
//! policy path: SSRF validation and `scope_enforcement::evaluate` execute
//! *inside* the [`Continuation`] a frame calls, so the gate necessarily
//! evaluates the effective value and never a value that will not run. That is
//! structural, not a comment — a frame cannot reach the gate except through
//! the continuation.
//!
//! The continuation is **single-use per frame**. Calling it twice would
//! re-run the call beneath it, and a credential-relayed API request is not
//! idempotent — the second call is a second write, a second charge. A second
//! invocation is a contract violation naming the frame, never a retry.
//!
//! # Deliberate non-fires
//!
//! Some paths plausibly covered by a lifecycle point deliberately do **not**
//! emit. They are written down at [`registry::NON_FIRE`] with a reason, so the
//! next reader finds a decision rather than a hole. The standing members are
//! the operator's escape hatches — cancellation and the resource governor's
//! pause — because a slow or wrong extension must never become a way to lose
//! control of a running execution.
//!
//! # What this is not
//!
//! * Not the CLI's own hooks. `engine::hooks_sidecar` writes Claude Code's
//!   native `SessionStart` / `Stop` / `PreCompact` into a per-run
//!   `.claude/settings.json`; that is a delegation to the *child's* hook
//!   system and stays where it is. One fires in personas' process, the other
//!   in the child's.
//! * Not a plugin loader. These are in-tree Rust impls registered at startup.
//!   Nothing here is dynamic.
//! * Not a second event bus. `engine::event_registry` and the structured
//!   `EXECUTION_EVENT` channel keep owning what the frontend sees.
//! * Not intra-execution. `pre_llm_call` has no attachment point under
//!   `claude -p` — there is no per-call seam inside the spawned binary.

pub(crate) mod observers;
pub(crate) mod registry;

#[cfg(test)]
mod tests;

use std::cell::Cell;
use std::sync::{Arc, LazyLock, RwLock};

use crate::error::AppError;

pub(crate) use registry::{MutationPoint, ObservationPoint};

// ---------------------------------------------------------------------------
// The observer surface — returns are discarded by signature.
// ---------------------------------------------------------------------------

/// A normalized, bounded snapshot of one lifecycle moment.
///
/// Deliberately owns its data: no `DbPool`, no `AppHandle`, no emitter, no
/// handle that would let a contribution reach past its surface into the
/// runner's machinery. A contribution that can reach the executor directly has
/// both surfaces' powers and neither's contract.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct RunEvent {
    pub point: ObservationPoint,
    pub execution_id: String,
    pub persona_id: String,
    /// Wall-clock duration of the run. `None` before it has one.
    pub duration_ms: Option<u64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    /// Terminal error text, already the sanitized form the runner persists.
    pub error: Option<String>,
}

impl RunEvent {
    /// Minimal event for a point that has no metrics yet.
    pub fn starting(point: ObservationPoint, execution_id: &str, persona_id: &str) -> Self {
        Self {
            point,
            execution_id: execution_id.to_string(),
            persona_id: persona_id.to_string(),
            duration_ms: None,
            input_tokens: None,
            output_tokens: None,
            cost_usd: None,
            error: None,
        }
    }
}

/// The reporting surface. Implementors observe; they never decide.
///
/// [`Self::observe`] returns `()`. There is no return channel for the emitter
/// to read, so an observer's failure cannot have withheld a decision — which
/// is what lets the emitter swallow a panic and keep going.
pub(crate) trait Observer: Send + Sync {
    /// Stable name, used in diagnostics and in the exemption tables.
    fn name(&self) -> &'static str;

    /// The points this observer is registered against. Every entry must be a
    /// declared [`ObservationPoint`]; registration is refused otherwise.
    fn observes(&self) -> &'static [ObservationPoint];

    /// Report. The return type is the contract.
    fn observe(&self, event: &RunEvent);
}

// ---------------------------------------------------------------------------
// The mutator surface — declares its point, returns a typed decision.
// ---------------------------------------------------------------------------

/// The normalized payload of a credential-relayed API request, as the mutator
/// surface sees it.
///
/// Carries **both** values: `path` is effective, `original_path` is what
/// arrived. A gate that refuses a rewritten call names a string nobody wrote
/// unless the original travels beside it, and `rewrites` names which frame
/// changed it and why. A rewriting surface without provenance is an
/// unattributable change to a value policy will judge.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct ApiCall {
    pub credential_id: String,
    pub service_type: String,
    pub method: String,
    /// The effective path — what every downstream evaluation sees.
    pub path: String,
    /// The path as it arrived, before any frame touched it.
    pub original_path: String,
    /// One entry per rewriting frame: `(frame name, stated reason)`.
    pub rewrites: Vec<(&'static str, String)>,
}

impl ApiCall {
    pub fn new(credential_id: &str, service_type: &str, method: &str, path: &str) -> Self {
        Self {
            credential_id: credential_id.to_string(),
            service_type: service_type.to_string(),
            method: method.to_string(),
            path: path.to_string(),
            original_path: path.to_string(),
            rewrites: Vec::new(),
        }
    }

    /// Produce the rewritten call a frame hands to its continuation, recording
    /// provenance. Frames should use this rather than mutating `path` directly
    /// so the trace is never silently empty.
    ///
    /// `dead_code`-exempt with a reason: this is the mutator surface's API, and
    /// no interceptor ships today (see the module doc — the surface exists
    /// because its emit site exists, not because a consumer was invented for
    /// it). The unit tests are its only caller until the first real frame
    /// lands. If that is still true in six months, the honest close is to
    /// delete the mutator half, not to keep the allow.
    #[allow(dead_code)]
    pub fn rewritten(&self, frame: &'static str, reason: impl Into<String>, path: &str) -> Self {
        let mut next = self.clone();
        next.path = path.to_string();
        next.rewrites.push((frame, reason.into()));
        next
    }

    #[allow(dead_code)] // Same reason as `rewritten`.
    pub fn was_rewritten(&self) -> bool {
        !self.rewrites.is_empty()
    }
}

/// What the policy path said about a call. Produced only by running the
/// continuation to the bottom, which is what makes "the gate saw the effective
/// value" structural.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum GateVerdict {
    Allowed,
    /// The host's own policy refused. Carries the message the caller surfaces.
    Blocked { reason: String },
}

/// What a frame returns. Refusal is a value, never an `Err` — that is the
/// whole reason the mutator surface exists as its own type.
///
/// Variants are constructed by interceptors, of which none ships yet; the
/// tests construct all of them.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Decision {
    /// The frame ran the continuation; this is what came back from beneath it.
    Wrapped(GateVerdict),
    /// The frame short-circuited with a policy denial and did not run the call
    /// beneath it. Distinguishable at every consumer from a contributor fault.
    Refuse { reason: String },
}

/// The mutating surface. One point per implementor, declared not inferred.
pub(crate) trait Interceptor: Send + Sync {
    fn name(&self) -> &'static str;

    /// Exactly one point. A contribution that needs two vantage points is two
    /// interceptors — a double declaration cannot be expressed here on
    /// purpose.
    fn wraps(&self) -> MutationPoint;

    /// Wrap the call. Call `next.call(..)` **once** to run everything beneath
    /// this frame — the host's gates included — or return
    /// [`Decision::Refuse`] without calling it.
    fn intercept(&self, call: ApiCall, next: &Continuation<'_>) -> Decision;
}

/// A single-use handle to "run everything beneath this frame".
///
/// The `used` flag is the contract: a second call would re-run a
/// non-idempotent request, so it is an error naming the frame rather than a
/// retry. `entered` lets the dispatcher tell "the frame returned before ever
/// reaching the call beneath it" from "the frame ran it" — three states with
/// three different correct recoveries, and the returned value alone cannot
/// separate them.
#[allow(dead_code)] // Read by `call`, which only interceptors invoke.
pub(crate) struct Continuation<'a> {
    frame: &'static str,
    used: Cell<bool>,
    entered: Cell<bool>,
    inner: &'a dyn Fn(&ApiCall) -> Result<GateVerdict, AppError>,
}

impl<'a> Continuation<'a> {
    fn new(frame: &'static str, inner: &'a dyn Fn(&ApiCall) -> Result<GateVerdict, AppError>) -> Self {
        Self {
            frame,
            used: Cell::new(false),
            entered: Cell::new(false),
            inner,
        }
    }

    /// Run the call beneath this frame. Single-use.
    #[allow(dead_code)] // Invoked by interceptors; none ships yet.
    pub fn call(&self, call: &ApiCall) -> Result<GateVerdict, AppError> {
        if self.used.replace(true) {
            return Err(AppError::Execution(format!(
                "hook contract violation: interceptor '{}' called its continuation twice; \
                 the call beneath it is not idempotent, so a second invocation is a bug, \
                 not a retry",
                self.frame
            )));
        }
        self.entered.set(true);
        (self.inner)(call)
    }

    fn was_entered(&self) -> bool {
        self.entered.get()
    }
}

/// What the whole chain produced.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum ChainOutcome {
    /// Nothing refused it. Carries the effective call so the caller can rebuild
    /// anything derived from the (possibly rewritten) arguments.
    Allowed { effective: ApiCall },
    /// Refused. `frame` is `None` when the host's own gate refused, `Some(name)`
    /// when a contribution did — the distinction a bare error would lose.
    Refused {
        frame: Option<&'static str>,
        reason: String,
    },
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Emit to every observer registered for `point`.
///
/// `build` is a closure so the payload is not constructed when nothing is
/// registered: the split is what makes the uninstrumented path cheap.
///
/// A panicking observer is caught and logged. It cannot have withheld a
/// decision — that is the observer contract — so continuing is the only
/// correct direction, and it is available precisely because returns are
/// discarded here, unconditionally.
pub(crate) fn emit(point: ObservationPoint, build: impl FnOnce() -> RunEvent) {
    let hooks = default_registry().observers_for(point);
    if hooks.is_empty() {
        return;
    }
    let event = build();
    for hook in hooks {
        let name = hook.name();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            hook.observe(&event);
        }));
        if result.is_err() {
            tracing::warn!(
                hook = %name,
                point = %point.key(),
                execution_id = %event.execution_id,
                "runner hook: observer panicked (non-fatal; observers cannot withhold a decision)"
            );
        }
    }
}

/// Run the interceptor chain for a mutation point, with `gate` as the bottom
/// of the stack.
///
/// `point` is passed rather than assumed so the emit site *names* the point it
/// dispatches — which is what the pairing check reads. A dispatcher that
/// hard-codes its point internally leaves the call site free of any mention of
/// it, and then a point can lose its last emitter with nothing to notice.
///
/// `gate` is the host's own policy path. It runs **inside** the continuation,
/// so every frame's rewrite is already applied when it evaluates. With no
/// frames registered this is `gate(&call)` plus a branch — the zero-consumer
/// cost of the surface.
pub(crate) fn run_api_request_chain(
    point: MutationPoint,
    call: ApiCall,
    gate: &dyn Fn(&ApiCall) -> Result<GateVerdict, AppError>,
) -> Result<ChainOutcome, AppError> {
    let frames = default_registry().interceptors_for(point);
    run_chain_with(call, &frames, gate)
}

/// The chain, with its frames passed explicitly. Split out so tests drive it
/// without touching the process-wide registry.
pub(crate) fn run_chain_with(
    call: ApiCall,
    frames: &[Arc<dyn Interceptor>],
    gate: &dyn Fn(&ApiCall) -> Result<GateVerdict, AppError>,
) -> Result<ChainOutcome, AppError> {
    // The value that reaches `gate` is the value the last frame produced —
    // never the one the caller passed in. That is what "the gate sees the
    // effective value" means, and it is structural: `gate` is only reachable
    // through the continuation each frame is handed.
    fn descend(
        index: usize,
        call: &ApiCall,
        frames: &[Arc<dyn Interceptor>],
        gate: &dyn Fn(&ApiCall) -> Result<GateVerdict, AppError>,
    ) -> Result<ChainOutcome, AppError> {
        let Some(frame) = frames.get(index) else {
            return match gate(call)? {
                GateVerdict::Allowed => Ok(ChainOutcome::Allowed {
                    effective: call.clone(),
                }),
                GateVerdict::Blocked { reason } => Ok(ChainOutcome::Refused {
                    frame: None,
                    reason,
                }),
            };
        };

        let name = frame.name();
        // A frame's declaration is load-bearing: a frame registered for a
        // different point never reaches this chain.
        debug_assert_eq!(frame.wraps(), MutationPoint::ApiRequest);

        // Shared-mutability cells rather than `&mut` captures, so the closure
        // is a plain `Fn` and the dispatcher can still read what happened
        // beneath after the frame has returned.
        let inner_outcome: std::cell::RefCell<Option<ChainOutcome>> =
            std::cell::RefCell::new(None);
        let inner_error: std::cell::RefCell<Option<AppError>> = std::cell::RefCell::new(None);

        let step_fn = |c: &ApiCall| -> Result<GateVerdict, AppError> {
            match descend(index + 1, c, frames, gate) {
                Ok(ChainOutcome::Allowed { effective: eff }) => {
                    *inner_outcome.borrow_mut() = Some(ChainOutcome::Allowed { effective: eff });
                    Ok(GateVerdict::Allowed)
                }
                Ok(ChainOutcome::Refused { frame, reason }) => {
                    *inner_outcome.borrow_mut() = Some(ChainOutcome::Refused {
                        frame,
                        reason: reason.clone(),
                    });
                    Ok(GateVerdict::Blocked { reason })
                }
                Err(e) => {
                    // The work beneath failed. That is not this frame's
                    // failure and must not be re-labelled as one; the frame
                    // sees a copy, and the dispatcher propagates the original.
                    let text = e.to_string();
                    *inner_error.borrow_mut() = Some(e);
                    Err(AppError::Execution(text))
                }
            }
        };

        let next = Continuation::new(name, &step_fn);
        let decision = frame.intercept(call.clone(), &next);
        let entered = next.was_entered();

        // State 2: the call beneath raised. Propagate it as itself, never
        // re-thrown as the wrapper's error type and never converted into an
        // empty success.
        if let Some(e) = inner_error.borrow_mut().take() {
            return Err(e);
        }

        match decision {
            Decision::Refuse { reason } => {
                if entered {
                    // The frame ran the call beneath it and *then* refused.
                    // The effect has already happened; refusing now would be a
                    // lie about what ran, so the inner outcome stands and the
                    // frame's refusal is a diagnostic.
                    tracing::warn!(
                        hook = %name,
                        reason = %reason,
                        "runner hook: interceptor refused after running the call beneath it; \
                         the inner outcome stands (the effect already happened)"
                    );
                    return inner_outcome.borrow_mut().take().ok_or_else(|| {
                        AppError::Execution(format!(
                            "hook contract violation: interceptor '{name}' entered its \
                             continuation but produced no outcome"
                        ))
                    });
                }
                Ok(ChainOutcome::Refused {
                    frame: Some(name),
                    reason,
                })
            }
            Decision::Wrapped(_) => {
                // State 1: returned `Wrapped` without ever calling the
                // continuation. There is no result to wrap, so this is a
                // contract violation naming the frame — not a silent skip that
                // would let a `Wrapped(Allowed)` fabricate a gate verdict
                // nobody computed.
                if !entered {
                    return Err(AppError::Execution(format!(
                        "hook contract violation: interceptor '{name}' returned a wrapped \
                         verdict without calling its continuation; a gate verdict may only \
                         come from the policy path"
                    )));
                }
                inner_outcome.borrow_mut().take().ok_or_else(|| {
                    AppError::Execution(format!(
                        "hook contract violation: interceptor '{name}' entered its \
                         continuation but produced no outcome"
                    ))
                })
            }
        }
    }

    descend(0, &call, frames, gate)
}

// ---------------------------------------------------------------------------
// The process-wide registry
// ---------------------------------------------------------------------------

/// Registered contributions, split by surface. Registration is refused for a
/// point the host does not declare.
#[derive(Default)]
pub(crate) struct HookRegistry {
    observers: Vec<Arc<dyn Observer>>,
    interceptors: Vec<Arc<dyn Interceptor>>,
}

impl HookRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register an observer. Refused — not stored — when it names a point the
    /// host does not declare, so a contribution built against a newer host
    /// fails to install with a message naming the point rather than installing
    /// and doing nothing.
    pub fn register_observer(&mut self, hook: Arc<dyn Observer>) -> Result<(), AppError> {
        if hook.observes().is_empty() {
            return Err(AppError::Validation(format!(
                "hook '{}' registered against no observation point",
                hook.name()
            )));
        }
        for point in hook.observes() {
            if !ObservationPoint::ALL.contains(point) {
                return Err(AppError::Validation(format!(
                    "hook '{}' registered against unknown observation point '{}'",
                    hook.name(),
                    point.key()
                )));
            }
        }
        self.observers.push(hook);
        Ok(())
    }

    /// Register an interceptor. Same refusal rule, applied to the mutating
    /// vocabulary.
    ///
    /// Unused until the first interceptor ships. It exists now rather than
    /// later because a registration path added alongside its first consumer is
    /// a path that was never reviewed on its own.
    #[allow(dead_code)]
    pub fn register_interceptor(&mut self, hook: Arc<dyn Interceptor>) -> Result<(), AppError> {
        if !MutationPoint::ALL.contains(&hook.wraps()) {
            return Err(AppError::Validation(format!(
                "hook '{}' registered against unknown mutation point '{}'",
                hook.name(),
                hook.wraps().key()
            )));
        }
        self.interceptors.push(hook);
        Ok(())
    }

    pub fn observers_for(&self, point: ObservationPoint) -> Vec<Arc<dyn Observer>> {
        self.observers
            .iter()
            .filter(|h| h.observes().contains(&point))
            .cloned()
            .collect()
    }

    pub fn interceptors_for(&self, point: MutationPoint) -> Vec<Arc<dyn Interceptor>> {
        self.interceptors
            .iter()
            .filter(|h| h.wraps() == point)
            .cloned()
            .collect()
    }
}

static REGISTRY: LazyLock<RwLock<HookRegistry>> = LazyLock::new(|| {
    let mut reg = HookRegistry::new();
    // The one real consumer that ships with the surface. Registration is
    // fallible by contract; a failure here means a declared point was removed
    // without updating the observer, which is a build-time mistake worth a
    // loud line rather than a silent empty registry.
    if let Err(e) = reg.register_observer(Arc::new(observers::RunTelemetryObserver)) {
        tracing::error!(error = %e, "runner hook: built-in observer failed to register");
    }
    // No interceptor ships. `MutationPoint::ApiRequest` exists because its
    // emit site exists, which is the honest order; a point with no consumer is
    // fine, a consumer with no point is not.
    RwLock::new(reg)
});

fn default_registry() -> std::sync::RwLockReadGuard<'static, HookRegistry> {
    REGISTRY
        .read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}
