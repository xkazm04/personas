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
//!
//! ## And what is NOT planned, counted rather than dropped
//!
//! The 170 are not noise. `software-engineering/table` scores 0 and holds 16
//! stale verdicts across 6 projects - the largest consumer gap in the estate,
//! sitting in the tail an item-shaped read calls empty. [`bundles_of`] counts
//! them per bundle into `PlanRunInput::quiet`, so a surface can say "wanting
//! nothing is a fact about the subject" rather than leaving them out and
//! calling the remainder the corpus.
//!
//! **This changes no ranking.** A quiet subject is still not an item, still
//! scores no points, and still routes to no engine. `quiet` is a count beside
//! the plan, never a row inside it, and `sum(quiet) + items == subjects` is the
//! invariant that says the two halves together are the whole corpus.

use std::collections::HashMap;

use personas_core::models::{
    CuratorConsumerProject, CuratorConsumerTotals, CuratorConsumers, CuratorCorpus, CuratorDemand,
    CuratorPolicy, CuratorQuietBundle, CuratorReason, CuratorReasonCode,
};
use personas_db::repos::curator::{self as repo, PlanItemInput, PlanRunInput};

use super::instrument::{InstrumentReading, LibrarianScan, ScanSubject};

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
/// the `e49` migration header).
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

    let bundles = bundles_of(&reading.scan);

    Projection {
        run: PlanRunInput {
            created_at: now.to_string(),
            scan_generated_at: reading.scan.generated_at.clone(),
            registry_head_sha: reading.head_sha.clone(),
            corpus: corpus_of(reading, &bundles),
            consumers: consumers_of(reading),
            policy: policy.clone(),
            quiet: bundles,
        },
        items,
        unmatched,
        arithmetic_disagreements,
    }
}

