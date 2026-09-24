//! The three prompts: the deep pass (`plan`), and the two per-answer calls
//! (`assess`, `refill`).
//!
//! Every prompt carries the same rule sections the old guided-setup prompt
//! did — how to ask, the `write` / `incoming` contract, the suggestion rules,
//! the two languages, the plain voice — plus the transcript, so nothing
//! already answered or declined is asked again. Lists are capped (see the
//! consts) so a prompt stays well under ~6k tokens.

use std::collections::HashMap;

use crate::commands::infrastructure::twin::{
    setup_languages, setup_task_block, setup_tone_block, setup_tone_channels,
};
use crate::db::models::{
    SetupGoal, SetupKindStat, SetupObservation, SetupReadiness, SetupStep, TwinChannel,
    TwinPendingMemory, TwinProfile, TwinTone,
};
use crate::db::repos::twin as twin_repo;
use crate::db::DbPool;
use crate::error::AppError;
use personas_core::utils::text::truncate_on_char_boundary;

use super::skeleton;

/// Approved memories shown as "already known" (as the old prompt did).
const MEMORY_LIMIT: usize = 8;
/// Preview length for a memory line.
const PREVIEW_CHARS: usize = 200;
/// Bio length in the compact (assess / refill) context.
const COMPACT_BIO_CHARS: usize = 300;
/// A question or answer as replayed in a transcript.
const EXCHANGE_Q_CHARS: usize = 160;
const EXCHANGE_A_CHARS: usize = 240;
/// The deep pass sees this many transcript steps; the per-answer calls fewer.
pub(crate) const PLAN_TRANSCRIPT: i64 = 30;
pub(crate) const RECENT_EXCHANGES: usize = 6;

/// What is on file for the twin, read once per job.
pub(crate) struct OnFile {
    pub name: String,
    pub role: String,
    pub bio: String,
    pub guide_language: String,
    pub twin_language: String,
    pub tone_block: String,
    pub channel_block: String,
    pub memory_count: usize,
    pub memory_block: String,
    pub tone_channels: Vec<String>,
}

impl OnFile {
    pub(crate) fn load(
        pool: &DbPool,
        twin_id: &str,
        locale: Option<&str>,
    ) -> Result<Self, AppError> {
        let profile = twin_repo::get_profile_by_id(pool, twin_id)?;
        let tones = twin_repo::list_tones(pool, twin_id)?;
        let channels = twin_repo::list_channels(pool, twin_id)?;
        let memories = twin_repo::list_pending_memories(pool, twin_id, Some("approved"), None)?;
        Ok(Self::from_parts(
            &profile, &tones, &channels, &memories, locale,
        ))
    }

