//! Which CLI engine, model and reasoning effort each Athena turn class runs
//! on — the persisted, operator-editable layer above [`super::model_routing`].
//!
//! Wire contract of the hybrid-LLM-engine spark (2026-09-17). The tier
//! table in `model_routing` stays the calibrated default; this module adds
//! the operator's choice per tier (Settings > Engine > Athena tiers) and the
//! env-var layer that bench runs use, and resolves the three into one
//! [`ResolvedTier`] the spawn path reads. Consumers: `session/launch.rs`
//! (argv per engine), `turn_ledger` (records `engine` + `tier_class` +
//! `first_text_ms` per turn), `commands/companion/engine.rs` (IPC).
//!
//! Resolution order, highest first: env (`PERSONAS_ATHENA_ENGINE`,
//! `PERSONAS_ATHENA_MODEL`, `PERSONAS_ATHENA_EFFORT`, MAIN tier only, kept
//! for the bench) → persisted setting → `model_routing` constant. A tier
//! that names an engine which is not installed falls back to Claude and the
//! turn record says so (`fallback_reason = "engine_missing"`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::{repos::core::settings as settings_repo, settings_keys, DbPool};
use crate::error::AppError;

/// The CLI that runs an Athena turn. `Claude` is Claude Code (`claude`),
/// `Grok` is xAI's Grok Build CLI (`grok`, headless `-p` with
/// `--output-format streaming-messages-json`, which emits the same
/// stream-json envelope the companion stream already forwards).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, Default)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum AthenaEngine {
    #[default]
    Claude,
    Grok,
}

impl AthenaEngine {
    pub const ALL: [AthenaEngine; 2] = [AthenaEngine::Claude, AthenaEngine::Grok];

    /// The setting-row spelling. Round-trips through [`Self::parse`].
    pub fn as_setting(self) -> &'static str {
        match self {
            AthenaEngine::Claude => "claude",
            AthenaEngine::Grok => "grok",
        }
    }

    /// Lenient parse for a setting row or env var; unknown → `None`.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "claude" | "claude_code" => Some(AthenaEngine::Claude),
            "grok" => Some(AthenaEngine::Grok),
            _ => None,
        }
    }
}

/// The three Athena call classes of `model_routing` (registry
/// `model-routing/turn-classification`: one call, one class; the class
/// travels into the turn record). Chat and voice are both `Main`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum TurnTierClass {
    Main,
    Aside,
    Micro,
}

impl TurnTierClass {
    pub const ALL: [TurnTierClass; 3] = [
        TurnTierClass::Main,
        TurnTierClass::Aside,
        TurnTierClass::Micro,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            TurnTierClass::Main => "main",
            TurnTierClass::Aside => "aside",
            TurnTierClass::Micro => "micro",
        }
    }
}

/// One tier's operator choice. `model` and `effort` are the CLI's own
/// spellings (`--model` / `--effort` values); an empty string means "the
/// calibrated default for this tier".
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaTierSettings {
    pub engine: AthenaEngine,
    pub model: String,
    pub effort: String,
}

/// The persisted Athena tier table — what Settings > Engine edits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AthenaEngineSettings {
    pub main: AthenaTierSettings,
    pub aside: AthenaTierSettings,
    pub micro: AthenaTierSettings,
}

/// What `companion_probe_engines` reports per engine, probed through the
/// same spawn door the real turn uses (registry
/// `agent-cli-transport/availability-probe`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EngineAvailability {
    pub engine: AthenaEngine,
    pub installed: bool,
    /// `--version` output when installed.
    pub version: Option<String>,
    /// Model ids the engine reports (grok: `grok models`; claude: the
    /// `model_ids` catalog), empty when not installed.
    pub models: Vec<String>,
    /// Human-readable reason when not installed or partially usable
    /// (binary missing, auth expired, ...).
    pub detail: Option<String>,
}

