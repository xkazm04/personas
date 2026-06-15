//! KPI → Goal derivation (docs/plans/kpi-driven-orchestration.md P4).
//!
//! The piece that closes the steering circle: an ACTIVE KPI that is
//! OFF-TRACK (pace-based — the same rule as the UI's `kpiMath.ts`) derives a
//! goal for the project's team via a headless Claude decision. The goal rides
//! the normal GoalAdvance loop unchanged — teams never learn KPIs exist; they
//! see goals. And a derived goal completing does NOT mean success: the next
//! measurement decides, which is exactly why the candidate rules below gate
//! on measurement freshness and post-completion re-measurement.
//!
//! Candidate rules (all enforced in SQL + the off-track check):
//! 1. KPI is `active` with a fresh measurement (within 2× its cadence — a
//!    derivation from stale data would steer blind).
//! 2. No OPEN goal already carries this `kpi_id` (one derived goal per KPI).
//! 3. Post-completion cooldown: if the most recent derived goal for this KPI
//!    completed AFTER the last measurement, the needle hasn't been re-read
//!    since the work landed — wait for the next measurement.
//! 4. The off-track verdict (`kpi_is_off_track`) fires on ANY of: a floor
//!    breach (business metric at zero), the user's calibrated CRITICAL line
//!    (`crit_at`) being crossed, or the pace math lagging. The `crit_at` arm
//!    is what makes the Factory console's "red derives a goal" lever *real* —
//!    the threshold the user drags is the same fact this steering loop obeys.
//!    `warn_at` ("yellow") is deliberately NOT a derivation trigger; it is the
//!    softer Athena-nudge band (see athena_reaction.rs).
//!
//! The decision itself may answer `{"kpi_goal": {"skip": true, ...}}` — a
//! measured "nothing actionable" is a legitimate outcome (same restraint
//! doctrine as Athena's react:false).

use crate::db::models::DevKpi;
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Pace tolerance as a fraction of the baseline→target span (mirrors
/// `kpiMath.ts` — keep the two in sync).
const TOLERANCE_FRAC: f64 = 0.1;

/// Rust port of the UI's `kpiTrack` off-track rule (keep in sync with
/// `src/features/teams/sub_kpis/kpiMath.ts`). Returns true when the KPI is
/// off-track by ANY of three direction-aware tests, checked in order:
///   1. floor breach — a business metric sitting at zero (`kpi_floor_breached`);
///   2. the user's calibrated CRITICAL line (`crit_at`) being crossed — the
///      Factory console lever, honored independently of pace;
///   3. pace lag — with a target_date + baseline, current lags the linearly-
///      paced expectation by more than the tolerance.
/// Without any of these (e.g. a missed target but no date to pace against and
/// no crit line drawn) the verdict is on-track, matching the UI.
pub fn kpi_is_off_track(kpi: &DevKpi) -> bool {
    if kpi_floor_breached(kpi) {
        return true;
    }
    let (Some(cur), Some(target)) = (kpi.current_value, kpi.target_value) else {
        return false; // unmeasured or target-less — nothing to steer against
    };
    let met = if kpi.direction == "down" { cur <= target } else { cur >= target };
    if met {
        return false; // a met target wins over any threshold or pace verdict
    }
    // The user's hard CRITICAL line. When calibrated (crit_at set) and crossed,
    // that is an explicit off-track verdict on its own — earlier than, and
    // independent of, the pace math below. This is the lever the Factory console
    // exposes; until the user draws it, crit_at is NULL and we fall through.
    if let Some(crit) = kpi.crit_at {
        let breached = if kpi.direction == "down" { cur >= crit } else { cur <= crit };
        if breached {
            return true;
        }
    }
    let (Some(date), Some(baseline)) = (kpi.target_date.as_deref(), kpi.baseline_value) else {
        return false;
    };
    let start = parse_ts(&kpi.created_at);
    let end = parse_ts(date);
    let (Some(start), Some(end)) = (start, end) else { return false };
    if end <= start {
        return false;
    }
    let now = chrono::Utc::now();
    let frac = ((now - start).num_seconds() as f64 / (end - start).num_seconds() as f64)
        .clamp(0.0, 1.0);
    let span = target - baseline;
    let expected = baseline + span * frac;
    let tolerance = span.abs() * TOLERANCE_FRAC;
    if kpi.direction == "down" {
        cur > expected + tolerance
    } else {
        cur < expected - tolerance
    }
}

/// The "0 users beats 100% coverage" rule: a MEASURED business KPI
/// (traffic/value) sitting at zero is maximally off-track no matter what the
/// pace math says — there is no pace toward a target when the floor itself
/// is breached. Derivation prompts reframe these to "establish the first
/// unit of value".
pub fn kpi_floor_breached(kpi: &DevKpi) -> bool {
    matches!(kpi.category.as_str(), "traffic" | "value")
        && kpi.direction == "up"
        && kpi.current_value.is_some_and(|v| v <= 0.0)
}

fn parse_ts(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    let n = s.replace(' ', "T");
    chrono::DateTime::parse_from_rfc3339(&n)
        .map(|t| t.with_timezone(&chrono::Utc))
        .ok()
        .or_else(|| {
            chrono::NaiveDateTime::parse_from_str(&n, "%Y-%m-%dT%H:%M:%S")
                .map(|x| x.and_utc())
                .ok()
        })
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(&n, "%Y-%m-%d")
                .map(|d| d.and_hms_opt(0, 0, 0).unwrap().and_utc())
                .ok()
        })
}

