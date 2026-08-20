//! Self-Wiring Fabric v1 — the event-bus pattern miner.
//!
//! Sibling of `composite.rs`: where the composite engine evaluates triggers
//! the user already wired, this module notices routes the user KEEPS WIRING
//! BY HAND — "event E happened, and within `CO_OCCURRENCE_WINDOW_SECONDS`
//! the user manually executed persona P, at least `MIN_CO_OCCURRENCES`
//! times" — and writes the candidates to `automation_suggestions`, where the
//! Studio patchbay renders them as ghost cables with an evidence drawer.
//!
//! ## Honesty rules (load-bearing, not polish)
//!
//! * **High threshold** — `MIN_CO_OCCURRENCES` starts high on purpose; a solo
//!   user's data is sparse and one false suggestion costs more trust than ten
//!   correct ones earn. Below threshold the UI shows "not enough signal yet",
//!   never a stretched inference.
//! * **No self-feeding loops** — an accepted suggestion's created trigger id
//!   is the *mined-route tag* (`committed_trigger_id`): the miner excludes
//!   that trigger's published events AND its executions from all future
//!   evidence (`mine_co_occurrences` unit-tests this). Manual-run detection
//!   (`trigger_id IS NULL`) already excludes ALL trigger-fired runs; the tag
//!   closes the event side too.
//! * **Proposed, not imposed** — this module only ever writes `proposed`
//!   rows. Accept/reject are user actions through the Studio; the reserved
//!   `Capability::AutomationCommit` is exercised by nothing in v1.
//!
//! ## Gating
//!
//! Mining runs only when at least one project's autopilot mode grants
//! `Capability::AutomationSuggestion` (i.e. `suggest` or `full`). Events and
//! personas are not strictly project-scoped, so v1 uses the coarsest honest
//! gate: any opted-in project turns the miner on; none keeps it fully off
//! (a no-op tick, exactly like the app before this feature existed).

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use crate::db::models::{AutomationSuggestionEvidence, TriggerConfig};
use crate::db::repos::resources::automation_suggestions as suggestion_repo;
use crate::db::repos::resources::automation_suggestions::{MinedEvent, MinedExecution};
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::engine::autopilot::{self, Capability};

/// Minimum distinct manual runs that must co-occur with an event type before
/// a suggestion is proposed. High on purpose — see module doc.
pub const MIN_CO_OCCURRENCES: u32 = 5;

/// A manual run counts as co-occurring when it starts within this many
/// seconds AFTER the event (10 minutes — the "I saw the event, went and ran
/// the persona myself" envelope from the moonshot report).
pub const CO_OCCURRENCE_WINDOW_SECONDS: u32 = 600;

/// How far back the miner looks. Long enough for a weekly habit to
/// accumulate `MIN_CO_OCCURRENCES`, short enough that dead habits decay out
/// (and their ghost cables are pruned).
pub const LOOKBACK_DAYS: u32 = 30;

/// Row caps for the two mining queries — bound per-tick memory and SQLite
/// pool pressure regardless of event volume (mirrors the composite engine's
/// scan cap philosophy).
const EVENT_SCAN_CAP: i64 = 5_000;
const EXECUTION_SCAN_CAP: i64 = 2_000;

/// Evidence entries persisted per suggestion (newest kept). The drawer shows
/// real co-occurrences; 20 is plenty to audit without bloating the row.
const MAX_EVIDENCE_ENTRIES: usize = 20;

// ---------------------------------------------------------------------------
// Pure mining core (unit-tested)
// ---------------------------------------------------------------------------

/// An above-threshold co-occurrence pattern ready to persist.
#[derive(Debug, Clone, PartialEq)]
pub struct CandidatePattern {
    pub event_type: String,
    pub persona_id: String,
    /// Distinct manual runs that had a matching event in-window.
    pub occurrence_count: u32,
    /// All manual runs of this persona in the lookback (support denominator).
    pub manual_run_count: u32,
    /// `occurrence_count / manual_run_count`.
    pub support: f32,
    /// Newest-last, capped at `MAX_EVIDENCE_ENTRIES`.
    pub evidence: Vec<AutomationSuggestionEvidence>,
    pub first_seen_at: String,
    pub last_seen_at: String,
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            // SQLite `datetime('now')` writes "YYYY-MM-DD HH:MM:SS" (no T/Z).
            chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
                .map(|n| n.and_utc())
                .ok()
        })
}

