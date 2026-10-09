---
subject: feed
evidence:
  - src/api/pipeline/teamChannel.ts                                        # ChannelCursor {at,id}: composite exclusive keyset cursor + per-kind LIMIT pushdown so one chatty source cannot starve a page
  - src-tauri/src/commands/teams/team_channel.rs                           # the server fan-out: four sources, per-source limits, namespaced-id tiebreakers, mirrored re-rank
  - src/features/overview/sub_timeline/libs/useLensFeed.ts                 # client comparator copied from the server rank (documented why) + mergeHorizon so an under-paged source cannot hole the timeline
  - src/features/fleet/monitor/channels/conversationModel.ts               # consecutive-run clustering by causal parent; cluster keyed by oldest member, anchored at newest; the flat Stream deliberately unclustered beside it
  - src/features/overview/sub_activity/components/GlobalExecutionList.tsx  # the loading-v2 reference feed: ghost-under-chrome, id-guarded row reveal (polling never replays), per-context scroll restore
  - src/features/overview/sub_events/components/EventLogList.tsx           # detached end-reached load-older trigger + the honest "N+" total when the server has more
  - src/stores/slices/pipeline/channelSlice.ts                             # per-team last-seen watermark persisted; countUnread DERIVED by comparison (predicate excludes the reader's own posts); mergeHorizon; id-dedupe at both merge doors
  - src/features/home/sub_welcome/lib/sinceLeftBriefing.ts                 # last-seen anchor persisted and frozen at entry; the since-you-left delta derived by comparison, never a maintained counter
  - src-tauri/src/engine/background/                                     # the named reaper: settings-driven retention_days + min-keep-per-entity floor, terminal rows only
counter_evidence:
  - src/features/fleet/monitor/channels/mergedFeed.tsx  # same items as useLensFeed — tiebreaker dropped; on a 45%-tied key the window cut falls to team iteration order
deviations:
  - w12-feed   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w7-chat-transcript   # jump-to-latest pill carries no unseen count; no per-thread reading-position restoration — the registered form of this subject's read-position gap
---

# Feed - evidence

How this codebase measures against the [`feed`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
