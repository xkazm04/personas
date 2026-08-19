---
layer: technique
subject: cicd-monitoring
technique: deployment-history
status: forged
laws:
  - count-carries-predicate
  - derivation-names-recomputation
shared_with: []
---

# Deployment history

Live status answers *what is happening*; history answers the question the
user actually brought to the monitor: **"is this normal?"** A red run
means one thing after six green ones and something else entirely as the
fourth failure in a row. A 12-minute build is fine if builds take 12
minutes and an incident if they take 4. Live state alone cannot rank
either; the monitor that shows only "now" outsources normality judgment
to the user's memory, which is exactly the fallible instrument the
monitor exists to replace.

## Two shapes, one derived from the other

History has two renderings, and keeping their relationship straight is
most of the design:

- **The run log** — append-only: every run with its result, duration,
  trigger, ref, and actor. This is the ground truth; the provider owns
  it, the monitor windows into it.
- **Current-state-per-environment** — for deploy targets: what version is
  where, since when, put there by which run. This is a *derivation* —
  the latest successful deployment per environment, folded out of the
  run log — and per
  [derivation-names-recomputation](../../_laws.md#derivation-names-recomputation)
  it must name how it is recomputed: from which event set, with which
  fold (latest-successful-per-target). When the provider serves the
  derived view directly, prefer the provider's — it sees events the
  monitor's window may have missed; when the monitor computes its own,
  the recomputation is a stated rule, not an accretion of update
  handlers.

The environment view is what turns the monitor from a build watcher into
a deploy watcher: "what is on staging" is the single most-asked question
in the domain, and a monitor that can answer it beats one that merely
lists green runs.

## Normality cues

Beside every live run, the cheap statistics that make deviation visible:

- **Duration vs typical** — elapsed against a recent-window median for
  the same pipeline; a run at 2× typical is flagged *while still
  running*, which is the earliest possible hang detection an observer
  can offer.
- **Streaks** — consecutive results as a glyph strip; four reds in a row
  is a different fact than a red, and the strip shows it pre-attentively.
- **Fixed / broken markers** — the transition classes from
  transition-detection, persisted: "first green after 5 red" and "first
  red after 40 green" are the sentences an on-call human actually
  thinks in.

Every one of these carries its predicate, per
[count-carries-predicate](../../_laws.md#count-carries-predicate): a
success rate without its window and filter ("92% — of what, since
when, on which ref?") is decoration that will be quoted as fact. The
windows are declared beside the number, and comparisons hold ref and
pipeline constant — folding feature-branch runs into the main-line
success rate manufactures noise in both directions.

## Terminal is immutable — cache accordingly

A finished run never changes. History pages are therefore cached hard,
keyed by run id, effectively forever — none of the liveness polling that
live status needs applies here (the client-fetch-cache subject owns the
mechanics; this is its easiest case). The only volatile row is the
newest page boundary, where new runs append; refresh windows from the
top, never re-fetch the tail. This asymmetry is the budget's best
friend: the expensive surface (long history) is the static one, and the
dynamic surface (the head) is one page.

One honesty rule inherited from the provider relationship: history
windows are *windows*. Providers cap retention and page depth; the
monitor's "last 50 runs" is not "all runs", and any statistic computed
over a window says so — the predicate again.

## Decision rules

- Run log is ground truth; environment state is a named derivation of
  it; never hand-maintain the derived view.
- Show duration-vs-typical live, not post-hoc — the hanging run is the
  case where the cue pays.
- Streaks and fixed/broken markers over raw result lists; humans read
  transitions, not tables.
- Every rate, median, and streak carries window + filter, rendered, not
  implied.
- Cache terminal runs by id indefinitely; poll only the head page.