    pub(crate) fn from_parts(
        profile: &TwinProfile,
        tones: &[TwinTone],
        channels: &[TwinChannel],
        memories: &[TwinPendingMemory],
        locale: Option<&str>,
    ) -> Self {
        let (guide_language, twin_language) = setup_languages(profile, locale);
        let text_or = |v: Option<&str>, fallback: &str| {
            v.map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(fallback)
                .to_string()
        };
        let channel_block = if channels.is_empty() {
            "Channels they're connected on: none yet.".to_string()
        } else {
            let lines = channels
                .iter()
                .map(|c| {
                    let label = text_or(c.label.as_deref(), "unlabelled");
                    let state = if c.is_active { "active" } else { "paused" };
                    format!("- {} ({label}, {state})", c.channel_type)
                })
                .collect::<Vec<_>>()
                .join("\n");
            format!("Channels they're connected on:\n{lines}")
        };
        let memory_block = memories
            .iter()
            .take(MEMORY_LIMIT)
            .map(|m| {
                let head = m
                    .title
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(|t| format!("{t}: "))
                    .unwrap_or_default();
                format!(
                    "- {head}{}",
                    truncate_on_char_boundary(m.content.trim(), PREVIEW_CHARS)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        Self {
            name: profile.name.trim().to_string(),
            role: text_or(profile.role.as_deref(), "not given"),
            bio: text_or(profile.bio.as_deref(), "nothing written yet"),
            guide_language,
            twin_language,
            tone_block: setup_tone_block(tones),
            channel_block,
            memory_count: memories.len(),
            memory_block,
            tone_channels: setup_tone_channels(channels, tones),
        }
    }

    fn render_full(&self) -> String {
        let memories = if self.memory_block.is_empty() {
            "Approved memories: none yet.".to_string()
        } else {
            format!(
                "Approved memories ({} in all, the first {} shown; don't ask these again):\n{}",
                self.memory_count,
                self.memory_count.min(MEMORY_LIMIT),
                self.memory_block
            )
        };
        format!(
            "Name: {}\nRole: {}\nBio: {}\nWrites in: {}\n{}\n{}\n{memories}",
            self.name, self.role, self.bio, self.twin_language, self.tone_block, self.channel_block
        )
    }

    fn render_compact(&self) -> String {
        format!(
            "Name: {}\nRole: {}\nBio: {}\nWrites in: {}\n{}\n{}\nApproved memories: {}",
            self.name,
            self.role,
            truncate_on_char_boundary(&self.bio, COMPACT_BIO_CHARS),
            self.twin_language,
            self.tone_block,
            self.channel_block,
            self.memory_count
        )
    }
}

fn readiness_line(readiness: Option<&SetupReadiness>) -> String {
    match readiness {
        Some(r) => format!(
            "Readiness (the app's own reading; set = done): identity {}, tone {}, channels {}, memories {}.",
            r.identity, r.tone, r.channels, r.memories
        ),
        None => "Readiness: not reported yet.".to_string(),
    }
}

/// Transcript steps as `Q:` / `A:` pairs, oldest first; a skip reads "declined".
fn render_exchanges(steps: &[SetupStep]) -> String {
    if steps.is_empty() {
        return "None yet.".to_string();
    }
    steps
        .iter()
        .map(|s| {
            let answer = match (s.status.as_str(), s.answer.as_deref()) {
                ("skipped", _) | (_, None) => "(declined)".to_string(),
                (_, Some(a)) => truncate_on_char_boundary(a.trim(), EXCHANGE_A_CHARS).to_string(),
            };
            format!(
                "Q: {}\nA: {answer}",
                truncate_on_char_boundary(s.question.trim(), EXCHANGE_Q_CHARS)
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_goals(goals: &[SetupGoal], stalls: &HashMap<String, i64>, full: bool) -> String {
    if goals.is_empty() {
        return "None yet.".to_string();
    }
    goals
        .iter()
        .map(|g| {
            let stall = stalls.get(&g.id).copied().unwrap_or(0);
            let mut line = format!(
                "- id {} | slot {} | {} | state {} | coverage {:.2} | answered {} | stall {}{}",
                g.id,
                g.slot,
                g.title,
                g.state,
                g.coverage,
                g.answered,
                stall,
                if g.pinned { " | PINNED" } else { "" }
            );
            if full && !g.intent.is_empty() {
                line.push_str(&format!("\n  intent: {}", g.intent));
            }
            if !g.criteria.is_empty() {
                line.push_str(&format!("\n  criteria: {}", g.criteria.join("; ")));
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_observations(observations: &[SetupObservation]) -> String {
    if observations.is_empty() {
        return "None yet.".to_string();
    }
    observations
        .iter()
        .map(|o| format!("- {} (evidence {})", o.text, o.evidence))
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_kind_stats(stats: &[SetupKindStat]) -> String {
    if stats.is_empty() {
        return "No data yet.".to_string();
    }
    let rows = stats
        .iter()
        .map(|s| {
            format!(
                "{} | {} | {} | {}/{} | {:.2}",
                s.kind, s.asked, s.skipped, s.offers_made, s.offers_accepted, s.mean_gain
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!("kind | asked | skipped | offers made/kept | mean coverage gain\n{rows}")
}

/// The stage/topic/focus line the queue writers work to.
fn steering_line(
    stage: &str,
    topic: Option<&str>,
    topic_prompt: Option<&str>,
    focus: Option<&str>,
) -> String {
    let mut line = format!("Current stage: {stage}.");
    if let Some(t) = topic {
        line.push_str(&format!(
            " Training topic chosen: {t} ({}).",
            skeleton::topic_brief(t)
        ));
    }
    if let Some(p) = topic_prompt.map(str::trim).filter(|p| !p.is_empty()) {
        line.push_str(&format!(" Their own words for the topic: {p}"));
    }
    if let Some(f) = focus {
        line.push_str(&format!(" Setup slot they chose to work on: {f}."));
    }
    line
}

/// The slot briefs: what a good question for each slot is after.
fn slot_briefs(slots: &[&str], tone_channels: &[String]) -> String {
    let mut out = Vec::new();
    for slot in slots {
        if let Some(topic) = skeleton::topic_of_slot(slot) {
            out.push(format!("{slot}: {}", skeleton::topic_brief(topic)));
        } else {
            out.push(format!(
                "{slot}: {}",
                setup_task_block(Some(slot), tone_channels)
            ));
        }
    }
    if slots.iter().any(|s| s.starts_with("training:")) {
        out.push(format!(
            "Every training question: {}",
            skeleton::TRAINING_BRIEF
        ));
    }
    out.join("\n\n")
}

/// The rules every question writer follows (from the old guided-setup prompt).
fn question_rules(on_file: &OnFile) -> String {
    let name = &on_file.name;
    format!(
        "How to ask\n\
         One question about one thing, in a sentence if you can (a reply drill may need two), under 30 words. \
         Open with the question itself: no greeting, no thanks, no comment on their last answer. Never ask \
         anything already answered or declined in the conversation below; after a decline, take a different \
         angle. When the question is about one channel, put its id in \"toneChannel\" (one of: {channels}, or a \
         plain lowercase name for a channel they mentioned).\n\n\
         Set \"answerMode\" to \"write\" when their answer will itself be a writing sample, like a reply drill or \
         \"paste the last message you sent your team\". Put the message they're replying to in \"incoming\", \
         written exactly as it would arrive, and return \"suggestions\": [], because a sample you wrote would \
         teach the twin your voice instead of theirs. Otherwise set \"answerMode\" to \"pick\", set \"incoming\" \
         to null, and offer two or three suggestions.\n\n\
         A suggestion is an answer they could send back as it is. Make the options genuinely different from \
         each other (different choices, not one answer reworded), keep each as short as their real answer would \
         be, and write it the way {name} would, using what's on file. Never write one as an assistant would. \
         Give each a \"reason\" of a few words saying what picking it tells the twin. At most 3.\n\n\
         \"kind\" is one of: scene (take me to a moment), opinion, reply_drill (a write step answering \
         \"incoming\"), fact, rule (an Always / Never), preference (a choice between concrete variants). \
         Use the kind table below: kinds people skip a lot, or that rarely move coverage, deserve fewer turns.\n\n\
         Language\n\
         Write \"question\" and \"incoming\" in {guide}. Write every suggestion and every proposed value in \
         {twin}, the way {name} writes. Write natively in each language instead of translating from English.\n\n\
         Voice\n{plain}",
        channels = on_file.tone_channels.join(", "),
        guide = on_file.guide_language,
        twin = on_file.twin_language,
        plain = crate::commands::infrastructure::twin_voice::plain_voice(),
    )
}

const STEP_SCHEMA: &str = "{ \"goalId\": \"<goal id>\", \"kind\": \"scene\" | \"opinion\" | \"reply_drill\" | \
\"fact\" | \"rule\" | \"preference\", \"question\": \"...\", \"answerMode\": \"pick\" | \"write\", \
\"incoming\": \"the message they reply to\" | null, \"toneChannel\": \"channel id\" | null, \
\"suggestions\": [{ \"text\": \"an answer they could send\", \"reason\": \"what picking it tells the twin\" }] }";

fn repair_block(repair: Option<&str>) -> String {
    repair
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|r| {
            format!(
                "\n\nYour previous reply could not be used: {r}\nReply again with ONLY the JSON object, every key \
                 present and correctly typed. No prose, no code fence."
            )
        })
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// plan (deep pass)
// ---------------------------------------------------------------------------

pub(crate) struct PlanInput<'a> {
    pub on_file: &'a OnFile,
    pub readiness: Option<&'a SetupReadiness>,
    pub stage: &'a str,
    pub topic: Option<&'a str>,
    pub topic_prompt: Option<&'a str>,
    pub focus: Option<&'a str>,
    pub goals: &'a [SetupGoal],
    pub stalls: &'a HashMap<String, i64>,
    pub transcript: &'a [SetupStep],
    pub offer_verdicts: &'a str,
    pub observations: &'a [SetupObservation],
    pub kind_stats: &'a [SetupKindStat],
}

pub(crate) fn build_plan_prompt(input: &PlanInput, repair: Option<&str>) -> String {
    let on_file = input.on_file;
    let slots: Vec<String> = skeleton::all_slots();
    let slot_refs: Vec<&str> = slots.iter().map(String::as_str).collect();
    let first = input.goals.is_empty();
    let goal_rule = if first {
        "This is their first plan: write goals for EVERY slot listed (setup slots one to three goals each, \
         training slots one goal each is fine)."
            .to_string()
    } else {
        "Revise the goals below: keep a goal's \"id\" to rewrite its title, intent or criteria, and add a goal \
         with \"id\": null where a slot needs a new line of questioning. Never drop a goal: leave out any you \
         don't want to change. Dropped and pinned goals are the person's choice; leave them as they are."
            .to_string()
    };
    format!(
        "You're planning the interview that sets up {name}'s digital twin, a stand-in that will later write \
         messages in their voice. You write the plan once; a faster assistant then follows it one answer at a \
         time. Work like a good ghostwriter planning a first session: people describe their own style badly \
         and show it well, so plan to ask what they actually do and write.\n\n\
         The plan's slots are fixed. Setup: identity, tone, channels, memories. Training: {training}. You fill \
         them with goals (at most {max} per slot) and write the first questions. Use only these slot names.\n\n\
         What each slot is after\n{briefs}\n\n\
         What's on file\n{file}\n{readiness}\n\n\
         {steering}\n\n\
         Goals so far\n{goals}\n\n\
         Conversation so far, oldest first\n{transcript}\n\n\
         Offers they were shown, by verdict\n{verdicts}\n\n\
         What has been noticed about them\n{observations}\n\n\
         How each kind of question has done across every twin\n{kinds}\n\n\
         Your task\n{goal_rule} Give each goal 2 to 4 criteria saying what \"covered\" means. Prefer goals for \
         slots readiness does not show as set. Then write up to 6 questions for the current stage (and up to 3 \
         for the other stage), best first, each pointing at a goal: an existing goal's id, or \"new:<n>\" for \
         the n-th goal (counting from 0) in your \"goals\" array. Replace \"observations\" with up to 8 short \
         lines on how they answer (what works, what they avoid). Say in \"changeNote\" what you changed, in one \
         plain sentence in {guide}.\n\n\
         {rules}\n\n\
         Reply with ONLY this JSON object, no prose and no code fence:\n\
         {{\n  \"goals\": [{{ \"id\": \"<existing id>\" | null, \"slot\": \"<slot>\", \"title\": \"...\", \
         \"intent\": \"one line\", \"criteria\": [\"...\"] }}],\n  \"observations\": [\"...\"],\n  \
         \"steps\": [{step}],\n  \"changeNote\": \"...\"\n}}{repair}",
        name = on_file.name,
        training = skeleton::TRAINING_TOPICS
            .iter()
            .map(|t| skeleton::training_slot(t))
            .collect::<Vec<_>>()
            .join(", "),
        max = skeleton::MAX_GOALS_PER_SLOT,
        briefs = slot_briefs(&slot_refs, &on_file.tone_channels),
        file = on_file.render_full(),
        readiness = readiness_line(input.readiness),
        steering = steering_line(input.stage, input.topic, input.topic_prompt, input.focus),
        goals = render_goals(input.goals, input.stalls, true),
        transcript = render_exchanges(input.transcript),
        verdicts = if input.offer_verdicts.is_empty() {
            "None yet."
        } else {
            input.offer_verdicts
        },
        observations = render_observations(input.observations),
        kinds = render_kind_stats(input.kind_stats),
        guide = on_file.guide_language,
        rules = question_rules(on_file),
        step = STEP_SCHEMA,
        repair = repair_block(repair),
    )
}

// ---------------------------------------------------------------------------
// assess
// ---------------------------------------------------------------------------

pub(crate) struct AssessInput<'a> {
    pub on_file: &'a OnFile,
    pub readiness: Option<&'a SetupReadiness>,
    pub goals: &'a [SetupGoal],
    pub step: &'a SetupStep,
    /// Up to [`RECENT_EXCHANGES`] earlier exchanges, oldest first.
    pub recent: &'a [SetupStep],
}

pub(crate) fn build_assess_prompt(input: &AssessInput, repair: Option<&str>) -> String {
    let on_file = input.on_file;
    let step = input.step;
    let answer = step.answer.as_deref().unwrap_or("(declined)");
    let offer_rule = if step.stage == "training" {
        "Return \"offers\": []. A training answer is saved as they wrote it and never changes a profile field."
            .to_string()
    } else {
        "When this answer (with what came before) supports a concrete value for a real field, add it to \
         \"offers\". Nothing is saved until they accept it.\n\
         - kind \"bio\": first person, their facts and their phrasing, two or three sentences, under 500 characters.\n\
         - kind \"role\": a short title, under 50 characters.\n\
         - kind \"tone\", part \"voice\", with a channel id: one to three short instructions to the twin on how \
         they write there, under 300 characters.\n\
         - kind \"tone\", part \"constraints\", with a channel id: one rule starting with Always or Never, under \
         120 characters.\n\
         Only offer what their own words support; never invent dates, numbers, names or places. Never offer an \
         example message: those come from what they type. When nothing is solid, return []."
            .to_string()
    };
    format!(
        "You're reviewing one answer {name} just gave while setting up their digital twin. Score how much of \
         each goal their answers now cover, offer any field value the answer supports, and decide whether one \
         follow-up question is worth asking.\n\n\
         What's on file\n{file}\n{readiness}\n\n\
         Goals\n{goals}\n\n\
         Earlier exchanges, oldest first\n{recent}\n\n\
         The answer to review\nGoal: {goal}\nQ: {question}\nA: {answer}\n\n\
         Your task\n\
         \"coverage\": for each goal this answer touches, its coverage from 0 to 1 counting everything answered \
         so far (not just this answer), judged against its criteria. Leave out goals it doesn't touch. A \
         declined question covers nothing.\n\
         {offer_rule}\n\
         \"followUp\": null, or ONE question that goes deeper on something this answer opened and that the \
         goal still needs. Never repeat anything asked.\n\
         \"observation\": null, or one short line on how they answer, when this answer shows something new.\n\n\
         {rules}\n\n\
         Reply with ONLY this JSON object, no prose and no code fence:\n\
         {{\n  \"coverage\": [{{ \"goalId\": \"...\", \"coverage\": 0.0, \"why\": \"a few words\" }}],\n  \
         \"offers\": [{{ \"kind\": \"bio\" | \"role\" | \"tone\", \"part\": \"voice\" | \"constraints\" | null, \
         \"channel\": \"channel id\" | null, \"value\": \"the exact text to save\", \"lengthHint\": \"like one line\" \
         | null, \"reason\": \"why this value\" }}],\n  \"followUp\": null | {step_schema},\n  \
         \"observation\": null | \"...\"\n}}{repair}",
        name = on_file.name,
        file = on_file.render_compact(),
        readiness = readiness_line(input.readiness),
        goals = render_goals(input.goals, &HashMap::new(), false),
        recent = render_exchanges(input.recent),
        goal = step.goal_id.as_deref().unwrap_or("none (an opening question)"),
        question = truncate_on_char_boundary(step.question.trim(), EXCHANGE_Q_CHARS),
        rules = question_rules(on_file),
        step_schema = STEP_SCHEMA,
        repair = repair_block(repair),
    )
}

// ---------------------------------------------------------------------------
// refill
// ---------------------------------------------------------------------------

pub(crate) struct RefillInput<'a> {
    pub on_file: &'a OnFile,
    pub readiness: Option<&'a SetupReadiness>,
    pub goals: &'a [SetupGoal],
    pub stalls: &'a HashMap<String, i64>,
    /// The goals to write for, in priority order.
    pub targets: &'a [SetupGoal],
    pub queue: &'a [SetupStep],
    pub recent: &'a [SetupStep],
    pub observations: &'a [SetupObservation],
    pub kind_stats: &'a [SetupKindStat],
    pub stage: &'a str,
    pub topic: Option<&'a str>,
    pub topic_prompt: Option<&'a str>,
    pub focus: Option<&'a str>,
    /// How many steps the queue is short.
    pub need: i64,
}

pub(crate) fn build_refill_prompt(input: &RefillInput, repair: Option<&str>) -> String {
    let on_file = input.on_file;
    let queue = if input.queue.is_empty() {
        "Empty.".to_string()
    } else {
        input
            .queue
            .iter()
            .map(|s| {
                format!(
                    "- id {} | goal {} | {}",
                    s.id,
                    s.goal_id.as_deref().unwrap_or("none"),
                    truncate_on_char_boundary(s.question.trim(), EXCHANGE_Q_CHARS)
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let target_slots: Vec<&str> = {
        let mut v: Vec<&str> = Vec::new();
        for g in input.targets {
            if !v.contains(&g.slot.as_str()) {
                v.push(g.slot.as_str());
            }
        }
        v
    };
    let targets = input
        .targets
        .iter()
        .map(|g| format!("- {} ({}: {})", g.id, g.slot, g.title))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "You keep the question queue for {name}'s digital-twin setup topped up. The queue must hold {need} more \
         question(s) for the current stage. Write them for these goals, in this priority order:\n{targets}\n\n\
         What each slot is after\n{briefs}\n\n\
         What's on file\n{file}\n{readiness}\n\n\
         {steering}\n\n\
         All goals\n{goals}\n\n\
         The queue as it stands\n{queue}\n\n\
         Recent exchanges, oldest first (the last one was just answered)\n{recent}\n\n\
         What has been noticed about them\n{observations}\n\n\
         How each kind of question has done across every twin\n{kinds}\n\n\
         Your task\n\
         Write at most {need} new question(s) in \"steps\", best first, each with the \"goalId\" of the goal it \
         serves. A queued question the latest answer made pointless or repetitive goes in \"obsolete\" by id. \
         If the goals above have nothing left worth asking, return \"steps\": [] rather than inventing a \
         question.\n\n\
         {rules}\n\n\
         Reply with ONLY this JSON object, no prose and no code fence:\n\
         {{\n  \"steps\": [{step}],\n  \"obsolete\": [\"<queued step id>\"]\n}}{repair}",
        name = on_file.name,
        need = input.need,
        briefs = slot_briefs(&target_slots, &on_file.tone_channels),
        file = on_file.render_compact(),
        readiness = readiness_line(input.readiness),
        steering = steering_line(input.stage, input.topic, input.topic_prompt, input.focus),
        goals = render_goals(input.goals, input.stalls, false),
        recent = render_exchanges(input.recent),
        observations = render_observations(input.observations),
        kinds = render_kind_stats(input.kind_stats),
        rules = question_rules(on_file),
        step = STEP_SCHEMA,
        repair = repair_block(repair),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_file() -> OnFile {
        OnFile {
            name: "Ada".into(),
            role: "Engineer".into(),
            bio: "b".repeat(2000),
            guide_language: "English".into(),
            twin_language: "Czech".into(),
            tone_block: "Tone per channel: nothing on file yet.".into(),
            channel_block: "Channels they're connected on: none yet.".into(),
            memory_count: 0,
            memory_block: String::new(),
            tone_channels: vec!["generic".into(), "slack".into()],
        }
    }

    fn step(id: &str, q: &str, a: Option<&str>) -> SetupStep {
        SetupStep {
            id: id.into(),
            goal_id: Some("g1".into()),
            stage: "setup".into(),
            origin: "plan".into(),
            kind: "fact".into(),
            question: q.into(),
            answer_mode: "pick".into(),
            incoming: None,
            tone_channel: None,
            suggestions: vec![],
            status: if a.is_some() { "answered" } else { "skipped" }.into(),
            answer: a.map(str::to_string),
            position: 0,
            asked_at: None,
            answered_at: None,
            reconciled: false,
        }
    }

    /// Every prompt carries the language, voice and write-mode rules and the
    /// transcript; all stay far under the ~6k-token budget (~24k chars).
    #[test]
    fn twin_setup_prompts_carry_the_rules_and_stay_small() {
        let file = on_file();
        let transcript: Vec<SetupStep> = (0..30)
            .map(|i| step(&format!("s{i}"), &"q".repeat(400), Some(&"a".repeat(900))))
            .collect();
        let stalls = HashMap::new();
        let plan = build_plan_prompt(
            &PlanInput {
                on_file: &file,
                readiness: None,
                stage: "setup",
                topic: None,
                topic_prompt: None,
                focus: None,
                goals: &[],
                stalls: &stalls,
                transcript: &transcript,
                offer_verdicts: "",
                observations: &[],
                kind_stats: &[],
            },
            Some("missing key"),
        );
        let answered = step("x", "Where do you work?", None);
        let assess = build_assess_prompt(
            &AssessInput {
                on_file: &file,
                readiness: None,
                goals: &[],
                step: &answered,
                recent: &transcript[..6],
            },
            None,
        );
        let refill = build_refill_prompt(
            &RefillInput {
                on_file: &file,
                readiness: None,
                goals: &[],
                stalls: &stalls,
                targets: &[],
                queue: &[],
                recent: &transcript[..6],
                observations: &[],
                kind_stats: &[],
                stage: "training",
                topic: Some("values"),
                topic_prompt: None,
                focus: None,
                need: 3,
            },
            None,
        );
        for p in [&plan, &assess, &refill] {
            assert!(p.contains("\"answerMode\" to \"write\""));
            assert!(p.contains("in Czech"));
            assert!(p.contains("Voice\n"));
            assert!(p.contains("Never ask anything already answered or declined"));
            assert!(p.len() < 24_000, "prompt is {} chars", p.len());
        }
        assert!(
            plan.contains("missing key"),
            "the repair reason reaches the retry"
        );
        assert!(plan.contains("training:values"));
        assert!(assess.contains("A: (declined)"));
        assert!(refill.contains("Training topic chosen: values"));
    }
}
