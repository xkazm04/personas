use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use personas_db::models::{Persona, PersonaResponsibility, PersonaToolDefinition};
use personas_db::repos::core::memories::TieredMemories;

const PREPARED_RUN_TTL: Duration = Duration::from_secs(5 * 60);
const MAX_PREPARED_RUNS: usize = 64;

#[derive(Clone)]
pub struct PreparedRunBlob {
    pub prompt_text: String,
    pub memory_ids: Vec<String>,
}

struct CacheEntry {
    blob: PreparedRunBlob,
    created_at: Instant,
}

static PREPARED_RUN_CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();

fn cache() -> &'static Mutex<HashMap<String, CacheEntry>> {
    PREPARED_RUN_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Cache key over everything the speculative prompt was assembled from.
///
/// `responsibilities` — the persona's ACTIVE charters (same slice the caller
/// passed into `assemble_prompt_with_skills`). Keyed by `id + updated_at +
/// status`: every content edit bumps `updated_at` and every lifecycle move
/// changes `status`, so a charter edit invalidates the prepared blob.
/// `core_profile` rides on the persona struct and is hashed directly.
///
/// Episodes are DELIBERATELY absent: they append on every run, so keying on
/// them would make the cache never hit. The blob's episodic tail is at most
/// `PREPARED_RUN_TTL` (5 min) stale, which is the accepted trade.
pub fn cache_key(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    input_data: Option<&serde_json::Value>,
    workspace_instructions: Option<&str>,
    responsibilities: &[PersonaResponsibility],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(persona.id.as_bytes());
    hasher.update(b"\0");
    hasher.update(persona.system_prompt.as_bytes());
    hasher.update(b"\0");
    hasher.update(
        persona
            .structured_prompt
            .as_deref()
            .unwrap_or("")
            .as_bytes(),
    );
    hasher.update(b"\0");
    hasher.update(persona.design_context.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"\0");
    hasher.update(persona.model_profile.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"\0");
    hasher.update(persona.core_profile.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"\0");
    hasher.update(workspace_instructions.unwrap_or("").as_bytes());
    hasher.update(b"\0");
    hasher.update(serde_json::to_string(tools).unwrap_or_default().as_bytes());
    hasher.update(b"\0");
    hasher.update(
        input_data
            .and_then(|value| serde_json::to_string(value).ok())
            .unwrap_or_default()
            .as_bytes(),
    );
    for r in responsibilities {
        hasher.update(b"\0resp\x1f");
        hasher.update(r.id.as_bytes());
        hasher.update(b"\x1f");
        hasher.update(r.updated_at.as_bytes());
        hasher.update(b"\x1f");
        hasher.update(r.status.as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

pub fn get(key: &str) -> Option<PreparedRunBlob> {
    let mut guard = cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_expired(&mut guard);
    guard.get(key).map(|entry| entry.blob.clone())
}

pub fn insert(key: String, blob: PreparedRunBlob) {
    let mut guard = cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_expired(&mut guard);
    if guard.len() >= MAX_PREPARED_RUNS {
        if let Some(oldest_key) = guard
            .iter()
            .min_by_key(|(_, entry)| entry.created_at)
            .map(|(key, _)| key.clone())
        {
            guard.remove(&oldest_key);
        }
    }
    guard.insert(
        key,
        CacheEntry {
            blob,
            created_at: Instant::now(),
        },
    );
}

pub fn append_memories(
    prompt_text: String,
    tiered: &TieredMemories,
) -> (String, Vec<String>, usize, usize) {
    if tiered.core.is_empty() && tiered.active.is_empty() {
        return (prompt_text, Vec::new(), 0, 0);
    }

    let mut mem_section = String::new();
    if !tiered.core.is_empty() {
        mem_section.push_str("\n\n## Agent Memory — Core Beliefs\n\n");
        mem_section.push_str("These are your established principles and preferences learned over many interactions. Treat them as strong defaults.\n\n");
        for m in &tiered.core {
            mem_section.push_str(&format!(
                "- **{}** [{}]: {}\n",
                m.title, m.category, m.content
            ));
        }
    }

    if !tiered.active.is_empty() {
        mem_section.push_str("\n\n## Agent Memory — Recent Learnings\n\n");
        mem_section.push_str(
            "Context from recent work. Use to inform your analysis and avoid repeating past mistakes.\n\n",
        );
        for m in &tiered.active {
            mem_section.push_str(&format!(
                "- **{}** [{}] (importance: {}): {}\n",
                m.title, m.category, m.importance, m.content
            ));
        }
    }

    mem_section.push('\n');
    let memory_ids = tiered
        .core
        .iter()
        .chain(tiered.active.iter())
        .map(|m| m.id.clone())
        .collect();
    (
        format!("{prompt_text}{mem_section}"),
        memory_ids,
        tiered.core.len(),
        tiered.active.len(),
    )
}

fn prune_expired(cache: &mut HashMap<String, CacheEntry>) {
    let now = Instant::now();
    cache.retain(|_, entry| now.duration_since(entry.created_at) <= PREPARED_RUN_TTL);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prompt::tests::test_persona;

    fn charter(id: &str, updated_at: &str) -> PersonaResponsibility {
        PersonaResponsibility {
            id: id.into(),
            persona_id: "test-id".into(),
            title: "Keep the docs honest".into(),
            domain: "docs".into(),
            status: "active".into(),
            updated_at: updated_at.into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            ..Default::default()
        }
    }

    /// Living-agent invalidation contract: the prepared blob must not be
    /// reused across a Core (dial) edit or a charter edit — both change the
    /// assembled prompt, and the TTL alone is too slow a fence.
    #[test]
    fn cache_key_reacts_to_core_profile_and_charter_edits() {
        let persona = test_persona();
        let base = cache_key(&persona, &[], None, None, &[]);

        // Dial edit: core_profile changes → key changes.
        let mut with_core = test_persona();
        with_core.core_profile = Some(r#"{"motivation":"m","stance":"s","northStarCommitment":"n","riskTolerance":0.2,"speedVsQuality":0.5,"conflictStyle":"analyst","deference":0.5}"#.into());
        let core_key = cache_key(&with_core, &[], None, None, &[]);
        assert_ne!(base, core_key, "a Core edit must invalidate the blob");

        let mut dial_edited = with_core.clone();
        dial_edited.core_profile = Some(
            with_core
                .core_profile
                .clone()
                .unwrap()
                .replace("0.2", "0.9"),
        );
        assert_ne!(
            core_key,
            cache_key(&dial_edited, &[], None, None, &[]),
            "a single dial change must invalidate the blob"
        );

        // Charter set / charter edit → key changes; identical inputs agree.
        let r1 = charter("resp_1", "2026-01-02T00:00:00Z");
        let charter_key = cache_key(&persona, &[], None, None, std::slice::from_ref(&r1));
        assert_ne!(base, charter_key, "gaining a charter must invalidate");
        let r1_edited = charter("resp_1", "2026-01-03T00:00:00Z");
        assert_ne!(
            charter_key,
            cache_key(&persona, &[], None, None, std::slice::from_ref(&r1_edited)),
            "a charter edit (updated_at bump) must invalidate"
        );
        assert_eq!(
            charter_key,
            cache_key(&persona, &[], None, None, std::slice::from_ref(&r1)),
            "identical inputs must agree (the cache has to be able to HIT)"
        );
    }
}
