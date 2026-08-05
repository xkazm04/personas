//! System-prompt composition for the companion's CLI session.
//!
//! Layers fed to Claude every turn:
//!   1. Constitution — static character + voice + provenance contract.
//!   2. Identity — evolving self-model from `identity.md`.
//!   3. Observability digest — current state of the Personas app.
//!   4. Recalled conversation — episodes via hybrid retrieval.
//!   5. Reference (doctrine) — relevant chunks of the curated app docs.
//!
//! The two recall sections are kept distinct so Athena can tell us-history
//! ("we discussed X") from canonical reference ("the docs say X").

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use serde::Serialize;

use crate::companion::brain::backlog::BacklogItem;
use crate::companion::brain::episodic::{self, Episode};
use crate::companion::brain::goals::Goal;
use crate::companion::brain::procedural::Procedural;
#[cfg(feature = "ml")]
use crate::companion::brain::recall_synthesis::{
    self, Briefing, SYNTHESIS_TOKEN_THRESHOLD,
};
#[cfg(not(feature = "ml"))]
use crate::companion::brain::recall_synthesis::Briefing;
#[cfg(feature = "ml")]
use crate::companion::brain::retrieval;
use crate::companion::brain::retrieval::{DoctrineHit, Recall};
use crate::companion::brain::semantic::Fact;
use crate::companion::connectors;
use crate::companion::disk;
use crate::companion::observability;
use crate::companion::plugins;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

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

/// cfg-gated seam for the optional ml-feature embedder handle, mirroring
/// `athena_reaction::embedding_manager_of`.
/// Non-ml builds never construct a `Some(_)` value of this type — it
/// exists purely so `build_system_prompt` has ONE signature across both
/// feature builds instead of a whole-function cfg split.
#[cfg(feature = "ml")]
pub type EmbedderArg<'a> = Option<&'a Arc<EmbeddingManager>>;
#[cfg(not(feature = "ml"))]
pub type EmbedderArg<'a> = Option<&'a ()>;

/// Build the full system prompt.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
///
/// Returns the composed prompt, the recall preview the panel renders, and
/// the per-block size breakdown the caller hands to the turn ledger.
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
) -> Result<(String, RecallPreview, PromptBlockSizes), AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity = fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    // Append the operative-memory digest — active orchestration view
    // for Athena (live per-session work, files touched, recent
    // failures). Empty string when no operations are tracked so the
    // prompt stays clean for users not using fleet. This *replaces*
    // the older flat fleet-state digest with an operation-grouped
    // narrative tied to user intent.
    let observability_md = format!(
        "{}{}{}{}{}{}{}",
        observability_md,
        crate::companion::orchestration::operative_memory::memory().digest_for_prompt(),
        // Multi-conversation: the roster of the user's OTHER open threads, so one
        // Athena stays aware of all her conversations (design §2). Empty when
        // there's only this thread.
        crate::companion::conversation::roster_digest_for_prompt(user_db, session_id),
        // Fleet index blocks — bounded name→id listings for the three entity
        // kinds Athena's ops address by id. They ride the observability slot
        // ON PURPOSE: `compose()` blanks the six *memory* blocks when a recall
        // briefing exists, and these are structural facts about what exists
        // right now, not recalled memory. Blanking them would put her straight
        // back to inventing UUIDs on exactly the turns where recall is richest.
        format_persona_index(sys_db),
        format_context_index(sys_db),
        format_skill_index(sys_db),
        // Mastermind canvas scene digest (WP2). Same slot and the same
        // reasoning as the three index blocks: it is a structural fact about
        // what the portfolio looks like RIGHT NOW, not recalled memory, so it
        // must survive `compose()`'s recall-briefing blanking.
        format_scene_digest(sys_db),
    );

    // The only genuinely ml-vs-non-ml seams: whether retrieval is
    // embedding-backed, and whether recall synthesis can run at all.
    let recall = recall_for(user_db, embedder, session_id, query).await;
    let briefing: Option<Briefing> =
        synthesize_if_enabled(&recall, query, recall_synthesis_enabled).await;

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    // PROGRESS narration is always-on (visual timeline); the TTS grammar
    // rides the same prompt slot but only when voice playback is active.
    let voice_md = format!(
        "{}{}",
        voice_addendum_if_needed(voice_enabled),
        progress_addendum()
    );
    let display_md = display_addendum_if_voice_active(voice_enabled);
    // Dev-mode self-model rides the same "mode addenda" prompt slot as
    // autonomous mode — both are header-toggle-gated blocks and compose()
    // treats the slot as opaque markdown. The reply-language directive rides
    // the same opaque slot (non-English UI → explicit instruction; see
    // `language_addendum`).
    let autonomous_md = format!(
        "{}{}{}{}",
        autonomous_addendum_if_enabled(autonomous_mode),
        crate::companion::dev_mode::addendum_if_enabled(sys_db),
        daily_goals_addendum(user_db),
        language_addendum(sys_db),
    );
    let connector_names = connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = dev_tools_registry_for_prompt(sys_db);
    let tracking_pulses_md = format_project_tracking_pulses(user_db, &plugin_names);
    let plugins_md = format!(
        "{}{}{}",
        format_plugins(&plugin_names, &projects, &tracking_pulses_md),
        format_project_goals(sys_db),
        format_project_kpis(sys_db),
    );

    let preview = summarize_recall(&recall, briefing.is_some());
    let (composed, block_sizes) = compose(
        &constitution,
        &identity,
        &observability_md,
        &recall,
        briefing.as_ref(),
        &plugins_md,
        &connectors_md,
        &onboarding_md,
        &voice_md,
        &display_md,
        &autonomous_md,
    );
    // Exactly one budget audit per composed prompt.
    block_sizes.warn_over_budget();
    Ok((composed, preview, block_sizes))
}

/// Raw (unsynthesized) recall — shared by both the embedding-backed and
/// plain retrieval paths.
fn manual_recall(user_db: &UserDbPool, session_id: &str) -> Recall {
    Recall {
        episodes: episodic::list_recent(user_db, session_id, 20).unwrap_or_default(),
        doctrine: Vec::new(),
        facts: crate::companion::brain::semantic::list_facts(user_db, None, false, 6)
            .unwrap_or_default(),
        procedurals: crate::companion::brain::procedural::list_rules(user_db, None, false, 6)
            .unwrap_or_default(),
        goals: crate::companion::brain::goals::list_goals(
            user_db,
            Some(crate::companion::brain::goals::GoalStatus::Active),
            8,
        )
        .unwrap_or_default(),
        backlog: crate::companion::brain::backlog::list_items(user_db, None, true, 6)
            .unwrap_or_default(),
    }
}

/// ml build: embedding-backed hybrid retrieval when an embedder is
/// configured, falling back to plain recent-history recall otherwise.
#[cfg(feature = "ml")]
async fn recall_for(
    user_db: &UserDbPool,
    embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
) -> Recall {
    match embedder {
        Some(emb) => retrieval::retrieve(user_db, emb, session_id, query)
            .await
            .unwrap_or_default(),
        None => manual_recall(user_db, session_id),
    }
}

/// non-ml build: no embedder type exists at all, so retrieval is always
/// the plain recent-history recall.
#[cfg(not(feature = "ml"))]
async fn recall_for(
    user_db: &UserDbPool,
    _embedder: EmbedderArg<'_>,
    session_id: &str,
    _query: &str,
) -> Recall {
    manual_recall(user_db, session_id)
}

/// Recall synthesis: when the user has opted in AND raw recall exceeds
/// the budget, ask Claude to synthesize a focused briefing that replaces
/// the raw chunks. Best-effort throughout: any failure (timeout, JSON
/// parse, non-zero exit) falls through to raw chunks so synthesis never
/// breaks a chat turn. ml-feature gated — non-ml builds never synthesize.
#[cfg(feature = "ml")]
async fn synthesize_if_enabled(recall: &Recall, query: &str, enabled: bool) -> Option<Briefing> {
    if enabled && recall_synthesis::estimate_recall_tokens(recall) > SYNTHESIS_TOKEN_THRESHOLD {
        match recall_synthesis::synthesize_recall(recall, query).await {
            Ok(b) => {
                tracing::info!(
                    summary_chars = b.summary.len(),
                    key_facts = b.key_facts.len(),
                    obligations = b.salient_obligations.len(),
                    "companion: recall synthesis succeeded"
                );
                Some(b)
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "companion: recall synthesis failed; falling through to raw chunks"
                );
                None
            }
        }
    } else {
        None
    }
}

#[cfg(not(feature = "ml"))]
async fn synthesize_if_enabled(
    _recall: &Recall,
    _query: &str,
    _enabled: bool,
) -> Option<Briefing> {
    None
}

fn format_episodes(episodes: &[Episode]) -> String {
    if episodes.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Recalled conversation (oldest first)\n\n");
    for ep in episodes {
        s.push_str(&format!(
            "## {} — {}\n\n{}\n\n",
            ep.role, ep.created_at, ep.content
        ));
    }
    s
}

/// Render facts grouped by scope. Each fact lists its sources so Athena
/// can cite back to the source episodes when she draws on it. Facts
/// without sources don't reach this layer (rejected at write time), but
/// we defensively skip empty-source rows just in case.
fn format_facts(facts: &[Fact]) -> String {
    if facts.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Semantic memory (facts you've distilled — every entry is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Fact> = facts.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for f in sorted {
        // `write_fact` refuses to persist a fact with no sources, so this
        // should be unreachable -- but the old fallback rendered the literal
        // string "no-sources" as if it were a real citation, teaching the
        // model that uncited memory is a legitimate shape. Skip it instead
        // (matching `consolidation.rs`'s `continue` on the same check) and
        // log loudly, since reaching this means the write-time invariant was
        // bypassed somewhere.
        if f.sources.is_empty() {
            tracing::warn!(
                key = %f.key,
                "skipping fact with empty sources in prompt render; write-time invariant should have prevented this"
            );
            continue;
        }
        if last_scope != Some(f.scope.as_str()) {
            s.push_str(&format!("## {} facts\n\n", capitalize(&f.scope)));
            last_scope = Some(f.scope.as_str());
        }
        s.push_str(&format!(
            "- **{key}** (importance {imp}, conf {conf:.0}%) — {value}  [from {srcs}]\n",
            key = f.key,
            imp = f.importance,
            conf = f.confidence * 100.0,
            value = f.value.trim(),
            srcs = f.sources.join(", "),
        ));
    }
    s.push('\n');
    s
}

