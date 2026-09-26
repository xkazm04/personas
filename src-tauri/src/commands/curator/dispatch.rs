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
    curator_lane, CuratorDecisionLevel, CuratorEngine, CuratorImpediment, CuratorPlanItem,
    CuratorPolicy, CuratorSkill,
};

use crate::error::AppError;

/// The standing lane's skill. Both of its rungs are `harvest` passes over the
/// same queue file, which is why they can never run at the same time.
///
/// **`harvest` and deliberately not `/deepen`, and that is about THIS lane
/// only.** Her plan lane does route to `deepen` as of 2026-09-26; the standing
/// lane still must not, and the reason below is unchanged by that.
///
/// Both were read on 2026-09-24.
/// `deepen`'s file says "Saturation is a state, not an end: when nothing clears
/// threshold the loop **idles until the earliest clock or an event**". A lane
/// whose job is that she never idles cannot be built on a skill that idles by
/// design, so `deepen` stays a consumer of work somebody else identified.
pub(super) const STANDING_SKILL: &str = "harvest";

/// Rung 3 - **drain the standing queue**: "one unattended pass: only
/// self-authorizing outcomes land". It is the mode harvest wrote for a machine
/// caller: "already covered / currency / lead" land unattended, content banks
/// as a spec and never lands, and a decline is "never auto-declined - parked or
/// untriaged only".
pub(super) const DRAIN_ARGUMENT: &str = "auto";

/// Rung 4 - **refill the queue**, and only when [`super::standing`] has
/// measured that it needs refilling.
///
/// This constant used to be the lane's ONLY rung, on the reading that harvest's
/// refill "cannot come up empty" - "A refill that returns 'no elite source
/// exists yet' updates the gap line's `nearest stand-in` instead - that is a
/// finding, not a failure". The sentence is true and the inference from it was
/// wrong: a refill that finds no GAP worth attacking dispatches nothing at all,
/// which is what eight consecutive passes did on 2026-09-24 at ~$0.26 each
/// against a 268-row queue. `research` generates rows; `auto` consumes them.
/// The whole derivation is in [`super::standing`].
pub(super) const REFILL_ARGUMENT: &str = "research";

