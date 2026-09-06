//! The connector catalog's TYPE vocabulary, and the type -> instance lookups
//! Recipe v3 adoption resolves through.
//!
//! The catalog's plural `categories` field (`scripts/connectors/builtin/*.json`)
//! is the vocabulary a v3 recipe declares its `connector_types` against
//! (`transcription`, `analytics`, `social`, ...). It is deliberately the plural
//! field and not the singular `category`: deepgram's `category` is `ai`, which
//! says nothing useful, while its `categories` are
//! `["ai", "transcription", "voice_generation"]`.
//!
//! Until 2026-09 `categories` was dropped by `scripts/generate-connector-seed.mjs`
//! and existed only in TypeScript (`src/lib/credentials/builtinConnectors.ts`).
//! It is now emitted onto every `BuiltinConnector` plus a deduped
//! `KNOWN_CONNECTOR_CATEGORIES`; this module is the hand-written reader over
//! that generated data. No DB, no IO — the catalog is compiled in.

use crate::builtin_connectors::{BUILTIN_CONNECTORS, KNOWN_CONNECTOR_CATEGORIES};

/// The closed category vocabulary, sorted. Pass this to
/// `RecipeSpec::validate`.
pub fn known_categories() -> &'static [&'static str] {
    KNOWN_CONNECTOR_CATEGORIES
}

/// Whether `category` is a real catalog category.
pub fn is_known_category(category: &str) -> bool {
    KNOWN_CONNECTOR_CATEGORIES.contains(&category)
}

/// Every type tag a connector answers to. Empty for a name the builtin catalog
/// does not know (a user-authored connector), which callers must read as "no
/// opinion", never as "wrong".
pub fn categories_of(connector_name: &str) -> &'static [&'static str] {
    BUILTIN_CONNECTORS
        .iter()
        .find(|c| c.name == connector_name)
        .map(|c| c.categories)
        .unwrap_or(&[])
}

/// Whether the named connector answers to `category`. False for an unknown
/// connector — see [`categories_of`].
pub fn connector_has_category(connector_name: &str, category: &str) -> bool {
    categories_of(connector_name).contains(&category)
}

/// Builtin connector NAMES whose categories include `category`, in catalog
/// order. This is the offer list adoption shows for one declared
/// `connector_type`.
pub fn connectors_in_category(category: &str) -> Vec<&'static str> {
    BUILTIN_CONNECTORS
        .iter()
        .filter(|c| c.categories.contains(&category))
        .map(|c| c.name)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_vocabulary_is_populated_and_sorted() {
        assert!(
            KNOWN_CONNECTOR_CATEGORIES.len() > 20,
            "the catalog declares far more than this; got {}",
            KNOWN_CONNECTOR_CATEGORIES.len()
        );
        let mut sorted = KNOWN_CONNECTOR_CATEGORIES.to_vec();
        sorted.sort_unstable();
        assert_eq!(
            sorted.as_slice(),
            KNOWN_CONNECTOR_CATEGORIES,
            "the generator must emit a sorted vocabulary so the diff is stable"
        );
        for c in ["analytics", "transcription", "email", "social"] {
            assert!(is_known_category(c), "{c} must be in the vocabulary");
        }
        assert!(
            !is_known_category("deepgram"),
            "a connector id is not a category"
        );
    }

    /// The catalog's own worked example, and the reason the PLURAL field is
    /// the vocabulary: `category` alone would file deepgram under `ai` and a
    /// transcription recipe would never find it.
    #[test]
    fn deepgram_answers_to_transcription_not_just_ai() {
        let cats = categories_of("deepgram");
        assert!(cats.contains(&"transcription"), "got {cats:?}");
        assert!(cats.contains(&"ai"), "got {cats:?}");
        assert!(connector_has_category("deepgram", "transcription"));
        assert!(!connector_has_category("deepgram", "email"));
    }

    #[test]
    fn an_unknown_connector_has_no_categories_rather_than_wrong_ones() {
        assert!(categories_of("a-connector-the-user-wrote").is_empty());
        assert!(!connector_has_category(
            "a-connector-the-user-wrote",
            "email"
        ));
    }

    #[test]
    fn a_category_offers_its_connectors() {
        let offers = connectors_in_category("transcription");
        assert!(offers.contains(&"deepgram"), "got {offers:?}");
        assert!(connectors_in_category("not-a-category").is_empty());
    }

    /// Every category the vocabulary lists must be reachable from at least one
    /// connector — a category nobody carries is an offer list that is always
    /// empty, which is the "gate that ran green while checking nothing" shape.
    #[test]
    fn every_category_in_the_vocabulary_has_at_least_one_connector() {
        for category in KNOWN_CONNECTOR_CATEGORIES {
            assert!(
                !connectors_in_category(category).is_empty(),
                "category {category} is in the vocabulary but no connector carries it"
            );
        }
    }
}
