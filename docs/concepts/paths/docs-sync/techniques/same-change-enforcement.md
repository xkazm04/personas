---
layer: technique
subject: docs-sync
technique: same-change-enforcement
status: forged
laws: [gate-sees-target, failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Same-change enforcement

Documentation debt is cheapest at the instant it is incurred: the author —
human or agent — still knows what changed, whether it was user-visible, and
which surfaces it touches. A week later that context is gone and the repair
costs a campaign. Same-change enforcement collects the debt at the change
boundary: when source coupled to a document changes, the same change (same
turn, same commit, same review) must either update the coupled surfaces or
explicitly dismiss the obligation. This technique is the design of that
collection point — and the autopsy of the one that never collected anything.

## The autopsy: fifteen months of enforcement that never fired

The subject's central counter-example, measured by execution rather than by
reading. A per-turn reminder hook walked the agent-session transcript
backward to find the current turn's edits, using the predicate "stop at the
most recent user message." **A tool result is recorded in exactly the shape
that predicate matches.** Across one hundred replayed real transcripts,
18,908 of 20,322 events of that shape (93.0%) were tool results, against
1,414 genuine human messages — and since every edit is followed immediately
by its own tool result, the backward walk hit a boundary before reaching a
single edit, on every turn that used a tool, which is every turn that edits.

The measured totals ([count-carries-predicate](../../_laws.md#count-carries-predicate)
honored — each number names what was counted and how):

| measured over 100 real transcripts | |
|---|---:|
| turns delimited by genuine human messages | 1,414 |
| turns that edited at least one file | 477 |
| …in which the hook's walk saw any edit | **0 (0.00%)** |
| individual file edits in those turns | 2,367 |
| …visible to the hook | **0 (0.00%)** |
| hook invoked directly on 12 real transcripts (up to 209 edits each) | exit 0, 12 of 12 |

Four lessons, each independently transplantable:

1. **The gate never saw its target**
   ([gate-sees-target](../../_laws.md#gate-sees-target)). The enforcement's
   input was a conversation transcript — a proxy for the change — and the
   proxy diverged from the target on 100% of real inputs. Every recorded
   dismissal in fifteen months was a dismissal of a message never sent; the
   per-session enforcement the project's instructions described was held up
   by nothing. The identical walk, byte for byte, sat in a second hook in
   the same directory — a dead gate copied is two dead gates.
2. **Empty success swallowed three distinct failures**
   ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).
   "No edits found," "could not read the transcript," and "the map will not
   parse" all exited 0. A gate that cannot distinguish *nothing happened*
   from *I could not look* reports the second as the first for as long as it
   exists — here, from the day it landed.
3. **Its own test suite certified the wrong world.** Thirty assertions, all
   green — over synthetic transcripts built as "one user message, then tool
   calls," containing not a single tool-result event, the shape 93% of
   production events wear. A fixture is a *theory of the input*; validate
   the theory against at least one captured real input before trusting
   anything the fixtures prove. (The general fixture law is quality-gates'
   [gate-liveness](../../quality-gates/techniques/gate-liveness.md); this is
   its most expensive measured instance.)
4. **The repair was deferred deliberately, and that is correct.** Fixing the
   walk flips two silent hooks into hooks that fire on most turns of the
   operator's live sessions — a behavioral change to a live surface, owed a
   scheduled decision, not a drive-by. The wrong fix is silent repair; the
   wrong non-fix is silent decay. The right move is what happened: register
   the defect, with its measurements, where the operator will schedule it.

## Read the change from the change record

The version-control diff is the only honest record of what changed. It knows
renames (both sides), deletions, and files that left a mapped area; a list
of editor-tool destinations knows none of that, and only exists if a
turn-boundary heuristic holds. The single most expensive assumption in the
measured implementation was that a conversation transcript is a reliable
record of change. Designs in order of strength:

- **commit/merge-stage check over the diff** — sees renames and deletions,
  leaves an artifact, runs where automation can enforce it;
- **working-tree diff at turn end** — acceptable for advisory nags; still
  VCS-derived, still rename-aware;
- **transcript or editor-event walks** — last resort; if used, the walk's
  boundary predicate must be validated against captured real events, and an
  empty result must be distinguishable from a failed walk.

## Satisfy on the named target

The nag names a specific document; the satisfaction check must accept only
that document. The measured implementation printed the exact target and then
accepted *any* file under the docs directory prefix — and over 761 real
commits where mapped source and some feature doc moved together, only 348
touched the doc the entry named. **54.3% of satisfactions were the wrong
document.** A prefix-shaped satisfaction converts a specific, actionable
obligation into one that is most cheaply discharged by accident.

## The dismissal protocol: legitimate, and recorded

Internal-only changes — refactors, bug fixes without behavior shift,
generated code — owe no documentation, and the enforcement must offer a
first-class dismissal: one short sentence naming *why* ("internal-only, no
doc update needed"), never silence. But an advisory nag whose dismissals
leave no artifact is a teaching device, not a gate: **a dismissal rate that
is recorded nowhere cannot be counted, improved, argued about, or even
known.** Write the verdict — satisfied, dismissed-with-reason, ignored —
somewhere durable (a ledger line, a commit trailer, a counter), and put the
binding ratchet at a stage that leaves artifacts anyway. In the measured
system the dismissal rate was unknowable for a structural reason worth
remembering — the nag wrote to a stream and the reply was prose in a
transcript — and moot for a humbling one: the numerator had been zero since
the hook landed.

## Prove it fires before trusting it

Everything above is design; this is the acceptance test. Before a
same-change enforcement is believed: seed a violation — edit mapped source,
touch no doc — and watch the nag arrive **through the real invocation path**,
not the checker run by hand. "Has never fired" and "cannot fire" are
indistinguishable from outside; the seeded failure is the only cheap
experiment that separates them, and the measured system would have failed it
on day one, fifteen months before the replay finally asked.
