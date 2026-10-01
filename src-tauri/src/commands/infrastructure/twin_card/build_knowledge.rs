//! Database -> card: the knowledge part (SPEC.md 6), approved memories and
//! self-facts only. A fact scoped to a contact never enters, and neither does
//! an approved memory queued from a message with someone else: its title
//! names them and its body quotes them (SPEC.md 1).

use std::collections::HashSet;

use super::build::cap;
use super::stamp;
use super::types::{
    char_len, CardFact, CardKnowledge, CardMemory, FACTS_MAX, FACT_CONTENT_MAX, MEMORIES_MAX,
    MEMORY_CONTENT_MAX, MEMORY_TITLE_MAX,
};
use crate::db::models::TwinDistilledFact;
use crate::db::repos::twin as twin_repo;
use crate::db::DbPool;
use crate::engine::twin_prompt::input::level;
use crate::error::AppError;

pub(super) fn knowledge_part(
    pool: &DbPool,
    twin_id: &str,
    warnings: &mut Vec<String>,
) -> Result<CardKnowledge, AppError> {
    let third_party: HashSet<String> = twin_repo::third_party_memory_ids(pool, twin_id)?
        .into_iter()
        .collect();
    let mut approved = twin_repo::list_pending_memories(pool, twin_id, Some("approved"), None)?;
    let before = approved.len();
    approved.retain(|m| !third_party.contains(&m.id));
    if approved.len() < before {
        warnings.push(format!(
            "{} approved {} came from messages with other people and stayed out of the card.",
            before - approved.len(),
            if before - approved.len() == 1 {
                "memory"
            } else {
                "memories"
            }
        ));
    }
    // Newest first by instant, not by text: the table mixes timestamp styles.
    approved.sort_by_key(|m| std::cmp::Reverse(stamp::parse_any(&m.created_at)));

    let mut memories = Vec::new();
    let mut unfit = 0usize;
    for m in &approved {
        let observed_at = stamp::to_card(&m.created_at);
        let fits_card = !m.content.trim().is_empty()
            && char_len(&m.content) <= MEMORY_CONTENT_MAX
            && !m
                .title
                .as_deref()
                .is_some_and(|t| char_len(t) > MEMORY_TITLE_MAX);
        match observed_at {
            Some(observed_at) if fits_card => memories.push(CardMemory {
                title: m.title.clone(),
                content: m.content.clone(),
                observed_at,
                source: m.channel.clone(),
                importance: level(m.importance),
            }),
            _ => unfit += 1,
        }
    }
    if unfit > 0 {
        warnings.push(format!(
            "{unfit} approved {} left out: empty, longer than {MEMORY_CONTENT_MAX} characters (title {MEMORY_TITLE_MAX}), or with an unreadable date.",
            if unfit == 1 { "memory was" } else { "memories were" }
        ));
    }
    cap(&mut memories, MEMORIES_MAX, "approved memories", warnings);

    let mut facts: Vec<CardFact> = Vec::new();
    let mut long_facts = 0usize;
    for f in twin_repo::list_distilled_facts(pool, twin_id, None)?
        .iter()
        .filter(|f| is_self_fact(f) && !f.content.trim().is_empty())
    {
        if char_len(&f.content) > FACT_CONTENT_MAX {
            long_facts += 1;
            continue;
        }
        facts.push(CardFact {
            content: f.content.clone(),
            importance: level(f.importance),
        });
    }
    if long_facts > 0 {
        warnings.push(format!(
            "{long_facts} {} longer than {FACT_CONTENT_MAX} characters left out.",
            if long_facts == 1 {
                "fact was"
            } else {
                "facts were"
            }
        ));
    }
    cap(&mut facts, FACTS_MAX, "facts", warnings);
    Ok(CardKnowledge { memories, facts })
}

/// A fact with no contact scope is about the person (the compiler's own
/// rule in `twin_prompt::input`, kept identical so a card and the database
/// agree on what is a self-fact).
fn is_self_fact(fact: &TwinDistilledFact) -> bool {
    !fact
        .contact_handle
        .as_deref()
        .is_some_and(|handle| !handle.trim().is_empty())
}
