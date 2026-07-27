//! The workspace practice taxonomy — a CLOSED, precedence-ordered vocabulary
//! for `workspace_knowledge.topic`.
//!
//! ## Why this exists
//!
//! `topic` started free-form. Thirteen parallel harvest agents each invented
//! their own slash-path for the same concept and produced **154 topics for 177
//! items** — a flat list wearing a tree's clothes. A regex normalization pass
//! collapsed the top level but, matching on path strings rather than content,
//! left a dozen `general` catch-alls and the same leaf name (`contracts`,
//! `boundaries`, `result-contracts`) meaning different things under three
//! different areas. The durable fix is not periodic renormalization; it is
//! constraining the vocabulary at the door every writer passes through.
//!
//! ## The two rules
//!
//! 1. **`topic` answers WHERE a practice lives** — which concern or subsystem
//!    it governs. It does NOT answer what *shape* the practice is; that is the
//!    separate `ftype` column. A repository-behind-one-interface practice is
//!    `data/store-boundary` (the subject is persistence) even though its shape
//!    is a module boundary. When the two columns both encoded shape,
//!    `architecture` swallowed a third of the library.
//!
//! 2. **Areas are precedence-ordered.** Most practices touch several at once —
//!    a metered LLM route is billing AND llm AND api. Walk [`TAXONOMY`] top to
//!    bottom and take the first area that genuinely governs: if the practice
//!    would be meaningless without that concern, it governs. Without a stated
//!    tiebreak every writer picks differently, which is how the library
//!    fragmented in the first place.
//!
//! ## Growth
//!
//! The AREA list is closed; the cluster lists are a **starter vocabulary, not a
//! cage**. [`normalize_topic`] keeps an unrecognized cluster under a recognized
//! area verbatim — that is how the taxonomy grows as the workspace does. Only
//! an unrecognized *area* is quarantined, because a new top-level area is the
//! decision that actually re-fragments the tree, and it should be a human's.

/// Areas in precedence order, each with its starter cluster vocabulary.
/// Order is load-bearing — see rule 2 above.
pub const TAXONOMY: &[(&str, &[&str])] = &[
    ("security", &["trust-boundaries", "secrets", "input-hardening"]),
    ("auth", &["tenancy", "authorization", "tokens", "session"]),
    ("billing", &["metering", "charge-reclaim", "limits"]),
    ("llm", &["chokepoint", "providers", "quality-gates", "prompt-safety", "orchestration", "retrieval"]),
    ("testing", &["strategy", "coverage", "harnesses", "parity", "testability"]),
    ("observability", &["logging", "telemetry", "diagnostics"]),
    ("performance", &["hot-paths", "caching", "resource-limits"]),
    ("errors", &["result-contracts", "classification", "degradation", "surfacing"]),
    ("concurrency", &["pipelines", "queues", "cancellation", "rate-limiting", "retry-idempotency"]),
    ("data", &["store-boundary", "migrations", "modeling", "write-semantics", "queries"]),
    ("api", &["request-pipeline", "routing", "client-seam"]),
    ("frontend", &["state", "data-fetching", "components", "forms"]),
    ("integration", &["external-services", "protocol-contracts", "resilience"]),
    ("architecture", &["boundaries", "layering", "chokepoints", "extensibility", "contract-artifacts", "events"]),
    ("process", &["adr-discipline", "documentation", "enforcement", "readiness", "knowledge", "outcomes"]),
];

/// One-line gloss per area, shipped to agents so they can apply the precedence
/// rule instead of guessing from the bare word.
pub const AREA_HINTS: &[(&str, &str)] = &[
    ("security", "trust boundaries, secrets, hostile input"),
    ("auth", "who the caller is and what they may touch"),
    ("billing", "money and metered resource accounting"),
    ("llm", "model-specific concerns"),
    ("testing", "how correctness is verified"),
    ("observability", "seeing what the system did"),
    ("performance", "latency, throughput, resource cost"),
    ("errors", "how failures are represented and handled"),
    ("concurrency", "long-running, parallel, or interruptible work"),
    ("data", "persistence"),
    ("api", "the server request/response seam"),
    ("frontend", "UI, client state, forms"),
    ("integration", "other systems"),
    ("architecture", "the codebase's OWN structure — only when no subsystem above governs"),
    ("process", "how the work itself is done"),
];

/// Where a topic goes when its area is unrecognized. A visible shelf beats a
/// silent guess: it shows up in the library tree as a queue to be filed.
pub const UNSORTED: &str = "unsorted/needs-topic";

/// Cluster used when a recognized area arrives with no usable second segment.
pub const UNSORTED_LEAF: &str = "unsorted";

/// Historical area names → canonical. Covers the pre-taxonomy vocabulary so a
/// re-ingest of old material, or an agent working from a stale prompt, still
/// lands on a real shelf instead of in quarantine.
const AREA_ALIASES: &[(&str, &str)] = &[
    ("ui", "frontend"),
    ("state", "frontend"),
    ("forms", "frontend"),
    ("data-flow", "data"),
    ("code-quality", "process"),
    ("reliability", "errors"),
    ("cost", "billing"),
    ("product", "process"),
    ("perf", "performance"),
    ("observability-telemetry", "observability"),
];

/// Is this an area we recognize?
pub fn is_area(area: &str) -> bool {
    TAXONOMY.iter().any(|(a, _)| *a == area)
}

