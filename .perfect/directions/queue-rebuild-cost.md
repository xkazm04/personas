---
slug: queue-rebuild-cost
type: perfect/direction
context: "[[agents-quick-answer]]"
lens: optimization
status: accepted
size: M
proposed: 2026-08-05
accepted: 2026-08-05
shipped: 2026-08-05
commit: 7c0a46793 (tests) + 07f1b0206 (source, swept by a concurrent session)
---
## What & why

Every 30 seconds, with the deck merely open and untouched, the app rebuilds and re-sorts the
whole queue, re-parses the same JSON once per member project, and re-serialises the session
record. None of it is triggered by the user doing anything.

## Evidence

- `projectQueue` re-runs on every poll — all `useMemo` deps identity-fragile
  (`useUnifiedTriage.ts:575-578`); `setLocalReviews(raw.map(shapeReview))` builds a new array
  every poll (`useMonitorData.ts:223`).
- Comparator does two `Map.get` + `localeCompare` on ISO timestamps per comparison, and
  re-tests the focus pin on every pair (`triageQueue.ts:119-129`, `triageTypes.ts:357`).
- `adoptReach` calls `parseApplicability` inside `.filter` → P practices × M members
  `JSON.parse` calls per rebuild (`triageReach.ts:84-92`).
- Three `saveTriageSession` effects, all firing on mount, each a read-modify-write
  `JSON.stringify` of the whole record incl. up to `MAX_DRAFTS × MAX_DRAFT_CHARS`
  (`useUnifiedTriage.ts:341-349`; `triageSession.ts:184-213`).
- `listManualReviews(undefined, 'pending')` — unbounded (`useMonitorData.ts:222`).
- `useMonitorData.ts:186` subscribes to `activeProcesses` (event-driven) and returns it;
  `usePendingInteractions` drops it — re-renders for data nobody reads.
- `TriageCard` is the only memoized component in `deck/` (`TriageCard.tsx:254`). Rail, top
  bar, action bar and both flanks re-render per keystroke. `triageRenderCost.test.tsx`
  covers only the card, with a harness that never passes `answerSlot`.

## Acceptance criteria

- [ ] Sort keys precomputed; no `localeCompare` in the hot comparator.
- [ ] Focus pin hoisted out of the comparator (partition, not a per-pair test).
- [ ] Applicability parsed once per practice, not once per member.
- [ ] Session persistence coalesced into one write; no mount-time write storm.
- [ ] Review query bounded.
- [ ] Render-cost coverage extended past `TriageCard` to the deck chrome.

## Risks / non-goals

The sort must stay a consistent total order — the pin partition must not reintroduce
instability. Do NOT change queue semantics: `MAX_SKIP_PASSES`, skip-sorts-to-back and weight
ordering are deliberate and tested (`triageQueue.test.ts`).

## Build record

All six items shipped.

- `setLocalReviews` keeps its array when the re-read is equal by value (`sameReviews`),
  which cuts the whole `useEnrichedRecords → all → projectQueue` chain.
- `projectQueue` does one pass: kind filter, focus pin lifted to a PARTITION, skip count
  read once. `compareOrder` drops `localeCompare` (RFC3339 is fixed-width ASCII);
  `compareTriage` delegates, so there is still one ordering law.
- `adoptReach` parses applicability once per practice (`filtersOf`/`matchesFilters`).
- Session writes coalesced to one effect, mount write skipped. That write turned out to
  be what stamped `startedAt`, so `TriageSessionPatch.startedAt` makes the stamp
  explicit — caught by an existing test.
- Review query bounded OPT-IN via `MonitorFeeds.reviewLimit` → `list_manual_reviews_page`
  + `reviewsHasMore`. The fleet monitor's read is unchanged; the deck asks for 100 and
  feeds the overflow into `backlog.capped`.
- Memoised the top bar, queue rail, action bar, both flanks, card header, fact row,
  metric row; split the card prose into `CardBody`/`CardProse`; hoisted the flank
  callbacks. Measured: 26 components on mount, ~4.3 per keystroke, zero markdown
  re-parses while typing.

`triageQueue.test.ts` unedited and green; `triageRebuildCost.test.ts` replays the old
comparator verbatim and asserts the cheap path reproduces it exactly.

**Provenance:** a concurrent session ran a broad `git add` mid-build and swept the
source half into `07f1b0206` under its own message. Content verified verbatim and
intact on master; `7c0a46793` carries the test half.
