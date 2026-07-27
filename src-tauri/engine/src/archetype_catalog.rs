//! Persona Foundry foundation palette — mentality archetypes + memory
//! strategies, embedded from `scripts/templates/_archetypes.json`.
//!
//! An archetype is a curated mentality preset (core dials, identity, voice,
//! principles) shaped as a **mini schema-v3 template persona**, so Foundry
//! creation drives the real adoption pipeline (`create_adoption_session` →
//! `normalize_v3_to_flat` → `promote_build_draft`) with a synthesized
//! template payload instead of a parallel compile path. The nine archetypes
//! were distilled from a corpus audit of all 111 templates' persona prose
//! (2026-07-06); memory strategies name the intent of the app's memory
//! subsystems as one selectable choice (v1 records intent + drives setup
//! chips — it wires nothing itself).
//!
//! Static catalog data: parsed on demand from the embedded JSON, no DB
//! table (mirrors how `recipe_seed.rs` embeds its bundle; unlike recipes,
//! archetypes need no per-install rows — the persona snapshots everything
//! it uses at creation time).

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use ts_rs::TS;

const ARCHETYPES_JSON: &str = include_str!("../../../scripts/templates/_archetypes.json");

/// One mentality archetype card. `persona` is the opaque v3 persona payload
/// the frontend forwards verbatim into the synthesized adoption template —
/// typed loosely on purpose so archetype authoring can evolve without a
/// Rust/TS schema change.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Archetype {
    pub id: String,
    pub name: String,
    pub tagline: String,
    /// Lucide icon name (matches template `icon` conventions).
    pub icon: String,
    /// Hex accent color.
    pub color: String,
    /// Recipe catalog buckets this archetype naturally pairs with —
    /// pre-filters the Foundry capability rack.
    pub recipe_affinity: Vec<String>,
    /// Mini schema-v3 `payload.persona` object (core/goal/identity/voice/
    /// principles/constraints/…). Forwarded verbatim at creation.
    #[ts(type = "Record<string, unknown>")]
    pub persona: serde_json::Value,
}

/// Config intent for a memory strategy — which memory subsystems the
/// strategy stands for. v1 is guidance-only.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStrategyConfig {
    /// `"on"` | `"off"` — per-capability memory generation default.
    pub memories: String,
    pub team_pool: bool,
    pub knowledge_base: bool,
    pub obsidian: bool,
}

/// One selectable memory strategy.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStrategy {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub icon: String,
    pub what_it_remembers: String,
    pub best_for: String,
    pub config: MemoryStrategyConfig,
    /// Entities the strategy needs before it's fully live
    /// (`home_team` | `knowledge_base` | `obsidian_vault`) — rendered as
    /// setup chips in the Foundry review step.
    pub requires: Vec<String>,
}

/// The whole embedded palette.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ArchetypeCatalog {
    pub version: u32,
    pub archetypes: Vec<Archetype>,
    pub memory_strategies: Vec<MemoryStrategy>,
}

/// Parse-once accessor. The embedded JSON is validated by the unit test
/// below (and implicitly at first use); a corrupt bundle is a programmer
/// error, not a runtime condition — hence the expect.
pub fn catalog() -> &'static ArchetypeCatalog {
    static CATALOG: OnceLock<ArchetypeCatalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(ARCHETYPES_JSON)
            .expect("embedded _archetypes.json must parse — validated by unit test")
    })
}

/// Look up one archetype by id (case-sensitive — ids are catalog constants).
pub fn get_archetype(id: &str) -> Option<&'static Archetype> {
    catalog().archetypes.iter().find(|a| a.id == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_catalog_parses_and_is_coherent() {
        let c = catalog();
        assert!(c.archetypes.len() >= 8, "expected the full palette");
        assert!(c.memory_strategies.len() >= 4);

        let mut seen = std::collections::HashSet::new();
        for a in &c.archetypes {
            assert!(seen.insert(&a.id), "duplicate archetype id {}", a.id);
            assert!(!a.tagline.is_empty() && !a.icon.is_empty() && !a.color.is_empty());
            // Every persona payload must carry the v3 mentality spine the
            // adoption pipeline + core_profile stamp consume.
            for key in ["core", "goal", "identity", "voice", "principles", "constraints"] {
                assert!(
                    a.persona.get(key).is_some(),
                    "archetype {} persona missing `{key}`",
                    a.id
                );
            }
            // Core must carry the 7 Design-D dials.
            let core = &a.persona["core"];
            for dial in [
                "motivation",
                "stance",
                "northStarCommitment",
                "riskTolerance",
                "speedVsQuality",
                "conflictStyle",
                "deference",
            ] {
                assert!(
                    core.get(dial).is_some(),
                    "archetype {} core missing `{dial}`",
                    a.id
                );
            }
            // Affinities must name real recipe buckets (the UI filter keys).
            const BUCKETS: &[&str] = &[
                "monitoring",
                "reporting",
                "automation",
                "communication",
                "data-sync",
                "analysis",
                "development",
                "content",
                "productivity",
            ];
            for aff in &a.recipe_affinity {
                assert!(
                    BUCKETS.contains(&aff.as_str()),
                    "archetype {} affinity `{aff}` is not a recipe bucket",
                    a.id
                );
            }
        }

        let mut seen_ms = std::collections::HashSet::new();
        for m in &c.memory_strategies {
            assert!(seen_ms.insert(&m.id), "duplicate strategy id {}", m.id);
            assert!(matches!(m.config.memories.as_str(), "on" | "off"));
            for r in &m.requires {
                assert!(
                    matches!(r.as_str(), "home_team" | "knowledge_base" | "obsidian_vault"),
                    "strategy {} unknown requirement `{r}`",
                    m.id
                );
            }
        }

        assert!(get_archetype("guardian").is_some());
        assert!(get_archetype("no-such").is_none());
    }
}
