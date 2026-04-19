//! Property-based coverage for the RenderPlan compiler.
//!
//! The spec's PR-1 acceptance criteria call for ≥1,000 proptest cases per
//! invariant. Proptest reduces the test-design surface dramatically — every
//! random composition exercises compile(), and every output is checked
//! against `assert_invariants`. Failures shrink to minimal counterexamples.
//!
//! Run with:
//!   cargo test --features desktop --test render_plan_proptest
//!
//! Longer bake (10,000 cases per property):
//!   PROPTEST_CASES=10000 cargo test --features desktop --test render_plan_proptest

use app_lib::render_plan::compile::{
    AudioClipInput, Composition, CompileDeps, CompileOptions, ImageItemInput, TextItemInput,
    TimelineItem, VideoClipInput,
};
use app_lib::render_plan::{assert_invariants, compile};
use proptest::collection::vec;
use proptest::option;
use proptest::prelude::*;

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

fn arb_fps() -> impl Strategy<Value = u32> {
    prop_oneof![Just(24u32), Just(30u32), Just(60u32)]
}

fn arb_transition() -> impl Strategy<Value = String> {
    prop_oneof![
        Just("cut".to_string()),
        Just("crossfade".to_string()),
        Just("fade_to_black".to_string()),
    ]
}

/// Video clip: well-formed (duration > 0, trim in bounds, speed in sane range).
/// We constrain deliberately so compile() stays on the happy path — the
/// property under test is "compile never produces an invalid plan", not
/// "compile rejects every malformed input", which is covered elsewhere.
fn arb_video_clip(ordinal: usize) -> impl Strategy<Value = TimelineItem> {
    (
        0.0f64..40.0,      // start_time
        0.25f64..10.0,     // duration
        0.0f64..5.0,       // trim_start
        arb_transition(),  // transition
        0.0f64..1.0,       // transition_duration
        0.25f64..4.0,      // speed
        0.0f64..1.0,       // fade_in
        0.0f64..1.0,       // fade_out
        any::<bool>(),     // strip_audio
        option::of(0..3usize), // which file path index
    )
        .prop_map(move |(start, duration, trim, trans, trans_dur, speed, fi, fo, strip, path_idx)| {
            let path_pool = ["/a.mp4", "/b.mp4", "/c.mp4"];
            let file_path = path_pool[path_idx.unwrap_or(0)].to_string();
            TimelineItem::Video(VideoClipInput {
                id: Some(format!("v{ordinal}")),
                label: None,
                file_path,
                start_time: start,
                duration,
                trim_start: trim,
                trim_end: 0.0,
                media_duration: Some(60.0),
                transition: Some(trans),
                transition_duration: trans_dur,
                speed: Some(speed),
                fade_in: fi,
                fade_out: fo,
                strip_audio: strip,
            })
        })
}

fn arb_audio_clip(ordinal: usize) -> impl Strategy<Value = TimelineItem> {
    (
        0.0f64..40.0,
        0.25f64..10.0,
        0.0f64..5.0,
        0.0f64..2.0,       // volume
        0.25f64..4.0,      // speed
        0.0f64..0.5,       // fade_in
        0.0f64..0.5,       // fade_out
        any::<bool>(),     // normalize
    )
        .prop_map(move |(start, duration, trim, vol, speed, fi, fo, norm)| {
            TimelineItem::Audio(AudioClipInput {
                id: Some(format!("a{ordinal}")),
                label: None,
                file_path: "/music.wav".into(),
                start_time: start,
                duration,
                trim_start: trim,
                trim_end: 0.0,
                media_duration: Some(300.0),
                volume: vol,
                speed: Some(speed),
                fade_in: fi,
                fade_out: fo,
                normalize: norm,
                // Always supply measurements if normalize is on, so the
                // LoudnormUnmeasured warning branch doesn't dominate the
                // sample space (it's covered separately).
                measured_lufs: if norm { Some(-20.0) } else { None },
                measured_lra: if norm { Some(7.0) } else { None },
                measured_true_peak: if norm { Some(-2.0) } else { None },
                measured_threshold: if norm { Some(-30.0) } else { None },
            })
        })
}

fn arb_text_item(ordinal: usize) -> impl Strategy<Value = TimelineItem> {
    (0.0f64..40.0, 0.25f64..8.0).prop_map(
        move |(start, duration)| {
            TimelineItem::Text(TextItemInput {
                id: Some(format!("t{ordinal}")),
                label: Some(format!("label{ordinal}")),
                start_time: start,
                duration,
                text: format!("body{ordinal}"),
                _legacy: Default::default(),
            })
        },
    )
}

