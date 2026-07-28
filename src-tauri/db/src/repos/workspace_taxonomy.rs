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

// ============================================================================
// ftype — the SHAPE axis, closed for the same reason `topic` is
// ============================================================================
//
// `topic` answers WHERE a practice lives; `ftype` answers WHAT SHAPE it is.
// Only `topic` was ever enforced, and the 2026-07-27 twelve-territory scan
// showed exactly what that costs: 330 items produced **90 distinct ftypes**
// for a field designed with 11 — `guardrail`(18), `guard`(17), `convention`
// (13), `policy`(11), then a tail of singletons (`reliability-honesty`,
// `user-honesty`, `progressive-rendering`). That is the 154-topics-for-177-
// items fragmentation reproduced on the axis nobody closed, at 8x the rate,
// while the closed `topic` axis held at 5.8 items/topic.
//
// So: same closed list, same aliasing, same visible shelf. An unrecognized
// ftype lands on `unsorted` rather than being invented into the vocabulary or
// silently dropped — a filter over a field where every writer coins their own
// value is not a filter.

/// Closed shape vocabulary.
pub const FTYPES: &[&str] = &[
    "architecture",
    "module-boundary",
    "data-flow",
    "extensibility",
    "api-design",
    "state-mgmt",
    "error-strategy",
    "concurrency-reliability",
    "perf-strategy",
    "testing-strategy",
    "micro-technique",
];

/// One-line gloss per shape, shipped to agents so they classify instead of
/// coining. Written from what the scan's 90 improvised values were reaching
/// for — `guard`/`guardrail`/`trap`/`anti-pattern` are all error-strategy or
/// input-hardening in disguise, not new shapes.
pub const FTYPE_HINTS: &[(&str, &str)] = &[
    ("architecture", "the system's own skeleton — layering, ownership, what may depend on what"),
    ("module-boundary", "what one unit exposes and what it refuses to leak"),
    ("data-flow", "how a value travels and where it is transformed"),
    ("extensibility", "how a new case is added without editing the core"),
    ("api-design", "the shape of a call: arguments, return contract, naming"),
    ("state-mgmt", "who owns mutable state and when it changes"),
    ("error-strategy", "how failure is represented, guarded, degraded or surfaced (this covers guards, traps and anti-patterns)"),
    ("concurrency-reliability", "ordering, cancellation, retries, races, idempotency"),
    ("perf-strategy", "latency, throughput, memory, caching, budgets"),
    ("testing-strategy", "how the property is verified or pinned"),
    ("micro-technique", "a local idiom — the smallest useful shape"),
];

/// Aliases seen in the wild, mapped onto the closed list. Extend from real
/// drift, not from imagination.
const FTYPE_ALIASES: &[(&str, &str)] = &[
    ("guard", "error-strategy"),
    ("guardrail", "error-strategy"),
    ("trap", "error-strategy"),
    ("anti-pattern", "error-strategy"),
    ("failure-handling", "error-strategy"),
    ("failure-mode", "error-strategy"),
    ("fallback-strategy", "error-strategy"),
    ("resilience", "error-strategy"),
    ("safety", "error-strategy"),
    ("correctness", "error-strategy"),
    ("correctness-rule", "error-strategy"),
    ("invariant", "error-strategy"),
    ("concurrency-control", "concurrency-reliability"),
    ("state-machine", "state-mgmt"),
    ("state-pattern", "state-mgmt"),
    ("state-hygiene", "state-mgmt"),
    ("lifecycle", "state-mgmt"),
    ("sequencing", "concurrency-reliability"),
    ("perf-technique", "perf-strategy"),
    ("performance", "perf-strategy"),
    ("rendering-performance", "perf-strategy"),
    ("cache-strategy", "perf-strategy"),
    ("resource-discipline", "perf-strategy"),
    ("progressive-rendering", "perf-strategy"),
    ("contract", "api-design"),
    ("api-contract", "api-design"),
    ("data-contract", "api-design"),
    ("integration-contract", "api-design"),
    ("protocol", "api-design"),
    ("ux-contract", "api-design"),
    ("boundary", "module-boundary"),
    ("boundary-ownership", "module-boundary"),
    ("boundary-hardening", "module-boundary"),
    ("seam", "module-boundary"),
    ("chokepoint", "module-boundary"),
    ("structure", "architecture"),
    ("design-decision", "architecture"),
    ("decision-record", "architecture"),
    ("data-modeling", "data-flow"),
    ("data-pattern", "data-flow"),
    ("data-integrity", "data-flow"),
    ("persistence-pattern", "data-flow"),
    ("event-pattern", "data-flow"),
    ("test-strategy", "testing-strategy"),
    ("testability", "testing-strategy"),
    ("harness", "testing-strategy"),
    ("instrumentation", "micro-technique"),
    ("diagnostic", "micro-technique"),
    ("observability", "micro-technique"),
    ("recipe", "micro-technique"),
    ("checklist", "micro-technique"),
    ("convention", "micro-technique"),
    ("rule", "micro-technique"),
    ("design-rule", "micro-technique"),
    ("pattern", "micro-technique"),
    ("primitive", "micro-technique"),
    ("mechanism", "micro-technique"),
    ("algorithm", "micro-technique"),
    ("policy", "architecture"),
    ("config", "architecture"),
    ("configuration", "architecture"),
    ("rollout", "architecture"),
    ("workflow", "architecture"),
    ("maintainability", "architecture"),
    ("gate", "error-strategy"),
    ("consent-gate", "error-strategy"),
    ("security-control", "error-strategy"),
    ("denylist", "error-strategy"),
    ("user-honesty", "error-strategy"),
    ("reliability-honesty", "error-strategy"),
    ("ux", "micro-technique"),
    ("ui-pattern", "micro-technique"),
    ("a11y", "micro-technique"),
    ("abstraction", "architecture"),
    ("prompt-design", "api-design"),
    ("cross-language-consistency", "api-design"),
    ("integration-pitfall", "error-strategy"),
    ("liveness-detection", "concurrency-reliability"),
];