/// Find derivation candidates: active, fresh, no open derived goal,
/// re-measured since the last derived goal completed, and off-track.
/// Ordered business-first (value/traffic before quality/technical — the
/// "0 users beats 100% coverage" precedence; full tier semantics arrive
/// with P6).
pub fn find_derivation_candidates(pool: &DbPool, limit: usize) -> Result<Vec<DevKpi>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT k.* FROM dev_kpis k
         JOIN dev_projects dp ON dp.id = k.project_id AND dp.team_id IS NOT NULL
         WHERE k.status = 'active'
           AND k.current_value IS NOT NULL
           AND k.last_measured_at IS NOT NULL
           -- freshness: within 2x cadence (manual-cadence KPIs use 14d)
           AND datetime(k.last_measured_at) > datetime('now',
               CASE k.cadence WHEN 'daily' THEN '-2 days'
                              WHEN 'weekly' THEN '-14 days'
                              ELSE '-14 days' END)
           -- one open derived goal per KPI
           AND NOT EXISTS (SELECT 1 FROM dev_goals g
                            WHERE g.kpi_id = k.id
                              AND g.status NOT IN ('done','completed'))
           -- post-completion cooldown: must have re-measured since the last
           -- derived goal landed
           AND NOT EXISTS (SELECT 1 FROM dev_goals g2
                            WHERE g2.kpi_id = k.id
                              AND g2.completed_at IS NOT NULL
                              AND datetime(g2.completed_at) >= datetime(k.last_measured_at))
         ORDER BY CASE k.tier WHEN 'north_star' THEN 0 WHEN 'primary' THEN 1 ELSE 2 END,
                  CASE k.category WHEN 'value' THEN 0 WHEN 'traffic' THEN 1
                                  WHEN 'quality' THEN 2 ELSE 3 END,
                  datetime(k.last_measured_at) DESC",
    )?;
    let rows = stmt
        .query_map([], repo::row_to_kpi)?
        .filter_map(Result::ok)
        .filter(kpi_is_off_track)
        .take(limit)
        .collect();
    Ok(rows)
}

#[derive(Debug, serde::Deserialize)]
struct KpiGoalEnvelope {
    kpi_goal: KpiGoalDecision,
}

#[derive(Debug, serde::Deserialize)]
struct KpiGoalDecision {
    #[serde(default)]
    skip: bool,
    #[serde(default)]
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    context_id: Option<String>,
    #[serde(default)]
    target_date: Option<String>,
    #[serde(default)]
    rationale: String,
}

