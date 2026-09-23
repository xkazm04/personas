//! The chat-class prompt family: which static core a turn gets, and the
//! chat core itself.
//!
//! The full constitution is ~147 KB and is what every turn carried until the
//! hybrid-llm-engine spark measured that a SMALL prompt is one of the two real
//! latency levers for the interactive turn (fixture 6.7 KB: Sonnet 2.9 s to
//! first text vs 5.0 s on the real prompt). This module gives the MAIN tier a
//! family under the declared 24k-char budget: a hand-written chat core
//! (`templates/chat-core.md`: identity, register, restraint, delegation,
//! awareness, gated discipline, the machine-line grammar, the voice contract)
//! plus an op reference generated from the dispatcher catalog, so every op the
//! dispatcher accepts is taught by construction. Build, aside and micro turns
//! keep the full constitution.
//!
//! Selection is [`PromptClass::for_tier`]: `PERSONAS_ATHENA_PROMPT_CLASS`
//! (`full` | `chat`) overrides everything; otherwise MAIN gets the chat
//! family once the 38-scenario bench has certified it
//! ([`CHAT_FAMILY_CERTIFIED`]), and every other class gets the constitution.

use std::sync::OnceLock;

use super::budget::CHAT_FAMILY_BUDGET;
use crate::companion::dispatcher::render_op_reference;
use crate::companion::engine_settings::TurnTierClass;
use crate::companion::register;
use crate::db::UserDbPool;

/// The env override. `full` forces the constitution on every class; `chat`
/// forces the chat family on every class (the way to trial it on a tier the
/// default does not give it to). Anything else is ignored.
pub const PROMPT_CLASS_ENV: &str = "PERSONAS_ATHENA_PROMPT_CLASS";

/// Whether the bench certified the chat family as the MAIN default
/// (`.planning/athena-bench/report.md`, gates: no class drops more than 2 pts
/// vs the full-constitution baseline; `restraint` and `gated_discipline`
/// hard-fail on any drop). While `false`, MAIN turns keep the constitution and
/// the family is reachable only through `PERSONAS_ATHENA_PROMPT_CLASS=chat`.
///
/// Certified 2026-09-17 (corpus v2, 38 scenarios x 2 reps, 0 infra
/// exclusions, baseline `o-low` = opus-5/low on the 153,887-char
/// constitution): `o-low-chat` awareness 100/100, delegate 100/60,
/// format 100/90, gated 50/50, restraint 100/92, tool_selection 90/70;
/// `s-low-chat` the same shape. p50 to first visible text 4.9 s vs 6.1 s on
/// a cold spawn; the warm session is the speed lever this bench cannot see.
pub const CHAT_FAMILY_CERTIFIED: bool = true;

/// The hand-written chat core. `include_str!` rather than a disk copy on
/// purpose: unlike `constitution.md`, which is materialised under the brain
/// root so the operator can read and back it up, the chat core is a build
/// artifact composed with a generated reference and must never drift from
/// the catalog it is compiled beside.
pub const CHAT_CORE_MD: &str = include_str!("../templates/chat-core.md");

/// Which static core a turn's system prompt is built on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PromptClass {
    /// The full constitution from the brain root, as every turn had it.
    Full,
    /// The chat core + generated op reference, for the interactive turn.
    Chat,
}

impl PromptClass {
    pub fn as_str(self) -> &'static str {
        match self {
            PromptClass::Full => "full",
            PromptClass::Chat => "chat",
        }
    }

    /// The prompt class for a turn of tier `class`.
    ///
    /// Order: the env override, then the tier rule (MAIN → chat once
    /// certified, everything else → full).
    pub fn for_tier(class: TurnTierClass) -> Self {
        Self::for_tier_with(class, std::env::var(PROMPT_CLASS_ENV).ok().as_deref())
    }

    /// [`Self::for_tier`] with the env value passed in, so the rule is
    /// testable without touching process state.
    pub fn for_tier_with(class: TurnTierClass, env: Option<&str>) -> Self {
        match env.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
            Some("full") => return PromptClass::Full,
            Some("chat") => return PromptClass::Chat,
            _ => {}
        }
        match class {
            TurnTierClass::Main if CHAT_FAMILY_CERTIFIED => PromptClass::Chat,
            _ => PromptClass::Full,
        }
    }
}

/// The three connectors that are on for every turn without pinning. Rendered
/// into the chat core from the same capability registry the dispatcher
/// validates against, so a slug she is taught is a slug that dispatches.
const ALWAYS_ON_BUILTINS: &[&str] = &["local_drive", "personas_database", "operations_database"];

