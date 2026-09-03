//! Hybrid retrieval bundling memory into the working context for each turn.
//!
//! Three lanes feed the bundle:
//!
//! 1. **Keyword (BM25)** over `companion_fts` — [`super::keyword`]. Needs no
//!    embedder, so it runs in EVERY build. This is the lane that makes recall
//!    depend on the question at all: before it existed, the non-ml build (the
//!    one that actually ships) returned the same N most-recent episodes and the
//!    same top-N facts on every single turn, with `doctrine` hard-coded empty.
//! 2. **Vector (vec0 KNN)** — `ml`-gated, layered on top of the keyword lane.
//! 3. **Always-include tiers** — top facts / procedurals by importance, active
//!    goals, open backlog. Query-independent by design: Athena shouldn't need
//!    the user to phrase a query that happens to match a fact's wording.
//!
//! ### The episode window is a budget, not a per-lane quota
//!
//! Both paths target [`RECALL_EPISODE_TARGET`] total episodes: query-relevant
//! older turns first (keyword + vector), then a recency tail sized to fill
//! whatever is left. That is deliberate — the ml path used to hard-code a
//! 5-turn recency tail on the assumption that the vector lane would contribute
//! ~12 more, but with zero embedded episodes it contributed zero, so the ml
//! path would have delivered FEWER memories than the non-ml one. Sizing the
//! tail from what the other lanes actually returned makes the asymmetry
//! structurally impossible rather than a tuning coincidence.

use std::collections::{HashMap, HashSet};
#[cfg(feature = "ml")]
use std::sync::Arc;

use crate::companion::brain::backlog::{self, BacklogItem};
use crate::companion::brain::consolidation;
#[cfg(feature = "ml")]
use crate::companion::brain::embeddings;
use crate::companion::brain::episodic::{self, Episode};
use crate::companion::brain::goals::{self, Goal};
use crate::companion::brain::keyword;
use crate::companion::brain::procedural::{self, Procedural};
use crate::companion::brain::semantic::{self, Fact};
use crate::companion::brain::util;
use crate::db::UserDbPool;
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;
#[cfg(feature = "ml")]
use crate::retrieval::{filter_by_distance_floor, rank_into_lanes, Lane, MAX_VECTOR_DISTANCE};

#[cfg(feature = "ml")]
const RECENCY_TURNS: u32 = 5;
#[cfg(feature = "ml")]
const VECTOR_EPISODE_TOPK: usize = 12;
#[cfg(feature = "ml")]
const VECTOR_DOCTRINE_TOPK: usize = 8;
#[cfg(feature = "ml")]
const VECTOR_FACT_TOPK: usize = 8;
/// We pull this many vec0 hits in one go and split by kind in app code.
/// vec0 doesn't natively support kind-filtered MATCH, and the search
/// itself is the expensive part. Generous so kind-imbalanced corpora
/// don't starve one tier.
#[cfg(feature = "ml")]
const VECTOR_OVERFETCH: usize = 80;
/// Total episodes in the recall window, however they were retrieved. Both the
/// ml and non-ml paths converge on this number: query-relevant older turns
/// first, recency tail for the remainder. (Was `FALLBACK_LIMIT`, used only by
/// the non-ml/cold-start arms while the ml arm hard-coded 5.)
const RECALL_EPISODE_TARGET: u32 = 20;
/// Floor on the recency tail. Even when every other lane is saturated, the
/// last few turns of the actual conversation always ride along — losing the
/// immediately-preceding turn to a well-matched older one would be a worse
/// failure than a slightly oversized window.
const RECENCY_FLOOR: u32 = 6;
/// Keyword-lane caps. Deliberately smaller than the recency tail: keyword hits
/// are *additional* context, not a replacement for the live conversation.
const KEYWORD_EPISODE_TOPK: usize = 6;
/// How many of [`KEYWORD_EPISODE_TOPK`]'s slots a **machine correlator record**
/// may occupy.
///
/// Machine records are deliberately still eligible for the keyword lane — "what
/// happened with fleet session abc" should surface one — but on the live corpus
/// they are 92.7% of all episodes (a two-day Fleet load test wrote 10,417 of
/// them), and a terse fleet-vocabulary question takes all six slots with them,
/// leaving the window with no conversation an older turn could have supplied.
/// Two is a third of the lane: enough that a genuine fleet question is answered
/// from memory, not enough for a load test to evict the conversation.
const KEYWORD_EPISODE_MACHINE_CAP: usize = 2;
const KEYWORD_DOCTRINE_TOPK: usize = 6;
const KEYWORD_FACT_TOPK: usize = 4;
const KEYWORD_PROCEDURAL_TOPK: usize = 3;
/// Always include the top-N facts by importance (regardless of vector
/// hits) so Athena gets a stable view of who the user is even on
/// off-topic queries. Cheap; small list.
const ALWAYS_INCLUDE_TOP_FACTS: u32 = 6;
/// Active goals are always surfaced — the user shouldn't have to remind
/// Athena what they're working toward. Capped to keep the prompt short.
const ALWAYS_INCLUDE_ACTIVE_GOALS: u32 = 8;
/// Top-by-importance procedurals always included so behavioral rules
/// stay in force regardless of query phrasing.
const ALWAYS_INCLUDE_TOP_PROCEDURALS: u32 = 6;
/// Open backlog items: if Athena committed to something, she should
/// see it next turn. Cap is conservative — long backlogs become noise.
const ALWAYS_INCLUDE_OPEN_BACKLOG: u32 = 6;
/// Vector top-K for procedurals matched against the user's query.
#[cfg(feature = "ml")]
const VECTOR_PROCEDURAL_TOPK: usize = 4;
// The relevance floor (MAX_VECTOR_DISTANCE = 1.30) and its rationale moved to
// `crate::retrieval` (the unified retrieval lane) together with the
// distance-floor / lane-ranking primitives — imported above under `ml`.
/// Doctrine rides its own kind-scoped scan (see `search_similar_kind`); fetch
/// a little wider than the top-K so the distance floor has headroom to trim.
#[cfg(feature = "ml")]
const VECTOR_DOCTRINE_FETCH: usize = 24;

