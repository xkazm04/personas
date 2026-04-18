//! Regenerate the RenderPlan TypeScript bindings.
//!
//! Run with:
//!   cargo test --features desktop --test render_plan_bindings_gen
//!
//! The hidden ts-rs-generated tests inside the lib only run when the full
//! `--lib` test target compiles, which is currently blocked by pre-existing
//! broken tests in `credentials.rs`. This integration test is an escape
//! hatch that calls `TS::export_all()` explicitly so the IR bindings land
//! in `src-tauri/bindings/` regardless of lib-test health.

use app_lib::render_plan::{
    AudioStage, AudioTrack, CompileWarning, ImageOverlayStage, LoudnormMeasurements,
    NormalizeDirective, OverlapKind, OverlapNext, OverlayStage, RenderPlan, SourceEntry,
    TextOverlayStage, VideoStage,
};
use ts_rs::TS;

#[test]
fn export_render_plan_bindings() {
    // export_all() walks the type graph and writes every reachable TS type.
    // Calling it from the roots is sufficient — transitively covers every
    // field type.
    RenderPlan::export_all().expect("export RenderPlan");
    SourceEntry::export_all().expect("export SourceEntry");
    VideoStage::export_all().expect("export VideoStage");
    OverlapKind::export_all().expect("export OverlapKind");
    OverlapNext::export_all().expect("export OverlapNext");
    AudioTrack::export_all().expect("export AudioTrack");
    AudioStage::export_all().expect("export AudioStage");
    NormalizeDirective::export_all().expect("export NormalizeDirective");
    LoudnormMeasurements::export_all().expect("export LoudnormMeasurements");
    OverlayStage::export_all().expect("export OverlayStage");
    TextOverlayStage::export_all().expect("export TextOverlayStage");
    ImageOverlayStage::export_all().expect("export ImageOverlayStage");
    CompileWarning::export_all().expect("export CompileWarning");
}
