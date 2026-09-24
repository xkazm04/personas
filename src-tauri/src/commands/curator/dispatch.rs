//! What she tells a worker, and what authorises it.
//!
//! Every function here is PURE and every one of them is tested against the
//! registry's own files rather than against an idea of them. The module exists
//! because the three decisions it holds are the ones that are dangerous to get
//! wrong and cheap to get right in isolation:
//!
//! 1. **Which invocation may she use at all.** A skill whose `SKILL.md`
//!    documents no invocation has `runs_bare: None`, and `None` is unknown, not
//!    "runs bare". Her OWN lanes may never dispatch one - inventing a command
//!    the registry never wrote down is the failure the whole feature is built
//!    around. The operator's request lane may, because a request IS an explicit
//!    invocation somebody typed.
//! 2. **Which invocation can her plan derive.** Exactly one today, and the
//!    table below says why for each of the other five rather than leaving a
//!    reader to guess that they were forgotten.
//! 3. **What the worker is allowed to do when it gets there.** The registry's
//!    skill files tell a worker not to push (`librarian`: "Open a pull request;
//!    never push to `main`"; `intake`: "Never push from a run"). The operator
//!    has since said the opposite for HER runs. A policy change in this app is
//!    invisible to a worker reading a file on disk, so the authorization
//!    travels **in the brief**, dated and named, and it says out loud which
//!    line it overrides. The registry's files are not edited: a human running
//!    `/librarian` by hand must still get the safe default.

use personas_core::models::{
    curator_lane, CuratorDecisionLevel, CuratorEngine, CuratorPlanItem, CuratorPolicy, CuratorSkill,
};

use crate::error::AppError;

/// The refill lane's skill and its argument.
///
/// **`/harvest research` and deliberately not `/deepen`.** Both were read on
/// 2026-09-24. `harvest`'s own file describes the refill as a generator that
/// cannot come up empty - "A refill that returns 'no elite source exists yet'
/// updates the gap line's `nearest stand-in` instead - that is a finding, not a
/// failure". `deepen`'s file describes the opposite: "Saturation is a state,
/// not an end: when nothing clears threshold the loop **idles until the
/// earliest clock or an event**". A lane whose job is that she never idles
/// cannot be built on a skill that idles by design, so `deepen` stays a
/// consumer of work somebody else identified.
pub(super) const REFILL_SKILL: &str = "harvest";
pub(super) const REFILL_ARGUMENT: &str = "research";

/// Who granted the standing authorization, and when. Spelled as constants
/// because the brief, the tests and any future audit must all read the same
/// pair - a date typed twice is a date that drifts.
pub(super) const AUTHORIZED_BY: &str = "Operator (xkazm04)";
pub(super) const AUTHORIZED_ON: &str = "2026-09-24";

// ---------------------------------------------------------------------------
// Which level authorises which skill
// ---------------------------------------------------------------------------

/// Which of the policy's four levels authorises a dispatch of `skill`.
///
/// Recorded on the dispatch row at the time, and copied onto every commit that
/// run causes, because `curator_commit.level_that_authorised` exists so a later
/// policy change cannot re-authorise a commit retroactively.
///
/// The mapping is by what the skill DOES, which is why `harvest` and `intake`
/// sit with research rather than with the sweep: both mine and land external
/// sources. Anything unrecognised falls to `level_sweep`, the registry's own
/// maintenance lane - and that fallback is named rather than left to a
/// wildcard, because a skill this app has never heard of is exactly the case
/// where guessing a HIGHER authority would be the expensive mistake.
pub(super) fn authorising_level(policy: &CuratorPolicy, skill: &str) -> CuratorDecisionLevel {
    match skill {
        "forge" => policy.level_forge,
        "conform" => policy.level_conform,
        "harvest" | "intake" | "assay" | "deepen" | "research" => policy.level_research,
        _ => policy.level_sweep,
    }
}

// ---------------------------------------------------------------------------
// What her own lanes may dispatch
// ---------------------------------------------------------------------------

