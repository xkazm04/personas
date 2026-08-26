//! "Why don't you remember that?" — the one-shot brain-pipeline diagnostic.
//!
//! Every signal this report needs already existed; none of it was reachable.
//! The `ml` gate is a compile-time fact, the embedder is an `Option` on
//! `AppState`, `companion_node.embedding_model` records who embedded what,
//! `embeddings::model_guard_excluded_total()` counts the vectors recall threw
//! away, and `cycle_report::last_completed` knows whether consolidation has
//! ever run. Each lived in a different module and the only place they met was
//! a `tracing::debug!` nobody reads. So an empty recall was indistinguishable
//! from a cold brain, a missing model, an un-run cycle and a lite build.
//!
//! ## The contract
//!
//! Stages are evaluated in **pipeline order** and the FIRST one that is not
//! `Ok` becomes [`BrainHealth::first_blocking_cause`]. That single field is
//! the point of the whole module: a caller — the Tauri command, Athena's own
//! `describe_brain_health` read op, a future panel — renders one cause and one
//! fix, and cannot disagree with itself about which of several simultaneous
//! degradations to lead with.
//!
//! ## Read-only, and total
//!
//! No stage mutates, and no stage may fail the report. A query that errors
//! (most realistically `companion_embedding`, a vec0 virtual table created
//! lazily at first use and therefore absent on a brain that has never embedded)
//! answers `None` for that one counter; it never propagates. A diagnostic that
//! can itself be broken by the thing it is diagnosing is not a diagnostic.

use serde::Serialize;
use ts_rs::TS;

use crate::companion::brain::cycle_report;
use crate::db::UserDbPool;

/// How a single stage came out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum StageStatus {
    /// Working as designed.
    Ok,
    /// Not applicable to this build or state, and correctly so. A skipped
    /// stage is never a blocking cause — the vector lane is *absent* on a
    /// non-`ml` build, not *broken*.
    Skipped,
    /// Working, but not at full strength. Recall still answers.
    Degraded,
    /// This stage is why recall is empty.
    Blocked,
    /// The probe itself could not read. Reported, never guessed past.
    Unknown,
}

impl StageStatus {
    /// Whether this status can be the reported first blocking cause.
    ///
    /// `Skipped` is excluded on purpose. A lite build has no vector lane, and
    /// leading with that would tell the operator their brain is broken when it
    /// is doing exactly what the build asked for.
    fn is_blocking(self) -> bool {
        matches!(self, Self::Degraded | Self::Blocked | Self::Unknown)
    }
}

/// One pipeline stage's verdict.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HealthStage {
    /// Stable machine name. Never localised, never renamed — callers key on it.
    pub name: String,
    pub status: StageStatus,
    /// One line of English, for the operator and for Athena's own prompt.
    pub detail: String,
}

/// The single first blocking cause, with the one thing to do about it.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BlockingCause {
    /// Stable code (`ml_not_compiled`, `corpus_empty`, ...). A UI translates
    /// from this, not from `summary`.
    pub code: String,
    pub summary: String,
    /// What to actually do. A cause with no fix is a complaint.
    pub fix: String,
}