fn arb_image_item(ordinal: usize) -> impl Strategy<Value = TimelineItem> {
    (0.0f64..40.0, 0.25f64..8.0, 0.0f64..1.0, 0.0f64..1.0, 0.25f64..3.0).prop_map(
        move |(start, duration, px, py, scale)| {
            TimelineItem::Image(ImageItemInput {
                id: Some(format!("i{ordinal}")),
                label: None,
                file_path: "/logo.png".into(),
                start_time: start,
                duration,
                position_x: px,
                position_y: py,
                scale,
                fade_in: 0.0,
                fade_out: 0.0,
            })
        },
    )
}

fn arb_composition() -> impl Strategy<Value = Composition> {
    (
        arb_fps(),
        vec(arb_video_clip(0), 0..=8),
        vec(arb_audio_clip(0), 0..=4),
        vec(arb_text_item(0), 0..=3),
        vec(arb_image_item(0), 0..=3),
    )
        .prop_map(|(fps, vs, aus, ts, is)| {
            // Re-index items so every clip gets a unique id. Proptest's
            // shrinker assumes value-level uniqueness so we don't overlap.
            let mut items: Vec<TimelineItem> = Vec::new();
            for (i, mut v) in vs.into_iter().enumerate() {
                if let TimelineItem::Video(ref mut c) = v {
                    c.id = Some(format!("v{i}"));
                }
                items.push(v);
            }
            for (i, mut a) in aus.into_iter().enumerate() {
                if let TimelineItem::Audio(ref mut c) = a {
                    c.id = Some(format!("a{i}"));
                }
                items.push(a);
            }
            for (i, mut t) in ts.into_iter().enumerate() {
                if let TimelineItem::Text(ref mut c) = t {
                    c.id = Some(format!("t{i}"));
                }
                items.push(t);
            }
            for (i, mut img) in is.into_iter().enumerate() {
                if let TimelineItem::Image(ref mut c) = img {
                    c.id = Some(format!("i{i}"));
                }
                items.push(img);
            }
            Composition {
                id: None,
                name: None,
                width: 1920,
                height: 1080,
                fps,
                background_color: "#000000".into(),
                items,
            }
        })
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 1024,
        ..ProptestConfig::default()
    })]

    #[test]
    fn compile_fold_always_satisfies_invariants(comp in arb_composition()) {
        // compile() may return Err on genuinely unsupported input — that's
        // fine. What MUST hold: when it returns Ok, the plan satisfies
        // every I1–I11 invariant.
        if let Ok(plan) = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()) {
            assert_invariants(&plan)
                .expect("fold-mode compile output must satisfy invariants");
        }
    }

    #[test]
    fn compile_overlap_always_satisfies_invariants(comp in arb_composition()) {
        if let Ok(plan) = compile(&comp, &CompileOptions::overlap_default(), &CompileDeps::none()) {
            assert_invariants(&plan)
                .expect("overlap-mode compile output must satisfy invariants");
        }
    }

    #[test]
    fn compile_is_deterministic(comp in arb_composition()) {
        let a = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none());
        let b = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none());
        match (a, b) {
            (Ok(pa), Ok(pb)) => {
                let sa = serde_json::to_string(&pa).unwrap();
                let sb = serde_json::to_string(&pb).unwrap();
                assert_eq!(sa, sb, "same input produced different output JSON");
            }
            (Err(ea), Err(eb)) => {
                assert_eq!(format!("{ea:?}"), format!("{eb:?}"));
            }
            _ => panic!("compile produced different Result branches on the same input"),
        }
    }

    #[test]
    fn compile_preserves_frame_alignment(comp in arb_composition()) {
        if let Ok(plan) = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()) {
            let fps = plan.fps as f64;
            let snapped = |v: f64| (v * fps - (v * fps).round()).abs() < 1e-6;
            for s in &plan.video_track {
                prop_assert!(snapped(s.output_start), "outputStart not frame-aligned");
                prop_assert!(snapped(s.output_end), "outputEnd not frame-aligned");
                prop_assert!(snapped(s.fade_in), "fadeIn not frame-aligned");
                prop_assert!(snapped(s.fade_out), "fadeOut not frame-aligned");
            }
        }
    }
}
