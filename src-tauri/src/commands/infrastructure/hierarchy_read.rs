//! Reader for the knowledge hierarchy under `docs/concepts/paths/`.
//!
//! **The docs are the single authority.** This module is a READER — it never
//! writes to the corpus and never ingests it into SQLite. Ingesting would
//! create a second authority that drifts, which is precisely the failure class
//! the hierarchy itself documents (`_laws.md#one-authority-per-vocabulary`).
//! Adoption/verification STATE stays in the DB and joins by slug identity;
//! structure comes from disk on every read, mtime-cached.
//!
//! The frontmatter parser here is a deliberate 1:1 port of the JS parser in
//! `scripts/census/check-corpus-integrity.mjs` §3.5 (`parseFrontmatter`) — same
//! YAML subset, same tolerances, same quirks. Two parsers over one contract is
//! a drift risk, so `frontmatter_matches_committed_table_subject` pins the
//! coupling against a real committed subject file via `include_str!`: if the
//! contract shifts, that test notices before the UI renders nonsense.
//!
//! **Tolerance is a requirement, not a nicety.** The corpus is forged wave by
//! wave, so at any moment some subject folders are incomplete: a missing
//! `<slug>.md`, a declared technique whose file has not landed, a malformed
//! frontmatter block. None of those may abort the read. Every one becomes a
//! `HierarchyWarning` and the rest of the tree still renders — the same
//! skip-with-count posture the integrity checker takes.
//!
//! Emptiness is likewise reported, never thrown: a project with no root path,
//! a root that does not exist, or a repo with no `docs/concepts/paths/` returns
//! an empty graph whose `source.reason` explains WHY, so the UI can say
//! something true instead of showing a spinner forever. Only a genuine I/O
//! fault on an existing directory is an `Err`.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::dev_tools as repo;
use crate::engine::path_safety::resolve_within_root;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Repo-relative location of the hierarchy corpus in a personas-shaped repo.
const PATHS_REL: &str = "docs/concepts/paths";
/// The subtree `dev_tools_hierarchy_doc` may read from in a personas-shaped repo.
const DOC_ROOT_REL: &str = "docs/concepts";
/// Where a Reference Knowledge Bundle lives in a registry clone. One directory
/// per domain beneath it (`knowledge/software-engineering`, `knowledge/media-craft`).
const BUNDLE_LANE_REL: &str = "knowledge";
/// Summary clamp. Long enough for a real first paragraph, short enough that a
/// subject row in the rail stays a row.
const SUMMARY_MAX: usize = 280;
/// How many repo roots the graph cache retains. **Everything created names its
/// reaper** (`_laws.md#creation-names-reaper`): without this the map grows once
/// per distinct managed project for the life of the process.
const CACHE_MAX_ROOTS: usize = 2;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// Where the graph came from, and — when it is empty — why.
///
/// An empty graph with no explanation is indistinguishable from a broken
/// reader, so this struct is populated on every path including success.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchySource {
    /// Canonical repo root the reader used, when one could be resolved.
    pub root: Option<String>,
    /// True when a corpus was found and read.
    pub present: bool,
    /// Human-readable reason the graph is empty. `None` when `present`.
    pub reason: Option<String>,
    /// Repo-relative directory the corpus was read from — `docs/concepts/paths`
    /// in a personas-shaped repo, `knowledge/<domain>` in a registry clone.
    ///
    /// **This is the frontend's only source of truth for corpus location.** It
    /// exists so no consumer has to hardcode a layout the reader already knows;
    /// duplicating it in a UI regex is the two-authorities failure
    /// (`_laws.md#one-authority-per-vocabulary`) the corpus itself documents.
    pub corpus_rel: Option<String>,
    /// Repo-relative subtree `dev_tools_hierarchy_doc` will serve documents from.
    /// Wider than `corpus_rel` so sibling notes a document links to stay readable.
    pub doc_root_rel: Option<String>,
}

/// One tolerated defect. The read continued; this is what it skipped.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyWarning {
    /// Repo-relative path of the offending file or folder.
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyCategory {
    pub id: String,
    pub title: String,
    /// Compass sequence. Unique across categories (checker-enforced).
    pub order: i32,
}

/// A technique this subject uses but does not own (`pagination@table`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SharedTechniqueRef {
    pub technique: String,
    /// Subject slug that owns the canonical form.
    pub owner: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyApplication {
    /// Repo-relative path, suitable for `dev_tools_hierarchy_doc`.
    pub file: String,
    pub stack: String,
    pub technique: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchySubject {
    pub slug: String,
    /// First `# ` heading of the golden-path body; falls back to the slug.
    pub title: String,
    /// First non-empty body paragraph after the H1, whitespace-collapsed and
    /// clamped to ~280 chars.
    pub summary: String,
    /// Repo-relative path of the golden path itself.
    pub file: String,
    /// From `categories.json`. `None` when the subject is unassigned — which is
    /// a checker failure, but must still render here.
    pub category: Option<String>,
    /// Frontmatter `status`: draft | forged | reconciled | transplant-tested.
    pub status: Option<String>,
    /// LOCAL technique slugs (files under `techniques/`).
    pub techniques: Vec<String>,
    /// Techniques referenced from another subject via the `slug@owner` form.
    pub shared_techniques: Vec<SharedTechniqueRef>,
    pub applications: Vec<HierarchyApplication>,
    pub evidence: Vec<String>,
    pub counter_evidence: Vec<String>,
    /// Anchor ids registered in `golden-path-deferred-fixes.md`.
    pub deviations: Vec<String>,
    /// How many legacy corpus docs `corpus-map.json` maps to this subject.
    pub legacy_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyTechnique {
    pub slug: String,
    pub subject: String,
    pub title: String,
    pub summary: String,
    /// Repo-relative path, suitable for `dev_tools_hierarchy_doc`.
    pub file: String,
    pub status: Option<String>,
    /// Anchor ids into `_laws.md`.
    pub laws: Vec<String>,
    /// Other subjects that reference this technique.
    pub shared_with: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyLaw {
    /// Stable anchor id, e.g. `gate-sees-target`.
    pub id: String,
    pub title: String,
    pub summary: String,
}

/// A relative markdown link from one subject's prose into another subject's
/// folder. `kind` records what the link pointed AT, not what it came from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyCrossLink {
    /// Source SUBJECT slug.
    pub from: String,
    /// Target SUBJECT slug.
    pub to: String,
    /// `subject` (the link targeted the other subject's golden path or folder)
    /// or `technique` (it targeted a file under the other subject's
    /// `techniques/`).
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CorpusMapEntry {
    /// Filename under `docs/concepts/golden-paths/`.
    pub legacy_file: String,
    pub subject: String,
}

/// Counts carry their predicate (`_laws.md#count-carries-predicate`): each of
/// these is "what the reader actually parsed", NOT "what the corpus declares".
/// A subject skipped for a missing golden path is absent from `subjects` and
/// present in `warnings`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyCounts {
    /// Subjects successfully parsed (folders skipped for defects excluded).
    pub subjects: u32,
    /// Technique files successfully parsed.
    pub techniques: u32,
    /// Application files successfully parsed.
    pub applications: u32,
    /// Evidence entries summed over parsed subjects (counter-evidence excluded).
    pub evidence: u32,
    /// `corpus-map.json` entries whose subject resolved to a parsed subject.
    pub legacy_mapped: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyGraph {
    pub categories: Vec<HierarchyCategory>,
    pub subjects: Vec<HierarchySubject>,
    pub techniques: Vec<HierarchyTechnique>,
    pub laws: Vec<HierarchyLaw>,
    pub cross_links: Vec<HierarchyCrossLink>,
    pub corpus_map: Vec<CorpusMapEntry>,
    pub warnings: Vec<HierarchyWarning>,
    pub source: HierarchySource,
    pub counts: HierarchyCounts,
}

impl HierarchyGraph {
    /// The honest empty state: no nodes, and a `source` that says why.
    fn empty(source: HierarchySource) -> Self {
        Self {
            categories: Vec::new(),
            subjects: Vec::new(),
            techniques: Vec::new(),
            laws: Vec::new(),
            cross_links: Vec::new(),
            corpus_map: Vec::new(),
            warnings: Vec::new(),
            source,
            counts: HierarchyCounts {
                subjects: 0,
                techniques: 0,
                applications: 0,
                evidence: 0,
                legacy_mapped: 0,
            },
        }
    }
}

/// One frontmatter key. A scalar arrives as a single-element `values` with
/// `is_list: false`; a list (block or inline) keeps `is_list: true` even when
/// empty, so `techniques: []` is distinguishable from an absent key.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FrontmatterEntry {
    pub key: String,
    pub values: Vec<String>,
    pub is_list: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyDoc {
    /// Echo of the requested repo-relative path (normalised to `/`).
    pub rel_path: String,
    /// The body with the frontmatter block removed. Empty when `!exists`.
    pub markdown: String,
    pub frontmatter: Vec<FrontmatterEntry>,
    /// False for a valid-but-absent path. A REJECTED path is an `Err`, not this.
    pub exists: bool,
}

// ---------------------------------------------------------------------------
// Adherence scorecard wire types (P4)
// ---------------------------------------------------------------------------

/// Repo-relative location of the census adherence scorecard artifact.
const SCORECARD_REL: &str = "scripts/census/context-scorecard.json";
/// The command that (re)generates the scorecard — named in every empty reason
/// so the reader knows how to recompute the derivation, not just that it is
/// missing (derivation-names-recomputation).
const SCORECARD_GENERATOR: &str = "node scripts/census/build-context-scorecard.mjs";
/// How many per-context rules travel over the wire. Truncation is DISCLOSED:
/// `ContextScore.rule_count` always carries the full count.
const TOP_RULES_MAX: usize = 5;

/// One census rule's surviving match sites inside one context.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct RuleSites {
    pub id: String,
    pub sites: u32,
}

/// One DIRTY context (sites > 0) for one subject. Clean-but-applicable
/// contexts exist only as `SubjectScore::clean_contexts` — the artifact never
/// lists them, so neither do we.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ContextScore {
    pub id: String,
    pub name: String,
    /// Group NAME string (context-map group), not an id.
    pub group: String,
    pub sites: u32,
    pub matched_files: u32,
    /// Full rule count for this context — `top_rules` may be truncated.
    pub rule_count: u32,
    /// At most `TOP_RULES_MAX` rules, artifact order (sites desc).
    pub top_rules: Vec<RuleSites>,
}

/// Per-subject adherence. The ratio is `clean_contexts / applicable_contexts`
/// and BOTH numbers come from the artifact — `contexts` lists only dirty ones,
/// so the denominator can never be derived from the array.
///
/// A subject ABSENT from `subjects` has no census rules yet; absence is NOT
/// cleanliness (census coverage ≠ adherence coverage).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SubjectScore {
    pub slug: String,
    /// Census rules assigned to this subject.
    pub rules: u32,
    /// Surviving census match sites across the repo.
    pub sites: u32,
    /// Distinct files with ≥1 site.
    pub matched_files: u32,
    /// Contexts containing ≥1 file SCANNED by any of the subject's rules.
    pub applicable_contexts: u32,
    /// Applicable AND zero sites.
    pub clean_contexts: u32,
    pub contexts: Vec<ContextScore>,
    /// Sites in files that belong to NO context.
    pub uncontexted_sites: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HierarchyScorecard {
    /// When the artifact was generated (ISO). `None` when absent.
    pub generated_at: Option<String>,
    /// Census rules in the generating run.
    pub rule_count: u32,
    /// Contexts in the context map the run joined against.
    pub context_count: u32,
    /// Rules that resolved to a subject.
    pub assigned_rules: u32,
    /// Repo-wide totals across all subjects.
    pub total_sites: u32,
    pub total_matched_files: u32,
    /// Sorted by slug.
    pub subjects: Vec<SubjectScore>,
    /// Where the scorecard came from — `present: false` + `reason` naming the
    /// generator command when the artifact does not exist.
    pub source: HierarchySource,
}

impl HierarchyScorecard {
    /// The honest empty state: no signal, and a `source` that says why.
    fn empty(source: HierarchySource) -> Self {
        Self {
            generated_at: None,
            rule_count: 0,
            context_count: 0,
            assigned_rules: 0,
            total_sites: 0,
            total_matched_files: 0,
            subjects: Vec::new(),
            source,
        }
    }
}

// ---------------------------------------------------------------------------
// Frontmatter parser — 1:1 port of check-corpus-integrity.mjs `parseFrontmatter`
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum FmValue {
    Scalar(String),
    List(Vec<String>),
}

/// Insertion-ordered frontmatter map (the JS side is a plain object, whose key
/// order is insertion order for non-numeric keys).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct Frontmatter(Vec<(String, FmValue)>);

impl Frontmatter {
    fn get(&self, key: &str) -> Option<&FmValue> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    /// Scalar read. A list-valued key yields `None` (the JS side would hand you
    /// an array where a string was expected; refusing is the honest port).
    fn scalar(&self, key: &str) -> Option<&str> {
        match self.get(key) {
            Some(FmValue::Scalar(s)) => Some(s.as_str()),
            _ => None,
        }
    }

    /// List read. Mirrors the checker's `Array.isArray(fm.x) ? fm.x : []`.
    fn list(&self, key: &str) -> Vec<String> {
        match self.get(key) {
            Some(FmValue::List(v)) => v.clone(),
            _ => Vec::new(),
        }
    }

    fn set(&mut self, key: &str, value: FmValue) {
        if let Some(slot) = self.0.iter_mut().find(|(k, _)| k == key) {
            slot.1 = value;
        } else {
            self.0.push((key.to_string(), value));
        }
    }

    fn push_item(&mut self, key: &str, item: String) {
        if let Some((_, FmValue::List(v))) = self.0.iter_mut().find(|(k, _)| k == key) {
            v.push(item);
        }
    }

    fn entries(&self) -> Vec<FrontmatterEntry> {
        self.0
            .iter()
            .map(|(k, v)| match v {
                FmValue::Scalar(s) => FrontmatterEntry {
                    key: k.clone(),
                    values: vec![s.clone()],
                    is_list: false,
                },
                FmValue::List(items) => FrontmatterEntry {
                    key: k.clone(),
                    values: items.clone(),
                    is_list: true,
                },
            })
            .collect()
    }
}

/// JS `s.replace(/\s+#.*$/, '')` — strip a trailing ` # comment`.
///
/// The regex engine scans left to right, so the leftmost whitespace run that is
/// followed by `#` wins. A `#` with no whitespace before it (a fragment link,
/// `#anchor`) is NOT a comment and must survive.
fn strip_trailing_comment(s: &str) -> &str {
    let bytes = s.as_bytes();
    for (i, b) in bytes.iter().enumerate() {
        if *b != b'#' {
            continue;
        }
        if i == 0 {
            continue;
        }
        // Back up over the contiguous whitespace run preceding this `#`.
        let mut start = i;
        while start > 0 && bytes[start - 1].is_ascii_whitespace() {
            start -= 1;
        }
        if start < i {
            return &s[..start];
        }
    }
    s
}

/// JS `/^\s+-\s+(.*)$/` — a block-list item line.
fn match_list_item(line: &str) -> Option<&str> {
    let trimmed_start = line.trim_start_matches(|c: char| c.is_whitespace());
    // `\s+` before the dash is REQUIRED: a top-level `- x` is not an item here.
    if trimmed_start.len() == line.len() {
        return None;
    }
    let rest = trimmed_start.strip_prefix('-')?;
    // `-\s+` — at least one whitespace after the dash.
    let after = rest.trim_start_matches(|c: char| c.is_whitespace());
    if after.len() == rest.len() {
        return None;
    }
    Some(after)
}

/// JS `/^([A-Za-z_]+):\s*(.*)$/` — a `key: value` line. Keys are letters and
/// underscores only, exactly as the checker allows.
fn match_key_value(line: &str) -> Option<(&str, &str)> {
    let colon = line.find(':')?;
    let key = &line[..colon];
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_alphabetic() || b == b'_') {
        return None;
    }
    let value = line[colon + 1..].trim_start_matches(|c: char| c.is_whitespace());
    Some((key, value))
}