fn capitalize(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

/// Active goals — short list, sorted by priority. Athena should glance
/// at this before responding so she doesn't lose track of what the
/// user said they're working toward. NOT cited the way facts are —
/// goals are ongoing, not historical claims.
/// Goals hub: inject the dev projects' goals + latest progress signal so Athena
/// The REAL Dev Tools registry (`dev_projects`, execution store) shaped for the
/// prompt's dev-tools block. Sources from `sys_db` — the SAME rows
/// `enqueue_dev_job` scans against — so what Athena sees matches what she acts
/// on. Previously the block read `companion_known_project` (brain DB), which
/// had drifted to worktree/duplicate registrations unrelated to the Dev Tools
/// projects the user actually manages — so she'd "analyze" a registry that
/// bore no relation to reality. Scan recency comes from the latest `dev_scans`
/// row per project.
fn dev_tools_registry_for_prompt(sys_db: &DbPool) -> Vec<crate::companion::projects::KnownProject> {
    use crate::companion::projects::KnownProject;
    use crate::db::repos::dev_tools as dt;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    projects
        .into_iter()
        .map(|p| {
            let latest = dt::list_scans(sys_db, Some(p.id.as_str()), Some(1))
                .ok()
                .and_then(|s| s.into_iter().next());
            let (last_scan_at, last_scan_summary) = match latest {
                Some(s) => (
                    Some(s.created_at),
                    Some(format!("{} scan, {} ideas", s.scan_type, s.idea_count)),
                ),
                None => (None, None),
            };
            KnownProject {
                id: p.id,
                name: p.name,
                path: p.root_path,
                description: p.description,
                last_scan_at,
                last_scan_summary,
                created_at: String::new(),
                updated_at: String::new(),
            }
        })
        .collect()
}

/// is aware of project-level direction and can reference a goal by id when she
/// proposes an `update_dev_goal`. Reads the main app DB (sys_db). Ungated so it
/// runs in both ml and non-ml prompt builds. Capped to keep the prompt lean.
fn format_project_goals(sys_db: &DbPool) -> String {
    use crate::db::repos::dev_tools as dt;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let mut body = String::new();
    let mut shown = 0usize;
    for proj in &projects {
        if shown >= 12 {
            break;
        }
        let goals = dt::list_goals_by_project(sys_db, &proj.id, None).unwrap_or_default();
        let active: Vec<_> = goals
            .iter()
            .filter(|g| g.status != "done" && g.status != "completed")
            .collect();
        if active.is_empty() {
            continue;
        }
        body.push_str(&format!("\n**{}**\n", proj.name.trim()));
        for g in active.iter().take(6) {
            if shown >= 12 {
                break;
            }
            let latest = dt::list_goal_signals(sys_db, &g.id, Some(1))
                .ok()
                .and_then(|v| v.into_iter().next())
                .map(|s| {
                    let m = s.message.unwrap_or(s.signal_type);
                    format!(" · latest: {}", first_paragraph(&m, 80))
                })
                .unwrap_or_default();
            body.push_str(&format!(
                "- {title} (id {id}) — {prog}% [{status}]{latest}\n",
                title = g.title.trim(),
                id = g.id,
                prog = g.progress,
                status = g.status,
                latest = latest,
            ));
            shown += 1;
        }
    }
    if body.is_empty() {
        return String::new();
    }
    format!(
        "\n\n# Project goals (dev direction + progress)\n\nProject-level goals you can track. To propose a change, use `update_dev_goal` with the goal's id.{body}"
    )
}

/// KPI layer: inject each dev project's ACTIVE KPIs (the outcome layer above
/// goals) so Athena can reference one by id and propose `calibrate_kpi` /
/// `evaluate_kpi` / `scan_kpis`. Reads the main app DB (sys_db). Off-track
/// status uses the SAME rule the derivation loop obeys
/// (`kpi_derivation::kpi_is_off_track`), so what Athena sees as "OFF TRACK" is
/// exactly what will derive a goal. Capped to keep the prompt lean.
fn format_project_kpis(sys_db: &DbPool) -> String {
    use crate::db::repos::dev_tools as dt;
    use crate::engine::kpi_derivation::kpi_is_off_track;
    let projects = match dt::list_projects(sys_db, None) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };
    let mut body = String::new();
    let mut shown = 0usize;
    for proj in &projects {
        if shown >= 12 {
            break;
        }
        let kpis = dt::list_kpis(sys_db, &proj.id, Some("active")).unwrap_or_default();
        if kpis.is_empty() {
            continue;
        }
        body.push_str(&format!("\n**{}**\n", proj.name.trim()));
        for k in kpis.iter().take(6) {
            if shown >= 12 {
                break;
            }
            let cur = k
                .current_value
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into());
            let tgt = k
                .target_value
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into());
            let state_label = if k.current_value.is_none() {
                "unmeasured"
            } else if kpi_is_off_track(k) {
                "OFF TRACK"
            } else {
                "on track"
            };
            body.push_str(&format!(
                "- {name} (id {id}) — {cur}/{tgt} {unit} · {tier} · {state}\n",
                name = k.name.trim(),
                id = k.id,
                cur = cur,
                tgt = tgt,
                unit = k.unit,
                tier = k.tier,
                state = state_label,
            ));
            shown += 1;
        }
    }
    if body.is_empty() {
        return String::new();
    }
    format!(
        "\n\n# Project KPIs (the outcome layer above goals)\n\nMeasurable success metrics per project. To steer an existing one, propose `calibrate_kpi` (adjust its target / due date / tier / cadence / status, or draw the warn + critical lines) or `evaluate_kpi` (measure it now). To add KPIs: `scan_kpis` proposes a batch from the context map; `propose_kpi` configures ONE specific KPI the user describes.\n\nWhen the user asks to set up / configure / add a KPI, GUIDE them: ask what they want to measure, whether higher or lower is better, a rough target, how often, and whether it's measured by hand or automatically (a repo command / a vault connector / an orchestrator metric). Then emit `propose_kpi` with what you gathered and tell them to verify it in Teams › KPIs — it lands as a proposal (the codebase measurement sets itself up in the background). A KPI going OFF TRACK is what derives goals for the team — managing KPIs is how you steer development by outcomes, not activity.{body}"
    )
}

// ─────────────────────────────────────────────────────────────────────────
// Fleet index blocks — the bounded "what exists, by id" layer
//
// Athena's ops take UUIDs (`run_persona`, `run_arena`,
// `companion_breed_personas`, `companion_evolve_persona`, `assign_team`)
// but until these blocks existed the only persona signal in the prompt was
// a names-only list in the observability digest, so she invented ids. The
// three blocks below give her a *bounded index* (name + id + one line) and
// the four `describe_*` / `list_teams` read ops give her detail on demand.
//
// Budget: the three blocks TOGETHER are capped at ~1200 tokens. The cap is
// enforced in characters (4 chars ≈ 1 token, the same rough ratio
// `recall_synthesis::estimate_recall_tokens` uses) and every block reports
// its true total, so a truncated list never reads as a complete one.
// ─────────────────────────────────────────────────────────────────────────

/// Combined token budget for the persona + context + skill index blocks.
const INDEX_TOKEN_BUDGET: usize = 1200;
/// Rough chars-per-token ratio used to turn the token budget into the byte
/// budget the formatters actually enforce.
const CHARS_PER_TOKEN: usize = 4;
/// Total characters the three blocks may occupy together.
const INDEX_CHAR_BUDGET: usize = INDEX_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Per-block split of [`INDEX_CHAR_BUDGET`]. Personas get the largest share
/// (they carry a UUID, a tier and a capability line, and they are what most
/// ops target); contexts next; skills are the leanest rows.
const PERSONA_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 5 / 12; // 2000
const CONTEXT_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 4 / 12; // 1600
const SKILL_INDEX_CHARS: usize = INDEX_CHAR_BUDGET * 3 / 12; // 1200

const _: () =
    assert!(PERSONA_INDEX_CHARS + CONTEXT_INDEX_CHARS + SKILL_INDEX_CHARS <= INDEX_CHAR_BUDGET);

/// A block being assembled under a hard character cap.
///
/// Rows are appended until the next one would push the block past
/// `cap - footer_reserve`; everything after that is dropped and the caller
/// renders a footer stating how many of the true total made it in. The
/// reserve exists so the "showing N of M" footer can never itself be the
/// thing that blows the cap — a truncated list that doesn't SAY it is
/// truncated is worse than no list at all.
struct BoundedBlock {
    out: String,
    cap: usize,
    footer_reserve: usize,
    shown: usize,
}

impl BoundedBlock {
    fn new(header: &str, cap: usize, footer_reserve: usize) -> Self {
        Self {
            out: header.to_string(),
            cap,
            footer_reserve,
            shown: 0,
        }
    }

    /// Append one row. Returns false when it did not fit (the caller stops
    /// iterating; nothing partial is ever written).
    fn push_row(&mut self, row: &str) -> bool {
        if self.out.len() + row.len() + self.footer_reserve > self.cap {
            return false;
        }
        self.out.push_str(row);
        self.shown += 1;
        true
    }

    fn finish(mut self, footer: &str) -> String {
        self.out.push_str(footer);
        self.out
    }
}

/// Collapse a description to a single short line: first paragraph, no
/// newlines, hard-truncated on a char boundary.
fn index_summary(raw: &str, max: usize) -> String {
    let line = raw
        .split(['\n', '\r'])
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or("");
    if line.chars().count() <= max {
        return line.to_string();
    }
    format!(
        "{}\u{2026}",
        crate::utils::text::truncate_on_char_boundary(line, max)
    )
}

/// Model tier label from a persona's `model_profile` JSON blob. We only
/// want the family word (`opus` / `sonnet` / `haiku`) — the full model id
/// costs tokens and tells Athena nothing extra at index level.
fn model_tier_label(model_profile: &str) -> String {
    let model = serde_json::from_str::<serde_json::Value>(model_profile)
        .ok()
        .and_then(|v| {
            v.get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_lowercase())
        })
        .unwrap_or_default();
    for family in ["opus", "sonnet", "haiku"] {
        if model.contains(family) {
            return family.to_string();
        }
    }
    if model.is_empty() {
        "default tier".to_string()
    } else {
        index_summary(&model, 24)
    }
}

/// **Authoritative persona listing for the prompt.** The observability
/// digest deliberately does NOT list persona names any more (it kept a
/// names-only "Recently active" line that had no ids, so Athena could name
/// an agent but not act on it, and two lists disagreeing about which
/// personas matter is worse than one); it now carries counts only and
/// points here.
///
/// Order: enabled first, then `updated_at DESC` — the agents the user has
/// most recently touched are the ones a turn is most likely to be about,
/// and a disabled agent is never a valid `run_persona` target.
fn format_persona_index(sys_db: &DbPool) -> String {
    let Ok(conn) = sys_db.get() else {
        return String::new();
    };
    let (total, enabled_total) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END), 0) FROM personas",
            [],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap_or((0, 0));
    if total == 0 {
        return String::new();
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, COALESCE(description, ''), COALESCE(model_profile, ''), enabled
         FROM personas
         ORDER BY enabled DESC, updated_at DESC",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, i64>(4)? != 0,
        ))
    }) else {
        return String::new();
    };

    let mut block = BoundedBlock::new(
        "\n\n# Agent roster (name → id)\n\n\
         The exact `persona_id` values `run_persona`, `run_arena`, \
         `companion_breed_personas` and `companion_evolve_persona` expect. \
         Copy an id verbatim; never invent or reshape one. Enabled agents \
         first, then most recently updated.\n\n",
        PERSONA_INDEX_CHARS,
        // Reserve for the footer below. Kept generous on purpose — the
        // footer is what makes a truncated list honest, so it must never be
        // the thing that gets squeezed out. `index_blocks_stay_under_budget`
        // fails if this drifts below the real footer length.
        240,
    );
    for row in rows.flatten() {
        let (id, name, description, model_profile, enabled) = row;
        let summary = index_summary(&description, 70);
        let summary = if summary.is_empty() {
            "no description".to_string()
        } else {
            summary
        };
        let line = format!(
            "- **{name}** `{id}` · {tier}{off} · {summary}\n",
            name = name.trim(),
            id = id,
            tier = model_tier_label(&model_profile),
            off = if enabled { "" } else { " · DISABLED" },
            summary = summary,
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} agents ({enabled_total} enabled). The \
         list is truncated for prompt budget, so absent here does NOT mean \
         absent from the app._ Look one up with the `describe_persona` read op, and \
         get team ids (never listed above) with `list_teams`.\n"
    ))
}