fn format_builtin_connectors() -> String {
    let mut s = String::from(
        "\n\n# Always-on builtins (no pinning; call them through `use_connector`)\n\n",
    );
    for name in ALWAYS_ON_BUILTINS {
        let Some(caps) = crate::companion::connectors::capabilities_for(name) else {
            continue;
        };
        s.push_str(&format!("- `{name}`: "));
        let rendered: Vec<String> = caps
            .iter()
            .map(|c| {
                if c.requires_approval {
                    format!("`{}` (write, approval card; args {})", c.slug, c.args)
                } else {
                    format!("`{}` (args {})", c.slug, c.args)
                }
            })
            .collect();
        s.push_str(&rendered.join(", "));
        s.push('\n');
    }
    s
}

/// The chat family's static core: chat core + op reference + builtins. Built
/// once per process (the inputs are compile-time constants and a table), and
/// measured against [`CHAT_FAMILY_BUDGET`] on that first build: a breach is a
/// `warn!`, never a cut, the same tripwire contract every other block has.
pub fn chat_static_core() -> &'static str {
    static CORE: OnceLock<String> = OnceLock::new();
    CORE.get_or_init(|| {
        let core = compose_chat_static_core();
        if core.len() > CHAT_FAMILY_BUDGET {
            tracing::warn!(
                chars = core.len(),
                budget = CHAT_FAMILY_BUDGET,
                "companion prompt: chat family static core over budget"
            );
        }
        core
    })
}

fn compose_chat_static_core() -> String {
    let reference = render_op_reference();
    let builtins = format_builtin_connectors();
    let mut out = String::with_capacity(CHAT_CORE_MD.len() + reference.len() + builtins.len() + 8);
    out.push_str(CHAT_CORE_MD.trim_end());
    out.push_str("\n\n");
    out.push_str(&reference);
    out.push_str(&builtins);
    out
}

/// The per-turn voice flag, for both families. The RULES live in the static
/// core (chat core `# Voice`, constitution `## Voice`); this block only says
/// that voice is on, so the stable prefix does not change between a spoken and
/// a typed turn. Layer one is already the spoken register, so the flag carries
/// no second, voice-only register: only the optional `TTS:` escape.
pub(super) fn voice_flag(voice_enabled: bool) -> String {
    if !voice_enabled {
        return String::new();
    }
    String::from(
        "\n\n# Voice is on for this turn\n\n\
         He will hear this reply as it streams, sentence by sentence, with the \
         machine lines stripped. Layer one already reads aloud; a `TTS:` line is \
         optional, only when the visible reply must differ from speech.\n",
    )
}

/// The per-turn register flag (`Layer one this turn: at most N sentences.`),
/// read from the reply register. Never fails: an unreadable register is the
/// base register (`register::effective`).
pub(super) fn layer_one_flag_for(user_db: &UserDbPool) -> String {
    register::layer_one_flag(&register::effective(user_db))
}

