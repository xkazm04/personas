//! Template matching for Athena's `show_template_suggestions` chat-card.
//!
//! When Athena emits `show_template_suggestions { intent }`, the dispatcher
//! creates a chat-card carrying the intent text. The widget on mount calls
//! [`companion_match_templates`] which extracts keywords from the intent
//! and queries the existing `persona_design_reviews` SQL surface used by
//! smart_search_templates' pre-filter. Returns a slim shape the widget
//! renders directly — no LLM call, no async background job.
//!
//! Keep this lean: the chat-card is meant to be a fast "here are 3
//! templates worth a look" pointer, not a full smart-search rerank. The
//! existing smart_search_templates command still exists for users who
//! want LLM-quality matching from the design-reviews view.

use std::sync::Arc;

use serde::Serialize;
use tauri::State;

use crate::db::repos::communication::reviews::search_reviews_compact;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Hard cap on how many matches the widget renders. Three cards is the
/// sweet spot — enough to give the user a real choice, few enough that
/// the inline chat-card doesn't dominate the transcript.
const DEFAULT_LIMIT: u32 = 3;
const MAX_LIMIT: u32 = 5;

/// Lower bound on word length for keyword extraction. Drops stop-word-
/// ish single chars + 2-letter fillers that LIKE-match too aggressively.
const MIN_KEYWORD_LEN: usize = 3;

/// English stop words pulled out of the keyword set before they LIKE-
/// match every template. Short list — we're not trying to be linguistic,
/// just to keep "a", "the", "and" out of the SQL.
const STOP_WORDS: &[&str] = &[
    "the", "and", "for", "with", "from", "into", "that", "this", "want", "need", "would", "could",
    "should", "have", "has", "are", "you", "your", "but", "can", "all", "any", "one", "two",
    "three", "what", "when", "who", "why", "how",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionTemplateMatch {
    pub id: String,
    pub name: String,
    /// First ~200 chars of the instruction body — enough to glance.
    pub snippet: String,
    pub category: Option<String>,
    pub connectors: Vec<String>,
}

#[tauri::command]
pub async fn companion_match_templates(
    state: State<'_, Arc<AppState>>,
    intent: String,
    limit: Option<u32>,
) -> Result<Vec<CompanionTemplateMatch>, AppError> {
    require_auth(&state).await?;
    let cap = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) as i64;
    let keywords = extract_keywords(&intent);
    let (rows, _total) = search_reviews_compact(&state.db, &keywords, cap)?;
    let matches = rows
        .into_iter()
        .map(|r| {
            let snippet = if r.instruction.chars().count() > 200 {
                let truncated: String = r.instruction.chars().take(199).collect();
                format!("{truncated}\u{2026}")
            } else {
                r.instruction
            };
            let connectors: Vec<String> = r
                .connectors_used
                .as_deref()
                .filter(|c| !c.is_empty())
                .map(|c| c.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default();
            CompanionTemplateMatch {
                id: r.id,
                name: r.name,
                snippet,
                category: r.category,
                connectors,
            }
        })
        .collect();
    Ok(matches)
}

fn extract_keywords(intent: &str) -> Vec<String> {
    intent
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .filter(|w| w.len() >= MIN_KEYWORD_LEN && !STOP_WORDS.contains(&w.as_str()))
        // Cap at 8 keywords so a verbose intent doesn't explode the LIKE
        // query into pathological OR-tree territory. Order preserves
        // input order so the first-mentioned terms (usually the most
        // specific) survive the cut.
        .take(8)
        .collect()
}
