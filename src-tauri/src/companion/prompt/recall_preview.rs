//! What the UI is told was recalled — the preview payload behind the recall
//! chip, summarised from the same [`Recall`] the prompt was built from.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use serde::Serialize;

use crate::companion::brain::retrieval::Recall;

/// One entry in the per-turn recall preview surfaced to the UI: a short,
/// glanceable label for a single memory item Athena consulted. The `id`
/// is included so a future cycle can deep-link from the chat strip into
/// the Brain Viewer scoped to that entry (stage 2 of this feature).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecallPreviewEntry {
    pub id: String,
    pub title: String,
}

/// A per-turn rollup of what Athena's brain pulled into the system prompt.
/// Emitted on `companion://recall` right before the CLI call kicks off, so
/// the panel can show a "Athena consulted N memories" strip above the
/// streaming bubble. Counts and titles are bounded by the same retrieval
/// caps the prompt builder uses — no extra DB work on top.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecallPreview {
    pub episode_count: u32,
    pub doctrine: Vec<RecallPreviewEntry>,
    pub facts: Vec<RecallPreviewEntry>,
    pub procedurals: Vec<RecallPreviewEntry>,
    pub goals: Vec<RecallPreviewEntry>,
    pub backlog: Vec<RecallPreviewEntry>,
    /// True when a synthesis briefing replaced the raw chunks for this
    /// turn — useful to show in the strip ("synthesized 5000+ tokens
    /// into a focused brief").
    pub synthesized: bool,
}

/// Max characters for any preview title before truncation. The strip is
/// a single line per entry; longer than ~60 chars wraps awkwardly and
/// dilutes the at-a-glance value.
const PREVIEW_TITLE_MAX: usize = 60;

fn truncate_title(s: &str) -> String {
    if s.chars().count() <= PREVIEW_TITLE_MAX {
        return s.to_string();
    }
    let mut out: String = s.chars().take(PREVIEW_TITLE_MAX - 1).collect();
    out.push('\u{2026}');
    out
}

/// Doctrine `file_path` is of the form `<rel_path>#<heading_anchor>`. The
/// rel_path is noisy in a chip; the heading is the human-readable hook.
/// Fall back to the rel_path's last segment when no anchor is present.
fn doctrine_title(file_path: &str) -> String {
    if let Some((rel, anchor)) = file_path.split_once('#') {
        let last = rel.rsplit('/').next().unwrap_or(rel);
        let last_stem = last.strip_suffix(".md").unwrap_or(last);
        let anchor_pretty = anchor.replace('-', " ");
        return truncate_title(&format!("{last_stem} · {anchor_pretty}"));
    }
    let last = file_path.rsplit('/').next().unwrap_or(file_path);
    truncate_title(last.strip_suffix(".md").unwrap_or(last))
}

/// Project a Recall into the slim UI shape. Cheap: zero DB, just borrows
/// the fields we already have in memory.
pub fn summarize_recall(recall: &Recall, synthesized: bool) -> RecallPreview {
    let map_entry = |id: &str, title: &str| RecallPreviewEntry {
        id: id.to_string(),
        title: truncate_title(title),
    };
    RecallPreview {
        episode_count: recall.episodes.len() as u32,
        doctrine: recall
            .doctrine
            .iter()
            .map(|d| RecallPreviewEntry {
                id: d.file_path.clone(),
                title: doctrine_title(&d.file_path),
            })
            .collect(),
        facts: recall
            .facts
            .iter()
            .map(|f| map_entry(&f.id, &f.key))
            .collect(),
        procedurals: recall
            .procedurals
            .iter()
            .map(|p| map_entry(&p.id, &p.trigger))
            .collect(),
        goals: recall
            .goals
            .iter()
            .map(|g| map_entry(&g.id, &g.title))
            .collect(),
        backlog: recall
            .backlog
            .iter()
            .map(|b| map_entry(&b.id, &b.summary))
            .collect(),
        synthesized,
    }
}