/// What the prompt builder gets back per turn.
#[derive(Debug, Default)]
pub struct Recall {
    pub episodes: Vec<Episode>,
    pub doctrine: Vec<DoctrineHit>,
    pub facts: Vec<Fact>,
    pub procedurals: Vec<Procedural>,
    pub goals: Vec<Goal>,
    pub backlog: Vec<BacklogItem>,
    /// Why each of the above is here, and what was measured and rejected.
    pub trace: RecallTrace,
}

/// Which lane put a memory into this turn's recall.
///
/// Retrieval has always known this — it is the difference between a lane's
/// `selected` list and the keyword union that follows it — but the answer was
/// discarded one frame after it was computed, so nothing downstream could tell
/// a semantic hit from a query-independent floor entry.
///
/// `Vector` is unreachable on a non-`ml` build — there is no vector lane to
/// produce it — but the variant stays so the wire shape is identical across
/// both builds and the UI needs no second case.
#[cfg_attr(not(feature = "ml"), allow(dead_code))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecallLane {
    /// Vector KNN hit that cleared the relevance floor.
    Vector,
    /// BM25 keyword hit over `companion_fts`.
    Keyword,
    /// A query-independent tier: top facts, active goals, open backlog. These
    /// are in every turn's recall regardless of what was asked, and labelling
    /// them as matches would overstate what retrieval actually found.
    AlwaysOn,
    /// The recency tail — recent conversation, included because it is recent.
    Recency,
}

impl RecallLane {
    /// Stable wire name. The UI keys on this, so it is never localised.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Vector => "vector",
            Self::Keyword => "keyword",
            Self::AlwaysOn => "always",
            Self::Recency => "recency",
        }
    }
}

/// Per-turn provenance for the recall the prompt was built from.
///
/// The two numbers that matter are the ones that used to exist only inside a
/// `tracing::debug!`: each hit's L2 distance, and how many hits were measured
/// and then rejected for falling outside the relevance floor. Without the
/// second, an operator tuning that floor is working blind — which is exactly
/// how `MAX_VECTOR_DISTANCE` was set.
#[derive(Debug, Clone, Default)]
pub struct RecallTrace {
    /// node id -> (lane, L2 distance when the vector lane produced it).
    entries: HashMap<String, (RecallLane, Option<f32>)>,
    /// Hits that were retrieved and then rejected by the relevance floor.
    pub dropped_far: usize,
    /// The floor they were measured against. `None` on a build with no vector
    /// lane, where there is no threshold to report and showing one would be a
    /// fiction.
    pub floor: Option<f32>,
}

impl RecallTrace {
    /// Record a vector hit and its distance. First write wins, so a node that
    /// several lanes reach keeps its strongest provenance.
    #[cfg_attr(not(feature = "ml"), allow(dead_code))]
    pub fn record_vector(&mut self, id: &str, distance: f32) {
        self.entries
            .entry(id.to_string())
            .or_insert((RecallLane::Vector, Some(distance)));
    }

    /// Record a non-vector lane, without displacing a vector hit.
    pub fn record(&mut self, id: &str, lane: RecallLane) {
        self.entries.entry(id.to_string()).or_insert((lane, None));
    }

