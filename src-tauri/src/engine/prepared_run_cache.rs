use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::db::models::{Persona, PersonaToolDefinition};
use crate::db::repos::core::memories::TieredMemories;

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

pub fn cache_key(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    input_data: Option<&serde_json::Value>,
    workspace_instructions: Option<&str>,
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
