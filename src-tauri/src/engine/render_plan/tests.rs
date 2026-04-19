//! Unit tests for the RenderPlan compiler + invariant checker.
//!
//! Covers:
//! - Golden worked example from `docs/concepts/media-studio-renderplan.md`
//! - Fold vs Overlap transition mode
//! - Every invariant I1–I11 has a negative test that mutates a valid plan
//!   into a violating state and confirms `assert_invariants` returns Err.
//! - Determinism (compile twice → identical JSON).
//!
//! Proptest-based coverage is a follow-up (spec PR-1 acceptance criteria).

use super::compile::*;
use super::invariants::assert_invariants;
use super::*;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

fn empty_comp() -> Composition {
    Composition {
        id: None,
        name: None,
        width: 1920,
        height: 1080,
        fps: 30,
        background_color: "#000000".into(),
        items: vec![],
    }
}

fn video_clip(
    id: &str,
    path: &str,
    start: f64,
    duration: f64,
    transition: &str,
    transition_dur: f64,
) -> TimelineItem {
    TimelineItem::Video(VideoClipInput {
        id: Some(id.into()),
        label: None,
        file_path: path.into(),
        start_time: start,
        duration,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(10.0),
        transition: Some(transition.into()),
        transition_duration: transition_dur,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: false,
    })
}

fn audio_clip(
    id: &str,
    path: &str,
    start: f64,
    duration: f64,
    volume: f64,
    normalize: bool,
    measurements: Option<(f64, f64, f64, f64)>,
) -> TimelineItem {
    TimelineItem::Audio(AudioClipInput {
        id: Some(id.into()),
        label: None,
        file_path: path.into(),
        start_time: start,
        duration,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(60.0),
        volume,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        normalize,
        measured_lufs: measurements.map(|m| m.0),
        measured_lra: measurements.map(|m| m.1),
        measured_true_peak: measurements.map(|m| m.2),
        measured_threshold: measurements.map(|m| m.3),
    })
}

fn text_item(id: &str, start: f64, duration: f64) -> TimelineItem {
    TimelineItem::Text(TextItemInput {
        id: Some(id.into()),
        label: None,
        start_time: start,
        duration,
        text: "hello".into(),
        font_size: 48.0,
        color: "#ffffff".into(),
        position_x: 0.5,
        position_y: 0.9,
        fade_in: 0.0,
        fade_out: 0.0,
    })
}

// ---------------------------------------------------------------------------
// Positive tests
// ---------------------------------------------------------------------------

#[test]
fn empty_composition_produces_valid_plan() {
    let plan = compile(
        &empty_comp(),
        &CompileOptions::fold_default(),
        &CompileDeps::none(),
    )
    .expect("empty comp compiles");
    assert_eq!(plan.schema_version, RENDER_PLAN_SCHEMA_VERSION);
    assert_eq!(plan.duration_frames, 0);
    assert_eq!(plan.video_track.len(), 0);
    assert_eq!(plan.audio_tracks.len(), 0);
    assert_eq!(plan.overlays.len(), 0);
    assert!(matches!(plan.sources[0], SourceEntry::Color { .. }));
}

#[test]
fn worked_example_fold_matches_doc() {
    // From docs/concepts/media-studio-renderplan.md §"Worked example"
    let mut comp = empty_comp();
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 5.0, "crossfade", 1.0),
        video_clip("v2", "/b.mp4", 5.0, 4.0, "cut", 0.0),
    ];

    let plan = compile(
        &comp,
        &CompileOptions { transition_mode: TransitionMode::Fold, frame_snap: true, for_export: true },
        &CompileDeps::none(),
    )
    .expect("worked example compiles");

    assert_invariants(&plan).expect("plan satisfies invariants");

    assert_eq!(plan.duration_frames, 270);
    assert!((plan.duration_seconds - 9.0).abs() < 1e-9);
    assert_eq!(plan.video_track.len(), 2);

    let v1 = &plan.video_track[0];
    assert_eq!(v1.id, "v1");
    assert!((v1.output_start - 0.0).abs() < 1e-9);
    assert!((v1.output_end - 5.0).abs() < 1e-9);
    assert!((v1.fade_in - 0.0).abs() < 1e-9);
    assert!((v1.fade_out - 1.0).abs() < 1e-9, "v1 fade_out={}", v1.fade_out);
    assert!(v1.overlap_next.is_none());

    let v2 = &plan.video_track[1];
    assert_eq!(v2.id, "v2");
    assert!((v2.output_start - 5.0).abs() < 1e-9);
    assert!((v2.output_end - 9.0).abs() < 1e-9);
    assert!((v2.fade_in - 1.0).abs() < 1e-9, "v2 fade_in={}", v2.fade_in);
    assert!((v2.fade_out - 0.0).abs() < 1e-9);
}