/// Refuse an invocation she would be INVENTING.
///
/// Stricter than [`super::vet_request`] in exactly one place, and that place is
/// the point: `runs_bare == None` means the file documents no invocation at
/// all, so this app has no basis for a command line. The operator's lane is
/// allowed to name such a skill because the operator typed the invocation; her
/// own lanes are not, because nobody did.
///
/// Measured 2026-09-24 against the registry: `deepen` and `forge` are in
/// exactly that state, and 31 of the 36 shared skills are too.
pub(super) fn vet_autonomous(
    skills: &[CuratorSkill],
    skill: &str,
    argument: Option<&str>,
) -> Result<(), AppError> {
    let Some(found) = skills.iter().find(|s| s.name == skill) else {
        return Err(AppError::NotFound(format!(
            "the registry has no skill called '{skill}'"
        )));
    };
    match found.runs_bare {
        None => Err(AppError::Validation(format!(
            "'{skill}' documents no invocation, so Curator has no command to run - only an \
             explicit request from the operator may name it"
        ))),
        Some(false) if argument.is_none() => Err(AppError::Validation(format!(
            "'{skill}' documents no bare invocation, so it needs an argument{}",
            found
                .argument_hint
                .as_deref()
                .map(|hint| format!(" - the file states `{hint}`"))
                .unwrap_or_default()
        ))),
        _ => Ok(()),
    }
}

/// Engine -> the registry skill that answers it, for the engines her plan can
/// turn into a command she may actually run.
///
/// ONE route, and the list is short because the honest answer is short. See
/// [`plan_invocation`] for why each of the other five is absent.
pub(super) const PLAN_ROUTES: [(CuratorEngine, &str); 1] =
    [(CuratorEngine::Reconcile, "reconcile")];

/// The engines the claim may take, given what the registry's disk actually
/// carries right now.
///
/// A route whose skill is missing from the lane, or whose file documents no
/// invocation, is dropped HERE rather than after the claim - a claim marks an
/// item `dispatched`, and an item marked dispatched for a worker that was then
/// refused is an item stuck in flight forever. An empty result is a real and
/// expected answer: it means her plan has nothing she can act on, which is what
/// sends the tick to the refill lane.
pub(super) fn claimable_engines(skills: &[CuratorSkill]) -> Vec<CuratorEngine> {
    PLAN_ROUTES
        .into_iter()
        .filter(|(_, skill)| vet_autonomous(skills, skill, Some("probe")).is_ok())
        .map(|(engine, _)| engine)
        .collect()
}

/// The invocation one plan item implies, or `None` when the item does not
/// carry what the answering skill's documented invocation needs.
///
/// | engine | what the registry documents | derivable from the item? |
/// |---|---|---|
/// | `Reconcile` | `/reconcile <bundle>` | **yes** - a bundle IS the item's `domain` |
/// | `Deepen` | nothing at all (`runs_bare: None`) | no - there is no command to write |
/// | `Intake` | `/intake <url\|path\|->` | no - the finding is a citation that DIED; a replacement source is not in the item |
/// | `Apply` | `/intake apply <technique> [--project <slug>]` | no - the item carries a technique COUNT, never a technique's name |
/// | `Conform` | `/conform [context-or-path] [--subject <slug>]` | no - it judges a CONSUMER repo against the standard, and the item names no project; running it in the registry checkout would have the corpus grade itself |
/// | `None` | - | no - nothing was recognised, which is a finding about the matcher |
///
/// An item this returns `None` for is left `planned` and untouched. It is
/// deliberately NOT marked `blocked`: `blocked` is a terminal state that breaks
/// her saturation streak, and "this app cannot spell the command" is a fact
/// about this app, not an outcome for the subject.
pub(super) fn plan_invocation(item: &CuratorPlanItem) -> Option<(&'static str, String)> {
    match item.engine {
        // The argument is the item's own `domain`, which IS a bundle - the one
        // case where the finding carries everything the invocation needs.
        CuratorEngine::Reconcile => PLAN_ROUTES
            .into_iter()
            .find(|(engine, _)| *engine == CuratorEngine::Reconcile)
            .map(|(_, skill)| (skill, item.domain.clone())),
        CuratorEngine::Deepen
        | CuratorEngine::Intake
        | CuratorEngine::Apply
        | CuratorEngine::Conform
        | CuratorEngine::Forge
        | CuratorEngine::None => None,
    }
}

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

/// Everything one worker is told.
pub(super) struct Brief<'a> {
    /// One of [`curator_lane`]'s three dispatch lanes.
    pub lane: &'a str,
    pub skill: &'a str,
    pub argument: Option<&'a str>,
    /// The operator's own words from their request, carried unchanged. `None`
    /// for a lane the operator did not write.
    pub note: Option<&'a str>,
    /// `<domain>/<slug>` for a plan dispatch.
    pub subject: Option<&'a str>,
    /// The scan's own sentence for the finding that motivated a plan dispatch.
    pub finding: Option<&'a str>,
    /// The registry HEAD the worker starts from, so its report can cite the
    /// same version this app will diff against.
    pub head: Option<&'a str>,
}

