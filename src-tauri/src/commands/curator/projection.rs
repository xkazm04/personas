//! The projection: one pure function from (scan, map check, currency, policy,
//! her own history) to a plan run and its items.
//!
//! **Pure, and that is the point.** It takes a parsed reading and returns rows;
//! it opens no file, spawns no process and reads no clock of its own. That is
//! what lets it be tested against the registry's REAL 471-subject scan rather
//! than a hand-made fixture that would agree with whatever it was built from.
//!
//! ## How a clause is recognised, and the invariant that proves it
//!
//! The scan writes one English sentence per clause that fired
//! (`librarian-scan.mjs`'s `add(n, why)`), and it scores `points` as the sum of
//! those clauses' contributions. This module matches the sentences back to
//! codes by their stable shape - and then **asserts its own arithmetic against
//! the scan's**: the matched weights must add up to `points`, for every
//! subject. That check is what makes the matcher honest. If the registry
//! rewords a clause, the sum stops agreeing and [`project`] records the
//! sentence as unmatched instead of quietly dropping a finding; the test over
//! the real scan turns red on the same day.
//!
//! Five clauses are MULTIPLIED by a count the sentence leads with
//! (`3 technique(s) with no use_when` is 3 x 2); four are flat. `9 techniques
//! (design floor is 4)` leads with a number that is NOT a multiplier - it is
//! the technique count - which is exactly why the two sets are spelled out
//! rather than inferred from "does it start with a digit".
//!
//! ## What is planned
//!
//! Items exist for subjects the scan scored ABOVE ZERO. Measured against the
//! real scan: 301 of 471. The other 170 have no finding, and a plan that listed
//! them would bury the ones that do. `engine = none` stays reachable and
//! meaningful: it is where an item lands when no clause was recognised, which
//! is a finding about this app's matcher, not about the subject.

use std::collections::HashMap;

use personas_core::models::{
    CuratorConsumerProject, CuratorConsumerTotals, CuratorConsumers, CuratorCorpus, CuratorDemand,
    CuratorPolicy, CuratorReason, CuratorReasonCode,
};
use personas_db::repos::curator::{self as repo, PlanItemInput, PlanRunInput};

use super::instrument::{InstrumentReading, ScanSubject};

/// A clause's sentence and the code it was recognised as, with whether the
/// leading number multiplies the weight.
struct ClauseShape {
    code: CuratorReasonCode,
    /// Matched against the trimmed sentence.
    matcher: fn(&str) -> bool,
    /// Whether the sentence's leading integer multiplies the per-unit weight.
    /// `9 techniques (design floor is 4)` leads with a number that is the
    /// technique COUNT, so `thin_techniques` is flat despite looking like the
    /// others.
    multiplied: bool,
}

/// Every clause `librarian-scan.mjs` can write, in the weights' own order.
///
/// The sentences are pinned to the script's own format strings:
/// - `${n} technique(s) with no use_when`
/// - `no application — never reconciled against real code`   (em dash)
/// - `${n} techniques (design floor is 4)`
/// - `single stack (${stack})`
/// - `${n} expired application(s)`
/// - `${n} application(s) near their clock`
/// - `never swept by the librarian`
/// - `${lo}–${hi} citation(s) reported gone by a consumer`   (en dash spread)
/// - `${lo}–${hi} consumer deviation(s)`
const CLAUSES: [ClauseShape; 9] = [
    ClauseShape {
        code: CuratorReasonCode::CitationGone,
        matcher: |s| s.ends_with("citation(s) reported gone by a consumer"),
        multiplied: true,
    },
    ClauseShape {
        code: CuratorReasonCode::NoApplication,
        matcher: |s| s.starts_with("no application"),
        multiplied: false,
    },
    ClauseShape {
        code: CuratorReasonCode::ExpiredApplication,
        matcher: |s| s.ends_with("expired application(s)"),
        multiplied: true,
    },
    ClauseShape {
        code: CuratorReasonCode::Deviation,
        matcher: |s| s.ends_with("consumer deviation(s)"),
        multiplied: true,
    },
    ClauseShape {
        code: CuratorReasonCode::ThinTechniques,
        matcher: |s| s.contains("techniques (design floor is"),
        multiplied: false,
    },
    ClauseShape {
        code: CuratorReasonCode::NeverSwept,
        matcher: |s| s == "never swept by the librarian",
        multiplied: false,
    },
    ClauseShape {
        code: CuratorReasonCode::MissingUseWhen,
        matcher: |s| s.ends_with("technique(s) with no use_when"),
        multiplied: true,
    },
    ClauseShape {
        code: CuratorReasonCode::SingleStack,
        matcher: |s| s.starts_with("single stack ("),
        multiplied: false,
    },
    ClauseShape {
        code: CuratorReasonCode::AtRiskApplication,
        matcher: |s| s.ends_with("application(s) near their clock"),
        multiplied: true,
    },
];

