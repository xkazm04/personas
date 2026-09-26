//! **What stops her, counted.**
//!
//! Her plan is ranked work; [`super::dispatch::plan_invocation`] decides which
//! of it she can turn into a command. Until 2026-09-26 the *reason* an engine
//! could not be turned into one lived in a doc-comment table in that module,
//! which meant it was true, carefully reasoned, and unreachable by anything but
//! a human reading the source.
//!
//! What that cost, measured the same day: her loop held a 314-item standing plan
//! of which **312 were undispatchable** - `apply` 110, `deepen` 103, `conform`
//! 99 - dispatched its last item at 20:46 and then nothing, with every brake
//! unset and the lane switched on. From outside, a companion working perfectly
//! through an empty queue and a companion holding 312 items she has no grammar
//! for look identical. This module is the difference.
//!
//! It answers one question per blocked engine, and the answer carries the only
//! distinction that matters for her authority:
//!
//! > **Is the missing thing in the registry, or in this app?**
//!
//! A skill that documents no invocation is a gap in a method file the registry
//! owns, bounded to one section of one file, and she may close it. A plan item
//! that cannot name a technique is a gap in *this app's* projection - the fix is
//! a Rust change to Personas, and she may not write that. The first is a
//! dispatchable impediment; the second is a report for the operator. Nothing
//! here decides to run anything: it measures, ranks, and says which of the two
//! it is.

use personas_core::models::{
    CuratorEngine, CuratorImpediment, CuratorImpedimentKind, CuratorPlanItem, CuratorPlanItemState,
    CuratorSkill,
};

/// Every engine her projection can produce, and the registry skill that would
/// answer it - **whether or not she can spell the command today**.
///
/// Deliberately separate from [`super::dispatch::PLAN_ROUTES`], which is the
/// far smaller set she can actually dispatch. A route table that only knew about
/// the dispatchable engines could not name what is missing for the others, which
/// is exactly the blindness this module was written to remove.
///
/// `Apply` answers to `intake`, not to a skill of its own: the documented form
/// is `/intake apply <technique> [--project <slug>]`, and `intake`'s own file
/// owns the Phase 7.5 method it runs.
const ENGINE_SKILL: [(CuratorEngine, &str); 6] = [
    (CuratorEngine::Reconcile, "reconcile"),
    (CuratorEngine::Deepen, "deepen"),
    (CuratorEngine::Intake, "intake"),
    (CuratorEngine::Apply, "intake"),
    (CuratorEngine::Conform, "conform"),
    (CuratorEngine::Forge, "forge"),
];

/// Why an engine whose skill IS documented still cannot be derived from a plan
/// item - the app-side half, quoted from the table that has always held it.
///
/// `None` for an engine that is derivable, and for [`CuratorEngine::None`],
/// which is not an impediment at all: an unrecognised clause is a finding about
/// the projection's matcher and belongs in its own report, not in a queue of
/// things to go and fix in the registry.
fn item_lacks(engine: CuratorEngine) -> Option<&'static str> {
    match engine {
        CuratorEngine::Intake => Some(
            "the finding is a citation that DIED; `/intake <url>` needs a replacement source, \
             and the plan item does not carry one",
        ),
        CuratorEngine::Apply => Some(
            "`/intake apply <technique>` needs a technique's NAME; the plan item carries a \
             technique COUNT",
        ),
        CuratorEngine::Conform => Some(
            "`/conform` judges a CONSUMER repo against the standard; the plan item names no \
             project, and running it in the registry checkout would have the corpus grade itself",
        ),
        CuratorEngine::Forge => Some(
            "`/forge` creates a subject that does not exist yet; a plan item is always about one \
             that does",
        ),
        CuratorEngine::Reconcile | CuratorEngine::Deepen | CuratorEngine::None => None,
    }
}

