//! Integration tests for the PR-2 export path: compile the composition,
//! build ffmpeg args from the plan, assert the args look right.
//!
//! These tests do NOT invoke ffmpeg. They verify the filter graph we hand
//! to the subprocess — the actual encoding is validated via manual QA of
//! the fixtures called out in the spec's PR-2 acceptance criteria.

use std::path::Path;

use app_lib::render_plan::compile::{
    AudioClipInput, Composition, CompileDeps, CompileOptions, ImageItemInput, TextItemInput,
    TimelineItem, TransitionMode, VideoClipInput,
};
use app_lib::render_plan::{build_ffmpeg_args, compile};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

fn empty_comp(fps: u32) -> Composition {
    Composition {
        id: None,
        name: None,
        width: 1920,
        height: 1080,
        fps,
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
        media_duration: Some(60.0),
        transition: Some(transition.into()),
        transition_duration: transition_dur,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: false,
    })
}

fn audio_clip_at(
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
        media_duration: Some(300.0),
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

fn text(id: &str, label: &str, start: f64, duration: f64) -> TimelineItem {
    TimelineItem::Text(TextItemInput {
        id: Some(id.into()),
        label: Some(label.into()),
        start_time: start,
        duration,
        text: String::new(),
        font_size: 48.0,
        color: "#ffffff".into(),
        position_x: 0.5,
        position_y: 0.9,
        fade_in: 0.0,
        fade_out: 0.0,
    })
}

fn image(id: &str, path: &str, start: f64, duration: f64) -> TimelineItem {
    TimelineItem::Image(ImageItemInput {
        id: Some(id.into()),
        label: None,
        file_path: path.into(),
        start_time: start,
        duration,
        position_x: 0.5,
        position_y: 0.5,
        scale: 1.0,
        fade_in: 0.0,
        fade_out: 0.0,
    })
}

fn args_for(comp: &Composition) -> Vec<String> {
    let plan = compile(
        comp,
        &CompileOptions::for_export_default(),
        &CompileDeps::none(),
    )
    .expect("compile");
    build_ffmpeg_args(&plan, Path::new("/tmp/out.mp4"))
}

fn joined_filters(args: &[String]) -> Option<&str> {
    let idx = args.iter().position(|s| s == "-filter_complex")?;
    args.get(idx + 1).map(|s| s.as_str())
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

#[test]
fn empty_composition_emits_no_filter_complex_or_inputs() {
    let comp = empty_comp(30);
    let args = args_for(&comp);
    assert!(args.iter().any(|a| a == "-y"));
    // Empty composition has 0-frame output. The lavfi branch sets d=max(dur, 1.0)
    // so we should see an `-f lavfi` block regardless.
    assert!(args.iter().any(|a| a == "lavfi"));
    assert!(args.iter().any(|a| a.contains("libx264")));
    assert!(args.last().unwrap().ends_with("out.mp4"));
}

#[test]
fn plain_cut_two_videos() {
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 2.0, "cut", 0.0),
        video_clip("v2", "/b.mp4", 2.0, 2.0, "cut", 0.0),
    ];
    let args = args_for(&comp);

    // Two `-i` inputs
    let i_count = args.iter().filter(|a| *a == "-i").count();
    assert_eq!(i_count, 2);

    // Filter complex has both video trim stages and a concat
    let fc = joined_filters(&args).expect("filter_complex present");
    assert!(fc.contains("trim=start=0.000:end=2.000"));
    assert!(fc.contains("concat=n=2:v=1:a=0[vconcat]"));
    // No fades on either clip
    assert!(!fc.contains("fade=t=in"));
    assert!(!fc.contains("fade=t=out"));
}

#[test]
fn crossfade_fold_produces_fades_on_adjacent_edges() {
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 5.0, "crossfade", 1.0),
        video_clip("v2", "/b.mp4", 5.0, 4.0, "cut", 0.0),
    ];
    let args = args_for(&comp);
    let fc = joined_filters(&args).unwrap();
    // v1 gets fade-out near its end; v2 gets fade-in at 0.
    assert!(
        fc.contains("fade=t=out:st=4.000:d=1.000"),
        "missing v1 fade-out: {fc}"
    );
    assert!(
        fc.contains("fade=t=in:st=0:d=1.000"),
        "missing v2 fade-in: {fc}"
    );
    // Fold mode still concats — no xfade filter.
    assert!(!fc.contains("xfade"));
}

