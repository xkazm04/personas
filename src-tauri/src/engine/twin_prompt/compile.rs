//! The core block: RENDERER.md `twin-card.render/1`. Six sections in a fixed
//! order, each omitted when it has nothing to say, every limit a named const.

use super::input::{
    DashPolicy, GrammaticalGender, KnowledgeKind, PromptFact, TwinPromptInput, DEFAULT_CHANNEL,
};
use crate::commands::infrastructure::twin_style::prompt::language_label;
use crate::commands::infrastructure::twin_voice::DASH_RULE;
use crate::db::models::TwinStyleDims;

/// Exemplars rendered for the resolved channel (RENDERER.md 4).
pub const EXEMPLARS_MAX: usize = 5;
/// Characters per exemplar, the ellipsis of a cut included.
pub const EXEMPLAR_CHARS: usize = 500;
/// Constraints rendered for the resolved channel (RENDERER.md 4).
pub const CONSTRAINTS_MAX: usize = 8;
/// Characters per constraint, the ellipsis of a cut included.
pub const CONSTRAINT_CHARS: usize = 160;
/// Facts, then memories, rendered (RENDERER.md 5).
pub const FACTS_MAX: usize = 12;
/// Characters per fact or memory line, the ellipsis of a cut included. A
/// memory may run to 8000 characters in a card; one line of the block may not.
pub const FACT_MAX_CHARS: usize = 300;

/// Marks a cut exemplar or constraint, so a shortened message never reads as
/// whole.
const ELLIPSIS: char = '…';

/// Languages whose words change with the speaker's grammatical gender when
/// they talk about themselves ("byl jsem" / "byla jsem", "je suis content" /
/// "contente"). The identity section adds its gender line only when the
/// person writes in one of them (primary subtag, lowercase).
const GENDER_INFLECTING_LANGUAGES: [&str; 24] = [
    "ar", "be", "bg", "bs", "ca", "cs", "es", "fr", "he", "hi", "hr", "it", "lt", "lv", "mk", "pl",
    "pt", "ro", "ru", "sk", "sl", "sr", "uk", "ur",
];

/// The `twin-card.style/1` level words (SPEC.md 5.1), one row per dimension
/// in wire order, levels 1 to 5. Normative: a renderer that describes style
/// MUST use them.
const STYLE_SCALE: [(&str, [&str; 5]); 8] = [
    (
        "Formality",
        ["intimate", "casual", "consultative", "formal", "ceremonial"],
    ),
    (
        "Warmth",
        ["detached", "neutral", "cordial", "warm", "affectionate"],
    ),
    ("Humor", ["none", "dry", "light", "playful", "irreverent"]),
    (
        "Energy",
        ["matter-of-fact", "calm", "engaged", "upbeat", "exuberant"],
    ),
    (
        "Length",
        ["one-liner", "brief", "medium", "full", "expansive"],
    ),
    (
        "Directness",
        ["blunt", "direct", "balanced", "softened", "indirect"],
    ),
    (
        "Expressiveness",
        [
            "none",
            "rare",
            "occasional",
            "frequent",
            "heavy (emoji, exclamations, slang)",
        ],
    ),
    (
        "Detail",
        [
            "headline",
            "key points",
            "explained",
            "thorough",
            "exhaustive and structured",
        ],
    ),
];

/// The sections of the core block, in RENDERER.md order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoreSection {
    Identity,
    Languages,
    StandingDirections,
    ChannelVoice,
    Facts,
    QualityRules,
}

