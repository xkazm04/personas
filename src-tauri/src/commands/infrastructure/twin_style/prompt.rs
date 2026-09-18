//! The two style-studio prompts and the person context they share.

use crate::db::models::{
    StyleChannelTarget, TwinChannel, TwinProfile, TwinStyle, TwinStyleDims, TwinStylePins,
};

use super::sampler::{dims_array, pins_array, AnchorDraw, DIM_NAMES, DIM_SCALES};

/// English names of the ten curated presets (the TS catalog owns them). The
/// roll prompt forbids them so a rolled style never masquerades as a preset.
pub(crate) const PRESET_NAMES: [&str; 10] = [
    "Executive brief",
    "Polished professional",
    "Consultative expert",
    "Plainspoken and direct",
    "Warm and helpful",
    "Friendly casual",
    "Empathic listener",
    "Upbeat cheerleader",
    "Witty and wry",
    "Close and informal",
];

const BIO_CHARS: usize = 600;
const DIRECTIVES_CHARS: usize = 300;
const NOT_GIVEN: &str = "not given";

/// What both prompts know about the person behind the twin.
pub(crate) struct PersonContext {
    pub name: String,
    pub role: Option<String>,
    pub bio: Option<String>,
    pub training_directives: Option<String>,
    /// Rendered language labels, primary first. Never empty.
    pub languages: Vec<String>,
    /// "generic" plus each distinct bound channel type.
    pub channels: Vec<String>,
}

impl PersonContext {
    pub(crate) fn from_twin(profile: &TwinProfile, channels: &[TwinChannel]) -> Self {
        let mut channel_list = vec!["generic".to_string()];
        for c in channels {
            let kind = c.channel_type.trim();
            if !kind.is_empty() && !channel_list.iter().any(|k| k.eq_ignore_ascii_case(kind)) {
                channel_list.push(kind.to_string());
            }
        }
        Self {
            name: profile.name.trim().to_string(),
            role: non_empty(profile.role.as_deref()),
            bio: non_empty(profile.bio.as_deref()),
            training_directives: non_empty(profile.training_directives.as_deref()),
            languages: parse_languages(profile.languages.as_deref())
                .iter()
                .map(|code| language_label(code))
                .collect(),
            channels: channel_list,
        }
    }

    fn primary_language(&self) -> &str {
        self.languages
            .first()
            .map(String::as_str)
            .unwrap_or("English (en)")
    }
}