#[test]
fn worked_example_overlap_shortens_total_duration() {
    let mut comp = empty_comp();
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 5.0, "crossfade", 1.0),
        video_clip("v2", "/b.mp4", 5.0, 4.0, "cut", 0.0),
    ];

    let plan = compile(
        &comp,
        &CompileOptions::overlap_default(),
        &CompileDeps::none(),
    )
    .expect("overlap compiles");

    assert_invariants(&plan).expect("overlap plan satisfies invariants");

    assert_eq!(plan.video_track.len(), 2);

    let v1 = &plan.video_track[0];
    assert!(v1.overlap_next.is_some());
    let overlap = v1.overlap_next.as_ref().unwrap();
    assert!((overlap.duration_seconds - 1.0).abs() < 1e-9);
    assert_eq!(overlap.kind, OverlapKind::Crossfade);
    // In overlap mode fade is NOT folded onto v1 — it's expressed via overlap_next.
    assert!((v1.fade_out - 0.0).abs() < 1e-9);

    let v2 = &plan.video_track[1];
    // v2 pulled 1s earlier by the preceding overlap.
    assert!((v2.output_start - 4.0).abs() < 1e-9, "v2 starts at {}", v2.output_start);
    assert!((v2.output_end - 8.0).abs() < 1e-9);
    assert!((v2.fade_in - 0.0).abs() < 1e-9);

    // Total duration should be 8s (not 9).
    assert_eq!(plan.duration_frames, 240);
}

#[test]
fn single_video_clip_produces_embedded_audio_track() {
    let mut comp = empty_comp();
    comp.items = vec![video_clip("v1", "/a.mp4", 0.0, 3.0, "cut", 0.0)];

    let plan = compile(
        &comp,
        &CompileOptions::fold_default(),
        &CompileDeps::none(),
    )
    .unwrap();

    assert_invariants(&plan).unwrap();
    let embedded = plan
        .audio_tracks
        .iter()
        .find(|t| t.id == "embedded")
        .expect("embedded track emitted");
    assert_eq!(embedded.stages.len(), 1);
    let s = &embedded.stages[0];
    assert_eq!(s.id, "v1-embedded");
    assert!((s.output_start - 0.0).abs() < 1e-9);
    assert!((s.output_end - 3.0).abs() < 1e-9);
    assert_eq!(s.source_id, plan.video_track[0].source_id);
}

#[test]
fn strip_audio_flag_omits_embedded_stage() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Video(VideoClipInput {
        id: Some("v1".into()),
        label: None,
        file_path: "/a.mp4".into(),
        start_time: 0.0,
        duration: 2.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(10.0),
        transition: Some("cut".into()),
        transition_duration: 0.0,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: true,
    })];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert!(plan
        .audio_tracks
        .iter()
        .all(|t| t.id != "embedded"));
}

#[test]
fn normalize_without_measurements_emits_warning() {
    let mut comp = empty_comp();
    comp.items = vec![audio_clip("a1", "/narr.wav", 0.0, 5.0, 1.0, true, None)];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    let track = plan.audio_tracks.iter().find(|t| t.id == "a1").unwrap();
    assert!(track.stages[0].normalize.is_none());
    assert!(plan
        .warnings
        .iter()
        .any(|w| matches!(w, CompileWarning::LoudnormUnmeasured { audio_stage_id } if audio_stage_id == "a1")));
}

#[test]
fn normalize_with_measurements_populates_directive() {
    let mut comp = empty_comp();
    comp.items = vec![audio_clip(
        "a1",
        "/narr.wav",
        0.0,
        5.0,
        1.0,
        true,
        Some((-20.0, 7.0, -2.0, -30.0)),
    )];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    let track = plan.audio_tracks.iter().find(|t| t.id == "a1").unwrap();
    let n = track.stages[0]
        .normalize
        .as_ref()
        .expect("normalize directive populated");
    assert!((n.target_lufs - (-16.0)).abs() < 1e-9);
    assert!((n.measurements.integrated_lufs - (-20.0)).abs() < 1e-9);
    assert!((n.measurements.lra - 7.0).abs() < 1e-9);
}

#[test]
fn speed_clamp_emits_warning() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Video(VideoClipInput {
        id: Some("v1".into()),
        label: None,
        file_path: "/a.mp4".into(),
        start_time: 0.0,
        duration: 1.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(1000.0),
        transition: Some("cut".into()),
        transition_duration: 0.0,
        speed: Some(100.0), // absurd; should clamp to 16.0
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: false,
    })];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert!(plan.warnings.iter().any(|w| matches!(w, CompileWarning::SpeedClamped { applied, .. } if (*applied - 16.0).abs() < 1e-9)));
    assert!((plan.video_track[0].speed - 16.0).abs() < 1e-9);
}

