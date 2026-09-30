//! **Is the ecosystem growing, or is she only busy?**
//!
//! The operator's standing question, and the one thing her loop could not answer
//! about itself. Every other number she keeps is a rate: dispatches, commits,
//! spend, plan items. All of them rise while she runs, whatever running
//! achieves - so a loop that burned eight refill passes at ~$0.26 each against
//! an already-full queue reported exactly the same shape as a loop that was
//! working. Motion was measured; movement was not.
//!
//! This module samples the ecosystem's *size* instead, once per projection, and
//! keeps the samples so two of them can be subtracted. The verdict is a
//! direction, not a score.
//!
//! Three properties it does not compromise on:
//!
//! 1. **Projects first.** The ecosystem is the fleet of consuming projects, not
//!    the corpus. A registry can grow forever without a project benefiting -
//!    which is `deepen`'s own oldest finding ("a landing that stops at the
//!    registry is a wiki edit", measured at 100% stale verdicts fleet-wide) - so
//!    `projects`, `judged_pairs` and `applied_subjects` lead and the corpus
//!    totals follow.
//! 2. **One metric improves by falling.** `stale_verdicts` going down is the
//!    most valuable work in the corpus. A trend that summed raw deltas would
//!    read a re-judging wave as shrinkage, so direction is a property of the
//!    metric ([`CuratorGrowthMetric::higher_is_better`]), never of the sign.
//! 3. **Unreadable is not flat.** A sample that could not be taken does not
//!    extend the flat streak, because a brake that engaged on missing data would
//!    stop her for something that never happened.

use personas_core::models::{CuratorGrowth, CuratorGrowthReading};

use crate::db::DbPool;
use crate::error::AppError;

use super::instrument::InstrumentReading;

/// How many samples a reading is computed over.
///
/// Two would answer the verdict; the streak needs more, and a window that is too
/// long makes "nothing is growing" unfalsifiable by old good news. Twelve
/// projections is about a day of her ticking at the shipped interval.
pub(super) const WINDOW: u32 = 12;

/// Take one sample from an instrument reading she has already paid for.
///
/// **Never runs a script of its own.** The instrument costs ~11 seconds cold and
/// its reading is what the projection was just built from; measuring growth from
/// a second, later read would compare the ecosystem against itself at two
/// different instants and call the difference progress.
pub(super) fn sample(reading: &InstrumentReading, measured_at: &str) -> CuratorGrowth {
    let scan = &reading.scan;
    CuratorGrowth {
        measured_at: measured_at.to_string(),
        // Every one of these is `Some` because the reading exists at all: the
        // instrument's own `parse_json(..)?` fails the whole read rather than
        // returning a half-parsed report, so a caller holding an
        // `InstrumentReading` is holding parsed JSON for all three scripts.
        projects: Some(reading.map.totals.projects),
        // `evaluated`, not `pairs`: a pair nobody has judged is coverage, not a
        // verdict, and counting it would make the map's own growth look like
        // conformance work somebody did.
        judged_pairs: Some(reading.map.totals.evaluated),
        stale_verdicts: Some(reading.map.totals.stale_verdicts),
        // The only `None` that can occur here, and it is the honest one: the
        // ledger could not be READ. A ledger that is simply absent gives
        // `Some(0)` - a fresh registry has applied nothing, which is an answer.
        applied_subjects: reading
            .applied_subjects
            .as_ref()
            .map(|set| set.len() as u32),
        subjects: Some(scan.subjects.len() as u32),
        techniques: Some(scan.domains.iter().map(|d| d.techniques).sum()),
        applications: Some(scan.domains.iter().map(|d| d.applications).sum()),
    }
}

/// Record a sample and answer with the reading it produces.
///
/// The verdict is LOGGED as well as returned, because the operator's question is
/// asked while watching a loop run for hours rather than while reading a
/// database. Once per projection, not once per tick: a per-minute line saying
/// nothing changed is how a signal becomes noise.
pub(super) fn record(
    pool: &DbPool,
    reading: &InstrumentReading,
    measured_at: &str,
) -> Result<CuratorGrowthReading, AppError> {
    let taken = sample(reading, measured_at);
    crate::db::repos::curator::insert_growth(pool, &taken)?;
    let answer = read(pool)?;
    let moved: Vec<String> = answer
        .deltas
        .iter()
        .filter(|d| d.change.is_some_and(|c| c != 0))
        .map(|d| format!("{}{:+}", d.metric.as_str(), d.change.unwrap_or(0)))
        .collect();
    tracing::info!(
        verdict = answer.verdict.as_str(),
        flat_streak = answer.flat_streak,
        samples = answer.samples,
        moved = %if moved.is_empty() { "nothing".to_string() } else { moved.join(" ") },
        "curator: is the ecosystem growing?"
    );
    Ok(answer)
}

/// Her growth reading over the newest [`WINDOW`] samples.
pub(super) fn read(pool: &DbPool) -> Result<CuratorGrowthReading, AppError> {
    let samples = crate::db::repos::curator::recent_growth(pool, WINDOW)?;
    Ok(CuratorGrowthReading::from_samples(&samples))
}

