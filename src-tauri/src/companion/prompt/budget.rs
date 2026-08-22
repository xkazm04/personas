//! What each named block is allowed to cost, and what it actually cost —
//! the per-block char budgets and the measured sizes reported back.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

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

/// The declared char budget for a named block, or `None` for a block that has
/// none. Public so the churn instrument can report "this block changed on 14
/// of 20 turns *and* it is 4.4× its budget" in one row — the two halves of the
/// same growth story were previously in two different places.
pub fn budget_for(block: &str) -> Option<usize> {
    BLOCK_BUDGETS
        .iter()
        .find(|(name, _)| *name == block)
        .map(|(_, max)| *max)
}

// ── Per-block content hash ──────────────────────────────────────────────
//
// Sizes alone cannot answer the question the cache bill asks. Athena's chat
// `cache_creation_tokens` climbed 239,852 → 305,401 turn over turn, which
// means the prompt's stable prefix is not stable — something above the
// volatile line is being rewritten every turn and invalidating the cache.
// A block can hold its char count to the byte and still churn its content
// (a reordered list, a re-rendered timestamp), so "did this block change
// since the previous turn?" needs the content itself, not its length.
//
// FNV-1a 64 is deliberate: no new dependency, stable across processes and
// releases (unlike `std::hash::DefaultHasher`, whose output is explicitly
// not guaranteed between Rust versions — a churn series must survive an
// upgrade or it measures the toolchain instead of the prompt), and 64 bits
// is far more than enough to distinguish "same text" from "different text"
// across a few hundred ledger rows.

const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// Char count + FNV-1a-64 hash over the concatenation of `parts`, in the
/// order given.
///
/// For the two composite buckets (`recall` folds six memory sections,
/// `static_addenda` folds two) the order here is the bucket's own canonical
/// order, *not* compose()'s push order — the six recall sections are
/// interleaved with `observability` in the real prompt, so there is no single
/// contiguous run to mirror. That is fine and deliberate: the hash answers
/// "is this bucket's content the same as last turn", which any fixed order
/// answers correctly. It must simply never change, or every historical
/// comparison breaks.
pub(super) fn block_stat(parts: &[&str]) -> (usize, u64) {
    let mut chars = 0usize;
    let mut hash = FNV_OFFSET_BASIS;
    for part in parts {
        chars += part.len();
        for byte in part.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(FNV_PRIME);
        }
    }
    (chars, hash)
}

/// Per-block char counts for one composed system prompt.
///
/// `total` is the real `composed.len()`, so it is slightly larger than the
/// sum of the blocks — the difference is compose()'s own fixed scaffolding
/// (the `# Identity (live, evolves)` heading and friends), a couple of
/// dozen chars that would only add noise as its own bucket.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PromptBlockSizes {
    pub(super) blocks: Vec<(&'static str, usize)>,
    /// Same block names, same order, FNV-1a-64 of each block's exact bytes.
    /// Kept as a sibling vec rather than widening `blocks` so `to_json()`'s
    /// on-the-wire shape (a flat `{name: chars}` map, already written to
    /// ~1,600 ledger rows) stays byte-identical.
    pub(super) hashes: Vec<(&'static str, u64)>,
    pub(super) total: usize,
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

    /// `{"constitution": "8f3a1c…", "identity": "0b27…", …}` — the churn
    /// half of the instrument, written to `companion_turn.
    /// prompt_block_hashes_json` next to `to_json()`'s sizes. Hex so the
    /// column stays human-readable in a sqlite shell and JSON never has to
    /// carry a u64 through a f64.
    ///
    /// A NEW column rather than a widened `prompt_blocks_json` on purpose:
    /// changing the size map's shape would have forced every reader (and
    /// every historical row) to tolerate two encodings forever. Additive
    /// columns are the convention this ledger already follows.
    pub fn hashes_json(&self) -> Option<String> {
        let map: serde_json::Map<String, serde_json::Value> = self
            .hashes
            .iter()
            .map(|(name, hash)| {
                (
                    (*name).to_string(),
                    serde_json::json!(format!("{hash:016x}")),
                )
            })
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