/// Raw counters behind the verdicts. Present regardless of health, so a
/// healthy report is still worth reading.
#[derive(Debug, Clone, Default, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BrainCounters {
    // Every count below is pinned to `number` rather than left as ts-rs's
    // default `bigint` for an i64/u64. `JSON.parse` cannot produce a `bigint`,
    // so a `bigint`-typed field is a wire type the transport cannot carry: the
    // TS side would declare a value it never receives, and any arithmetic on it
    // throws at runtime. These are row counts in a local SQLite brain — many
    // orders of magnitude under 2^53 — so `number` is the honest carrier.
    #[ts(type = "number")]
    pub nodes: i64,
    /// Nodes carrying an `embedding_model` stamp.
    #[ts(type = "number")]
    pub embedded: i64,
    /// Nodes with no stamp — the vector lane cannot see these.
    #[ts(type = "number")]
    pub unembedded: i64,
    /// Rows in the `companion_embedding` vec0 table, or `None` when that table
    /// does not exist yet (never embedded) — which is itself the answer.
    #[ts(type = "number | null")]
    pub vectors: Option<i64>,
    #[ts(type = "number")]
    pub fts_rows: i64,
    #[ts(type = "number")]
    pub episodes: i64,
    #[ts(type = "number")]
    pub facts: i64,
    #[ts(type = "number")]
    pub procedurals: i64,
    #[ts(type = "number")]
    pub doctrine_chunks: i64,
    /// Process-cumulative recall hits dropped by the embedding-model guard.
    #[ts(type = "number")]
    pub model_guard_excluded: u64,
    pub last_cycle_at: Option<String>,
}

/// The whole report.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BrainHealth {
    /// True when every stage is `Ok` or `Skipped`.
    pub healthy: bool,
    /// Whether the vector lane is live. `false` on a lite build is normal, and
    /// the keyword lane carries recall alone.
    pub vector_lane: bool,
    pub first_blocking_cause: Option<BlockingCause>,
    pub stages: Vec<HealthStage>,
    pub counters: BrainCounters,
}

/// `SELECT COUNT(*)` that answers `None` rather than propagating. Used for the
/// vec0 table, whose absence is a legitimate state and not an error.
fn try_count(conn: &rusqlite::Connection, sql: &str) -> Option<i64> {
    conn.query_row(sql, [], |r| r.get::<_, i64>(0)).ok()
}

/// `SELECT COUNT(*)` over a table guaranteed by the schema. A failure here is
/// a broken DB, so `0` is the honest degradation — every downstream stage then
/// reads "empty", which is what the operator is looking at anyway.
fn count(conn: &rusqlite::Connection, sql: &str) -> i64 {
    try_count(conn, sql).unwrap_or(0)
}

fn nodes_of_kind(conn: &rusqlite::Connection, kind: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM companion_node WHERE kind = ?1",
        rusqlite::params![kind],
        |r| r.get::<_, i64>(0),
    )
    .unwrap_or(0)
}

/// Gather every counter over one pooled connection.
///
/// Answers `None` when the pool itself is unreachable. That distinction is
/// load-bearing: a defaulted `BrainCounters` reads as "0 nodes", which the
/// corpus stage would then report as `corpus_empty` — telling the operator
/// their brain is empty when the truth is that it could not be read. Those are
/// different problems with different fixes, and the report is worthless if it
/// confuses them.
fn gather_counters(pool: &UserDbPool) -> Option<BrainCounters> {
    let conn = pool.get().ok()?;
    let nodes = count(&conn, "SELECT COUNT(*) FROM companion_node");
    let embedded = count(
        &conn,
        "SELECT COUNT(*) FROM companion_node WHERE embedding_model IS NOT NULL",
    );
    let last_cycle_at = cycle_report::last_completed(pool)
        .ok()
        .flatten()
        .map(|c| c.finished_at);

    Some(BrainCounters {
        nodes,
        embedded,
        unembedded: (nodes - embedded).max(0),
        // The one probe allowed to answer `None`: a vec0 virtual table that has
        // never been created is absent, not broken.
        vectors: try_count(&conn, "SELECT COUNT(*) FROM companion_embedding"),
        fts_rows: count(&conn, "SELECT COUNT(*) FROM companion_fts"),
        episodes: nodes_of_kind(&conn, "episode"),
        facts: nodes_of_kind(&conn, "fact"),
        procedurals: nodes_of_kind(&conn, "procedural"),
        doctrine_chunks: nodes_of_kind(&conn, "doctrine"),
        model_guard_excluded: model_guard_excluded(),
        last_cycle_at,
    })
}

