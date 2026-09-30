---
subject: media-playback
evidence:
  - src/features/plugins/radio/components/RadioFooter.tsx                       # dual-engine reconciler: desired-state sync per engine, 8s watchdog armed per transition + disarmed on PLAYING, session blacklist seeded by fatal errors AND watchdog stalls, skip budget capped at station track count, single-pipeline crossfade with crossfadingRef volume ownership
  - src/features/plugins/radio/hooks/useRadioState.ts                           # backend-owned authoritative state echoed over events; nowPlaying refetch keyed by track identity (station id + cursor), not by event arrival
  - src/features/plugins/radio/hooks/useYouTubePlayer.ts                        # the foreign-frame engine class: message-bridge handle, numeric state/error dialects translated at the boundary, global script singleton chaining the prior ready hook, destroy-on-teardown
counter_evidence:
  - src/features/onboarding/components/useTourNarration.ts                      # minted in-memory URLs never revoked — creation without a reaper; registered under the voice-io deviation anchor (w4-voice-io), cited here, not re-registered
deviations:
  - w7-media-playback   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Media Playback - evidence

How this codebase measures against the [`media-playback`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
