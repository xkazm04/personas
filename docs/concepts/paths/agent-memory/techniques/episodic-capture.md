---
layer: technique
subject: agent-memory
technique: episodic-capture
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Episodic capture

An episode is a bounded record of something that happened: an exchange, a task
run, an outcome, a correction. It is the middle layer's unit — durable enough
to outlive the session, humble enough to claim only "this occurred", never
"this is true". Episodes are the evidence layer that consolidation distills
and provenance cites; get their shape wrong and everything downstream is
built on mush.

## Boundaries are events, not clock ticks

The first design decision is what closes an episode, and the answer is:
**meaningful boundaries in the work, not intervals in time**. A task
completing or aborting. A conversation reaching a lull or a topic shift. An
outcome landing — success, failure, or a human correction. A clock-sliced
record ("everything from the last ten minutes") cuts through the middle of
meaning: the question in one slice, its answer in the next, the correction in
a third, and no slice can be judged on its own.

The test for a good boundary: the episode can be **summarized in one
sentence with an outcome** ("attempted X, hit constraint Y, resolved by Z").
If the candidate record needs three outcomes, it is three episodes; if it has
none, it is not yet an episode — it is working state still in flight.

## Bodies are distilled; raw evidence is pointed to

An episode carries two things with different jobs:

- **A distilled body** — participants, intent, what happened, outcome, and
  the few load-bearing specifics (the constraint discovered, the decision
  and its reason, the exact words of a correction). Written at capture time,
  while context is cheap, at the altitude consolidation will need: claims
  about the event, not a replay of it.
- **A pointer to the raw source** — the transcript span, the run log, the
  artifact — for the rare consumer that needs to re-litigate what actually
  occurred.

The temptation resisted here is copying the raw material *into* the episode
"to be safe". That builds a second transcript store wearing episode
formatting, and every downstream budget (consolidation reading, recall
injection, retention) pays for the bulk forever. The inverse temptation —
storing only a pointer with no distilled body — is worse: it makes
consolidation re-read raw logs to extract meaning, which means the expensive
judgment is deferred to every future reading instead of performed once at
the one moment the context was already warm.

Excerpts are the honest middle: when specific wording is load-bearing (a
correction, a commitment, a quoted requirement), the episode quotes it
verbatim, bounded, inside the distilled body.

## Capture is generous; judgment is deferred

Write pressure at this layer is deliberately loose. Recording an episode is
cheap; the expensive resources — belief-store space and recall budget — are
guarded downstream by consolidation and decay. Importance *at capture time
is a guess*: the aside that seemed trivial becomes the key to a pattern
three weeks later, and the dramatic incident consolidates into nothing. So
the capture criterion is roughly "would a one-sentence summary of this be
non-empty?", and the layer relies on consolidation to be the strict judge
and on retention caps to bound the total.

Generous is not unconditional. Two filters apply at the door:

- **No pure mechanics.** Heartbeats, routine polling, uneventful
  housekeeping — records with no outcome distinguishable from their absence.
- **Sensitivity screening at write time, not read time.** Material that must
  not persist (secrets, content the human marked ephemeral) is excluded
  when the episode is written. A store cannot un-remember at read time;
  every future consumer would have to repeat the filter forever.

## Identity and immutability

Every episode gets an **identity minted at creation** — not its timestamp
(concurrent captures collide), not its position in a sequence (retention
pruning reorders), not a content hash (near-duplicate events are distinct
occurrences). Provenance links from consolidated beliefs point at these ids
for the life of the belief, so the id must survive every operation the store
undergoes — pruning, archival, export, re-import — per
[identity-survives-reuse](../../_laws.md#identity-survives-reuse).

Episodes are **records, and records do not get edited**. When an episode
turns out to describe events wrongly, the correction is a *new* episode that
references the old one; when a belief derived from it is wrong, supersedence
at the consolidated layer handles it. An editable history gives the system a
way to have always been right, which is precisely the property an evidence
layer must not have. The narrow exception is redaction — removing sensitive
content that escaped the write-time screen — which is an audited removal,
not a rewrite: the episode visibly carries the fact that redaction occurred.

## Retention is declared at the layer, not discovered in panic

Episodes are created continuously, so the layer declares its reaper up front,
per [creation-names-reaper](../../_laws.md#creation-names-reaper): a
retention horizon and caps, with one structural rule that overrides both —
**an episode cited by a live belief's provenance does not silently vanish**.
Pruning such an episode either archives it (retrievable, off the hot path)
or forces the belief question first: demote or re-ground the belief, then
reap the evidence. The mechanics live in
[decay-and-forgetting](decay-and-forgetting.md); the capture layer's
obligation is to write episodes whose ids and grounding make that discipline
possible at all.