    /// Record a whole tier at once.
    pub fn record_all<'a>(&mut self, ids: impl IntoIterator<Item = &'a String>, lane: RecallLane) {
        for id in ids {
            self.record(id, lane);
        }
    }

    /// The lane that produced `id`.
    ///
    /// Defaults to [`RecallLane::Keyword`] rather than to an "unknown" variant:
    /// the keyword union is the last step of both retrieval arms, so anything
    /// that reached the prompt without being recorded above came from it. An
    /// `Unknown` here would show up in the UI as a shrug on the majority of
    /// entries.
    pub fn lane_of(&self, id: &str) -> RecallLane {
        self.entries
            .get(id)
            .map_or(RecallLane::Keyword, |(lane, _)| *lane)
    }

    /// Relevance in `0.0..=1.0`, nearest-first, or `None` for a non-vector
    /// entry.
    ///
    /// L2 distance is unbounded and smaller-is-better, which is the wrong
    /// shape for a bar. This maps it against the floor the hit had to clear:
    /// distance 0 reads 1.0, a hit sitting exactly on the floor reads 0.0. The
    /// mapping is linear and monotone, so the ORDER shown is always the order
    /// retrieval used — it is a rescale for display, never a re-rank.
    pub fn relevance_of(&self, id: &str) -> Option<f32> {
        let (_, distance) = self.entries.get(id)?;
        let distance = (*distance)?;
        let floor = self.floor?;
        if floor <= 0.0 {
            return None;
        }
        Some((1.0 - distance / floor).clamp(0.0, 1.0))
    }
}

#[derive(Debug, Clone)]
pub struct DoctrineHit {
    /// The `companion_node` id this chunk was retrieved as. Read from SQL all
    /// along and then dropped on the floor; it is the only key that joins a
    /// hydrated chunk back to the lane and distance that selected it.
    pub node_id: String,
    /// `<rel_path>#<heading_anchor>`, e.g.
    /// `concepts/persona-capabilities/00-vision.md#the-mental-model-we-want`.
    pub file_path: String,
    /// Markdown body of the chunk (full content from disk-backed source).
    pub content: String,
}

