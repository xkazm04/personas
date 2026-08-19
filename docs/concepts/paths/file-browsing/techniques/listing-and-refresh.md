---
layer: technique
subject: file-browsing
technique: listing-and-refresh
status: forged
laws: [failure-not-empty-success, gate-sees-target]
shared_with: []
---

# Listing and refresh

The listing is the browser's only source of truth about the store, and the
store is a foreign authority: it can be slow, partially unreadable, absurdly
large, cyclic, and different by the time the listing returns. The technique
is a read contract — what you ask for, what you do when parts of the answer
are missing, and when you ask again.

## The read contract

A listing call has a declared shape, decided once:

- **Scope**: one directory (shallow, for lazy trees) or a subtree (deep, for
  library-style views). Deep reads must carry a **depth cap** and an **entry
  cap** — a symlink cycle, a mounted network volume, or a dependency-cache
  forest of a million tiny files will otherwise turn one navigation into an
  unbounded walk. Hitting a
  cap is reported ("stopped at depth N / after M entries"), not silently
  truncated: a capped listing rendered as complete is a wrong answer wearing
  a right answer's face.
- **Per-entry metadata**: name, kind, size, timestamps, and whatever the
  taxonomy needs — fetched in the listing pass, because per-item follow-up
  reads turn one round trip into thousands.
- **Ordering**: either the store's order is declared untrusted and the
  browser always sorts, or the contract states the order. Unspecified order
  is the kind of thing that works on one machine and interleaves on another.
- **Exclusions**: which entries the listing deliberately omits — hidden
  files, system artifacts, the browser's own bookkeeping directories — is a
  declared policy, stated once and applied by every reader. Left implicit,
  parallel readers drift on exactly this: one walker skips hidden files,
  another only hidden directories, and the two views of "what exists"
  quietly disagree. When callers legitimately need different policies, the
  policy becomes an explicit parameter of the one shared walker — visible
  difference beats silent divergence.

## Error policy is per entry, not per listing

Inside one directory read, individual entries fail independently: a file with
no read permission, a dangling link, a name that does not decode. The naive
policies are both wrong — failing the whole listing because one entry is
unreadable hides a thousand good files behind one bad one; skipping bad
entries silently makes the browser *lie about what exists*.

The contract: **skip-and-count, then disclose**. Unreadable entries are
skipped, counted, and surfaced ("3 items could not be read"), with the walk
continuing. And the two zero cases are spelled differently: an empty
directory ("nothing here") and an unreadable directory ("could not read
this") are different facts demanding different renderings and different user
actions. Collapsing them — one blank panel for both — is the classic listing
defect, and it is the file-browser instance of a law: a scanner that finds
nothing and a scanner that could not run must produce distinguishable
outputs.

## Refresh: watch, poll, or event — pick and admit the window

The view goes stale the moment the listing returns. The refresh strategies,
in descending fidelity and ascending cost:

1. **Store change notifications (watching)** — lowest latency, but watchers
   have real failure modes: they drop events under bursts, they often cannot
   watch network or virtual volumes, and they silently die. A watcher without
   a reconciliation pass is a gate that stopped seeing its target — pair
   watching with a periodic or on-focus verify.
2. **Opportunistic refresh** — re-list on navigation, on window focus, after
   every mutation the browser itself performs. Cheap, covers the moments the
   user is actually looking, and is the correct *floor* even when watching
   exists.
3. **Interval polling** — a blunt instrument; acceptable for small scopes,
   ruinous for deep ones. If polling deep trees is the plan, the plan is
   wrong; restructure to shallow-per-directory reads.
4. **Manual refresh** — always present as an escape hatch, because every
   automatic strategy has a hole and the user can see the store through
   other windows.

Whichever mix is chosen, the *staleness window* it implies is a stated
property of the surface, not an accident. "This view is current as of
navigation and focus" is a designed contract; "it refreshes whenever it
happens to" is not.

## Refresh must not destroy

A refresh replaces the *data*, never the *session*: selection intersects by
identity, expansion is re-applied by identity, scroll anchors to the nearest
surviving item, and an in-progress rename is never yanked out from under the
user's cursor (defer the refresh or re-apply it after commit). A refresh
that costs the user their working state teaches them to fear the honest
behavior — they will start working against stale views because the fresh
ones hurt.

## Big directories

Ten thousand entries in one directory is not an edge case in real stores.
The listing contract must state what happens: stream-and-append with a
progress affordance, cap-with-disclosure, or windowed rendering over a
complete in-memory listing. What it must never do is block the whole surface
while one pathological directory enumerates — the read happens off the
interactive path, and navigation elsewhere stays live.