/// Split the `---` delimited head from the body.
///
/// Mirrors `/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/`: the block must OPEN the file,
/// and the first subsequent line starting `---` closes it.
fn split_frontmatter(raw: &str) -> Option<(&str, &str)> {
    let rest = raw
        .strip_prefix("---\r\n")
        .or_else(|| raw.strip_prefix("---\n"))?;
    let idx = rest.find("\n---")?;
    let mut inner_end = idx;
    if rest[..inner_end].ends_with('\r') {
        inner_end -= 1;
    }
    let mut after = idx + "\n---".len();
    if rest[after..].starts_with('\r') {
        after += 1;
    }
    if rest[after..].starts_with('\n') {
        after += 1;
    }
    Some((&rest[..inner_end], &rest[after..]))
}

/// Parse a `---` frontmatter block. Returns `(frontmatter, body)`, or `None`
/// when the file has no block at all.
fn parse_frontmatter(raw: &str) -> Option<(Frontmatter, &str)> {
    let (inner, body) = split_frontmatter(raw)?;
    let mut fm = Frontmatter::default();
    let mut current_key: Option<String> = None;

    for line in inner.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);

        if let Some(item) = match_list_item(line) {
            if let Some(key) = current_key.clone() {
                fm.push_item(&key, strip_trailing_comment(item).trim().to_string());
                continue;
            }
        }

        let Some((key, val_raw)) = match_key_value(line) else {
            continue;
        };
        let val = strip_trailing_comment(val_raw).trim();

        if val.is_empty() {
            fm.set(key, FmValue::List(Vec::new()));
            current_key = Some(key.to_string());
        } else if val == "[]" {
            fm.set(key, FmValue::List(Vec::new()));
            current_key = None;
        } else if val.starts_with('[') {
            let items = val
                .trim_start_matches('[')
                .trim_end_matches(']')
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            fm.set(key, FmValue::List(items));
            current_key = None;
        } else {
            fm.set(key, FmValue::Scalar(val.to_string()));
            current_key = None;
        }
    }

    Some((fm, body))
}

// ---------------------------------------------------------------------------
// Body extraction
// ---------------------------------------------------------------------------

/// Strip fenced blocks and inline code, replacing fences with newlines so byte
/// offsets downstream stay stable.
///
/// The integrity checker learned this by failing on its own corpus: a regex
/// written in prose next to a bracketed character class parses as a markdown
/// link, and a gate that fires on correct content gets deleted rather than
/// fixed. Same hazard here — a documented pattern would become a phantom edge.
fn strip_code(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut rest = src;

    // Fenced blocks first.
    loop {
        let Some(open) = rest.find("```") else {
            out.push_str(rest);
            break;
        };
        out.push_str(&rest[..open]);
        let after_open = &rest[open + 3..];
        match after_open.find("```") {
            Some(close) => {
                let block = &after_open[..close + 3];
                for _ in block.matches('\n') {
                    out.push('\n');
                }
                // The opening fence's own newline count is included above only
                // for the block interior; add none for the delimiters.
                rest = &after_open[close + 3..];
            }
            None => {
                // Unterminated fence: keep the remainder verbatim rather than
                // swallowing the rest of the document.
                out.push_str(&rest[open..]);
                break;
            }
        }
    }

    // Then inline code (single-line only, matching /`[^`\n]*`/).
    let mut result = String::with_capacity(out.len());
    let mut chars = out.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        if c != '`' {
            result.push(c);
            continue;
        }
        let tail = &out[i + 1..];
        match tail.find(['`', '\n']) {
            Some(end) if tail.as_bytes()[end] == b'`' => {
                // Skip the span; advance the iterator past it.
                let skip_to = i + 1 + end + 1;
                while let Some(&(j, _)) = chars.peek() {
                    if j < skip_to {
                        chars.next();
                    } else {
                        break;
                    }
                }
            }
            _ => result.push(c),
        }
    }
    result
}