#[cfg(feature = "ml")]
pub async fn retrieve(
    pool: &UserDbPool,
    embedder: &Arc<EmbeddingManager>,
    session_id: &str,
    query: &str,
) -> Result<Recall, AppError> {
    consolidation::maybe_run_lifecycle_sweep(pool);
    // One-shot backfill of the machine importance tier for rows written before
    // it existed. Latched after the first success, so this is a single atomic
    // load on every subsequent turn.
    episodic::maybe_retier_machine_episodes(pool);

    let recent =
        episodic::list_recent_conversation(pool, session_id, RECENCY_TURNS).unwrap_or_default();
    let recent_ids: HashSet<String> = recent.iter().map(|e| e.id.clone()).collect();

    let hits = embeddings::search_similar(pool, embedder, query, VECTOR_OVERFETCH)
        .await
        .unwrap_or_default();

    // Always pull the top-importance facts as a stable "what I know about
    // you" snapshot — fact retrieval shouldn't depend on whether the user
    // happens to phrase a query that matches a fact's wording.
    let mut top_facts =
        semantic::list_facts(pool, None, false, ALWAYS_INCLUDE_TOP_FACTS).unwrap_or_default();
    let fact_ids_in_recall: HashSet<String> = top_facts.iter().map(|f| f.id.clone()).collect();

    // Phase D: stable per-turn includes — active goals, top procedurals,
    // open backlog. These don't depend on the user's query wording.
    let active_goals = goals::list_goals(
        pool,
        Some(goals::GoalStatus::Active),
        ALWAYS_INCLUDE_ACTIVE_GOALS,
    )
    .unwrap_or_default();
    let mut top_procedurals =
        procedural::list_rules(pool, None, false, ALWAYS_INCLUDE_TOP_PROCEDURALS)
            .unwrap_or_default();
    let procedural_ids_in_recall: HashSet<String> =
        top_procedurals.iter().map(|p| p.id.clone()).collect();
    let open_backlog =
        backlog::list_items(pool, None, true, ALWAYS_INCLUDE_OPEN_BACKLOG).unwrap_or_default();

    if recent.is_empty() && hits.is_empty() {
        // No conversation yet AND no vector corpus. The keyword lane can
        // still reach doctrine (407 chunks are indexed even on a brand-new
        // brain), so cold start is no longer a dead end — delegate.
        return Ok(retrieve_keyword(pool, session_id, query));
    }

    // Look up node kinds in one SQL round-trip, preserve search ordering.
    let kinds = lookup_kinds(
        pool,
        &hits.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
    )?;

    // Relevance floor + hybrid lane ranking — shared primitives from
    // `crate::retrieval` (behavior identical to the loop previously inlined
    // here). Doctrine rides its own kind-scoped lane below; goals/rituals/
    // backlog don't ride the vector lane at all.
    let (near_hits, dropped_far) = filter_by_distance_floor(&hits, MAX_VECTOR_DISTANCE);
    // Start the provenance record here, at the one point where the distances
    // and the rejection count both still exist. Everything below either adds a
    // lane or hydrates rows, and neither can recover this.
    let mut trace = RecallTrace {
        floor: Some(MAX_VECTOR_DISTANCE),
        dropped_far,
        ..RecallTrace::default()
    };
    for (id, distance) in &near_hits {
        trace.record_vector(id, *distance);
    }
    // Clones, not moves: the same exclusion sets are needed again below as the
    // keyword lanes' dedupe guards (each holds ≤ a few dozen ids). Moving them
    // in here was an E0382 that only the `ml` arm ever compiled far enough to
    // hit — caught 2026-08-08, after shipping.
    let mut lanes = [
        Lane::new("episode", VECTOR_EPISODE_TOPK, recent_ids.clone()),
        Lane::new("fact", VECTOR_FACT_TOPK, fact_ids_in_recall.clone()),
        Lane::new(
            "procedural",
            VECTOR_PROCEDURAL_TOPK,
            procedural_ids_in_recall.clone(),
        ),
    ];
    rank_into_lanes(&near_hits, &kinds, &mut lanes);
    let [episode_lane, fact_lane, procedural_lane] = lanes;
    let episode_ids = episode_lane.selected;
    let fact_ids = fact_lane.selected;
    let procedural_ids = procedural_lane.selected;

    // Doctrine: a dedicated kind-scoped scan so it can't be starved out of the
    // shared top-K by an episode-heavy corpus (the gap that made memory/policy
    // questions answer from the constitution instead of retrieval). Same floor.
    let doctrine_hits =
        embeddings::search_similar_kind(pool, embedder, query, "doctrine", VECTOR_DOCTRINE_FETCH)
            .await
            .unwrap_or_default();
    let (doctrine_near, doctrine_dropped) =
        filter_by_distance_floor(&doctrine_hits, MAX_VECTOR_DISTANCE);
    // The doctrine lane is measured against the same floor, so its rejects
    // belong in the same total — reporting only the episode lane's would
    // understate what the floor is costing.
    trace.dropped_far += doctrine_dropped;
    let mut doctrine_ids: Vec<String> = doctrine_near
        .into_iter()
        .take(VECTOR_DOCTRINE_TOPK)
        .inspect(|(id, distance)| trace.record_vector(id, *distance))
        .map(|(id, _)| id)
        .collect();

    // Keyword floor. The vector lane can only reach nodes that have a vector,
    // and today essentially none of the episode corpus does; the keyword lane
    // reaches everything that was ever written to `companion_fts`. Running
    // both and unioning means the ml build is a strict superset of the non-ml
    // build rather than an alternative to it.
    let mut episode_ids = episode_ids;
    union_keyword_ids(
        &mut doctrine_ids,
        keyword::search_kind(pool, query, "doctrine", KEYWORD_DOCTRINE_TOPK).unwrap_or_default(),
        KEYWORD_DOCTRINE_TOPK.max(VECTOR_DOCTRINE_TOPK),
        &HashSet::new(),
    );
    union_keyword_ids(
        &mut episode_ids,
        keyword::search_episodes_in_session(
            pool,
            query,
            session_id,
            KEYWORD_EPISODE_TOPK,
            KEYWORD_EPISODE_MACHINE_CAP,
        )
        .unwrap_or_default()
        .into_iter()
        .map(|hit| hit.id)
        .collect(),
        KEYWORD_EPISODE_TOPK + VECTOR_EPISODE_TOPK,
        &recent_ids,
    );
    let mut fact_ids = fact_ids;
    union_keyword_ids(
        &mut fact_ids,
        keyword::search_kind(pool, query, "fact", KEYWORD_FACT_TOPK).unwrap_or_default(),
        KEYWORD_FACT_TOPK + VECTOR_FACT_TOPK,
        &fact_ids_in_recall,
    );
    let mut procedural_ids = procedural_ids;
    union_keyword_ids(
        &mut procedural_ids,
        keyword::search_kind(pool, query, "procedural", KEYWORD_PROCEDURAL_TOPK)
            .unwrap_or_default(),
        KEYWORD_PROCEDURAL_TOPK + VECTOR_PROCEDURAL_TOPK,
        &procedural_ids_in_recall,
    );

    tracing::debug!(
        target: "companion::recall",
        episodes = episode_ids.len(),
        doctrine = doctrine_ids.len(),
        facts = fact_ids.len(),
        procedurals = procedural_ids.len(),
        dropped_far,
        nearest = hits.first().map(|(_, d)| *d),
        "recall_distance"
    );

    // Episodes: hydrate (SQL excerpt when complete, disk for long bodies),
    // then merge with a recency tail sized to fill the remaining window.
    // Re-impose the session filter here — the vector lane only filters on
    // kind='episode', so without this a semantically similar episode authored
    // in a *different* conversation would bleed into this session's working
    // memory, breaking the isolation `episodic::list_recent` enforces.
    let mut extra_episodes =
        load_episodes_by_ids(pool, &episode_ids, session_id).unwrap_or_default();
    extra_episodes.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let episodes = with_recency_tail(pool, session_id, extra_episodes, recent);

    // Doctrine: load chunk content from disk (the file_path includes
    // #anchor — the disk file is the whole .md, but we want only the
    // chunk that matched. We re-extract the section from the file by its
    // heading slug.)
    let doctrine = load_doctrine_chunks(pool, &doctrine_ids).unwrap_or_default();

    // Facts: hydrate vector-matched ids and append after the
    // top-by-importance set, deduped.
    for id in &fact_ids {
        if let Ok(Some(f)) = semantic::get_fact(pool, id) {
            top_facts.push(f);
        }
    }
    // Procedurals: same shape as facts.
    for id in &procedural_ids {
        if let Ok(Some(p)) = procedural::get_rule(pool, id) {
            top_procedurals.push(p);
        }
    }

    touch_recalled(pool, &top_facts, &top_procedurals);

    // The query-independent tiers, recorded last so they never displace a
    // vector hit: a fact that is BOTH always-on and a strong semantic match
    // should read as the match, which is the more informative of the two.
    trace.record_all(&fact_ids_in_recall, RecallLane::AlwaysOn);
    trace.record_all(&procedural_ids_in_recall, RecallLane::AlwaysOn);
    trace.record_all(active_goals.iter().map(|g| &g.id), RecallLane::AlwaysOn);
    trace.record_all(open_backlog.iter().map(|b| &b.id), RecallLane::AlwaysOn);
    trace.record_all(&recent_ids, RecallLane::Recency);

    Ok(Recall {
        episodes,
        doctrine,
        facts: top_facts,
        procedurals: top_procedurals,
        goals: active_goals,
        backlog: open_backlog,
        trace,
    })
}