fn non_empty(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

fn clip(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// `profile.languages` is a JSON array of codes (`["en","cs"]`). A value that
/// is not one (hand-edited, older build) is read as a comma list rather than
/// dropped. Empty resolves to `["en"]`.
pub(crate) fn parse_languages(raw: Option<&str>) -> Vec<String> {
    let raw = raw.map(str::trim).unwrap_or("");
    let parsed: Vec<String> = match serde_json::from_str::<Vec<String>>(raw) {
        Ok(list) => list,
        Err(_) => raw.split(',').map(str::to_string).collect(),
    };
    let cleaned: Vec<String> = parsed
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if cleaned.is_empty() {
        vec!["en".to_string()]
    } else {
        cleaned
    }
}

/// Render a language for the model as "Name (code)": a bare two-letter code is
/// ambiguous to a model more often than a name is, and the code keeps it
/// exact. Codes outside this table (or values already stored as names) pass
/// through verbatim; the model reads those fine.
pub(crate) fn language_label(code: &str) -> String {
    let name = match code.to_ascii_lowercase().as_str() {
        "en" => "English",
        "cs" => "Czech",
        "sk" => "Slovak",
        "de" => "German",
        "fr" => "French",
        "es" => "Spanish",
        "it" => "Italian",
        "pt" => "Portuguese",
        "pl" => "Polish",
        "nl" => "Dutch",
        "ru" => "Russian",
        "uk" => "Ukrainian",
        "ja" => "Japanese",
        "ko" => "Korean",
        "zh" => "Chinese",
        "ar" => "Arabic",
        "hi" => "Hindi",
        "bn" => "Bengali",
        "id" => "Indonesian",
        "vi" => "Vietnamese",
        _ => return code.to_string(),
    };
    format!("{name} ({code})")
}

pub(crate) fn format_dims(d: &TwinStyleDims) -> String {
    DIM_NAMES
        .iter()
        .zip(dims_array(d))
        .map(|(name, v)| format!("{name} {v}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_pins(p: &TwinStylePins) -> String {
    let pinned: Vec<String> = DIM_NAMES
        .iter()
        .zip(pins_array(p))
        .filter_map(|(name, v)| v.map(|v| format!("{name} {v}")))
        .collect();
    if pinned.is_empty() {
        "none".to_string()
    } else {
        pinned.join(", ")
    }
}

fn scale_lines() -> String {
    DIM_SCALES.join("\n")
}

fn repair_block(repair: Option<&str>, hint: &str) -> String {
    repair
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(|r| {
            format!(
                "\n\nYour previous reply failed validation: {r}\n{hint} Reply again with ONLY the JSON object. No prose, no code fence."
            )
        })
        .unwrap_or_default()
}

/// The roll prompt. `repair` carries the door's errors on the single retry.
pub(crate) fn build_style_roll_prompt(
    person: &PersonContext,
    draw: &AnchorDraw,
    pins: &TwinStylePins,
    repair: Option<&str>,
) -> String {
    let [a, b, c] = &draw.anchors;
    let relaxed_line = if draw.relaxed {
        "\nNote: the pins constrain the space; variety may be limited."
    } else {
        ""
    };
    format!(
        "You design communication styles for a digital twin: an AI that answers messages on behalf of one real person.\n\
         Below are 3 starting points on 8 dimensions. For each, you may move any NON-pinned dimension by at most 1 to make it fit this person, then name and describe it. They are candidates to preview, not facts about the person.\n\
         \n\
         ## The person\n\
         Name: {name} | Role: {role} | Languages: {languages} | Channels: {channels}\n\
         Bio: {bio}\n\
         \n\
         ## Dimensions (1-5)\n\
         {scales}\n\
         \n\
         ## Starting points\n\
         A: {a}  B: {b}  C: {c}\n\
         Pinned (must stay exactly): {pins}{relaxed_line}\n\
         \n\
         ## Rules\n\
         - Never: formality>=4 with expressiveness>=4; humor 5 with formality 5; more than 3 dimensions at 1 or 5.\n\
         - Use the bio only where it gives a signal; never invent facts about the person.\n\
         - name: 2-4 evocative words, not any of: {presets}. summary: one sentence on how it sounds. avoid: one sentence on what it never does.\n\
         - sample: this style replying to \"Hi, could we move Thursday's meeting to next week?\" in {primary}, obeying its length dimension.\n\
         \n\
         Return ONLY this JSON: {{\"candidates\":[{{\"name\":\"\",\"summary\":\"\",\"avoid\":\"\",\"dims\":{{\"formality\":0,\"warmth\":0,\"humor\":0,\"energy\":0,\"length\":0,\"directness\":0,\"expressiveness\":0,\"detail\":0}},\"sample\":\"\"}}]}}{repair}",
        name = person.name,
        role = person.role.as_deref().unwrap_or(NOT_GIVEN),
        languages = person.languages.join(", "),
        channels = person.channels.join(", "),
        bio = person
            .bio
            .as_deref()
            .map(|b| clip(b, BIO_CHARS))
            .unwrap_or_else(|| NOT_GIVEN.to_string()),
        scales = scale_lines(),
        a = format_dims(a),
        b = format_dims(b),
        c = format_dims(c),
        pins = format_pins(pins),
        presets = PRESET_NAMES.join(", "),
        primary = person.primary_language(),
        repair = repair_block(
            repair,
            "Return exactly 3 candidates, in the order of starting points A, B, C.",
        ),
    )
}

/// The materialize prompt. `repair` carries the door's errors on the retry.
pub(crate) fn build_style_materialize_prompt(
    person: &PersonContext,
    style: &TwinStyle,
    targets: &[StyleChannelTarget],
    repair: Option<&str>,
) -> String {
    let channel_lines = targets
        .iter()
        .map(|t| format!("- {}: {}", t.channel.trim(), format_dims(&t.dims)))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "You write the style guide a digital twin follows when it answers messages as {name}.\n\
         Style: \"{style_name}\" - {summary} Never: {avoid}\n\
         Person: role {role}; languages {languages}; bio {bio}; standing directives {directives}\n\
         \n\
         ## Dimensions (1-5)\n\
         {scales}\n\
         \n\
         ## Channels and their target dimensions\n\
         {channel_lines}\n\
         \n\
         For EACH channel return:\n\
         - voiceDirectives: 3-6 imperative sentences in second person covering greeting, sign-off, sentence length, emoji, hedging and humor as the dimensions set them. Max 700 chars.\n\
         - examples: exactly 3 messages this twin would send on that channel, replying to (1) a scheduling request, (2) a question they can answer, (3) a request they decline. Written in {primary}, each max 400 chars, obeying the channel's length dimension.\n\
         - constraints: 3-6 short \"Always...\"/\"Never...\" rules, max 160 chars each.\n\
         Same person across channels, register shifted. Write as the person, in first person. Never invent employers, clients, places or events absent from the bio; use [placeholders].\n\
         \n\
         Return ONLY this JSON: {{\"tones\":[{{\"channel\":\"\",\"voiceDirectives\":\"\",\"examples\":[\"\",\"\",\"\"],\"constraints\":[\"\"]}}]}}{repair}",
        name = person.name,
        style_name = style.name.trim(),
        summary = style.summary.trim(),
        avoid = style.avoid.trim(),
        role = person.role.as_deref().unwrap_or(NOT_GIVEN),
        languages = person.languages.join(", "),
        bio = person
            .bio
            .as_deref()
            .map(|b| clip(b, BIO_CHARS))
            .unwrap_or_else(|| NOT_GIVEN.to_string()),
        directives = person
            .training_directives
            .as_deref()
            .map(|d| clip(d, DIRECTIVES_CHARS))
            .unwrap_or_else(|| NOT_GIVEN.to_string()),
        scales = scale_lines(),
        primary = person.primary_language(),
        repair = repair_block(
            repair,
            "Return exactly one entry per listed channel, using the channel names exactly as listed.",
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::infrastructure::twin_style::sampler::dims_from;

    fn person() -> PersonContext {
        PersonContext {
            name: "Ada".into(),
            role: None,
            bio: Some("x".repeat(900)),
            training_directives: None,
            languages: vec![language_label("cs"), language_label("en")],
            channels: vec!["generic".into(), "slack".into()],
        }
    }

    fn draw(relaxed: bool) -> AnchorDraw {
        AnchorDraw {
            anchors: [
                dims_from([3, 3, 3, 3, 3, 3, 3, 3]),
                dims_from([2, 4, 2, 3, 2, 2, 3, 2]),
                dims_from([4, 2, 3, 2, 4, 3, 2, 4]),
            ],
            relaxed,
        }
    }

    #[test]
    fn roll_prompt_carries_scales_anchors_pins_and_primary_language() {
        let pins = TwinStylePins {
            humor: Some(2),
            ..TwinStylePins::default()
        };
        let p = build_style_roll_prompt(&person(), &draw(false), &pins, None);
        for line in DIM_SCALES {
            assert!(p.contains(line), "missing scale line {line}");
        }
        assert!(p.contains("A: formality 3, warmth 3"));
        assert!(p.contains("Pinned (must stay exactly): humor 2"));
        assert!(p.contains("Role: not given"));
        assert!(p.contains("in Czech (cs), obeying"));
        assert!(p.contains("Witty and wry"));
        assert!(!p.contains("variety may be limited"));
        assert!(!p.contains(&"x".repeat(601)), "bio is capped at 600 chars");
        assert!(!p.contains("failed validation"));

        let relaxed = build_style_roll_prompt(
            &person(),
            &draw(true),
            &TwinStylePins::default(),
            Some("candidates[1].dims.humor: 5 exceeds anchor 3 + 1"),
        );
        assert!(relaxed.contains("Pinned (must stay exactly): none"));
        assert!(relaxed.contains("variety may be limited"));
        assert!(
            relaxed.contains("failed validation: candidates[1].dims.humor: 5 exceeds anchor 3 + 1")
        );
        assert!(relaxed.contains("order of starting points A, B, C"));
    }

    #[test]
    fn materialize_prompt_lists_every_channel_with_its_dims() {
        let style = TwinStyle {
            source: "preset".into(),
            preset_id: Some("warm-helpful".into()),
            name: "Warm and helpful".into(),
            summary: "Kind and clear.".into(),
            avoid: "Sarcasm.".into(),
            dims: dims_from([3, 4, 2, 3, 3, 3, 2, 3]),
        };
        let targets = vec![
            StyleChannelTarget {
                channel: "generic".into(),
                dims: dims_from([3, 4, 2, 3, 3, 3, 2, 3]),
            },
            StyleChannelTarget {
                channel: "email".into(),
                dims: dims_from([4, 3, 2, 3, 4, 3, 1, 4]),
            },
        ];
        let p = build_style_materialize_prompt(
            &person(),
            &style,
            &targets,
            Some("tones: channel \"email\" missing"),
        );
        assert!(p.contains("answers messages as Ada."));
        assert!(p.contains("Style: \"Warm and helpful\" - Kind and clear. Never: Sarcasm."));
        assert!(p.contains("- email: formality 4, warmth 3"));
        assert!(p.contains("standing directives not given"));
        assert!(p.contains("Written in Czech (cs)"));
        assert!(p.contains("tones: channel \"email\" missing"));
    }

    #[test]
    fn languages_parse_json_commas_and_default() {
        assert_eq!(parse_languages(Some(r#"["cs","en"]"#)), vec!["cs", "en"]);
        assert_eq!(parse_languages(Some("de, fr")), vec!["de", "fr"]);
        assert_eq!(parse_languages(None), vec!["en"]);
        assert_eq!(parse_languages(Some("[]")), vec!["en"]);
        assert_eq!(language_label("en"), "English (en)");
        assert_eq!(language_label("Klingon"), "Klingon");
    }
}