/// The effective `(engine, model, effort)` for one turn after env,
/// setting and default are folded.
// Consumed by the spawn path (session/launch.rs) once WP1 lands.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedTier {
    pub class: TurnTierClass,
    pub engine: AthenaEngine,
    pub model: String,
    /// `None` = the CLI's default effort for the model.
    pub effort: Option<String>,
}

/// CLI `--effort` levels both engines accept in headless mode (grok 1.0.34
/// rejects `none` despite its README; claude accepts these four).
pub const EFFORT_LEVELS: [&str; 4] = ["low", "medium", "high", "xhigh"];

fn valid_effort(e: &str) -> Option<String> {
    let e = e.trim().to_ascii_lowercase();
    EFFORT_LEVELS.contains(&e.as_str()).then_some(e)
}

fn default_tier(class: TurnTierClass) -> AthenaTierSettings {
    use super::model_routing::{ASIDE, MAIN, MICRO};
    let t = match class {
        TurnTierClass::Main => &MAIN,
        TurnTierClass::Aside => &ASIDE,
        TurnTierClass::Micro => &MICRO,
    };
    AthenaTierSettings {
        engine: AthenaEngine::Claude,
        model: t.model.to_string(),
        effort: t.effort.unwrap_or("").to_string(),
    }
}

/// The calibrated defaults, as the settings surface renders them before
/// the operator touches anything.
#[allow(dead_code)]
pub fn defaults() -> AthenaEngineSettings {
    AthenaEngineSettings {
        main: default_tier(TurnTierClass::Main),
        aside: default_tier(TurnTierClass::Aside),
        micro: default_tier(TurnTierClass::Micro),
    }
}

fn keys(class: TurnTierClass) -> (&'static str, &'static str, &'static str) {
    match class {
        TurnTierClass::Main => (
            settings_keys::COMPANION_TIER_MAIN_ENGINE,
            settings_keys::COMPANION_TIER_MAIN_MODEL,
            settings_keys::COMPANION_TIER_MAIN_EFFORT,
        ),
        TurnTierClass::Aside => (
            settings_keys::COMPANION_TIER_ASIDE_ENGINE,
            settings_keys::COMPANION_TIER_ASIDE_MODEL,
            settings_keys::COMPANION_TIER_ASIDE_EFFORT,
        ),
        TurnTierClass::Micro => (
            settings_keys::COMPANION_TIER_MICRO_ENGINE,
            settings_keys::COMPANION_TIER_MICRO_MODEL,
            settings_keys::COMPANION_TIER_MICRO_EFFORT,
        ),
    }
}

fn load_tier(db: &DbPool, class: TurnTierClass) -> Result<AthenaTierSettings, AppError> {
    let (ek, mk, fk) = keys(class);
    let mut tier = default_tier(class);
    if let Some(e) = settings_repo::get(db, ek)?
        .as_deref()
        .and_then(AthenaEngine::parse)
    {
        tier.engine = e;
    }
    if let Some(m) = settings_repo::get(db, mk)? {
        if !m.trim().is_empty() {
            tier.model = m.trim().to_string();
        }
    }
    if let Some(f) = settings_repo::get(db, fk)?
        .as_deref()
        .and_then(valid_effort)
    {
        tier.effort = f;
    }
    Ok(tier)
}

/// Persisted table with defaults filled in for unset rows.
pub fn load(db: &DbPool) -> Result<AthenaEngineSettings, AppError> {
    Ok(AthenaEngineSettings {
        main: load_tier(db, TurnTierClass::Main)?,
        aside: load_tier(db, TurnTierClass::Aside)?,
        micro: load_tier(db, TurnTierClass::Micro)?,
    })
}