fn parse_kpi_goal(blob: &str) -> Option<KpiGoalDecision> {
    let marker = "\"kpi_goal\"";
    let mut result = None;
    let mut from = 0;
    while let Some(rel) = blob[from..].find(marker) {
        let pos = from + rel;
        from = pos + marker.len();
        let Some(open) = blob[..pos].rfind('{') else { continue };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            if let Ok(env) = serde_json::from_str::<KpiGoalEnvelope>(&blob[open..open + close + 1]) {
                result = Some(env.kpi_goal);
            }
        }
    }
    result
}

fn build_derivation_prompt(pool: &DbPool, kpi: &DevKpi) -> String {
    let history: String = repo::list_kpi_measurements(pool, &kpi.id, Some(10))
        .unwrap_or_default()
        .iter()
        .map(|m| format!("- {} → {} ({})", m.measured_at, m.value, m.source))
        .collect::<Vec<_>>()
        .join("\n");
    let contexts: String = repo::list_contexts_by_project(pool, &kpi.project_id, None)
        .unwrap_or_default()
        .iter()
        .filter(|c| match &kpi.context_id {
            // Context-scoped KPI: offer only its own context (deterministic target).
            Some(cid) => &c.id == cid,
            // Group-scoped: the group's contexts; project-level: all.
            None => kpi.context_group_id.is_none() || c.group_id == kpi.context_group_id,
        })
        .take(20)
        .map(|c| format!("- id={} {}: {}", c.id, c.name, c.description.as_deref().unwrap_or("").chars().take(120).collect::<String>()))
        .collect::<Vec<_>>()
        .join("\n");
    let recent_goals: String = pool
        .get()
        .ok()
        .and_then(|conn| {
            conn.prepare(
                "SELECT title, status FROM dev_goals WHERE project_id = ?1
                 ORDER BY datetime(created_at) DESC LIMIT 8",
            )
            .ok()
            .and_then(|mut stmt| {
                stmt.query_map(rusqlite::params![kpi.project_id], |r| {
                    Ok(format!("- [{}] {}", r.get::<_, String>(1)?, r.get::<_, String>(0)?))
                })
                .ok()
                .map(|rows| rows.filter_map(Result::ok).collect::<Vec<_>>().join("\n"))
            })
        })
        .unwrap_or_default();

    format!(
        r#"You are the outcome-steering layer of an autonomous dev organization. A Key Performance Indicator is OFF TRACK and you must decide whether to derive ONE concrete goal for the team that owns the project — or skip, if no team-actionable work would plausibly move this metric.

KPI: {name} ({category}, measured by {kind})
{description}
Current: {current} {unit} | Target: {target} {unit} ({direction} is better){due}
Baseline: {baseline}
Measurement history (newest first):
{history}

Relevant codebase contexts (use a context id when the work clearly belongs to one):
{contexts}

Recent goals on this project (do NOT duplicate; learn what already shipped):
{recent_goals}

Rules:
- ONE goal, scoped to ship in days not weeks, that a software team can execute autonomously and that plausibly MOVES THIS METRIC. Title imperative and concrete.{floor_breach}
- The description must say HOW the work moves the metric (the causal claim the next measurement will test).
- If the metric is not movable by team work right now (needs humans, marketing, external dependency), answer skip with the reason.
- `rationale`: one short clause — recorded in the goal's provenance.{scope_hint}

Respond with the analysis you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"kpi_goal": {{"skip": false, "title": "...", "description": "...", "context_id": null, "target_date": null, "rationale": "..."}}}}
"#,
        name = kpi.name,
        category = kpi.category,
        kind = kpi.measure_kind,
        description = kpi.description.as_deref().unwrap_or(""),
        current = kpi.current_value.unwrap_or(0.0),
        unit = kpi.unit,
        target = kpi.target_value.unwrap_or(0.0),
        direction = if kpi.direction == "down" { "lower" } else { "higher" },
        due = kpi
            .target_date
            .as_deref()
            .map(|d| format!(" | Due: {d}"))
            .unwrap_or_default(),
        baseline = kpi
            .baseline_value
            .map(|b| b.to_string())
            .unwrap_or_else(|| "unknown".into()),
        history = if history.is_empty() { "(single measurement)".into() } else { history },
        contexts = if contexts.is_empty() { "(no context map)".to_string() } else { contexts },
        recent_goals = if recent_goals.is_empty() { "(none)".to_string() } else { recent_goals },
        scope_hint = match &kpi.context_id {
            Some(cid) => format!("\n- This KPI is scoped to context id={cid}; default `context_id` to it unless the work clearly belongs to another listed context."),
            None => String::new(),
        },
        floor_breach = if kpi_floor_breached(kpi) {
            "\n- FLOOR BREACH: this business metric is at ZERO. Do not propose incremental optimization — propose the single most direct path to ESTABLISH THE FIRST UNIT OF VALUE (the first user, the first real request). Distribution/instrumentation/activation work beats internal quality work here."
        } else {
            ""
        },
    )
}

