---
layer: application
subject: media-playback
technique: engine-adapters
stack: react
---

# The radio's dual-engine layer — where the repo meets the technique, and where it doesn't

The radio plugin plays two source kinds through two engines with opposite
shapes: direct streams through a native `<audio>` element, and a licensed
catalog through the YouTube IFrame player — the technique's foreign-frame
class in its purest form. The pieces:

- `src/features/plugins/radio/hooks/useYouTubePlayer.ts` — the foreign-frame
  adapter: message-bridge handle, one-time global script injection, shadow
  access only;
- `src/features/plugins/radio/hooks/useRadioState.ts` — the state echo: the
  Rust backend owns authoritative `RadioState`, the renderer subscribes to
  `radio:state` events and mirrors;
- `src/features/plugins/radio/components/RadioFooter.tsx` — the reconciler
  that translates authoritative state into imperative engine calls, plus the
  watchdog / blacklist / crossfade machinery.

## Confirmed against the technique

- **The engine is the authority; the renderer is a mirror.** `useRadioState`
  fetches the initial snapshot, then applies `radio:state` echoes as the
  *only* writer (`useRadioState.ts:68-78`). Reconciliation is by content:
  `trackKey()` (`:27-31`) derives a track identity from station id + cursor
  index, and `nowPlaying` refetches only when that identity changes — a
  stale or repeated echo does not churn metadata.
- **Desired-state reconciliation, not command forwarding.** Both engine-sync
  effects in `RadioFooter` compare desired against actual and issue only the
  delta: the stream effect swaps `audio.src` only when
  `currentStreamUrlRef.current !== desiredUrl` (`:258-272`), the YouTube
  effect calls `loadVideo` only when `currentVideoIdRef.current !== videoId`
  (`:303-344`); replayed state events are no-ops. This is where the
  technique's "reconciler, not forwarder" rule was measured.
- **The foreign-frame dossier, item by item** (`useYouTubePlayer.ts`):
  numeric state and error dialects documented and translated at the boundary
  (`:16-19`; `RadioFooter.tsx:192-230` maps codes to the canonical
  playing/paused/buffering vocabulary and classifies errors fatal vs
  transient via `isFatalYouTubeError`); every handle method wraps the bridge
  call in try/catch because the player may not be ready (`:138-166`);
  readiness is an event, and the global `onYouTubeIframeAPIReady` hook is
  chained (`prev?.()` then resolve, `:67-75`) so a second consumer cannot
  orphan the first; teardown calls `destroy()` and nulls the handle
  (`:170-177`).
- **Watchdogs on awaited transitions.** `PLAYBACK_WATCHDOG_MS = 8000`
  (`RadioFooter.tsx:32`); armed when a load/play is issued (`:266`, `:276`,
  `:334`), disarmed when the engine echoes PLAYING (`:194-196`) or the user
  pauses, and expiry *declares* the failure: toast + stop for streams,
  blacklist + skip for the foreign player's silent-stall variant
  (`:334-342` — "this watchdog handles the silent-stall variant", the
  never-ready class the engine will not report).
- **Blacklist with a skip budget.** Session-scoped `failedVideoIdsRef`
  seeded by both fatal errors (`:216-223`) and watchdog stalls (`:339-340`);
  known-bad ids are skipped silently (`:318-327`) under `skipBudgetRef`,
  capped at the station's track count so an entirely broken station
  terminates, and replenished on every successful PLAYING (`:197-199`).
  The source-resilience technique's skip-budget paragraph is this code,
  generalized.
- **Single-pipeline crossfade with volume ownership.** `animateYtVolume`
  (`:372+`) runs the fade-out-before-end / fade-in-after-start
  approximation (constants at `:38-41`), and `crossfadingRef` makes the
  ordinary volume-sync effect yield while a fade owns the parameter
  (`:355-366`) — the two-writers-on-volume hazard, solved by an explicit
  ownership flag.
- **Engine switch pauses the deselected engine.** Switching station kind
  pauses the other engine and clears its current-source ref
  (`:247-252`, `:289-297`), so exactly one engine is audible.

## Deviations, kept against the standard

1. **The adapter seam lives in the surface component.** `RadioFooter`
   branches on engine identity (`isStream` / `isYoutube`, `:146-148`) and
   hosts both engine-sync effects, the watchdog, and the blacklist inline —
   734 lines of footer. There is no transport contract object; a third
   engine (or a second surface wanting playback) means editing the footer.
   The technique's "one contract, adapters behind it" shape is present in
   spirit (the YT handle is a real adapter) but the native-element half and
   all the policy live unextracted in the component.
2. **Capability difference is handled by parallel code paths, not
   declaration.** Streams have no duration/seek and the catalog engine does;
   the surface encodes this by branching on station kind (progress bar only
   for the YouTube path, `:117-118`) rather than by consulting a declared
   capability — the same knowledge, but stored where a new engine cannot
   inherit it.
3. **Switching away from the foreign frame pauses rather than reaps it.**
   The player instance and its frame stay alive off-screen when the user
   moves to a stream station (`:293-296`); deliberate (instant switch-back,
   avoids re-running the gesture/handshake cost) but undeclared — the
   resource-lifecycle technique would have the pool's warm-instance policy
   stated at the site rather than implied.
4. **One watchdog deadline for two transitions.** Load-and-play for a cold
   stream and play for an already-cued video share the single 8s constant;
   the transport-contract technique tunes per transition. At this product's
   scale one constant is defensible — noted because the constant's name
   (`PLAYBACK_WATCHDOG_MS`) does not say which transitions it times.
