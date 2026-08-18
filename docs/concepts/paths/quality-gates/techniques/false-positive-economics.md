---
layer: technique
subject: quality-gates
technique: false-positive-economics
status: forged
laws: [deletion-is-not-repair, count-carries-predicate]
shared_with: []
---

# False-positive economics

A gate's technical job is detection; its economic job is keeping the
team's obedience. The two come apart the first time the gate fires on
content that is actually correct. Precision is not a nice-to-have quality
attribute of a detector — it is the survival property, because gates do
not die of missed defects (nobody sees those); they die of false alarms,
by a sequence so regular it deserves a name.

## The death spiral

1. The gate fires on correct content. The author, knowing they are right,
   bypasses or suppresses it. They *are* right — locally.
2. Repetition converts the judgment call into a reflex. The team's prior
   flips from "red means look" to "red means the gate again."
3. The gate fires on a real defect. The reflex bypasses it. The defect
   ships.
4. The gate is deleted for having "never worked" — usually citing the
   incident that its bypass culture, not its detector, caused.

The spiral consumes a **shared trust budget**: one gate crying wolf
teaches people to bypass the ladder, not the rule. This is why a single
imprecise check is not a local problem — it is spending everyone's
credibility.

## Measure precision before granting severity

A detector earns blocking severity by evidence, not intention. The method:

- **Drive it over the full population it will judge** — the whole
  codebase, not the three examples it was written against. Every match is
  a claim; classify each against ground truth: true positive (violates
  the standard), false positive (correct content flagged).
- **Report precision with the predicate stated**
  ([count-carries-predicate](../../_laws.md#count-carries-predicate)):
  "N matches, K true, over population P, judged by criterion C." A
  detector at high precision over a toy sample and a detector at high
  precision over the real corpus are different instruments.
- **Probe recall with seeded and known cases.** Collect the known real
  instances of the defect and check the detector finds them. A detector
  can be precise and useless — matching only a rare spelling of the
  defect while every live instance uses another. Precision decides
  whether the gate may block; recall decides whether it is worth having.
- **Audit the anchor.** Detectors keyed to a marker (an attribute, an
  annotation, a naming pattern) inherit the marker's absence: if real
  instances of the defect do not carry the marker, recall is structurally
  zero no matter how good the logic downstream of the anchor is. Measure
  what fraction of ground-truth instances the anchor even reaches.

The brutal, common discovery: a long-standing rule that, measured this
way, scores **zero for zero** — everything it flags is fine, everything
it exists for goes unflagged. Such a rule is not a weak gate; it is a
different gate wearing the standard's name, and its continued existence
actively harms — it satisfies the "we have a rule for that" question
while covering nothing.

## Fix the detector; keep the gate

When a live gate misfires, the responses rank:

1. **Narrow the detector** — exclude the correct pattern it confused for
   the defect. Each false-positive class, once understood, is usually a
   one-clause refinement.
2. **Add a sanctioned, visible escape** — an explicit inline
   acknowledgment with a required justification, greppable and reviewed.
   This drains bypass pressure through a channel that leaves a record,
   and the acknowledgment inventory becomes an audit list.
3. **Demote to advisory** — honest when precision is not yet earned;
   pair with the measurement work to earn it back.
4. **Delete** — last, and only for the detector-never-matched-the-standard
   case above. Deleting a gate because its detector needs work converts a
   visible problem into an invisible one at the exact site where
   visibility existed
   ([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)); the
   defect class returns unguarded and the institutional memory that a
   gate once existed evaporates.

## Flaky checks: quarantine, never ambient red

A check that fails nondeterministically — timing-sensitive tests, checks
with network weather in them — is a special case of false positive with a
worse payoff: it randomizes the meaning of red across the whole suite.
The protocol is **quarantine**: move it, promptly and explicitly, to a
non-blocking lane that still runs and still reports, with an owner and a
deadline. The two wrong moves are the popular ones: leaving it blocking
(every red build starts a "real or flaky?" investigation, and reruns
train the retry-until-green reflex — a bypass habit for the *entire*
suite), and deleting it (the coverage silently vanishes). Quarantine that
lacks an owner or a deadline is deletion on an installment plan; track
the quarantine list the way a ratchet tracks a baseline — it may shrink,
never quietly grow.

The limiting case of the false-positive spiral is **permanent red**: a
suite that has never been observed green for anyone. It has been measured
in the wild — a merge pipeline with zero successes over its entire
recorded history, while merging continued around it. At that point every
finding is treated as a false positive regardless of truth value, because
the team's prior that red is noise has reached certainty. Recovery is the
same as for any bankrupt trust budget, applied wholesale: get the suite to
a *real* green once, whatever combination of fixing, quarantining, and
honest demotion it takes, and only then start re-admitting checks to the
blocking lane one at a time, each with measured precision. Adding more
rules to a never-green suite is spending into a bankruptcy.