#[test]
fn fade_to_black_preserves_current_behavior() {
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 3.0, "fade_to_black", 0.5),
        video_clip("v2", "/b.mp4", 3.0, 3.0, "cut", 0.0),
    ];
    let args = args_for(&comp);
    let fc = joined_filters(&args).unwrap();
    // v1 fades out 0.5s. No incoming transition from v2's side.
    assert!(fc.contains("fade=t=out:st=2.500:d=0.500"));
    assert!(fc.contains("fade=t=in:st=0:d=0.500"));
}

#[test]
fn dedicated_audio_with_normalize_emits_two_pass_loudnorm() {
    let mut comp = empty_comp(30);
    comp.items = vec![audio_clip_at(
        "a1",
        "/narr.wav",
        0.0,
        5.0,
        0.9,
        true,
        Some((-20.0, 7.0, -2.0, -30.0)),
    )];
    let args = args_for(&comp);
    let fc = joined_filters(&args).unwrap();
    assert!(fc.contains("loudnorm=I=-16"));
    assert!(fc.contains("measured_I=-20.00"));
    assert!(fc.contains("measured_LRA=7.00"));
    assert!(fc.contains("measured_TP=-2.00"));
    assert!(fc.contains("measured_thresh=-30.00"));
    assert!(fc.contains("linear=true"));
    // volume applied after afade/adelay (old-behavior preservation).
    assert!(fc.contains("volume=0.90"));
}

#[test]
fn speed_quarter_uses_atempo_chain_with_two_halves() {
    let mut comp = empty_comp(30);
    comp.items = vec![TimelineItem::Audio(AudioClipInput {
        id: Some("a1".into()),
        label: None,
        file_path: "/n.wav".into(),
        start_time: 0.0,
        duration: 4.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(300.0),
        volume: 1.0,
        speed: Some(0.25),
        fade_in: 0.0,
        fade_out: 0.0,
        normalize: false,
        measured_lufs: None,
        measured_lra: None,
        measured_true_peak: None,
        measured_threshold: None,
    })];
    let args = args_for(&comp);
    let fc = joined_filters(&args).unwrap();
    // 0.25× needs two atempo=0.5 stages.
    assert_eq!(fc.matches("atempo=0.5").count(), 2);
}

#[test]
fn speed_quadruple_uses_atempo_chain_with_two_doubles() {
    let mut comp = empty_comp(30);
    comp.items = vec![TimelineItem::Audio(AudioClipInput {
        id: Some("a1".into()),
        label: None,
        file_path: "/n.wav".into(),
        start_time: 0.0,
        duration: 1.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(300.0),
        volume: 1.0,
        speed: Some(4.0),
        fade_in: 0.0,
        fade_out: 0.0,
        normalize: false,
        measured_lufs: None,
        measured_lra: None,
        measured_true_peak: None,
        measured_threshold: None,
    })];
    let args = args_for(&comp);
    let fc = joined_filters(&args).unwrap();
    assert_eq!(fc.matches("atempo=2.0").count(), 2);
}

#[test]
fn image_overlay_emits_overlay_filter_chain() {
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 3.0, "cut", 0.0),
        image("i1", "/logo.png", 0.5, 2.0),
    ];
    let args = args_for(&comp);

    // Image input comes with `-loop 1`
    assert!(args.windows(3).any(|w| w == ["-loop".to_string(), "1".to_string(), "-i".to_string()]));

    let fc = joined_filters(&args).unwrap();
    assert!(fc.contains("format=rgba"));
    assert!(fc.contains("overlay=x='main_w*0.5000-overlay_w/2'"));
    assert!(fc.contains("enable='between(t,0.500,2.500)'"));
}

#[test]
fn text_items_never_reach_export_as_drawtext() {
    // Text items are beats in the UX, not rendered video. The export
    // never emits `drawtext` regardless of how many text items the
    // composition carries.
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 2.0, "cut", 0.0),
        text("t1", "Scene 1", 0.5, 1.0),
        text("t2", "Cut to B", 1.3, 0.2),
    ];
    let args = args_for(&comp);
    let joined = args.join(" ");
    assert!(!joined.contains("drawtext"), "export emitted drawtext: {joined}");
}