/// Every bundle the scan describes, with the tail of its subjects the
/// projection does not plan.
///
/// **Derived from the SCAN, never from the items.** A bundle whose subjects all
/// score zero produces no plan item at all, and a roster built from items would
/// therefore drop exactly the bundle a reader most needs to be told about.
///
/// The roster and each bundle's `demandKnown` come from the scan's own
/// `domains[]`, which answers both questions per bundle. A subject whose domain
/// the scan did not declare - which the 2026-09-22 corpus has none of - still
/// lands in the tally, so `sum(quiet) + items` can never lose a subject; its
/// bundle's `demandKnown` is then the OR of its own subjects', because there is
/// no bundle row to ask.
///
/// A bundle with an empty tail is KEPT, at `subjects: 0`. That zero is measured
/// against a declared bundle ("everything here has a finding") and is the
/// mirror of the fact this whole tally exists for - unlike the `[]` a
/// pre-`e50` run carries, which was never measured at all.
fn bundles_of(scan: &LibrarianScan) -> Vec<CuratorQuietBundle> {
    let mut bundles: Vec<CuratorQuietBundle> = scan
        .domains
        .iter()
        .filter(|d| !d.domain.trim().is_empty())
        .map(|d| CuratorQuietBundle {
            domain: d.domain.clone(),
            subjects: 0,
            demand_known: d.demand_known,
        })
        .collect();

    // Everything past this index was NOT declared by `domains[]`, which is the
    // only case where a subject's own flag may move its bundle's answer.
    let declared = bundles.len();
    for subject in &scan.subjects {
        let quiet = u32::from(subject.reasons.is_empty());
        match bundles.iter().position(|b| b.domain == subject.domain) {
            Some(idx) => {
                bundles[idx].subjects += quiet;
                if idx >= declared {
                    bundles[idx].demand_known |= subject.demand_known;
                }
            }
            // Undeclared: carried anyway, so the arithmetic cannot lose a
            // subject, with the only demand answer that exists for it.
            None => bundles.push(CuratorQuietBundle {
                domain: subject.domain.clone(),
                subjects: quiet,
                demand_known: subject.demand_known,
            }),
        }
    }
    bundles
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

/// The corpus summary. `bundles` is [`bundles_of`]'s output, passed in rather
/// than recomputed so the roster behind `demandKnownDomains` and the roster
/// behind the plan's `quiet` are one derivation and cannot disagree.
fn corpus_of(reading: &InstrumentReading, bundles: &[CuratorQuietBundle]) -> CuratorCorpus {
    let scan = &reading.scan;
    CuratorCorpus {
        generated_at: scan.generated_at.clone(),
        today: scan.today.clone(),
        subjects: scan.subjects.len() as u32,
        techniques: scan.domains.iter().map(|d| d.techniques).sum(),
        applications: scan.domains.iter().map(|d| d.applications).sum(),
        domains: scan.domains.len() as u32,
        demand_known_for_any_bundle: scan.demand_known_for_any_bundle,
        // WHICH bundles, where the boolean above can only say whether any. A
        // zero on a demand-fed channel means "nothing found" in these and
        // "nobody looked" in the rest, and one flag cannot carry both.
        demand_known_domains: bundles
            .iter()
            .filter(|b| b.demand_known)
            .map(|b| b.domain.clone())
            .collect(),
        applied_subjects: reading
            .applied_subjects
            .as_ref()
            .map(|set| set.len() as u32),
        expired_applications: reading.currency.totals.expired,
        at_risk_applications: reading.currency.totals.at_risk,
        drift_unknown: reading.currency.totals.drift_unknown,
        drift: reading.currency.drift.len() as u32,
        // Taken from the same instrument read that filled `expired_applications`
        // two lines up, because the two are only readable together: an
        // application with no clock cannot expire, so `expired: 0` beside
        // `no_clock: 301` is not the reassurance the zero looks like.
        no_clock_applications: reading.currency.totals.no_clock,
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
                r#"{"totals":{"applications":1825,"expired":0,"atRisk":4,"noClock":301,
                              "driftUnknown":505},
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

    // -----------------------------------------------------------------------
    // The three absences a zero would have hidden
    // -----------------------------------------------------------------------

    /// `expiredApplications: 0` is only readable beside the count that cannot
    /// expire at all. 301 of the 1,825 applications carry no clock, so the zero
    /// says "none of the 1,524 that could expire have" - not "nothing has".
    #[test]
    fn an_application_with_no_clock_is_counted_rather_than_read_as_unexpired() {
        let (_, p) = project_real();
        assert_eq!(p.run.corpus.expired_applications, 0);
        assert_eq!(
            p.run.corpus.no_clock_applications, 301,
            "the count that makes the zero above readable"
        );

        // It comes from the SAME instrument read, so it cannot drift from the
        // zero it qualifies: move one and the other moves with it.
        let mut r = reading(real_scan());
        r.currency.totals.expired = 7;
        r.currency.totals.no_clock = 0;
        let p = project(
            &r,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        assert_eq!(p.run.corpus.expired_applications, 7);
        assert_eq!(p.run.corpus.no_clock_applications, 0);
    }

    /// WHICH bundles were asked, not merely whether any were. Five of the ten
    /// today; in the other five a zero on a demand-fed channel means "nobody
    /// looked". The boolean beside it stays, because it has a live consumer.
    #[test]
    fn the_demand_known_bundles_are_named_and_not_merely_counted() {
        let (_, p) = project_real();
        assert!(p.run.corpus.demand_known_for_any_bundle);
        assert_eq!(
            p.run.corpus.demand_known_domains,
            vec![
                "game-production",
                "llm-observability",
                "media-generation",
                "recruiting",
                "software-engineering",
            ],
            "five of the ten bundles, in the scan's own order"
        );
        assert_eq!(
            p.run.corpus.demand_known_domains.len() + 5,
            p.run.quiet.len(),
            "and the other five are the ones a single boolean could not name"
        );
    }

    /// **The list is derived from the SCAN, not from the items.** A bundle
    /// whose subjects all score zero has no plan item at all, so a roster built
    /// from items would drop exactly the bundle a reader most needs told about.
    #[test]
    fn a_bundle_with_no_scoring_subject_still_answers_the_demand_question() {
        let mut scan = real_scan();
        // Silence one whole bundle: every `media-generation` subject scores
        // nothing, so it contributes no item to the plan.
        for subject in scan.subjects.iter_mut() {
            if subject.domain == "media-generation" {
                subject.reasons.clear();
                subject.points = 0;
            }
        }
        let p = project(
            &reading(scan),
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );

        assert!(
            !p.items.iter().any(|i| i.domain == "media-generation"),
            "the bundle is entirely quiet, so it has no item to be derived from"
        );
        let bundle = p
            .run
            .quiet
            .iter()
            .find(|b| b.domain == "media-generation")
            .expect("a bundle with no items still has a row in the quiet tail")
            .clone();
        assert_eq!(bundle.subjects, 21, "all 21 of its subjects");
        assert!(
            bundle.demand_known,
            "its demand WAS read, which no item of its own could have said"
        );
        assert!(p
            .run
            .corpus
            .demand_known_domains
            .contains(&"media-generation".to_string()));
    }

    /// The quiet tail and the items are the two halves of the corpus, and the
    /// arithmetic says so: 170 + 301 = 471 on the real scan. This is also the
    /// invariant that tells a MEASURED empty tail from the `[]` a plan run
    /// projected before `e50` carries (see that migration's header).
    #[test]
    fn the_quiet_tail_and_the_items_account_for_every_subject() {
        let (r, p) = project_real();
        let quiet: u32 = p.run.quiet.iter().map(|b| b.subjects).sum();
        assert_eq!(quiet, 170, "the subjects that score nothing");
        assert_eq!(p.items.len(), 301);
        assert_eq!(
            quiet as usize + p.items.len(),
            r.scan.subjects.len(),
            "170 + 301 = 471: the plan and its tail are the whole corpus"
        );
        assert_eq!(p.run.corpus.subjects, 471);

        // Per bundle, measured against the 2026-09-22 corpus. `table`'s bundle
        // is the biggest tail and the point of the whole column: 65 of
        // `software-engineering`'s 229 subjects ask for nothing, and one of
        // them holds 16 stale verdicts across 6 projects.
        let by_domain = |domain: &str| {
            p.run
                .quiet
                .iter()
                .find(|b| b.domain == domain)
                .unwrap_or_else(|| panic!("no quiet row for {domain}"))
                .subjects
        };
        assert_eq!(by_domain("software-engineering"), 65);
        assert_eq!(by_domain("game-production"), 46);
        assert_eq!(by_domain("localization"), 14);
        assert_eq!(by_domain("marketing"), 13);
        assert_eq!(by_domain("llm-observability"), 12);
        assert_eq!(by_domain("civic-intelligence"), 7);
        assert_eq!(by_domain("grant-funding"), 5);
        assert_eq!(by_domain("recruiting"), 5);
        assert_eq!(by_domain("media-generation"), 3);
        // Every one of `agent-operations`' 8 subjects has a finding. That zero
        // is MEASURED against a declared bundle, so its row is kept rather than
        // dropped - dropping it would make "nothing is quiet here" and "this
        // bundle was never looked at" the same answer again.
        assert_eq!(by_domain("agent-operations"), 0);
        assert_eq!(p.run.quiet.len(), 10, "all ten bundles, none dropped");
    }

    /// `software-engineering/table` is the subject this column exists for: it
    /// scores nothing, so it is in no plan, and it is the largest consumer gap
    /// in the estate. The tail must contain it and the items must not.
    #[test]
    fn the_largest_consumer_gap_is_in_the_tail_and_in_no_plan() {
        let (r, p) = project_real();
        let table = r
            .scan
            .subjects
            .iter()
            .find(|s| s.id == "software-engineering/table")
            .expect("the corpus has a table subject");
        assert_eq!(table.points, 0);
        assert!(table.reasons.is_empty());
        assert!(
            !p.items
                .iter()
                .any(|i| i.subject_id == "software-engineering/table"),
            "it scores nothing, so it is not work and gets no item"
        );
        assert!(
            p.run
                .quiet
                .iter()
                .any(|b| b.domain == "software-engineering" && b.subjects > 0),
            "and it is counted rather than dropped"
        );
    }

    /// A subject whose bundle the scan never declared must still be counted -
    /// otherwise the arithmetic above silently loses it, which is the failure
    /// this tally was built to stop. Its demand answer is then the OR of its
    /// own subjects', because no bundle row exists to ask.
    #[test]
    fn a_subject_from_an_undeclared_bundle_is_never_lost() {
        let mut scan = real_scan();
        let mut stray = scan.subjects[0].clone();
        stray.id = "stowaway/one".into();
        stray.domain = "stowaway".into();
        stray.reasons.clear();
        stray.points = 0;
        stray.demand_known = false;
        let mut loud = stray.clone();
        loud.id = "stowaway/two".into();
        loud.demand_known = true;
        scan.subjects.push(stray);
        scan.subjects.push(loud);

        let subjects = scan.subjects.len();
        let p = project(
            &reading(scan),
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T11:00:00Z",
        );
        let quiet: u32 = p.run.quiet.iter().map(|b| b.subjects).sum();
        assert_eq!(quiet as usize + p.items.len(), subjects);

        let stowaway = p
            .run
            .quiet
            .iter()
            .find(|b| b.domain == "stowaway")
            .expect("an undeclared bundle is carried, not dropped")
            .clone();
        assert_eq!(stowaway.subjects, 2);
        assert!(
            stowaway.demand_known,
            "one of its two subjects reports demand, and there is no bundle row to ask"
        );
    }

    /// The tail carries counts, and nothing else. It must not promote a quiet
    /// subject into the plan, hand it points, or give it an engine.
    #[test]
    fn the_quiet_tail_changes_no_ranking() {
        let (_, with_tail) = project_real();
        assert_eq!(with_tail.items.len(), 301);
        assert!(with_tail.items.iter().all(|i| i.points > 0));
        assert!(with_tail
            .items
            .iter()
            .all(|i| i.engine != CuratorEngine::None));
        // The tail names bundles, never subjects - there is no door through
        // which a quiet subject could reach a dispatch.
        assert!(with_tail.run.quiet.iter().all(|b| !b.domain.contains('/')));
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
        assert_eq!(p.run.corpus.no_clock_applications, 301);

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

#[cfg(test)]
mod live {
    //! One live pass against a real registry checkout, behind `#[ignore]` and
    //! an env var.
    //!
    //! Every other test in this module reads a COMMITTED fixture, which proves
    //! the matcher and the projection and proves nothing at all about the four
    //! child processes, the chokepoint's `env_clear()` allowlist or the JSON
    //! the scripts actually emit today. This repo's own doctrine is blunt about
    //! that gap - "a gate that asserts data is not a gate on behavior" - so the
    //! behavioural check exists, is runnable on demand, and is out of the
    //! default lane because it costs ~11 s and needs a checkout only some
    //! machines have.
    //!
    //! ```text
    //! CURATOR_REGISTRY_ROOT=C:/path/to/ai-registry \
    //!   npm run test:rust -- --ignored live::the_real_registry
    //! ```
    use super::*;
    use std::path::PathBuf;

    use personas_core::models::CuratorEngine;

    #[tokio::test]
    #[ignore = "spawns node against a real registry checkout; set CURATOR_REGISTRY_ROOT"]
    async fn the_real_registry_reads_and_projects() {
        let Ok(root) = std::env::var("CURATOR_REGISTRY_ROOT") else {
            panic!("set CURATOR_REGISTRY_ROOT to a registry checkout");
        };
        let root = PathBuf::from(root);
        let reading = super::super::instrument::read(&root)
            .await
            .expect("the instrument must read a real checkout");

        // The corpus answered at all.
        assert!(!reading.scan.generated_at.is_empty());
        assert!(
            reading.scan.subjects.len() > 100,
            "a real corpus, not an empty parse: {}",
            reading.scan.subjects.len()
        );
        assert!(!reading.map.projects.is_empty(), "the consumers answered");
        assert!(
            reading.applied_subjects.is_some(),
            "the ledger was readable"
        );
        assert!(
            reading.head_sha.is_some(),
            "git answered, so this is cacheable"
        );

        let projected = project(
            &reading,
            &CuratorPolicy::default(),
            &HashMap::new(),
            "2026-09-23T00:00:00Z",
        );

        // The two alarms, against TODAY's corpus rather than the committed one.
        // This is the assertion the fixture cannot make: the registry may have
        // reworded a clause since the fixture was taken.
        assert!(
            projected.unmatched.is_empty(),
            "the live registry wrote a clause this app does not know: {:?}",
            &projected.unmatched[..projected.unmatched.len().min(5)]
        );
        assert!(
            projected.arithmetic_disagreements.is_empty(),
            "live weights did not sum to the live points for: {:?}",
            &projected.arithmetic_disagreements[..projected.arithmetic_disagreements.len().min(5)]
        );
        assert!(!projected.items.is_empty(), "a real corpus has work in it");
        assert!(projected
            .items
            .iter()
            .all(|i| i.engine != CuratorEngine::None));

        // And the second read is the CACHE, not a second 11-second pass.
        let again = super::super::instrument::read(&root).await.unwrap();
        assert_eq!(again.scan.generated_at, reading.scan.generated_at);
    }

    /// The allowlist's read, live: the registry's own resolver, through the
    /// chokepoint, with only the env the chokepoint allows.
    #[tokio::test]
    #[ignore = "spawns node against a real registry checkout; set CURATOR_REGISTRY_ROOT"]
    async fn the_real_fleet_resolves() {
        let Ok(root) = std::env::var("CURATOR_REGISTRY_ROOT") else {
            panic!("set CURATOR_REGISTRY_ROOT to a registry checkout");
        };
        let (fleet, problems) = super::super::instrument::read_fleet_only(&PathBuf::from(root))
            .await
            .expect("loadFleet must answer");
        assert!(!fleet.is_empty(), "a real machine declares checkouts");
        assert!(
            fleet.iter().any(|p| p.exists),
            "at least one checkout is on this disk"
        );
        // Ordered by slug, so two machines list the same fleet the same way.
        let mut sorted = fleet.clone();
        sorted.sort_by(|a, b| a.slug.cmp(&b.slug));
        assert_eq!(
            fleet.iter().map(|p| &p.slug).collect::<Vec<_>>(),
            sorted.iter().map(|p| &p.slug).collect::<Vec<_>>()
        );
        // Problems are carried, never thrown.
        let _ = problems;
    }
}
