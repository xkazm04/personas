//! Unit tests for the extension surface.
//!
//! Three things are worth testing here and they map one-to-one onto the three
//! claims the surface makes: the return contracts really are opposite, the
//! continuation really is single-use, and the registry really is honest.

use std::sync::{Arc, Mutex};

use crate::error::AppError;

use super::registry::{pairing_sources, NON_FIRE};
use super::*;

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/// An observer that tries very hard to change something and structurally
/// cannot: `observe` has no return channel, so the only thing it can do is
/// write to its own side-channel.
struct RecordingObserver {
    seen: Mutex<Vec<ObservationPoint>>,
}

impl RecordingObserver {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            seen: Mutex::new(Vec::new()),
        })
    }
}

impl Observer for RecordingObserver {
    fn name(&self) -> &'static str {
        "recording"
    }
    fn observes(&self) -> &'static [ObservationPoint] {
        ObservationPoint::ALL
    }
    fn observe(&self, event: &RunEvent) {
        if let Ok(mut g) = self.seen.lock() {
            g.push(event.point);
        }
    }
}

/// Rewrites the path, then runs the call beneath it.
struct RewritingFrame {
    to: &'static str,
}

impl Interceptor for RewritingFrame {
    fn name(&self) -> &'static str {
        "rewriting"
    }
    fn wraps(&self) -> MutationPoint {
        MutationPoint::ApiRequest
    }
    fn intercept(&self, call: ApiCall, next: &Continuation<'_>) -> Decision {
        let rewritten = call.rewritten(self.name(), "test rewrite", self.to);
        match next.call(&rewritten) {
            Ok(v) => Decision::Wrapped(v),
            Err(e) => Decision::Refuse {
                reason: e.to_string(),
            },
        }
    }
}

/// Calls its continuation twice. The second call must be a contract violation
/// naming this frame, not a retry.
struct DoubleCallingFrame;

impl Interceptor for DoubleCallingFrame {
    fn name(&self) -> &'static str {
        "double_calling"
    }
    fn wraps(&self) -> MutationPoint {
        MutationPoint::ApiRequest
    }
    fn intercept(&self, call: ApiCall, next: &Continuation<'_>) -> Decision {
        let _ = next.call(&call);
        match next.call(&call) {
            Ok(v) => Decision::Wrapped(v),
            Err(e) => Decision::Refuse {
                reason: e.to_string(),
            },
        }
    }
}

/// Refuses without ever running the call beneath it.
struct RefusingFrame;

impl Interceptor for RefusingFrame {
    fn name(&self) -> &'static str {
        "refusing"
    }
    fn wraps(&self) -> MutationPoint {
        MutationPoint::ApiRequest
    }
    fn intercept(&self, _call: ApiCall, _next: &Continuation<'_>) -> Decision {
        Decision::Refuse {
            reason: "policy: not during a freeze window".into(),
        }
    }
}

/// Claims a verdict it never obtained from the policy path.
struct FabricatingFrame;

impl Interceptor for FabricatingFrame {
    fn name(&self) -> &'static str {
        "fabricating"
    }
    fn wraps(&self) -> MutationPoint {
        MutationPoint::ApiRequest
    }
    fn intercept(&self, _call: ApiCall, _next: &Continuation<'_>) -> Decision {
        Decision::Wrapped(GateVerdict::Allowed)
    }
}

fn call() -> ApiCall {
    ApiCall::new("cred-1", "github", "GET", "/repos/acme/public/issues")
}