/// First `# ` heading of a body, or `None`.
fn extract_title(body: &str) -> Option<String> {
    for line in body.lines() {
        if let Some(rest) = line.strip_prefix("# ") {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

/// First non-empty prose paragraph after the H1, whitespace-collapsed and
/// clamped. Headings, fences, list items, tables, and blockquotes are skipped —
/// they are structure, not a summary.
fn extract_summary(body: &str) -> String {
    let mut seen_h1 = false;
    let mut in_fence = false;
    let mut para: Vec<&str> = Vec::new();

    for line in body.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if in_fence {
            continue;
        }
        if !seen_h1 {
            if trimmed.starts_with("# ") {
                seen_h1 = true;
            }
            continue;
        }
        if trimmed.is_empty() {
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if trimmed.starts_with('#')
            || trimmed.starts_with('-')
            || trimmed.starts_with('*')
            || trimmed.starts_with('>')
            || trimmed.starts_with('|')
            || trimmed.starts_with("<!--")
        {
            if !para.is_empty() {
                break;
            }
            continue;
        }
        para.push(trimmed);
    }

    let joined = para.join(" ");
    let collapsed = joined.split_whitespace().collect::<Vec<_>>().join(" ");
    clamp(&collapsed, SUMMARY_MAX)
}

/// Clamp on a char boundary, appending an ellipsis when truncated.
fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    while let Some(c) = out.pop() {
        if c.is_whitespace() {
            break;
        }
        if out.is_empty() {
            break;
        }
    }
    out.push('…');
    out
}

/// Relative markdown link targets in a body (code already stripped by the
/// caller). Absolute URLs, mail links and pure fragments are not ours.
fn relative_links(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'[' {
            i += 1;
            continue;
        }
        let Some(close) = body[i..].find(']') else { break };
        let after = i + close + 1;
        if after >= bytes.len() || bytes[after] != b'(' {
            i += 1;
            continue;
        }
        // `([^)\s]+)` — no whitespace, no closing paren inside.
        let tail = &body[after + 1..];
        let end = tail
            .find(|c: char| c == ')' || c.is_whitespace())
            .unwrap_or(tail.len());
        if tail.as_bytes().get(end) != Some(&b')') {
            i = after + 1;
            continue;
        }
        let target = &tail[..end];
        i = after + 1 + end + 1;
        if target.is_empty()
            || target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("mailto:")
            || target.starts_with('#')
        {
            continue;
        }
        let clean = target.split('#').next().unwrap_or("");
        if !clean.is_empty() {
            out.push(clean.to_string());
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Graph construction
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CategoriesFile {
    #[serde(default)]
    categories: Vec<CategoryRow>,
    #[serde(default)]
    subjects: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct CategoryRow {
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    order: i32,
}

#[derive(Deserialize)]
struct CorpusMapFile {
    #[serde(default)]
    entries: BTreeMap<String, serde_json::Value>,
}

/// Read a file, converting an I/O failure into a warning rather than an error.
fn read_tolerant(
    path: &Path,
    rel: &str,
    warnings: &mut Vec<HierarchyWarning>,
) -> Option<String> {
    match std::fs::read_to_string(path) {
        Ok(s) => Some(s),
        Err(e) => {
            warnings.push(HierarchyWarning {
                path: rel.to_string(),
                message: format!("could not be read: {e}"),
            });
            None
        }
    }
}

/// Sorted `.md` filenames directly inside `dir`. A missing directory is not a
/// defect — most subjects have no `applications/` yet.
fn md_files(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .flatten()
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| n.ends_with(".md"))
        .collect();
    out.sort();
    out
}

/// Parse `_laws.md`: `## <a id="anchor"></a> Title` headings, each followed by
/// a one-paragraph statement.
fn parse_laws(raw: &str) -> Vec<HierarchyLaw> {
    let mut out: Vec<HierarchyLaw> = Vec::new();
    let mut pending: Option<(String, String)> = None;
    let mut para: Vec<&str> = Vec::new();

    let flush = |out: &mut Vec<HierarchyLaw>,
                 pending: &mut Option<(String, String)>,
                 para: &mut Vec<&str>| {
        if let Some((id, title)) = pending.take() {
            let summary = para
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            out.push(HierarchyLaw {
                id,
                title,
                summary: clamp(&summary, SUMMARY_MAX),
            });
        }
        para.clear();
    };

    for line in raw.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("## ") {
            flush(&mut out, &mut pending, &mut para);
            // `<a id="x"></a> Title`
            if let Some(open) = rest.find("id=\"") {
                let after = &rest[open + 4..];
                if let Some(close) = after.find('"') {
                    let id = after[..close].to_string();
                    let title = after[close..]
                        .split_once("</a>")
                        .map(|(_, t)| t.trim())
                        .unwrap_or("")
                        .trim();
                    let title = if title.is_empty() { id.clone() } else { title.to_string() };
                    pending = Some((id, title));
                }
            }
            continue;
        }
        if pending.is_none() {
            continue;
        }
        if trimmed.is_empty() {
            if !para.is_empty() {
                // First paragraph complete; ignore the rest until the next law.
                continue;
            }
            continue;
        }
        if para.len() < 12 {
            para.push(trimmed);
        }
    }
    flush(&mut out, &mut pending, &mut para);
    out
}

/// Where a corpus was found, and what subtree its documents may be served from.
///
/// The reader supports two layouts on purpose. `docs/concepts/paths/` is how the
/// corpus lives inside personas today; `knowledge/<domain>/` is how a Reference
/// Knowledge Bundle is published in a registry clone. Discovering both is what
/// lets the authority move out of this repo without the reader changing again.
#[derive(Debug, Clone, PartialEq, Eq)]
struct CorpusLayout {
    /// Repo-relative corpus directory.
    rel: String,
    /// Repo-relative subtree documents may be read from.
    doc_root: String,
    /// Set when the layout choice was ambiguous and had to be decided.
    note: Option<String>,
}

/// Find the corpus under `root`, preferring the personas layout.
///
/// Returns `None` when the root carries neither layout — a legitimate state that
/// the caller reports as an empty graph with a reason, never as an error.
fn discover_corpus(root: &Path) -> Option<CorpusLayout> {
    if root.join(PATHS_REL).is_dir() {
        return Some(CorpusLayout {
            rel: PATHS_REL.to_string(),
            doc_root: DOC_ROOT_REL.to_string(),
            note: None,
        });
    }

    // Registry clone: one bundle directory per domain under `knowledge/`. A
    // bundle is identified by the two files every bundle carries, so an
    // unrelated `knowledge/` folder in some other repo is not mistaken for one.
    let lane = root.join(BUNDLE_LANE_REL);
    if !lane.is_dir() {
        return None;
    }
    let mut bundles: Vec<String> = std::fs::read_dir(&lane)
        .ok()?
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter(|e| e.path().join("_laws.md").is_file() || e.path().join("categories.json").is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    bundles.sort();
    let first = bundles.first()?.clone();

    // More than one bundle is not an error, but it IS a choice — and a choice a
    // reader makes silently is a choice nobody can audit. Say which one won.
    let note = (bundles.len() > 1).then(|| {
        format!(
            "{} bundles are present ({}); read \"{first}\". \
             One project root shows one bundle.",
            bundles.len(),
            bundles.join(", ")
        )
    });

    Some(CorpusLayout {
        rel: format!("{BUNDLE_LANE_REL}/{first}"),
        doc_root: BUNDLE_LANE_REL.to_string(),
        note,
    })
}

/// Build the whole graph from a repo root. Blocking; call under `spawn_blocking`.
fn build_graph(root: &Path) -> Result<HierarchyGraph, AppError> {
    let root_display = root.to_string_lossy().replace('\\', "/");

    let Some(layout) = discover_corpus(root) else {
        return Ok(HierarchyGraph::empty(HierarchySource {
            root: Some(root_display),
            present: false,
            reason: Some(format!(
                "This repository has neither a {PATHS_REL}/ folder nor a \
                 {BUNDLE_LANE_REL}/<domain>/ bundle, so it carries no knowledge hierarchy."
            )),
            corpus_rel: None,
            doc_root_rel: None,
        }));
    };
    let corpus_rel = layout.rel.as_str();
    let paths_dir = root.join(corpus_rel);

    let mut warnings: Vec<HierarchyWarning> = Vec::new();
    if let Some(note) = &layout.note {
        warnings.push(HierarchyWarning {
            path: format!("{BUNDLE_LANE_REL}/"),
            message: note.clone(),
        });
    }

    // -- categories.json ----------------------------------------------------
    let mut categories: Vec<HierarchyCategory> = Vec::new();
    let mut subject_category: BTreeMap<String, String> = BTreeMap::new();
    let cats_path = paths_dir.join("categories.json");
    if cats_path.is_file() {
        match std::fs::read_to_string(&cats_path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<CategoriesFile>(&s).map_err(|e| e.to_string()))
        {
            Ok(parsed) => {
                categories = parsed
                    .categories
                    .into_iter()
                    .map(|c| HierarchyCategory {
                        title: c.title.unwrap_or_else(|| c.id.clone()),
                        id: c.id,
                        order: c.order,
                    })
                    .collect();
                categories.sort_by_key(|c| c.order);
                subject_category = parsed.subjects;
            }
            Err(e) => warnings.push(HierarchyWarning {
                path: format!("{corpus_rel}/categories.json"),
                message: format!("could not be parsed: {e} — subjects will render uncategorised"),
            }),
        }
    } else {
        warnings.push(HierarchyWarning {
            path: format!("{corpus_rel}/categories.json"),
            message: "missing — subjects will render uncategorised".to_string(),
        });
    }

    // -- corpus-map.json ----------------------------------------------------
    let mut corpus_map: Vec<CorpusMapEntry> = Vec::new();
    let mut legacy_counts: HashMap<String, u32> = HashMap::new();
    let map_path = paths_dir.join("corpus-map.json");
    if map_path.is_file() {
        match std::fs::read_to_string(&map_path)
            .map_err(|e| e.to_string())
            .and_then(|s| serde_json::from_str::<CorpusMapFile>(&s).map_err(|e| e.to_string()))
        {
            Ok(parsed) => {
                for (legacy_file, target) in parsed.entries {
                    // The contract allows a bare slug or `{subject, technique}`.
                    let subject = match &target {
                        serde_json::Value::String(s) => Some(s.clone()),
                        serde_json::Value::Object(o) => o
                            .get("subject")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        _ => None,
                    };
                    let Some(subject) = subject else {
                        warnings.push(HierarchyWarning {
                            path: format!("{corpus_rel}/corpus-map.json"),
                            message: format!("entry \"{legacy_file}\" names no subject"),
                        });
                        continue;
                    };
                    *legacy_counts.entry(subject.clone()).or_insert(0) += 1;
                    corpus_map.push(CorpusMapEntry {
                        legacy_file,
                        subject,
                    });
                }
            }
            Err(e) => warnings.push(HierarchyWarning {
                path: format!("{corpus_rel}/corpus-map.json"),
                message: format!("could not be parsed: {e} — legacy counts will read zero"),
            }),
        }
    }

    // -- _laws.md -----------------------------------------------------------
    let laws_path = paths_dir.join("_laws.md");
    let laws = if laws_path.is_file() {
        read_tolerant(&laws_path, &format!("{corpus_rel}/_laws.md"), &mut warnings)
            .map(|s| parse_laws(&s))
            .unwrap_or_default()
    } else {
        warnings.push(HierarchyWarning {
            path: format!("{corpus_rel}/_laws.md"),
            message: "missing — technique law citations will not resolve".to_string(),
        });
        Vec::new()
    };

    // -- subject folders ----------------------------------------------------
    let subject_dirs = {
        let mut v: Vec<String> = std::fs::read_dir(&paths_dir)
            .map_err(|e| {
                AppError::Io(std::io::Error::new(
                    e.kind(),
                    format!("reading {corpus_rel}/: {e}"),
                ))
            })?
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| e.file_name().into_string().ok())
            .filter(|n| !n.starts_with('.') && !n.starts_with('_'))
            .collect();
        v.sort();
        v
    };

    let mut subjects: Vec<HierarchySubject> = Vec::new();
    let mut techniques: Vec<HierarchyTechnique> = Vec::new();
    let mut applications_total: u32 = 0;
    let mut evidence_total: u32 = 0;
    // (from, to, kind) — deduped; a subject that links a neighbour eight times
    // is one edge, not eight.
    let mut links: BTreeSet<(String, String, String)> = BTreeSet::new();
    // Bodies to scan for cross-links, paired with the subject they belong to
    // and the directory they live in (link targets resolve relative to it).
    let mut link_sources: Vec<(String, PathBuf, String)> = Vec::new();

    for slug in &subject_dirs {
        let dir = paths_dir.join(slug);
        let gp_rel = format!("{corpus_rel}/{slug}/{slug}.md");
        let gp_path = dir.join(format!("{slug}.md"));

        if !gp_path.is_file() {
            warnings.push(HierarchyWarning {
                path: format!("{corpus_rel}/{slug}/"),
                message: format!("no {slug}.md golden path — subject skipped"),
            });
            continue;
        }
        let Some(raw) = read_tolerant(&gp_path, &gp_rel, &mut warnings) else {
            continue;
        };
        let Some((fm, body)) = parse_frontmatter(&raw) else {
            warnings.push(HierarchyWarning {
                path: gp_rel.clone(),
                message: "missing frontmatter block — subject skipped".to_string(),
            });
            continue;
        };

        // Techniques: declared list (local + shared@owner) vs files on disk.
        let declared = fm.list("techniques");
        let on_disk: Vec<String> = md_files(&dir.join("techniques"))
            .into_iter()
            .map(|f| f.trim_end_matches(".md").to_string())
            .collect();

        let mut local: Vec<String> = Vec::new();
        let mut shared: Vec<SharedTechniqueRef> = Vec::new();
        for entry in &declared {
            if let Some((tech, owner)) = entry.split_once('@') {
                if tech.is_empty() || owner.is_empty() {
                    warnings.push(HierarchyWarning {
                        path: gp_rel.clone(),
                        message: format!("malformed shared technique \"{entry}\" — ignored"),
                    });
                    continue;
                }
                if !paths_dir
                    .join(owner)
                    .join("techniques")
                    .join(format!("{tech}.md"))
                    .is_file()
                {
                    warnings.push(HierarchyWarning {
                        path: gp_rel.clone(),
                        message: format!(
                            "shared technique \"{entry}\" does not resolve to {corpus_rel}/{owner}/techniques/{tech}.md"
                        ),
                    });
                    continue;
                }
                shared.push(SharedTechniqueRef {
                    technique: tech.to_string(),
                    owner: owner.to_string(),
                });
                // A shared reference IS an edge between subjects.
                if owner != slug {
                    links.insert((slug.clone(), owner.to_string(), "technique".to_string()));
                }
                continue;
            }
            if !on_disk.contains(entry) {
                warnings.push(HierarchyWarning {
                    path: gp_rel.clone(),
                    message: format!("declares technique \"{entry}\" but the file does not exist"),
                });
                continue;
            }
            local.push(entry.clone());
        }
        // A file on disk the golden path forgot to declare still renders — the
        // checker fails it, but a half-forged tree must stay browsable.
        for t in &on_disk {
            if !local.contains(t) {
                warnings.push(HierarchyWarning {
                    path: format!("{corpus_rel}/{slug}/techniques/{t}.md"),
                    message: format!("exists but {slug}.md does not declare it"),
                });
                local.push(t.clone());
            }
        }

        for t in &local {
            let t_rel = format!("{corpus_rel}/{slug}/techniques/{t}.md");
            let t_path = dir.join("techniques").join(format!("{t}.md"));
            let Some(t_raw) = read_tolerant(&t_path, &t_rel, &mut warnings) else {
                continue;
            };
            let (t_fm, t_body) = match parse_frontmatter(&t_raw) {
                Some(v) => v,
                None => {
                    warnings.push(HierarchyWarning {
                        path: t_rel.clone(),
                        message: "missing frontmatter block — technique skipped".to_string(),
                    });
                    continue;
                }
            };
            techniques.push(HierarchyTechnique {
                slug: t.clone(),
                subject: slug.clone(),
                title: extract_title(t_body).unwrap_or_else(|| t.clone()),
                summary: extract_summary(t_body),
                file: t_rel.clone(),
                status: t_fm.scalar("status").map(|s| s.to_string()),
                laws: t_fm.list("laws"),
                shared_with: t_fm.list("shared_with"),
            });
            link_sources.push((
                slug.clone(),
                dir.join("techniques"),
                strip_code(t_body),
            ));
        }

        // Applications.
        let mut applications: Vec<HierarchyApplication> = Vec::new();
        let app_dir = dir.join("applications");
        for f in md_files(&app_dir) {
            let a_rel = format!("{corpus_rel}/{slug}/applications/{f}");
            let Some(a_raw) = read_tolerant(&app_dir.join(&f), &a_rel, &mut warnings) else {
                continue;
            };
            let Some((a_fm, _)) = parse_frontmatter(&a_raw) else {
                warnings.push(HierarchyWarning {
                    path: a_rel.clone(),
                    message: "missing frontmatter block — application skipped".to_string(),
                });
                continue;
            };
            applications.push(HierarchyApplication {
                file: a_rel,
                stack: a_fm.scalar("stack").unwrap_or("").to_string(),
                technique: a_fm.scalar("technique").unwrap_or("").to_string(),
            });
            applications_total += 1;
        }

        let evidence = fm.list("evidence");
        evidence_total += evidence.len() as u32;

        subjects.push(HierarchySubject {
            title: extract_title(body).unwrap_or_else(|| slug.clone()),
            summary: extract_summary(body),
            file: gp_rel.clone(),
            category: subject_category.get(slug).cloned(),
            status: fm.scalar("status").map(|s| s.to_string()),
            techniques: local,
            shared_techniques: shared,
            applications,
            evidence,
            counter_evidence: fm.list("counter_evidence"),
            deviations: fm.list("deviations"),
            legacy_count: legacy_counts.get(slug).copied().unwrap_or(0),
            slug: slug.clone(),
        });

        link_sources.push((slug.clone(), dir.clone(), strip_code(body)));
    }

    // -- cross links --------------------------------------------------------
    // Only edges between subjects the reader actually parsed: a link into a
    // folder that was skipped would draw an edge to a node that is not there.
    let known: BTreeSet<&str> = subjects.iter().map(|s| s.slug.as_str()).collect();
    let canonical_paths = std::fs::canonicalize(&paths_dir).unwrap_or_else(|_| paths_dir.clone());
    for (from, base, body) in &link_sources {
        for target in relative_links(body) {
            let resolved = normalise(&base.join(&target));
            let Ok(rel) = resolved.strip_prefix(&canonical_paths).or_else(|_| resolved.strip_prefix(&paths_dir)) else {
                continue;
            };
            let mut comps = rel.components();
            let Some(std::path::Component::Normal(first)) = comps.next() else {
                continue;
            };
            let to = first.to_string_lossy().to_string();
            if &to == from || !known.contains(to.as_str()) {
                continue;
            }
            let kind = match comps.next() {
                Some(std::path::Component::Normal(seg)) if seg == "techniques" => "technique",
                _ => "subject",
            };
            links.insert((from.clone(), to, kind.to_string()));
        }
    }

    let legacy_mapped = corpus_map
        .iter()
        .filter(|e| known.contains(e.subject.as_str()))
        .count() as u32;

    let counts = HierarchyCounts {
        subjects: subjects.len() as u32,
        techniques: techniques.len() as u32,
        applications: applications_total,
        evidence: evidence_total,
        legacy_mapped,
    };

    Ok(HierarchyGraph {
        categories,
        subjects,
        techniques,
        laws,
        cross_links: links
            .into_iter()
            .map(|(from, to, kind)| HierarchyCrossLink { from, to, kind })
            .collect(),
        corpus_map,
        warnings,
        source: HierarchySource {
            root: Some(root_display),
            present: true,
            reason: None,
            corpus_rel: Some(layout.rel.clone()),
            doc_root_rel: Some(layout.doc_root.clone()),
        },
        counts,
    })
}

/// Lexically resolve `.` / `..` without touching the filesystem. Link targets
/// point at files that may not exist yet (forward references are legal in this
/// corpus), so `canonicalize` is not usable here.
fn normalise(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

// ---------------------------------------------------------------------------
// mtime-keyed cache
// ---------------------------------------------------------------------------

/// Signature of the corpus tree: the newest mtime anywhere under `paths/` plus
/// the number of entries walked.
///
/// The count is load-bearing, not decoration. A deletion can leave the max
/// mtime unchanged on filesystems with coarse directory timestamps, and a
/// graph that silently keeps a deleted subject is exactly the drift this whole
/// read-from-disk design exists to avoid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TreeSignature {
    newest: SystemTime,
    entries: usize,
}

fn tree_signature(dir: &Path) -> Option<TreeSignature> {
    let mut newest = SystemTime::UNIX_EPOCH;
    let mut entries = 0usize;
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            continue;
        };
        if let Ok(meta) = std::fs::metadata(&d) {
            if let Ok(m) = meta.modified() {
                if m > newest {
                    newest = m;
                }
            }
        }
        for e in rd.flatten() {
            entries += 1;
            let p = e.path();
            if let Ok(meta) = e.metadata() {
                if let Ok(m) = meta.modified() {
                    if m > newest {
                        newest = m;
                    }
                }
                if meta.is_dir() {
                    stack.push(p);
                }
            }
        }
    }
    (entries > 0).then_some(TreeSignature { newest, entries })
}

struct CacheEntry {
    signature: Option<TreeSignature>,
    graph: Arc<HierarchyGraph>,
    /// Monotonic use counter — the reaper evicts the least recently used root.
    last_used: u64,
}

#[allow(clippy::type_complexity)]
fn cache() -> &'static Mutex<(HashMap<String, CacheEntry>, u64)> {
    static C: OnceLock<Mutex<(HashMap<String, CacheEntry>, u64)>> = OnceLock::new();
    C.get_or_init(|| Mutex::new((HashMap::new(), 0)))
}