/// The model-guard counter, which only exists on an `ml` build.
#[cfg(feature = "ml")]
fn model_guard_excluded() -> u64 {
    crate::companion::brain::embeddings::model_guard_excluded_total()
}

#[cfg(not(feature = "ml"))]
fn model_guard_excluded() -> u64 {
    0
}

fn stage(name: &str, status: StageStatus, detail: String) -> HealthStage {
    HealthStage {
        name: name.to_string(),
        status,
        detail,
    }
}

/// Run the diagnostic.
///
/// `embedder_loaded` is passed in rather than read here because the embedder
/// lives on `AppState` and this module deliberately knows nothing about it.
/// That keeps every stage a pure function of `(pool, one bool)` and lets the
/// whole report be tested without an ONNX model, which is the one thing a test
/// cannot have.
pub fn run(pool: &UserDbPool, embedder_loaded: bool) -> BrainHealth {
    let readable = gather_counters(pool);
    let counters = readable.clone().unwrap_or_default();
    let ml = cfg!(feature = "ml");
    let vector_lane = ml && embedder_loaded;
    let mut stages: Vec<HealthStage> = Vec::with_capacity(8);

    // 1. The compile-time gate. `tauri:dev:lite` is the documented daily
    //    driver and it compiles `ml` out, so this is the most common reason a
    //    developer sees keyword-only recall and thinks something broke.
    stages.push(if ml {
        stage(
            "ml_feature",
            StageStatus::Ok,
            "Built with `ml` — the vector lane is compiled in.".to_string(),
        )
    } else {
        stage(
            "ml_feature",
            StageStatus::Skipped,
            "This build has no `ml` feature; recall runs on the keyword (BM25) \
             lane alone. Expected for `tauri:dev:lite`."
                .to_string(),
        )
    });

    // 2. The embedder itself. Only meaningful when the lane is compiled in.
    stages.push(match (ml, embedder_loaded) {
        (false, _) => stage(
            "embedder",
            StageStatus::Skipped,
            "No embedder in a non-`ml` build.".to_string(),
        ),
        (true, true) => stage(
            "embedder",
            StageStatus::Ok,
            "Embedding model loaded.".to_string(),
        ),
        (true, false) => stage(
            "embedder",
            StageStatus::Blocked,
            "The `ml` feature is on but no embedding model is loaded, so every \
             vector query returns nothing."
                .to_string(),
        ),
    });

    // 3. Is there a brain at all? A cold brain is the correct answer to "why
    //    do you not remember", and it is not a fault. An unreadable one is a
    //    different answer entirely, and must never be rendered as an empty one.
    stages.push(if readable.is_none() {
        stage(
            "corpus",
            StageStatus::Unknown,
            "The companion database could not be opened, so nothing below this \
             line was measured — the counters are placeholders, not readings."
                .to_string(),
        )
    } else if counters.nodes == 0 {
        stage(
            "corpus",
            StageStatus::Blocked,
            "The brain holds no memory nodes yet.".to_string(),
        )
    } else {
        stage(
            "corpus",
            StageStatus::Ok,
            format!(
                "{} nodes ({} episodes, {} facts, {} procedurals, {} doctrine chunks).",
                counters.nodes,
                counters.episodes,
                counters.facts,
                counters.procedurals,
                counters.doctrine_chunks
            ),
        )
    });

    // 4. The keyword lane. It carries recall alone on a lite build, so an empty
    //    FTS index over a non-empty corpus is worse than it looks.
    stages.push(if counters.nodes == 0 {
        stage(
            "keyword_index",
            StageStatus::Skipped,
            "Nothing to index.".to_string(),
        )
    } else if counters.fts_rows == 0 {
        stage(
            "keyword_index",
            StageStatus::Blocked,
            format!(
                "`companion_fts` is empty while {} nodes exist — the keyword lane \
                 can match nothing.",
                counters.nodes
            ),
        )
    } else {
        stage(
            "keyword_index",
            StageStatus::Ok,
            format!("{} rows indexed for BM25.", counters.fts_rows),
        )
    });

    // 5. The vector index, evaluated only when the lane can actually run.
    stages.push(if !vector_lane || counters.nodes == 0 {
        stage(
            "vector_index",
            StageStatus::Skipped,
            "Vector lane not active for this build or state.".to_string(),
        )
    } else {
        match counters.vectors {
            None => stage(
                "vector_index",
                StageStatus::Blocked,
                "`companion_embedding` does not exist — nothing has ever been \
                 embedded in this workspace."
                    .to_string(),
            ),
            Some(0) => stage(
                "vector_index",
                StageStatus::Blocked,
                "`companion_embedding` exists but holds no vectors.".to_string(),
            ),
            Some(n) => stage(
                "vector_index",
                StageStatus::Ok,
                format!("{n} vectors indexed."),
            ),
        }
    });

    // 6. Coverage. Partial coverage is the quiet one: recall works, answers
    //    look plausible, and the un-embedded share is simply never a candidate.
    stages.push(if !vector_lane || counters.nodes == 0 {
        stage(
            "embedding_coverage",
            StageStatus::Skipped,
            "Not applicable without an active vector lane.".to_string(),
        )
    } else if counters.unembedded > 0 {
        stage(
            "embedding_coverage",
            StageStatus::Degraded,
            format!(
                "{} of {} nodes carry no embedding stamp and are invisible to \
                 vector recall.",
                counters.unembedded, counters.nodes
            ),
        )
    } else {
        stage(
            "embedding_coverage",
            StageStatus::Ok,
            "Every node is embedded.".to_string(),
        )
    });

    // 7. The model guard. Non-zero means the embedder changed under a corpus
    //    written by an older model, and recall is quietly smaller than it looks.
    stages.push(if counters.model_guard_excluded > 0 {
        stage(
            "model_guard",
            StageStatus::Degraded,
            format!(
                "{} recall hits dropped this session because their vectors were \
                 written by a different embedding model.",
                counters.model_guard_excluded
            ),
        )
    } else {
        stage(
            "model_guard",
            StageStatus::Ok,
            "No vectors excluded for model mismatch.".to_string(),
        )
    });

    // 8. Consolidation. Episodes that never consolidate never become facts, so
    //    recall keeps re-reading raw conversation instead of what it learned.
    stages.push(match (&counters.last_cycle_at, counters.episodes) {
        (Some(at), _) => stage(
            "consolidation",
            StageStatus::Ok,
            format!("Last sleep cycle completed {at}."),
        ),
        (None, 0) => stage(
            "consolidation",
            StageStatus::Skipped,
            "No episodes to consolidate yet.".to_string(),
        ),
        (None, n) => stage(
            "consolidation",
            StageStatus::Degraded,
            format!(
                "No sleep cycle has ever completed, so none of the {n} episodes \
                 have become facts or procedurals."
            ),
        ),
    });

    let first_blocking_cause = stages
        .iter()
        .find(|s| s.status.is_blocking())
        .map(cause_for);

    BrainHealth {
        healthy: first_blocking_cause.is_none(),
        vector_lane,
        first_blocking_cause,
        stages,
        counters,
    }
}