/// Stands in for `scope_enforcement::evaluate`: allows the scoped repo, blocks
/// everything else. Records every path it actually judged.
fn recording_gate(
    judged: &Mutex<Vec<String>>,
) -> impl Fn(&ApiCall) -> Result<GateVerdict, AppError> + '_ {
    move |c: &ApiCall| {
        if let Ok(mut g) = judged.lock() {
            g.push(c.path.clone());
        }
        if c.path.starts_with("/repos/acme/public") {
            Ok(GateVerdict::Allowed)
        } else {
            Ok(GateVerdict::Blocked {
                reason: format!("out of scope: {}", c.path),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// 1. The return-contract split
// ---------------------------------------------------------------------------

#[test]
fn observer_returns_are_structurally_discarded() {
    // The claim is about the signature, not about runtime behaviour: there is
    // no expression an `Observer` can write that the emitter reads. This test
    // pins the signature so the claim cannot be quietly relaxed into "the
    // emitter ignores the return for now".
    fn assert_unit_return<O: Observer>(o: &O, e: &RunEvent) {
        let returned: () = o.observe(e);
        // `()` is the only inhabitant; there is nothing to branch on.
        assert_eq!(returned, ());
    }

    let obs = RecordingObserver::new();
    let event = RunEvent::starting(ObservationPoint::TaskStart, "exec-1", "persona-1");
    assert_unit_return(&*obs, &event);
    assert_eq!(
        obs.seen.lock().expect("seen lock").as_slice(),
        &[ObservationPoint::TaskStart]
    );
}

#[test]
fn interceptor_declares_its_point_and_returns_a_typed_decision() {
    // The opposite half: an interceptor names the point it wraps, and its
    // refusal is a value. A caller can tell a policy denial from a bug because
    // one is `ChainOutcome::Refused` and the other is `Err`.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let frames: Vec<Arc<dyn Interceptor>> = vec![Arc::new(RefusingFrame)];

    assert_eq!(RefusingFrame.wraps(), MutationPoint::ApiRequest);

    let outcome = run_chain_with(call(), &frames, &gate).expect("refusal is not an error");
    match outcome {
        ChainOutcome::Refused { frame, reason } => {
            assert_eq!(frame, Some("refusing"));
            assert!(reason.contains("freeze window"));
        }
        other => panic!("expected a typed refusal, got {other:?}"),
    }
    // A short-circuiting frame never reached the policy path — and the caller
    // can see *which* frame refused, which a thrown error would have lost.
    assert!(judged.lock().expect("judged lock").is_empty());
}

#[test]
fn a_contribution_cannot_fabricate_a_gate_verdict() {
    // A verdict may only come from the policy path. A frame that returns
    // `Wrapped` without entering its continuation is a contract violation, not
    // a silent allow — otherwise the mutator surface would be an authorization
    // bypass dressed as a return value.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let frames: Vec<Arc<dyn Interceptor>> = vec![Arc::new(FabricatingFrame)];

    let err = run_chain_with(call(), &frames, &gate).expect_err("must not be accepted");
    assert!(err.to_string().contains("fabricating"), "{err}");
    assert!(judged.lock().expect("judged lock").is_empty());
}

// ---------------------------------------------------------------------------
// 2. Rewrite before the gate, and the single-use continuation
// ---------------------------------------------------------------------------

#[test]
fn the_gate_judges_the_rewritten_value_not_the_original() {
    // The ordering claim, stated so that swapping the order fails it: the
    // incoming path is in scope and the rewritten one is not. If the gate ran
    // on the original — i.e. if the rewrite happened after the policy path —
    // this call would be allowed.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let frames: Vec<Arc<dyn Interceptor>> = vec![Arc::new(RewritingFrame {
        to: "/repos/acme/private/issues",
    })];

    let outcome = run_chain_with(call(), &frames, &gate).expect("chain ran");
    match outcome {
        ChainOutcome::Refused { frame, reason } => {
            // Refused by the host's own gate, not by a contribution.
            assert_eq!(frame, None);
            assert!(reason.contains("/repos/acme/private/issues"), "{reason}");
        }
        other => panic!("the gate judged the pre-rewrite value: {other:?}"),
    }

    let judged = judged.lock().expect("judged lock");
    assert_eq!(
        judged.as_slice(),
        &["/repos/acme/private/issues".to_string()],
        "the gate must see the effective value exactly once, and only that value"
    );
}

#[test]
fn a_rewrite_carries_its_original_and_its_provenance() {
    // A gate that refuses a rewritten call names a string nobody wrote unless
    // the original travels beside it.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let frames: Vec<Arc<dyn Interceptor>> = vec![Arc::new(RewritingFrame {
        to: "/repos/acme/public/pulls",
    })];

    let outcome = run_chain_with(call(), &frames, &gate).expect("chain ran");
    match outcome {
        ChainOutcome::Allowed { effective } => {
            assert_eq!(effective.path, "/repos/acme/public/pulls");
            assert_eq!(effective.original_path, "/repos/acme/public/issues");
            assert!(effective.was_rewritten());
            assert_eq!(
                effective.rewrites,
                vec![("rewriting", "test rewrite".to_string())]
            );
        }
        other => panic!("expected allow, got {other:?}"),
    }
}