/// Derive a goal from one off-track KPI. Returns the goal title when created,
/// `None` on a (legitimate) skip.
pub async fn derive_goal_from_kpi(
    pool: &DbPool,
    kpi: &DevKpi,
) -> Result<Option<String>, AppError> {
    let prompt = build_derivation_prompt(pool, kpi);
    let blob = crate::companion::athena_reaction::cli_text(prompt).await?;
    let Some(decision) = parse_kpi_goal(&blob) else {
        return Err(AppError::Internal(
            "KPI derivation produced no parseable kpi_goal decision".into(),
        ));
    };
    if decision.skip || decision.title.trim().is_empty() {
        tracing::info!(kpi = %kpi.name, rationale = %decision.rationale,
            "kpi_derivation: SKIP — no team-actionable goal");
        return Ok(None);
    }

    // Provenance footer — the causal claim the next measurement will test.
    let provenance = format!(
        "\n\n---\n*Derived from KPI \"{}\": current {} {}, target {} {}{}. {}*",
        kpi.name,
        kpi.current_value.unwrap_or(0.0),
        kpi.unit,
        kpi.target_value.unwrap_or(0.0),
        kpi.unit,
        kpi.target_date.as_deref().map(|d| format!(" by {d}")).unwrap_or_default(),
        decision.rationale.trim(),
    );
    let description = format!("{}{}", decision.description.trim(), provenance);

    // Validate the context id against the live map (hallucination guard).
    let context_id = decision.context_id.as_deref().filter(|cid| {
        repo::list_contexts_by_project(pool, &kpi.project_id, None)
            .map(|cs| cs.iter().any(|c| c.id == *cid))
            .unwrap_or(false)
    });

    let goal = repo::create_goal(
        pool,
        &kpi.project_id,
        decision.title.trim(),
        Some(&description),
        context_id,
        Some("open"),
        decision.target_date.as_deref().or(kpi.target_date.as_deref()),
        None,
    )?;
    // Soft link (column added in P0; create_goal predates it).
    let conn = pool.get()?;
    conn.execute(
        "UPDATE dev_goals SET kpi_id = ?1 WHERE id = ?2",
        rusqlite::params![kpi.id, goal.id],
    )?;
    drop(conn);
    let _ = repo::create_goal_signal(
        pool,
        &goal.id,
        "kpi_derivation",
        Some(&kpi.id),
        None,
        Some(&format!(
            "Derived because '{}' is off track ({} vs target {})",
            kpi.name,
            kpi.current_value.unwrap_or(0.0),
            kpi.target_value.unwrap_or(0.0)
        )),
    );
    tracing::info!(kpi = %kpi.name, goal_id = %goal.id, title = %goal.title,
        "kpi_derivation: goal derived");
    Ok(Some(goal.title))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kpi(cur: Option<f64>, target: Option<f64>, baseline: Option<f64>, date: Option<&str>, dir: &str, created: &str) -> DevKpi {
        DevKpi {
            id: "k".into(),
            project_id: "p".into(),
            context_group_id: None,
            context_id: None,
            name: "t".into(),
            description: None,
            category: "technical".into(),
            measure_kind: "codebase".into(),
            measure_config: "{}".into(),
            unit: "%".into(),
            direction: dir.into(),
            baseline_value: baseline,
            target_value: target,
            target_date: date.map(String::from),
            current_value: cur,
            last_measured_at: None,
            cadence: "weekly".into(),
            status: "active".into(),
            created_by: "user".into(),
            rationale: None,
            needed_connector: None,
            metric_type: None,
            tier: "supporting".into(),
            warn_at: None,
            crit_at: None,
            manual_rating: None,
            assessment_pros: None,
            assessment_cons: None,
            created_at: created.into(),
            updated_at: created.into(),
        }
    }

    #[test]
    fn unmeasured_or_targetless_is_not_off_track() {
        assert!(!kpi_is_off_track(&kpi(None, Some(70.0), Some(50.0), None, "up", "2026-01-01 00:00:00")));
        assert!(!kpi_is_off_track(&kpi(Some(50.0), None, Some(50.0), None, "up", "2026-01-01 00:00:00")));
    }

    #[test]
    fn met_target_is_not_off_track() {
        assert!(!kpi_is_off_track(&kpi(Some(75.0), Some(70.0), Some(50.0), Some("2030-01-01"), "up", "2026-01-01 00:00:00")));
        assert!(!kpi_is_off_track(&kpi(Some(3.0), Some(5.0), Some(10.0), Some("2030-01-01"), "down", "2026-01-01 00:00:00")));
    }

    #[test]
    fn lagging_pace_is_off_track() {
        // Window long past: expected ≈ target; current far below → off-track.
        assert!(kpi_is_off_track(&kpi(Some(51.0), Some(70.0), Some(50.0), Some("2026-01-10"), "up", "2026-01-01 00:00:00")));
    }

    #[test]
    fn fresh_kpi_at_baseline_is_on_track() {
        // Window barely started: expected ≈ baseline; current == baseline → fine.
        let far = chrono::Utc::now() + chrono::Duration::days(60);
        let created = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        assert!(!kpi_is_off_track(&kpi(
            Some(50.0), Some(70.0), Some(50.0),
            Some(&far.format("%Y-%m-%d").to_string()), "up", &created
        )));
    }

    #[test]
    fn crit_threshold_breach_is_off_track_even_when_pace_is_fine() {
        // Window barely opened (pace expects ≈ baseline) and current == baseline:
        // pace alone says on-track. But the user drew a crit line the value has
        // crossed → off-track. This is the Factory lever made real.
        let far = chrono::Utc::now() + chrono::Duration::days(60);
        let created = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let date = far.format("%Y-%m-%d").to_string();
        let mut k = kpi(Some(50.0), Some(70.0), Some(50.0), Some(&date), "up", &created);
        assert!(!kpi_is_off_track(&k), "no crit line + fresh window → on-track");
        // up KPI: breached when current <= crit. 50 <= 55 → breached.
        k.crit_at = Some(55.0);
        assert!(kpi_is_off_track(&k), "current crossed the user's crit line → off-track");
    }

    #[test]
    fn crit_threshold_not_crossed_stays_on_track() {
        let far = chrono::Utc::now() + chrono::Duration::days(60);
        let created = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let date = far.format("%Y-%m-%d").to_string();
        let mut k = kpi(Some(60.0), Some(70.0), Some(50.0), Some(&date), "up", &created);
        k.crit_at = Some(55.0); // up: 60 <= 55? no → not breached, pace fresh → on-track
        assert!(!kpi_is_off_track(&k));
    }

    #[test]
    fn met_target_beats_a_crossed_crit_line() {
        // direction down, target met (3 <= 5); even a crit line above current
        // must not flip a met KPI to off-track — met short-circuits first.
        let mut k = kpi(Some(3.0), Some(5.0), Some(10.0), Some("2030-01-01"), "down", "2026-01-01 00:00:00");
        k.crit_at = Some(2.0); // down: breached when cur >= crit; 3 >= 2 is true, but met wins
        assert!(!kpi_is_off_track(&k));
    }

    #[test]
    fn parses_skip_decision() {
        let d = parse_kpi_goal(r#"{"kpi_goal":{"skip":true,"rationale":"needs marketing"}}"#).unwrap();
        assert!(d.skip);
    }

    #[test]
    fn parses_goal_decision() {
        let d = parse_kpi_goal(r#"x {"kpi_goal":{"skip":false,"title":"Add branch tests for parser","description":"...","rationale":"largest uncovered area"}} y"#).unwrap();
        assert!(!d.skip);
        assert_eq!(d.title, "Add branch tests for parser");
    }
}
