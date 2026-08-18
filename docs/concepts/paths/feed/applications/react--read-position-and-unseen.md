---
layer: application
subject: feed
technique: read-position-and-unseen
stack: react
---

# Read position and unseen — two anchors, one half-adoption (React + Zustand)

The technique's core rule — *store an anchor, derive the count* — is adopted
twice in this repo, in two shapes, and violated by omission in a third surface
that has the scroll contract but no count. Read them together.

## Adoption 1 — the team channel watermark (`channelSlice.ts`)

`src/stores/slices/pipeline/channelSlice.ts` keeps one anchor per team:

```ts
function readLastSeen(teamId: string): string | null {          // :71-77
  return localStorage.getItem(LAST_SEEN_PREFIX + teamId);
}
function writeLastSeen(teamId: string, at: string): void { … }  // :79-87
```

and **derives** the badge:

```ts
export function countUnread(state: ChannelTeamState): number {  // :99-106
  let n = 0;
  for (const i of state.items) {
    if (i.kind === "directive") continue;                       // the user's own posts
    if (state.lastSeenAt !== null && i.at <= state.lastSeenAt) continue;
    n += 1;
  }
  return n;
}
```

Three technique clauses visible in ten lines: the anchor is the durable thing
(`localStorage`, per team); the count is a comparison over items, never a
maintained integer; and the **count carries its predicate** in code — the doc
comment (`:89-97`) states that bridged `slack` rows *do* count and the reader's
own directives do not ("you never have unread mail from yourself"). A
never-read team counts as fully unread, deliberately.

`markChannelSeen` (`:313-325`) is anchor-set-to-head: it writes the newest
item's `at` and short-circuits when unchanged — idempotent, one write. The
private-mode write failure is breadcrumbed, not swallowed (`:82-85`), so a badge
that stops surviving restarts leaves a trace.

**Where it falls short of the technique — the anchor is a bare timestamp.**
`lastSeenAt` is `at` alone and the comparison is `i.at <= lastSeenAt`. That
`at` is the second-resolution key `team_channel.rs` projects, which ties at
**45.2%** on `team_channel_messages` (worst tie 7 — `chronological-feed.md`
§0). Two rows sharing the watermark's second, one seen and one arriving after
`markChannelSeen`, are indistinguishable: the later one is `<= lastSeenAt` and
counts as read. The keyset cursor forty lines below (`loadOlderChannel:238-244`)
already carries the composite `{ at, id }` for exactly this reason and comments
it; the watermark did not get the same upgrade. The technique's rule — the
anchor is the *tuple*, the same composite the cursor uses — is the fix, and it is
one field. **Not registered anywhere in deferred-fixes today**; reported upward
in the composer's report rather than edited into that file.

## Adoption 2 — the frozen-anchor briefing (`sinceLeftBriefing.ts`)

`src/features/home/sub_welcome/lib/sinceLeftBriefing.ts` is the technique's
*sequencing* rule made concrete. The hook reads the anchor once and freezes it:

```ts
// Freeze the previous-session anchor at first render, before the heartbeat
// below advances the stored value for the next session.
const [anchor] = useState<number | null>(() => readLastSeen());   // :113-115
```

then advances the *stored* value on a 60s heartbeat plus `beforeunload` /
`visibilitychange` (`:130-143`) so a crash replays at most a minute, while
`computeSinceLeftBriefing` (`:50-`) derives every "since you left" line by
comparing item timestamps against the frozen `anchor` — never against the
heartbeat's live value. Had the memo depended on the stored value, the
surface's own heartbeat would zero the delta it was about to display; the
`useState` initializer is what makes that race unspellable. `firstRun`
(`:54`) — no anchor at all — renders nothing rather than "everything is new".

Note the anchor here is an epoch-ms number rather than an ordering tuple. That
is acceptable for *this* consumer because it compares against three
independent series (runs, alerts, approvals) that are not one feed with one
total order — a since-timestamp is the right shape for a cross-store delta.
It would be the wrong shape for a single feed's watermark, which is Adoption
1's situation.

## The half-adoption — a jump pill with no count

`src/features/plugins/companion/useChatScroll.ts` implements the scroll
contract cleanly: `atBottom` tracked within a band (`:30-40`), auto-scroll only
while pinned (`:63`), and the doc comment (`:13-19`) hands the caller a
"jump to latest" affordance off `atBottom`. What the caller gets is a boolean.
There is no held-arrivals count anywhere on that path, so the affordance says
"there is something below" and never "3 new". Registered as part of
`golden-path-deferred-fixes.md#w7-chat-transcript` — *"jump-to-latest pill
carries no unseen count - no per-thread reading-position restoration"* — and
cited by this subject's `deviations:` because it is the same gap seen from the
feed side: the scroll ethic without the read-position instrument.

## Where the technique lands, one line each

| Technique clause | Site |
|---|---|
| Anchor stored, count derived | `channelSlice.ts:71-87` + `countUnread:99-106` |
| Count carries its predicate | `countUnread` doc `:89-97` (slack in, own directives out) |
| Mark-all-read = anchor-set-to-head, idempotent | `channelSlice.ts:313-325` |
| Anchor is the ordering tuple, not a bare timestamp | **violated** — `lastSeenAt: string`, `i.at <= lastSeenAt` on a 45%-tied key |
| Freeze at entry; advance the store separately | `sinceLeftBriefing.ts:113-115` vs `:130-143` |
| No anchor → render nothing, not "all new" | `sinceLeftBriefing.ts:54` |
| Durable across restart | `localStorage` in both; write failure breadcrumbed at `channelSlice.ts:82-85` |
| Jump affordance carries a count | **absent** — `useChatScroll.ts` exposes `atBottom` only (deferred-fixes `#w7-chat-transcript`) |
| Multi-device convergence by max | not applicable — anchors are device-local (`localStorage`); if identity ever roams, take the max |
