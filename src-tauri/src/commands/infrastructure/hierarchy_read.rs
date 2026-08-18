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

/// Repo-relative location of the hierarchy corpus.
const PATHS_REL: &str = "docs/concepts/paths";
/// The subtree `dev_tools_hierarchy_doc` is allowed to read from.
const DOC_ROOT_REL: &str = "docs/concepts";
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
    /// True when `docs/concepts/paths/` was found and read.
    pub present: bool,
    /// Human-readable reason the graph is empty. `None` when `present`.
    pub reason: Option<String>,
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

/// Build the whole graph from a repo root. Blocking; call under `spawn_blocking`.
fn build_graph(root: &Path) -> Result<HierarchyGraph, AppError> {
    let paths_dir = root.join(PATHS_REL);
    let root_display = root.to_string_lossy().replace('\\', "/");

    if !paths_dir.is_dir() {
        return Ok(HierarchyGraph::empty(HierarchySource {
            root: Some(root_display),
            present: false,
            reason: Some(format!(
                "This repository has no {PATHS_REL}/ folder, so it carries no knowledge hierarchy."
            )),
        }));
    }

    let mut warnings: Vec<HierarchyWarning> = Vec::new();

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
                path: format!("{PATHS_REL}/categories.json"),
                message: format!("could not be parsed: {e} — subjects will render uncategorised"),
            }),
        }
    } else {
        warnings.push(HierarchyWarning {
            path: format!("{PATHS_REL}/categories.json"),
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
                            path: format!("{PATHS_REL}/corpus-map.json"),
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
                path: format!("{PATHS_REL}/corpus-map.json"),
                message: format!("could not be parsed: {e} — legacy counts will read zero"),
            }),
        }
    }

    // -- _laws.md -----------------------------------------------------------
    let laws_path = paths_dir.join("_laws.md");
    let laws = if laws_path.is_file() {
        read_tolerant(&laws_path, &format!("{PATHS_REL}/_laws.md"), &mut warnings)
            .map(|s| parse_laws(&s))
            .unwrap_or_default()
    } else {
        warnings.push(HierarchyWarning {
            path: format!("{PATHS_REL}/_laws.md"),
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
                    format!("reading {PATHS_REL}/: {e}"),
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
        let gp_rel = format!("{PATHS_REL}/{slug}/{slug}.md");
        let gp_path = dir.join(format!("{slug}.md"));

        if !gp_path.is_file() {
            warnings.push(HierarchyWarning {
                path: format!("{PATHS_REL}/{slug}/"),
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
                            "shared technique \"{entry}\" does not resolve to {PATHS_REL}/{owner}/techniques/{tech}.md"
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
                    path: format!("{PATHS_REL}/{slug}/techniques/{t}.md"),
                    message: format!("exists but {slug}.md does not declare it"),
                });
                local.push(t.clone());
            }
        }

        for t in &local {
            let t_rel = format!("{PATHS_REL}/{slug}/techniques/{t}.md");
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
            let a_rel = format!("{PATHS_REL}/{slug}/applications/{f}");
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
    let signature = tree_signature(&root.join(PATHS_REL));

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
// Project → filesystem root
// ---------------------------------------------------------------------------

/// Outcome of resolving a managed project to a readable repo root.
enum RootResolution {
    Ok(PathBuf),
    /// Not an error — an empty graph with this explanation.
    Absent(HierarchySource),
}

fn resolve_root(state: &AppState, project_id: &str) -> Result<RootResolution, AppError> {
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
) -> Result<HierarchyGraph, AppError> {
    require_auth(&state).await?;

    let root = match resolve_root(&state, &project_id)? {
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
/// `rel_path` is repo-relative and MUST stay inside `docs/concepts/`. Rejection
/// is an `Err` (the caller asked for something it may not have); a valid path
/// that simply is not there returns `exists: false`, because a forward
/// reference to an unwritten neighbour is legal in this corpus and must not
/// surface as an error toast.
#[tauri::command]
pub async fn dev_tools_hierarchy_doc(
    state: State<'_, Arc<AppState>>,
    project_id: String,
    rel_path: String,
) -> Result<HierarchyDoc, AppError> {
    require_auth(&state).await?;

    let root = match resolve_root(&state, &project_id)? {
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
    tokio::task::spawn_blocking(move || read_doc(&root, &requested))
        .await
        .map_err(|e| AppError::Internal(format!("hierarchy doc join error: {e}")))?
}

fn read_doc(root: &Path, rel: &str) -> Result<HierarchyDoc, AppError> {
    let trimmed = rel.trim().trim_start_matches("./");
    if trimmed.is_empty() {
        return Err(AppError::Validation("No document path was given.".into()));
    }
    if !(trimmed == DOC_ROOT_REL || trimmed.starts_with(&format!("{DOC_ROOT_REL}/"))) {
        return Err(AppError::Forbidden(format!(
            "Only documents under {DOC_ROOT_REL}/ can be read; refused \"{rel}\"."
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
    let doc_root = root.join(DOC_ROOT_REL);
    if let Ok(canonical_doc_root) = std::fs::canonicalize(&doc_root) {
        if !resolved.starts_with(&canonical_doc_root) {
            return Err(AppError::Forbidden(format!(
                "Path escapes {DOC_ROOT_REL}/: \"{rel}\"."
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

    /// THE COUPLING PIN. Two parsers implement one contract — this one and
    /// `check-corpus-integrity.mjs` — and nothing but a shared fixture stops
    /// them diverging silently. This parses a REAL committed subject file at
    /// compile time; if `table.md` changes shape, or this parser's tolerances
    /// drift, the assertion below fails here rather than in the UI.
    #[test]
    fn frontmatter_matches_committed_table_subject() {
        const TABLE_MD: &str = include_str!("../../../../docs/concepts/paths/table/table.md");

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
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri has a parent")
            .to_path_buf();
        if !root.join(PATHS_REL).is_dir() {
            // A checkout without the corpus is a legitimate state; the empty
            // case is covered by its own test.
            return;
        }

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
        assert!(g.counts.evidence >= g.counts.subjects, "every subject declares ≥1 evidence path");
        assert_eq!(g.categories.len(), 8, "the eight inventory categories");
        assert!(g.laws.len() >= 9, "nine cross-cutting laws");
        assert!(!g.corpus_map.is_empty(), "the legacy map is populated");
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
        let doc = read_doc(dir.path(), "docs/concepts/paths/table/table.md").unwrap();
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
        let doc = read_doc(dir.path(), "docs/concepts/paths/table/never-written.md").unwrap();
        assert!(!doc.exists);
        assert!(doc.markdown.is_empty());
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
                read_doc(dir.path(), bad).is_err(),
                "must refuse {bad:?}"
            );
        }
    }
}