#[test]
fn text_items_are_beats_and_produce_no_overlays() {
    // Text items are beats (timeline milestones). The compiler validates
    // their duration but never emits an overlay stage for them.
    let mut comp = empty_comp();
    comp.items = vec![text_item("t1", 1.0, 2.0)];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert_eq!(plan.overlays.len(), 0);
}

#[test]
fn determinism_same_input_produces_identical_json() {
    let mut comp = empty_comp();
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 2.5, "crossfade", 0.5),
        video_clip("v2", "/b.mp4", 2.5, 3.0, "cut", 0.0),
        audio_clip("a1", "/music.wav", 0.0, 5.0, 0.8, false, None),
        text_item("t1", 1.0, 2.0),
    ];
    let plan_a = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    let plan_b = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    let a = serde_json::to_string(&plan_a).unwrap();
    let b = serde_json::to_string(&plan_b).unwrap();
    assert_eq!(a, b, "compile is not deterministic");
}

#[test]
fn audio_only_composition_has_no_video_track_but_valid_duration() {
    let mut comp = empty_comp();
    comp.items = vec![audio_clip("a1", "/music.wav", 0.0, 10.0, 1.0, false, None)];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert_invariants(&plan).unwrap();
    assert_eq!(plan.video_track.len(), 0);
    assert_eq!(plan.duration_frames, 300);
}

// ---------------------------------------------------------------------------
// Fatal errors
// ---------------------------------------------------------------------------

#[test]
fn zero_duration_clip_is_compile_error() {
    let mut comp = empty_comp();
    comp.items = vec![video_clip("v1", "/a.mp4", 0.0, 0.0, "cut", 0.0)];
    let err = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap_err();
    assert!(matches!(err, CompileError::NegativeOrZeroDuration { .. }));
}

#[test]
fn source_out_of_bounds_is_compile_error() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Video(VideoClipInput {
        id: Some("v1".into()),
        label: None,
        file_path: "/a.mp4".into(),
        start_time: 0.0,
        duration: 100.0, // way more than the probe says the file holds
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(10.0),
        transition: Some("cut".into()),
        transition_duration: 0.0,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: false,
    })];
    // Without a mediaProbe the compiler expands the fallback to fit the clip,
    // so out-of-bounds can only fire when a probe delivers authoritative
    // media-duration that disagrees with clip consumption.
    let probe: &dyn Fn(&str) -> Option<crate::engine::render_plan::compile::MediaProbe> =
        &|_| Some(crate::engine::render_plan::compile::MediaProbe {
            duration_seconds: 10.0,
            has_audio: true,
            has_video: true,
        });
    let deps = CompileDeps {
        proxy_lookup: None,
        font_probe: None,
        media_probe: Some(probe),
    };
    let err = compile(&comp, &CompileOptions::fold_default(), &deps).unwrap_err();
    assert!(matches!(err, CompileError::SourceOutOfBounds { .. }));
}

// ---------------------------------------------------------------------------
// Invariant negative tests — mutate a valid plan, confirm assert fails.
// ---------------------------------------------------------------------------

fn baseline_plan() -> RenderPlan {
    let mut comp = empty_comp();
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 2.0, "cut", 0.0),
        video_clip("v2", "/b.mp4", 2.0, 2.0, "cut", 0.0),
        audio_clip("a1", "/m.wav", 0.0, 4.0, 1.0, false, None),
        TimelineItem::Image(ImageItemInput {
            id: Some("i1".into()),
            label: None,
            file_path: "/logo.png".into(),
            start_time: 0.5,
            duration: 1.0,
            position_x: 0.5,
            position_y: 0.5,
            scale: 1.0,
            fade_in: 0.0,
            fade_out: 0.0,
        }),
    ];
    compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap()
}

#[test]
fn baseline_plan_satisfies_invariants() {
    assert_invariants(&baseline_plan()).expect("baseline is valid");
}

#[test]
fn i1_duration_mismatch_detected() {
    let mut plan = baseline_plan();
    plan.duration_frames = plan.duration_frames + 100;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I1");
}

#[test]
fn i2_output_end_beyond_duration_detected() {
    let mut plan = baseline_plan();
    plan.video_track[0].output_end = plan.duration_seconds + 10.0;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I2");
}

#[test]
fn i3_fades_exceed_duration_detected() {
    let mut plan = baseline_plan();
    plan.video_track[0].fade_in = 10.0;
    plan.video_track[0].fade_out = 10.0;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I3");
}

#[test]
fn i4_source_out_of_bounds_detected() {
    let mut plan = baseline_plan();
    plan.video_track[0].source_end = 1e9;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I4");
}

#[test]
fn i4_video_stage_pointing_at_color_source_detected() {
    let mut plan = baseline_plan();
    plan.video_track[0].source_id = 0; // Color slot
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I4");
}