/// The dated standing-authorization paragraph.
///
/// Shaped on the registry's own precedent for overriding a skill's safety
/// default - `hygiene/SKILL.md`: "Operator, 2026-09-15: hygiene merges,
/// deletes, implements and pushes to the default branches of fleet repos
/// **without asking**." Two things are carried across with it and neither is
/// decoration:
///
/// - **the limits**, because an authorization quoted without its limits is a
///   broader grant than the one the operator gave; and
/// - **which line it overrides**, because the worker is about to read a file
///   that says the opposite, and a worker that cannot tell which instruction
///   wins will pick the safe one and park its branch.
pub(super) fn authorization_line() -> String {
    format!(
        "STANDING AUTHORIZATION - {AUTHORIZED_BY}, {AUTHORIZED_ON}, for Curator's dispatched \
         runs only.\n\
         You may commit, merge and push to the default branch of this checkout and of any \
         project this run touches, without asking. The fleet has one owner and the \
         repositories' own gates are the guard, not a confirmation round trip. This \
         OVERRIDES the \"never push\" / \"open a pull request instead\" line in the skill file \
         you are about to run - that line is the safe default for a human running it by \
         hand, and it has not been edited, so read it as still binding for every invocation \
         except this one.\n\
         It does NOT cover, and nothing in this run may do: `--no-verify`, `LEFTHOOK=0`, \
         `HUSKY=0`, any `*_SKIP_GATE`, or force-pushing a default branch - a gate that \
         blocks is an answer; discarding uncommitted changes anywhere; touching a worktree \
         under `AppData/Roaming/com.personas.desktop/worktrees/`, which the Personas app \
         owns; resolving or dismissing a secret-scanning alert, which is a human act.\n\
         Every commit you make here is read back by Personas from this checkout's git log \
         and recorded against {AUTHORIZED_BY}'s daily commit cap, so commit normally and do \
         not rewrite history you did not create in this run."
    )
}

/// The whole prompt one worker is spawned with.
///
/// Line one is the invocation, in the `"/skill argument"` shape this repo
/// already uses to inject a skill at spawn (`FleetPlanRow::prompt`). Everything
/// after it is context the slash command itself cannot carry.
pub(super) fn compose(brief: &Brief<'_>) -> String {
    let mut out = String::new();
    match brief.argument {
        Some(arg) => out.push_str(&format!("/{} {arg}\n\n", brief.skill)),
        None => out.push_str(&format!("/{}\n\n", brief.skill)),
    }
    out.push_str(&format!(
        "You are a worker Curator dispatched. She is the companion who keeps this knowledge \
         registry world-class and applied, and she is running unattended.\n\n\
         Lane: {}\n",
        lane_sentence(brief.lane)
    ));
    if let Some(head) = brief.head {
        out.push_str(&format!("Registry HEAD at dispatch: {head}\n"));
    }
    if let Some(subject) = brief.subject {
        out.push_str(&format!("Subject: {subject}\n"));
    }
    if let Some(finding) = brief.finding {
        out.push_str(&format!("The finding that ranked it: {finding}\n"));
    }
    if let Some(note) = brief.note {
        // The operator's own words, unchanged and marked as theirs, so a
        // worker can tell an instruction from a paraphrase of one.
        out.push_str(&format!("\nThe operator wrote, verbatim:\n{note}\n"));
    }
    out.push('\n');
    out.push_str(&authorization_line());
    out.push_str(
        "\n\nRun the skill named on the first line and nothing else. If the skill's own \
         instrument reports that there is no work, say so and stop - a pass that honestly \
         found nothing is a result and is recorded as one.",
    );
    out
}