/// Map a failed stage onto its stable code and its fix.
///
/// Kept as one `match` on the stage name rather than a `fix` field on every
/// constructed stage: the fix is only ever read for the ONE stage that blocks,
/// and building eight of them per call to discard seven is waste the report
/// does not need.
fn cause_for(stage: &HealthStage) -> BlockingCause {
    // `Unknown` short-circuits the name table: the fix is never about the stage
    // it landed on, it is always "the probe could not read", and routing it
    // through the name arms would hand back a confident fix derived from
    // counters that were never measured.
    if stage.status == StageStatus::Unknown {
        return BlockingCause {
            code: "unreadable".to_string(),
            summary: stage.detail.clone(),
            fix: "The companion database is not reachable. Check that another \
                  build of the app is not holding it, and that `DB_PATH` (if set) \
                  points where you think it does."
                .to_string(),
        };
    }
    let (code, fix) = match stage.name.as_str() {
        "embedder" => (
            "embedder_unavailable",
            "Check that the embedding model downloaded — the app ships \
             AllMiniLML6V2Q and loads it lazily. A failed first load leaves the \
             lane compiled but dark.",
        ),
        "corpus" => (
            "corpus_empty",
            "Have a conversation. Episodes are written per turn; facts and \
             procedurals follow from the first sleep cycle.",
        ),
        "keyword_index" => (
            "keyword_index_empty",
            "`companion_fts` is populated on write. An empty index over a \
             non-empty corpus means rows were inserted around the writer — \
             re-run consolidation, or re-import the brain from disk.",
        ),
        "vector_index" => (
            "vector_index_empty",
            "Run a brain re-embed to populate `companion_embedding`. Until then \
             recall answers from the keyword lane only.",
        ),
        "embedding_coverage" => (
            "embedding_coverage_partial",
            "Run a brain re-embed to cover the nodes written while the embedder \
             was unavailable.",
        ),
        "model_guard" => (
            "model_guard_excluding",
            "The embedding model changed since these vectors were written. A \
             full re-embed clears the exclusions.",
        ),
        "consolidation" => (
            "consolidation_never_ran",
            "Trigger a sleep cycle. Until one completes, episodes stay raw \
             conversation and never become durable memory.",
        ),
        // `ml_feature` never blocks (it reports `Skipped`), and every other
        // name is one this function was written alongside. A new stage that
        // forgets to add an arm here still produces a usable report rather
        // than a panic or a silently empty fix.
        other => {
            return BlockingCause {
                code: "unclassified".to_string(),
                summary: stage.detail.clone(),
                fix: format!(
                    "Stage `{other}` reported a problem with no registered fix. \
                     Add an arm to `health::cause_for`."
                ),
            };
        }
    };
    BlockingCause {
        code: code.to_string(),
        summary: stage.detail.clone(),
        fix: fix.to_string(),
    }
}

