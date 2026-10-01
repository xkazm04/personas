//! One sample's analysis: guard, ask, file.
//!
//! 1. The self-reinforcement guard runs first, against the twin's own
//!    placements and outbox replies; a match is refused with NO model call.
//! 2. One `TwinCall::SAMPLE_LEARN` call through the repair door
//!    (`call_with_repair`, the setup engine's door), prompt from
//!    [`super::prompt`], reply through [`super::parse`].
//! 3. Not the person's own writing: refused with the model's reason. A reply
//!    unusable twice: failed with the door's reason. Otherwise the proposals
//!    (minus what the channel already holds) and the self-facts land in ONE
//!    transaction with the sample's `ready` (`twin_sample::finish_ready`).
//!
//! Every status change is announced (`twin-sample-updated`). Nothing here
//! writes a tone field: proposals are the preview seam, the accept door is
//! the only writer (census `model-output-persisted-without-preview`).

use std::collections::HashSet;

use crate::db::models::{TwinSample, TwinStyle, TwinTone};
use crate::db::repos::twin as twin_repo;
use crate::db::repos::twin_sample::{
    self as repo, NewFact, NewProposal, KIND_CONSTRAINT, KIND_DIMS, KIND_EXEMPLAR, KIND_LENGTH,
    KIND_VOICE, STATUS_ANALYZING, STATUS_READY,
};
use crate::engine::twin_prompt::input::json_strings;
use crate::engine::twin_setup::jobs::{call_with_repair, db};
use crate::engine::twin_setup::llm::TwinCall;
use crate::error::AppError;
use personas_core::utils::text::truncate_on_char_boundary;

use super::guard::{self, normalize};
use super::parse::{parse_reply, LearnReply, Learned};
use super::prompt::{self, PromptInputs};
use super::{SampleCtx, SAMPLE_MAX_CHARS};

/// The longest failure reason stored, in bytes (a display line).
const FAILURE_MAX_BYTES: usize = 300;

/// Analyse one sample. `Ok` whenever the outcome was recorded (ready,
/// refused, failed, or the sample was already settled); `Err` only when the
/// database could not be read or written, which the lane records as a
/// failure itself.
pub(crate) async fn run(ctx: &SampleCtx, sample_id: &str) -> Result<(), AppError> {
    let id = sample_id.to_string();
    let Some(sample) = db(&ctx.pool, move |pool| repo::get_sample(pool, &id)).await? else {
        return Ok(());
    };
    if sample.status != STATUS_ANALYZING {
        return Ok(());
    }

    let twin_id = sample.twin_id.clone();
    let authored = db(&ctx.pool, move |pool| {
        repo::twin_authored_texts(pool, &twin_id)
    })
    .await?;
    if let Some(reason) = guard::self_authored(&sample.text, authored.iter().map(String::as_str)) {
        return settle(ctx, &sample, repo::STATUS_REFUSED, reason).await;
    }

    let for_inputs = sample.clone();
    let inputs = db(&ctx.pool, move |pool| PromptInputs::load(pool, &for_inputs)).await?;
    // A stored sample at the cap was cut on the way in (`learn` caps it).
    let cut = sample.text.chars().count() >= SAMPLE_MAX_CHARS;
    let nonce = prompt::nonce();
    let llm_ctx = ctx.llm_ctx();
    let reply = call_with_repair(
        &llm_ctx,
        TwinCall::SAMPLE_LEARN,
        |repair| prompt::build(&inputs, &sample, cut, &nonce, repair),
        |raw| parse_reply(raw, &inputs.channels, &nonce),
    )
    .await;

    match reply {
        Err(reason) => {
            let reason = truncate_on_char_boundary(reason.trim(), FAILURE_MAX_BYTES).to_string();
            settle(ctx, &sample, repo::STATUS_FAILED, &reason).await
        }
        Ok(LearnReply::NotOwn { reason }) => {
            settle(ctx, &sample, repo::STATUS_REFUSED, &reason).await
        }
        Ok(LearnReply::Own(learned)) => {
            file(ctx, &sample, cut, &learned, &inputs.known_facts).await
        }
    }
}