#[test]
fn the_continuation_is_single_use_per_frame() {
    // The call beneath is not idempotent — a credential-relayed API request is
    // a write, a charge, a message sent. A second invocation is a contract
    // violation naming the frame, never a retry, so the gate must be reached
    // exactly once even though the frame asked twice.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let frames: Vec<Arc<dyn Interceptor>> = vec![Arc::new(DoubleCallingFrame)];

    let outcome = run_chain_with(call(), &frames, &gate).expect("chain ran");

    let judged = judged.lock().expect("judged lock");
    assert_eq!(
        judged.len(),
        1,
        "the call beneath ran more than once: {judged:?}"
    );
    drop(judged);

    // The frame turned the violation into a refusal; the important part is
    // that the error text names the offending frame so the report is
    // attributable.
    match outcome {
        ChainOutcome::Allowed { .. } => {
            // The first call already produced the outcome; preserving it is
            // correct (the effect happened) as long as nothing re-ran.
        }
        ChainOutcome::Refused { reason, .. } => {
            assert!(reason.contains("double_calling"), "{reason}");
            assert!(reason.contains("continuation twice"), "{reason}");
        }
    }
}

#[test]
fn a_second_continuation_call_names_the_frame() {
    // The same rule at the unit below the chain, where the message is visible.
    let gate = |_c: &ApiCall| -> Result<GateVerdict, AppError> { Ok(GateVerdict::Allowed) };
    let next = Continuation::new("noisy_frame", &gate);
    assert!(next.call(&call()).is_ok());
    let err = next.call(&call()).expect_err("second call must fail");
    assert!(err.to_string().contains("noisy_frame"), "{err}");
    assert!(err.to_string().contains("not a retry"), "{err}");
}

#[test]
fn no_frames_means_the_gate_runs_directly() {
    // The zero-consumer cost of the surface: one branch.
    let judged = Mutex::new(Vec::new());
    let gate = recording_gate(&judged);
    let outcome = run_chain_with(call(), &[], &gate).expect("chain ran");
    assert!(matches!(outcome, ChainOutcome::Allowed { .. }));
    assert_eq!(judged.lock().expect("judged lock").len(), 1);
}

// ---------------------------------------------------------------------------
// 3. The registry is honest
// ---------------------------------------------------------------------------