#[cfg(not(feature = "ml"))]
pub async fn retrieve(
    pool: &UserDbPool,
    session_id: &str,
    query: &str,
) -> Result<Recall, AppError> {
    Ok(retrieve_keyword(pool, session_id, query))
}

/// Embedder-free recall: the keyword (BM25) lane plus the always-include
/// tiers. This is the WHOLE retrieval path on the shipped desktop build (no
/// `ml` feature), and the ml build's fallback when no embedder is configured.
///
/// Before this existed, that path was `prompt::manual_recall` — 20 most-recent
/// episodes, 6 top facts, 6 top procedurals, 8 goals, 6 backlog items, and
/// `doctrine: Vec::new()`, identical on every turn no matter what was asked.
/// Every input here except the always-include tiers is now a function of the
/// query.
pub fn retrieve_keyword(pool: &UserDbPool, session_id: &str, query: &str) -> Recall {
    // Memory lifecycle rides the recall path because it is the path that
    // actually runs — the manual decay/prune commands and the consolidation
    // tail had never once executed (`companion_consolidation` = 0 rows in 77
    // days, every fact `last_decayed_at` NULL). Self-throttled to at most once
    // per 6h per process; a no-op on every other turn.
    consolidation::maybe_run_lifecycle_sweep(pool);
    // One-shot backfill of the machine importance tier for rows written before
    // it existed. Latched after the first success, so this is a single atomic
    // load on every subsequent turn.
    episodic::maybe_retier_machine_episodes(pool);

    // Query-independent tiers first — these are the stable "who you are /
    // what you're working toward" floor and must not depend on phrasing.
    let mut facts =
        semantic::list_facts(pool, None, false, ALWAYS_INCLUDE_TOP_FACTS).unwrap_or_default();
    let fact_ids_in_recall: HashSet<String> = facts.iter().map(|f| f.id.clone()).collect();
    let mut procedurals = procedural::list_rules(pool, None, false, ALWAYS_INCLUDE_TOP_PROCEDURALS)
        .unwrap_or_default();
    let procedural_ids_in_recall: HashSet<String> =
        procedurals.iter().map(|p| p.id.clone()).collect();
    let goals = goals::list_goals(
        pool,
        Some(goals::GoalStatus::Active),
        ALWAYS_INCLUDE_ACTIVE_GOALS,
    )
    .unwrap_or_default();
    let backlog =
        backlog::list_items(pool, None, true, ALWAYS_INCLUDE_OPEN_BACKLOG).unwrap_or_default();

    // Doctrine — the tier that had never once been retrieved on this path.
    let doctrine_ids =
        keyword::search_kind(pool, query, "doctrine", KEYWORD_DOCTRINE_TOPK).unwrap_or_default();
    let doctrine = load_doctrine_chunks(pool, &doctrine_ids).unwrap_or_default();

    // Episodes: query-relevant older turns, then a recency tail sized to fill
    // the remaining budget (so the window is RECALL_EPISODE_TARGET either way,
    // whether or not the keyword lane found anything).
    let keyword_episode_ids: Vec<String> = keyword::search_episodes_in_session(
        pool,
        query,
        session_id,
        KEYWORD_EPISODE_TOPK,
        KEYWORD_EPISODE_MACHINE_CAP,
    )
    .unwrap_or_default()
    .into_iter()
    .map(|hit| hit.id)
    .collect();
    let recency_budget = RECALL_EPISODE_TARGET
        .saturating_sub(keyword_episode_ids.len() as u32)
        .max(RECENCY_FLOOR);
    let recent =
        episodic::list_recent_conversation(pool, session_id, recency_budget).unwrap_or_default();
    let recent_ids: HashSet<String> = recent.iter().map(|e| e.id.clone()).collect();
    let older_ids: Vec<String> = keyword_episode_ids
        .into_iter()
        .filter(|id| !recent_ids.contains(id))
        .collect();
    let mut older = load_episodes_by_ids(pool, &older_ids, session_id).unwrap_or_default();
    older.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let mut episodes = older;
    episodes.extend(recent);

    // Facts / procedurals: keyword hits append after the always-include set.
    for id in keyword::search_kind(pool, query, "fact", KEYWORD_FACT_TOPK).unwrap_or_default() {
        if fact_ids_in_recall.contains(&id) {
            continue;
        }
        if let Ok(Some(f)) = semantic::get_fact(pool, &id) {
            facts.push(f);
        }
    }
    for id in
        keyword::search_kind(pool, query, "procedural", KEYWORD_PROCEDURAL_TOPK).unwrap_or_default()
    {
        if procedural_ids_in_recall.contains(&id) {
            continue;
        }
        if let Ok(Some(p)) = procedural::get_rule(pool, &id) {
            procedurals.push(p);
        }
    }

    touch_recalled(pool, &facts, &procedurals);

    // No floor on this path: there is no vector lane, so there is no threshold
    // anything was measured against. `floor: None` is what stops the UI from
    // drawing a relevance scale that nothing on this build could have produced.
    let mut trace = RecallTrace::default();
    trace.record_all(&fact_ids_in_recall, RecallLane::AlwaysOn);
    trace.record_all(&procedural_ids_in_recall, RecallLane::AlwaysOn);
    trace.record_all(goals.iter().map(|g| &g.id), RecallLane::AlwaysOn);
    trace.record_all(backlog.iter().map(|b| &b.id), RecallLane::AlwaysOn);
    trace.record_all(&recent_ids, RecallLane::Recency);

    Recall {
        episodes,
        doctrine,
        facts,
        procedurals,
        goals,
        backlog,
        trace,
    }
}