/// The register flag for a turn with no database (the bench): the base
/// register, exactly what a fresh install's turns carry.
pub(super) fn base_layer_one_flag() -> String {
    register::layer_one_flag(&register::EffectiveRegister {
        default_sentences: register::LAYER_ONE_BASE_SENTENCES,
        overrides: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_family_fits_budget() {
        let core = chat_static_core();
        assert!(
            core.len() <= CHAT_FAMILY_BUDGET,
            "chat family static core is {} chars, budget {} (chat core {}, op reference {}, builtins {})",
            core.len(),
            CHAT_FAMILY_BUDGET,
            CHAT_CORE_MD.len(),
            render_op_reference().len(),
            format_builtin_connectors().len()
        );
        // And it is a real family, not an empty string that trivially fits.
        assert!(
            core.len() > 12_000,
            "chat family is suspiciously small: {}",
            core.len()
        );
    }

    #[test]
    fn chat_core_is_composed_in_order_and_names_the_builtins() {
        let core = chat_static_core();
        let core_at = core.find("# Who you are").expect("chat core heading");
        let ref_at = core
            .find("# Op reference (generated from the dispatcher catalog)")
            .expect("op reference heading");
        let builtins_at = core.find("# Always-on builtins").expect("builtins heading");
        assert!(core_at < ref_at && ref_at < builtins_at);
        for name in ALWAYS_ON_BUILTINS {
            assert!(
                core.contains(&format!("- `{name}`: ")),
                "builtin {name} not rendered"
            );
        }
        assert!(
            core.contains("`count_files`"),
            "local_drive capabilities missing"
        );
        assert!(
            core.contains("`query_operations`"),
            "operations_database capability missing"
        );
    }

    #[test]
    fn the_env_override_beats_the_tier_rule() {
        for class in TurnTierClass::ALL {
            assert_eq!(
                PromptClass::for_tier_with(class, Some("full")),
                PromptClass::Full
            );
            assert_eq!(
                PromptClass::for_tier_with(class, Some("chat")),
                PromptClass::Chat
            );
            assert_eq!(
                PromptClass::for_tier_with(class, Some(" CHAT ")),
                PromptClass::Chat
            );
        }
    }

    #[test]
    fn only_main_gets_the_chat_family_by_default() {
        let main = PromptClass::for_tier_with(TurnTierClass::Main, None);
        assert_eq!(
            main,
            if CHAT_FAMILY_CERTIFIED {
                PromptClass::Chat
            } else {
                PromptClass::Full
            }
        );
        assert_eq!(
            PromptClass::for_tier_with(TurnTierClass::Aside, None),
            PromptClass::Full
        );
        assert_eq!(
            PromptClass::for_tier_with(TurnTierClass::Micro, None),
            PromptClass::Full
        );
        assert_eq!(
            PromptClass::for_tier_with(TurnTierClass::Main, Some("bogus")),
            main
        );
    }

    #[test]
    fn the_voice_flag_is_short_and_absent_when_voice_is_off() {
        assert!(voice_flag(false).is_empty());
        let on = voice_flag(true);
        assert!(on.contains("# Voice is on for this turn"));
        assert!(
            on.len() < 400,
            "the flag must stay a flag, not a second rulebook"
        );
        // Layer one IS the spoken register: no voice-only duality text.
        for gone in [
            "DUAL-LANGUAGE",
            "control panel",
            "Write the prose to be spoken",
        ] {
            assert!(!on.contains(gone), "voice flag still carries: {gone}");
        }
    }

    #[test]
    fn chat_core_teaches_the_voice_contract_and_the_machine_lines() {
        for needle in [
            "A `TTS:` line is OPTIONAL",
            "does not repeat the prose",
            "`OP: {...}`",
            "`QR: [",
            "`PROGRESS: ...`",
            "`TTS: \"...\"`",
            "# Restraint",
            "# Gated discipline",
            "# Delegate long work",
            "# Awareness",
        ] {
            assert!(CHAT_CORE_MD.contains(needle), "chat core lost: {needle}");
        }
        assert!(
            !CHAT_CORE_MD.contains('\u{2014}'),
            "chat core carries an em dash; rewrite the sentence"
        );
    }

    #[test]
    fn chat_core_teaches_layer_one() {
        assert!(
            CHAT_CORE_MD.contains("\n# Layer one"),
            "chat core lost its `# Layer one` section"
        );
        for needle in [
            "Layer one this turn:",
            "\"action\":\"show_report\"",
            "(ref:report/new)",
            "(ref:approval/",
            "(ref:session/",
            "(ref:memory/",
            "never invent one",
            "Never describe a card",
            "\"action\":\"adjust_register\"",
        ] {
            assert!(CHAT_CORE_MD.contains(needle), "layer one lost: {needle}");
        }
        // Both ops are taught in the canonical `propose_action` envelope the
        // generated op reference prescribes, never the bare spelling.
        for bare in ["\"op\":\"show_report\"", "\"op\":\"adjust_register\""] {
            assert!(
                !CHAT_CORE_MD.contains(bare),
                "chat core teaches bare {bare}"
            );
        }
        // The old register asked for ids in inline code; layer one forbids ids.
        let lower = CHAT_CORE_MD.to_lowercase();
        assert!(
            !lower.contains("`inline code` for ids"),
            "chat core still asks for ids in inline code"
        );
        assert!(
            !CHAT_CORE_MD.contains("A short paragraph or two by default"),
            "chat core still carries the old length rule"
        );
        // Voice no longer carries a second, voice-only register.
        assert!(
            !CHAT_CORE_MD.contains("the ear has no scrollbar"),
            "chat core still teaches a voice-only register"
        );
    }

    #[test]
    fn the_register_flag_reflects_the_register_rows() {
        let pool = crate::db::init_test_user_db().expect("test user db");
        assert_eq!(
            layer_one_flag_for(&pool),
            "\n\nLayer one this turn: at most 3 sentences.\n",
            "no rows is the base register"
        );
        assert_eq!(layer_one_flag_for(&pool), base_layer_one_flag());
        register::upsert(&pool, "default", 2, "operator", None).expect("default row");
        assert_eq!(
            layer_one_flag_for(&pool),
            "\n\nLayer one this turn: at most 2 sentences.\n"
        );
        register::upsert(&pool, "fleet updates", 5, "reflection", Some("x")).expect("topic row");
        assert_eq!(
            layer_one_flag_for(&pool),
            "\n\nLayer one this turn: at most 2 sentences. Topic overrides: fleet updates 5.\n"
        );
    }
}
