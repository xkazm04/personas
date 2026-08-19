---
layer: technique
subject: quality-gates
technique: severity-by-construction
status: forged
laws: [gate-sees-target, count-carries-predicate]
shared_with: []
---

# Severity by construction

Every rule in a quality toolchain carries a severity label — advisory or
blocking, warn or error. The label is a claim: "at this level, this rule
can stop the pipeline." The claim is only true if the plumbing between the
finding and the exit code actually carries it, and in practice the plumbing
neutralizes labels far more often than anyone audits. This technique is the
audit.

## Trace the exit-code path, believe nothing else

For each gate command the pipeline runs, ask one question per severity
level: **what count of findings at this level makes this command exit
non-zero?** Not "what is the rule configured as" — what does the *invocation*
do with it. The recurring neutralizers:

- **No threshold flag.** Many linters exit clean regardless of advisory
  count unless invoked with an explicit maximum. A gate command without the
  threshold flag enforces only the blocking level, whatever the rule files
  say.
- **A threshold set beyond any count the codebase could produce.** An
  explicit maximum of five digits, against a real population in the
  hundreds, is a disabled gate wearing a configuration value. It reads as
  strictness in review and can never fire.
- **Aggregators that only propagate one level.** Wrapper scripts, task
  runners, and chained commands frequently collapse a child's rich exit
  semantics into pass/fail on the blocking level only.
- **Reports without a consumer.** A check whose findings land in a log or
  an annotation, with no step whose exit code depends on them, has the
  severity of the void.

## Two channels, and each flag disarms exactly one

A finding travels on two independent channels: the **exit code** (what the
gate can refuse) and the **display** (what a human sees). Invocation flags
disarm one channel or the other, rarely both, and folklore reliably
misattributes which. The measured cautionary tale: a "quiet" flag was
documented — and cited by five downstream documents — as suppressing
advisory findings *before counting*, i.e. as an exit-code neutralizer.
Fault injection showed the opposite: with the quiet flag and a threshold
of zero, the command still failed. The quiet flag disarms only the
*report*; the co-present giant threshold was the entire exit-code
neutralizer. The conclusion ("advisory enforces nothing here") survived,
but the mechanism was wrong — and mechanism changes the remedy: since the
quiet flag is a display switch, removing it would restore the one channel
an advisory rule actually has, at zero cost to enforcement. Under the
folklore mechanism, that edit looks pointless.

Two rules fall out. **Establish mechanism by fault injection, not by
reading flag names** — run the command against a file with a known finding
count and vary one flag at a time. And **audit the display channel too**:
suppressing advisory output at the rung where the author is looking
destroys advisory severity's only value while changing nothing about
enforcement — the worst of both products.

The conclusion of the trace is a sentence of the form: *"at the commit
rung, advisory findings can never fail; at the merge rung, advisory
findings fail above N."* Until that sentence is written down, severity
labels are folklore.

**Advisory severity that no gate counts enforces nothing — by
construction.** Not "weakly," not "in practice": there is no input that
produces refusal, so per the foundational test it is not a gate. This
conclusion needs no measurement of violation counts, and that matters,
because the volume argument is a trap — see below.

## Advisory is a real product — a different one

The honest case for advisory severity: it changes behavior at authoring
time. Editor feedback appears while the code is being written, when the fix
costs seconds, and adoption of a convention measurably correlates with
whether a rule *exists to squiggle it* — even when no gate ever counts it.
Advisory rules are the editor rung's payload, and dismissing them as
worthless is as wrong as mistaking them for enforcement.

The discipline is to know which product you are buying:

- **Enforcement**: the standard is mandatory; violations must be unable to
  merge. Requires blocking severity *and* a traced exit path that carries
  it.
- **Advice**: the standard is preferred; the team accepts violations
  shipping. Advisory severity, honestly labeled.

The failure mode is buying advice while the team believes it owns
enforcement — a standard everyone assumes is machine-held and no machine
holds ([gate-sees-target](../../_laws.md#gate-sees-target): the org reads
the label, not the plumbing).

## Never argue severity from violation volume

A tempting argument: "there are thousands of advisory findings, so any one
rule's warnings drown — therefore new rules must enter at blocking level."
The conclusion may be right; the argument is rotten, twice over. First, the
volume number goes stale the moment someone disables a noisy rule, and
arguments built on it quietly inherit the staleness — a figure cited long
after it was measured has been observed off by an order of magnitude, with
the dominant rule misidentified
([count-carries-predicate](../../_laws.md#count-carries-predicate): a count
that travels without its measurement date and predicate will be reused for
claims it no longer supports). Second, the argument is unnecessary: whether
advisory findings can fail the gate is a property of the invocation, not of
the count. Re-measure before citing, and prefer the construction argument,
which does not decay.

## Escalation path for a new rule

New rules should not leap to blocking on day one — precision is unproven
(see false-positive-economics) and legacy violations may number in the
hundreds. The sound sequence:

1. **Advisory, editor rung** — a calibration window. Collect the finding
   population; measure precision against ground truth.
2. **Blocking for new code** — escalate to blocking severity with the
   legacy population held by a baseline ratchet (see ratchet-design), or
   scoped to touched files with the full-scope backstop tracking the
   remainder.
3. **Blocking everywhere** — when the ratchet hits zero, delete the
   baseline and let the rule stand plain.

Each step is a deliberate change with a reviewable diff. A rule that lives
at step 1 forever, in a team that believes the standard is mandatory, is
the exact mislabeling this technique exists to catch.