#[cfg(test)]
mod tests {
    use personas_core::models::{CuratorGrowthMetric, CuratorTrend};

    use super::*;

    fn at(day: u32) -> String {
        format!("2026-09-{day:02}T00:00:00Z")
    }

    fn g(day: u32, projects: u32, stale: u32) -> CuratorGrowth {
        CuratorGrowth {
            measured_at: at(day),
            projects: Some(projects),
            judged_pairs: Some(100),
            stale_verdicts: Some(stale),
            applied_subjects: Some(7),
            subjects: Some(475),
            techniques: Some(3274),
            applications: Some(1825),
        }
    }

    /// **The one metric that improves by falling.** Fewer stale verdicts is the
    /// most valuable work in the corpus, and a naive delta would call it decay.
    #[test]
    fn fewer_stale_verdicts_is_growth_and_more_is_not() {
        let grew = CuratorGrowthReading::from_samples(&[g(26, 12, 40), g(25, 12, 287)]);
        assert_eq!(grew.verdict, CuratorTrend::Grew);
        let stale = grew
            .deltas
            .iter()
            .find(|d| d.metric == CuratorGrowthMetric::StaleVerdicts)
            .expect("stale verdicts is one of the seven");
        assert_eq!(stale.trend, CuratorTrend::Grew);
        assert_eq!(stale.change, Some(-247), "the raw change keeps its sign");

        let shrank = CuratorGrowthReading::from_samples(&[g(26, 12, 287), g(25, 12, 40)]);
        assert_eq!(shrank.verdict, CuratorTrend::Shrank);
    }

    /// A metric going backwards outranks one going forwards. She is deciding
    /// whether to keep doing this, not grading herself.
    #[test]
    fn a_mixed_sample_reads_as_shrinkage() {
        let mixed = CuratorGrowthReading::from_samples(&[g(26, 13, 300), g(25, 12, 287)]);
        assert_eq!(mixed.verdict, CuratorTrend::Shrank);
        assert!(mixed
            .deltas
            .iter()
            .any(|d| d.trend == CuratorTrend::Grew && d.metric == CuratorGrowthMetric::Projects));
    }

    /// **One sample is not a trend.** The first projection after a fresh install
    /// must say `Unknown`, never `Flat` - which would be a claim that nothing is
    /// happening, made from a single observation.
    #[test]
    fn one_sample_is_unknown_and_never_flat() {
        let first = CuratorGrowthReading::from_samples(&[g(26, 12, 287)]);
        assert_eq!(first.verdict, CuratorTrend::Unknown);
        assert_eq!(first.samples, 1);
        assert_eq!(first.flat_streak, 0);
        assert!(first.deltas.is_empty());
        assert_eq!(first.previous, None);

        let none = CuratorGrowthReading::from_samples(&[]);
        assert_eq!(none.verdict, CuratorTrend::Unknown);
        assert_eq!(none.latest, None);
    }

    /// **The streak is the operator's question**: how many passes in a row
    /// produced no growth at all.
    #[test]
    fn the_flat_streak_counts_consecutive_passes_that_moved_nothing() {
        let flat = CuratorGrowthReading::from_samples(&[
            g(26, 12, 287),
            g(25, 12, 287),
            g(24, 12, 287),
            g(23, 12, 287),
        ]);
        assert_eq!(flat.verdict, CuratorTrend::Flat);
        assert_eq!(flat.flat_streak, 3, "three consecutive pairs moved nothing");

        // One good pass at the top resets it.
        let moved =
            CuratorGrowthReading::from_samples(&[g(26, 13, 287), g(25, 12, 287), g(24, 12, 287)]);
        assert_eq!(moved.verdict, CuratorTrend::Grew);
        assert_eq!(moved.flat_streak, 0);
    }

    /// **An unreadable metric does not extend the streak.** A brake that
    /// engaged on missing data would stop her for something that never happened.
    #[test]
    fn a_sample_nobody_could_read_breaks_the_streak_rather_than_extending_it() {
        let blank = CuratorGrowth {
            measured_at: at(24),
            ..CuratorGrowth::default()
        };
        let reading = CuratorGrowthReading::from_samples(&[g(26, 12, 287), g(25, 12, 287), blank]);
        assert_eq!(reading.verdict, CuratorTrend::Flat, "the newest pair held");
        assert_eq!(
            reading.flat_streak, 1,
            "only the pair that could be read counts; the unreadable one stops the walk"
        );
    }

    /// Two readings of a metric where one side is absent is `Unknown`, and the
    /// change is `None` rather than the present side's value.
    #[test]
    fn an_absent_reading_is_unknown_and_carries_no_change() {
        let mut half = g(26, 12, 287);
        half.applied_subjects = None;
        let reading = CuratorGrowthReading::from_samples(&[half, g(25, 12, 287)]);
        let applied = reading
            .deltas
            .iter()
            .find(|d| d.metric == CuratorGrowthMetric::AppliedSubjects)
            .expect("applied subjects is one of the seven");
        assert_eq!(applied.trend, CuratorTrend::Unknown);
        assert_eq!(applied.change, None);
        // ... and it does not drag the verdict down with it.
        assert_eq!(reading.verdict, CuratorTrend::Flat);
    }
}