/// Append `extra` ids onto `primary` in rank order, skipping anything already
/// selected or excluded, up to `cap` total. Used to union the keyword lane
/// into a vector-lane selection without letting either starve the other.
#[cfg(feature = "ml")]
fn union_keyword_ids(
    primary: &mut Vec<String>,
    extra: Vec<String>,
    cap: usize,
    exclude: &HashSet<String>,
) {
    let mut seen: HashSet<String> = primary.iter().cloned().collect();
    for id in extra {
        if primary.len() >= cap {
            break;
        }
        if exclude.contains(&id) || !seen.insert(id.clone()) {
            continue;
        }
        primary.push(id);
    }
}

/// Fill the episode window out to [`RECALL_EPISODE_TARGET`] with recent turns.
///
/// `already_recent` is the narrow recency slice the ml path fetched up front to
/// build its lane-exclusion set; if the other lanes under-delivered we widen it
/// here rather than shipping a 5-episode window. Result is oldest-first with
/// the recency tail last, matching how the prompt renders the block.
#[cfg(feature = "ml")]
fn with_recency_tail(
    pool: &UserDbPool,
    session_id: &str,
    older: Vec<Episode>,
    already_recent: Vec<Episode>,
) -> Vec<Episode> {
    let budget = RECALL_EPISODE_TARGET
        .saturating_sub(older.len() as u32)
        .max(RECENCY_FLOOR);
    let tail = if budget as usize > already_recent.len() {
        episodic::list_recent_conversation(pool, session_id, budget).unwrap_or(already_recent)
    } else {
        already_recent
    };
    let tail_ids: HashSet<&str> = tail.iter().map(|e| e.id.as_str()).collect();
    let mut out: Vec<Episode> = older
        .into_iter()
        .filter(|e| !tail_ids.contains(e.id.as_str()))
        .collect();
    out.extend(tail);
    out
}