/// **The impediments in front of her right now, worst first.**
///
/// `items` is her standing plan; `skills` is the registry's own lane as
/// [`super::instrument`] read it. Only `Planned` items count: a `dispatched` item
/// is in flight and a `blocked` one has a terminal verdict of its own, and
/// counting either would make a fix look more valuable than it is.
///
/// Ranked by how many items closing it would actually FREE - not by how many it
/// holds, which are different numbers whenever two things are missing at once -
/// then by what it holds, then by kind so the one she may act on sorts ahead of
/// a report at equal weight, then by id for a stable answer on two machines.
pub(super) fn measure(
    items: &[CuratorPlanItem],
    skills: &[CuratorSkill],
) -> Vec<CuratorImpediment> {
    // A `Vec` rather than a map: `CuratorEngine` is a closed set of seven and
    // deliberately carries no ordering, so a linear tally is both cheaper than a
    // tree and free of an `Ord` this type has no meaning for.
    let mut blocked: Vec<(CuratorEngine, u32)> = Vec::new();
    for item in items {
        if item.state != CuratorPlanItemState::Planned {
            continue;
        }
        // **Both** questions the dispatch asks, in the same order and through the
        // same functions, so this module can never disagree with the lane that
        // actually dispatches: can this app derive a command line for the item,
        // AND would her own lane be allowed to run it?
        //
        // Asking only the first was wrong, and the test below is what found it:
        // `plan_invocation` reads the ENGINE and never the registry, so a
        // `Deepen` item looked dispatchable even with `deepen/SKILL.md`
        // documenting nothing - which is the exact state the registry was in
        // until 2026-09-26. The consequence is the one that matters: if a skill
        // ever LOSES its invocation block, this now reports it as a self-fixable
        // impediment holding every item of that engine, which is the self-healing
        // property the method lane is for.
        if super::dispatch::plan_invocation(item).is_some_and(|(skill, argument)| {
            super::dispatch::vet_autonomous(skills, skill, Some(&argument)).is_ok()
        }) {
            continue;
        }
        match blocked.iter_mut().find(|(e, _)| *e == item.engine) {
            Some((_, n)) => *n += 1,
            None => blocked.push((item.engine, 1)),
        }
    }

    let mut out: Vec<CuratorImpediment> = blocked
        .into_iter()
        .filter_map(|(engine, blocks)| one(engine, blocks, skills))
        .collect();
    out.sort_by(|a, b| {
        b.frees
            .cmp(&a.frees)
            .then_with(|| b.blocks.cmp(&a.blocks))
            .then_with(|| b.self_fixable.cmp(&a.self_fixable))
            .then_with(|| a.id.cmp(&b.id))
    });
    out
}

