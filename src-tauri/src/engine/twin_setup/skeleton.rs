//! The plan's skeleton — code-owned. The planner fills goals INTO these slots
//! and never adds or removes one (wizard-flows/ai-driven-elicitation: the flow
//! owns structure, the model owns content).

/// The setup slots, in the order the setup stage works them — the same four
/// `SETUP_FOCUS_ORDER` names in `setupContract.ts`.
pub(crate) const SETUP_SLOTS: [&str; 4] = ["identity", "tone", "channels", "memories"];

/// The training topics. The ids MUST match `TRAINING_TOPIC_PRESETS` in
/// `src/features/plugins/twin/sub_training/useTrainingSession.ts`; each becomes
/// the slot `training:<id>`.
pub(crate) const TRAINING_TOPICS: [&str; 6] = [
    "background",
    "opinions",
    "communication",
    "values",
    "expertise",
    "personal",
];

/// The most goals the planner may keep open in one slot.
pub(crate) const MAX_GOALS_PER_SLOT: usize = 4;

/// Queued steps the engine keeps ahead of the live one, per stage.
pub(crate) const QUEUE_DEPTH: i64 = 3;

/// A goal reads as covered (steering only — never completion) at this coverage.
pub(crate) const COVERED_AT: f64 = 0.8;

/// A goal stops receiving questions after this many answers in a row with no
/// coverage gain.
pub(crate) const STALL_LIMIT: i64 = 3;

/// A gain at or under this counts as "no gain" for the stall counter.
pub(crate) const STALL_GAIN: f64 = 0.02;

/// The slot a training topic lives in.
pub(crate) fn training_slot(topic: &str) -> String {
    format!("training:{topic}")
}

/// The topic of a `training:<id>` slot, when it names a real preset.
pub(crate) fn topic_of_slot(slot: &str) -> Option<&'static str> {
    let id = slot.strip_prefix("training:")?;
    TRAINING_TOPICS.iter().copied().find(|t| *t == id)
}

/// A caller-supplied token trimmed and lowercased; blank reads as absent.
pub(crate) fn normalise_token(raw: Option<String>) -> Option<String> {
    raw.map(|t| t.trim().to_lowercase())
        .filter(|t| !t.is_empty())
}

/// Whether `id` is one of the training presets.
pub(crate) fn is_topic(id: &str) -> bool {
    TRAINING_TOPICS.contains(&id)
}

/// Whether `slot` is one the skeleton declares.
pub(crate) fn is_slot(slot: &str) -> bool {
    SETUP_SLOTS.contains(&slot) || topic_of_slot(slot).is_some()
}

/// The stage a slot belongs to.
pub(crate) fn stage_of_slot(slot: &str) -> &'static str {
    if slot.starts_with("training:") {
        "training"
    } else {
        "setup"
    }
}

/// Every skeleton slot, setup first.
pub(crate) fn all_slots() -> Vec<String> {
    SETUP_SLOTS
        .iter()
        .map(|s| (*s).to_string())
        .chain(TRAINING_TOPICS.iter().map(|t| training_slot(t)))
        .collect()
}

/// The default goal a slot gets when the planner leaves it empty, so every
/// slot always has something the plan can steer toward.
pub(crate) struct DefaultGoal {
    pub title: &'static str,
    pub intent: &'static str,
    pub criteria: &'static [&'static str],
}

pub(crate) fn default_goal(slot: &str) -> DefaultGoal {
    match slot {
        "identity" => DefaultGoal {
            title: "Who they are",
            intent: "A bio in their own words and a short role title.",
            criteria: &[
                "What they do and for whom",
                "How they introduce themselves",
                "A role title under 50 characters",
            ],
        },
        "tone" => DefaultGoal {
            title: "How they write",
            intent: "Checkable writing habits per channel, backed by real replies.",
            criteria: &[
                "Openings, sign-offs and message length",
                "Capitals, punctuation, emoji",
                "At least one real reply written by them",
            ],
        },
        "channels" => DefaultGoal {
            title: "Where they write and to whom",
            intent: "Which channels they use, who reads them, and what the twin must never say.",
            criteria: &[
                "The channels they use and the audience on each",
                "How they shift register between audiences",
                "At least one Never rule",
            ],
        },
        "memories" => DefaultGoal {
            title: "Things worth remembering",
            intent: "Stories, opinions and facts the twin can draw on.",
            criteria: &[
                "A specific story they retell",
                "An opinion they would argue for",
                "A fact about their work or life",
            ],
        },
        other => match topic_of_slot(other) {
            Some("background") => DefaultGoal {
                title: "Background",
                intent: "Their career path and current role.",
                criteria: &["Where they started", "What they do now"],
            },
            Some("opinions") => DefaultGoal {
                title: "Opinions",
                intent: "Views on the tools and ideas in their field.",
                criteria: &[
                    "A tool they recommend and why",
                    "Something they disagree with",
                ],
            },
            Some("communication") => DefaultGoal {
                title: "Communication",
                intent: "How they like to communicate.",
                criteria: &["Formality and directness", "What they avoid"],
            },
            Some("values") => DefaultGoal {
                title: "Values",
                intent: "The principles behind their decisions.",
                criteria: &["A principle they hold", "A decision it shaped"],
            },
            Some("expertise") => DefaultGoal {
                title: "Expertise",
                intent: "Deep knowledge in their area.",
                criteria: &[
                    "A hard problem they solved",
                    "Knowledge others ask them for",
                ],
            },
            _ => DefaultGoal {
                title: "Personal",
                intent: "Interests and life outside work.",
                criteria: &["A hobby or interest", "Something they enjoy"],
            },
        },
    }
}

/// The planner-facing brief for a training topic, written from the topic
/// prompts in `twin.training.topicPrompt*` (en.json).
pub(crate) fn topic_brief(topic: &str) -> &'static str {
    match topic {
        "background" => "Their professional background, career history and current role.",
        "opinions" => {
            "Their opinions on the technology, tools and frameworks they use or recommend."
        }
        "communication" => {
            "How they prefer to communicate: formality, humour, directness, and what they avoid."
        }
        "values" => "Their core values and principles, and what matters most to them at work.",
        "expertise" => "Their areas of expertise and the specialised knowledge only they have.",
        _ => "Their interests, hobbies and the things they enjoy outside work.",
    }
}

/// The training brief every training-stage question follows (from the old
/// guided setup's training task block).
pub(crate) const TRAINING_BRIEF: &str = "Ask one question on the topic that only they could \
answer, from their own life. A specific scene, a real example, or a realistic message to reply to \
works better than a general \"what do you think about\". Their answer is saved word for word as a \
memory, so ask for something worth keeping.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn twin_setup_skeleton_declares_ten_slots() {
        let slots = all_slots();
        assert_eq!(slots.len(), 10);
        assert!(slots.iter().all(|s| is_slot(s)));
        assert!(!is_slot("training:cooking"));
        assert!(!is_slot("avatar"));
        assert_eq!(stage_of_slot("training:values"), "training");
        assert_eq!(stage_of_slot("tone"), "setup");
        assert_eq!(topic_of_slot("training:personal"), Some("personal"));
    }
}