/// Dev contexts + their groups. These are what a context-scoped scan, a
/// KPI sweep or a dev job targets, and the id is the handle.
///
/// Order: pinned first, then `updated_at DESC` — pinning is the user's own
/// "this area matters" signal, recency is the fallback.
fn format_context_index(sys_db: &DbPool) -> String {
    let Ok(conn) = sys_db.get() else {
        return String::new();
    };
    let total = conn
        .query_row("SELECT COUNT(*) FROM dev_contexts", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0);
    if total == 0 {
        return String::new();
    }
    let group_total = conn
        .query_row("SELECT COUNT(*) FROM dev_context_groups", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0);
    let Ok(mut stmt) = conn.prepare(
        "SELECT c.id, c.name, COALESCE(c.description, ''),
                COALESCE(g.name, ''), COALESCE(p.name, '')
         FROM dev_contexts c
         LEFT JOIN dev_context_groups g ON g.id = c.group_id
         LEFT JOIN dev_projects p ON p.id = c.project_id
         ORDER BY c.pinned DESC, c.updated_at DESC",
    ) else {
        return String::new();
    };
    let Ok(rows) = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
        ))
    }) else {
        return String::new();
    };

    let mut block = BoundedBlock::new(
        "\n\n# Dev contexts (name → id)\n\n\
         Feature areas the context scan mapped, pinned first then most \
         recently scanned. Each belongs to a project and usually a group. \
         Reference one by id when you scope work to it.\n\n",
        CONTEXT_INDEX_CHARS,
        200,
    );
    for row in rows.flatten() {
        let (id, name, description, group, project) = row;
        let where_ = match (project.trim(), group.trim()) {
            ("", "") => String::new(),
            (p, "") => format!(" · {p}"),
            ("", g) => format!(" · {g}"),
            (p, g) => format!(" · {p}/{g}"),
        };
        let line = format!(
            "- **{name}** `{id}`{where_} · {summary}\n",
            name = name.trim(),
            id = id,
            where_ = where_,
            summary = index_summary(&description, 60),
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} contexts across {group_total} groups, \
         truncated for prompt budget._ Use the `describe_context` read op for \
         one context's files, keywords and group.\n"
    ))
}

/// One skill discovered on disk, in the shape both the prompt index and
/// the `describe_skill` read op need.
#[derive(Debug, Clone)]
pub(crate) struct SkillIndexEntry {
    pub name: String,
    /// `global` for `~/.claude/skills`, otherwise the dev project's name.
    pub scope: String,
    pub description: String,
    pub path: String,
}

