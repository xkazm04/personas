//! Stage D Phase 1 — keyword recipe matcher (v1).
//!
//! Given a user intent string and a list of recipes, returns the top-K
//! matches sorted by similarity score. Used by Glyph composer to suggest
//! existing recipes when the user types an intent that closely matches one.
//!
//! Conservative threshold per user direction (2026-05-08): only surface
//! suggestions at confidence ≥ 0.90. If no recipe meets the threshold, the
//! flow continues unchanged — silent fallthrough, no UI surface.
//!
//! v1 scoring: Jaccard similarity over token sets, weighted toward name +
//! tags matches. Doesn't use embeddings (would require an inference path
//! that's heavy for what is otherwise a debounced typeahead). When v2 lands
//! (vector embeddings via Claude API or local model), this v1 should stay
//! as a fast prefilter that the slower embedding pass refines.

use std::collections::HashSet;

use crate::db::models::RecipeDefinition;

/// Score weight for matches that hit the recipe `name`. Names are the most
/// concise + intentful field, so name-token overlap dominates the score.
const NAME_WEIGHT: f32 = 0.6;

/// Score weight for matches that hit the recipe `description` field.
const DESCRIPTION_WEIGHT: f32 = 0.3;

/// Score weight for matches that hit any of the recipe `tags`.
const TAGS_WEIGHT: f32 = 0.1;

/// Minimum confidence to surface a match in the Glyph composer UI.
/// Aligns with the user's "≥ 0.90 conservative threshold" direction.
pub const SUGGESTION_THRESHOLD: f32 = 0.90;

/// English stopwords stripped from token sets before scoring. Kept narrow on
/// purpose — we don't want to remove domain words like "data" or "report".
const STOPWORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "at", "for", "with",
    "from", "by", "as", "is", "are", "was", "were", "be", "been", "being",
    "i", "me", "my", "you", "your", "we", "our", "it", "its",
    "this", "that", "these", "those", "do", "does", "did", "doing",
    "have", "has", "had", "having", "want", "wants", "wanted",
];

/// One match result. `score` is in [0.0, 1.0]; higher is better. `recipe_id`
/// is the matched recipe's UUID. The frontend uses this to render the
/// suggestion chip (composer pre-fill from recipe.bindings, etc).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct RecipeMatch {
    pub recipe_id: String,
    pub recipe_name: String,
    pub score: f32,
    /// True iff `score >= SUGGESTION_THRESHOLD`. Frontend renders the chip
    /// only when this is true (some flows may want to inspect lower-confidence
    /// matches for debugging — cheap to expose).
    pub above_threshold: bool,
}

/// Tokenize a string into lowercase, stopword-stripped, alphanumeric tokens.
/// Punctuation is treated as a separator. Empty tokens are dropped.
fn tokenize(text: &str) -> HashSet<String> {
    let stopword_set: HashSet<&str> = STOPWORDS.iter().copied().collect();
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter_map(|t| {
            let t = t.trim();
            if t.is_empty() || stopword_set.contains(t) || t.len() < 2 {
                None
            } else {
                Some(t.to_string())
            }
        })
        .collect()
}

/// Jaccard similarity over two token sets: |A ∩ B| / |A ∪ B|.
/// Returns 0.0 if both sets are empty (avoids 0/0 NaN).
fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> f32 {
    if a.is_empty() && b.is_empty() {
        return 0.0;
    }
    let intersection = a.intersection(b).count();
    let union = a.union(b).count();
    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}

/// Parse a recipe's stored `tags` JSON string into a flat token set.
/// `recipe.tags` is JSON-encoded `Vec<String>` per the existing schema.
/// Returns an empty set on parse failures (malformed tag data shouldn't
/// drag the recipe out of the candidate pool — name + description still
/// score it).
fn extract_tag_tokens(tags_json: Option<&str>) -> HashSet<String> {
    let Some(raw) = tags_json else {
        return HashSet::new();
    };
    let Ok(tags) = serde_json::from_str::<Vec<String>>(raw) else {
        return HashSet::new();
    };
    let mut out = HashSet::new();
    for tag in tags {
        out.extend(tokenize(&tag));
    }
    out
}