/// Render the report for Athena's `describe_brain_health` read op.
///
/// Deliberately compact: the caller clips to `READ_OP_DETAIL_CHARS` and a
/// report that gets truncated loses its tail, which is where the counters live.
/// Leads with the verdict so a clip can never remove the answer.
pub fn describe_brain_health(pool: &UserDbPool) -> String {
    let report = run(pool, embedder_probe());
    let mut out = String::with_capacity(768);

    match &report.first_blocking_cause {
        None => out.push_str("Brain health: OK.\n"),
        Some(cause) => out.push_str(&format!(
            "Brain health: DEGRADED — {}\nCause: {}\nFix: {}\n",
            cause.code, cause.summary, cause.fix
        )),
    }
    out.push_str(&format!(
        "Lanes: keyword always on; vector {}.\n\nStages:\n",
        if report.vector_lane {
            "active"
        } else {
            "inactive"
        }
    ));

    for s in &report.stages {
        let mark = match s.status {
            StageStatus::Ok => "ok",
            StageStatus::Skipped => "n/a",
            StageStatus::Degraded => "degraded",
            StageStatus::Blocked => "BLOCKED",
            StageStatus::Unknown => "unknown",
        };
        out.push_str(&format!("- {} [{}]: {}\n", s.name, mark, s.detail));
    }

    let c = &report.counters;
    out.push_str(&format!(
        "\nCounters: {} nodes ({} embedded, {} not), {} vectors, {} FTS rows, \
         {} episodes, {} facts, {} procedurals, {} doctrine chunks, \
         {} model-guard exclusions. Last cycle: {}.\n",
        c.nodes,
        c.embedded,
        c.unembedded,
        c.vectors
            .map_or_else(|| "no table".to_string(), |v| v.to_string()),
        c.fts_rows,
        c.episodes,
        c.facts,
        c.procedurals,
        c.doctrine_chunks,
        c.model_guard_excluded,
        c.last_cycle_at.as_deref().unwrap_or("never"),
    ));
    out
}