pub fn is_ftype(s: &str) -> bool {
    FTYPES.contains(&s)
}

/// Coerce any writer's ftype onto the closed list. `None`/empty stays `None`
/// (unset is honest); an unrecognized value lands on [`UNSORTED_LEAF`] so it
/// shows up as a shelf to be filed rather than a 90th private vocabulary word.
pub fn normalize_ftype(raw: Option<&str>) -> Option<String> {
    let raw = raw.unwrap_or("").trim();
    if raw.is_empty() {
        return None;
    }
    let s = slug(raw);
    if is_ftype(&s) {
        return Some(s);
    }
    if let Some((_, to)) = FTYPE_ALIASES.iter().find(|(from, _)| *from == s) {
        return Some((*to).to_string());
    }
    Some(UNSORTED_LEAF.to_string())
}

/// The ftype vocabulary rendered for an agent prompt.
pub fn ftype_prompt_block() -> String {
    let mut s = String::new();
    for (t, hint) in FTYPE_HINTS {
        s.push_str(&format!("- `{t}` — {hint}
"));
    }
    s
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
    fn ftype_closes_the_shape_axis() {
        // Exact hits and casing/spacing noise.
        assert_eq!(normalize_ftype(Some("error-strategy")).as_deref(), Some("error-strategy"));
        assert_eq!(normalize_ftype(Some("Error Strategy")).as_deref(), Some("error-strategy"));
        // The real drift from the 12-territory scan, mapped not invented.
        for raw in ["guard", "guardrail", "trap", "anti-pattern", "user-honesty"] {
            assert_eq!(
                normalize_ftype(Some(raw)).as_deref(),
                Some("error-strategy"),
                "{raw} should land on error-strategy"
            );
        }
        assert_eq!(normalize_ftype(Some("perf-technique")).as_deref(), Some("perf-strategy"));
        assert_eq!(normalize_ftype(Some("contract")).as_deref(), Some("api-design"));
        assert_eq!(normalize_ftype(Some("boundary")).as_deref(), Some("module-boundary"));
        // Unknown lands on a visible shelf, never a 90th private word.
        assert_eq!(normalize_ftype(Some("bespoke-nonsense")).as_deref(), Some(UNSORTED_LEAF));
        // Unset stays unset — "no shape given" is not "shape unknown".
        assert_eq!(normalize_ftype(None), None);
        assert_eq!(normalize_ftype(Some("   ")), None);
    }

    #[test]
    fn every_ftype_alias_targets_a_real_ftype() {
        // An alias pointing at a typo'd target would silently quarantine.
        for (from, to) in FTYPE_ALIASES {
            assert!(is_ftype(to), "alias {from} -> {to} is not a real ftype");
            assert!(!is_ftype(from), "alias {from} is already a canonical ftype");
        }
        for (t, _) in FTYPE_HINTS {
            assert!(is_ftype(t), "hint for unknown ftype {t}");
        }
        assert_eq!(FTYPE_HINTS.len(), FTYPES.len(), "every ftype needs a gloss");
    }

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