/// Who granted the standing authorization, and when. Spelled as constants
/// because the brief, the tests and any future audit must all read the same
/// pair - a date typed twice is a date that drifts.
pub(super) const AUTHORIZED_BY: &str = "Operator (xkazm04)";
pub(super) const AUTHORIZED_ON: &str = "2026-09-24";
/// The day the operator widened her write surface from the corpus's CONTENT to
/// the registry's own METHOD files.
///
/// A second date rather than a bump of the first, because the grants are not the
/// same grant: one lets her land knowledge, the other lets her change the
/// instructions every future worker reads. A reviewer asking "when was she
/// allowed to edit a SKILL.md?" gets an answer that is not entangled with when
/// she was allowed to push.
pub(super) const METHOD_AUTHORIZED_ON: &str = "2026-09-26";

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
        // Not a registry skill: the name the method lane dispatches under. It
        // is matched FIRST so a future registry skill of the same name could
        // not silently inherit the highest authority she holds.
        METHOD_SKILL => policy.level_method,
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
/// Measured 2026-09-24 against the registry: `deepen` and `forge` were in
/// exactly that state, and 31 of the 36 shared skills are too. `deepen` left it
/// on 2026-09-26 - see [`PLAN_ROUTES`] - which is the first time this app's own
/// refusal was answered by a change to the registry rather than by a carve-out
/// here. `forge` has not, and is now measured as an impediment rather than
/// described in a comment.
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
/// TWO routes, and the list is short because the honest answer is short. See
/// [`plan_invocation`] for why each of the other four is absent.
///
/// `Deepen` joined on 2026-09-26 and nothing about the subject changed to let
/// it: the registry's `deepen/SKILL.md` gained the `## Invocation` block it had
/// never had, so `runs_bare` moved from `None` (unknown) to `Some(false)`
/// (needs an argument) and a command she may write exists for the first time.
/// It was 103 of the standing plan's 314 items - the largest engine after
/// `apply` - and every one of them was undispatchable because of an absent
/// heading in a method file, not because of a policy. That is the shape of
/// impediment worth measuring on purpose rather than rediscovering.
pub(super) const PLAN_ROUTES: [(CuratorEngine, &str); 2] = [
    (CuratorEngine::Reconcile, "reconcile"),
    (CuratorEngine::Deepen, "deepen"),
];

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
/// | `Deepen` | `/deepen <domain>/<subject>` | **yes** - that address IS the item's `subject_id`, which is the scan's own id |
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
        // The subject form, and the argument is the item's `subject_id`
        // VERBATIM - `<domain>/<slug>` is what the scan produced, what
        // `index.json` keys on and what the skill's own invocation block
        // spells. Rebuilding it from `domain` + a slug would be constructing an
        // address the registry already states, which is the failure mode that
        // skill's step 1 names in its own rules.
        CuratorEngine::Deepen => PLAN_ROUTES
            .into_iter()
            .find(|(engine, _)| *engine == CuratorEngine::Deepen)
            .map(|(_, skill)| (skill, item.subject_id.clone())),
        CuratorEngine::Intake
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
    /// One of [`curator_lane`]'s dispatch lanes. The method lane does not use
    /// this struct at all - it has no skill to inject, so it composes through
    /// [`compose_method`].
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
    /// **The count this app dispatched on**, for a lane whose rung was chosen
    /// by a measurement rather than by a claimed row.
    ///
    /// Carried so the worker can check it. The whole reason this lane has two
    /// rungs is that a dispatched worker recounted the queue by hand, found the
    /// app's reasoning wrong, and said so; a brief that hides the number it
    /// acted on makes that contradiction cost a run to discover.
    pub measurement: Option<&'a str>,
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
    if let Some(measurement) = brief.measurement {
        out.push_str(&format!(
            "What Personas measured before dispatching you: {measurement}. Recount it - if the \
             queue says otherwise, say so and stop; a contradiction backed by evidence is the \
             result this lane most needs.\n"
        ));
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
        // Reachable only through `compose_method`, which writes its own lane
        // line - but spelled here anyway, because a `match` on a closed
        // vocabulary that silently fell through to the refill sentence would
        // tell a worker it was doing the opposite of what it is doing.
        curator_lane::METHOD => {
            "her method lane - repairing the instruction that blocks her own plan"
        }
        // ONE lane, two rungs: `/harvest auto` drains the standing queue and
        // `/harvest research` refills it. The first line of this prompt says
        // which rung you are, so the sentence names the lane rather than
        // claiming a rung it cannot see from here.
        curator_lane::REFILL => {
            "her standing lane, which she runs when the operator's queue and her own plan are \
             both empty, because she never idles"
        }
        // Not reachable through `tick` - `e52`'s CHECK allows three lanes and
        // the sleep pass dispatches nothing - but a brief that silently
        // dropped its lane line would be worse than one that says it does not
        // know which lane it came from.
        _ => "a lane this app could not name",
    }
}

// ---------------------------------------------------------------------------
// The method lane
// ---------------------------------------------------------------------------

/// The name a method dispatch is recorded under.
///
/// **Not a registry skill, and deliberately not shaped like one.** Every other
/// lane's first line is `/<skill> <argument>`, which injects a skill at spawn.
/// This lane has no skill to inject: the worker is not running the registry's
/// method, it is repairing the method so that a future worker can run it. A
/// pseudo-skill name that collided with a real one would hand that real skill
/// the highest authority she holds, which is why [`authorising_level`] matches
/// this arm before any other.
pub(super) const METHOD_SKILL: &str = "method";

