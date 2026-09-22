//! Twin style studio (spark `twin-presets`).
//!
//! A communication style is 8 dimensions on a 1-5 scale ([`TwinStyleDims`]).
//! Ten curated presets live in the TS catalog; this module owns the other half:
//!
//! - `twin_style_roll` draws 3 spread, coherent anchor vectors in Rust (an LLM
//!   asked for randomness collapses to a mode), lets the model nudge each
//!   non-pinned dimension by at most 1, name it and write a sample reply.
//! - `twin_style_materialize` writes voice / examples / constraints / length
//!   for each requested channel from that channel's target dimensions.
//! - `twin_style_apply` writes the accepted drafts in one transaction.
//!
//! Roll and materialize never write (census `model-output-persisted-without-preview`).
//! Every LLM reply passes ONE validation door with path-addressed errors that
//! feed a single repair retry.
//!
//! Layout: `sampler` (anchor draw + the coherence rule), `prompt` (the two
//! prompts), `door` (reply doors + inbound payload validation). The commands
//! below are adapters over them.

mod door;
pub(crate) mod prompt;
mod sampler;

use std::sync::Arc;

use rand::rngs::StdRng;
use rand::SeedableRng;
use tauri::State;

use crate::commands::infrastructure::twin::spawn_claude_with_prompt;
use crate::db::models::{
    StyleCandidate, StyleChannelTarget, StyleToneDraft, TwinStyle, TwinStyleDims, TwinStylePins,
    TwinTone,
};
use crate::db::repos::twin as repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::validation::contract::{check, ValidationError};
use crate::AppState;

use prompt::PersonContext;

/// Route inbound validation errors through the shared contract: `Ok` when
/// there are none, else one `Validation` error. Each message already carries
/// its path (`targets[1].channel: ...`), so the field is the operation.
fn reject(operation: &str, errors: Vec<String>) -> Result<(), AppError> {
    check(
        errors
            .into_iter()
            .map(|e| ValidationError::new(operation, "twin_style", e))
            .collect(),
    )
}

/// One generation with ONE repair retry told exactly what the door rejected.
/// Two failures is a generator that cannot hold the contract: that is the
/// model's unusable output, so `External`, and nothing was written.
async fn generate_with_repair<T>(
    operation: &str,
    build: impl Fn(Option<&str>) -> String,
    door: impl Fn(&str) -> Result<T, String>,
) -> Result<T, AppError> {
    let raw = spawn_claude_with_prompt(build(None)).await?;
    let first = match door(&raw) {
        Ok(value) => return Ok(value),
        Err(e) => e,
    };
    let repaired = spawn_claude_with_prompt(build(Some(&first))).await?;
    door(&repaired).map_err(|second| {
        AppError::External(format!(
            "{operation}: the model returned unusable output twice ({first}; then {second}). Nothing was saved."
        ))
    })
}

/// The dims of the twin's current style, read from the generic tone's
/// `style_json`. A hand-written tone (no style) or an unreadable value means
/// there is nothing to steer away from.
fn current_style_dims(generic: Option<&TwinTone>) -> Option<TwinStyleDims> {
    let raw = generic?.style_json.as_deref()?;
    serde_json::from_str::<TwinStyle>(raw).ok().map(|s| s.dims)
}

/// Roll 3 contrasting candidate styles for a twin. Preview only.
#[tauri::command]
pub async fn twin_style_roll(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    pins: TwinStylePins,
    avoid: Vec<TwinStyleDims>,
) -> Result<Vec<StyleCandidate>, AppError> {
    require_auth(&state).await?;
    reject("twin_style_roll", door::validate_roll_input(&pins, &avoid))?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let channels = repo::list_channels(&state.db, &twin_id)?;
    let generic = repo::get_tone_optional(&state.db, &twin_id, "generic")?;
    let current = current_style_dims(generic.as_ref());

    let draw =
        sampler::sample_anchors(&mut StdRng::from_entropy(), &pins, current.as_ref(), &avoid);
    let person = PersonContext::from_twin(&profile, &channels);
    generate_with_repair(
        "twin_style_roll",
        |repair| prompt::build_style_roll_prompt(&person, &draw, &pins, repair),
        |raw| door::roll_door(raw, &draw.anchors, &pins),
    )
    .await
}

