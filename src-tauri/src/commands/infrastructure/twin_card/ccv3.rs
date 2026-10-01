//! Character Card V3 export (SPEC.md 13): the flattened fields a
//! character-card loader reads, with the complete Twin Card preserved under
//! `data.extensions["twin-card"]`. The embedded card is authoritative; the
//! flattened fields are a convenience and lose information.
//!
//! Everything flattened is rendered from the card AS WRITTEN: a sealed
//! `knowledge` part contributes no facts to `system_prompt`, so sealing is
//! never undone by a plaintext copy beside it.

use serde_json::{json, Value};

use super::types::{CardChannel, CardVoiceView};
use crate::engine::twin_prompt::compile::{compile_sections, CoreSection};
use crate::engine::twin_prompt::input::resolve_channel;
use crate::engine::twin_prompt::{compile_twin_core, TwinPromptInput, DEFAULT_CHANNEL};
use crate::error::AppError;

const CCV3_SPEC: &str = "chara_card_v3";
const CCV3_VERSION: &str = "3.0";
/// The extension key the Twin Card travels under.
const EXTENSION_KEY: &str = "twin-card";

/// Whether a parsed file is a Character Card V3.
pub(super) fn is_ccv3(root: &Value) -> bool {
    root.get("spec").and_then(Value::as_str) == Some(CCV3_SPEC)
}

/// The Twin Card a Character Card V3 carries.
pub(super) fn embedded_card(root: &Value) -> Option<&Value> {
    root.get("data")?.get("extensions")?.get(EXTENSION_KEY)
}

/// Wrap a finished card (sealed parts sealed, signature in place).
pub(super) fn wrap(card: &Value) -> Result<Value, AppError> {
    let view: CardVoiceView = serde_json::from_value(card.clone())
        .map_err(|e| AppError::Internal(format!("twin card: read back the card for CCv3: {e}")))?;
    let identity = &view.identity;
    let voice = &view.voice;
    let description = [identity.role.as_deref(), identity.bio.as_deref()]
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    let examples: Vec<String> = resolve_channel(
        &voice.channels,
        |c| c.channel.as_str(),
        &voice.default_channel,
        &voice.default_channel,
    )
    .map(|channel| {
        channel
            .exemplars
            .iter()
            .map(|e| format!("<START>\n{{{{char}}}}: {}", e.text))
            .collect()
    })
    .unwrap_or_default();
    Ok(json!({
        "spec": CCV3_SPEC,
        "spec_version": CCV3_VERSION,
        "data": {
            "name": identity.name,
            "description": description,
            "personality": personality(&view),
            "scenario": "",
            "first_mes": "",
            "mes_example": examples.join("\n"),
            "creator_notes": "A Twin Card 1.0 exported from Personas. The complete card, which is authoritative, is under data.extensions[\"twin-card\"]; the fields here are a flattened convenience.",
            "system_prompt": compile_twin_core(&TwinPromptInput::from_card(&view, &voice.default_channel)),
            "post_history_instructions": "",
            "alternate_greetings": [],
            "group_only_greetings": [],
            "tags": [],
            "creator": "",
            "character_version": "",
            "extensions": { EXTENSION_KEY: card },
        },
    }))
}

/// The `generic` channel's style in the scale's level words (SPEC.md 13),
/// rendered by the reference renderer itself: the channel-voice section of a
/// view holding nothing but that style. `""` when there is no such style.
fn personality(view: &CardVoiceView) -> String {
    let Some(style) = view
        .voice
        .channels
        .iter()
        .find(|c| c.channel == DEFAULT_CHANNEL)
        .and_then(|c| c.style.clone())
    else {
        return String::new();
    };
    let mut style_only = view.clone();
    style_only.knowledge = None;
    style_only.voice.standing_directions = None;
    style_only.voice.channels = vec![CardChannel {
        channel: DEFAULT_CHANNEL.to_string(),
        style: Some(style),
        directives: String::new(),
        length_hint: None,
        constraints: Vec::new(),
        exemplars: Vec::new(),
    }];
    compile_sections(&TwinPromptInput::from_card(&style_only, DEFAULT_CHANNEL))
        .into_iter()
        .find(|(section, _)| *section == CoreSection::ChannelVoice)
        .map(|(_, body)| body)
        .unwrap_or_default()
}