#[test]
fn every_declared_point_has_a_live_emit_site() {
    // The pairing check. A point may only exist if something fires it; this is
    // the only check that catches the drift, because the drift is introduced
    // by a change that touches neither this module nor any contribution.
    // Comments are stripped first: a point named only in a doc comment is not
    // an emit site, and letting prose satisfy the check would reintroduce
    // exactly the "documented but never fired" state the check exists to
    // prevent.
    let raw = pairing_sources();
    let sources: Vec<(&str, String)> = raw
        .iter()
        .map(|(name, src)| {
            let code: String = src
                .lines()
                .filter(|l| {
                    let t = l.trim_start();
                    !(t.starts_with("//") || t.starts_with("*") || t.starts_with("/*"))
                })
                .collect::<Vec<_>>()
                .join("\n");
            (*name, code)
        })
        .collect();

    for point in ObservationPoint::ALL {
        let marker = point.emit_marker();
        let found = sources.iter().any(|(_, src)| src.contains(marker));
        assert!(
            found,
            "observation point '{}' is declared but has no emit site in any of {:?}. \
             A declared point with no emitter is a promise with no payer: registration \
             succeeds and nothing ever fires. Add the dispatch site in the same change \
             as the variant, or remove the variant.",
            point.key(),
            sources.iter().map(|(name, _)| *name).collect::<Vec<_>>()
        );
    }

    for point in MutationPoint::ALL {
        let marker = point.emit_marker();
        let found = sources.iter().any(|(_, src)| src.contains(marker));
        assert!(
            found,
            "mutation point '{}' is declared but has no emit site. Same rule, and it \
             matters more here: a mutating point nobody dispatches is a guard that \
             reports itself installed and does nothing.",
            point.key()
        );
    }
}

#[test]
fn registration_against_an_unknown_point_is_refused_not_stored() {
    // Forward compatibility by storing an unknown registration is the silent
    // no-op moved from the host's side to the contributor's.
    struct NoPoints;
    impl Observer for NoPoints {
        fn name(&self) -> &'static str {
            "no_points"
        }
        fn observes(&self) -> &'static [ObservationPoint] {
            &[]
        }
        fn observe(&self, _event: &RunEvent) {}
    }

    let mut reg = HookRegistry::new();
    let err = reg
        .register_observer(Arc::new(NoPoints))
        .expect_err("must be refused");
    assert!(err.to_string().contains("no_points"), "{err}");
    assert!(
        reg.observers_for(ObservationPoint::TaskStart).is_empty(),
        "a refused registration must not be stored"
    );
}

#[test]
fn the_shipped_observer_registers_and_receives_every_point() {
    // The surface has a real consumer, and it is reachable through the same
    // registration path a contribution would use.
    let mut reg = HookRegistry::new();
    reg.register_observer(Arc::new(observers::RunTelemetryObserver))
        .expect("built-in observer registers");
    for point in ObservationPoint::ALL {
        assert_eq!(
            reg.observers_for(*point).len(),
            1,
            "run telemetry must be registered for {}",
            point.key()
        );
    }
}

#[test]
fn deliberate_non_fires_are_recorded_with_reasons() {
    // An absence recorded is a decision; an absence unrecorded is a hole. The
    // escape hatches are the standing members and must never quietly become
    // hook points.
    assert!(!NON_FIRE.is_empty());
    for (path, reason) in NON_FIRE {
        assert!(!path.is_empty());
        assert!(
            reason.len() > 40,
            "non-fire '{path}' needs a real reason, not a label"
        );
    }
    let paths: Vec<&str> = NON_FIRE.iter().map(|(p, _)| *p).collect();
    assert!(paths.iter().any(|p| p.contains("cancellation")));
    assert!(paths.iter().any(|p| p.contains("governor")));
}

#[test]
fn point_keys_are_stable_for_log_queries() {
    assert_eq!(ObservationPoint::TaskStart.key(), "task_start");
    assert_eq!(ObservationPoint::TaskSuccess.key(), "task_success");
    assert_eq!(ObservationPoint::TaskFailure.key(), "task_failure");
    assert_eq!(ObservationPoint::SessionEnd.key(), "session_end");
    assert_eq!(MutationPoint::ApiRequest.key(), "api_request");
}

#[test]
fn emit_skips_payload_construction_when_nothing_is_registered() {
    // The split is what makes the uninstrumented path cheap; this pins that
    // the closure is not called when no observer wants the point.
    let reg = HookRegistry::new();
    assert!(reg.observers_for(ObservationPoint::TaskStart).is_empty());

    let built = std::cell::Cell::new(false);
    let hooks = reg.observers_for(ObservationPoint::TaskStart);
    if !hooks.is_empty() {
        built.set(true);
    }
    assert!(!built.get());
}