/// Materialize a chosen style into per-channel tone drafts. Preview only.
#[tauri::command]
pub async fn twin_style_materialize(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    style: TwinStyle,
    targets: Vec<StyleChannelTarget>,
) -> Result<Vec<StyleToneDraft>, AppError> {
    require_auth(&state).await?;
    let mut errors = door::validate_style(&style);
    errors.extend(door::validate_targets(&targets));
    reject("twin_style_materialize", errors)?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let channels = repo::list_channels(&state.db, &twin_id)?;
    let person = PersonContext::from_twin(&profile, &channels);
    generate_with_repair(
        "twin_style_materialize",
        |repair| prompt::build_style_materialize_prompt(&person, &style, &targets, repair),
        |raw| door::materialize_door(raw, &targets),
    )
    .await
}

/// Serialize accepted drafts into whole tone rows. Each row's `style_json` is
/// the chosen style with THAT channel's dims, so a tone row always states the
/// dimensions it was written for.
fn styled_writes(
    style: &TwinStyle,
    tones: &[StyleToneDraft],
) -> Result<Vec<repo::StyledToneWrite>, AppError> {
    tones
        .iter()
        .map(|t| {
            let trimmed = |items: &[String]| -> Vec<String> {
                items.iter().map(|s| s.trim().to_string()).collect()
            };
            let channel_style = TwinStyle {
                dims: t.dims,
                ..style.clone()
            };
            let length_hint = t.length_hint.trim();
            Ok(repo::StyledToneWrite {
                channel: t.channel.trim().to_string(),
                voice_directives: t.voice_directives.trim().to_string(),
                examples_json: serde_json::to_string(&trimmed(&t.examples))?,
                constraints_json: serde_json::to_string(&trimmed(&t.constraints))?,
                length_hint: (!length_hint.is_empty()).then(|| length_hint.to_string()),
                style_json: serde_json::to_string(&channel_style)?,
            })
        })
        .collect()
}

/// Write accepted drafts (one transaction). Channels not listed stay untouched.
#[tauri::command]
pub async fn twin_style_apply(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    style: TwinStyle,
    tones: Vec<StyleToneDraft>,
) -> Result<Vec<TwinTone>, AppError> {
    require_auth(&state).await?;
    let mut errors = door::validate_style(&style);
    errors.extend(door::validate_apply_tones(&tones));
    reject("twin_style_apply", errors)?;

    let writes = styled_writes(&style, &tones)?;
    repo::apply_styled_tones(&state.db, &twin_id, &writes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn style() -> TwinStyle {
        TwinStyle {
            source: "preset".into(),
            preset_id: Some("warm".into()),
            name: "Warm and helpful".into(),
            summary: "Kind.".into(),
            avoid: "Sarcasm.".into(),
            dims: sampler::dims_from([3, 4, 2, 3, 3, 3, 2, 3]),
        }
    }

    #[test]
    fn styled_writes_carry_each_channels_dims_and_json_arrays() {
        let draft = StyleToneDraft {
            channel: " email ".into(),
            voice_directives: "Greet by name.".into(),
            examples: vec![" one ".into(), "two".into(), "three".into()],
            constraints: vec!["Never use emoji.".into()],
            length_hint: "Two or three short paragraphs".into(),
            dims: sampler::dims_from([4, 3, 2, 3, 4, 3, 1, 4]),
        };
        let writes = styled_writes(&style(), &[draft]).expect("writes");
        let w = &writes[0];
        assert_eq!(w.channel, "email");
        assert_eq!(w.examples_json, r#"["one","two","three"]"#);
        assert_eq!(w.constraints_json, r#"["Never use emoji."]"#);
        let back: TwinStyle = serde_json::from_str(&w.style_json).expect("style json");
        assert_eq!(back.name, "Warm and helpful");
        assert_eq!(back.dims.formality, 4, "the channel's dims, not the base");
        assert_eq!(back.dims.length, 4);
    }

    #[test]
    fn current_style_is_read_from_style_json_and_garbage_is_skipped() {
        let mut tone = TwinTone {
            id: "t".into(),
            twin_id: "tw".into(),
            channel: "generic".into(),
            voice_directives: String::new(),
            examples_json: None,
            constraints_json: None,
            length_hint: None,
            style_json: Some(serde_json::to_string(&style()).unwrap()),
            updated_at: String::new(),
        };
        assert_eq!(current_style_dims(Some(&tone)), Some(style().dims));
        tone.style_json = Some("not json".into());
        assert_eq!(current_style_dims(Some(&tone)), None);
        assert_eq!(current_style_dims(None), None);
    }
}