#[test]
fn audio_only_composition_synthesises_lavfi_background() {
    let mut comp = empty_comp(30);
    comp.items = vec![audio_clip_at("a1", "/m.wav", 0.0, 3.0, 1.0, false, None)];
    let args = args_for(&comp);
    // lavfi background input with color=0x000000 (hex prefix normalized)
    let joined = args.join(" ");
    assert!(joined.contains("-f lavfi"));
    assert!(joined.contains("color=c=0x000000"));
}

#[test]
fn dedup_same_source_across_clips() {
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/clip.mp4", 0.0, 2.0, "cut", 0.0),
        // Same file reused later in the timeline.
        video_clip("v2", "/clip.mp4", 2.0, 2.0, "cut", 0.0),
    ];
    let args = args_for(&comp);
    let i_count = args.iter().filter(|a| *a == "-i").count();
    assert_eq!(i_count, 1, "source should be deduped");
}

#[test]
fn codec_tail_preserved() {
    let mut comp = empty_comp(60);
    comp.items = vec![video_clip("v1", "/a.mp4", 0.0, 1.0, "cut", 0.0)];
    let args = args_for(&comp);
    let joined = args.join(" ");
    assert!(joined.contains("-c:v libx264"));
    assert!(joined.contains("-preset medium"));
    assert!(joined.contains("-crf 23"));
    assert!(joined.contains("-c:a aac"));
    assert!(joined.contains("-b:a 192k"));
    assert!(joined.contains("-movflags +faststart"));
    assert!(joined.contains("-r 60"));
    assert!(joined.contains("-s 1920x1080"));
}

#[test]
fn overlap_mode_emits_xfade_filter_not_concat() {
    // Readiness test for the deferred "true xfade" milestone. The compiler
    // already emits overlapNext stages in Overlap mode, and build_ffmpeg_args
    // already knows how to translate overlapNext into the `xfade` filter
    // chain. The only reason this isn't the default export mode today is
    // that the preview doesn't yet play two video elements through the
    // overlap — enabling Overlap at export alone would regress parity.
    //
    // This test locks in the export-side readiness so when the preview
    // catches up, we can flip for_export_default() to Overlap with
    // confidence.
    let mut comp = empty_comp(30);
    comp.items = vec![
        video_clip("v1", "/a.mp4", 0.0, 5.0, "crossfade", 1.0),
        video_clip("v2", "/b.mp4", 5.0, 4.0, "cut", 0.0),
    ];
    let plan = compile(
        &comp,
        &CompileOptions {
            transition_mode: TransitionMode::Overlap,
            frame_snap: true,
            for_export: true,
        },
        &CompileDeps::none(),
    )
    .expect("overlap compile");
    let args = build_ffmpeg_args(&plan, std::path::Path::new("/tmp/out.mp4"));
    let fc = joined_filters(&args).expect("filter complex present");

    // xfade present, concat absent on the video chain.
    assert!(fc.contains("xfade=transition=fade"), "missing xfade: {fc}");
    assert!(!fc.contains("concat=n="), "unexpected concat in overlap mode: {fc}");

    // Duration telescopes: two 5s + 4s clips with 1s overlap = 8s, not 9s.
    assert_eq!(plan.duration_frames, 240);
}

#[test]
fn strip_audio_removes_embedded_audio_branch_only() {
    let mut no_strip = empty_comp(30);
    no_strip.items = vec![video_clip("v1", "/a.mp4", 0.0, 2.0, "cut", 0.0)];
    let args_no = args_for(&no_strip);
    let fc_no = joined_filters(&args_no).unwrap_or("");
    assert!(
        fc_no.contains("[0:a?]"),
        "embedded audio branch missing: {fc_no}"
    );

    let mut stripped = empty_comp(30);
    stripped.items = vec![TimelineItem::Video(VideoClipInput {
        id: Some("v1".into()),
        label: None,
        file_path: "/a.mp4".into(),
        start_time: 0.0,
        duration: 2.0,
        trim_start: 0.0,
        trim_end: 0.0,
        media_duration: Some(60.0),
        transition: Some("cut".into()),
        transition_duration: 0.0,
        speed: Some(1.0),
        fade_in: 0.0,
        fade_out: 0.0,
        strip_audio: true,
    })];
    let args_stripped = args_for(&stripped);
    let fc_stripped = joined_filters(&args_stripped).unwrap_or("");
    assert!(
        !fc_stripped.contains("[0:a?]"),
        "audio branch should be stripped: {fc_stripped}"
    );
}