/// One sentence naming the lane, so the worker knows who asked and why.
fn lane_sentence(lane: &str) -> &'static str {
    match lane {
        curator_lane::QUEUE => {
            "the operator's own request queue, which she drains before her own plan"
        }
        curator_lane::PLAN => "her projection of the registry's own attention scan",
        curator_lane::REFILL => {
            "the refill pass she runs when both other lanes are empty, because she never idles"
        }
        // Not reachable through `tick` - `e52`'s CHECK allows three lanes and
        // the sleep pass dispatches nothing - but a brief that silently
        // dropped its lane line would be worse than one that says it does not
        // know which lane it came from.
        _ => "a lane this app could not name",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use personas_core::models::{CuratorReasonCode, CuratorSkillLane};

    fn skill(name: &str, runs_bare: Option<bool>, hint: Option<&str>) -> CuratorSkill {
        CuratorSkill {
            name: name.into(),
            lane: CuratorSkillLane::Native,
            path: format!(".claude/skills/{name}/SKILL.md"),
            title: None,
            description: None,
            version: None,
            invocation_documented: runs_bare.is_some(),
            runs_bare,
            argument_hint: hint.map(str::to_string),
        }
    }

    fn item(engine: CuratorEngine, domain: &str) -> CuratorPlanItem {
        CuratorPlanItem {
            id: "i1".into(),
            plan_run_id: "r1".into(),
            subject_id: format!("{domain}/a-subject"),
            domain: domain.into(),
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
            state: personas_core::models::CuratorPlanItemState::Planned,
            declined_reason: None,
            dispatched_run_id: None,
            evidence_ref: None,
            updated_at: "2026-09-24T00:00:00Z".into(),
        }
    }

    /// **The rule the whole feature is built around, on her side of it.** An
    /// undocumented invocation is unknown, and unknown is not permission.
    #[test]
    fn her_own_lanes_never_invent_a_command() {
        let lane = [
            skill("harvest", Some(true), Some("/harvest run [domain]")),
            skill("reconcile", Some(false), Some("/reconcile <bundle>")),
            skill("deepen", None, None),
            skill("forge", None, None),
        ];

        assert!(vet_autonomous(&lane, "harvest", Some("research")).is_ok());
        assert!(vet_autonomous(&lane, "harvest", None).is_ok());
        assert!(vet_autonomous(&lane, "reconcile", Some("localization")).is_ok());

        // Documented as needing an argument, given none.
        let bare = vet_autonomous(&lane, "reconcile", None).unwrap_err();
        assert!(matches!(bare, AppError::Validation(_)), "{bare:?}");

        // The two that document nothing. `vet_request` ACCEPTS both, because
        // an operator naming one is an explicit invocation; she may not.
        for undocumented in ["deepen", "forge"] {
            for argument in [None, Some("anything")] {
                let refused = vet_autonomous(&lane, undocumented, argument).unwrap_err();
                match refused {
                    AppError::Validation(msg) => assert!(
                        msg.contains("documents no invocation"),
                        "{undocumented}: {msg}"
                    ),
                    other => panic!("{undocumented}: {other:?}"),
                }
            }
            // ... and the operator's own door still takes it, which is the
            // asymmetry this test exists to pin.
            assert!(super::super::vet_request(&lane, undocumented, None).is_ok());
        }

        assert!(matches!(
            vet_autonomous(&lane, "nonesuch", None).unwrap_err(),
            AppError::NotFound(_)
        ));
    }

    /// The plan table, asserted whole. A sixth engine becoming derivable is a
    /// deliberate act that has to edit this test.
    #[test]
    fn the_plan_derives_one_engine_and_names_the_rest_as_unreachable() {
        assert_eq!(
            plan_invocation(&item(CuratorEngine::Reconcile, "localization")),
            Some(("reconcile", "localization".to_string())),
            "a bundle IS the item's domain"
        );
        for engine in [
            CuratorEngine::Deepen,
            CuratorEngine::Intake,
            CuratorEngine::Apply,
            CuratorEngine::Conform,
            CuratorEngine::Forge,
            CuratorEngine::None,
        ] {
            assert_eq!(
                plan_invocation(&item(engine, "localization")),
                None,
                "{engine:?} must not be guessed at"
            );
        }
        // The claim's engine list and the table must agree: a route that
        // derives nothing would claim items it then could not dispatch, and
        // would leave them stuck at `dispatched` forever.
        for (engine, _) in PLAN_ROUTES {
            assert!(
                plan_invocation(&item(engine, "d")).is_some(),
                "{engine:?} is claimable but derives no invocation"
            );
        }
    }

    /// A route whose skill the registry does not carry is dropped BEFORE the
    /// claim, because a claim is a write: an item marked `dispatched` for a
    /// worker that was then refused never comes back.
    #[test]
    fn a_route_whose_skill_is_missing_is_never_claimable() {
        let full = [skill("reconcile", Some(false), Some("/reconcile <bundle>"))];
        assert_eq!(claimable_engines(&full), vec![CuratorEngine::Reconcile]);

        // The registry dropped or renamed it.
        assert!(claimable_engines(&[]).is_empty());
        // ... or it lost its documented invocation, which is the same
        // situation as `deepen`'s and must read the same way.
        let undocumented = [skill("reconcile", None, None)];
        assert!(claimable_engines(&undocumented).is_empty());
    }

    /// The level recorded on a commit is the one the operator declared for
    /// that KIND of work, and an unknown skill claims the least.
    #[test]
    fn every_skill_maps_to_the_level_the_operator_declared() {
        let policy = CuratorPolicy {
            level_research: CuratorDecisionLevel::L1,
            level_forge: CuratorDecisionLevel::L2,
            level_conform: CuratorDecisionLevel::L3,
            level_sweep: CuratorDecisionLevel::L0,
            ..CuratorPolicy::default()
        };
        assert_eq!(
            authorising_level(&policy, "harvest"),
            CuratorDecisionLevel::L1
        );
        assert_eq!(
            authorising_level(&policy, "intake"),
            CuratorDecisionLevel::L1
        );
        assert_eq!(
            authorising_level(&policy, "forge"),
            CuratorDecisionLevel::L2
        );
        assert_eq!(
            authorising_level(&policy, "conform"),
            CuratorDecisionLevel::L3
        );
        assert_eq!(
            authorising_level(&policy, "librarian"),
            CuratorDecisionLevel::L0
        );
        assert_eq!(
            authorising_level(&policy, "hygiene"),
            CuratorDecisionLevel::L0
        );
        assert_eq!(
            authorising_level(&policy, "reconcile"),
            CuratorDecisionLevel::L0
        );
        assert_eq!(
            authorising_level(&policy, "a-skill-shipped-next-year"),
            CuratorDecisionLevel::L0,
            "an unrecognised skill takes the sweep level, never the highest one declared"
        );
    }

    /// The authorization is dated, named, bounded, and says which line it
    /// overrides. All four, because the precedent it copies has all four.
    #[test]
    fn the_authorization_is_dated_named_bounded_and_says_what_it_overrides() {
        let line = authorization_line();
        assert!(line.contains(AUTHORIZED_BY), "it names who granted it");
        assert!(line.contains(AUTHORIZED_ON), "and when");
        assert!(
            line.contains("Curator's dispatched \n         runs only")
                || line.contains("Curator's dispatched runs only"),
            "it is scoped to her runs: {line}"
        );
        assert!(
            line.contains("never push"),
            "it quotes the line it overrides"
        );
        for limit in [
            "--no-verify",
            "LEFTHOOK=0",
            "force-pushing",
            "secret-scanning",
        ] {
            assert!(
                line.contains(limit),
                "the limit {limit} must travel with it"
            );
        }
    }

    /// The prompt leads with the invocation - that is how a skill is injected
    /// at spawn - and carries the operator's words unchanged.
    #[test]
    fn the_prompt_leads_with_the_invocation_and_quotes_the_operator() {
        let composed = compose(&Brief {
            lane: curator_lane::QUEUE,
            skill: "intake",
            argument: Some("https://example.test/paper"),
            note: Some("focus on the retrieval section, skip the benchmarks"),
            subject: None,
            finding: None,
            head: Some("abc1234"),
        });
        assert!(
            composed.starts_with("/intake https://example.test/paper\n"),
            "{composed}"
        );
        assert!(composed.contains("focus on the retrieval section, skip the benchmarks"));
        assert!(composed.contains("abc1234"));
        assert!(composed.contains(AUTHORIZED_ON));
        assert!(composed.contains("request queue"));

        // A bare-runnable skill gets a bare first line - no empty token where
        // an argument would be.
        let refill = compose(&Brief {
            lane: curator_lane::REFILL,
            skill: REFILL_SKILL,
            argument: Some(REFILL_ARGUMENT),
            note: None,
            subject: None,
            finding: None,
            head: None,
        });
        assert!(refill.starts_with("/harvest research\n"), "{refill}");
        assert!(!refill.contains("The operator wrote"));

        let bare = compose(&Brief {
            lane: curator_lane::PLAN,
            skill: "librarian",
            argument: None,
            note: None,
            subject: Some("localization/czech"),
            finding: Some("its only application expired on 2026-08-01"),
            head: None,
        });
        assert!(bare.starts_with("/librarian\n\n"), "{bare}");
        assert!(bare.contains("localization/czech"));
        assert!(bare.contains("expired on 2026-08-01"));
    }
}
