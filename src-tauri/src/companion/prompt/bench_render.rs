//! Composing a system prompt for a SYNTHETIC context: the bench's way of
//! getting the real family (full constitution or chat core) with a scenario's
//! pinned connectors, live activity and voice flag, without a database.
//!
//! Everything static comes from the embedded templates (`CONSTITUTION_MD`,
//! `IDENTITY_MD_TEMPLATE`, the chat core); everything dynamic is the
//! scenario's declared state rendered through the same formatters a live turn
//! uses (`format_connectors`, the voice and register flags). Recall is empty, plugins are
//! absent, no mode addenda: the bench measures decision ability under the
//! family, not memory quality.

use super::addenda::progress_addendum;
use super::budget::PromptBlockSizes;
use super::capabilities::format_connectors;
use super::chat_family::{base_layer_one_flag, chat_static_core, voice_flag, PromptClass};
use super::compose::compose_for_class;
use crate::companion::brain::retrieval::Recall;
use crate::companion::templates::{CONSTITUTION_MD, IDENTITY_MD_TEMPLATE};
use crate::error::AppError;

/// One scenario's declared state.
#[derive(Debug, Clone, Default)]
pub struct BenchPromptContext {
    /// Connector names pinned + enabled for this turn.
    pub pinned: Vec<String>,
    /// The live-activity listing (running / queued / completed tasks, other
    /// threads, queued user messages), verbatim; empty for "nothing in
    /// flight".
    pub activity: String,
    /// Voice playback on for this turn.
    pub voice: bool,
}

/// The synthetic observability slot: the app-state heading a live turn has,
/// with the scenario's live activity where the operative-memory digest would
/// sit. The heading text is the live one so the family's own "read your
/// context" instructions resolve to something.
fn bench_observability(activity: &str) -> String {
    let activity = if activity.trim().is_empty() {
        "(nothing in flight right now)"
    } else {
        activity.trim()
    };
    format!(
        "\n\n# Current state of the Personas app (right now)\n\n\
         (bench fixture: no app-state digest for this turn)\n\n\
         ## Live activity (this conversation, right now)\n\n{activity}\n"
    )
}

/// Compose the system prompt of `class` for `ctx`. Returns the prompt and
/// its block sizes, so the bench can record the composed size beside each
/// turn exactly as the turn ledger does.
pub fn render_bench_prompt(
    class: PromptClass,
    ctx: &BenchPromptContext,
) -> Result<(String, PromptBlockSizes), AppError> {
    let recall = Recall {
        episodes: Vec::new(),
        doctrine: Vec::new(),
        facts: Vec::new(),
        procedurals: Vec::new(),
        goals: Vec::new(),
        backlog: Vec::new(),
        trace: Default::default(),
    };
    let observability_md = bench_observability(&ctx.activity);
    let connectors_md = format_connectors(&ctx.pinned);
    // No database here, so the register flag is the base register: exactly
    // what a fresh install's turns carry.
    let (core, voice_md, display_md): (&str, String, String) = match class {
        PromptClass::Full => (
            CONSTITUTION_MD,
            format!("{}{}", voice_flag(ctx.voice), progress_addendum()),
            base_layer_one_flag(),
        ),
        PromptClass::Chat => (
            chat_static_core(),
            voice_flag(ctx.voice),
            base_layer_one_flag(),
        ),
    };
    Ok(compose_for_class(
        class,
        core,
        IDENTITY_MD_TEMPLATE,
        &observability_md,
        &recall,
        None,
        "",
        &connectors_md,
        "",
        &voice_md,
        &display_md,
        "",
        // No Browser page in a bench composition.
        "",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::prompt::budget::CHAT_FAMILY_BUDGET;

    fn ctx(pinned: &[&str], activity: &str, voice: bool) -> BenchPromptContext {
        BenchPromptContext {
            pinned: pinned.iter().map(|s| s.to_string()).collect(),
            activity: activity.to_string(),
            voice,
        }
    }

    #[test]
    fn the_chat_family_with_empty_dynamic_blocks_stays_near_its_budget() {
        let (prompt, sizes) = render_bench_prompt(PromptClass::Chat, &ctx(&[], "", false)).unwrap();
        // Static core + the identity template + the synthetic observability
        // heading; the family budget bounds the static core, and the two
        // dynamic scaffolds here are a few hundred chars of known size.
        assert!(
            prompt.len() <= CHAT_FAMILY_BUDGET + IDENTITY_MD_TEMPLATE.len() + 800,
            "chat family composed at {} chars",
            prompt.len()
        );
        assert_eq!(sizes.total(), prompt.len());
        assert!(
            !prompt.contains("# YOU HAVE TOOLS"),
            "chat family must not carry the tools addendum"
        );
        assert!(
            !prompt.contains("# Stay responsive"),
            "chat family must not carry the delegation addendum twice"
        );
    }

    #[test]
    fn the_full_family_is_the_constitution_plus_the_static_addenda() {
        let (prompt, _) = render_bench_prompt(PromptClass::Full, &ctx(&[], "", false)).unwrap();
        assert!(prompt.starts_with(CONSTITUTION_MD));
        assert!(prompt.contains("# YOU HAVE TOOLS"));
        assert!(prompt.contains("# Stay responsive"));
    }

    #[test]
    fn scenario_state_reaches_both_families() {
        for class in [PromptClass::Full, PromptClass::Chat] {
            let (prompt, _) = render_bench_prompt(
                class,
                &ctx(&["sentry"], "- RUNNING task: \"Calling Sentry\"", true),
            )
            .unwrap();
            assert!(
                prompt.contains("## `sentry`"),
                "{class:?}: pinned connector block missing"
            );
            assert!(prompt.contains("`list_issues`") || prompt.contains("**list_issues**"));
            assert!(prompt.contains("- RUNNING task: \"Calling Sentry\""));
            assert!(prompt.contains("TTS:"), "{class:?}: voice flag missing");
        }
        let (quiet, _) = render_bench_prompt(PromptClass::Chat, &ctx(&[], "", false)).unwrap();
        assert!(quiet.contains("(nothing in flight right now)"));
        // The chat core NAMES the flag block once (to teach it); the block
        // itself is absent when voice is off, present when it is on.
        let flag = "# Voice is on for this turn";
        assert_eq!(
            quiet.matches(flag).count(),
            1,
            "voice-off chat prompt carries the flag block"
        );
        let (loud, _) = render_bench_prompt(PromptClass::Chat, &ctx(&[], "", true)).unwrap();
        assert_eq!(
            loud.matches(flag).count(),
            2,
            "voice-on chat prompt lacks the flag block"
        );
    }
}