/// The dated grant that widens her write surface from content to method.
///
/// Appended to [`authorization_line`] for this lane alone, and kept separate
/// rather than folded in, for the reason the original carries its own limits:
/// **an authorization is only as honest as its boundary**, and this one crosses a
/// boundary the other never did. The other three lanes edit what the corpus
/// SAYS. This one edits the files that say how every future worker WORKS.
///
/// Its own limit is the interesting half. She may document an invocation a
/// file's prose already implies - the bounded, reviewable act that was measured
/// on 2026-09-26 as the sole thing standing between her and 103 ranked subjects.
/// She may not invent a mode, change what a skill does, or touch a rule; and she
/// may not edit Personas, which is the app that runs her and the one place where
/// a change could rewrite its own audit.
fn method_authorization() -> String {
    format!(
        "METHOD AUTHORIZATION - {AUTHORIZED_BY}, {METHOD_AUTHORIZED_ON}. This run edits the \
         registry's own METHOD files - a `SKILL.md`, not a subject - because a gap in one is \
         what is blocking her plan.\n\
         What this covers: writing down an invocation the file's own prose ALREADY implies, \
         bumping its `version:`, and appending the lesson that records why. That is the whole \
         grant, and it was written on the day 103 ranked subjects turned out to be \
         undispatchable because one file was missing one heading.\n\
         What it does NOT cover, and this is the point of a separate paragraph: inventing a \
         mode the file does not describe; changing what the skill DOES; editing any rule, \
         limit or anti-pattern; deleting anything. If the honest answer is that the file \
         describes no invocation because its author had not decided on one, say exactly that \
         and stop - an undocumented skill is a better outcome than a documented fiction, \
         because everything downstream will believe the fiction.\n\
         It also does not cover the Personas application source at any path. Personas is the \
         app that dispatched you and reads your commits back; a run that edited it would be \
         rewriting the record of itself."
    )
}