fn one(engine: CuratorEngine, blocks: u32, skills: &[CuratorSkill]) -> Option<CuratorImpediment> {
    // `None` is not an impediment: nothing was recognised, which is a fact about
    // the projection's matcher and has no file in the registry to go and fix.
    let skill_name = ENGINE_SKILL
        .into_iter()
        .find(|(e, _)| *e == engine)
        .map(|(_, s)| s)?;

    let found = skills.iter().find(|s| s.name == skill_name);
    let (kind, file, summary) = match found {
        None => (
            CuratorImpedimentKind::SkillMissing,
            None,
            format!(
                "the registry has no skill called '{skill_name}', so nothing answers this engine \
                 at all"
            ),
        ),
        // `None` is UNKNOWN, not "runs bare". A file that documents no
        // invocation gives this app no basis for a command line, and inventing
        // one is the failure the whole feature is built around.
        Some(skill) if skill.runs_bare.is_none() => (
            CuratorImpedimentKind::UndocumentedInvocation,
            Some(skill.path.clone()),
            format!(
                "'{skill_name}' documents no invocation: its SKILL.md has no `## Invocation` \
                 block, so `runs_bare` is unknown and she has no command to write. Adding the \
                 block the file's own prose already implies is the whole fix."
            ),
        ),
        Some(skill) => {
            let why = item_lacks(engine)?;
            (
                CuratorImpedimentKind::ItemLacksArgument,
                Some(skill.path.clone()),
                format!("'{skill_name}' documents an invocation, but {why}"),
            )
        }
    };

    let self_fixable = kind.self_fixable();
    // What closing it would RELEASE, which is `blocks` only when the engine can
    // already carry its own argument - so the skill's side is the last thing
    // missing. When `item_lacks` has something to say about this engine, a
    // documented skill still leaves the item unable to fill it, and the honest
    // answer is zero.
    let frees = if item_lacks(engine).is_none() {
        blocks
    } else {
        0
    };
    Some(CuratorImpediment {
        id: format!("{}:{skill_name}", kind.as_str()),
        kind,
        engine,
        skill: skill_name.to_string(),
        blocks,
        frees,
        file,
        summary,
        self_fixable,
        refusal: (!self_fixable).then(|| match kind {
            CuratorImpedimentKind::SkillMissing => {
                "writing a skill the registry does not have is authoring, not documenting - hers \
                 to report, the operator's to commission"
                    .to_string()
            }
            CuratorImpedimentKind::ItemLacksArgument => {
                "the missing field is in this app's own projection, so the fix is a change to \
                 Personas rather than to the registry - and she may not rewrite the app that runs \
                 her"
                .to_string()
            }
            CuratorImpedimentKind::UndocumentedInvocation => unreachable!(
                "an undocumented invocation is self-fixable, so this arm cannot be reached"
            ),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::models::{CuratorReasonCode, CuratorSkillLane};

    fn skill(name: &str, runs_bare: Option<bool>) -> CuratorSkill {
        CuratorSkill {
            name: name.to_string(),
            lane: CuratorSkillLane::Native,
            path: format!(".claude/skills/{name}/SKILL.md"),
            title: Some(name.to_string()),
            description: None,
            version: Some("1.0.0".into()),
            invocation_documented: runs_bare.is_some(),
            runs_bare,
            argument_hint: None,
            lessons_path: None,
            lessons_bytes: None,
            lessons_modified_at: None,
            lessons_latest_entry: None,
            lessons_latest_at: None,
        }
    }

    fn item(engine: CuratorEngine, state: CuratorPlanItemState) -> CuratorPlanItem {
        CuratorPlanItem {
            id: format!("i-{}", engine.as_str()),
            plan_run_id: "r1".into(),
            subject_id: "software-engineering/a-subject".into(),
            domain: "software-engineering".into(),
            at: "cat/sub".into(),
            points: 7,
            reasons: Vec::new(),
            dominant_reason: CuratorReasonCode::ExpiredApplication,
            engine,
            techniques: 4,
            applications: 2,
            stacks: Vec::new(),
            demand_known: false,
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: false,
            has_applied_row: None,
            state,
            declined_reason: None,
            dispatched_run_id: None,
            evidence_ref: None,
            updated_at: "2026-09-26T00:00:00Z".into(),
        }
    }

    fn planned(engine: CuratorEngine, n: usize) -> Vec<CuratorPlanItem> {
        (0..n)
            .map(|k| {
                let mut i = item(engine, CuratorPlanItemState::Planned);
                i.id = format!("{}-{k}", i.id);
                i
            })
            .collect()
    }

    /// The registry as it stood on 2026-09-24: `forge` documents nothing.
    fn lane() -> Vec<CuratorSkill> {
        vec![
            skill("reconcile", Some(false)),
            skill("deepen", Some(false)),
            skill("intake", Some(false)),
            skill("conform", Some(false)),
            skill("forge", None),
        ]
    }

    /// **A derivable engine is never an impediment.** `deepen` gained its
    /// invocation on 2026-09-26; 103 items of it must now produce nothing here.
    #[test]
    fn an_engine_she_can_dispatch_is_not_an_impediment() {
        let found = measure(&planned(CuratorEngine::Deepen, 103), &lane());
        assert!(
            found.is_empty(),
            "deepen is derivable, so it blocks nothing: {found:?}"
        );
        assert!(measure(&planned(CuratorEngine::Reconcile, 2), &lane()).is_empty());
    }

    /// The rank is the count of items freed, and the one she may ACT on wins a
    /// tie - because a tie between a fix and a report is not really a tie.
    #[test]
    fn the_worst_impediment_is_the_one_that_frees_the_most() {
        let mut items = planned(CuratorEngine::Apply, 110);
        items.extend(planned(CuratorEngine::Conform, 99));
        items.extend(planned(CuratorEngine::Forge, 110));

        let found = measure(&items, &lane());
        assert_eq!(found.len(), 3);
        // Forge and Apply both block 110; forge's is the one she can close.
        assert_eq!(found[0].skill, "forge");
        assert!(found[0].self_fixable);
        assert_eq!(found[0].blocks, 110);
        assert_eq!(found[1].engine, CuratorEngine::Apply);
        assert_eq!(found[1].blocks, 110);
        assert!(!found[1].self_fixable);
        assert_eq!(found[2].blocks, 99);
    }

    /// **Exactly one kind is hers**, and the other two carry a refusal that says
    /// why in words rather than leaving a caller to infer it from a bool.
    #[test]
    fn only_an_undocumented_invocation_is_hers_to_fix() {
        let mut items = planned(CuratorEngine::Forge, 1);
        items.extend(planned(CuratorEngine::Apply, 1));
        items.extend(planned(CuratorEngine::Intake, 1));

        let found = measure(&items, &lane());
        for imp in &found {
            assert_eq!(
                imp.self_fixable,
                imp.kind == CuratorImpedimentKind::UndocumentedInvocation,
                "{imp:?}"
            );
            assert_eq!(
                imp.refusal.is_none(),
                imp.self_fixable,
                "a refusal is present exactly when the fix is not hers: {imp:?}"
            );
        }
        assert_eq!(
            found
                .iter()
                .filter(|i| i.kind == CuratorImpedimentKind::UndocumentedInvocation)
                .count(),
            1
        );
    }

    /// An engine whose skill is not in the lane at all is `SkillMissing` - not
    /// an undocumented invocation, because there is no file to add a heading to.
    #[test]
    fn a_missing_skill_is_its_own_kind_and_names_no_file() {
        let found = measure(&planned(CuratorEngine::Forge, 4), &[]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, CuratorImpedimentKind::SkillMissing);
        assert_eq!(found[0].file, None, "there is no file to point at");
        assert!(!found[0].self_fixable);
    }

    /// **Only `Planned` items count.** An item in flight, or one with a
    /// terminal verdict, would inflate the rank of a fix that frees neither.
    #[test]
    fn an_item_in_flight_or_settled_does_not_rank_a_fix() {
        let mut items = planned(CuratorEngine::Forge, 1);
        for state in [
            CuratorPlanItemState::Dispatched,
            CuratorPlanItemState::Blocked,
            CuratorPlanItemState::Landed,
        ] {
            items.push(item(CuratorEngine::Forge, state));
        }
        let found = measure(&items, &lane());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].blocks, 1, "three of the four were not planned");
    }

    /// `None` means the projection's matcher recognised nothing. That is a
    /// finding about the matcher and has no registry file to go and fix, so it
    /// must not appear as work.
    #[test]
    fn an_unrecognised_engine_is_not_an_impediment_to_dispatch() {
        assert!(measure(&planned(CuratorEngine::None, 40), &lane()).is_empty());
    }

    /// The id is stable, so a tick that already dispatched a fix can recognise
    /// it on the next pass instead of dispatching a second one.
    #[test]
    fn the_id_is_stable_across_measurements() {
        let a = measure(&planned(CuratorEngine::Forge, 3), &lane());
        let b = measure(&planned(CuratorEngine::Forge, 9), &lane());
        assert_eq!(a[0].id, b[0].id);
        assert_eq!(a[0].id, "undocumented_invocation:forge");
        assert_ne!(
            a[0].blocks, b[0].blocks,
            "the rank moves, the identity does not"
        );
    }

    /// **`blocks` is what it holds; `frees` is what closing it would release, and
    /// the live plan is what forced them apart.**
    ///
    /// Measured 2026-09-26: `conform` documents its invocation only inside a
    /// prose sentence in its `description:` frontmatter, so it reads as
    /// undocumented and holds 99 items - and documenting it properly frees NONE
    /// of them, because a `conform` item also cannot carry the project the
    /// invocation needs. Ranking on `blocks` would have sent her at the biggest
    /// number on the board to unblock nothing.
    #[test]
    fn a_fix_whose_items_are_also_waiting_on_something_else_frees_nothing() {
        // `conform` in the lane, with no documented invocation - the real shape.
        let lane = vec![
            skill("reconcile", Some(false)),
            skill("deepen", Some(false)),
            skill("intake", Some(false)),
            skill("conform", None),
            skill("forge", None),
        ];
        let mut items = planned(CuratorEngine::Conform, 99);
        items.extend(planned(CuratorEngine::Forge, 4));

        let found = measure(&items, &lane);
        let conform = found
            .iter()
            .find(|i| i.skill == "conform")
            .expect("conform documents nothing and holds items");
        assert_eq!(conform.kind, CuratorImpedimentKind::UndocumentedInvocation);
        assert!(conform.self_fixable, "the file is still hers to document");
        assert_eq!(conform.blocks, 99, "it holds all 99");
        assert_eq!(
            conform.frees, 0,
            "and releases none: a conform item cannot carry a project either"
        );

        // `forge` frees nothing either - its items cannot carry what a forge
        // invocation would need - so with both at zero the rank falls through
        // to what they HOLD, and conform's 99 leads.
        let forge = found
            .iter()
            .find(|i| i.skill == "forge")
            .expect("forge documents nothing and holds items");
        assert_eq!(forge.frees, 0);
        assert_eq!(found[0].skill, "conform", "both free nothing, so 99 > 4");
    }

    /// **A tie on `frees` falls through to `blocks`, and a non-zero `frees`
    /// beats any amount of `blocks`.** This is the ordering that decides which
    /// file a worker is sent at, so it is asserted rather than described.
    #[test]
    fn the_rank_is_frees_first_and_only_then_what_it_holds() {
        // `deepen` undocumented is the one shape that frees what it holds: the
        // engine already carries its own address. One item of it outranks
        // conform's 99.
        let lane = vec![
            skill("reconcile", Some(false)),
            skill("deepen", None),
            skill("intake", Some(false)),
            skill("conform", None),
        ];
        let mut items = planned(CuratorEngine::Conform, 99);
        items.extend(planned(CuratorEngine::Deepen, 1));

        let found = measure(&items, &lane);
        assert_eq!(found[0].skill, "deepen");
        assert_eq!(found[0].frees, 1, "the engine carries its own address");
        assert_eq!(found[1].skill, "conform");
        assert_eq!(found[1].frees, 0);
        assert!(
            found[1].blocks > found[0].blocks,
            "and it wins despite holding 99 times less"
        );
    }

    /// An `ItemLacksArgument` impediment frees nothing by construction - the
    /// missing half is in this app, and closing the registry's side changes
    /// nothing at all.
    #[test]
    fn an_item_side_gap_frees_nothing_by_construction() {
        let found = measure(&planned(CuratorEngine::Apply, 110), &lane());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].kind, CuratorImpedimentKind::ItemLacksArgument);
        assert_eq!(found[0].blocks, 110);
        assert_eq!(found[0].frees, 0);
    }
}