/// Cached graph read. Recomputes the tree signature on every call (a walk over
/// ~1,200 small files costs far less than re-parsing them) and reuses the
/// snapshot when nothing moved.
fn cached_graph(root: &Path) -> Result<Arc<HierarchyGraph>, AppError> {
    let key = root.to_string_lossy().replace('\\', "/");
    // Signature the corpus that will actually be read. Signing a fixed literal
    // would make every read of a registry clone a permanent cache miss.
    let signature = discover_corpus(root).and_then(|l| tree_signature(&root.join(l.rel)));

    {
        let mut guard = cache().lock().unwrap_or_else(|p| p.into_inner());
        let (map, tick) = &mut *guard;
        *tick += 1;
        let now = *tick;
        if let Some(entry) = map.get_mut(&key) {
            if entry.signature == signature && signature.is_some() {
                entry.last_used = now;
                return Ok(Arc::clone(&entry.graph));
            }
        }
    }

    let graph = Arc::new(build_graph(root)?);

    {
        let mut guard = cache().lock().unwrap_or_else(|p| p.into_inner());
        let (map, tick) = &mut *guard;
        *tick += 1;
        let now = *tick;
        map.insert(
            key,
            CacheEntry {
                signature,
                graph: Arc::clone(&graph),
                last_used: now,
            },
        );
        // The reaper. Named here so the cache cannot grow with the number of
        // managed projects a session touches.
        while map.len() > CACHE_MAX_ROOTS {
            let Some(victim) = map
                .iter()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            map.remove(&victim);
        }
    }

    Ok(graph)
}

// ---------------------------------------------------------------------------
// Adherence scorecard reader (P4)
// ---------------------------------------------------------------------------