/// The integer a sentence leads with, when it has one. `14–28 consumer
/// deviation(s)` gives 14 - the FLOOR, which is what the scan scores.
fn leading_count(sentence: &str) -> Option<u32> {
    let digits: String = sentence
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Recognise one of the scan's sentences. `None` means this app does not know
/// the clause - a finding about the matcher, never a reason to drop it.
fn recognise(sentence: &str) -> Option<CuratorReason> {
    let s = sentence.trim();
    let shape = CLAUSES.iter().find(|c| (c.matcher)(s))?;
    let unit = shape.code.weight();
    let weight = if shape.multiplied {
        unit.saturating_mul(leading_count(s).unwrap_or(1))
    } else {
        unit
    };
    Some(CuratorReason {
        code: shape.code,
        weight,
        detail: s.to_string(),
    })
}

/// One sentence the matcher did not recognise, carried out so a caller can log
/// it rather than discover it as a silently missing finding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnmatchedReason {
    pub subject_id: String,
    pub sentence: String,
}

/// What [`project`] produced.
pub struct Projection {
    pub run: PlanRunInput,
    pub items: Vec<PlanItemInput>,
    /// Sentences this app does not know. Empty is the expected state; anything
    /// here means the registry reworded a clause and the routing table has a
    /// hole in it.
    pub unmatched: Vec<UnmatchedReason>,
    /// Subjects whose recognised weights did NOT add up to the scan's own
    /// `points`. Same alarm, different failure mode: the clause was recognised
    /// but its arithmetic is wrong.
    pub arithmetic_disagreements: Vec<String>,
}

/// Project one plan from one reading.
///
/// `streaks` is [`repo::idle_streaks`] - HER history, and the only input to
/// `suppressed_by_saturation`. The registry's `dry_streak` travels into
/// `registry_dry_streak` and is never consulted, because it cannot fire (see
/// the `e48` migration header).
///
/// `now` is passed in rather than read, which is what keeps this pure.
pub fn project(
    reading: &InstrumentReading,
    policy: &CuratorPolicy,
    streaks: &HashMap<String, u32>,
    now: &str,
) -> Projection {
    let mut unmatched = Vec::new();
    let mut arithmetic_disagreements = Vec::new();
    let mut items = Vec::new();

    for subject in &reading.scan.subjects {
        if subject.reasons.is_empty() {
            // Nothing to do about this subject. Not work, so not a plan item.
            continue;
        }
        let mut reasons = Vec::with_capacity(subject.reasons.len());
        for sentence in &subject.reasons {
            match recognise(sentence) {
                Some(reason) => reasons.push(reason),
                None => unmatched.push(UnmatchedReason {
                    subject_id: subject.id.clone(),
                    sentence: sentence.clone(),
                }),
            }
        }

        // The scan's own arithmetic is the check on this app's matcher.
        let summed: u32 = reasons.iter().map(|r| r.weight).sum();
        if summed != subject.points {
            arithmetic_disagreements.push(subject.id.clone());
        }

        let dominant = dominant_reason(&reasons);
        items.push(PlanItemInput {
            subject_id: subject.id.clone(),
            domain: subject.domain.clone(),
            at: subject.at.clone(),
            points: subject.points,
            reasons,
            dominant_reason: dominant,
            engine: dominant.engine(),
            techniques: subject.techniques,
            applications: subject.applications,
            stacks: subject.stacks.clone(),
            demand: demand_of(subject),
            last_swept: subject.last_swept.clone(),
            registry_dry_streak: subject.dry_streak,
            suppressed_by_saturation: repo::suppressed(streaks, &subject.id),
            // `None` when the ledger could not be read - UNKNOWN, not "never
            // applied". A ledger that exists and names nothing gives `false`.
            has_applied_row: reading
                .applied_subjects
                .as_ref()
                .map(|set| set.contains(&subject.slug)),
        });
    }

    Projection {
        run: PlanRunInput {
            created_at: now.to_string(),
            scan_generated_at: reading.scan.generated_at.clone(),
            registry_head_sha: reading.head_sha.clone(),
            corpus: corpus_of(reading),
            consumers: consumers_of(reading),
            policy: policy.clone(),
        },
        items,
        unmatched,
        arithmetic_disagreements,
    }
}