/// The whole prompt a method worker is spawned with.
///
/// Separate from [`compose`] rather than a branch inside it, because that
/// function's first-line contract - the invocation, which is how a skill is
/// injected - is exactly what this lane does not have, and its own test asserts
/// that contract. A branch would have made the assertion conditional and the
/// contract stop meaning anything.
pub(super) fn compose_method(impediment: &CuratorImpediment, head: Option<&str>) -> String {
    let mut out = String::new();
    out.push_str(
        "You are a worker Curator dispatched. She is the companion who keeps this knowledge \
         registry world-class and applied, and she is running unattended.\n\n\
         Lane: her METHOD lane. She is not asking you to do registry work; she is asking you \
         to repair the instruction that stops her doing it.\n",
    );
    if let Some(head) = head {
        out.push_str(&format!("Registry HEAD at dispatch: {head}\n"));
    }
    out.push_str(&format!(
        "\nWhat is blocking her, measured from her own standing plan at dispatch:\n\
         - skill: {}\n\
         - file: {}\n\
         - it holds: {} ranked plan item(s) she otherwise cannot dispatch at all\n\
         - closing it releases: {} of them - the rest, if any, are waiting on \
         something else as well\n\
         - what is missing: {}\n",
        impediment.skill,
        impediment.file.as_deref().unwrap_or("(none - see below)"),
        impediment.blocks,
        impediment.frees,
        impediment.summary,
    ));
    out.push_str(
        "\nRecount that before you write anything. The count came from this app's projection, \
         and if the file already documents an invocation - or documents one that her plan \
         still could not fill - then the finding is about her projection rather than about \
         this file, and saying so is the result. Do not add a heading to make a number go \
         down.\n\n\
         How to write it, if it is genuinely missing:\n\
         1. Read the WHOLE file first. The invocation you write must be the one its prose \
            already describes - its modes, its arguments, its ledgers - and nothing else. \
            Every line you add has to be answerable by the method that is already there.\n\
         2. Match the house shape of the lane's other skills: a fenced block under an \
            `## Invocation` heading, one `/<name> <args>` line per mode with a trailing \
            comment. Read two neighbours before you decide the shape; do not invent one.\n\
         3. Say out loud in the file which forms do NOT exist and why, when the absence is \
            deliberate. A bare form that would sweep everything, when another skill owns \
            that job, is worth one sentence naming the other skill.\n\
         4. Bump `version:` in the frontmatter and append an entry to the skill's \
            `LESSONS.md` in that file's own existing format, recording what was absent and \
            what it cost. If there is no `LESSONS.md`, do not create one.\n\
         5. Commit that file (and its `LESSONS.md`) and nothing else, with a message that \
            names the impediment. Other sessions are writing this checkout: stage by \
            pathspec, never `git add -A`, and never stash work that is not yours.\n",
    );
    out.push('\n');
    out.push_str(&authorization_line());
    out.push_str("\n\n");
    out.push_str(&method_authorization());
    out.push_str(
        "\n\nOne file, one gap, one commit. If you find a second thing wrong with the file, \
         write it in your report rather than fixing it - a method change is reviewed by a \
         person reading a small diff, and that is the only reason this lane is allowed to \
         exist.",
    );
    out
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
            lessons_path: None,
            lessons_bytes: None,
            lessons_modified_at: None,
            lessons_latest_entry: None,
            lessons_latest_at: None,
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

    /// The plan table, asserted whole. A further engine becoming derivable is a
    /// deliberate act that has to edit this test.
    #[test]
    fn the_plan_derives_two_engines_and_names_the_rest_as_unreachable() {
        assert_eq!(
            plan_invocation(&item(CuratorEngine::Reconcile, "localization")),
            Some(("reconcile", "localization".to_string())),
            "a bundle IS the item's domain"
        );
        // The address is carried, never rebuilt: `item()` sets `subject_id` to
        // `<domain>/a-subject`, and that whole string is the argument.
        assert_eq!(
            plan_invocation(&item(CuratorEngine::Deepen, "localization")),
            Some(("deepen", "localization/a-subject".to_string())),
            "the subject_id IS the address /deepen documents"
        );
        for engine in [
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
        let full = [
            skill("reconcile", Some(false), Some("/reconcile <bundle>")),
            skill("deepen", Some(false), Some("/deepen <domain>")),
        ];
        assert_eq!(
            claimable_engines(&full),
            vec![CuratorEngine::Reconcile, CuratorEngine::Deepen]
        );

        // One route documented and one not is the state the registry was in
        // until 2026-09-26, and the answer is the documented one ALONE - not
        // both, and not neither.
        let half = [skill("reconcile", Some(false), Some("/reconcile <bundle>"))];
        assert_eq!(claimable_engines(&half), vec![CuratorEngine::Reconcile]);

        // The registry dropped or renamed it.
        assert!(claimable_engines(&[]).is_empty());
        // ... or it lost its documented invocation, which is the situation
        // `deepen` was in until 2026-09-26 and must read the same way.
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
            measurement: None,
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
            skill: STANDING_SKILL,
            argument: Some(REFILL_ARGUMENT),
            note: None,
            subject: None,
            finding: None,
            measurement: None,
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
            measurement: None,
            head: None,
        });
        assert!(bare.starts_with("/librarian\n\n"), "{bare}");
        assert!(bare.contains("localization/czech"));
        assert!(bare.contains("expired on 2026-08-01"));
    }

    /// **Each rung spells its own invocation**, and the drain is the one the
    /// standing lane reaches for first. This is the whole correction: the lane
    /// shipped with `research` in this position and burned eight passes on it.
    #[test]
    fn the_standing_lane_spells_the_drain_and_the_refill_apart() {
        assert_eq!(STANDING_SKILL, "harvest");
        assert_eq!(DRAIN_ARGUMENT, "auto");
        assert_eq!(REFILL_ARGUMENT, "research");

        let drain = compose(&Brief {
            lane: curator_lane::REFILL,
            skill: STANDING_SKILL,
            argument: Some(DRAIN_ARGUMENT),
            note: None,
            subject: None,
            finding: None,
            measurement: Some("268 rows are queued across 10 sections"),
            head: Some("88bff378"),
        });
        assert!(drain.starts_with("/harvest auto\n\n"), "{drain}");
        // The count travels with it, and so does the invitation to refute it.
        assert!(drain.contains("268 rows are queued"), "{drain}");
        assert!(drain.contains("Recount it"), "{drain}");
        assert!(drain.contains("88bff378"));
        // The lane sentence names the lane, never one of its rungs, because
        // both rungs travel under it.
        assert!(drain.contains("her standing lane"), "{drain}");
        assert!(!drain.contains("refill pass"), "{drain}");
    }
}