/// The pure co-occurrence miner.
///
/// For every MANUAL execution (trigger_id must be `None` — rows with any
/// trigger id are dropped, mined-route or not), find the events in the
/// preceding `window_seconds`; each distinct event type contributes ONE
/// co-occurrence per execution (deduped so an event burst can't inflate a
/// single run into five). Events published by mined-route triggers
/// (`excluded_trigger_ids`) are invisible to the miner — this is the
/// feedback-loop exclusion the batch design mandates.
///
/// Inputs may arrive unsorted; both sides are sorted internally. Rows with
/// unparseable timestamps are skipped (never guessed).
// `Option::is_none_or` is stable since 1.82.0 and the manifests declare
// `rust-version = "1.80.0"`. Nothing in this workspace actually requires
// 1.80 — all five crates are `publish = false` and CI pins no toolchain — so
// the honest fix is to correct the manifest, which is a policy call for the
// Director rather than this lane's to make. Allowed here, narrowly, until
// that decision lands. See the W0 clippy lane report.
#[allow(clippy::incompatible_msrv)]
pub fn mine_co_occurrences(
    events: &[MinedEvent],
    executions: &[MinedExecution],
    window_seconds: u32,
    min_count: u32,
    excluded_trigger_ids: &HashSet<String>,
) -> Vec<CandidatePattern> {
    // Parse + filter the event side. Mined-route exclusion happens HERE.
    let mut evs: Vec<(&MinedEvent, DateTime<Utc>)> = events
        .iter()
        .filter(|e| {
            e.source_id
                .as_deref()
                .is_none_or(|sid| !excluded_trigger_ids.contains(sid))
        })
        .filter_map(|e| parse_ts(&e.created_at).map(|t| (e, t)))
        .collect();
    evs.sort_by_key(|(_, t)| *t);

    // Parse + filter the execution side: manual runs only. `trigger_id IS
    // NULL` is enforced at SQL level too, but re-enforcing here makes the
    // exclusion property testable in isolation.
    let mut exs: Vec<(&MinedExecution, DateTime<Utc>)> = executions
        .iter()
        .filter(|x| x.trigger_id.is_none())
        .filter_map(|x| parse_ts(&x.created_at).map(|t| (x, t)))
        .collect();
    exs.sort_by_key(|(_, t)| *t);

    let window = Duration::seconds(window_seconds as i64);

    // Manual-run totals per persona (support denominator).
    let mut manual_totals: HashMap<&str, u32> = HashMap::new();
    for (x, _) in &exs {
        *manual_totals.entry(x.persona_id.as_str()).or_default() += 1;
    }

    // Forward pass: executions are sorted, so the window's start index only
    // ever advances — O(E + X·types) instead of O(E·X).
    let mut start = 0usize;
    let mut patterns: HashMap<(String, String), CandidatePattern> = HashMap::new();

    for &(x, exec_t) in &exs {
        let window_start = exec_t - window;
        while start < evs.len() && evs[start].1 < window_start {
            start += 1;
        }
        // Latest in-window event per type BEFORE (or at) the run — dedupe so
        // one run pairs with each event type at most once.
        let mut latest_per_type: HashMap<&str, (&MinedEvent, DateTime<Utc>)> = HashMap::new();
        for &(e, et) in &evs[start..] {
            if et > exec_t {
                break;
            }
            latest_per_type.insert(e.event_type.as_str(), (e, et));
        }
        for (event_type, (e, et)) in latest_per_type {
            let gap = (exec_t - et).num_seconds().max(0) as u32;
            let key = (event_type.to_string(), x.persona_id.clone());
            let entry = patterns.entry(key).or_insert_with(|| CandidatePattern {
                event_type: event_type.to_string(),
                persona_id: x.persona_id.clone(),
                occurrence_count: 0,
                manual_run_count: manual_totals
                    .get(x.persona_id.as_str())
                    .copied()
                    .unwrap_or(0),
                support: 0.0,
                evidence: Vec::new(),
                first_seen_at: e.created_at.clone(),
                last_seen_at: x.created_at.clone(),
            });
            entry.occurrence_count += 1;
            entry.last_seen_at = x.created_at.clone();
            entry.evidence.push(AutomationSuggestionEvidence {
                event_id: e.id.clone(),
                event_at: e.created_at.clone(),
                execution_id: x.id.clone(),
                executed_at: x.created_at.clone(),
                gap_seconds: gap,
            });
        }
    }

    let mut out: Vec<CandidatePattern> = patterns
        .into_values()
        .filter(|p| p.occurrence_count >= min_count)
        .map(|mut p| {
            p.support = if p.manual_run_count > 0 {
                p.occurrence_count as f32 / p.manual_run_count as f32
            } else {
                0.0
            };
            if p.evidence.len() > MAX_EVIDENCE_ENTRIES {
                let drop = p.evidence.len() - MAX_EVIDENCE_ENTRIES;
                p.evidence.drain(0..drop);
            }
            p
        })
        .collect();
    // Deterministic order: strongest signal first.
    out.sort_by(|a, b| {
        b.occurrence_count
            .cmp(&a.occurrence_count)
            .then_with(|| a.event_type.cmp(&b.event_type))
            .then_with(|| a.persona_id.cmp(&b.persona_id))
    });
    out
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

/// True when at least one project's autopilot mode grants
/// [`Capability::AutomationSuggestion`]. There is no legacy global flag for
/// this capability, so "no project opted in" honestly means OFF.
pub fn mining_enabled(pool: &DbPool) -> bool {
    let modes = autopilot::load_modes(pool);
    modes
        .values()
        .any(|m| m.allows(Capability::AutomationSuggestion))
}

/// (listen_event_type, persona_id) pairs already wired as enabled
/// event_listener triggers — suggesting a route the user already has would
/// be an instant trust-burner.
fn existing_listener_pairs(pool: &DbPool) -> HashSet<(String, String)> {
    let mut out = HashSet::new();
    if let Ok(triggers) = trigger_repo::get_enabled_by_type(pool, "event_listener") {
        for t in &triggers {
            if let TriggerConfig::EventListener {
                listen_event_type: Some(ev),
                ..
            } = t.parse_config()
            {
                out.insert((ev, t.persona_id.clone()));
            }
        }
    }
    out
}

/// One mining pass. Read-side except for the `automation_suggestions` table.
pub fn pattern_miner_tick(pool: &DbPool) {
    if !mining_enabled(pool) {
        return;
    }

    let since = (Utc::now() - Duration::days(LOOKBACK_DAYS as i64)).to_rfc3339();

    let excluded: HashSet<String> = match suggestion_repo::committed_trigger_ids(pool) {
        Ok(ids) => ids.into_iter().collect(),
        Err(e) => {
            tracing::warn!("pattern_miner: failed to load mined-route tags: {e} — skipping tick");
            return;
        }
    };

    let events = match suggestion_repo::mining_events(pool, &since, EVENT_SCAN_CAP) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("pattern_miner: event query failed: {e} — skipping tick");
            return;
        }
    };
    let executions =
        match suggestion_repo::mining_manual_executions(pool, &since, EXECUTION_SCAN_CAP) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("pattern_miner: execution query failed: {e} — skipping tick");
                return;
            }
        };

    let candidates = mine_co_occurrences(
        &events,
        &executions,
        CO_OCCURRENCE_WINDOW_SECONDS,
        MIN_CO_OCCURRENCES,
        &excluded,
    );

    // Respect decisions + existing wiring: never re-propose a decided pair,
    // never propose a route that already exists as a live listener.
    let decided: HashSet<(String, String)> = match suggestion_repo::decided_pairs(pool) {
        Ok(pairs) => pairs.into_iter().collect(),
        Err(e) => {
            tracing::warn!("pattern_miner: decided-pairs query failed: {e} — skipping tick");
            return;
        }
    };
    let wired = existing_listener_pairs(pool);

    let mut live_pairs: Vec<(String, String)> = Vec::new();
    let mut proposed = 0u32;
    for c in &candidates {
        let pair = (c.event_type.clone(), c.persona_id.clone());
        if decided.contains(&pair) || wired.contains(&pair) {
            continue;
        }
        if let Err(e) = suggestion_repo::upsert_proposed(
            pool,
            &c.event_type,
            &c.persona_id,
            c.occurrence_count,
            c.manual_run_count,
            c.support,
            CO_OCCURRENCE_WINDOW_SECONDS,
            LOOKBACK_DAYS,
            &c.evidence,
            &c.first_seen_at,
            &c.last_seen_at,
        ) {
            tracing::warn!(
                event_type = %c.event_type,
                persona_id = %c.persona_id,
                "pattern_miner: upsert failed: {e}"
            );
            continue;
        }
        proposed += 1;
        live_pairs.push(pair);
    }

    // Ghost cables whose evidence decayed below threshold disappear — a stale
    // suggestion is a stretched inference.
    match suggestion_repo::prune_stale_proposed(pool, &live_pairs) {
        Ok(0) => {}
        Ok(n) => tracing::info!("pattern_miner: pruned {n} decayed suggestion(s)"),
        Err(e) => tracing::warn!("pattern_miner: prune failed: {e}"),
    }

    if proposed > 0 {
        tracing::info!(
            candidates = candidates.len(),
            live = proposed,
            "pattern_miner: mined automation suggestions"
        );
    }
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/// Background subscription driving the miner. Registered in
/// `engine::background` alongside the composite engine.
pub struct PatternMinerSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl super::subscription::ReactiveSubscription for PatternMinerSubscription {
    fn name(&self) -> &'static str {
        "pattern_miner"
    }

    fn interval(&self) -> std::time::Duration {
        // Patterns accrete over days; 10 minutes is plenty responsive.
        std::time::Duration::from_secs(600)
    }

    fn idle_interval(&self) -> std::time::Duration {
        std::time::Duration::from_secs(1800)
    }

    fn initial_delay(&self) -> std::time::Duration {
        std::time::Duration::from_secs(45)
    }

    async fn tick(&self) {
        let pool = self.pool.clone();
        let handle = tokio::task::spawn_blocking(move || pattern_miner_tick(&pool));
        if let Err(join_err) = handle.await {
            if join_err.is_panic() {
                std::panic::resume_unwind(join_err.into_panic());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, event_type: &str, source_id: Option<&str>, at: &str) -> MinedEvent {
        MinedEvent {
            id: id.into(),
            event_type: event_type.into(),
            source_id: source_id.map(String::from),
            created_at: at.into(),
        }
    }

    fn ex(id: &str, persona: &str, trigger_id: Option<&str>, at: &str) -> MinedExecution {
        MinedExecution {
            id: id.into(),
            persona_id: persona.into(),
            trigger_id: trigger_id.map(String::from),
            created_at: at.into(),
        }
    }

    /// Build N (event, manual-run) pairs spaced a day apart, run 60s after event.
    fn habit(n: u32, event_type: &str, persona: &str) -> (Vec<MinedEvent>, Vec<MinedExecution>) {
        let mut events = Vec::new();
        let mut execs = Vec::new();
        for i in 0..n {
            let day = i + 1;
            events.push(ev(
                &format!("e{i}"),
                event_type,
                None,
                &format!("2026-07-{day:02}T10:00:00Z"),
            ));
            execs.push(ex(
                &format!("x{i}"),
                persona,
                None,
                &format!("2026-07-{day:02}T10:01:00Z"),
            ));
        }
        (events, execs)
    }

    #[test]
    fn threshold_gates_proposals() {
        let none = HashSet::new();
        // 4 co-occurrences with min 5 → not enough signal yet.
        let (events, execs) = habit(4, "deploy_completed", "p1");
        assert!(mine_co_occurrences(&events, &execs, 600, 5, &none).is_empty());
        // The 5th observation crosses the bar.
        let (events, execs) = habit(5, "deploy_completed", "p1");
        let got = mine_co_occurrences(&events, &execs, 600, 5, &none);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].event_type, "deploy_completed");
        assert_eq!(got[0].persona_id, "p1");
        assert_eq!(got[0].occurrence_count, 5);
        assert_eq!(got[0].manual_run_count, 5);
        assert!((got[0].support - 1.0).abs() < f32::EPSILON);
        assert_eq!(got[0].evidence.len(), 5);
        assert_eq!(got[0].evidence[0].gap_seconds, 60);
    }

    #[test]
    fn runs_outside_window_do_not_count() {
        let none = HashSet::new();
        let (mut events, mut execs) = habit(4, "deploy_completed", "p1");
        // A 5th pair where the run comes 11 minutes after the event.
        events.push(ev("e5", "deploy_completed", None, "2026-07-06T10:00:00Z"));
        execs.push(ex("x5", "p1", None, "2026-07-06T10:11:00Z"));
        assert!(mine_co_occurrences(&events, &execs, 600, 5, &none).is_empty());
    }

    /// THE feedback-loop test: a committed suggestion's own trigger traffic —
    /// its published events (source_id = trigger id) and its executions
    /// (trigger_id = trigger id) — must never feed future evidence.
    #[test]
    fn mined_route_traffic_is_excluded_from_evidence() {
        let mined: HashSet<String> = ["trig-mined".to_string()].into_iter().collect();

        // 5 events PUBLISHED BY the mined trigger, each followed by a manual
        // run: without the tag this would re-propose the very same loop.
        let mut events = Vec::new();
        let mut execs = Vec::new();
        for i in 0..5u32 {
            let day = i + 1;
            events.push(ev(
                &format!("e{i}"),
                "deploy_completed",
                Some("trig-mined"),
                &format!("2026-07-{day:02}T10:00:00Z"),
            ));
            execs.push(ex(
                &format!("x{i}"),
                "p1",
                None,
                &format!("2026-07-{day:02}T10:01:00Z"),
            ));
        }
        assert!(
            mine_co_occurrences(&events, &execs, 600, 5, &mined).is_empty(),
            "events published by a mined-route trigger must not feed evidence"
        );

        // 5 clean events, but the follow-up runs were FIRED BY the mined
        // trigger (not manual) — also excluded.
        let mut events = Vec::new();
        let mut execs = Vec::new();
        for i in 0..5u32 {
            let day = i + 1;
            events.push(ev(
                &format!("e{i}"),
                "deploy_completed",
                None,
                &format!("2026-07-{day:02}T10:00:00Z"),
            ));
            execs.push(ex(
                &format!("x{i}"),
                "p1",
                Some("trig-mined"),
                &format!("2026-07-{day:02}T10:01:00Z"),
            ));
        }
        assert!(
            mine_co_occurrences(&events, &execs, 600, 5, &mined).is_empty(),
            "executions fired by a mined-route trigger must not count as manual runs"
        );

        // Identical shape WITHOUT the exclusions fires — proving the empties
        // above come from the tag, not from the data shape.
        let (events, execs) = habit(5, "deploy_completed", "p1");
        assert_eq!(
            mine_co_occurrences(&events, &execs, 600, 5, &mined).len(),
            1
        );
    }

    #[test]
    fn any_trigger_fired_execution_is_never_manual() {
        let none = HashSet::new();
        let (events, mut execs) = habit(5, "deploy_completed", "p1");
        // Rewire all runs to some unrelated trigger — zero manual signal left.
        for x in &mut execs {
            x.trigger_id = Some("trig-other".into());
        }
        assert!(mine_co_occurrences(&events, &execs, 600, 5, &none).is_empty());
    }

    #[test]
    fn event_burst_counts_once_per_run() {
        let none = HashSet::new();
        // One manual run preceded by 10 identical events in-window: that is
        // ONE co-occurrence, not ten.
        let mut events = Vec::new();
        for i in 0..10 {
            events.push(ev(
                &format!("e{i}"),
                "deploy_completed",
                None,
                &format!("2026-07-01T10:00:{i:02}Z"),
            ));
        }
        let execs = vec![ex("x0", "p1", None, "2026-07-01T10:05:00Z")];
        let got = mine_co_occurrences(&events, &execs, 600, 1, &none);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].occurrence_count, 1);
        // Evidence pairs the run with the LATEST matching event.
        assert_eq!(got[0].evidence[0].event_id, "e9");
    }

    #[test]
    fn support_reflects_partial_habits() {
        let none = HashSet::new();
        let (mut events, mut execs) = habit(5, "deploy_completed", "p1");
        // 5 extra manual runs of p1 with no event nearby → support 5/10.
        for i in 0..5u32 {
            let day = i + 10;
            execs.push(ex(
                &format!("solo{i}"),
                "p1",
                None,
                &format!("2026-07-{day:02}T18:00:00Z"),
            ));
        }
        events.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        let got = mine_co_occurrences(&events, &execs, 600, 5, &none);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].occurrence_count, 5);
        assert_eq!(got[0].manual_run_count, 10);
        assert!((got[0].support - 0.5).abs() < f32::EPSILON);
    }

    #[test]
    fn unparseable_timestamps_are_skipped_not_guessed() {
        let none = HashSet::new();
        let (mut events, execs) = habit(5, "deploy_completed", "p1");
        events.push(ev("bad", "deploy_completed", None, "not-a-timestamp"));
        // Still exactly one clean pattern; the bad row contributed nothing.
        let got = mine_co_occurrences(&events, &execs, 600, 5, &none);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].occurrence_count, 5);
    }

    #[test]
    fn sqlite_datetime_format_parses() {
        // `datetime('now')` rows ("YYYY-MM-DD HH:MM:SS") must be minable.
        assert!(parse_ts("2026-07-01 10:00:00").is_some());
        assert!(parse_ts("2026-07-01T10:00:00Z").is_some());
        assert!(parse_ts("garbage").is_none());
    }

    #[test]
    fn evidence_is_capped_to_newest() {
        let none = HashSet::new();
        let (events, execs) = habit(25, "deploy_completed", "p1");
        let got = mine_co_occurrences(&events, &execs, 600, 5, &none);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].occurrence_count, 25);
        assert_eq!(got[0].evidence.len(), MAX_EVIDENCE_ENTRIES);
        // Newest kept: the last evidence entry is the most recent run.
        assert_eq!(got[0].evidence.last().unwrap().execution_id, "x24");
    }
}