/// The core block every drafting lane embeds.
pub fn compile_twin_core(input: &TwinPromptInput) -> String {
    compile_sections(input)
        .into_iter()
        .map(|(_, body)| body)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Each section that has something to say, in order, with its kind.
pub fn compile_sections(input: &TwinPromptInput) -> Vec<(CoreSection, String)> {
    [
        (CoreSection::Identity, identity(input)),
        (CoreSection::Languages, languages(input)),
        (CoreSection::StandingDirections, standing_directions(input)),
        (CoreSection::ChannelVoice, channel_voice(input)),
        (CoreSection::Facts, facts(input)),
        (CoreSection::QualityRules, quality_rules(input)),
    ]
    .into_iter()
    .filter_map(|(section, body)| body.map(|b| (section, b)))
    .collect()
}

/// Section 1: who is writing.
fn identity(input: &TwinPromptInput) -> Option<String> {
    let id = &input.identity;
    let name = id.name.trim();
    if name.is_empty() {
        return None;
    }
    let mut out = format!("You are writing as {name}");
    if let Some(role) = non_empty(id.role.as_deref()) {
        out.push_str(", ");
        out.push_str(role.trim_end_matches('.'));
    }
    out.push('.');
    if let Some(bio) = non_empty(id.bio.as_deref()) {
        out.push('\n');
        out.push_str(bio);
    }
    // Only masculine and feminine say anything: `neutral` cannot be told
    // apart from "never picked" (see `GrammaticalGender::from_pronouns`).
    if let Some(gender) = id
        .grammatical_gender
        .filter(|g| *g != GrammaticalGender::Neutral)
    {
        if id.languages.iter().any(|code| inflects_by_gender(code)) {
            out.push_str(&format!(
                "\nUse {} grammatical forms when {name} refers to themselves.",
                gender.word()
            ));
        }
    }
    Some(out)
}

/// Section 2: the languages they write in.
fn languages(input: &TwinPromptInput) -> Option<String> {
    let labels: Vec<String> = input
        .identity
        .languages
        .iter()
        .map(|code| code.trim())
        .filter(|code| !code.is_empty())
        .map(language_label)
        .collect();
    if labels.is_empty() {
        return None;
    }
    Some(format!(
        "{} writes in {}. Reply in the language of the message being answered unless told otherwise.",
        display_name(input),
        join_and(&labels)
    ))
}

/// Section 3: their standing directions, verbatim.
fn standing_directions(input: &TwinPromptInput) -> Option<String> {
    non_empty(input.standing_directions.as_deref()).map(|directions| {
        format!(
            "Standing directions from {}, for every draft:\n{directions}",
            display_name(input)
        )
    })
}

/// Section 4: the resolved channel's voice. Exemplars and constraints render even
/// when the directives are empty.
fn channel_voice(input: &TwinPromptInput) -> Option<String> {
    let voice = input.voice.as_ref()?;
    let name = display_name(input);
    let on = on_channel(&voice.channel);
    let mut parts: Vec<String> = Vec::new();

    let directives = voice.directives.trim();
    if !directives.is_empty() {
        parts.push(directives.to_string());
    }
    if let Some(length) = non_empty(voice.length_hint.as_deref()) {
        parts.push(format!("Length: {length}"));
    }
    if directives.is_empty() {
        if let Some(dims) = &voice.style {
            parts.extend(style_lines(dims));
        }
    }

    let exemplars = capped_items(&voice.exemplars, EXEMPLARS_MAX, EXEMPLAR_CHARS);
    if !exemplars.is_empty() {
        let mut block = format!(
            "Messages {name} actually wrote{on}. Match their register, length and habits, but never copy them:"
        );
        for exemplar in &exemplars {
            block.push_str("\n---\n");
            block.push_str(exemplar);
        }
        block.push_str("\n---");
        parts.push(block);
    }

    let constraints = capped_items(&voice.constraints, CONSTRAINTS_MAX, CONSTRAINT_CHARS);
    if !constraints.is_empty() {
        let mut block = format!("Do and don't{on}:");
        for constraint in &constraints {
            block.push_str("\n- ");
            block.push_str(constraint);
        }
        parts.push(block);
    }

    if parts.is_empty() {
        return None;
    }
    Some(format!("How {name} writes{on}:\n{}", parts.join("\n")))
}

/// Section 5: what they have confirmed about themselves.
fn facts(input: &TwinPromptInput) -> Option<String> {
    let lines = ordered_knowledge(&input.knowledge);
    if lines.is_empty() {
        return None;
    }
    let mut out = format!(
        "What {} has confirmed about themselves. Stay consistent with it, and state nothing verifiable that neither this nor the material you are given supports:",
        display_name(input)
    );
    for line in &lines {
        out.push_str("\n- ");
        out.push_str(line);
    }
    Some(out)
}

/// Section 6: the register every draft is written in.
fn quality_rules(input: &TwinPromptInput) -> Option<String> {
    let rules = &input.quality;
    let mut lines: Vec<String> = Vec::new();
    if let Some(register) = non_empty(Some(&rules.register)) {
        lines.push(register.to_string());
    }
    let avoid = quoted_list(&rules.avoid_phrases);
    if !avoid.is_empty() {
        lines.push(format!(
            "Leave out the words and constructions people now read as machine-written: {avoid}."
        ));
    }
    let fillers = quoted_list(&rules.filler_openers);
    if !fillers.is_empty() {
        lines.push(format!(
            "Never open with filler that carries nothing, like {fillers}."
        ));
    }
    if rules.dash_policy == DashPolicy::Avoid {
        lines.push(DASH_RULE.to_string());
    }
    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

/// RENDERER.md 5 selection: facts, then memories, each by importance then
/// recency, at most [`FACTS_MAX`], one line each, cut to [`FACT_MAX_CHARS`].
/// The sort is stable, so items with no timestamp keep the order they
/// arrived in.
pub(crate) fn ordered_knowledge(items: &[PromptFact]) -> Vec<String> {
    let mut usable: Vec<&PromptFact> = items
        .iter()
        .filter(|f| !f.content.trim().is_empty())
        .collect();
    usable.sort_by(|a, b| {
        kind_rank(a.kind)
            .cmp(&kind_rank(b.kind))
            .then(b.importance.cmp(&a.importance))
            .then(b.observed_at.cmp(&a.observed_at))
    });
    usable
        .into_iter()
        .take(FACTS_MAX)
        .map(|f| cut_at_word(&one_line(&f.content), FACT_MAX_CHARS).0)
        .collect()
}

fn kind_rank(kind: KnowledgeKind) -> u8 {
    match kind {
        KnowledgeKind::Fact => 0,
        KnowledgeKind::Memory => 1,
    }
}

/// Cut `text` to at most `max_chars` characters, the ellipsis included. The
/// cut lands on the last word break in the second half of the budget, or
/// hard when there is none, so one long unbroken run still keeps most of its
/// text. Returns the text and whether anything was removed.
pub(crate) fn cut_at_word(text: &str, max_chars: usize) -> (String, bool) {
    if text.chars().count() <= max_chars {
        return (text.to_string(), false);
    }
    let budget = max_chars.saturating_sub(1);
    let end = text
        .char_indices()
        .nth(budget)
        .map_or(text.len(), |(at, _)| at);
    let head = &text[..end];
    let earliest_break = head.char_indices().nth(budget / 2).map_or(0, |(at, _)| at);
    let kept = if text[end..].starts_with(char::is_whitespace) {
        // The cut already falls between two words.
        head
    } else {
        match head.rfind(char::is_whitespace) {
            Some(at) if at >= earliest_break => &head[..at],
            _ => head,
        }
    };
    let mut out = kept.trim_end().to_string();
    out.push(ELLIPSIS);
    (out, true)
}

/// Trimmed, non-empty items, at most `max_items`, each cut to `max_chars`.
fn capped_items(items: &[String], max_items: usize, max_chars: usize) -> Vec<String> {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .take(max_items)
        .map(|item| cut_at_word(item, max_chars).0)
        .collect()
}

/// One line per style dimension, in the scale's own words.
fn style_lines(dims: &TwinStyleDims) -> Vec<String> {
    let values = [
        dims.formality,
        dims.warmth,
        dims.humor,
        dims.energy,
        dims.length,
        dims.directness,
        dims.expressiveness,
        dims.detail,
    ];
    STYLE_SCALE
        .iter()
        .zip(values)
        .filter_map(|((label, words), value)| {
            let word = words.get(usize::from(value).checked_sub(1)?)?;
            Some(format!("{label}: {word}."))
        })
        .collect()
}

fn inflects_by_gender(code: &str) -> bool {
    let primary = code
        .trim()
        .split(['-', '_'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    GENDER_INFLECTING_LANGUAGES.contains(&primary.as_str())
}

/// The person's name as the block uses it after the identity line.
fn display_name(input: &TwinPromptInput) -> &str {
    let name = input.identity.name.trim();
    if name.is_empty() {
        "the person"
    } else {
        name
    }
}

/// `" on email"`, or nothing for the default channel.
fn on_channel(channel: &str) -> String {
    let channel = channel.trim();
    if channel.is_empty() || channel == DEFAULT_CHANNEL {
        String::new()
    } else {
        format!(" on {channel}")
    }
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|s| !s.is_empty())
}

fn one_line(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `"a", "b", "c"`: quoted, because an item may carry its own comma.
fn quoted_list(items: &[String]) -> String {
    items
        .iter()
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| format!("\"{item}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

/// `A`, `A and B`, `A, B and C`.
fn join_and(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [only] => only.clone(),
        [head @ .., last] => format!("{} and {last}", head.join(", ")),
    }
}
