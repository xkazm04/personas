---
layer: application
subject: session-resume
technique: last-seen-anchors
stack: react
---

# Last-seen anchors in this repo — one global presence anchor, one per-team consumption watermark, and the engine that has neither

The subject's four ground-truth files live in `src/features/home/`, and its
counter-example lives in the Rust engine. This application walks the anchor
first because every other technique of the subject derives from it, then
covers the briefing, silence, place, freshness and offer manifestations that
sit on top.

## The global presence anchor — `sinceLeftBriefing.ts`

[`src/features/home/sub_welcome/lib/sinceLeftBriefing.ts`](../../../../../src/features/home/sub_welcome/lib/sinceLeftBriefing.ts)
holds the anchor at `localStorage["personas:home-last-seen"]` (`:21`) and
implements the technique's write and read protocol almost verbatim:

- **Heartbeat + departure + acknowledgment.** `HEARTBEAT_MS = 60_000`
  (`:22`); the effect at `:132-144` beats on mount, on the interval, on
  `beforeunload`, and on `visibilitychange` when `document.hidden`. `dismiss`
  (`:151-154`) writes `Date.now()` — the acknowledgment write.
- **Read-then-advance, structurally.** `useState<number | null>(() =>
  readLastSeen())` (`:115`) snapshots the anchor in a lazy initializer that
  runs during the first *render*, before any *effect* can beat. The comment
  above it says exactly why: "Freeze the previous-session anchor at first
  render, before the heartbeat below advances the stored value." The legacy
  composition (`session-delta-digest.md` §12.6) flagged this initializer as
  "load-bearing and looks like a stylistic choice"; the technique now says so
  generically.
- **Absent means first run.** `readLastSeen()` (`:87-96`) returns `null` on
  no key, non-finite, or non-positive — never epoch, never now — and
  `computeSinceLeftBriefing` (`:54`) maps `null` to `{ lines: [], firstRun:
  true }`.

**The anchor has one writer and two readers.**
[`src/features/home/sub_cockpit/briefing/useMorningBriefing.ts`](../../../../../src/features/home/sub_cockpit/briefing/useMorningBriefing.ts)`:55`
snapshots the same key with the same lazy-initializer trick, and its comment
(`:52-54`) states the coupling out loud: "child effects (the Welcome
heartbeat) advance the stored value before any parent effect gets to run."
Correct today, because the parent's render precedes the child's effect. It
depends on tree position: if `useSinceLeftBriefing` ever mounts in a
component that renders *before* the cockpit host, the morning briefing's
snapshot reads a freshly-beaten "now" and goes silent — the self-erasing bug
the technique describes, arrived at through component order rather than
through code order. Not a defect; a fragility worth a shared
`snapshotLastSeenOnce()` at module scope so both readers see one value
regardless of who renders first.

## The per-team consumption watermark — `channelSlice.ts`

