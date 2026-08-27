//! Writing a leg's verdicts into the brain: supersedes, fact and procedural
//! candidates, and tags. Every id is checked against live memory first — a
//! hallucinated loser id would otherwise retire an arbitrary fact.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::params;
use serde_json::Value;

use super::limits::{
    CYCLE_IMPORTANCE, DEFAULT_CONFIDENCE, MAX_FACTS_PER_CYCLE, MAX_PROCEDURALS_PER_CYCLE,
    MAX_SUPERSEDES_PER_CYCLE,
};
use super::parse::{live_fact_scope, normalize_tag, one_line, str_field, str_opt};
use super::run::{CycleNotes, CycleStats};
use crate::companion::brain::{procedural, semantic, taxonomy};
use crate::db::UserDbPool;
use crate::error::AppError;

/// Apply the `supersede` verdicts, capped.
///
/// Both ids are checked against live facts before anything moves: a
/// hallucinated `loser_id` would otherwise retire an arbitrary memory, which is
/// the exact failure `consolidation::validate_supersedes` exists to prevent on
/// the human-reviewed path. Cross-scope pairs are refused for the same reason —
/// a `user` fact does not supersede a `project` one.
pub(super) fn apply_supersedes(
    pool: &UserDbPool,
    reply: &Value,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<(), AppError> {
    let Some(items) = reply.get("supersede").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    let now = Utc::now().to_rfc3339();
    for item in items {
        if stats.supersedes_applied >= MAX_SUPERSEDES_PER_CYCLE {
            stats.supersedes_dropped += 1;
            continue;
        }
        let winner = str_field(item, "winner_id");
        let loser = str_field(item, "loser_id");
        let reason = str_field(item, "reason");
        if winner.is_empty() || loser.is_empty() || winner == loser {
            stats.supersedes_dropped += 1;
            continue;
        }
        let (Some(ws), Some(ls)) = (
            live_fact_scope(pool, &winner)?,
            live_fact_scope(pool, &loser)?,
        ) else {
            stats.supersedes_dropped += 1;
            notes.caveats.push(format!(
                "Supersede skipped: `{winner}` → `{loser}` names a fact that is not live."
            ));
            continue;
        };
        if ws != ls {
            stats.supersedes_dropped += 1;
            notes.caveats.push(format!(
                "Supersede skipped: `{winner}` ({ws}) and `{loser}` ({ls}) are in different scopes."
            ));
            continue;
        }

        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        semantic::demote_superseded(&tx, &loser, &now)?;
        // Record the relationship on the survivor, without clobbering a
        // supersede it already carries from its own write.
        tx.execute(
            "UPDATE companion_fact SET supersedes_id = ?1
             WHERE id = ?2 AND supersedes_id IS NULL",
            params![loser, winner],
        )?;
        tx.commit()?;

        stats.supersedes_applied += 1;
        notes.supersedes.push(format!(
            "`{winner}` now supersedes `{loser}`{}",
            if reason.is_empty() {
                String::new()
            } else {
                format!(" — {reason}")
            }
        ));
    }
    Ok(())
}

/// Contradictions are recorded, never acted on. Deciding which of two
/// conflicting claims is true is a judgement about the operator's world, not
/// about his memory index — it belongs to him or to a later phase with a
/// review gate, not to an unattended pass at 4am.
pub(super) fn collect_contradictions(
    reply: &Value,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) {
    let Some(items) = reply.get("contradictions").and_then(|v| v.as_array()) else {
        return;
    };
    for item in items {
        let a = str_field(item, "a_id");
        let b = str_field(item, "b_id");
        let note = str_field(item, "note");
        if a.is_empty() || b.is_empty() {
            continue;
        }
        stats.contradictions += 1;
        notes.contradictions.push(format!(
            "`{a}` vs `{b}`{}",
            if note.is_empty() {
                String::new()
            } else {
                format!(" — {note}")
            }
        ));
    }
}

// ── Candidate validation + application ─────────────────────────────────────

/// Validate and apply the `facts` / `procedurals` arrays of an envelope.
///
/// `known_episodes` is `Some` for locally-derived candidates, in which case a
/// provenance id that was not in the prompt is a hallucination and is dropped;
/// `None` for staged deltas, whose sources legitimately do not exist here.
/// `fallback_source` supplies a provenance token when a staged item carries no
/// usable one.
#[allow(clippy::too_many_arguments)]
pub(super) fn apply_candidates(
    pool: &UserDbPool,
    _cycle_id: &str,
    reply: &Value,
    active_tags: &HashSet<String>,
    known_episodes: Option<&HashSet<String>>,
    fallback_source: Option<&str>,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<(), AppError> {
    if let Some(items) = reply.get("facts").and_then(|v| v.as_array()) {
        for item in items {
            if stats.facts_applied >= MAX_FACTS_PER_CYCLE {
                stats.facts_dropped += 1;
                stats.facts_dropped_over_cap += 1;
                continue;
            }
            let Some(c) = parse_fact_candidate(
                pool,
                item,
                active_tags,
                known_episodes,
                fallback_source,
                stats,
                notes,
            )?
            else {
                stats.facts_dropped += 1;
                continue;
            };
            // The user deleted this key. Deleting a fact does not delete the
            // episodes it came from, and this cycle is reading those episodes
            // again — so without this refusal the correction is reversed
            // tonight and every night after, silently. Counted, not swallowed:
            // a refusal nobody can see is indistinguishable from a cycle that
            // simply learned nothing.
            if semantic::is_forgotten(pool, c.scope, &c.key) {
                stats.facts_dropped += 1;
                stats.facts_dropped_forgotten += 1;
                notes.refused_forgotten.push(format!(
                    "**{}/{}** — re-derived from evidence, refused: you asked me to forget it.",
                    c.scope.as_str(),
                    c.key
                ));
                continue;
            }
            let id = semantic::write_fact(
                pool,
                &semantic::FactInput {
                    scope: c.scope,
                    key: &c.key,
                    value: &c.value,
                    sources: &c.sources,
                    importance: CYCLE_IMPORTANCE,
                    confidence: c.confidence,
                    supersedes_id: c.supersedes_id.as_deref(),
                    contradicts_id: None,
                },
            )?;
            apply_tags(pool, &id, &c.tags)?;
            stats.facts_applied += 1;
            notes.learned_facts.push(format!(
                "**{}/{}** — {} _({} source{}{})_",
                c.scope.as_str(),
                c.key,
                one_line(&c.value, 220),
                c.sources.len(),
                if c.sources.len() == 1 { "" } else { "s" },
                if c.tags.is_empty() {
                    String::new()
                } else {
                    format!(", tagged {}", c.tags.join("/"))
                }
            ));
        }
    }

    if let Some(items) = reply.get("procedurals").and_then(|v| v.as_array()) {
        for item in items {
            if stats.procedurals_applied >= MAX_PROCEDURALS_PER_CYCLE {
                stats.procedurals_dropped += 1;
                stats.procedurals_dropped_over_cap += 1;
                continue;
            }
            let Some(c) = parse_procedural_candidate(
                item,
                active_tags,
                known_episodes,
                fallback_source,
                stats,
            ) else {
                stats.procedurals_dropped += 1;
                continue;
            };
            let id = procedural::write_rule(
                pool,
                &procedural::ProceduralInput {
                    scope: c.scope,
                    trigger: &c.trigger,
                    behavior: &c.behavior,
                    sources: &c.sources,
                    importance: CYCLE_IMPORTANCE,
                    confidence: DEFAULT_CONFIDENCE,
                    supersedes_id: None,
                },
            )?;
            apply_tags(pool, &id, &c.tags)?;
            stats.procedurals_applied += 1;
            notes.learned_procedurals.push(format!(
                "**when {}** → {}",
                one_line(&c.trigger, 120),
                one_line(&c.behavior, 200)
            ));
        }
    }
    Ok(())
}

struct FactCandidate {
    scope: semantic::FactScope,
    key: String,
    value: String,
    tags: Vec<String>,
    confidence: f32,
    sources: Vec<String>,
    supersedes_id: Option<String>,
}

struct ProceduralCandidate {
    scope: procedural::ProceduralScope,
    trigger: String,
    behavior: String,
    tags: Vec<String>,
    sources: Vec<String>,
}

fn parse_fact_candidate(
    pool: &UserDbPool,
    item: &Value,
    active_tags: &HashSet<String>,
    known_episodes: Option<&HashSet<String>>,
    fallback_source: Option<&str>,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<Option<FactCandidate>, AppError> {
    let Ok(scope) = semantic::FactScope::parse(&str_field(item, "scope")) else {
        return Ok(None);
    };
    let key = str_field(item, "key");
    let value = str_field(item, "value");
    if key.trim().is_empty() || value.trim().is_empty() {
        return Ok(None);
    }
    let sources = collect_sources(item, known_episodes, fallback_source);
    if sources.is_empty() {
        return Ok(None);
    }
    let tags = collect_tags(item, active_tags, stats);
    let confidence = item
        .get("confidence")
        .and_then(|v| v.as_f64())
        .map(|c| c as f32)
        .unwrap_or(DEFAULT_CONFIDENCE)
        .clamp(0.0, 1.0);

    // A supersede that names nothing live loses the supersede, not the fact —
    // the claim is still worth keeping; only the demotion it asked for is
    // refused.
    let mut supersedes_id = str_opt(item, "supersedes_id");
    if let Some(prior) = supersedes_id.clone() {
        match live_fact_scope(pool, &prior)? {
            Some(s) if s == scope.as_str() => {}
            _ => {
                notes.caveats.push(format!(
                    "Fact `{key}` claimed to supersede `{prior}`, which is not a live fact in \
                     scope {}; kept the fact, dropped the supersede.",
                    scope.as_str()
                ));
                supersedes_id = None;
            }
        }
    }

    Ok(Some(FactCandidate {
        scope,
        key,
        value,
        tags,
        confidence,
        sources,
        supersedes_id,
    }))
}

fn parse_procedural_candidate(
    item: &Value,
    active_tags: &HashSet<String>,
    known_episodes: Option<&HashSet<String>>,
    fallback_source: Option<&str>,
    stats: &mut CycleStats,
) -> Option<ProceduralCandidate> {
    // NOTE: procedural scopes are chat|action|memory|build, NOT the fact trio.
    // `procedural::write_rule` has always taken this vocabulary; a candidate
    // that says "user" is describing a fact, not a behavior.
    let scope = procedural::ProceduralScope::parse(&str_field(item, "scope")).ok()?;
    let trigger = str_field(item, "trigger");
    let behavior = str_field(item, "behavior");
    if trigger.trim().is_empty() || behavior.trim().is_empty() {
        return None;
    }
    let sources = collect_sources(item, known_episodes, fallback_source);
    if sources.is_empty() {
        return None;
    }
    let tags = collect_tags(item, active_tags, stats);
    Some(ProceduralCandidate {
        scope,
        trigger,
        behavior,
        tags,
        sources,
    })
}

/// Provenance ids, filtered against what the model was actually shown.
fn collect_sources(
    item: &Value,
    known_episodes: Option<&HashSet<String>>,
    fallback_source: Option<&str>,
) -> Vec<String> {
    let mut out: Vec<String> = item
        .get("provenance")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .filter(|s| match known_episodes {
                    Some(known) => known.contains(*s),
                    None => true,
                })
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    out.sort();
    out.dedup();
    if out.is_empty() {
        if let Some(f) = fallback_source {
            out.push(f.to_string());
        }
    }
    out
}

/// Tags, filtered to the ACTIVE vocabulary. An unknown tag is dropped from the
/// item and counted — never invented into the registry, because a classifier
/// that can mint its own vocabulary makes the approval gate decorative.
fn collect_tags(
    item: &Value,
    active_tags: &HashSet<String>,
    stats: &mut CycleStats,
) -> Vec<String> {
    let mut out = Vec::new();
    let Some(arr) = item.get("tags").and_then(|v| v.as_array()) else {
        return out;
    };
    for v in arr {
        let Some(raw) = v.as_str() else { continue };
        let tag = normalize_tag(raw);
        if tag.is_empty() {
            continue;
        }
        if active_tags.contains(&tag) {
            if !out.contains(&tag) {
                out.push(tag);
            }
        } else {
            stats.unknown_tags_dropped += 1;
        }
    }
    out
}

/// Stage taxonomy expansions as `proposed`. Never activated.
pub(super) fn apply_tag_proposals(
    pool: &UserDbPool,
    cycle_id: &str,
    reply: &Value,
    stats: &mut CycleStats,
    notes: &mut CycleNotes,
) -> Result<(), AppError> {
    let Some(items) = reply.get("proposed_tags").and_then(|v| v.as_array()) else {
        return Ok(());
    };
    for item in items {
        let tag = normalize_tag(&str_field(item, "tag"));
        let definition = str_field(item, "definition");
        let evidence = str_field(item, "evidence");
        if tag.is_empty() || definition.trim().is_empty() {
            continue;
        }
        if taxonomy::propose(pool, &tag, &definition, cycle_id)?.is_some() {
            stats.tags_proposed += 1;
            notes.proposed_tags.push(format!(
                "`{tag}` — {definition}{}",
                if evidence.is_empty() {
                    String::new()
                } else {
                    format!(" _(seen in: {})_", one_line(&evidence, 160))
                }
            ));
        }
    }
    Ok(())
}

/// Write a row's classification tags to `companion_node.tags_json` AND mirror
/// them into `companion_fts.tags` as `tag:<t>` tokens.
///
/// **Why a post-write update rather than a parameter on the writers.**
/// `FactInput` / `ProceduralInput` are constructed at five call sites across
/// `consolidation`, the op dispatcher and their tests, none of which have a tag
/// to give; threading an always-empty field through all of them to serve one
/// caller is ripple without meaning. The cost is honest and small: a crash
/// between the write and this update leaves an untagged memory, which is the
/// same state as a memory no cycle has classified yet — additive metadata, not
/// a broken invariant. If a second tagging caller ever appears, that is the
/// moment the parameter earns its ripple.
///
/// The FTS half is not optional. `keyword::search_kind` over `companion_fts` is
/// the ONLY retrieval lane the shipping (non-`ml`) build has, so a tag that
/// lives solely in `tags_json` classifies nothing anyone can find.
fn apply_tags(pool: &UserDbPool, node_id: &str, tags: &[String]) -> Result<(), AppError> {
    if tags.is_empty() {
        return Ok(());
    }
    let json = serde_json::to_string(tags)
        .map_err(|e| AppError::Internal(format!("encode tags for {node_id}: {e}")))?;
    let tokens = tags
        .iter()
        .map(|t| format!("tag:{t}"))
        .collect::<Vec<_>>()
        .join(" ");

    let conn = pool.get()?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE companion_node SET tags_json = ?1 WHERE id = ?2",
        params![json, node_id],
    )?;
    tx.execute(
        "UPDATE companion_fts SET tags = COALESCE(tags, '') || ' ' || ?1 WHERE node_id = ?2",
        params![tokens, node_id],
    )?;
    tx.commit()?;
    Ok(())
}