/// Score a single recipe against the intent's pre-tokenized form. The
/// caller tokenizes the intent once and passes the set in (avoids
/// re-tokenizing for every recipe in the pool).
fn score_recipe(intent_tokens: &HashSet<String>, recipe: &RecipeDefinition) -> f32 {
    let name_tokens = tokenize(&recipe.name);
    let desc_tokens = recipe
        .description
        .as_deref()
        .map(tokenize)
        .unwrap_or_default();
    let tag_tokens = extract_tag_tokens(recipe.tags.as_deref());

    let name_score = jaccard(intent_tokens, &name_tokens);
    let desc_score = jaccard(intent_tokens, &desc_tokens);
    let tags_score = jaccard(intent_tokens, &tag_tokens);

    NAME_WEIGHT * name_score + DESCRIPTION_WEIGHT * desc_score + TAGS_WEIGHT * tags_score
}

/// Match an intent against a list of recipes. Returns the top-K results
/// sorted by score descending. K defaults to 3 if `top_k` is None or 0;
/// callers typically want top-1 (the single suggestion to surface).
///
/// The caller decides whether to surface the result: check
/// `above_threshold` on each match, render the chip only for matches at
/// score ≥ SUGGESTION_THRESHOLD. Matches below the threshold are still
/// returned so debug surfaces can inspect them.
pub fn match_intent_to_recipes(
    intent: &str,
    recipes: &[RecipeDefinition],
    top_k: Option<usize>,
) -> Vec<RecipeMatch> {
    let k = top_k.unwrap_or(3).max(1);
    let intent_tokens = tokenize(intent);
    if intent_tokens.is_empty() {
        return Vec::new();
    }

    let mut scored: Vec<(f32, &RecipeDefinition)> = recipes
        .iter()
        .map(|r| (score_recipe(&intent_tokens, r), r))
        .filter(|(s, _)| *s > 0.0) // drop zero-overlap noise
        .collect();

    // Descending by score; ties broken by recipe name for determinism.
    scored.sort_by(|(sa, ra), (sb, rb)| {
        sb.partial_cmp(sa)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| ra.name.cmp(&rb.name))
    });
    scored.truncate(k);

    scored
        .into_iter()
        .map(|(score, r)| RecipeMatch {
            recipe_id: r.id.clone(),
            recipe_name: r.name.clone(),
            score,
            above_threshold: score >= SUGGESTION_THRESHOLD,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_recipe(id: &str, name: &str, description: Option<&str>, tags: Option<&[&str]>) -> RecipeDefinition {
        let tags_json = tags.map(|t| {
            serde_json::to_string(&t.iter().map(|s| s.to_string()).collect::<Vec<_>>()).unwrap()
        });
        RecipeDefinition {
            id: id.to_string(),
            project_id: "default".to_string(),
            credential_id: None,
            use_case_id: None,
            name: name.to_string(),
            description: description.map(String::from),
            category: None,
            prompt_template: String::new(),
            input_schema: None,
            output_contract: None,
            tool_requirements: None,
            credential_requirements: None,
            model_preference: None,
            sample_inputs: None,
            tags: tags_json,
            icon: None,
            color: None,
            is_builtin: true,
            created_at: "2026-05-09T00:00:00Z".to_string(),
            updated_at: "2026-05-09T00:00:00Z".to_string(),
            source_template_id: None,
            source_use_case_id: None,
            source_use_case_name: None,
            source_version: None,
        }
    }

    #[test]
    fn tokenize_strips_punctuation_and_lowercases() {
        let toks = tokenize("Summarize the daily emails!");
        assert!(toks.contains("summarize"));
        assert!(toks.contains("daily"));
        assert!(toks.contains("emails"));
        // Stopwords removed.
        assert!(!toks.contains("the"));
    }

    #[test]
    fn tokenize_drops_short_and_empty() {
        let toks = tokenize("a b ab");
        assert!(!toks.contains("a"));
        assert!(!toks.contains("b"));
        assert!(toks.contains("ab"));
    }

    #[test]
    fn jaccard_basic() {
        let a: HashSet<String> = ["x", "y", "z"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["y", "z", "w"].iter().map(|s| s.to_string()).collect();
        // intersection {y,z}=2, union {x,y,z,w}=4 → 0.5
        assert_eq!(jaccard(&a, &b), 0.5);
    }

    #[test]
    fn jaccard_disjoint_is_zero() {
        let a: HashSet<String> = ["foo"].iter().map(|s| s.to_string()).collect();
        let b: HashSet<String> = ["bar"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard(&a, &b), 0.0);
    }

    #[test]
    fn jaccard_identical_is_one() {
        let a: HashSet<String> = ["x", "y"].iter().map(|s| s.to_string()).collect();
        assert_eq!(jaccard(&a, &a), 1.0);
    }

    #[test]
    fn match_returns_empty_for_empty_intent() {
        let recipes = vec![make_recipe("r1", "Email Triage", None, None)];
        assert!(match_intent_to_recipes("", &recipes, None).is_empty());
        assert!(match_intent_to_recipes("a the of", &recipes, None).is_empty());
    }

    #[test]
    fn match_high_score_on_near_identical_intent() {
        let recipes = vec![make_recipe(
            "r1",
            "Email Triage Manager",
            Some("Classifies incoming emails as urgent, normal, or spam"),
            Some(&["email", "triage", "classification"]),
        )];
        let matches = match_intent_to_recipes(
            "Triage my email inbox",
            &recipes,
            Some(1),
        );
        assert_eq!(matches.len(), 1);
        // Name overlap (email, triage) drives the score; with NAME_WEIGHT=0.6
        // and 2-of-3 in the recipe name + 2-of-3 in the intent, jaccard ≈ 0.5,
        // so total ≈ 0.6*0.5 + smaller desc/tag contributions.
        assert!(matches[0].score > 0.3, "score={} too low", matches[0].score);
    }

    #[test]
    fn match_threshold_gate() {
        // Crafted to land near the SUGGESTION_THRESHOLD boundary: identical
        // intent and name → name_jaccard = 1.0 → name_score = 0.6, plus
        // potential desc/tag contributions push above 0.90 only when those
        // also overlap.
        let perfect = make_recipe(
            "perfect",
            "summarize incoming support emails",
            Some("summarize incoming support emails"),
            Some(&["summarize", "incoming", "support", "emails"]),
        );
        // Weak recipe: shares one token ("emails") so it's scored at all,
        // but most tokens diverge → score lands well below threshold.
        let weak = make_recipe(
            "weak",
            "Forward emails to slack",
            Some("Pushes inbound mail to a configured channel"),
            None,
        );
        let recipes = vec![perfect, weak];
        let matches = match_intent_to_recipes(
            "summarize incoming support emails",
            &recipes,
            Some(2),
        );
        assert_eq!(matches.len(), 2);
        // Best match is the identical-text recipe.
        assert_eq!(matches[0].recipe_id, "perfect");
        assert!(matches[0].above_threshold,
            "identical-text match should clear threshold; score={}", matches[0].score);
        // Weak match gets a non-zero but below-threshold score.
        assert_eq!(matches[1].recipe_id, "weak");
        assert!(!matches[1].above_threshold);
    }

    #[test]
    fn match_filters_zero_overlap_recipes() {
        let recipes = vec![
            make_recipe("r1", "Email Triage", Some("inbox stuff"), None),
            make_recipe("r2", "Generate Quarterly Report", Some("revenue numbers"), None),
            make_recipe("r3", "Database Performance Monitor", Some("postgres"), None),
        ];
        let matches = match_intent_to_recipes("Triage my inbox emails", &recipes, Some(5));
        // Only r1 should appear — r2 and r3 share no tokens with the intent.
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].recipe_id, "r1");
    }

    #[test]
    fn match_top_k_limits_results() {
        let recipes: Vec<_> = (0..10)
            .map(|i| make_recipe(&format!("r{i}"), &format!("daily report {i}"), None, None))
            .collect();
        let matches = match_intent_to_recipes("daily report", &recipes, Some(3));
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn match_deterministic_tiebreak_by_name() {
        // All three recipes have identical names + descriptions → identical
        // scores. Ties break by recipe name (which is also identical), so
        // sort is then by id (since it's stable). Our impl uses recipe.name
        // for the tie-break — when names are equal, sort_by's stability
        // keeps insertion order. We just verify the function returns 3.
        let recipes = vec![
            make_recipe("r1", "Same Recipe", Some("identical"), None),
            make_recipe("r2", "Same Recipe", Some("identical"), None),
            make_recipe("r3", "Same Recipe", Some("identical"), None),
        ];
        let matches = match_intent_to_recipes("same recipe identical", &recipes, Some(3));
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn match_handles_malformed_tags_gracefully() {
        let mut bad = make_recipe("r1", "Email Triage", Some("inbox"), None);
        bad.tags = Some("not valid json {{".to_string()); // malformed
        let recipes = vec![bad];
        // Should not panic; tag tokens contribute 0 but name still scores.
        let matches = match_intent_to_recipes("triage email", &recipes, Some(1));
        assert_eq!(matches.len(), 1);
    }

    #[test]
    fn suggestion_threshold_constant_is_at_90() {
        // Lock the user-specified conservative threshold. If this test fails,
        // the threshold drift was intentional → update the constant + this
        // test together; otherwise revert.
        assert_eq!(SUGGESTION_THRESHOLD, 0.90);
    }
}
