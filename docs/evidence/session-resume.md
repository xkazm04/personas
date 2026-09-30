---
subject: session-resume
evidence:
  - src/features/home/sub_welcome/lib/sinceLeftBriefing.ts       # last-seen anchor frozen before the heartbeat advances it; deltas derived from stores the boot fills; quiet on first run and on no news
  - src/features/home/sub_welcome/useResumeContext.ts            # ranked resume banner (failure > unfinished tour > last edit); validated at render; per-kind expiry; null renders nothing
  - src/features/home/sub_releases/useLiveRoadmap.ts             # fresh/cached/stale/unavailable as distinct statuses; bundled fallback; polling paused while unwatched
  - src/hooks/utility/interaction/useScrollRestoration.ts        # per-context scroll positions; new-context-to-top vs return-restores; virtualization-aware settle retry; test clear hatch
  - src/stores/slices/pipeline/channelSlice.ts                   # per-team seen-watermark advanced from the newest OBSERVED item on acknowledgment, not from the clock — the anchor's per-surface scope and its consumption species
counter_evidence:
  - src-tauri/src/engine/project_tracking/push.rs                # the OTHER away-digest: two enable gates whose intersection is empty by construction — zero digests in 99 days, and the silence was indistinguishable from a quiet week
deviations:
  - w12-session-resume   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Session Resume - evidence

How this codebase measures against the [`session-resume`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