/// Persist the whole table. Effort strings are validated against
/// [`EFFORT_LEVELS`] (empty = default); an invalid one is an error, not a
/// silent drop, so a typo never becomes a CLI flag.
pub fn save(db: &DbPool, settings: &AthenaEngineSettings) -> Result<(), AppError> {
    for (class, tier) in [
        (TurnTierClass::Main, &settings.main),
        (TurnTierClass::Aside, &settings.aside),
        (TurnTierClass::Micro, &settings.micro),
    ] {
        let (ek, mk, fk) = keys(class);
        // An empty effort is a legal value ("the calibrated default"), not a
        // missing input; only a non-empty string has to name a known level.
        let effort = match tier.effort.trim() {
            "" => String::new(),
            named => valid_effort(named).ok_or_else(|| {
                AppError::Validation(format!(
                    "{} tier: effort must be one of {}",
                    class.as_str(),
                    EFFORT_LEVELS.join("|")
                ))
            })?,
        };
        settings_repo::set(db, ek, tier.engine.as_setting())?;
        settings_repo::set(db, mk, tier.model.trim())?;
        settings_repo::set(db, fk, &effort)?;
    }
    Ok(())
}

/// Fold env → setting → default for one class. The env layer applies to
/// the MAIN tier only (it exists for bench runs of the chat surface).
#[allow(dead_code)]
pub fn resolve(db: &DbPool, class: TurnTierClass) -> ResolvedTier {
    let tier = load_tier(db, class).unwrap_or_else(|_| default_tier(class));
    let mut engine = tier.engine;
    let mut model = tier.model;
    let mut effort = valid_effort(&tier.effort);
    if class == TurnTierClass::Main {
        if let Some(e) = std::env::var("PERSONAS_ATHENA_ENGINE")
            .ok()
            .as_deref()
            .and_then(AthenaEngine::parse)
        {
            engine = e;
        }
        if let Ok(m) = std::env::var("PERSONAS_ATHENA_MODEL") {
            if !m.trim().is_empty() {
                model = m.trim().to_string();
            }
        }
        if let Some(f) = std::env::var("PERSONAS_ATHENA_EFFORT")
            .ok()
            .as_deref()
            .and_then(valid_effort)
        {
            effort = Some(f);
        }
    }
    ResolvedTier {
        class,
        engine,
        model,
        effort,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_setting_round_trips() {
        for e in AthenaEngine::ALL {
            assert_eq!(AthenaEngine::parse(e.as_setting()), Some(e));
        }
        assert_eq!(
            AthenaEngine::parse("claude_code"),
            Some(AthenaEngine::Claude)
        );
        assert_eq!(AthenaEngine::parse("gemini"), None);
    }

    #[test]
    fn defaults_mirror_model_routing() {
        let d = defaults();
        assert_eq!(d.main.model, super::super::model_routing::MAIN.model);
        assert_eq!(d.main.effort, "low");
        assert_eq!(d.main.engine, AthenaEngine::Claude);
        assert_eq!(d.micro.model, super::super::model_routing::MICRO.model);
    }

    /// The defect the first live run found (2026-09-18): the nine tier keys
    /// were never registered with the settings repo, so every save was
    /// refused as "unknown settings key" and no test went through the repo.
    #[test]
    fn a_saved_table_round_trips_through_the_real_settings_repo() {
        let db = personas_db::init_test_db().expect("test db");
        let mut table = defaults();
        table.main.engine = AthenaEngine::Grok;
        table.main.model = "grok-4.6".into();
        table.main.effort = "low".into();
        table.aside.effort = String::new();
        save(&db, &table).expect("the tier keys are registered settings keys");
        let loaded = load(&db).expect("load");
        assert_eq!(loaded.main.engine, AthenaEngine::Grok);
        assert_eq!(loaded.main.model, "grok-4.6");
        assert_eq!(loaded.main.effort, "low");
        // An empty effort row means "the calibrated default", so load fills it.
        assert_eq!(loaded.aside.effort, defaults().aside.effort);
    }

    #[test]
    fn effort_validation_is_closed() {
        assert_eq!(valid_effort(" High "), Some("high".into()));
        assert_eq!(valid_effort("none"), None);
        assert_eq!(valid_effort(""), None);
    }
}
