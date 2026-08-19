---
layer: technique
subject: time-travel-replay
technique: transport-and-time-mapping
status: forged
laws: [count-carries-predicate]
shared_with: []
---

# Transport and time mapping

The transport is the contract between the viewer's hand and the record's
clock: play, pause, seek, speed. Underneath every control sits one function —
the **mapping from replay position to record time** — and the technique's
discipline is keeping that mapping honest while making the playback humane.

## The mapping

Three clocks, one function:

- **record time** — the immutable stamps in the record;
- **replay time** — the playhead's position along the recorded span;
- **viewer time** — wall-clock seconds spent watching.

Play advances replay time; the speed setting is the exchange rate from
viewer time (`1s watched = speed × 1s of record`); seek assigns replay time
directly. The playhead's position **must always be expressible as a record
timestamp** — the moment it can't be (because the timeline was resampled,
normalized, or beautified into unit-less positions), every timestamp shown
during playback becomes decorative, and pausing "at 14:03:07" no longer
means anything. Implementation follows from that constraint: advance the
playhead by elapsed viewer time × speed on each tick, and release every
timeline item whose record time the playhead has passed. Items are released
**in order, exactly once per crossing** — a tick that jumps 400ms of record
time releases everything inside the window, and a paused playhead releases
nothing, no matter how many render frames elapse.

## Dead air: compress with a marker, never silently

Real runs are mostly waiting — a model call, a queue, an idle stretch.
Played at 1×, honesty produces an unwatchable product; played with gaps
silently removed, a watchable product lies about tempo, and the viewer's
sense of "what took long" — often the very question replay was opened to
answer — is falsified. The resolution is **disclosed compression**:

- gaps beyond a threshold play at a capped duration (a few seconds of
  viewer time), with a visible in-flow marker: "⏭ 18m idle skipped";
- the scrubber renders compressed regions distinctly, so the axis never
  pretends the run was dense;
- every elapsed figure states which time it is quoting — "12m run · plays
  in 3m" — because a duration that travels without its predicate will be
  quoted as the wrong one
  ([count-carries-predicate](../../_laws.md#count-carries-predicate));
- compression is a **playback policy, not a timeline edit**: the derived
  timeline keeps true record time, and turning compression off restores
  honest tempo without re-deriving anything.

## The transport state machine

Small, closed, and explicit: `idle → playing ⇄ paused → ended`, with `seek`
legal from any state and returning to it. The states that get skipped in
naive implementations are the ones that carry the contract:

- **idle** (opened, not yet playing) shows duration, coverage, and
  disclosures *before* motion starts — the viewer consents to the fiction
  knowing its gaps.
- **seek during play** resumes playing from the target; **seek while
  paused** stays paused — the gesture moves the viewpoint, never toggles
  intent.
- **ended** is not closed: the playhead sits at the end, the whole run is
  scrubbable, and replaying is one gesture. The second viewing — the one
  where the viewer knows what to look for — is the point of the feature.
- speed changes take effect **from the playhead forward**; they never
  rescale positions already shown.

Backward seek deserves its own sentence: it is a *viewpoint* operation, a
re-presentation of earlier state — never an inverse execution, and never a
mutation of anything outside the replay surface. A transport whose rewind
writes state has crossed into undo territory and must be redesigned, not
documented.

## Borrow the grammar, keep the meaning

Play/pause iconography, space-to-toggle, arrow-key stepping, the scrubber
with hover preview, speed presets — this grammar is already owned by media
surfaces ([media-playback](../../media-playback/media-playback.md)), and
viewers arrive trained on it. Replay adopts the grammar wholesale and adds
only what media lacks: gap markers, coverage shading, and record-timestamp
display at the playhead. What must *not* be borrowed is media's tolerance
for approximate position — a video seeking a keyframe early is invisible; a
replay claiming the playhead is at a timestamp it isn't puts a false time on
every visible datum. Position display follows the mapping exactly, or the
transport is decoration.