/// Restart the decay clock for everything Athena actually saw this turn.
/// Best-effort — a failure here must never block a chat turn.
///
/// This used to live only in the ml arm, which meant that on the build that
/// ships (no `ml`) `last_seen_at` was never written at all: every fact in the
/// brain read as untouched-since-creation, which is exactly what
/// `consolidation::decay_unused_facts` keys off. Recall now keeps memory
/// alive on every path, so decay measures real disuse.
fn touch_recalled(pool: &UserDbPool, facts: &[Fact], procedurals: &[Procedural]) {
    if !facts.is_empty() {
        let ids: Vec<String> = facts.iter().map(|f| f.id.clone()).collect();
        let _ = semantic::touch_last_seen(pool, &ids);
    }
    if !procedurals.is_empty() {
        let ids: Vec<String> = procedurals.iter().map(|p| p.id.clone()).collect();
        let _ = procedural::touch_last_used(pool, &ids);
    }
}

#[cfg(feature = "ml")]
fn lookup_kinds(
    pool: &UserDbPool,
    ids: &[String],
) -> Result<std::collections::HashMap<String, String>, AppError> {
    if ids.is_empty() {
        return Ok(Default::default());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT id, kind FROM companion_node WHERE id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows.into_iter().collect())
}

/// Read full episodes by id list. Serves from the SQL `body_excerpt` when it
/// provably holds the full body (see `retrieval::excerpt_holds_full_body`) —
/// the excerpt is already fetched, so this kills the per-row
/// `fs::read_to_string` N+1 on the recall hot path. Disk is read only for
/// genuinely long bodies (or nonconforming rows); long-body rows whose disk
/// file is missing are dropped, as before. (A complete-excerpt row whose disk
/// file was manually deleted now still surfaces — episodes are append-only by
/// doctrine, so a missing file is an anomaly and the SQL copy is authoritative
/// enough for recall.)
fn load_episodes_by_ids(
    pool: &UserDbPool,
    ids: &[String],
    session_id: &str,
) -> Result<Vec<Episode>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, file_path, created_at, body_excerpt
         FROM companion_node
         WHERE kind = 'episode' AND session_id = ? AND id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = std::iter::once(&session_id as &dyn rusqlite::ToSql)
        .chain(ids.iter().map(|s| s as &dyn rusqlite::ToSql))
        .collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    let root = crate::companion::disk::brain_root()?;
    let mut out = Vec::with_capacity(rows.len());
    for (id, rel_path, created_at, excerpt) in rows {
        if let Some(excerpt) = &excerpt {
            if crate::retrieval::excerpt_holds_full_body(
                excerpt,
                crate::retrieval::EPISODE_EXCERPT_CAP,
            ) {
                if let Some(role) = crate::retrieval::role_from_episode_path(&rel_path) {
                    out.push(Episode {
                        id,
                        session_id: String::new(),
                        role: role.to_string(),
                        content: crate::retrieval::episode_body_from_excerpt(excerpt),
                        file_path: rel_path,
                        created_at,
                    });
                    continue;
                }
            }
        }
        let full = match std::fs::read_to_string(root.join(&rel_path)) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (role, content) = parse_role_and_body(&full);
        out.push(Episode {
            id,
            session_id: String::new(),
            role,
            content,
            file_path: rel_path,
            created_at,
        });
    }
    Ok(out)
}

/// Load doctrine chunks by id. The `file_path` column is `<rel>#<anchor>`;
/// we read the whole .md from the docs root and re-extract the matching
/// H2 section. Falls back to the body_excerpt column if the file is gone
/// (e.g., stale index after a docs rename).
fn load_doctrine_chunks(pool: &UserDbPool, ids: &[String]) -> Result<Vec<DoctrineHit>, AppError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT id, file_path, body_excerpt FROM companion_node
         WHERE kind = 'doctrine' AND id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    // Source from disk first (dev), embedded fallback otherwise (prod).
    // We always have a path here because read_curated_doc handles both.
    let docs_root = crate::companion::brain::doctrine::find_docs_root();
    let mut out = Vec::with_capacity(rows.len());
    for (node_id, file_path, excerpt) in rows {
        let (rel_path, anchor) = split_path_anchor(&file_path);
        let content =
            crate::companion::brain::doctrine::read_curated_doc(rel_path, docs_root.as_deref())
                .and_then(|md| extract_section(&md, anchor))
                .unwrap_or_else(|| excerpt.clone());
        out.push(DoctrineHit {
            node_id,
            file_path,
            content,
        });
    }
    Ok(out)
}