/// The artifact's shape as `build-context-scorecard.mjs` writes it. Unknown
/// fields (`$comment`, `totals.multiContextFiles`, `inputs.unassignedRules`, …)
/// are deliberately ignored — the wire carries only what the UI consumes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScorecardFile {
    #[serde(default)]
    generated_at: Option<String>,
    #[serde(default)]
    inputs: ScorecardInputs,
    #[serde(default)]
    totals: ScorecardTotals,
    #[serde(default)]
    subjects: BTreeMap<String, ScorecardSubjectRow>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ScorecardInputs {
    #[serde(default)]
    rule_count: u32,
    #[serde(default)]
    assigned_rules: u32,
    #[serde(default)]
    context_count: u32,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ScorecardTotals {
    #[serde(default)]
    sites: u32,
    #[serde(default)]
    matched_files: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScorecardSubjectRow {
    #[serde(default)]
    rules: u32,
    #[serde(default)]
    sites: u32,
    #[serde(default)]
    matched_files: u32,
    #[serde(default)]
    applicable_contexts: u32,
    #[serde(default)]
    clean_contexts: u32,
    #[serde(default)]
    contexts: Vec<ScorecardContextRow>,
    #[serde(default)]
    uncontexted: ScorecardUncontexted,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ScorecardUncontexted {
    #[serde(default)]
    sites: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScorecardContextRow {
    id: String,
    name: String,
    #[serde(default)]
    group: String,
    #[serde(default)]
    sites: u32,
    #[serde(default)]
    matched_files: u32,
    #[serde(default)]
    rules: Vec<RuleSites>,
}

/// Build the wire scorecard from a repo root. Absence is an honest empty whose
/// reason NAMES the generator command; a malformed artifact is an `Err` — a
/// file that exists but cannot be trusted must never render as "clean".
fn build_scorecard(root: &Path) -> Result<HierarchyScorecard, AppError> {
    let path = root.join(SCORECARD_REL);
    let root_display = root.to_string_lossy().replace('\\', "/");

    if !path.is_file() {
        return Ok(HierarchyScorecard::empty(HierarchySource {
            root: Some(root_display),
            present: false,
            reason: Some(format!(
                "This repository has no {SCORECARD_REL} — generate it with `{SCORECARD_GENERATOR}`."
            )),
            corpus_rel: None,
            doc_root_rel: None,
        }));
    }

    let raw = std::fs::read_to_string(&path)?;
    let parsed: ScorecardFile = serde_json::from_str(&raw).map_err(|e| {
        AppError::Validation(format!(
            "{SCORECARD_REL} could not be parsed: {e}. Regenerate it with `{SCORECARD_GENERATOR}`."
        ))
    })?;

    let subjects = parsed
        .subjects
        .into_iter()
        .map(|(slug, row)| SubjectScore {
            slug,
            rules: row.rules,
            sites: row.sites,
            matched_files: row.matched_files,
            applicable_contexts: row.applicable_contexts,
            clean_contexts: row.clean_contexts,
            contexts: row
                .contexts
                .into_iter()
                .map(|c| ContextScore {
                    id: c.id,
                    name: c.name,
                    group: c.group,
                    sites: c.sites,
                    matched_files: c.matched_files,
                    rule_count: c.rules.len() as u32,
                    top_rules: c.rules.into_iter().take(TOP_RULES_MAX).collect(),
                })
                .collect(),
            uncontexted_sites: row.uncontexted.sites,
        })
        .collect();

    Ok(HierarchyScorecard {
        generated_at: parsed.generated_at,
        rule_count: parsed.inputs.rule_count,
        context_count: parsed.inputs.context_count,
        assigned_rules: parsed.inputs.assigned_rules,
        total_sites: parsed.totals.sites,
        total_matched_files: parsed.totals.matched_files,
        subjects,
        source: HierarchySource {
            root: Some(root_display),
            present: true,
            reason: None,
            // The scorecard is a census artifact, not a corpus read — it has no
            // corpus location to report, and inventing one would be a lie the
            // UI would happily render.
            corpus_rel: None,
            doc_root_rel: None,
        },
    })
}

/// Signature of the single artifact file — mtime + length, which is enough
/// for a file rewritten atomically by its generator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileSignature {
    mtime: SystemTime,
    len: u64,
}

fn file_signature(path: &Path) -> Option<FileSignature> {
    let meta = std::fs::metadata(path).ok()?;
    Some(FileSignature {
        mtime: meta.modified().ok()?,
        len: meta.len(),
    })
}

struct ScorecardCacheEntry {
    signature: Option<FileSignature>,
    scorecard: Arc<HierarchyScorecard>,
    last_used: u64,
}

#[allow(clippy::type_complexity)]
fn scorecard_cache() -> &'static Mutex<(HashMap<String, ScorecardCacheEntry>, u64)> {
    static C: OnceLock<Mutex<(HashMap<String, ScorecardCacheEntry>, u64)>> = OnceLock::new();
    C.get_or_init(|| Mutex::new((HashMap::new(), 0)))
}

/// Cached scorecard read — same discipline as `cached_graph`, but keyed by one
/// file's signature instead of a tree walk. A missing artifact (`None`
/// signature) is rebuilt every call: the empty branch is a stat + a struct.
fn cached_scorecard(root: &Path) -> Result<Arc<HierarchyScorecard>, AppError> {
    let key = root.to_string_lossy().replace('\\', "/");
    let signature = file_signature(&root.join(SCORECARD_REL));

    {
        let mut guard = scorecard_cache().lock().unwrap_or_else(|p| p.into_inner());
        let (map, tick) = &mut *guard;
        *tick += 1;
        let now = *tick;
        if let Some(entry) = map.get_mut(&key) {
            if entry.signature == signature && signature.is_some() {
                entry.last_used = now;
                return Ok(Arc::clone(&entry.scorecard));
            }
        }
    }

    let scorecard = Arc::new(build_scorecard(root)?);

    {
        let mut guard = scorecard_cache().lock().unwrap_or_else(|p| p.into_inner());
        let (map, tick) = &mut *guard;
        *tick += 1;
        let now = *tick;
        map.insert(
            key,
            ScorecardCacheEntry {
                signature,
                scorecard: Arc::clone(&scorecard),
                last_used: now,
            },
        );
        // The reaper — same cap as the graph cache, same reason.
        while map.len() > CACHE_MAX_ROOTS {
            let Some(victim) = map
                .iter()
                .min_by_key(|(_, e)| e.last_used)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            map.remove(&victim);
        }
    }

    Ok(scorecard)
}

// ---------------------------------------------------------------------------
// Project → filesystem root
// ---------------------------------------------------------------------------

/// Outcome of resolving a managed project to a readable repo root.
enum RootResolution {
    Ok(PathBuf),
    /// Not an error — an empty graph with this explanation.
    Absent(HierarchySource),
}

/// The override half of `resolve_root`, pure so its no-fallback rule is testable.
///
/// `None` means "no override given, carry on with the project". `Some(Absent)`
/// means an override WAS given and is not usable — and the caller must stop
/// there rather than reading the project's own corpus, which is why this returns
/// a resolution instead of an `Option<PathBuf>` a caller could `unwrap_or`.
fn resolve_override(root_override: Option<&str>) -> Option<RootResolution> {
    let raw = root_override.map(str::trim).filter(|r| !r.is_empty())?;
    let path = PathBuf::from(raw);
    if path.is_dir() {
        return Some(RootResolution::Ok(path));
    }
    Some(RootResolution::Absent(HierarchySource {
        root: Some(raw.replace('\\', "/")),
        present: false,
        reason: Some(format!(
            "The knowledge registry's working copy is not on this machine: {raw}. \
             Pair the registry again, or point it at an existing clone."
        )),
        corpus_rel: None,
        doc_root_rel: None,
    }))
}

/// Resolve the root to read the corpus from.
///
/// `root_override` is how the authority moves: once a workspace is wired to a
/// knowledge registry, the corpus the UI shows is the REGISTRY's, not the
/// project's own `docs/concepts/paths/`. The caller supplies the clone path
/// because the wiring lives frontend-side.
///
/// An override that is not a directory resolves to Absent NAMING IT, and never
/// falls back to the project root. Reading the project's own corpus while the UI
/// says it is showing the registry's is the same lie as a library that silently
/// reverts to the home directory — and here it would be worse, because the two
/// corpora are supposed to be identical and a silent fallback is exactly what
/// would hide them drifting apart.
fn resolve_root(
    state: &AppState,
    project_id: &str,
    root_override: Option<&str>,
) -> Result<RootResolution, AppError> {
    if let Some(resolved) = resolve_override(root_override) {
        return Ok(resolved);
    }

    // A project id that names no row IS an error: the caller passed something
    // that does not exist, which is different from a project with no path.
    let project = repo::get_project_by_id(&state.db, project_id)?;
    let raw = project.root_path.trim().to_string();

    if raw.is_empty() {
        return Ok(RootResolution::Absent(HierarchySource {
            root: None,
            present: false,
            reason: Some(
                "This project has no repository path recorded, so there is nothing to read."
                    .to_string(),
            ),
            corpus_rel: None,
            doc_root_rel: None,
        }));
    }

    let path = PathBuf::from(&raw);
    if !path.is_dir() {
        return Ok(RootResolution::Absent(HierarchySource {
            root: Some(raw.replace('\\', "/")),
            present: false,
            reason: Some(format!(
                "The project's repository path does not exist on this machine: {raw}"
            )),
            corpus_rel: None,
            doc_root_rel: None,
        }));
    }

    Ok(RootResolution::Ok(path))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Read the knowledge hierarchy of a managed project as a typed graph.
///
/// Never errors on emptiness — see `HierarchySource`. Errors only on an unknown
/// project id or a genuine I/O fault on a directory that exists.
#[tauri::command]
pub async fn dev_tools_hierarchy_graph(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    root_override: Option<String>,
) -> Result<HierarchyGraph, AppError> {
    require_auth(&state).await?;

    let root = match resolve_root(&state, &project_id, root_override.as_deref())? {
        RootResolution::Ok(p) => p,
        RootResolution::Absent(source) => return Ok(HierarchyGraph::empty(source)),
    };

    let graph = tokio::task::spawn_blocking(move || cached_graph(&root))
        .await
        .map_err(|e| AppError::Internal(format!("hierarchy read join error: {e}")))??;

    tracing::debug!(
        subjects = graph.counts.subjects,
        techniques = graph.counts.techniques,
        warnings = graph.warnings.len(),
        "hierarchy graph read"
    );

    Ok((*graph).clone())
}

/// Fetch one document from the hierarchy corpus.
///
/// `rel_path` is repo-relative and MUST stay inside the discovered corpus's doc
/// root (`docs/concepts/` in a personas repo, `knowledge/` in a registry
/// clone) — the allowlist follows the layout rather than a literal. Rejection
/// is an `Err` (the caller asked for something it may not have); a valid path
/// that simply is not there returns `exists: false`, because a forward
/// reference to an unwritten neighbour is legal in this corpus and must not
/// surface as an error toast.
#[tauri::command]
pub async fn dev_tools_hierarchy_doc(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    rel_path: String,
    root_override: Option<String>,
) -> Result<HierarchyDoc, AppError> {
    require_auth(&state).await?;

    // Documents must come from the SAME root the graph was read from, or a link
    // the graph issued would open a different repo's file of the same name.
    let root = match resolve_root(&state, &project_id, root_override.as_deref())? {
        RootResolution::Ok(p) => p,
        RootResolution::Absent(source) => {
            return Err(AppError::NotFound(
                source
                    .reason
                    .unwrap_or_else(|| "The project has no readable repository path.".to_string()),
            ))
        }
    };

    let requested = rel_path.replace('\\', "/");
    // The allowlist is whatever layout this root actually carries. A root with
    // no corpus at all keeps the personas default, so the refusal message stays
    // meaningful instead of naming a directory that was never involved.
    let doc_root = discover_corpus(&root)
        .map(|l| l.doc_root)
        .unwrap_or_else(|| DOC_ROOT_REL.to_string());
    tokio::task::spawn_blocking(move || read_doc(&root, &doc_root, &requested))
        .await
        .map_err(|e| AppError::Internal(format!("hierarchy doc join error: {e}")))?
}

/// Read the census adherence scorecard of a managed project.
///
/// Same emptiness posture as the graph: an unknown project id is an `Err`; a
/// project with no path, a path missing on this machine, or a repo without the
/// artifact is an honest empty whose `source.reason` names the generator
/// command. A malformed artifact is an `Err` — never a silent "clean".
#[tauri::command]
pub async fn dev_tools_hierarchy_scorecard(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<HierarchyScorecard, AppError> {
    require_auth(&state).await?;

    // NO root override, deliberately. The scorecard is a census artifact of THIS
    // repo — which of the consumer's own contexts violate which subject. That is
    // the consumer-side half of the split, exactly like evidence: the registry
    // holds the standard, the consumer holds how it measures against it. Pointing
    // this at a registry clone would read a scorecard about a repo of documents.
    let root = match resolve_root(&state, &project_id, None)? {
        RootResolution::Ok(p) => p,
        RootResolution::Absent(source) => return Ok(HierarchyScorecard::empty(source)),
    };

    let scorecard = tokio::task::spawn_blocking(move || cached_scorecard(&root))
        .await
        .map_err(|e| AppError::Internal(format!("scorecard read join error: {e}")))??;

    tracing::debug!(
        subjects = scorecard.subjects.len(),
        total_sites = scorecard.total_sites,
        present = scorecard.source.present,
        "hierarchy scorecard read"
    );

    Ok((*scorecard).clone())
}

fn read_doc(root: &Path, doc_root_rel: &str, rel: &str) -> Result<HierarchyDoc, AppError> {
    let trimmed = rel.trim().trim_start_matches("./");
    if trimmed.is_empty() {
        return Err(AppError::Validation("No document path was given.".into()));
    }
    if !(trimmed == doc_root_rel || trimmed.starts_with(&format!("{doc_root_rel}/"))) {
        return Err(AppError::Forbidden(format!(
            "Only documents under {doc_root_rel}/ can be read; refused \"{rel}\"."
        )));
    }
    match Path::new(trimmed).extension().and_then(|e| e.to_str()) {
        Some(ext) if matches!(ext.to_ascii_lowercase().as_str(), "md" | "json") => {}
        _ => {
            return Err(AppError::Forbidden(format!(
                "Only .md and .json documents can be read; refused \"{rel}\"."
            )))
        }
    }

    // The anchored model: the app owns the root, the caller supplies a relative
    // fragment, and containment is asserted on the CANONICAL form (which also
    // defeats a symlink pointing out of the tree). Never fall back to the raw
    // string afterwards — use only what the resolver returned.
    let resolved = resolve_within_root(root, trimmed).map_err(AppError::Forbidden)?;

    // Second gate, because `root` is the whole repo: the resolved path must
    // also sit under docs/concepts/. Belt and braces, cheap.
    let doc_root = root.join(doc_root_rel);
    if let Ok(canonical_doc_root) = std::fs::canonicalize(&doc_root) {
        if !resolved.starts_with(&canonical_doc_root) {
            return Err(AppError::Forbidden(format!(
                "Path escapes {doc_root_rel}/: \"{rel}\"."
            )));
        }
    }

    if !resolved.is_file() {
        return Ok(HierarchyDoc {
            rel_path: trimmed.to_string(),
            markdown: String::new(),
            frontmatter: Vec::new(),
            exists: false,
        });
    }

    let raw = std::fs::read_to_string(&resolved)?;
    let (frontmatter, markdown) = match parse_frontmatter(&raw) {
        Some((fm, body)) => (fm.entries(), body.to_string()),
        None => (Vec::new(), raw),
    };

    Ok(HierarchyDoc {
        rel_path: trimmed.to_string(),
        markdown,
        frontmatter,
        exists: true,
    })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// A byte copy of `table/table.md` as committed on 2026-08-18. It is
    /// VENDORED rather than `include_str!`d from the corpus on purpose: an
    /// `include_str!` into `docs/concepts/paths/` makes the corpus a
    /// **compile-time dependency of the Rust crate**, so moving the authority to
    /// a registry (or deleting the tree after the move) stops the build instead
    /// of failing a test. `fixture_tracks_the_live_subject` below keeps this
    /// copy honest for as long as the live file is reachable.
    const TABLE_MD: &str = include_str!("fixtures/table-subject.md");

    /// THE COUPLING PIN. Two parsers implement one contract — this one and
    /// `check-corpus-integrity.mjs` — and nothing but a shared fixture stops
    /// them diverging silently. If the contract shifts, or this parser's
    /// tolerances drift, the assertions below fail here rather than in the UI.
    #[test]
    fn frontmatter_matches_committed_table_subject() {

        let (fm, body) = parse_frontmatter(TABLE_MD).expect("table.md must open with frontmatter");

        assert_eq!(fm.scalar("layer"), Some("golden-path"));
        assert_eq!(fm.scalar("subject"), Some("table"));
        assert_eq!(fm.scalar("status"), Some("forged"));

        // The declared technique list, in file order.
        assert_eq!(
            fm.list("techniques"),
            vec![
                "pagination",
                "sorting",
                "performance",
                "loading-and-empty-states",
                "client-server-split",
            ]
        );

        // `evidence:` entries carry trailing ` # comment` annotations that the
        // parser must strip — this is the quirk most likely to drift.
        let evidence = fm.list("evidence");
        assert_eq!(evidence.len(), 3, "table.md declares three evidence paths");
        assert!(
            evidence
                .iter()
                .all(|e| !e.contains('#') && !e.contains("  ")),
            "trailing comments must be stripped and the value trimmed: {evidence:?}"
        );
        assert_eq!(
            evidence[0],
            "src/features/shared/components/display/UnifiedTable.tsx"
        );

        assert_eq!(fm.list("counter_evidence").len(), 1);
        assert_eq!(fm.list("deviations").len(), 4);
        assert_eq!(fm.list("deviations")[0], "table-no-error-state");

        assert_eq!(extract_title(body).as_deref(), Some("Table"));
        let summary = extract_summary(body);
        assert!(
            summary.starts_with("A table is the surface you reach for"),
            "summary should be the first prose paragraph, got: {summary}"
        );
        assert!(summary.chars().count() <= SUMMARY_MAX + 1);
    }

    /// The repo root, or whatever root `PERSONAS_CORPUS_ROOT` points at.
    ///
    /// The override exists so this crate's tests can be aimed at a **registry
    /// clone** once the corpus authority moves out of personas — without it,
    /// every real-corpus test would have to be deleted at the flip, which is the
    /// same as deleting the only tests that read real data.
    fn corpus_root() -> PathBuf {
        match std::env::var_os("PERSONAS_CORPUS_ROOT") {
            Some(v) => PathBuf::from(v),
            None => Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .expect("src-tauri has a parent")
                .to_path_buf(),
        }
    }

    /// Resolve the corpus for the real-tree tests, or explain the skip.
    ///
    /// **A silent skip is the failure mode this repo keeps rediscovering**: a
    /// check that walks zero files and passes reports "clean" when it means
    /// "blind". So absence is only tolerated when a human said so out loud via
    /// `PERSONAS_ALLOW_NO_CORPUS`; otherwise it fails and names both the root it
    /// looked at and the two layouts it knows.
    fn require_corpus() -> Option<(PathBuf, CorpusLayout)> {
        let root = corpus_root();
        match discover_corpus(&root) {
            Some(layout) => Some((root, layout)),
            None => {
                assert!(
                    std::env::var_os("PERSONAS_ALLOW_NO_CORPUS").is_some(),
                    "no knowledge corpus under {} — looked for {PATHS_REL}/ and                      {BUNDLE_LANE_REL}/<domain>/. Point PERSONAS_CORPUS_ROOT at a                      registry clone, or set PERSONAS_ALLOW_NO_CORPUS=1 if this                      checkout genuinely carries none.",
                    root.display()
                );
                None
            }
        }
    }

    /// The vendored fixture is a copy, and a copy drifts. While the live subject
    /// file is reachable, assert they are byte-identical — that is what keeps
    /// `frontmatter_matches_committed_table_subject` a pin on reality rather
    /// than a snapshot agreeing with itself.
    #[test]
    fn fixture_tracks_the_live_subject() {
        let Some((root, layout)) = require_corpus() else {
            return;
        };
        let live = root.join(&layout.rel).join("table").join("table.md");
        if !live.is_file() {
            // A bundle without this subject is a legitimate corpus; the pin
            // simply has nothing to compare against here.
            return;
        }
        let live_raw = std::fs::read_to_string(&live).expect("table.md must read");

        // The published bundle strips evidence/counter_evidence/deviations, so a
        // registry clone is expected to differ in exactly those keys. Compare
        // the whole file only against the personas layout, which still carries
        // them; elsewhere compare the body, which must never diverge.
        if layout.rel == PATHS_REL {
            assert_eq!(
                live_raw.replace("
", "
"),
                TABLE_MD.replace("
", "
"),
                "fixtures/table-subject.md has drifted from {}. Re-copy it: the                  fixture exists to track the live file, not to replace it.",
                live.display()
            );
        } else {
            let (_, live_body) = parse_frontmatter(&live_raw).expect("live table.md frontmatter");
            let (_, fixture_body) = parse_frontmatter(TABLE_MD).expect("fixture frontmatter");
            assert_eq!(
                live_body.replace("
", "
"),
                fixture_body.replace("
", "
"),
                "the published bundle's table.md body differs from the vendored                  fixture — the mirror changed prose, which it must never do."
            );
        }
    }

    /// The registry layout reads. This is the whole point of the seam: the same
    /// reader, pointed at a bundle published as `knowledge/<domain>/`, must
    /// produce the same shape it produces for `docs/concepts/paths/`.
    #[test]
    fn hierarchy_reads_a_registry_bundle_layout() {
        let dir = tempfile::tempdir().expect("tempdir");
        let bundle = dir.path().join(BUNDLE_LANE_REL).join("software-engineering");
        std::fs::create_dir_all(bundle.join("table").join("techniques")).unwrap();
        std::fs::write(bundle.join("_laws.md"), "## one-authority-per-vocabulary
One.
").unwrap();
        std::fs::write(
            bundle.join("categories.json"),
            r#"{"categories":[{"id":"ui","title":"UI","order":1}],"subjects":{"table":"ui"}}"#,
        )
        .unwrap();
        std::fs::write(
            bundle.join("table").join("table.md"),
            "---
layer: golden-path
type: golden-path
subject: table
status: forged
techniques:
  - sorting
---
# Table

A table.
",
        )
        .unwrap();
        std::fs::write(
            bundle.join("table").join("techniques").join("sorting.md"),
            "---
layer: technique
type: technique
subject: table
technique: sorting
---
# Sorting

Sort it.
",
        )
        .unwrap();

        let g = build_graph(dir.path()).expect("a registry bundle must read");
        assert!(g.source.present, "reason: {:?}", g.source.reason);
        assert_eq!(
            g.source.corpus_rel.as_deref(),
            Some("knowledge/software-engineering"),
            "the reader must report WHERE it read from — the UI has no other way to know"
        );
        assert_eq!(g.source.doc_root_rel.as_deref(), Some(BUNDLE_LANE_REL));
        assert_eq!(g.counts.subjects, 1);
        assert_eq!(g.counts.techniques, 1);
        // Emitted paths are bundle-relative, not personas-relative. A UI that
        // hardcoded `docs/concepts/paths/` would resolve none of these.
        assert_eq!(
            g.techniques[0].file,
            "knowledge/software-engineering/table/techniques/sorting.md"
        );
    }

    /// Two bundles is a choice, and the reader must not make it silently.
    #[test]
    fn hierarchy_names_the_bundle_it_picked_when_several_exist() {
        let dir = tempfile::tempdir().expect("tempdir");
        for domain in ["media-craft", "software-engineering"] {
            let b = dir.path().join(BUNDLE_LANE_REL).join(domain);
            std::fs::create_dir_all(&b).unwrap();
            std::fs::write(b.join("_laws.md"), "## l
L.
").unwrap();
        }
        let layout = discover_corpus(dir.path()).expect("a bundle lane resolves");
        assert_eq!(layout.rel, "knowledge/media-craft", "first alphabetically");
        let note = layout.note.expect("an ambiguous choice must be reported");
        assert!(note.contains("media-craft") && note.contains("software-engineering"), "{note}");

        let g = build_graph(dir.path()).expect("reads");
        assert!(
            g.warnings.iter().any(|w| w.message.contains("2 bundles are present")),
            "the choice must reach the UI as a warning: {:#?}",
            g.warnings
        );
    }

    #[test]
    fn corpus_root_override_is_used_when_it_exists() {
        let dir = tempfile::tempdir().expect("tempdir");
        let raw = dir.path().to_string_lossy().to_string();
        match resolve_override(Some(&raw)) {
            Some(RootResolution::Ok(p)) => assert_eq!(p, dir.path()),
            _ => panic!("expected Ok(root) for an existing directory"),
        }
    }

    #[test]
    fn a_missing_override_never_falls_back_to_the_project() {
        // THE rule of the P3 flip. Falling back would read the project's own
        // `docs/concepts/paths/` while the UI says it is showing the registry's
        // — and since the two corpora are supposed to be identical, a silent
        // fallback is exactly what would hide them drifting apart.
        match resolve_override(Some("Z:/no/such/registry/clone")) {
            Some(RootResolution::Absent(src)) => {
                assert!(!src.present);
                let reason = src.reason.expect("absence must explain itself");
                assert!(reason.contains("no/such/registry/clone"), "{reason}");
            }
            _ => panic!("expected Absent for a path that is not a directory"),
        }
    }

    #[test]
    fn no_override_means_carry_on_with_the_project() {
        // Blank and whitespace are "not given", not "given and empty" — the
        // frontend sends null, but a stray "" must not become a refusal.
        assert!(resolve_override(None).is_none());
        assert!(resolve_override(Some("")).is_none());
        assert!(resolve_override(Some("   ")).is_none());
    }

    #[test]
    fn hierarchy_parses_block_lists() {
        let (fm, body) = parse_frontmatter("---\nlayer: golden-path\nitems:\n  - a\n  - b\n---\n# T\n")
            .expect("block list");
        assert_eq!(fm.list("items"), vec!["a", "b"]);
        assert_eq!(fm.scalar("layer"), Some("golden-path"));
        assert_eq!(body, "# T\n");
    }

    #[test]
    fn hierarchy_parses_inline_arrays_and_empty_arrays() {
        let (fm, _) = parse_frontmatter("---\nlaws: [one, two, three]\nshared_with: []\n---\n")
            .expect("inline arrays");
        assert_eq!(fm.list("laws"), vec!["one", "two", "three"]);
        assert!(fm.list("shared_with").is_empty());
        // `[]` is a LIST, not a missing key — the distinction the wire format keeps.
        assert_eq!(fm.get("shared_with"), Some(&FmValue::List(Vec::new())));
    }

    #[test]
    fn hierarchy_strips_trailing_comments_only_after_whitespace() {
        assert_eq!(strip_trailing_comment("value   # note"), "value");
        assert_eq!(strip_trailing_comment("  - path/x.ts  # why"), "  - path/x.ts");
        // No whitespace before `#` — a fragment, not a comment.
        assert_eq!(strip_trailing_comment("docs/a.md#anchor"), "docs/a.md#anchor");
        assert_eq!(strip_trailing_comment("#leading"), "#leading");
        assert_eq!(strip_trailing_comment("plain"), "plain");
    }

    #[test]
    fn hierarchy_returns_none_without_a_frontmatter_block() {
        assert!(parse_frontmatter("# Just a heading\n\nbody\n").is_none());
        assert!(parse_frontmatter("").is_none());
        // Opens with `---` but never closes.
        assert!(parse_frontmatter("---\nlayer: technique\n").is_none());
    }

    #[test]
    fn hierarchy_splits_shared_technique_owner() {
        let (fm, _) = parse_frontmatter(
            "---\nsubject: feed\ntechniques:\n  - pagination@table\n  - ordering\n---\n",
        )
        .expect("fm");
        let declared = fm.list("techniques");
        let split: Vec<_> = declared
            .iter()
            .map(|t| t.split_once('@'))
            .collect();
        assert_eq!(split[0], Some(("pagination", "table")));
        assert_eq!(split[1], None, "a local technique carries no @owner");
    }

    #[test]
    fn hierarchy_strips_code_before_matching_links() {
        // A regex in prose is not a hyperlink. The JS checker learned this by
        // reporting a false dead link; this parser must not learn it again.
        let body = "See [real](../table/table.md).\n\n```\n[fake](./nope.md)\n```\n\nand `[inline](./also-nope.md)` too.\n";
        let stripped = strip_code(body);
        let links = relative_links(&stripped);
        assert_eq!(links, vec!["../table/table.md"]);
    }

    #[test]
    fn hierarchy_ignores_absolute_and_fragment_links() {
        let links = relative_links(
            "[a](https://x.test/y) [b](#anchor) [c](mailto:x@y.z) [d](./real.md#sec)",
        );
        assert_eq!(links, vec!["./real.md"]);
    }

    #[test]
    fn hierarchy_parses_law_anchors() {
        let laws = parse_laws(
            "# Laws\n\nintro\n\n## <a id=\"gate-sees-target\"></a> gate-sees-target\n\nA gate must observe the thing it gates.\n\n## <a id=\"other\"></a> Other law\n\nSecond statement.\n",
        );
        assert_eq!(laws.len(), 2);
        assert_eq!(laws[0].id, "gate-sees-target");
        assert_eq!(laws[0].title, "gate-sees-target");
        assert!(laws[0].summary.starts_with("A gate must observe"));
        assert_eq!(laws[1].id, "other");
        assert_eq!(laws[1].title, "Other law");
    }

    // -- graph construction over a synthetic corpus -------------------------

    fn write(path: &Path, body: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }

    /// Two complete subjects plus three separate defects, so one assertion set
    /// covers "renders what it can" and "reports what it skipped".
    fn fixture_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(PATHS_REL);

        write(
            &p.join("categories.json"),
            r#"{"categories":[{"id":"ui-surfaces","title":"UI surfaces","order":1}],"subjects":{"table":"ui-surfaces","feed":"ui-surfaces"}}"#,
        );
        write(
            &p.join("corpus-map.json"),
            r#"{"complete":false,"entries":{"old-table.md":"table","old-list.md":{"subject":"table"},"gone.md":"nowhere"}}"#,
        );
        write(
            &p.join("_laws.md"),
            "# Laws\n\n## <a id=\"count-carries-predicate\"></a> count-carries-predicate\n\nA count names what it counted.\n",
        );

        write(
            &p.join("table/table.md"),
            "---\nlayer: golden-path\nsubject: table\nstatus: forged\ntechniques:\n  - pagination\nevidence:\n  - a.ts   # canonical\ncounter_evidence: []\ndeviations:\n  - table-no-error-state\n---\n\n# Table\n\nComparison across uniform attributes. See [feed](../feed/feed.md).\n",
        );
        write(
            &p.join("table/techniques/pagination.md"),
            "---\nlayer: technique\nsubject: table\ntechnique: pagination\nstatus: forged\nlaws: [count-carries-predicate]\nshared_with: [feed]\n---\n\n# Pagination\n\nBounds two costs at once.\n",
        );
        write(
            &p.join("table/applications/rust--pagination.md"),
            "---\nlayer: application\nsubject: table\ntechnique: pagination\nstack: rust\n---\n\n# Keyset\n",
        );

        write(
            &p.join("feed/feed.md"),
            "---\nlayer: golden-path\nsubject: feed\nstatus: draft\ntechniques:\n  - pagination@table\nevidence:\n  - b.ts\n---\n\n# Feed\n\nA feed orders by recency.\n",
        );

        // Defect 1: a subject folder with no golden path.
        std::fs::create_dir_all(p.join("half-forged/techniques")).unwrap();
        write(
            &p.join("half-forged/techniques/orphan.md"),
            "---\nlayer: technique\nsubject: half-forged\ntechnique: orphan\n---\n\n# Orphan\n",
        );
        // Defect 2: a golden path with no frontmatter at all.
        write(&p.join("bare/bare.md"), "# Bare\n\nNo frontmatter here.\n");
        // Defect 3: a declared technique whose file never landed.
        write(
            &p.join("partial/partial.md"),
            "---\nlayer: golden-path\nsubject: partial\nstatus: draft\ntechniques:\n  - missing-one\nevidence:\n  - c.ts\n---\n\n# Partial\n\nStill being forged.\n",
        );

        dir
    }

    #[test]
    fn hierarchy_graph_tolerates_incomplete_subjects() {
        let dir = fixture_repo();
        let g = build_graph(dir.path()).expect("build");

        assert!(g.source.present);
        assert!(g.source.reason.is_none());

        let slugs: Vec<&str> = g.subjects.iter().map(|s| s.slug.as_str()).collect();
        assert_eq!(
            slugs,
            vec!["feed", "partial", "table"],
            "the two defective folders are skipped, everything else renders"
        );
        assert_eq!(g.counts.subjects, 3);
        assert_eq!(g.counts.techniques, 1);
        assert_eq!(g.counts.applications, 1);
        assert_eq!(g.counts.evidence, 3);

        // Each defect is REPORTED, not swallowed.
        let msgs: Vec<String> = g
            .warnings
            .iter()
            .map(|w| format!("{}|{}", w.path, w.message))
            .collect();
        assert!(
            msgs.iter().any(|m| m.contains("half-forged") && m.contains("no half-forged.md")),
            "missing golden path must warn: {msgs:?}"
        );
        assert!(
            msgs.iter().any(|m| m.contains("bare/bare.md") && m.contains("missing frontmatter")),
            "malformed frontmatter must warn: {msgs:?}"
        );
        assert!(
            msgs.iter().any(|m| m.contains("partial") && m.contains("missing-one")),
            "a declared-but-absent technique must warn: {msgs:?}"
        );

        let table = g.subjects.iter().find(|s| s.slug == "table").unwrap();
        assert_eq!(table.category.as_deref(), Some("ui-surfaces"));
        assert_eq!(table.status.as_deref(), Some("forged"));
        assert_eq!(table.techniques, vec!["pagination"]);
        assert_eq!(table.evidence, vec!["a.ts"]);
        assert_eq!(table.deviations, vec!["table-no-error-state"]);
        assert_eq!(table.legacy_count, 2, "two legacy docs map to table");
        assert_eq!(table.applications.len(), 1);
        assert_eq!(table.applications[0].stack, "rust");

        let feed = g.subjects.iter().find(|s| s.slug == "feed").unwrap();
        assert!(feed.techniques.is_empty());
        assert_eq!(feed.shared_techniques.len(), 1);
        assert_eq!(feed.shared_techniques[0].technique, "pagination");
        assert_eq!(feed.shared_techniques[0].owner, "table");

        // The partial subject keeps NO phantom technique.
        let partial = g.subjects.iter().find(|s| s.slug == "partial").unwrap();
        assert!(partial.techniques.is_empty());

        // Edges: table→feed by prose link, feed→table by shared technique.
        let edges: Vec<(&str, &str, &str)> = g
            .cross_links
            .iter()
            .map(|e| (e.from.as_str(), e.to.as_str(), e.kind.as_str()))
            .collect();
        assert!(edges.contains(&("table", "feed", "subject")), "{edges:?}");
        assert!(edges.contains(&("feed", "table", "technique")), "{edges:?}");

        assert_eq!(g.laws.len(), 1);
        assert_eq!(g.laws[0].id, "count-carries-predicate");

        // corpus-map keeps every entry, but only resolvable ones are counted.
        assert_eq!(g.corpus_map.len(), 3);
        assert_eq!(g.counts.legacy_mapped, 2);

        assert_eq!(g.categories.len(), 1);
        assert_eq!(g.categories[0].id, "ui-surfaces");
    }

    #[test]
    fn hierarchy_graph_is_empty_with_a_reason_when_paths_are_absent() {
        let dir = tempfile::tempdir().unwrap();
        let g = build_graph(dir.path()).expect("an absent corpus is not an error");
        assert!(!g.source.present);
        assert!(g.source.root.is_some());
        let reason = g.source.reason.expect("emptiness must explain itself");
        assert!(reason.contains(PATHS_REL), "{reason}");
        assert!(g.subjects.is_empty() && g.warnings.is_empty() && g.counts.subjects == 0);
    }

    #[test]
    fn hierarchy_cache_reuses_an_unchanged_tree() {
        let dir = fixture_repo();
        let a = cached_graph(dir.path()).unwrap();
        let b = cached_graph(dir.path()).unwrap();
        assert!(
            Arc::ptr_eq(&a, &b),
            "an unchanged tree must not be re-parsed"
        );
    }

    // -- doc fetch ----------------------------------------------------------

    /// Assert the instrument, not just the result. The unit tests above run
    /// over a five-file fixture; this one runs the real reader over the real
    /// corpus and refuses to pass on a suspiciously small answer — the failure
    /// mode where a walk breaks and reports a green, nearly-empty graph.
    ///
    /// Deliberately loose on exact counts: the corpus is forged wave by wave
    /// and gains folders while sessions run. It asserts floors and shape, never
    /// a snapshot.
    #[test]
    fn hierarchy_reads_this_repos_real_corpus() {
        let Some((root, layout)) = require_corpus() else {
            return;
        };

        let g = build_graph(&root).expect("the real corpus must read");
        assert!(g.source.present);
        assert!(
            g.counts.subjects > 50,
            "only {} subjects parsed — the folder walk is probably broken, not the corpus. warnings: {:#?}",
            g.counts.subjects,
            g.warnings
        );
        assert!(
            g.counts.techniques > 100,
            "only {} techniques parsed",
            g.counts.techniques
        );
        if layout.rel == PATHS_REL {
            // Evidence is consumer-side by construction: the published bundle
            // carries none (rkb-profile §5), so this counts zero against a
            // registry clone and that is the design working, not a regression.
            assert!(
                g.counts.evidence >= g.counts.subjects,
                "every subject declares ≥1 evidence path"
            );
        }
        assert_eq!(g.categories.len(), 8, "the eight inventory categories");
        assert!(g.laws.len() >= 9, "nine cross-cutting laws");
        if layout.rel == PATHS_REL {
            // `corpus-map.json` maps the LEGACY golden-paths corpus onto this
            // one. It is deliberately not published to the registry bundle (it
            // describes one consumer's history, not the standard), so asserting
            // it unconditionally would fail the moment the reader is aimed at a
            // clone — and asserting it nowhere would stop guarding it here.
            assert!(!g.corpus_map.is_empty(), "the legacy map is populated");
        }
        assert!(
            g.cross_links.len() > 20,
            "only {} cross-links — the link matcher is probably broken",
            g.cross_links.len()
        );
        // Every category assignment must resolve to a declared category.
        let ids: BTreeSet<&str> = g.categories.iter().map(|c| c.id.as_str()).collect();
        for s in &g.subjects {
            if let Some(c) = &s.category {
                assert!(ids.contains(c.as_str()), "{} → unknown category {c}", s.slug);
            }
        }
    }

    #[test]
    fn hierarchy_doc_reads_a_valid_document() {
        let dir = fixture_repo();
        let doc = read_doc(dir.path(), DOC_ROOT_REL, "docs/concepts/paths/table/table.md").unwrap();
        assert!(doc.exists);
        assert!(doc.markdown.starts_with("\n# Table"), "{:?}", doc.markdown);
        assert!(
            !doc.markdown.contains("layer: golden-path"),
            "the frontmatter block is returned separately, not inside the body"
        );
        let keys: Vec<&str> = doc.frontmatter.iter().map(|e| e.key.as_str()).collect();
        assert_eq!(
            keys,
            vec![
                "layer",
                "subject",
                "status",
                "techniques",
                "evidence",
                "counter_evidence",
                "deviations"
            ]
        );
        let techniques = doc
            .frontmatter
            .iter()
            .find(|e| e.key == "techniques")
            .unwrap();
        assert!(techniques.is_list);
        assert_eq!(techniques.values, vec!["pagination"]);
    }

    #[test]
    fn hierarchy_doc_missing_file_is_not_an_error() {
        let dir = fixture_repo();
        let doc = read_doc(dir.path(), DOC_ROOT_REL, "docs/concepts/paths/table/never-written.md").unwrap();
        assert!(!doc.exists);
        assert!(doc.markdown.is_empty());
    }

    // -- adherence scorecard --------------------------------------------------

    /// Synthetic-but-faithful miniature of the real artifact: two subjects,
    /// one with a dirty context carrying MORE than TOP_RULES_MAX rules (so the
    /// truncation-with-disclosure contract is exercised), one clean-ish.
    fn scorecard_fixture() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write(
            &dir.path().join(SCORECARD_REL),
            r#"{
  "$comment": "fixture",
  "generatedAt": "2026-08-18T18:08:03.828Z",
  "inputs": {"ruleCount": 7, "assignedRules": 7, "contextCount": 12},
  "totals": {"sites": 110, "matchedFiles": 30, "multiContextFiles": 1, "cleanSubjects": 0},
  "subjects": {
    "table": {
      "rules": 6, "sites": 100, "matchedFiles": 25,
      "applicableContexts": 10, "cleanContexts": 4,
      "contexts": [
        {"id": "c1", "name": "agents-deployment", "group": "Agent Platform",
         "sites": 60, "matchedFiles": 15,
         "rules": [
           {"id": "r1", "sites": 20}, {"id": "r2", "sites": 15},
           {"id": "r3", "sites": 10}, {"id": "r4", "sites": 8},
           {"id": "r5", "sites": 4}, {"id": "r6", "sites": 3}
         ]},
        {"id": "c2", "name": "vault-ui", "group": "Security & Credentials",
         "sites": 40, "matchedFiles": 10, "rules": [{"id": "r1", "sites": 40}]}
      ],
      "uncontexted": {"sites": 5, "files": 2}
    },
    "feed": {
      "rules": 1, "sites": 10, "matchedFiles": 5,
      "applicableContexts": 8, "cleanContexts": 7,
      "contexts": [
        {"id": "c1", "name": "agents-deployment", "group": "Agent Platform",
         "sites": 10, "matchedFiles": 5, "rules": [{"id": "r7", "sites": 10}]}
      ],
      "uncontexted": {"sites": 0, "files": 0}
    }
  }
}"#,
        );
        dir
    }

    #[test]
    fn scorecard_parses_the_fixture_and_discloses_truncation() {
        let dir = scorecard_fixture();
        let sc = build_scorecard(dir.path()).expect("fixture must parse");

        assert!(sc.source.present);
        assert!(sc.source.reason.is_none());
        assert_eq!(sc.generated_at.as_deref(), Some("2026-08-18T18:08:03.828Z"));
        assert_eq!(sc.rule_count, 7);
        assert_eq!(sc.assigned_rules, 7);
        assert_eq!(sc.context_count, 12);
        assert_eq!(sc.total_sites, 110);
        assert_eq!(sc.total_matched_files, 30);

        // BTreeMap iteration → slug order.
        let slugs: Vec<&str> = sc.subjects.iter().map(|s| s.slug.as_str()).collect();
        assert_eq!(slugs, vec!["feed", "table"]);

        let table = sc.subjects.iter().find(|s| s.slug == "table").unwrap();
        assert_eq!(table.rules, 6);
        assert_eq!(table.sites, 100);
        assert_eq!(table.matched_files, 25);
        assert_eq!(table.applicable_contexts, 10);
        assert_eq!(table.clean_contexts, 4);
        assert_eq!(table.uncontexted_sites, 5);
        assert_eq!(table.contexts.len(), 2);

        // Truncation carries its disclosure: 6 rules, 5 on the wire.
        let c1 = &table.contexts[0];
        assert_eq!(c1.name, "agents-deployment");
        assert_eq!(c1.group, "Agent Platform");
        assert_eq!(c1.rule_count, 6);
        assert_eq!(c1.top_rules.len(), TOP_RULES_MAX);
        assert_eq!(c1.top_rules[0].id, "r1");
        assert_eq!(c1.top_rules[0].sites, 20);

        let c2 = &table.contexts[1];
        assert_eq!(c2.rule_count, 1);
        assert_eq!(c2.top_rules.len(), 1);
    }

    #[test]
    fn scorecard_absence_is_an_honest_empty_naming_the_generator() {
        let dir = tempfile::tempdir().unwrap();
        let sc = build_scorecard(dir.path()).expect("an absent artifact is not an error");
        assert!(!sc.source.present);
        let reason = sc.source.reason.expect("emptiness must explain itself");
        assert!(
            reason.contains(SCORECARD_GENERATOR),
            "the reason must NAME the generator command: {reason}"
        );
        assert!(sc.subjects.is_empty());
        assert_eq!(sc.total_sites, 0);
        assert!(sc.generated_at.is_none());
    }

    #[test]
    fn scorecard_malformed_json_is_an_err_not_a_clean_reading() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join(SCORECARD_REL), "{ this is not json");
        let err = build_scorecard(dir.path()).expect_err("a malformed artifact must error");
        let msg = err.to_string();
        assert!(msg.contains(SCORECARD_REL), "{msg}");
        assert!(msg.contains(SCORECARD_GENERATOR), "{msg}");
    }

    #[test]
    fn scorecard_cache_reuses_an_unchanged_artifact() {
        let dir = scorecard_fixture();
        let a = cached_scorecard(dir.path()).unwrap();
        let b = cached_scorecard(dir.path()).unwrap();
        assert!(
            Arc::ptr_eq(&a, &b),
            "an unchanged artifact must not be re-parsed"
        );
    }

    /// Floors, not a snapshot, against the REAL committed artifact — the same
    /// posture as `hierarchy_reads_this_repos_real_corpus`. Census waves add
    /// subjects; this must never redden for that.
    #[test]
    fn scorecard_reads_this_repos_real_artifact() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .to_path_buf();
        if !root.join(SCORECARD_REL).is_file() {
            // A checkout without the artifact is legitimate; the empty case
            // has its own test.
            return;
        }

        let sc = build_scorecard(&root).expect("the real artifact must parse");
        assert!(sc.source.present);
        assert!(
            sc.subjects.len() >= 50,
            "only {} subjects — the artifact join is probably broken, not the census",
            sc.subjects.len()
        );
        assert!(sc.total_sites > 0, "a census with zero sites everywhere is not credible");
        assert!(sc.rule_count > 0);
        assert!(sc.generated_at.is_some());
        for s in &sc.subjects {
            assert!(
                s.clean_contexts <= s.applicable_contexts,
                "{}: clean {} > applicable {}",
                s.slug,
                s.clean_contexts,
                s.applicable_contexts
            );
            for c in &s.contexts {
                assert!(c.sites > 0, "{}: context {} listed with zero sites", s.slug, c.name);
                assert!(c.top_rules.len() <= TOP_RULES_MAX);
                assert!(c.rule_count as usize >= c.top_rules.len());
            }
        }
    }

    #[test]
    fn hierarchy_doc_rejects_escapes() {
        let dir = fixture_repo();
        write(&dir.path().join("secret.md"), "shh");
        for bad in [
            "docs/concepts/../../secret.md",
            "../secret.md",
            "secret.md",
            "src/lib.rs",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "docs/concepts/paths/table/table.md.exe",
            "",
        ] {
            assert!(
                read_doc(dir.path(), DOC_ROOT_REL, bad).is_err(),
                "must refuse {bad:?}"
            );
        }
    }
}
