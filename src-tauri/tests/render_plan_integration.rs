//! Integration-test smoke coverage for the RenderPlan IR.
//!
//! The canonical test suite lives inline at
//! `src/engine/render_plan/tests.rs` and runs under `cargo test --lib`
//! once that build path is healthy. This integration test is a parallel
//! shallow-coverage entry point so the IR can be verified independently
//! of the library's global test-target compilation health.

use app_lib::render_plan::compile::{
    AudioClipInput, Composition, CompileDeps, CompileOptions, ProxyRef, TextItemInput,
    TimelineItem, TransitionMode, VideoClipInput,
};
use app_lib::render_plan::{
    assert_invariants, compile, CompileWarning, OverlapKind, OverlayStage, SourceEntry,
    RENDER_PLAN_SCHEMA_VERSION,
};

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

#[test]
fn schema_version_exposed() {
    assert_eq!(RENDER_PLAN_SCHEMA_VERSION, 1);
}

#[test]
fn empty_composition_compiles() {
    let plan = compile(
        &empty_comp(),
        &CompileOptions::fold_default(),
        &CompileDeps::none(),
    )
    .unwrap();
    assert_invariants(&plan).unwrap();
    assert_eq!(plan.duration_frames, 0);
    assert!(matches!(plan.sources[0], SourceEntry::Color { .. }));
}

#[test]
fn worked_example_fold() {
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
    .unwrap();
    assert_invariants(&plan).unwrap();
    assert_eq!(plan.duration_frames, 270);
    assert_eq!(plan.video_track.len(), 2);
    assert!((plan.video_track[0].fade_out - 1.0).abs() < 1e-9);
    assert!((plan.video_track[1].fade_in - 1.0).abs() < 1e-9);
}

#[test]
fn worked_example_overlap() {
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
    .unwrap();
    assert_invariants(&plan).unwrap();
    assert_eq!(plan.duration_frames, 240);
    let v1 = &plan.video_track[0];
    let overlap = v1.overlap_next.as_ref().expect("v1 carries overlap_next");
    assert_eq!(overlap.kind, OverlapKind::Crossfade);
    assert!((overlap.duration_seconds - 1.0).abs() < 1e-9);
}

#[test]
fn determinism_stable_across_compiles() {
    let mut comp = empty_comp();
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 2.5, "crossfade", 0.5),
        video_clip("v2", "/b.mp4", 2.5, 3.0, "cut", 0.0),
    ];
    let a = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    let b = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

#[test]
fn normalize_unmeasured_emits_warning() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Audio(AudioClipInput {
        id: Some("a1".into()),
        label: None,
        file_path: "/n.wav".into(),
        start_time: 0.0,
        duration: 3.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(10.0),
        volume: 1.0,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        normalize: true,
        measured_lufs: None,
        measured_lra: None,
        measured_true_peak: None,
        measured_threshold: None,
    })];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert!(plan.warnings.iter().any(|w| matches!(w, CompileWarning::LoudnormUnmeasured { .. })));
}

#[test]
fn text_font_missing_omits_overlay() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Text(TextItemInput {
        id: Some("t1".into()),
        label: None,
        start_time: 0.0,
        duration: 2.0,
        text: "hello".into(),
        font_size: 32.0,
        color: "#fff".into(),
        position_x: 0.5,
        position_y: 0.5,
        fade_in: 0.0,
        fade_out: 0.0,
    })];
    let never_font: &dyn Fn(&str) -> bool = &|_| false;
    let deps = CompileDeps {
        proxy_lookup: None,
        font_probe: Some(never_font),
        media_probe: None,
    };
    let plan = compile(&comp, &CompileOptions::fold_default(), &deps).unwrap();
    assert_eq!(plan.overlays.len(), 0);
    assert!(plan.warnings.iter().any(|w| matches!(w, CompileWarning::TextFontMissing { .. })));
}

#[test]
fn proxy_lookup_preferred_in_preview_mode() {
    let mut comp = empty_comp();
    comp.items = vec![video_clip("v1", "/orig.mp4", 0.0, 2.0, "cut", 0.0)];
    let lookup: &dyn Fn(&str) -> Option<ProxyRef> = &|_| {
        Some(ProxyRef {
            proxy_path: "/orig.proxy.mp4".into(),
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
    let plan = compile(&comp, &CompileOptions::fold_default(), &deps).unwrap();
    assert!(plan.sources.iter().any(|s| matches!(s, SourceEntry::Proxy { .. })));
}

#[test]
fn text_overlay_renders_with_inter_by_default() {
    let mut comp = empty_comp();
    comp.items = vec![TimelineItem::Text(TextItemInput {
        id: Some("t1".into()),
        label: None,
        start_time: 0.0,
        duration: 2.0,
        text: "hi".into(),
        font_size: 32.0,
        color: "#fff".into(),
        position_x: 0.5,
        position_y: 0.5,
        fade_in: 0.0,
        fade_out: 0.0,
    })];
    let plan = compile(&comp, &CompileOptions::fold_default(), &CompileDeps::none()).unwrap();
    assert_eq!(plan.overlays.len(), 1);
    match &plan.overlays[0] {
        OverlayStage::Text(t) => assert_eq!(t.font_family, "Inter"),
        _ => panic!("expected text overlay"),
    }
}