fn split_path_anchor(file_path: &str) -> (&str, &str) {
    match file_path.split_once('#') {
        Some((p, a)) => (p, a),
        None => (file_path, "intro"),
    }
}

/// Re-extract the chunk for a given heading anchor from the full markdown.
/// Returns the section from its `## ` line through the start of the next
/// `## `. For `intro`, returns everything before the first `## `.
fn extract_section(md: &str, anchor: &str) -> Option<String> {
    // current_heading is updated as a side effect during scanning but the
    // function returns the buffered body; the heading itself is not surfaced
    // to callers today.
    #[allow(unused_assignments)]
    let mut current_heading = String::new();
    let mut current_anchor = "intro".to_string();
    let mut buf: Vec<&str> = Vec::new();
    let mut found: Option<String> = None;

    for line in md.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            if current_anchor == anchor {
                found = Some(buf.join("\n"));
                return found;
            }
            current_heading = rest.trim().to_string();
            current_anchor = slugify(&current_heading);
            buf.clear();
            buf.push(line);
        } else {
            buf.push(line);
        }
    }
    if current_anchor == anchor {
        return Some(buf.join("\n"));
    }
    found
}

fn slugify(s: &str) -> String {
    util::slugify(s, "section", None)
}

fn parse_role_and_body(full: &str) -> (String, String) {
    let mut role = "unknown".to_string();
    let mut body = full.to_string();
    if let Some(after) = full.strip_prefix("---\n") {
        if let Some(end) = after.find("\n---") {
            for line in after[..end].lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("role:") {
                    role = rest.trim().to_string();
                }
            }
            body = after[end + 4..].trim_start().to_string();
        }
    }
    (role, body)
}

#[cfg(test)]
mod trace_tests {
    use super::{RecallLane, RecallTrace};

    /// The mapping that turns an unbounded, smaller-is-better L2 distance into
    /// a 0..1 bar. It must be monotone, or the UI would show an order that
    /// disagrees with the one retrieval actually used.
    #[test]
    fn relevance_is_monotone_and_anchored_to_the_floor() {
        let mut trace = RecallTrace {
            floor: Some(1.30),
            ..RecallTrace::default()
        };
        trace.record_vector("near", 0.0);
        trace.record_vector("mid", 0.65);
        trace.record_vector("at_floor", 1.30);

        assert_eq!(trace.relevance_of("near"), Some(1.0));
        assert_eq!(trace.relevance_of("at_floor"), Some(0.0));
        let mid = trace.relevance_of("mid").expect("mid scored");
        assert!(
            mid > 0.0 && mid < 1.0,
            "a mid-distance hit sits strictly between the endpoints: {mid}"
        );
    }

    /// A hit beyond the floor should never render as negative width. It cannot
    /// normally reach the trace (the floor filters first), but a floor lowered
    /// between retrieval and render would produce exactly this.
    #[test]
    fn relevance_clamps_rather_than_going_negative() {
        let mut trace = RecallTrace {
            floor: Some(1.0),
            ..RecallTrace::default()
        };
        trace.record_vector("far", 5.0);
        assert_eq!(trace.relevance_of("far"), Some(0.0));
    }

    /// With no vector lane there is no threshold, so there is no relevance to
    /// report — the UI must get `None` and draw no scale.
    #[test]
    fn no_floor_means_no_relevance() {
        let mut trace = RecallTrace::default();
        trace.record_vector("x", 0.2);
        assert_eq!(trace.relevance_of("x"), None);
    }

    /// First write wins, so a node that several lanes reach keeps the strongest
    /// provenance. Recording the always-on tiers last must not downgrade a
    /// fact that also matched semantically.
    #[test]
    fn a_vector_hit_survives_being_recorded_again_as_always_on() {
        let mut trace = RecallTrace {
            floor: Some(1.30),
            ..RecallTrace::default()
        };
        trace.record_vector("f1", 0.1);
        trace.record("f1", RecallLane::AlwaysOn);
        assert_eq!(trace.lane_of("f1"), RecallLane::Vector);
        assert!(trace.relevance_of("f1").is_some());
    }

    /// Anything that reached the prompt without being recorded came from the
    /// keyword union, which is the last step of both retrieval arms.
    #[test]
    fn an_unrecorded_id_reads_as_the_keyword_lane() {
        let trace = RecallTrace::default();
        assert_eq!(trace.lane_of("never-seen"), RecallLane::Keyword);
        assert_eq!(trace.relevance_of("never-seen"), None);
    }
}