/// The highest-scoring clause present, in the weights' own order. `None` when
/// nothing was recognised - which routes to `CuratorEngine::None` and is a
/// finding about the matcher.
fn dominant_reason(reasons: &[CuratorReason]) -> CuratorReasonCode {
    CuratorReasonCode::IN_DOMINANCE_ORDER
        .into_iter()
        .find(|code| reasons.iter().any(|r| r.code == *code))
        .unwrap_or(CuratorReasonCode::None)
}

/// Demand, or `None`.
///
/// Two conditions, and both must hold: the scan says demand is KNOWN for this
/// subject's bundle, and it carried a figure. `demand_known == false` with a
/// present block would be the corpus contradicting itself; taking the
/// conjunction means the stored `demand_known` flag and the stored blob can
/// never disagree.
fn demand_of(subject: &ScanSubject) -> Option<CuratorDemand> {
    if !subject.demand_known {
        return None;
    }
    subject.demand.as_ref().map(|d| CuratorDemand {
        consults: d.consults,
        deviations: d.deviations,
        deviations_summed: d.deviations_summed,
        gone: d.gone,
        gone_summed: d.gone_summed,
        contributors: d.contributors,
    })
}

fn corpus_of(reading: &InstrumentReading) -> CuratorCorpus {
    let scan = &reading.scan;
    CuratorCorpus {
        generated_at: scan.generated_at.clone(),
        today: scan.today.clone(),
        subjects: scan.subjects.len() as u32,
        techniques: scan.domains.iter().map(|d| d.techniques).sum(),
        applications: scan.domains.iter().map(|d| d.applications).sum(),
        domains: scan.domains.len() as u32,
        demand_known_for_any_bundle: scan.demand_known_for_any_bundle,
        applied_subjects: reading
            .applied_subjects
            .as_ref()
            .map(|set| set.len() as u32),
        expired_applications: reading.currency.totals.expired,
        at_risk_applications: reading.currency.totals.at_risk,
        drift_unknown: reading.currency.totals.drift_unknown,
        drift: reading.currency.drift.len() as u32,
    }
}