/// Whether an embedder could serve a query right now.
///
/// The read op runs inside the dispatcher, which holds the DB pool but not
/// `AppState`, so it cannot consult `AppState::embedding_manager` the way the
/// Tauri command does. On a non-`ml` build the answer is a compile-time `false`;
/// on an `ml` build the honest answer is "the feature is on", and the
/// `vector_index` stage — which reads the actual vector count — is what turns a
/// dark lane into a blocking cause anyway.
fn embedder_probe() -> bool {
    cfg!(feature = "ml")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real companion schema, which is the point: `companion_embedding` is
    /// a vec0 virtual table created lazily at first embed, so a fresh workspace
    /// genuinely does not have it. That absence is the production shape the
    /// `vectors: None` path exists for, and a hand-built fixture would have
    /// invented the table and hidden it.
    fn user_pool() -> UserDbPool {
        crate::db::init_test_user_db().expect("test user db")
    }

    /// Seed `n` nodes of `kind`, `embedded` of them carrying a model stamp.
    ///
    /// Writes ONLY `companion_node`. The keyword index is populated separately
    /// through the production writer (see [`seed_indexed_episodes`]) rather than
    /// by a second hand-written INSERT here — `companion_fts` has no trigger, so
    /// every mirror in this tree is hand-written, and a test that hand-syncs its
    /// own is a test that cannot notice a writer which stopped mirroring.
    fn seed(pool: &UserDbPool, kind: &str, n: usize, embedded: usize) {
        let conn = pool.get().expect("test pool");
        for i in 0..n {
            let id = format!("{kind}-{i}");
            let model = (i < embedded).then_some("AllMiniLML6V2Q");
            conn.execute(
                "INSERT INTO companion_node (id, kind, file_path, content_hash, embedding_model)
                 VALUES (?1, ?2, ?3, 'sha256:x', ?4)",
                rusqlite::params![id, kind, format!("{kind}/{id}.md"), model],
            )
            .expect("seed node");
        }
    }

    /// Write `n` episodes through `episodic::append_episode`, the real writer,
    /// which mirrors each one into `companion_fts`. If that mirror is ever
    /// dropped, the health tests below start failing — which is the whole point
    /// of going through it instead of inserting the FTS row by hand.
    ///
    /// `PERSONAS_HOME` is redirected at the temp dir so the episode markdown
    /// never lands in the operator's real brain.
    fn seed_indexed_episodes(pool: &UserDbPool, n: usize) -> tempfile::TempDir {
        let home = tempfile::TempDir::new().expect("temp home");
        std::env::set_var("PERSONAS_HOME", home.path());
        for i in 0..n {
            crate::companion::brain::episodic::append_episode(
                pool,
                "session-health",
                crate::companion::brain::episodic::EpisodeRole::User,
                &format!("indexed episode {i}"),
            )
            .expect("append episode");
        }
        home
    }

    fn cause_code(report: &BrainHealth) -> Option<&str> {
        report
            .first_blocking_cause
            .as_ref()
            .map(|c| c.code.as_str())
    }

    /// A brain with tables but nothing in them: the cold-start case, which must
    /// report `corpus_empty` and NOT any of the stages behind it.
    #[test]
    fn cold_brain_blocks_on_corpus_not_on_a_later_stage() {
        let pool = user_pool();
        let report = run(&pool, true);
        assert!(!report.healthy);
        let cause = report.first_blocking_cause.expect("a cold brain blocks");
        assert_eq!(cause.code, "corpus_empty");
        assert!(!cause.fix.is_empty(), "every cause carries a fix");
    }

    /// The gap the whole module exists to close: a populated corpus whose
    /// keyword index is empty. Recall returns nothing, and before this report
    /// that was indistinguishable from having no memories at all.
    #[test]
    fn populated_corpus_with_empty_fts_blocks_on_the_keyword_lane() {
        let pool = user_pool();
        seed(&pool, "episode", 5, 5);
        let report = run(&pool, true);
        assert_eq!(cause_code(&report), Some("keyword_index_empty"));
        assert_eq!(report.counters.nodes, 5);
        assert_eq!(report.counters.fts_rows, 0);
    }

    /// A healthy-enough brain on any build: corpus present, keyword lane
    /// indexed. The vector stages skip on a lite build and pass on a full one,
    /// so neither may produce a blocking cause here.
    #[test]
    fn indexed_corpus_reports_no_keyword_or_corpus_block() {
        let pool = user_pool();
        let _home = seed_indexed_episodes(&pool, 3);
        let report = run(&pool, true);
        let blocked: Vec<&str> = report
            .stages
            .iter()
            .filter(|s| s.status == StageStatus::Blocked)
            .map(|s| s.name.as_str())
            .collect();
        assert!(
            !blocked.contains(&"corpus") && !blocked.contains(&"keyword_index"),
            "corpus and keyword lane are both healthy, got blocked: {blocked:?}"
        );
    }

    /// An un-run sleep cycle degrades rather than blocks, and says so with the
    /// episode count — the number that makes the cost legible.
    #[test]
    fn episodes_without_a_completed_cycle_degrade_consolidation() {
        let pool = user_pool();
        let _home = seed_indexed_episodes(&pool, 7);
        let report = run(&pool, true);
        let consolidation = report
            .stages
            .iter()
            .find(|s| s.name == "consolidation")
            .expect("consolidation stage");
        assert_eq!(consolidation.status, StageStatus::Degraded);
        assert!(
            consolidation.detail.contains('7'),
            "the cost should be countable: {}",
            consolidation.detail
        );
        assert!(report.counters.last_cycle_at.is_none());
    }

    /// A missing `companion_embedding` table must answer `None`, never panic
    /// and never poison the rest of the report.
    #[test]
    fn absent_vector_table_answers_none_without_failing_the_report() {
        let pool = user_pool();
        seed(&pool, "fact", 2, 0);
        let report = run(&pool, true);
        assert_eq!(report.counters.vectors, None);
        assert_eq!(report.stages.len(), 8, "every stage still reported");
    }

    /// `Skipped` must never be chosen as the blocking cause — otherwise every
    /// lite build would report itself broken.
    #[test]
    fn skipped_is_never_the_blocking_cause() {
        let pool = user_pool();
        let report = run(&pool, false);
        let blocking_summary = report
            .first_blocking_cause
            .as_ref()
            .map(|c| c.summary.as_str());
        for s in report
            .stages
            .iter()
            .filter(|s| s.status == StageStatus::Skipped)
        {
            assert_ne!(
                blocking_summary,
                Some(s.detail.as_str()),
                "stage `{}` was skipped but was reported as blocking",
                s.name
            );
        }
    }

    /// The stage list is the report's public shape; callers key on these names.
    #[test]
    fn stage_names_and_order_are_stable() {
        let pool = user_pool();
        let report = run(&pool, true);
        let names: Vec<&str> = report.stages.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "ml_feature",
                "embedder",
                "corpus",
                "keyword_index",
                "vector_index",
                "embedding_coverage",
                "model_guard",
                "consolidation",
            ]
        );
    }

    /// The renderer leads with the verdict, so a clip at `READ_OP_DETAIL_CHARS`
    /// can never remove the answer.
    #[test]
    fn description_leads_with_the_verdict() {
        let pool = user_pool();
        let text = describe_brain_health(&pool);
        assert!(
            text.starts_with("Brain health:"),
            "verdict must be first, got: {}",
            &text[..text.len().min(60)]
        );
    }
}