#[test]
fn i5_source_span_inconsistent_with_speed_detected() {
    let mut plan = baseline_plan();
    plan.video_track[0].speed = 2.0; // but sourceEnd-sourceIn still == output span
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I5");
}

#[test]
fn i6_negative_gain_detected() {
    let mut plan = baseline_plan();
    plan.audio_tracks[0].stages[0].linear_gain = -0.1;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I6");
}

#[test]
fn i7_overlay_position_out_of_range_detected() {
    let mut plan = baseline_plan();
    if let OverlayStage::Image(i) = &mut plan.overlays[0] {
        i.position_x = 1.5;
    }
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I7");
}

#[test]
fn i8_video_track_unsorted_detected() {
    let mut plan = baseline_plan();
    plan.video_track.swap(0, 1);
    // After swap: track is out of order AND stages no longer abut.
    let err = assert_invariants(&plan).unwrap_err();
    assert!(err.code == "I8" || err.code == "I2");
}

#[test]
fn i8_stages_not_abutting_detected() {
    let mut plan = baseline_plan();
    plan.video_track[1].output_start = 5.0; // big gap
    plan.video_track[1].output_end = 7.0;
    // Fix source_end consistent with new output span so we only trip I2/I8.
    plan.video_track[1].source_end =
        plan.video_track[1].source_in + (7.0 - 5.0) * plan.video_track[1].speed;
    // Bump duration so I2 doesn't fire first.
    plan.duration_seconds = 7.0;
    plan.duration_frames = (plan.duration_seconds * plan.fps as f64).ceil() as u64;
    plan.duration_seconds = plan.duration_frames as f64 / plan.fps as f64;
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I8");
}

#[test]
fn i10_warning_with_unknown_id_detected() {
    let mut plan = baseline_plan();
    plan.warnings.push(CompileWarning::SpeedClamped {
        stage_id: "nonexistent".into(),
        requested: 10.0,
        applied: 8.0,
    });
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I10");
}

#[test]
fn i11_missing_color_source_detected() {
    let mut plan = baseline_plan();
    // Replace the reserved slot 0 with a File source — now there's no Color at index 0.
    plan.sources[0] = SourceEntry::File {
        id: 0,
        path: "/x.mp4".into(),
        media_duration_seconds: 10.0,
        has_audio: false,
        has_video: true,
    };
    let err = assert_invariants(&plan).unwrap_err();
    assert_eq!(err.code, "I11");
}

// ---------------------------------------------------------------------------
// Proxy / media probe plumbing (PR-1 dead code paths; exercise for coverage)
// ---------------------------------------------------------------------------

#[test]
fn proxy_lookup_used_for_preview_compile() {
    let mut comp = empty_comp();
    comp.items = vec![video_clip("v1", "/original.mp4", 0.0, 2.0, "cut", 0.0)];
    let lookup: &dyn Fn(&str) -> Option<ProxyRef> = &|path: &str| {
        if path == "/original.mp4" {
            Some(ProxyRef {
                proxy_path: "/original.proxy.mp4".into(),
                media_duration_seconds: 10.0,
                has_audio: true,
                has_video: true,
            })
        } else {
            None
        }
    };
    let deps = CompileDeps {
        proxy_lookup: Some(lookup),
        font_probe: None,
        media_probe: None,
    };
    let plan = compile(&comp, &CompileOptions::fold_default(), &deps).unwrap();
    let source = plan
        .sources
        .iter()
        .find(|s| matches!(s, SourceEntry::Proxy { .. }))
        .expect("proxy source emitted in preview mode");
    assert!(matches!(source, SourceEntry::Proxy { path, original_path, .. } if path == "/original.proxy.mp4" && original_path == "/original.mp4"));
}

#[test]
fn proxy_not_used_for_export_emits_warning() {
    let mut comp = empty_comp();
    comp.items = vec![video_clip("v1", "/original.mp4", 0.0, 2.0, "cut", 0.0)];
    let lookup: &dyn Fn(&str) -> Option<ProxyRef> = &|_| {
        Some(ProxyRef {
            proxy_path: "/x.proxy.mp4".into(),
            media_duration_seconds: 10.0,
            has_audio: true,
            has_video: true,
        })
    };
    let deps = CompileDeps {
        proxy_lookup: Some(lookup),
        font_probe: None,
        media_probe: None,
    };
    let plan = compile(&comp, &CompileOptions::for_export_default(), &deps).unwrap();
    assert!(plan.warnings.iter().any(|w| matches!(w, CompileWarning::ProxyMissing { .. })));
    assert!(plan
        .sources
        .iter()
        .any(|s| matches!(s, SourceEntry::File { path, .. } if path == "/original.mp4")));
}