/// Is this topic in the starter vocabulary exactly? A `false` here is not an
/// error — clusters grow (see module docs) — it just means "not one of the
/// seeded shelves", which is useful for reporting drift.
pub fn is_canonical(topic: &str) -> bool {
    match topic.split_once('/') {
        Some((a, c)) => TAXONOMY
            .iter()
            .any(|(area, clusters)| *area == a && clusters.contains(&c)),
        None => false,
    }
}

/// Reduce free text to a kebab-case path segment.
fn slug(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_dash = false;
    for ch in s.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !out.is_empty() && !prev_dash {
            // spaces, underscores, dots, anything else → a single dash
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// Coerce any writer's topic onto the taxonomy.
///
/// - always exactly two segments (a third level over a few hundred items is
///   guaranteed singletons — the tree stops being navigable)
/// - unrecognized area → [`UNSORTED`]
/// - recognized area, unrecognized cluster → **kept**, this is the growth path
/// - recognized area, no cluster → `<area>/unsorted`
pub fn normalize_topic(raw: Option<&str>) -> String {
    let raw = raw.unwrap_or("").trim();
    if raw.is_empty() {
        return UNSORTED.to_string();
    }
    let mut parts = raw.split('/').map(slug).filter(|s| !s.is_empty());
    let Some(first) = parts.next() else {
        return UNSORTED.to_string();
    };
    let area = AREA_ALIASES
        .iter()
        .find(|(from, _)| *from == first)
        .map(|(_, to)| (*to).to_string())
        .unwrap_or(first);
    if !is_area(&area) {
        return UNSORTED.to_string();
    }
    match parts.next() {
        Some(cluster) => format!("{area}/{cluster}"),
        None => format!("{area}/{UNSORTED_LEAF}"),
    }
}

/// The taxonomy rendered for an agent prompt — the closed area list in
/// precedence order with its starter clusters.
pub fn prompt_block() -> String {
    let mut s = String::new();
    for (i, (area, clusters)) in TAXONOMY.iter().enumerate() {
        let hint = AREA_HINTS
            .iter()
            .find(|(a, _)| a == area)
            .map(|(_, h)| *h)
            .unwrap_or("");
        s.push_str(&format!(
            "{:>2}. {area} — {hint}\n      {}\n",
            i + 1,
            clusters.join(", ")
        ));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn areas_and_clusters_are_unique_and_kebab() {
        let mut seen = std::collections::HashSet::new();
        for (area, clusters) in TAXONOMY {
            assert!(seen.insert(*area), "duplicate area {area}");
            assert!(
                area.chars().all(|c| c.is_ascii_lowercase() || c == '-'),
                "area {area} is not kebab-case"
            );
            let mut leaf_seen = std::collections::HashSet::new();
            for c in *clusters {
                assert!(leaf_seen.insert(*c), "duplicate cluster {area}/{c}");
                assert!(
                    c.chars().all(|ch| ch.is_ascii_lowercase() || ch == '-'),
                    "cluster {area}/{c} is not kebab-case"
                );
            }
        }
        // Every area carries a gloss — the prompt block is useless without it.
        for (area, _) in TAXONOMY {
            assert!(
                AREA_HINTS.iter().any(|(a, _)| a == area),
                "area {area} has no hint"
            );
        }
    }

    #[test]
    fn aliases_point_at_real_areas() {
        for (from, to) in AREA_ALIASES {
            assert!(is_area(to), "alias {from} -> {to} is not an area");
            assert!(!is_area(from), "alias {from} shadows a real area");
        }
    }

    #[test]
    fn normalizes_shape() {
        assert_eq!(normalize_topic(Some("data/store-boundary")), "data/store-boundary");
        assert_eq!(normalize_topic(Some("  Data / Store Boundary ")), "data/store-boundary");
        assert_eq!(normalize_topic(Some("data/store_boundary")), "data/store-boundary");
        // depth capped at two — a third level guarantees singletons
        assert_eq!(normalize_topic(Some("data/store-boundary/pooling")), "data/store-boundary");
        // area with no cluster gets a visible shelf, not an invented leaf
        assert_eq!(normalize_topic(Some("data")), "data/unsorted");
        assert_eq!(normalize_topic(Some("data/")), "data/unsorted");
    }

    #[test]
    fn unknown_area_is_quarantined_but_new_cluster_is_kept() {
        // A new AREA re-fragments the tree — that decision stays human.
        assert_eq!(normalize_topic(Some("blockchain/consensus")), UNSORTED);
        assert_eq!(normalize_topic(None), UNSORTED);
        assert_eq!(normalize_topic(Some("   ")), UNSORTED);
        // A new CLUSTER under a real area is how the taxonomy grows.
        let grown = normalize_topic(Some("data/sharding"));
        assert_eq!(grown, "data/sharding");
        assert!(!is_canonical(&grown), "new cluster is not yet starter vocabulary");
        assert!(is_canonical("data/store-boundary"));
    }

    #[test]
    fn legacy_vocabulary_lands_on_real_shelves() {
        assert_eq!(normalize_topic(Some("ui/components")), "frontend/components");
        assert_eq!(normalize_topic(Some("state/client-stores")), "frontend/client-stores");
        assert_eq!(normalize_topic(Some("data-flow/pipelines")), "data/pipelines");
        assert_eq!(normalize_topic(Some("cost/llm")), "billing/llm");
    }

    #[test]
    fn prompt_block_lists_every_area_in_precedence_order() {
        let block = prompt_block();
        for (area, _) in TAXONOMY {
            assert!(block.contains(area), "{area} missing from prompt block");
        }
        let sec = block.find("security").unwrap();
        let arch = block.find("architecture").unwrap();
        assert!(sec < arch, "precedence order must survive into the prompt");
    }
}