/// Discover skills on disk: every registered dev project's
/// `<root>/.claude/skills` (bounded to the first few projects, mirroring
/// `skill_files::skills_dir`'s own candidate scan) plus the user-global
/// `~/.claude/skills`. Project skills win a name collision because they are
/// the ones a repo-scoped dispatch actually runs.
///
/// The provenance sidecar (`.skill-provenance.json`) and any other dotfile
/// are skipped, and we deliberately do NOT compute sync state here: that
/// hashes every skill directory twice, which is far too expensive for
/// something rebuilt on every chat turn.
pub(crate) fn scan_skill_index(sys_db: &DbPool) -> Vec<SkillIndexEntry> {
    use std::path::PathBuf;

    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    if let Ok(conn) = sys_db.get() {
        if let Ok(mut stmt) = conn.prepare("SELECT name, root_path FROM dev_projects LIMIT 5") {
            if let Ok(rows) =
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            {
                for (name, root) in rows.flatten() {
                    dirs.push((name, PathBuf::from(root).join(".claude").join("skills")));
                }
            }
        }
    }
    if let Some(global) = crate::commands::infrastructure::skill_files::global_skills_dir() {
        dirs.push(("global".to_string(), global));
    }

    let mut out: Vec<SkillIndexEntry> = Vec::new();
    for (scope, dir) in dirs {
        let Ok(read_dir) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            let raw_name = entry.file_name().to_string_lossy().to_string();
            if raw_name.starts_with('.') {
                continue;
            }
            let (name, md_path) = if path.is_dir() {
                let upper = path.join("SKILL.md");
                let lower = path.join("skill.md");
                let md = if upper.exists() {
                    upper
                } else if lower.exists() {
                    lower
                } else {
                    continue;
                };
                (raw_name, md)
            } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("unknown")
                    .to_string();
                (stem, path.clone())
            } else {
                continue;
            };
            if out.iter().any(|e| e.name == name) {
                continue;
            }
            let description = std::fs::read_to_string(&md_path)
                .ok()
                .as_deref()
                .and_then(crate::commands::infrastructure::skill_files::extract_skill_description)
                .unwrap_or_default();
            out.push(SkillIndexEntry {
                name,
                scope: scope.clone(),
                description,
                path: md_path.to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Skills on disk. Ordered alphabetically by name: a skill index is a
/// lookup table (Athena knows the shape of the job and needs the name), so
/// stable alphabetical beats any recency heuristic here.
fn format_skill_index(sys_db: &DbPool) -> String {
    render_skill_index(&scan_skill_index(sys_db))
}

/// Rendering half of [`format_skill_index`], split out so the budget can be
/// tested against a synthetic corpus without touching the filesystem.
fn render_skill_index(skills: &[SkillIndexEntry]) -> String {
    let total = skills.len();
    if total == 0 {
        return String::new();
    }
    let mut block = BoundedBlock::new(
        "\n\n# Skills installed on disk (name → when to use)\n\n\
         Packaged procedures a dispatched CLI session can invoke as \
         `/<name>`. Name them exactly as written; a skill not listed here \
         may still exist (see the count below) but never invent one.\n\n",
        SKILL_INDEX_CHARS,
        180,
    );
    for s in skills {
        let line = format!(
            "- **{name}** ({scope}) · {desc}\n",
            name = s.name,
            scope = s.scope,
            desc = index_summary(&s.description, 80),
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} installed skills, truncated for \
         prompt budget._ Use the `describe_skill` read op for one skill's \
         full when-to-use.\n"
    ))
}

// ─────────────────────────────────────────────────────────────────────────
// Mastermind canvas scene digest — the bounded "what does the portfolio
// look like right now" layer (WP2, 2026-08-04)
//
// The three index blocks above answer "what exists, by id". This one answers
// "what needs me". It is a TRIAGE surface, so the order is worst-first, never
// alphabetical: attention, then island state, then alerting cells, then
// blockers, then total unhealthy cells, with the slug as a stable tiebreak.
// The ordering rule itself lives on `canvas::CanvasProject::triage_key`.
//
// Budget: its OWN ~1200 tokens, deliberately not carved out of
// `INDEX_CHAR_BUDGET` — the digest and the indexes answer different questions
// and starving one to feed the other would silently truncate a list Athena is
// told is authoritative. Combined always-on structural ceiling is therefore
// ~2400 tokens.
//
// SOURCE: the canvas publishes a snapshot (see `companion::canvas` for why a
// Rust re-derive is the wrong shape). No snapshot published yet means NO
// BLOCK: a user who never opens Mastermind pays nothing for it.
// ─────────────────────────────────────────────────────────────────────────

/// Token budget for the scene digest, independent of [`INDEX_TOKEN_BUDGET`].
const SCENE_TOKEN_BUDGET: usize = 1200;
/// Characters the digest may occupy.
const SCENE_CHAR_BUDGET: usize = SCENE_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Held back for the footer, which carries the true project count and the
/// data-family caveats. Generous on purpose: same rule as the index blocks,
/// a truncated triage list that does not SAY it is truncated is worse than none.
const SCENE_FOOTER_RESERVE: usize = 420;
/// Unhealthy cells named per project row. Beyond this the row says how many
/// more there are rather than spending the whole budget on one bad project.
const SCENE_CELLS_PER_ROW: usize = 6;

const _: () = assert!(SCENE_FOOTER_RESERVE < SCENE_CHAR_BUDGET);

/// The Mastermind canvas, worst-first. See the block comment above.
fn format_scene_digest(sys_db: &DbPool) -> String {
    let Some(scene) = crate::companion::canvas::load_scene(sys_db) else {
        return String::new();
    };
    render_scene_digest(&scene)
}

/// Rendering half of [`format_scene_digest`], split out so the budget can be
/// tested against a synthetic 50-project scene without touching the DB.
fn render_scene_digest(scene: &crate::companion::canvas::CanvasScene) -> String {
    let triaged = scene.triaged();
    let total = triaged.len();
    let caveats = crate::companion::canvas::scene_caveats(scene);
    if total == 0 {
        return format!(
            "\n\n# Mastermind canvas\n\nThe canvas has no projects on it. _{caveats}._\n"
        );
    }
    let mut block = BoundedBlock::new(
        "\n\n# Mastermind canvas (worst first)\n\n\
         The user's project portfolio as the canvas derived it, ordered by what \
         needs attention: live blocked sessions first, then island state, then \
         alerting cells, then blockers. Only cells that are NOT fine are listed. \
         Reference a project by the exact slug shown; never invent one.\n\n",
        SCENE_CHAR_BUDGET,
        SCENE_FOOTER_RESERVE,
    );
    for p in &triaged {
        let unhealthy = p.unhealthy_cells();
        let named: Vec<String> = unhealthy
            .iter()
            .take(SCENE_CELLS_PER_ROW)
            .map(|c| index_summary(c, 46))
            .collect();
        let more = unhealthy.len().saturating_sub(named.len());
        let cells = if named.is_empty() {
            "all cells fine".to_string()
        } else {
            format!(
                "{}{}",
                named.join(", "),
                if more > 0 {
                    format!(", +{more} more")
                } else {
                    String::new()
                }
            )
        };
        let line = format!(
            "- **{name}** `{slug}` · {state}{attention}{blockers}{fleet} · {cells}\n",
            name = index_summary(&p.name, 40),
            slug = p.slug,
            state = p.state,
            attention = if p.attention { " · NEEDS YOU" } else { "" },
            blockers = if p.blockers > 0 {
                format!(" · {} blockers", p.blockers)
            } else {
                String::new()
            },
            fleet = if p.fleet > 0 {
                format!(" · {} live sessions", p.fleet)
            } else {
                String::new()
            },
            cells = cells,
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} projects, worst first, truncated for \
         prompt budget. {caveats}._ Use the `describe_canvas_project` read op \
         for one island's full fifteen cells, and `describe_canvas_freshness` \
         for scan ages, ongoing goals and KPI standing. To act: \
         `canvas_dispatch` (one project), `canvas_group_dispatch` (several, run \
         one after another), `canvas_run_idea_scan`. To show structured \
         findings about one project, `compose_canvas_panel` docks a \
         SurfaceSpec v1 panel beside its island.\n"
    ))
}

/// Daily-goals ritual awareness (dev builds only — the feature's UI is
/// gated on `dev_mode_available`). A few lines: active set + streak, and
/// the hard rule that evaluation is the operator's alone. Empty outside
/// debug builds and when there is nothing to say.
fn daily_goals_addendum(user_db: &crate::db::UserDbPool) -> String {
    if !cfg!(debug_assertions) {
        return String::new();
    }
    crate::companion::brain::daily_goals::prompt_addendum(user_db)
}

/// Reply-language directive for non-English UIs.
///
/// Reads the `app_language` mirror (written through from the frontend i18n
/// store — see `src/stores/i18nStore.ts`). Before this directive existed the
/// reply language depended entirely on the model inferring it from the user's
/// message, which holds for direct chat but degrades once English tool
/// results / system context get woven into a turn (2026-07-16 UAT
/// F-MAJOR-9). English or unset → empty (default behavior needs no rule).
fn language_addendum(sys_db: &DbPool) -> String {
    let lang = crate::db::repos::core::settings::get(sys_db, crate::db::settings_keys::APP_LANGUAGE)
        .ok()
        .flatten()
        .unwrap_or_default();
    let lang = lang.trim().to_string();
    if lang.is_empty() || lang == "en" {
        return String::new();
    }
    format!(
        "\n\n# Reply language\n\nThe app UI language is `{lang}`. Reply in that language by default — \
         including after tool results or system context arrive in English — unless the user \
         writes to you in a different language (then mirror the user's language).\n"
    )
}

fn format_goals(goals: &[Goal]) -> String {
    if goals.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Active goals (what the user said they're working toward)\n\n");
    for g in goals {
        let target = g
            .target_date
            .as_deref()
            .map(|d| format!(" · target {d}"))
            .unwrap_or_default();
        s.push_str(&format!(
            "- **{title}** (priority {p}{target}) — {desc}\n",
            title = g.title.trim(),
            p = g.priority,
            target = target,
            desc = first_paragraph(&g.description, 240)
        ));
    }
    s
}

/// Procedural rules — durable behaviors. Render with the trigger as the
/// "when" and behavior as the "do". Sources cite back to the episodes
/// where the rule was confirmed.
fn format_procedurals(rules: &[Procedural]) -> String {
    if rules.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Procedural rules (how to behave — every rule is cited)\n\n");
    let mut last_scope: Option<&str> = None;
    let mut sorted: Vec<&Procedural> = rules.iter().collect();
    sorted.sort_by(|a, b| {
        a.scope
            .cmp(&b.scope)
            .then(b.importance.cmp(&a.importance))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    for r in sorted {
        if last_scope != Some(r.scope.as_str()) {
            s.push_str(&format!("## {} rules\n\n", r.scope));
            last_scope = Some(r.scope.as_str());
        }
        let sources = if r.sources.is_empty() {
            "no-sources".into()
        } else {
            r.sources.join(", ")
        };
        s.push_str(&format!(
            "- **When:** {trigger}  \n  **Then:** {behavior}  \n  _(imp {imp}, conf {conf:.0}%, from {srcs})_\n\n",
            trigger = r.trigger.trim(),
            behavior = first_paragraph(&r.behavior, 240),
            imp = r.importance,
            conf = r.confidence * 100.0,
            srcs = sources
        ));
    }
    s
}

/// Open backlog — what Athena has committed to do, plus capability
/// gaps she's flagged. The user shouldn't have to remind her.
fn format_backlog(items: &[BacklogItem]) -> String {
    if items.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Open backlog (your commitments + flagged capability gaps)\n\n");
    let (promises, gaps): (Vec<&BacklogItem>, Vec<&BacklogItem>) =
        items.iter().partition(|i| i.kind == "self_promise");
    if !promises.is_empty() {
        s.push_str("## Self-promises\n\n");
        for p in promises {
            let src = p
                .source_episode_id
                .as_deref()
                .map(|x| format!(" [from {x}]"))
                .unwrap_or_default();
            s.push_str(&format!("- {summary}{src}\n", summary = p.summary.trim()));
        }
        s.push('\n');
    }
    if !gaps.is_empty() {
        s.push_str("## Capability gaps\n\n");
        for g in gaps {
            s.push_str(&format!("- {summary}\n", summary = g.summary.trim()));
        }
    }
    s
}

fn first_paragraph(s: &str, max_len: usize) -> String {
    let firstline = s.lines().next().unwrap_or("").trim();
    if firstline.len() <= max_len {
        firstline.to_string()
    } else {
        format!(
            "{}…",
            crate::utils::text::truncate_on_char_boundary(firstline, max_len)
        )
    }
}

fn format_doctrine(doctrine: &[DoctrineHit]) -> String {
    if doctrine.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Reference — Personas docs (cite by path when you draw on these)\n\n");
    for d in doctrine {
        s.push_str(&format!("## From `{}`\n\n{}\n\n", d.file_path, d.content));
    }
    s
}

/// Render the "Plugins enabled" block. Each enabled plugin gets its
/// own awareness section so Athena knows what she can lean on. Plugins
/// are *internal* app capabilities — separate from connectors which
/// are external credentials. Empty when no plugins are toggled on.
///
/// `projects` is forwarded into the dev_tools block so Athena always
/// sees the live project registry (with their scan status) — passed
/// in rather than read here so the function stays sync + testable.
///
/// `tracking_pulses` carries today's per-project pulse blocks
/// (rendered Markdown). Empty unless the project_tracking master
/// toggle is on AND `dev_tools` is among `enabled`. Phase 5 wires
/// this; before then it's always empty.
fn format_plugins(
    enabled: &[String],
    projects: &[crate::companion::projects::KnownProject],
    tracking_pulses: &str,
) -> String {
    if enabled.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Plugins enabled (capabilities the user has turned on for you)\n\n");
    for name in enabled {
        match name.as_str() {
            "dev_tools" => {
                s.push_str(
                    "## Dev Tools\n\n\
                     The user has the **Dev Tools plugin** enabled. They want you to lead \
                     the product-development lifecycle of their projects.\n\n\
                     ### Registered projects\n\n",
                );
                if projects.is_empty() {
                    s.push_str(
                        "_No projects registered yet._ If they ask you about a project, \
                         offer to register it with `register_project` (you need a \
                         filesystem path + a short name). Registering also creates the \
                         Dev Tools project + codebase connector and kicks off a context \
                         scan, so a team can be adopted for that repo right after.\n\n",
                    );
                } else {
                    for p in projects {
                        let scan_line = match (&p.last_scan_at, &p.last_scan_summary) {
                            (Some(at), Some(summary)) => {
                                format!(" · last scanned {at}: {summary}")
                            }
                            _ => " · **never scanned**".into(),
                        };
                        s.push_str(&format!(
                            "- **{name}** (`{id}`) — `{path}`{scan}\n",
                            name = p.name,
                            id = p.id,
                            path = p.path,
                            scan = scan_line,
                        ));
                    }
                    s.push('\n');
                }

                if !tracking_pulses.is_empty() {
                    s.push_str("### Today's project pulses\n\n");
                    s.push_str(tracking_pulses);
                    s.push_str(
                        "\n_These pulses are produced once an hour by the project-tracking \
                         consolidator (Sonnet 4.6) over git commits and the active-runs \
                         ledger. When the user asks 'what's happening on X' or 'what's drifting', \
                         lean on these directions and tensions; cite specifics, don't invent. \
                         For deeper drill-in (recent commits behind a direction), say so and \
                         offer to dig — don't fabricate hashes._\n\n",
                    );
                }

                s.push_str(
                    "### Available actions\n\n\
                     **Long-running scans run as background jobs** — you don't block the \
                     chat waiting for them. The worker picks queued jobs up within a few \
                     seconds, runs them, and appends a system episode with the result so \
                     you see it on your next turn. Tell the user that explicitly when you \
                     enqueue (\"I started the scan, will report back; what else?\").\n\n\
                     1. **Set up a project** — `register_project` with `name`, `path`, \
                        optional `description`. Idempotent on path. This creates the real \
                        Dev Tools project (a `dev_projects` row), which is what makes the \
                        **codebase connector** available to any team adopted for that repo, \
                        AND auto-starts a full context scan (Claude maps its structure in \
                        the background). One action = repo ready for a team. To set up \
                        several repos, call it once per path.\n\
                     2. **Scan / re-scan a project (context map)** — `enqueue_dev_job` with \
                        `kind: \"scan_codebase\"` and `project_id` (or `params.path` / \
                        `params.project_name`). This runs the REAL context scan: Claude maps \
                        the repo into business-domain groups + per-feature contexts \
                        (dev_context_groups / dev_contexts). Use it whenever the user says \
                        \"scan\", \"context scan\", \"map\", \"index\", or \"analyze the \
                        codebase\" — for a fresh repo OR to refresh one whose code changed.\n\
                     3. **Capture decisions** — `write_goal`, `write_backlog_item`, \
                        `write_fact` ops let the lifecycle have memory.\n\n\
                     ### CRITICAL — scan ≠ build an agent\n\n\
                     \"Scan / context-scan / map / index / analyze the codebase\" is a \
                     **context scan** (action #2 above) — it reads code structure and changes \
                     NOTHING. Do NOT respond to a scan request with `build_oneshot`, \
                     `prefill_persona_create`, or by proposing a new reviewer/triage agent. \
                     `build_oneshot` is ONLY for an explicit \"build / create / spin up an \
                     agent (or team) that …\" request. If the user asks to scan a repo \"for \
                     bugs and tests\", that is STILL a context scan (action #2) — the existing \
                     SDLC team's Code Reviewer / QA handles bug-and-test review, so mention \
                     that team rather than building a new agent.\n\n\
                     ### When to lean on this\n\n\
                     He's asking \"what should I work on next?\", \"what's stale?\", \
                     \"give me ideas\", \"how are things?\", or \"scan codebase\" / \
                     \"check projects\". Read the room; don't dump all flows. If he asks \
                     about a project that's never been scanned (look at the registry above \
                     — `never scanned`), proactively offer to enqueue a scan instead of \
                     saying you can't see it.\n\n\
                     ### Direct read paths (no ops)\n\n\
                     - **Doctrine block above** — you can already cite `features/personas/`, \
                       `features/execution/`, etc. for how the Personas app works.\n\
                     - **Observability digest above** — agent health, recent failures, \
                       open Human Reviews. Cite specifics; don't invent counts.\n\n",
                );
            }
            other => {
                // Forward-compat: an unknown plugin slug shouldn't break
                // the prompt. Surface it minimally so the user sees it's
                // pinned, even if Athena can't yet act on it.
                s.push_str(&format!(
                    "## `{other}`\n\nThis plugin is enabled but its awareness block \
                     hasn't been wired yet — mention it if asked, otherwise ignore.\n\n",
                ));
            }
        }
    }
    s
}

/// Render the "Connector tools" block with concrete capabilities per
/// pinned connector. Empty when no pinned connectors are enabled.
/// For each enabled connector with a registered capability set, list
/// what Athena can actually do; for connectors without a registry
/// entry, surface the name + flag the wiring as in flight so she's
/// honest rather than inventing a method.
fn format_connectors(names: &[String]) -> String {
    if names.is_empty() {
        return String::new();
    }
    let mut s =
        String::from("\n\n# Connector tools (the user has pinned these in your sidebar)\n\n");
    s.push_str(
        "Each entry below is *active* — the user enabled it and you can \
         act on it via the `use_connector` op. Capabilities are \
         intent-shaped: emit the slug and args; the executor handles \
         the API call.\n\n\
         Format:\n\n\
         ```\n\
         OP: {\"op\": \"propose_action\", \"action\": \"use_connector\", \"params\": \
         {\"connector_name\": \"<slug>\", \"capability\": \"<capability_slug>\", \
         \"args\": {<arg_name>: <value>, ...}}, \"rationale\": \"<why now>\"}\n\
         ```\n\n\
         **`use_connector` auto-fires** — no approval card, no \
         click. The call goes straight to the background-job worker, \
         runs, and the result lands as a system episode you'll see on \
         your next turn. Set expectations in your reply (\"I'm pulling \
         the latest issues — back in a moment\") rather than waiting \
         for confirmation. Quote slugs exactly; the dispatcher rejects \
         hallucinated ones with a warning that surfaces in your next \
         turn's context.\n\n",
    );
    for n in names {
        match crate::companion::connectors::capabilities_for(n) {
            Some(caps) => {
                s.push_str(&format!("## `{n}`\n\n"));
                for c in caps {
                    s.push_str(&format!(
                        "- **{slug}** — {desc}  \n  _args: {args}_\n",
                        slug = c.slug,
                        desc = c.description,
                        args = c.args
                    ));
                }
                s.push('\n');
            }
            None => {
                s.push_str(&format!(
                    "## `{n}`\n\n\
                     Pinned but its capability set isn't registered yet. \
                     Acknowledge it (\"you have `{n}` attached\") but don't \
                     propose a `use_connector` call — wiring is in flight.\n\n",
                ));
            }
        }
    }
    s
}

// ── Per-block size ledger ───────────────────────────────────────────────
//
// Prompt assembly had zero size accounting until 2026-08. The dev-mode
// context index silently grew to ~30.6KB injected on EVERY turn and was
// caught by accident (rolled up to group level in 12651a18c). A block that
// grows without anyone noticing is a permanent, invisible tax on every
// Athena turn, so compose() now reports what each named block cost and
// warns when one breaches its budget.

/// Char budget per named block. Deliberately generous — this is a tripwire
/// for silent growth, not a cap: a breach emits one `tracing::warn!` and
/// changes nothing about the prompt. `mode_addenda` carries the dev-mode
/// self-model (the block that hosted the 30KB incident), which is why its
/// budget is the tightest of the large slots.
const BLOCK_BUDGETS: &[(&str, usize)] = &[
    ("constitution", 24_000),
    ("identity", 16_000),
    ("observability", 48_000),
    ("recall", 40_000),
    ("briefing", 16_000),
    ("plugins", 16_000),
    ("connectors", 12_000),
    ("onboarding", 8_000),
    ("voice", 8_000),
    ("display", 4_000),
    ("mode_addenda", 12_000),
    ("static_addenda", 8_000),
];

fn budget_for(block: &str) -> Option<usize> {
    BLOCK_BUDGETS
        .iter()
        .find(|(name, _)| *name == block)
        .map(|(_, max)| *max)
}

/// Per-block char counts for one composed system prompt.
///
/// `total` is the real `composed.len()`, so it is slightly larger than the
/// sum of the blocks — the difference is compose()'s own fixed scaffolding
/// (the `# Identity (live, evolves)` heading and friends), a couple of
/// dozen chars that would only add noise as its own bucket.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PromptBlockSizes {
    blocks: Vec<(&'static str, usize)>,
    total: usize,
}

impl PromptBlockSizes {
    /// Total chars of the composed prompt.
    pub fn total(&self) -> usize {
        self.total
    }

    /// `{"constitution": 5123, "identity": 812, …}` for the turn-ledger row.
    /// `None` only if serialization somehow fails — the caller stores NULL.
    pub fn to_json(&self) -> Option<String> {
        let map: serde_json::Map<String, serde_json::Value> = self
            .blocks
            .iter()
            .map(|(name, len)| ((*name).to_string(), serde_json::json!(*len)))
            .collect();
        serde_json::to_string(&map).ok()
    }

    /// One `warn!` per over-budget block, at most once per turn (the caller
    /// invokes this exactly once, right after composing).
    pub fn warn_over_budget(&self) {
        for (name, len) in &self.blocks {
            if let Some(max) = budget_for(name) {
                if *len > max {
                    tracing::warn!(
                        block = *name,
                        chars = *len,
                        budget = max,
                        total_prompt_chars = self.total,
                        "companion prompt: block over budget"
                    );
                }
            }
        }
    }
}

fn compose(
    constitution: &str,
    identity: &str,
    observability_md: &str,
    recall: &Recall,
    briefing: Option<&Briefing>,
    plugins_md: &str,
    connectors_md: &str,
    onboarding_md: &str,
    voice_md: &str,
    display_md: &str,
    autonomous_md: &str,
) -> (String, PromptBlockSizes) {
    // When a synthesized briefing is present, it replaces the raw memory
    // sections (facts/goals/procedurals/episodes/backlog/doctrine) — the
    // synthesis prompt fed Claude all of those, so the briefing is the
    // condensed projection. Doctrine is included in the synthesis input,
    // so we don't render it raw alongside the briefing either.
    let synthesized = briefing.map(recall_synthesis_format);

    let episodes_md = if synthesized.is_some() {
        String::new()
    } else {
        format_episodes(&recall.episodes)
    };
    let doctrine_md = if synthesized.is_some() {
        String::new()
    } else {
        format_doctrine(&recall.doctrine)
    };
    let facts_md = if synthesized.is_some() {
        String::new()
    } else {
        format_facts(&recall.facts)
    };
    let goals_md = if synthesized.is_some() {
        String::new()
    } else {
        format_goals(&recall.goals)
    };
    let procedurals_md = if synthesized.is_some() {
        String::new()
    } else {
        format_procedurals(&recall.procedurals)
    };
    let backlog_md = if synthesized.is_some() {
        String::new()
    } else {
        format_backlog(&recall.backlog)
    };
    let synth_md = synthesized.unwrap_or_default();

    let mut out = String::with_capacity(
        constitution.len()
            + identity.len()
            + observability_md.len()
            + episodes_md.len()
            + doctrine_md.len()
            + facts_md.len()
            + goals_md.len()
            + procedurals_md.len()
            + backlog_md.len()
            + synth_md.len()
            + onboarding_md.len()
            + voice_md.len()
            + display_md.len()
            + autonomous_md.len()
            + 256,
    );
    out.push_str(constitution);
    if !identity.is_empty() {
        out.push_str("\n\n# Identity (live, evolves)\n\n");
        out.push_str(identity);
    }
    // Synthesized briefing (when present) sits just below identity — same
    // slot the raw facts block would occupy. It's the projection of facts
    // + goals + procedurals + episodes + backlog + doctrine for this turn.
    out.push_str(&synth_md);
    // Facts sit just below identity — enduring knowledge about *who*.
    // Goals + procedurals follow: who he's trying to be (goals) and
    // how she's agreed to behave (procedurals). All three are stable
    // context that should color every response, not retrieval-of-the-day.
    out.push_str(&facts_md);
    out.push_str(&goals_md);
    out.push_str(&procedurals_md);
    out.push_str(observability_md);
    out.push_str(&episodes_md);
    // Backlog sits near episodes — the open commitments are conversational,
    // tied to specific past turns; this is where Athena scans for "did I
    // promise to follow up on something?"
    out.push_str(&backlog_md);
    out.push_str(&doctrine_md);
    // Plugins block: capabilities the user has toggled on for Athena
    // (currently just dev_tools). Sits between doctrine and connectors
    // because plugins are *internal* app capabilities — closer to
    // Athena's own toolkit than to external services.
    out.push_str(plugins_md);
    // Connectors block: which third-party tools the user has pinned
    // into the chat surface. Athena uses this to mention what she has
    // access to ("you have GitHub attached — want me to look at recent
    // commits?"). Empty string when none are pinned, so this adds zero
    // tokens to the typical prompt.
    out.push_str(connectors_md);
    // Onboarding sits at the very end so its instructions are the last
    // thing Athena reads before forming a reply — most recency-weighted.
    out.push_str(onboarding_md);
    // Voice addendum: only included when the user has voice playback on.
    out.push_str(voice_md);
    // Dual-language addendum: paired with voice — instructs Athena to
    // write the *visual* reply as a tighter, button-shaped index when
    // the user is also listening. Voice off ⇒ empty string ⇒ default
    // prose register.
    out.push_str(display_md);
    // Tools addendum: always on. Tells Athena she has WebSearch /
    // WebFetch via Claude Code so she stops guessing at time-sensitive
    // facts. Sits at the end (recency-weighted) but after onboarding +
    // voice because those are turn-shape, this is tool-shape.
    out.push_str(tools_addendum());
    // Delegate-don't-inline doctrine: always on. Pairs with the
    // non-blocking composer + activity tray — tells Athena to kick long
    // work off as a background task and reply immediately rather than
    // holding a silent turn open.
    out.push_str(delegation_addendum());
    // Autonomous-mode addendum: only when the header toggle is on.
    // Sits last so its instructions are the most recency-weighted —
    // the autonomous loop is the most important behavioral
    // modification of the turn.
    out.push_str(autonomous_md);

    // Instrumentation only — every count is read off the exact strings that
    // were just pushed, so this cannot change a single byte of `out`.
    let sizes = PromptBlockSizes {
        blocks: vec![
            ("constitution", constitution.len()),
            ("identity", identity.len()),
            ("observability", observability_md.len()),
            (
                "recall",
                episodes_md.len()
                    + doctrine_md.len()
                    + facts_md.len()
                    + goals_md.len()
                    + procedurals_md.len()
                    + backlog_md.len(),
            ),
            ("briefing", synth_md.len()),
            ("plugins", plugins_md.len()),
            ("connectors", connectors_md.len()),
            ("onboarding", onboarding_md.len()),
            ("voice", voice_md.len()),
            ("display", display_md.len()),
            ("mode_addenda", autonomous_md.len()),
            (
                "static_addenda",
                tools_addendum().len() + delegation_addendum().len(),
            ),
        ],
        total: out.len(),
    };
    (out, sizes)
}

fn recall_synthesis_format(b: &Briefing) -> String {
    crate::companion::brain::recall_synthesis::format_briefing_section(b)
}

/// Render today's project_tracking pulses as a Markdown block. Returns
/// empty when:
/// - `dev_tools` plugin is not in the enabled set (the user hasn't
///   asked Athena to lead lifecycle), OR
/// - no enabled subscriptions have a pulse for today.
///
/// Each project gets: name + narrative paragraph + 3-5 directions +
/// 0-3 tensions. Per the locked design decision (Phase 5 token budget),
/// soft cap at 5 projects — beyond that, summarize the tail to one
/// line each.
fn format_project_tracking_pulses(user_db: &UserDbPool, plugin_names: &[String]) -> String {
    if !plugin_names.iter().any(|n| n == "dev_tools") {
        return String::new();
    }

    let subs = match crate::engine::project_tracking::subscription::list_enabled(user_db) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "project_tracking: list_enabled failed for prompt");
            return String::new();
        }
    };
    if subs.is_empty() {
        return String::new();
    }

    let mut blocks: Vec<(String, crate::engine::project_tracking::pulse::PulseRow)> = Vec::new();
    for sub in &subs {
        match crate::engine::project_tracking::pulse::load_today(user_db, &sub.project_id) {
            Ok(Some(pulse_row)) => {
                let project_name = sub
                    .project_path
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(&sub.project_path)
                    .to_string();
                blocks.push((project_name, pulse_row));
            }
            Ok(None) => {} // no pulse for today yet
            Err(e) => {
                tracing::warn!(
                    project_id = %sub.project_id,
                    error = %e,
                    "project_tracking: pulse load failed for prompt",
                );
            }
        }
    }

    if blocks.is_empty() {
        return String::new();
    }

    let mut out = String::new();
    let cap = 5usize;
    for (project_name, pulse_row) in blocks.iter().take(cap) {
        out.push_str(
            &crate::engine::project_tracking::consolidator::render_for_prompt(
                pulse_row,
                project_name,
            ),
        );
        out.push('\n');
    }
    if blocks.len() > cap {
        out.push_str(&format!(
            "_…and {} more tracked project(s) — ask for them by name._\n\n",
            blocks.len() - cap
        ));
    }
    out
}

/// Voice addendum: only when the user toggled voice playback on. Tells
/// Athena to emit a TTS line in addition to her normal markdown reply.
/// Skipped entirely when voice is off so we don't waste tokens or
/// confuse Athena with capabilities she shouldn't use.
/// Autonomous-mode addendum — only emitted when the header toggle is
/// on. Tells Athena she's allowed to chain turns by emitting
/// `OP: continue_autonomously` and how to use her subagent toolbox.
/// When the toggle is off this returns `""` and Athena's behavior
/// reverts to the single-turn assistant.
fn autonomous_addendum_if_enabled(autonomous_mode: bool) -> String {
    if !autonomous_mode {
        return String::new();
    }
    String::from(
        r#"

# AUTONOMOUS MODE — you may continue working between user turns

The user enabled autonomous mode in the chat header. You're free to
take more turns *without waiting for them* whenever a task you've
started isn't finished yet.

## The continuation primitive

End any turn with the line below to receive another turn (after a
short delay) to keep working:

    OP: {"op": "propose_action", "action": "continue_autonomously", "params": {"rationale": "<one short sentence: why you're not done yet>"}}

The system schedules the next tick ~15 seconds after the current
turn finishes. If the user sends any message in the meantime, the
scheduled tick is dropped and their message takes priority — your
chain is paused gracefully without anything being killed.

Hard ceiling: up to 20 consecutive autonomous turns per chain.
Beyond that the system stops re-firing until the user sends a fresh
message. Aim well below that — if you can't finish in 3-5 ticks,
you're probably in a loop and should stop, summarize where you
landed, and wait for the user.

## When to chain vs stop

**Chain (emit the op)** when:
- You ran a tool/connector and the result needs analysis
- You proposed a sub-task to a subagent and want to read its result
- You wrote partial progress to memory and need another pass
- You're researching with WebSearch and the picture isn't complete

**Stop (just don't emit the op)** when:
- You finished the user's request
- You're waiting for the user to decide between options
- You're blocked on something only the user can resolve
- You'd be repeating yourself — diminishing returns

## Subagent orchestration (Claude Code's `Agent` tool)

You can dispatch parallel work to specialized subagents within a
single turn. The Personas project ships these in `.claude/agents/`:

- **`athena-persona-auditor`** — read a persona's recent runs +
  artifacts, identify failure patterns, return a 1-page summary.
  Use when the user (or you) want to understand why a persona
  produces what it does.
- **`athena-backlog-scout`** — scan recent execution artifacts +
  memory for things worth tracking as backlog items. Returns a
  ranked list. Use during idle autonomous ticks when there's no
  open task — generates the proactive ideas the user enabled
  autonomous mode for.
- **`athena-doc-reader`** — pull doctrine/codebase context for a
  question without polluting your own context with full file
  reads. Returns a focused excerpt.
- **`athena-web-researcher`** — WebSearch + WebFetch heavy for
  current-events / library-docs queries. Returns a synthesis.

Spawn them in one assistant turn with the `Agent` tool. You can
spawn multiple in parallel — they run concurrently in separate
context windows and return summaries you synthesize. Subagents do
not outlive their spawn turn; they're a within-turn primitive.

## Visual discipline during chains

Each autonomous tick still produces a chat bubble — the user sees
your work in real time. Two rules:

1. **Don't spam.** If a tick made marginal progress, a one-liner
   is fine. The user will see 20 bubbles otherwise.
2. **Surface decisions, not deliberation.** Use chat cards
   (`show_persona_overview`, etc.) and cockpit composition when
   the work has a visual that beats prose.
"#,
    )
}

/// Static directive: Athena runs inside Claude Code with built-in
/// tools (WebSearch, file reads, etc.). The default Claude Code
/// system prompt is *replaced* by ours via `--system-prompt-file`, so
/// without this block she has no idea those tools exist and will
/// hallucinate around current-events questions. Always emitted — the
/// tools are stable per session and the prompt-token cost is tiny.
fn tools_addendum() -> &'static str {
    r#"

# YOU HAVE TOOLS — use them when the answer needs them

You're running inside Claude Code, which gives you a small toolbox
that runs *before* your reply is formed. They're free to call; the
user expects you to reach for them when the question needs fresh
data or specific facts you don't already have.

**WebSearch** — search the live web. Use it when:
- The user asks about anything *after January 2026* (your training
  cutoff) — current events, recent releases, breaking news.
- The user mentions a specific library / API / framework and wants
  current syntax, version, or behavior. Don't guess from training
  data when a search would settle it.
- The user references a public person, company, or product the
  context didn't already establish.

**WebFetch** — pull and read a specific URL the user gave you.

Do NOT use search for:
- Anything about Personas Desktop itself (you have doctrine for that).
- Anything about the user's own data (you have facts, episodes,
  identity for that).
- Generic engineering questions you can already answer well.

When you use a tool, weave the result into your reply naturally;
cite the source URL inline so the user can verify ("According to
sentry.io's docs at <url>, ...").

These tools run within the same turn as your reply — the user sees
your single bubble, not the intermediate tool calls.
"#
}

/// "Delegate, don't inline" doctrine — always on. The companion chat is
/// non-blocking: the user can send new messages while a turn or a
/// background task is still running, and in-flight tasks are shown in an
/// activity tray + as dots on the orb. This addendum tells Athena to lean
/// on that — kick long work off as a background task and reply *now*,
/// rather than holding a silent turn open for minutes.
fn delegation_addendum() -> &'static str {
    r#"

# Stay responsive — delegate long work, don't inline it

The chat is non-blocking: the user can keep talking while work runs, and
anything you kick off shows up in their activity tray (and as dots on
your orb) until it finishes. Use that.

- **Reply in seconds, not minutes.** If a request needs work that will
  take more than a few seconds — a connector call, a codebase scan,
  generating a batch of ideas, any multi-step job — delegate it (emit the
  op so it runs as a background task) and answer *immediately*: say what
  you kicked off and that you'll report back when it lands. Don't hold the
  turn open and silent waiting for it.
- **The result comes back on its own.** Background tasks finish into a
  system episode you'll see on a later turn, and their tag flips to done
  in the tray — you don't need to block to collect the result.
- **Inline only what's already fast.** If you already know the answer, or
  a single quick tool call settles it within the turn, just answer. The
  point isn't to defer everything — it's to never leave the user staring
  at a frozen, silent turn while something slow runs.
- **A slow correct answer is still a failure.** Minutes of dead air for
  work you could have delegated is worse than delegating and being brief —
  don't grind through scans, counts, or compilations yourself when a task
  op exists for them.
- **If the user redirects you mid-task** ("stop", "actually, do X
  instead"), treat their new message as the priority; the prior task can
  be abandoned or will surface its partial result on its own.
"#
}

/// Dual-language directive — only emitted when voice playback is on.
///
/// When the user is *listening* to the spoken summary, the chat-bubble
/// text should not duplicate the same prose visually. Instead, it
/// becomes a skimmable index: short labels, bullets, and one or two
/// QR chips the user can tap without re-reading the answer they just
/// heard. The TTS line owns the nuance; the visual owns the next
/// click.
///
/// When voice is OFF, this returns "" — the visual reply stays in
/// Athena's default register (full prose, headings, citations).
fn display_addendum_if_voice_active(voice_enabled: bool) -> String {
    if !voice_enabled {
        return String::new();
    }
    String::from(
        r#"

# DUAL-LANGUAGE — visual reply when voice is on

The user is listening to your spoken summary right now. Don't make
them read the same thing twice. Treat the chat bubble as a *control
panel* for what they just heard, not a transcript:

- Lead with one short headline sentence — the same one your TTS line
  opens with. The bubble is the index card on top of the audio.
- Keep prose to a minimum. Where you'd normally write a paragraph of
  exposition, replace it with two or three bullets, or skip it
  entirely. The voice already said it.
- Lean on QR chips. If the spoken summary offers two choices, those
  same two choices belong in `QR:` as tappable next actions. Aim for
  2–4 chips; you can offer up to 5 when the branch space is real.
- Use headings sparingly — at most one H2 per reply, only when the
  bubble has clearly separate sections.
- No long code blocks; quote at most one short line. Bullet lists of
  identifiers (filenames, ids) are fine — they're scannable.
- Preserve all `OP:` and `propose_action` lines exactly. Auto-fire
  ops and approval cards are how Athena acts; they don't change just
  because the user is listening.
- Citations (`[memory:...]`, `[doctrine:...]`) still go in the visual
  reply — voice elides them, the user wants to see the source.

When voice is OFF the bubble goes back to its normal register —
full prose, headings, longer answers when warranted. Read the user's
current mode and write accordingly.
"#,
    )
}

fn voice_addendum_if_needed(voice_enabled: bool) -> String {
    if !voice_enabled {
        return String::new();
    }
    String::from(
        r#"

# VOICE PLAYBACK — emit a TTS line this turn

Voice playback is on. Alongside your normal markdown reply, emit one
line that's safe to speak aloud — suitable for ElevenLabs synthesis.

Format (exactly one line, anywhere in the reply):

    TTS: "Two lab agents are failing. Want me to walk you through them?"

Discipline:

- Spoken text is a *different rendering* of the same content, not a
  transcription. Bullet lists, headings, code blocks, file paths,
  citations — none of them sound right read aloud.
- 1–3 sentences total. Headlines, not the full reply.
- First-person, conversational, no preamble. ("I see two failures, both
  in the lab — let me know if you want to dig in.")
- Plain English. No markdown, no parens, no lists, no code-style names.
  If you'd say "see ``persona-capabilities/00-vision.md``" in writing,
  speak it as "the vision doc."
- Never read out IDs, paths, or hashes verbatim — describe instead.
- Match the visual reply's tone but trim ruthlessly — if the written
  answer is one sentence, the spoken version is the same sentence
  cleaned of any formatting cruft.
- If the visual reply is purely a question or a chip-prompt, the TTS
  line can mirror it verbatim.
- One TTS line per turn. Don't emit if the visual reply has no
  meaningful spoken summary (rare; most replies do).
- Your `PROGRESS:` beats (see their own section) are separate from this
  single closing `TTS:` line — beats are in-progress narration, `TTS:`
  is the spoken version of the final reply.
"#,
    )
}

/// Always-on narration grammar. Unlike the TTS line (which only makes
/// sense when a voice engine will speak it), `PROGRESS:` beats feed the
/// *visual* narration timeline in the chat panel for every user — voice
/// merely adds spoken playback on top. This addendum is therefore
/// appended unconditionally (user, autonomous, and proactive turns
/// alike); earlier versions taught it inside the voice addendum, which
/// silently disabled narration for text-only users and for proactive
/// turns (spawned with voice off).
fn progress_addendum() -> String {
    String::from(
        r#"

# PROGRESS — talk to the user as you work (don't go silent)

When a turn takes more than a moment — web searches, several tool calls,
scanning a codebase, building something — DON'T work in silence and then
drop one wall of text. Talk to the user as you go, the way you would out
loud if they were sitting next to you. Emit short conversational lines,
one per line, each prefixed `PROGRESS:`, BEFORE the slow step:

    PROGRESS: Let me pull up your recent runs…
    PROGRESS: Oof — three failed overnight. Reading the logs now.
    PROGRESS: Looks like the Stripe connector timed out. Confirming…

Each line appears in the chat as its OWN little message from you the
moment you emit it (and is spoken when voice is on), so the user sees
you reacting and working in real time — a back-and-forth, not a frozen
spinner. Your final reply then lands as the considered answer.

Discipline:

- Conversational and first person, addressed to the user ("Let me…",
  "Okay, found it…", "Hm, that's odd —"). One short sentence, ≤ ~15 words.
  Plain English: no markdown, paths, ids, or code names.
- Emit one right BEFORE a slow step (a live reaction), and one when a step
  turns up something worth reacting to. Aim for 2–5 across a working turn.
- This ALSO applies when there are NO tool calls. If you're about to write a
  substantial, multi-part answer — analyzing several things, walking through a
  list/registry, comparing options, reviewing a project — OPEN with a beat or
  two so the user sees you engage immediately ("Good timing — let me look at
  your projects…" → "Okay, I see six; one's genuinely stale —") instead of
  staring at a spinner while you compose the whole thing. The wait the user
  feels is your composition time, not just tool time.
- ONLY for turns that actually take work. A quick answer you can give in
  one message needs ZERO beats — never fragment a short reply into pieces,
  and never narrate a turn that's about to finish anyway.
- These are separate messages from your final reply — don't repeat them
  verbatim there, but DO put the real answer and conclusions in the final
  reply. The beats are the journey; the reply is the destination.
"#,
    )
}

/// Detect a fresh-install state (no prior conversation + identity.md is
/// still placeholder-shaped) and return a focused interview-mode addendum.
/// Empty string in normal operation.
fn onboarding_addendum_if_needed(identity: &str, episodes: &[episodic::Episode]) -> String {
    let no_episodes = episodes.is_empty();
    // Identity is "fresh" if it still contains the placeholder bullets we
    // seed it with. Once Athena writes a real identity (or the user edits
    // it), those markers disappear.
    let identity_is_placeholder = identity.contains("(seeded from intake interview)")
        || identity.contains("(rhythms, patterns, what flow looks like for him)");
    if !no_episodes || !identity_is_placeholder {
        return String::new();
    }
    String::from(
        r#"

# ONBOARDING MODE — first conversation

This is the user's first conversation with you. Their identity layer is still
just placeholders. Your job in this conversation is to run a real intake
interview that produces a foundation worth building on. Be present and
warm — this is the start of a long working relationship, not a form to
fill out.

The interview has five phases. Don't rush. One phase per turn unless he
asks you to move faster.

1. **Orientation** (1 turn) — introduce yourself briefly. Be honest about
   what you are and how the relationship works (the constitution is your
   reference, you have a brain that grows over time, every fact you'll
   remember about him will be cited). Then ask what he'd like to be
   called and what's on his mind today.
2. **His work** (2-3 turns) — what is he building. Who for. What does
   "shipping" look like. What's the *current* phase. Don't accept vague
   answers; press gently for specifics. The texture matters more than
   the bullet points.
3. **His patterns** (2-3 turns) — when does he ship vs. stall. What kind
   of nudge helps when he's stuck. What *doesn't* help (the things that
   feel patronizing or generic). When does he go to sleep.
4. **Boundaries** (1-2 turns) — anything off-limits to discuss; quiet
   hours for proactive nudges; how he wants the "execute with approval"
   flow to feel for him specifically (more pre-amble or less; cite IDs
   or describe in prose).
5. **Identity draft** (1 turn) — synthesize what you heard into a fresh
   identity.md. Show him the draft *in your reply* (in plain markdown,
   not a code block) and emit:

       OP: {"op": "propose_action", "action": "update_identity", "params": {"content": "<the full new identity.md content>"}, "rationale": "first-pass identity from our intake — please review and approve"}

   The approval card lets him review and approve the write. If he wants
   changes, iterate before approving.

Do NOT emit propose_action for any other action during onboarding —
keep this conversation focused on the interview itself.
"#,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(key: &str, sources: Vec<String>) -> Fact {
        Fact {
            id: format!("fact_{key}"),
            scope: "user".to_string(),
            key: key.to_string(),
            value: format!("{key} value"),
            importance: 3,
            confidence: 0.9,
            sources,
            supersedes_id: None,
            contradicts_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            last_seen_at: "2026-01-01T00:00:00Z".to_string(),
            file_path: "identity.md".to_string(),
        }
    }

    #[test]
    fn format_facts_skips_a_fact_with_no_sources_rather_than_fabricate_one() {
        // Regression: this used to render the literal string "no-sources" as
        // if it were a real citation, teaching the model that uncited memory
        // is a legitimate shape. `semantic::write_fact` already refuses to
        // persist a sourceless fact, so reaching this case at all means the
        // write-time invariant was bypassed; the render must skip it (like
        // `consolidation.rs`'s `continue` on the same check), never fabricate
        // a placeholder citation.
        let facts = vec![
            fact("cited", vec!["ep_1".to_string()]),
            fact("uncited", vec![]),
        ];
        let out = format_facts(&facts);
        assert!(out.contains("cited"));
        assert!(out.contains("[from ep_1]"));
        assert!(!out.contains("uncited"));
        assert!(!out.contains("no-sources"));
    }

    #[test]
    fn format_facts_empty_input_is_empty_string() {
        assert_eq!(format_facts(&[]), "");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Fleet index blocks
    // ─────────────────────────────────────────────────────────────────────

    /// In-memory system pool carrying only the columns the three index
    /// blocks read. Deliberately not the full schema: the blocks are lean
    /// projections and the test should fail loudly if that ever changes.
    fn index_test_pool() -> DbPool {
        let manager = r2d2_sqlite::SqliteConnectionManager::memory();
        let pool = r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("pool");
        pool.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE personas (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
                    system_prompt TEXT NOT NULL DEFAULT '', model_profile TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
                 CREATE TABLE dev_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    root_path TEXT NOT NULL);
                 CREATE TABLE dev_context_groups (id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL, name TEXT NOT NULL);
                 CREATE TABLE dev_contexts (id TEXT PRIMARY KEY, project_id TEXT,
                    group_id TEXT, name TEXT NOT NULL, description TEXT,
                    pinned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);",
            )
            .unwrap();
        pool
    }

    /// A realistic UUID for fixture row N — the point of the persona block
    /// is that Athena can copy one of these verbatim.
    fn fixture_uuid(n: usize) -> String {
        format!("6f1c9a2b-4d3e-4f5a-9b8c-{n:012}")
    }

    fn seed_index_fixtures(pool: &DbPool, personas: usize, contexts: usize) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path) VALUES ('proj_1', 'Personas', 'C:/repo')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_context_groups (id, project_id, name)
             VALUES ('grp_1', 'proj_1', 'Agent Platform')",
            [],
        )
        .unwrap();
        for n in 0..personas {
            conn.execute(
                "INSERT INTO personas (id, name, description, system_prompt, model_profile, enabled, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    fixture_uuid(n),
                    format!("Agent {n}"),
                    format!("Handles workload number {n} across the whole fleet, end to end."),
                    "You are a helpful agent. ".repeat(40),
                    r#"{"model":"claude-sonnet-4-6"}"#,
                    // Every 7th persona disabled, so ordering has something to sort.
                    i64::from(n % 7 != 0),
                    format!("2026-01-01T00:{:02}:00Z", n % 60),
                ],
            )
            .unwrap();
        }
        for n in 0..contexts {
            conn.execute(
                "INSERT INTO dev_contexts (id, project_id, group_id, name, description, pinned, updated_at)
                 VALUES (?1, 'proj_1', 'grp_1', ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    format!("ctx_{n:04}"),
                    format!("Context {n}"),
                    format!("The {n}th feature area of the application, with a long description."),
                    i64::from(n % 11 == 0),
                    format!("2026-02-01T00:{:02}:00Z", n % 60),
                ],
            )
            .unwrap();
        }
    }

    fn fixture_skills(count: usize) -> Vec<SkillIndexEntry> {
        (0..count)
            .map(|n| SkillIndexEntry {
                name: format!("skill-number-{n:03}"),
                scope: "global".to_string(),
                description: format!(
                    "Use this skill when you need to do job {n}, which is a long \
                     multi-clause description that would blow any budget if unbounded."
                ),
                path: format!("/skills/skill-number-{n:03}/SKILL.md"),
            })
            .collect()
    }

    #[test]
    fn index_blocks_stay_under_budget_with_200_fixtures() {
        let pool = index_test_pool();
        seed_index_fixtures(&pool, 200, 200);
        let personas = format_persona_index(&pool);
        let contexts = format_context_index(&pool);
        let skills = render_skill_index(&fixture_skills(200));

        assert!(
            personas.len() <= PERSONA_INDEX_CHARS,
            "persona block {} > cap {PERSONA_INDEX_CHARS}",
            personas.len()
        );
        assert!(
            contexts.len() <= CONTEXT_INDEX_CHARS,
            "context block {} > cap {CONTEXT_INDEX_CHARS}",
            contexts.len()
        );
        assert!(
            skills.len() <= SKILL_INDEX_CHARS,
            "skill block {} > cap {SKILL_INDEX_CHARS}",
            skills.len()
        );
        assert!(
            personas.len() + contexts.len() + skills.len() <= INDEX_CHAR_BUDGET,
            "combined {} > budget {INDEX_CHAR_BUDGET}",
            personas.len() + contexts.len() + skills.len()
        );
    }

    /// A synthetic canvas scene: `count` projects, each with a full fifteen
    /// cells of which many are unhealthy and carry long detail strings, so the
    /// fixture pushes on the budget the way a real 50-project portfolio would.
    fn fixture_scene(count: usize) -> crate::companion::canvas::CanvasScene {
        let states = ["critical", "warning", "building", "healthy"];
        let statuses = ["alert", "risk", "unknown", "absent", "solid", "partial"];
        let projects: Vec<String> = (0..count)
            .map(|n| {
                let dims: Vec<String> = (0..15)
                    .map(|d| {
                        format!(
                            r#"{{"key":"dim{d}","label":"Dimension {d}","status":"{}",
                                "detail":"a long concrete detail string naming a tool and a number {n}"}}"#,
                            statuses[(n + d) % statuses.len()]
                        )
                    })
                    .collect();
                format!(
                    r#"{{"slug":"project-slug-{n:03}","name":"Project Number {n} With A Long Name",
                         "state":"{}","attention":{},"blockers":{},"fleet":{},
                         "dims":[{}]}}"#,
                    states[n % states.len()],
                    n % 7 == 0,
                    n % 5,
                    n % 3,
                    dims.join(",")
                )
            })
            .collect();
        serde_json::from_str(&format!(
            r#"{{"version":1,"publishedAt":"2026-08-04T09:00:00Z",
                 "families":{{"scans":"failed","goals":"loaded"}},
                 "projects":[{}]}}"#,
            projects.join(",")
        ))
        .expect("fixture scene parses")
    }

    #[test]
    fn scene_digest_stays_under_its_own_budget_with_50_projects() {
        let digest = render_scene_digest(&fixture_scene(50));
        assert!(
            digest.len() <= SCENE_CHAR_BUDGET,
            "scene digest {} > cap {SCENE_CHAR_BUDGET}",
            digest.len()
        );
        // Its budget is its OWN: adding it must not have shrunk the three
        // index blocks, which is the failure mode a shared budget invites.
        assert_eq!(
            PERSONA_INDEX_CHARS + CONTEXT_INDEX_CHARS + SKILL_INDEX_CHARS,
            INDEX_CHAR_BUDGET
        );
    }

    #[test]
    fn a_truncated_scene_digest_still_reports_the_true_project_count() {
        let digest = render_scene_digest(&fixture_scene(50));
        assert!(digest.contains("of 50 projects"), "{digest}");
        assert!(
            !digest.contains("Listing 50 of 50"),
            "50 projects must actually truncate, or the honesty line is decorative"
        );
        // The escape hatches must survive truncation.
        assert!(digest.contains("describe_canvas_project"), "{digest}");
        assert!(digest.contains("describe_canvas_freshness"), "{digest}");
        // And the degraded family must be named, since cells fed by it lie.
        assert!(digest.contains("scans (failed)"), "{digest}");
    }

    #[test]
    fn the_scene_digest_leads_with_what_needs_attention() {
        // Ordering is the product here: the block is a triage surface, so a
        // blocked session must outrank an alphabetically earlier healthy row.
        let scene: crate::companion::canvas::CanvasScene = serde_json::from_str(
            r#"{"version":1,"projects":[
                {"slug":"aaa-fine","name":"Fine","state":"healthy"},
                {"slug":"zzz-blocked","name":"Blocked","state":"healthy","attention":true},
                {"slug":"mmm-critical","name":"Critical","state":"critical"}
            ]}"#,
        )
        .unwrap();
        let digest = render_scene_digest(&scene);
        let pos = |s: &str| digest.find(s).unwrap_or(usize::MAX);
        assert!(pos("zzz-blocked") < pos("mmm-critical"), "{digest}");
        assert!(pos("mmm-critical") < pos("aaa-fine"), "{digest}");
        assert!(digest.contains("NEEDS YOU"), "{digest}");
    }

    #[test]
    fn no_published_scene_means_no_block_at_all() {
        // A user who never opens Mastermind must not pay prompt budget for it.
        let pool = index_test_pool();
        assert_eq!(format_scene_digest(&pool), "");
    }

    #[test]
    fn truncated_blocks_still_report_the_true_total() {
        // The whole point of the cap: a partial list that reads as complete
        // is worse than no list, because she'd conclude an agent doesn't
        // exist. Each block must name the real total and the escape hatch.
        let pool = index_test_pool();
        seed_index_fixtures(&pool, 200, 200);
        let personas = format_persona_index(&pool);
        let contexts = format_context_index(&pool);
        let skills = render_skill_index(&fixture_skills(200));

        assert!(personas.contains("of 200 agents"), "{personas}");
        assert!(personas.contains("describe_persona"));
        assert!(personas.contains("list_teams"));
        assert!(contexts.contains("of 200 contexts"), "{contexts}");
        assert!(contexts.contains("describe_context"));
        assert!(skills.contains("of 200 installed skills"), "{skills}");
        assert!(skills.contains("describe_skill"));

        // And they really are truncated at this corpus size, so the
        // "showing N of M" wording is load-bearing rather than decorative.
        assert!(!personas.contains("Listing 200 of 200"));
        assert!(!contexts.contains("Listing 200 of 200"));
        assert!(!skills.contains("Listing 200 of 200"));
    }

    #[test]
    fn persona_index_carries_a_real_uuid_and_enabled_agents_first() {
        let pool = index_test_pool();
        seed_index_fixtures(&pool, 200, 0);
        let out = format_persona_index(&pool);
        // Agent 59 is enabled (only every 7th is disabled) and carries the
        // newest updated_at, so it heads the list; its id must be
        // verbatim-copyable out of the block.
        assert!(out.contains(&fixture_uuid(59)), "{out}");
        // Agent 0 is the disabled one; enabled rows sort ahead of it, and at
        // this corpus size the disabled tail never fits.
        assert!(!out.contains(" · DISABLED"), "{out}");
    }

    #[test]
    fn small_corpus_renders_completely() {
        let pool = index_test_pool();
        seed_index_fixtures(&pool, 3, 2);
        let personas = format_persona_index(&pool);
        assert!(personas.contains("Listing 3 of 3 agents"), "{personas}");
        assert!(personas.contains(&fixture_uuid(0)));
        assert!(personas.contains(&fixture_uuid(2)));
        let contexts = format_context_index(&pool);
        assert!(contexts.contains("Listing 2 of 2 contexts"), "{contexts}");
    }

    #[test]
    fn empty_corpus_emits_nothing() {
        let pool = index_test_pool();
        assert_eq!(format_persona_index(&pool), "");
        assert_eq!(format_context_index(&pool), "");
        assert_eq!(render_skill_index(&[]), "");
    }

    #[test]
    fn model_tier_label_reduces_to_the_family_word() {
        assert_eq!(model_tier_label(r#"{"model":"claude-opus-4-5"}"#), "opus");
        assert_eq!(model_tier_label(r#"{"model":"claude-haiku-4-5"}"#), "haiku");
        assert_eq!(model_tier_label(""), "default tier");
        assert_eq!(model_tier_label("not json"), "default tier");
        assert_eq!(model_tier_label(r#"{"model":"qwen-max"}"#), "qwen-max");
    }

    #[test]
    fn observability_digest_no_longer_duplicates_the_persona_listing() {
        // Reconciliation guard: two persona lists in one prompt (one with
        // ids, one without) is what taught Athena to name agents she could
        // not act on. `format_persona_index` is authoritative now.
        let digest = observability::ObservabilityDigest {
            personas_total: 3,
            personas_enabled: 2,
            top_personas: vec!["Scout".to_string(), "Archivist".to_string()],
            ..Default::default()
        };
        let out = observability::format_for_prompt(&digest);
        assert!(!out.contains("Recently active"), "{out}");
        assert!(!out.contains("Scout"), "{out}");
        // Counts still belong to the digest.
        assert!(out.contains("3 total, 2 enabled"));
    }

    // ─────────────────────────────────────────────────────────────────────
    // Per-block size ledger
    // ─────────────────────────────────────────────────────────────────────

    fn empty_recall() -> Recall {
        Recall {
            episodes: Vec::new(),
            doctrine: Vec::new(),
            facts: Vec::new(),
            procedurals: Vec::new(),
            goals: Vec::new(),
            backlog: Vec::new(),
        }
    }

    #[test]
    fn compose_output_is_byte_identical_under_instrumentation() {
        // The size ledger must be pure observation. This pins the composed
        // string against a hand-written expectation assembled in compose()'s
        // documented order, so any future edit that "just" reorders or
        // re-pads a block while touching the instrumentation fails here
        // rather than silently changing what the model reads.
        let recall = empty_recall();
        let (out, _) = compose(
            "CONSTITUTION",
            "IDENTITY",
            "OBSERVABILITY",
            &recall,
            None,
            "PLUGINS",
            "CONNECTORS",
            "ONBOARDING",
            "VOICE",
            "DISPLAY",
            "MODE",
        );
        // Empty recall + no briefing ⇒ all six memory blocks and the
        // synthesis block render as "" (asserted separately for facts in
        // `format_facts_empty_input_is_empty_string`).
        let expected = format!(
            "CONSTITUTION\n\n# Identity (live, evolves)\n\nIDENTITY\
             OBSERVABILITYPLUGINSCONNECTORSONBOARDINGVOICEDISPLAY{tools}{delegation}MODE",
            tools = tools_addendum(),
            delegation = delegation_addendum(),
        );
        assert_eq!(out, expected);
    }

    #[test]
    fn block_sizes_report_every_block_and_the_real_total() {
        let mut recall = empty_recall();
        recall.facts = vec![fact("alpha", vec!["identity.md".to_string()])];
        let facts_len = format_facts(&recall.facts).len();
        assert!(facts_len > 0, "fixture should render a non-empty facts block");

        let (out, sizes) = compose(
            "CONSTITUTION",
            "IDENTITY",
            "OBSERVABILITY",
            &recall,
            None,
            "PLUGINS",
            "CONNECTORS",
            "ONBOARDING",
            "VOICE",
            "DISPLAY",
            "MODE",
        );

        // `total` is the real composed length, never a sum of estimates.
        assert_eq!(sizes.total(), out.len());

        let json = sizes.to_json().expect("breakdown serializes");
        let map: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(&json).expect("breakdown is a JSON object");
        for name in [
            "constitution",
            "identity",
            "observability",
            "recall",
            "briefing",
            "plugins",
            "connectors",
            "onboarding",
            "voice",
            "display",
            "mode_addenda",
            "static_addenda",
        ] {
            assert!(map.contains_key(name), "missing block {name} in {json}");
        }
        assert_eq!(map["constitution"].as_u64(), Some("CONSTITUTION".len() as u64));
        assert_eq!(map["mode_addenda"].as_u64(), Some("MODE".len() as u64));
        // The six raw memory blocks collapse into one `recall` bucket.
        assert_eq!(map["recall"].as_u64(), Some(facts_len as u64));
        // No briefing was passed, so that bucket is genuinely zero.
        assert_eq!(map["briefing"].as_u64(), Some(0));
        // The blocks account for everything but compose()'s own headings.
        let block_sum: u64 = map.values().filter_map(serde_json::Value::as_u64).sum();
        assert!(block_sum <= sizes.total() as u64);
        assert!(sizes.total() as u64 - block_sum < 128, "scaffolding drifted");
    }

    #[test]
    fn every_measured_block_has_a_budget() {
        // A block added to compose() without a budget entry would be
        // measured but never audited — the exact silence this feature exists
        // to end.
        let recall = empty_recall();
        let (_, sizes) = compose(
            "", "", "", &recall, None, "", "", "", "", "", "",
        );
        for (name, _) in &sizes.blocks {
            assert!(budget_for(name).is_some(), "block {name} has no budget");
        }
    }
}
