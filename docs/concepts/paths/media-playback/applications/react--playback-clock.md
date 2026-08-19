---
layer: application
subject: media-playback
technique: playback-clock
stack: react
---

# The media studio's timeline clock — where the repo meets the technique, and where it doesn't

The authoritative clock is
`src/features/plugins/artist/sub_media_studio/hooks/useTimelinePlayback.ts`:
a rAF-driven engine whose own header comment states the technique's thesis —
"`currentTime` is intentionally NOT React state — storing it in state would
trigger a full re-render on every rAF tick (≈60/s), which made the original
media studio unusably laggy." Time lives in `timeRef` (`:34`), the driving
loop advances it by wall-clock delta (`(now - lastFrameRef.current) / 1000`,
`:61-64` — not a per-tick constant), and consumers get a stable
`PlaybackEngine` handle (`getTime` / `getPlaying` / `subscribe`, `:130-143`)
whose identity never changes. Reactive state holds only the human-speed
facts: `playing` and `looping` (`:31-32`).

## Confirmed against the technique

- **One clock, one holder.** No consumer keeps its own position variable;
  every surface in the studio reads or subscribes to the same `timeRef`
  through the engine handle. Seek is a write to the clock plus a notify
  (`seek`, `:116-123`), clamped to the composition's bounds.
- **Subscription begins with a synchronous sample.** `subscribe(cb)` calls
  `cb(timeRef.current)` before returning the disposer (`:134-139`), so a
  late-mounting consumer paints current truth, not zero. The disposer is
  returned from the same call — creation names its reaper — and unmount
  cancels the rAF (`:145-149`).
- **Commit-point discipline for flags the loop reads.** `loopingRef` and
  `totalRef` are synced in `useLayoutEffect` (`:49-52`) with an explicit
  comment on why: under React 19 concurrent rendering, render bodies run
  speculatively and may be discarded; a rAF tick reading a ref written
  mid-render could observe a state that was never committed. This is the
  technique's "write shared flags only at commit points" rule, learned here
  first.
- **The fan-out spectrum, live — each consumer pays only for its fidelity:**
  - `TimelinePanel.tsx:208` — frame-rate consumer writing *direct output*:
    playhead `transform` and auto-scroll, zero state, zero re-renders;
  - `PlaybackControls.tsx:41-50` — coarse consumer: readout state throttled
    to ~10fps by a `lastUpdateRef` gate, with the comment "keeps React work
    off the hot path";
  - `BeatSidebar.tsx:39-46` — *derived-value* consumer: subscribes at tick
    rate but `setActiveId` only when the active beat id actually changes,
    so render frequency equals beat-change frequency, not frame rate;
  - on-demand reads via `engine.getTime()` at interaction time
    (`PlaybackControls.tsx` skip-back button).
- **Pause freezes, stop resets, replay-from-end.** `pause` cancels the rAF
  and keeps time (`:96-103`); `stop` additionally zeroes the clock and
  notifies (`:105-114`); `play` at end-of-composition restarts from zero
  (`:86-89`). The pause/stop distinction the transport contract requires is
  present at the clock layer.

## Deviations, kept against the standard

1. **`CompositionPreview.tsx:59` subscribes with raw `setCurrentTime`** —
   the one consumer that converts every clock tick into component state, in
   the component that renders the stage's `<video>`. Every memo below it
   (`activeVideo`, `videoSrc`, `videoOpacity`, `:95-118`) recomputes per
   frame. It is scoped to itself, so it is the sanctioned-but-weakest form
   on the technique's spectrum; the sibling consumers show the two stronger
   forms it could take (direct style writes for opacity; derived-value
   state for the active clip).
2. **The preview's element identity defect sits next door.** The legacy
   composition (`docs/concepts/golden-paths/media-viewer.md` §7.B) measured
   `CompositionPreview.tsx:366` rebinding `<video src>` across clip
   boundaries with no identity key, so the previous clip's transport state
   (position, rate, mute, buffers) survives under the new clip's bytes —
   and the threshold-based `currentTime` correction at `:120-151` then
   papers over the symptom as a visible seek jump. Not a clock defect —
   the clock is right; the element the clock drives is reused without
   restoration (the media-resource-lifecycle technique's pooling rule).
3. **No engine-time reconciliation, by design and undeclared.** This clock
   is application-driven (the composition has no single backing engine),
   and the `<video>` element is *slaved* to it via the threshold seek in
   `CompositionPreview` — but the slave-correction thresholds (0.3s
   playing / 0.03s paused) are local constants with no stated drift
   policy. The technique's slew-vs-snap decision exists here only as an
   implicit snap; fine at this scale, but the policy is discovered by
   reading the correction code, not declared where the clock lives.
