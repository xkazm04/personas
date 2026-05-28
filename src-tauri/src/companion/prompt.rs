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
use crate::companion::brain::retrieval::{self, DoctrineHit, Recall};
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

/// Build the full system prompt.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
#[cfg(feature = "ml")]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: Option<&Arc<EmbeddingManager>>,
    session_id: &str,
    query: &str,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
) -> Result<(String, RecallPreview), AppError> {
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
        "{}{}",
        observability_md,
        crate::companion::orchestration::operative_memory::memory().digest_for_prompt(),
    );

    let recall = match embedder {
        Some(emb) => retrieval::retrieve(user_db, emb, session_id, query)
            .await
            .unwrap_or_default(),
        None => Recall {
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
        },
    };

    // Recall synthesis: when the user has opted in AND raw recall exceeds
    // the budget, ask Claude to synthesize a focused briefing that replaces
    // the raw chunks. Best-effort throughout: any failure (timeout, JSON
    // parse, non-zero exit) falls through to raw chunks so synthesis never
    // breaks a chat turn.
    let briefing: Option<Briefing> = if recall_synthesis_enabled
        && recall_synthesis::estimate_recall_tokens(&recall) > SYNTHESIS_TOKEN_THRESHOLD
    {
        match recall_synthesis::synthesize_recall(&recall, query).await {
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
    };

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    let voice_md = voice_addendum_if_needed(voice_enabled);
    let display_md = display_addendum_if_voice_active(voice_enabled);
    let autonomous_md = autonomous_addendum_if_enabled(autonomous_mode);
    let connector_names = connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = crate::companion::projects::list(user_db).unwrap_or_default();
    let tracking_pulses_md = format_project_tracking_pulses(user_db, &plugin_names);
    let plugins_md = format!(
        "{}{}",
        format_plugins(&plugin_names, &projects, &tracking_pulses_md),
        format_project_goals(sys_db),
    );

    let preview = summarize_recall(&recall, briefing.is_some());
    let composed = compose(
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
    Ok((composed, preview))
}

#[cfg(not(feature = "ml"))]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    session_id: &str,
    _query: &str,
    voice_enabled: bool,
    _recall_synthesis_enabled: bool,
    autonomous_mode: bool,
) -> Result<(String, RecallPreview), AppError> {
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
        "{}{}",
        observability_md,
        crate::companion::orchestration::operative_memory::memory().digest_for_prompt(),
    );

    let recall = Recall {
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
    };

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    let voice_md = voice_addendum_if_needed(voice_enabled);
    let display_md = display_addendum_if_voice_active(voice_enabled);
    let autonomous_md = autonomous_addendum_if_enabled(autonomous_mode);
    let connector_names = connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = crate::companion::projects::list(user_db).unwrap_or_default();
    let tracking_pulses_md = format_project_tracking_pulses(user_db, &plugin_names);
    let plugins_md = format!(
        "{}{}",
        format_plugins(&plugin_names, &projects, &tracking_pulses_md),
        format_project_goals(sys_db),
    );

    let preview = summarize_recall(&recall, false);
    let composed = compose(
        &constitution,
        &identity,
        &observability_md,
        &recall,
        None, // synthesis is ml-feature gated; non-ml builds never synthesize
        &plugins_md,
        &connectors_md,
        &onboarding_md,
        &voice_md,
        &display_md,
        &autonomous_md,
    );
    Ok((composed, preview))
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
        if last_scope != Some(f.scope.as_str()) {
            s.push_str(&format!("## {} facts\n\n", capitalize(&f.scope)));
            last_scope = Some(f.scope.as_str());
        }
        let sources = if f.sources.is_empty() {
            "no-sources".into()
        } else {
            f.sources.join(", ")
        };
        s.push_str(&format!(
            "- **{key}** (importance {imp}, conf {conf:.0}%) — {value}  [from {srcs}]\n",
            key = f.key,
            imp = f.importance,
            conf = f.confidence * 100.0,
            value = f.value.trim(),
            srcs = sources,
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

fn format_goals(goals: &[Goal]) -> String {
    if goals.is_empty() {
        return String::new();
    }
    let mut s = String::from("\n\n# Active goals (what Michal said he's working toward)\n\n");
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
        let mut end = max_len;
        while !firstline.is_char_boundary(end) && end > 0 {
            end -= 1;
        }
        format!("{}…", &firstline[..end])
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
        String::from("\n\n# Plugins enabled (capabilities Michal has turned on for you)\n\n");
    for name in enabled {
        match name.as_str() {
            "dev_tools" => {
                s.push_str(
                    "## Dev Tools\n\n\
                     Michal has the **Dev Tools plugin** enabled. He wants you to lead \
                     the product-development lifecycle of his projects.\n\n\
                     ### Registered projects\n\n",
                );
                if projects.is_empty() {
                    s.push_str(
                        "_No projects registered yet._ If he asks you about a project, \
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
                         ledger. When Michal asks 'what's happening on X' or 'what's drifting', \
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
                     you see it on your next turn. Tell Michal that explicitly when you \
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
                        (dev_context_groups / dev_contexts). Use it whenever Michal says \
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
                     agent (or team) that …\" request. If Michal asks to scan a repo \"for \
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
                // the prompt. Surface it minimally so Michal sees it's
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
) -> String {
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
    // Plugins block: capabilities Michal has toggled on for Athena
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
    out
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

# PROGRESS — narrate long turns out loud

If this turn will take a while — web searches, several tool calls,
scanning a codebase, building something — emit short progress beats AS
YOU GO, one per line, BEFORE the slow work:

    PROGRESS: Pulling up your recent runs…
    PROGRESS: Found three failures — reading the logs…

Each beat is spoken aloud the moment you emit it, so the user hears
movement instead of silence. Discipline:

- One short, speakable sentence (≤ ~12 words), first person, present tense.
- Emit a beat right BEFORE you start a slow step — it's live narration,
  not a summary after the fact.
- 1–4 beats per turn, and only for genuinely long turns. A quick answer
  needs none — never narrate a turn that's about to finish anyway.
- Plain English only: no markdown, paths, ids, or code names (same rules
  as the TTS line).
- These are separate from your single closing `TTS:` line — beats are the
  in-progress narration, `TTS:` is the spoken version of the final reply.
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

This is Michal's first conversation with you. His identity layer is still
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