[`src/stores/slices/pipeline/channelSlice.ts`](../../../../../src/stores/slices/pipeline/channelSlice.ts)
is the technique's *other species* and its *per-surface scope* in one:
`readLastSeen(teamId)` / `writeLastSeen(teamId, at)` (`:71-87`) keep one
anchor per team channel under a key prefix, and `markChannelSeen` (`:314-325`)
advances it to `state.items[0].at` — **the newest observed item's timestamp,
not the clock** — on explicit acknowledgment. This is the "advance from
observed data" form the legacy sync path called the strong one. Its
`writeLastSeen` failure path is honest about degradation ("Unread still
works this session; it just won't survive a restart") and breadcrumbs it
rather than shrugging.

Note the two anchors are independent: the channel's watermark never moves
because the Home heartbeat beat, and vice versa — the independence the
technique's "two species" section requires.

## The counter-example — the engine with two gates and a clock watermark

[`src-tauri/src/engine/project_tracking/push.rs`](../../../../../src-tauri/src/engine/project_tracking/push.rs)
is the app's *other* away-digest, and the legacy composition measured it at
**zero digests over ninety-nine days for ten subscribed projects**. Two
findings from it are folded into the techniques:

- **The watermark is a clock read** — `let consumed_through =
  chrono::Utc::now();` (`:315`), stamped *before* the await (the weaker
  correct form) with a fourteen-line comment (`:301-314`) that names the
  stronger form (max timestamp of consumed events) and why it is blocked
  (`TickSnapshot` carries no event timestamps). The technique's "two
  species" section is this comment, generalized.
- **Two enable gates whose intersection is empty by construction** —
  `ProjectTracker.enabled` is `Arc::new(AtomicBool::new(false))`
  ([`mod.rs`](../../../../../src-tauri/src/engine/project_tracking/mod.rs)`:63`),
  never persisted and never hydrated; the durable per-project
  `dev_tools_project_subscription.enabled` (`DEFAULT 0`) has no writer any
  user can reach. The technique
  [first-run-and-quiet-silence](../techniques/first-run-and-quiet-silence.md)
  carries this as "one durable enable switch at most, read at boot" and as
  the reason silence must be falsifiable.

## The briefing — derived, capped by its sample, quiet by construction

`computeSinceLeftBriefing` (`sinceLeftBriefing.ts:50-85`) is a pure function
over `homeRunsSample`, `alertHistory` and `pendingReviewCount` from the
overview store — the file header says it "issues NO new IPC of its own — it
only triggers the shared store fetches when cold" (`:5-7`), and the effect at
`:123-128` does exactly that (`primeHomeSpine`, `fetchPendingReviewCount`,
`fetchAlertHistory`, all TTL-guarded and deduped). Three lines, each with a
predicate: runs since anchor (with a failed sub-count), alerts since anchor,
approvals waiting **now** (the current-state exception the technique names —
the code comment at `:47-48` calls it out).

**Silence:** `visible = !dismissed && !firstRun && lines.length > 0` (`:156`).
First run renders nothing; no news renders nothing.
[`SinceYouLeftBriefing.tsx`](../../../../../src/features/home/sub_welcome/SinceYouLeftBriefing.tsx)
consumes it. `useMorningBriefing.ts` layers an LLM-composed briefing on top
with `deltaIsTrivial` / `composeQuietBriefing` and a once-per-app-session
latch (`briefingRan`, `:43`) with a test reset hatch (`:46-48`).

**The sample cap (legacy D4, still true).** The runs line filters
`homeRunsSample`, which is `listAllExecutions(RUNS_SAMPLE_LIMIT)` with
`RUNS_SAMPLE_LIMIT = 500`
([`homeSpineSlice.ts`](../../../../../src/stores/slices/overview/homeSpineSlice.ts)`:47,:109`).
The legacy composition replayed this against 2,188 real execution timestamps:
the shortest interval containing 501 runs was 53.4 hours, and the worst
seven-day window held 1,158 — the briefing would render "500" where the truth
is 1,158, with no "+". This is the
[delta-briefings](../techniques/delta-briefings.md) rule "never render a
sample-bounded count as a total."

## The offer — `useResumeContext.ts`

[`src/features/home/sub_welcome/useResumeContext.ts`](../../../../../src/features/home/sub_welcome/useResumeContext.ts)
is the ranked single signal: `failure` (24 h, `FAILURE_MAX_AGE_MS`, `:45`) >
`tour` (paused, unfinished, not dismissed — and *only when the tour panel is
not already showing*, `:156-157`) > `edit` (7 days, `LAST_EDITED_MAX_AGE_MS`,
`:44`); `null` renders nothing. It reads store state only ("no IPC calls are
issued", `:19-20`), validates at render (`personas.find(...)` before offering
the edit, `:180-181`), clamps negative age from clock skew (`:132-133,:140`),
and — the detail the technique now carries — keeps an in-process subscriber
list (`:52-73`) because a same-window `localStorage` write fires no `storage`
event, so a second edit of the same persona would otherwise go unnoticed.
[`ResumeBanner.tsx`](../../../../../src/features/home/sub_welcome/ResumeBanner.tsx)
renders it inline above the hero, not as a modal.

## Freshness — `useLiveRoadmap.ts`

[`src/features/home/sub_releases/useLiveRoadmap.ts`](../../../../../src/features/home/sub_releases/useLiveRoadmap.ts)
declares `'loading' | 'fresh' | 'cached' | 'stale' | 'unavailable'` (`:24`)
and its header (`:5-15`) is the technique's cause-not-age split verbatim:
`cached` = "disk cache because it was still fresh enough to skip the network.
Healthy path"; `stale` = "disk cache as a *rescue* because the network attempt
failed. Degraded path"; `unavailable` = "no cache AND network failed. Caller
falls back to the bundled roadmap content." The transition guard is real:
`setStatus((prev) => (prev === 'loading' ? 'unavailable' : prev))` (`:61`) —
unavailable is reachable only from never-had-content. Polling: `ROADMAP_POLL_MS`
= 1 h via `usePausableInterval(..., active)` where `active` is
`sidebarSection === 'home' && homeTab === 'roadmap'` (`:81-82`), with the
comment naming the keep-alive-host trap ("this hook's HomeReleases host stays
mounted when the user switches away, so an unguarded interval would keep
polling off-screen"). The [status pill](../../../../../src/features/home/sub_releases/LiveRoadmapStatusPill.tsx)
renders cached amber and stale red (`:75-76`), and hides the refresh control
under `unavailable` (`:88`) — the bundled snapshot has nothing to refresh
against.

## Place — the layers, declared and undeclared

- **Route** — the shell restores last section (owned by app-shell's
  navigation model; see its application).
- **Scroll, per-section in the shell** —
  [`Sidebar.tsx`](../../../../../src/features/shared/chrome/sidebar/Sidebar.tsx)`:87-101`
  keeps a `Map<section, scrollTop>` for the level-2 nav and re-applies on
  section change (process lifetime, ref-scoped).
- **Scroll, per-context in lists** —
  [`src/hooks/utility/interaction/useScrollRestoration.ts`](../../../../../src/hooks/utility/interaction/useScrollRestoration.ts)
  is the technique's scroll layer in full: a caller-composed context key
  (`:9-11`), new-context-to-top versus return-restores (`:13-14`), the
  virtualization-aware re-apply across `MAX_RESTORE_FRAMES = 40` frames
  (`:46`, `:98-119`), the `restoringRef` mute on the save path (`:60-62`),
  and a `clearScrollRestoration` test hatch (`:176-179`). Adopted by the four
  shared list primitives (`UnifiedTable`, `GroupedVirtualList`,
  `TemplateVirtualList`, and one more) rather than per surface — the right
  seam. Its `globalThis` comment cites "the executionBuffers / eventBus
  singletons" (`:37`), neither of which exists under that name (documented in
  the repo's HMR-singleton path); harmless, but the precedent named is a
  fiction.
- **Active entity** — the resume banner's `edit` kind is this layer, offered
  not imposed.
- **Per-thread reading position (the undeclared cell)** — the chat-transcript
  subject's forge recorded "no per-thread reading-position restoration"
  (`golden-path-deferred-fixes.md#w7-chat-transcript`). The shell restores
  the section, the lists restore their scroll, and the thread dumps the
  reader at the top — the exact hole the
  [layered-place-restoration](../techniques/layered-place-restoration.md)
  audit exists to find.
- **In-progress work** — the tour's step is kept and offered; drafts are the
  draft-editing subject's territory (its forge notes `beforeunload` prompts
  but never saves).

## Deviations observed (standards kept; not fixed here)

- **Heartbeat is not presence-gated.** `beat` runs on the 60 s interval
  regardless of `document.hidden` (`sinceLeftBriefing.ts:133-135`); only the
  *hide transition* beats deliberately. Under the keep-alive Home page an
  overnight minimized window advances the anchor all night, and the morning
  "since you left" derives from a minute ago. The technique's presence-honesty
  rule; the fix is a `document.hidden` (or focus) check inside `beat`.
- **One anchor, two readers, coupled by tree order** — see above; a shared
  module-scoped snapshot removes the coupling.
- **Sample-bounded count rendered as a total** — legacy D4; `RUNS_SAMPLE_LIMIT
  = 500` with no "+" on the pixel and no source-side count door.
- **No liveness mark for the briefing pipeline** — legacy D5; a session that
  showed nothing and a session where the hook never mounted are the same
  observation. `useMorningBriefing`'s `briefingRan` is per process, not
  persisted.
- **The engine digest** — legacy D1/D2/D6, all still true at `push.rs:315`,
  `mod.rs:63`; recorded here as counter-evidence, not re-derived.