fn consumers_of(reading: &InstrumentReading) -> CuratorConsumers {
    let map = &reading.map;
    CuratorConsumers {
        generated_at: map.generated_at.clone(),
        maps_stale: map.maps_stale,
        projects: map
            .projects
            .iter()
            .map(|p| CuratorConsumerProject {
                slug: p.slug.clone(),
                contexts: p.contexts,
                pairs: p.pairs,
                weak: p.weak,
                evaluated: p.evaluated,
                deviations: p.deviations,
                stale_verdicts: p.stale_verdicts,
                state: p.state.clone(),
                orphaned: p.orphaned,
            })
            .collect(),
        totals: CuratorConsumerTotals {
            projects: map.totals.projects,
            pairs: map.totals.pairs,
            evaluated: map.totals.evaluated,
            weak: map.totals.weak,
            stale_verdicts: map.totals.stale_verdicts,
            stale_projects: map.totals.stale_projects,
            orphaned: map.totals.orphaned,
        },
        problems: map.problems.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    use personas_core::models::CuratorEngine;

    use super::super::instrument::{Currency, LibrarianScan, MapCheck};

    /// The registry's REAL scan, 2026-09-22: 471 subjects, 3,274 techniques,
    /// 1,825 applications across 10 bundles. Copied rather than synthesised,
    /// because a fixture built from this matcher would agree with it by
    /// construction.
    const REAL_SCAN: &str = include_str!("fixtures/librarian-scan.json");

    fn real_scan() -> LibrarianScan {
        serde_json::from_str(REAL_SCAN).expect("the real scan must parse")
    }

    fn reading(scan: LibrarianScan) -> InstrumentReading {
        InstrumentReading {
            scan,
            map: serde_json::from_str::<MapCheck>(
                r#"{"generatedAt":"2026-09-23T08:45:22Z",
                    "projects":[{"slug":"personas","contexts":215,"pairs":1765,"weak":14,
                                 "evaluated":179,"deviations":122,"stale_verdicts":147,
                                 "state":"STALE","orphaned":0}],
                    "totals":{"projects":12,"pairs":8847,"evaluated":319,"weak":63,
                              "stale_verdicts":216,"stale_projects":12,"orphaned":10},
                    "problems":[]}"#,
            )
            .unwrap(),
            currency: serde_json::from_str::<Currency>(
                r#"{"totals":{"applications":1825,"expired":0,"atRisk":4,"driftUnknown":505},
                    "drift":[{"a":1},{"b":2},{"c":3}]}"#,
            )
            .unwrap(),
            applied_subjects: Some(BTreeSet::from([
                "conformance-checking".to_string(),
                "agent-memory".to_string(),
            ])),
            head_sha: Some("abc1234".into()),
        }
    }

    fn project_real() -> (InstrumentReading, Projection) {
        let r = reading(real_scan());
        let p = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        (r, p)
    }

    // -----------------------------------------------------------------------
    // The matcher, proved against the registry's own arithmetic
    // -----------------------------------------------------------------------

    /// **The load-bearing test.** Every one of the 471 real subjects: every
    /// sentence recognised, and the recognised weights adding up to the scan's
    /// own `points`. If the registry rewords a clause or changes a weight,
    /// exactly one of these two lists stops being empty.
    #[test]
    fn every_real_clause_is_recognised_and_the_arithmetic_agrees_with_the_scan() {
        let (r, p) = project_real();
        assert_eq!(
            r.scan.subjects.len(),
            471,
            "the fixture is the real 2026-09-22 scan"
        );
        assert!(
            p.unmatched.is_empty(),
            "the registry wrote a clause this app does not know: {:?}",
            &p.unmatched[..p.unmatched.len().min(5)]
        );
        assert!(
            p.arithmetic_disagreements.is_empty(),
            "recognised weights did not sum to the scan's points for: {:?}",
            &p.arithmetic_disagreements[..p.arithmetic_disagreements.len().min(5)]
        );
    }

    /// A subject with no finding is not work. 301 of the real 471 score above
    /// zero; the other 170 would bury them.
    #[test]
    fn only_the_scored_subjects_are_planned() {
        let (r, p) = project_real();
        let scored = r.scan.subjects.iter().filter(|s| s.points > 0).count();
        assert_eq!(scored, 301, "the real scan's scored count");
        assert_eq!(p.items.len(), 301);
        assert!(p.items.iter().all(|i| i.points > 0));
        // And every planned item reached a real engine - `none` would mean the
        // matcher failed, which the test above also catches from the other end.
        assert!(
            p.items.iter().all(|i| i.engine != CuratorEngine::None),
            "an item routed nowhere"
        );
        assert!(p
            .items
            .iter()
            .all(|i| i.dominant_reason != CuratorReasonCode::None));
    }

    /// Each of the nine clauses routes where the table says. Three of them -
    /// `citation_gone`, `expired_application`, `missing_use_when` - do not
    /// occur in the real 2026-09-22 scan at all (measured: 0 subjects each),
    /// so they are driven through synthetic sentences. That is the honest way
    /// to cover a branch the corpus does not currently exercise.
    #[test]
    fn every_clause_routes_to_its_engine() {
        let cases: [(&str, CuratorReasonCode, CuratorEngine, u32); 9] = [
            // Present in the real scan.
            (
                "no application — never reconciled against real code",
                CuratorReasonCode::NoApplication,
                CuratorEngine::Apply,
                6,
            ),
            (
                "14–28 consumer deviation(s)",
                CuratorReasonCode::Deviation,
                CuratorEngine::Conform,
                56,
            ),
            (
                "3 techniques (design floor is 4)",
                CuratorReasonCode::ThinTechniques,
                CuratorEngine::Deepen,
                4,
            ),
            (
                "never swept by the librarian",
                CuratorReasonCode::NeverSwept,
                CuratorEngine::Deepen,
                3,
            ),
            (
                "single stack (process)",
                CuratorReasonCode::SingleStack,
                CuratorEngine::Apply,
                2,
            ),
            (
                "4 application(s) near their clock",
                CuratorReasonCode::AtRiskApplication,
                CuratorEngine::Reconcile,
                4,
            ),
            // Absent from the 2026-09-22 corpus; synthesised from the script's
            // own format strings.
            (
                "2–3 citation(s) reported gone by a consumer",
                CuratorReasonCode::CitationGone,
                CuratorEngine::Intake,
                12,
            ),
            (
                "1 expired application(s)",
                CuratorReasonCode::ExpiredApplication,
                CuratorEngine::Reconcile,
                5,
            ),
            (
                "3 technique(s) with no use_when",
                CuratorReasonCode::MissingUseWhen,
                CuratorEngine::Deepen,
                6,
            ),
        ];
        for (sentence, code, engine, weight) in cases {
            let got = recognise(sentence).unwrap_or_else(|| panic!("unmatched: {sentence}"));
            assert_eq!(got.code, code, "{sentence}");
            assert_eq!(got.weight, weight, "{sentence}");
            assert_eq!(got.code.engine(), engine, "{sentence}");
            assert_eq!(got.detail, sentence, "the scan's own words survive");
        }
        // `forge` is the one engine no CLAUSE routes to: it answers a subject
        // that does not exist yet, which a scan of existing subjects cannot
        // report. Pinned so its absence reads as deliberate.
        assert!(CuratorReasonCode::IN_DOMINANCE_ORDER
            .into_iter()
            .all(|c| c.engine() != CuratorEngine::Forge));
    }

    /// Five clauses multiply by the count the sentence leads with; four are
    /// flat. `9 techniques (design floor is 4)` is the trap - it leads with a
    /// number that is NOT a multiplier.
    #[test]
    fn only_the_five_counted_clauses_multiply() {
        assert_eq!(
            recognise("9 techniques (design floor is 4)")
                .unwrap()
                .weight,
            4
        );
        assert_eq!(
            recognise("1 techniques (design floor is 4)")
                .unwrap()
                .weight,
            4
        );
        assert_eq!(recognise("1 consumer deviation(s)").unwrap().weight, 4);
        assert_eq!(recognise("14 consumer deviation(s)").unwrap().weight, 56);
        // The spread form scores its FLOOR, which is what the scan does.
        assert_eq!(recognise("14–28 consumer deviation(s)").unwrap().weight, 56);
        assert_eq!(
            recognise("7 application(s) near their clock")
                .unwrap()
                .weight,
            7
        );
        assert_eq!(recognise("never swept by the librarian").unwrap().weight, 3);
        assert_eq!(recognise("single stack (cpp)").unwrap().weight, 2);
    }

    /// Dominance is the weights' own order, and equal weights are broken by
    /// the declaration order so two machines answer the same.
    #[test]
    fn the_dominant_clause_is_the_heaviest_present() {
        let r = |code: CuratorReasonCode| CuratorReason {
            code,
            weight: code.weight(),
            detail: String::new(),
        };
        // 6 beats 4 beats 3.
        assert_eq!(
            dominant_reason(&[
                r(CuratorReasonCode::NeverSwept),
                r(CuratorReasonCode::Deviation),
                r(CuratorReasonCode::NoApplication),
            ]),
            CuratorReasonCode::NoApplication
        );
        // The two 6s tie, and `citation_gone` is declared first.
        assert_eq!(
            dominant_reason(&[
                r(CuratorReasonCode::NoApplication),
                r(CuratorReasonCode::CitationGone),
            ]),
            CuratorReasonCode::CitationGone
        );
        // The two 4s tie, and `deviation` is declared first.
        assert_eq!(
            dominant_reason(&[
                r(CuratorReasonCode::ThinTechniques),
                r(CuratorReasonCode::Deviation),
            ]),
            CuratorReasonCode::Deviation
        );
        // The two 2s tie, and `missing_use_when` is declared first.
        assert_eq!(
            dominant_reason(&[
                r(CuratorReasonCode::SingleStack),
                r(CuratorReasonCode::MissingUseWhen),
            ]),
            CuratorReasonCode::MissingUseWhen
        );
        // A count does NOT promote a lighter clause: 14 deviations score 56,
        // but one missing application still dominates. The order is the
        // weights', as the design says, not the contributions'.
        assert_eq!(
            dominant_reason(&[
                CuratorReason {
                    code: CuratorReasonCode::Deviation,
                    weight: 56,
                    detail: String::new()
                },
                r(CuratorReasonCode::NoApplication),
            ]),
            CuratorReasonCode::NoApplication
        );
        assert_eq!(dominant_reason(&[]), CuratorReasonCode::None);
    }

    /// A sentence this app does not know is REPORTED, never dropped. That is
    /// the fail-loud half of the matcher: a silently missing clause would
    /// change a plan with nothing to notice it.
    #[test]
    fn an_unrecognised_clause_is_reported_rather_than_dropped() {
        assert_eq!(recognise("3 subjects wearing hats"), None);

        let mut scan = real_scan();
        scan.subjects.truncate(1);
        scan.subjects[0].reasons = vec!["3 subjects wearing hats".into()];
        scan.subjects[0].points = 99;
        let p = project(
            &reading(scan),
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert_eq!(p.unmatched.len(), 1);
        assert_eq!(p.unmatched[0].sentence, "3 subjects wearing hats");
        // And the arithmetic disagrees too, which is the second alarm.
        assert_eq!(p.arithmetic_disagreements.len(), 1);
        // The item still exists, routed to `none` - a finding, not a guess.
        assert_eq!(p.items.len(), 1);
        assert_eq!(p.items[0].engine, CuratorEngine::None);
        assert_eq!(p.items[0].dominant_reason, CuratorReasonCode::None);
        assert!(p.items[0].reasons.is_empty());
    }

    // -----------------------------------------------------------------------
    // An unknown is never a zero
    // -----------------------------------------------------------------------

    /// The three unknowns, over the REAL scan: demand when no consumer reports
    /// it, `last_swept` when nothing swept, and `has_applied_row` when the
    /// ledger could not be read. None of them may become a zero or a false.
    #[test]
    fn an_unknown_never_becomes_a_zero() {
        let (r, p) = project_real();

        // Measured on the real scan: 384 of 471 subjects have demandKnown, and
        // 99 carry a figure. Every planned item without the flag must carry no
        // demand at all - not a zeroed block.
        let unknown_demand = p.items.iter().filter(|i| i.demand.is_none()).count();
        assert!(unknown_demand > 0, "the real corpus has unknown demand");
        for item in &p.items {
            let subject = r
                .scan
                .subjects
                .iter()
                .find(|s| s.id == item.subject_id)
                .unwrap();
            if !subject.demand_known {
                assert!(
                    item.demand.is_none(),
                    "{} claims measured demand it does not have",
                    item.subject_id
                );
            }
        }

        // `last_swept` travels as-is: NULL where the scan said null, which is
        // also what it scores as `never_swept`.
        let never_swept = p.items.iter().filter(|i| i.last_swept.is_none()).count();
        assert!(never_swept > 0);

        // The ledger was readable in this reading, so every item answers
        // true/false - and the two subjects it names answer true.
        assert!(p.items.iter().all(|i| i.has_applied_row.is_some()));
        let applied: Vec<&str> = p
            .items
            .iter()
            .filter(|i| i.has_applied_row == Some(true))
            .map(|i| i.subject_id.as_str())
            .collect();
        assert!(
            applied.contains(&"software-engineering/agent-memory"),
            "{applied:?}"
        );

        // And with an UNREADABLE ledger every item answers NULL rather than
        // "never applied".
        let mut blind = reading(real_scan());
        blind.applied_subjects = None;
        let p = project(
            &blind,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert!(
            p.items.iter().all(|i| i.has_applied_row.is_none()),
            "an unreadable ledger must not read as `never applied`"
        );
        assert_eq!(p.run.corpus.applied_subjects, None);
    }

    /// A subject whose bundle reports no demand at all must not be rendered as
    /// "nobody needs this". The corpus-level flag says the same thing one level
    /// up and travels with the run.
    #[test]
    fn unknown_demand_is_carried_at_the_corpus_level_too() {
        let (_, p) = project_real();
        assert!(p.run.corpus.demand_known_for_any_bundle);

        let mut scan = real_scan();
        scan.demand_known_for_any_bundle = false;
        let p = project(
            &reading(scan),
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert!(!p.run.corpus.demand_known_for_any_bundle);
    }

    /// The scan's `demand_known` flag and its `demand` block must never be
    /// able to disagree in the store: taking the conjunction is what makes the
    /// `demand_known` column and the `demand_json` column one fact.
    #[test]
    fn a_contradicting_scan_resolves_to_unknown() {
        let mut scan = real_scan();
        scan.subjects.truncate(1);
        scan.subjects[0].reasons = vec!["never swept by the librarian".into()];
        scan.subjects[0].points = 3;
        scan.subjects[0].demand_known = false;
        scan.subjects[0].demand = Some(super::super::instrument::ScanDemand {
            consults: 9,
            deviations: 9,
            deviations_summed: 9,
            gone: 0,
            gone_summed: 0,
            contributors: 1,
        });
        let p = project(
            &reading(scan),
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert_eq!(p.items[0].demand, None);
    }

    // -----------------------------------------------------------------------
    // Saturation is hers
    // -----------------------------------------------------------------------

    /// The registry's `dry_streak` reaches `registry_dry_streak` unchanged and
    /// is never consulted. Measured: it is 0 for all 471 subjects, which is
    /// exactly why suppression cannot be read off it.
    #[test]
    fn the_registrys_dry_streak_is_carried_and_never_consulted() {
        let (r, p) = project_real();
        assert!(
            r.scan.subjects.iter().all(|s| s.dry_streak == 0),
            "the registry's field is 0 everywhere - the measurement this design rests on"
        );
        assert!(p.items.iter().all(|i| i.registry_dry_streak == 0));
        // With no history of her own, nothing is suppressed - even though the
        // registry's field is present and readable on every subject.
        assert!(p.items.iter().all(|i| !i.suppressed_by_saturation));

        // And HER streaks decide it, entirely independently of that field.
        let streaks = HashMap::from([
            ("software-engineering/agent-memory".to_string(), 2u32),
            ("software-engineering/table".to_string(), 1u32),
        ]);
        let r = reading(real_scan());
        let p = project(
            &r,
            &CuratorPolicy::default(),
            &streaks,
            "2026-09-23T11:00:00Z",
        );
        let suppressed: Vec<&str> = p
            .items
            .iter()
            .filter(|i| i.suppressed_by_saturation)
            .map(|i| i.subject_id.as_str())
            .collect();
        assert_eq!(suppressed, vec!["software-engineering/agent-memory"]);
    }

    // -----------------------------------------------------------------------
    // The run
    // -----------------------------------------------------------------------

    /// The run carries the corpus, the consumers and the policy AS THEY WERE,
    /// so the plan a decision cites can be re-read exactly as it was shown.
    #[test]
    fn the_run_carries_what_the_instrument_read() {
        let (_, p) = project_real();
        assert_eq!(p.run.scan_generated_at, "2026-09-22T22:39:52.343Z");
        assert_eq!(p.run.registry_head_sha.as_deref(), Some("abc1234"));
        assert_eq!(p.run.created_at, "2026-09-23T11:00:00Z");

        assert_eq!(p.run.corpus.subjects, 471);
        assert_eq!(p.run.corpus.techniques, 3274);
        assert_eq!(p.run.corpus.applications, 1825);
        assert_eq!(p.run.corpus.domains, 10);
        assert_eq!(p.run.corpus.applied_subjects, Some(2));
        assert_eq!(p.run.corpus.expired_applications, 0);
        assert_eq!(p.run.corpus.at_risk_applications, 4);
        assert_eq!(p.run.corpus.drift_unknown, 505);
        assert_eq!(p.run.corpus.drift, 3);

        assert_eq!(p.run.consumers.totals.pairs, 8847);
        assert_eq!(p.run.consumers.totals.evaluated, 319);
        assert_eq!(p.run.consumers.totals.stale_verdicts, 216);
        assert_eq!(p.run.consumers.projects.len(), 1);
        assert_eq!(p.run.consumers.projects[0].stale_verdicts, 147);
        assert_eq!(p.run.policy, CuratorPolicy::default());
    }

    /// A stale map is a FINDING the plan carries, never a failed read.
    #[test]
    fn a_stale_map_is_carried_as_a_finding() {
        let mut r = reading(real_scan());
        assert!(!r.map.maps_stale);
        let p = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert!(!p.run.consumers.maps_stale);

        r.map.maps_stale = true;
        let p = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert!(p.run.consumers.maps_stale);
        // ...and it is still a full plan, not a refusal.
        assert_eq!(p.items.len(), 301);
    }

    /// The projection reads no clock and no disk: the same inputs give the
    /// same rows, which is what makes it testable against the real scan.
    #[test]
    fn the_projection_is_pure() {
        let r = reading(real_scan());
        let a = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        let b = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert_eq!(a.items.len(), b.items.len());
        for (x, y) in a.items.iter().zip(b.items.iter()) {
            assert_eq!(x.subject_id, y.subject_id);
            assert_eq!(x.engine, y.engine);
            assert_eq!(x.points, y.points);
            assert_eq!(x.dominant_reason, y.dominant_reason);
        }
    }

    /// What the real corpus actually asks for, recorded so the next reader does
    /// not have to re-derive it - and so a change in the corpus's shape shows
    /// up as a diff here rather than as a surprise in the UI.
    #[test]
    fn the_real_corpus_routes_where_the_measurement_says() {
        let (_, p) = project_real();
        let mut by_engine: HashMap<&str, usize> = HashMap::new();
        for item in &p.items {
            *by_engine.entry(item.engine.as_str()).or_default() += 1;
        }
        // MEASURED against the 2026-09-22 corpus, not derived: the dominant
        // clause decides, so a subject with both `never swept` (3) and
        // `single stack` (2) counts once, under `deepen`.
        let total: usize = by_engine.values().sum();
        assert_eq!(total, 301);
        assert_eq!(by_engine.get("deepen").copied().unwrap_or(0), 105);
        assert_eq!(by_engine.get("apply").copied().unwrap_or(0), 105);
        assert_eq!(by_engine.get("conform").copied().unwrap_or(0), 89);
        assert_eq!(by_engine.get("reconcile").copied().unwrap_or(0), 2);
        // `intake` and `forge` have nothing to answer in this corpus: no
        // citation is reported gone, and a scan of existing subjects cannot
        // report one that should exist but does not. Their zeroes are the
        // measurement, not a gap in the routing.
        assert_eq!(by_engine.get("intake").copied().unwrap_or(0), 0);
        assert_eq!(by_engine.get("forge").copied().unwrap_or(0), 0);
        assert_eq!(by_engine.get("none").copied().unwrap_or(0), 0);
    }
}