/// Land a usable analysis: the proposals the channel does not already hold,
/// the facts not already known, and the sample's `ready`, in one transaction.
async fn file(
    ctx: &SampleCtx,
    sample: &TwinSample,
    cut: bool,
    learned: &Learned,
    known_facts: &HashSet<String>,
) -> Result<(), AppError> {
    let (twin_id, channel) = (sample.twin_id.clone(), learned.channel.clone());
    let tone = db(&ctx.pool, move |pool| {
        twin_repo::get_tone_optional(pool, &twin_id, &channel)
    })
    .await?;
    let (proposals, facts) = proposals_for(&sample.text, cut, learned, tone.as_ref(), known_facts);

    let (id, channel) = (sample.id.clone(), learned.channel.clone());
    let open = db(&ctx.pool, move |pool| {
        repo::finish_ready(pool, &id, &channel, &proposals, &facts)
    })
    .await?;
    if let Some(open) = open {
        ctx.announce(&sample.twin_id, &sample.id, STATUS_READY, open);
    }
    Ok(())
}

/// Move the sample to `failed` / `refused` and announce it. A sample that had
/// already left `analyzing` is left alone, unannounced.
pub(crate) async fn settle(
    ctx: &SampleCtx,
    sample: &TwinSample,
    status: &'static str,
    reason: &str,
) -> Result<(), AppError> {
    let (id, reason) = (sample.id.clone(), reason.to_string());
    let moved = db(&ctx.pool, move |pool| {
        repo::settle_sample(pool, &id, status, &reason)
    })
    .await?;
    if moved {
        ctx.announce(&sample.twin_id, &sample.id, status, 0);
    }
    Ok(())
}

/// What a learned reply proposes for its channel, minus what the channel's
/// tone row already says, and the facts not already known. Pure.
pub(crate) fn proposals_for(
    sample_text: &str,
    cut: bool,
    learned: &Learned,
    tone: Option<&TwinTone>,
    known_facts: &HashSet<String>,
) -> (Vec<NewProposal>, Vec<NewFact>) {
    let channel = learned.channel.as_str();
    let reason = (!learned.reason.is_empty()).then(|| learned.reason.clone());
    let proposal = |kind: &'static str, value: String| NewProposal {
        kind,
        channel: channel.to_string(),
        value,
        reason: reason.clone(),
    };
    let same = |a: &str, b: Option<&str>| b.is_some_and(|b| normalize(a) == normalize(b));
    let mut out = Vec::new();

    let examples = json_strings(tone.and_then(|t| t.examples_json.as_deref()));
    let sample_text = sample_text.trim();
    if learned.exemplar && !cut && !examples.iter().any(|e| same(sample_text, Some(e))) {
        out.push(proposal(KIND_EXEMPLAR, sample_text.to_string()));
    }

    if let Some(voice) = &learned.voice {
        if !same(voice, tone.map(|t| t.voice_directives.as_str())) {
            out.push(proposal(KIND_VOICE, voice.clone()));
        }
    }

    let mut rules: Vec<String> = json_strings(tone.and_then(|t| t.constraints_json.as_deref()))
        .iter()
        .map(|r| normalize(r))
        .collect();
    for rule in &learned.constraints {
        let key = normalize(rule);
        if !rules.contains(&key) {
            rules.push(key);
            out.push(proposal(KIND_CONSTRAINT, rule.clone()));
        }
    }

    if let Some(length) = &learned.length {
        if !same(length, tone.and_then(|t| t.length_hint.as_deref())) {
            out.push(proposal(KIND_LENGTH, length.clone()));
        }
    }

    if let Some(dims) = learned.dims {
        let current = tone
            .and_then(|t| t.style_json.as_deref())
            .and_then(|raw| serde_json::from_str::<TwinStyle>(raw).ok())
            .map(|style| style.dims);
        if current != Some(dims) {
            match serde_json::to_string(&dims) {
                Ok(value) => out.push(proposal(KIND_DIMS, value)),
                Err(e) => {
                    tracing::warn!(error = %e, "twin sample: could not serialize the learned dims")
                }
            }
        }
    }

    let mut seen = known_facts.clone();
    let facts = learned
        .facts
        .iter()
        .filter(|f| seen.insert(normalize(&f.content)))
        .cloned()
        .collect();
    (out, facts)
}
