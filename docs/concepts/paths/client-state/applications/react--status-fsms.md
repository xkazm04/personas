---
layer: application
subject: client-state
technique: status-fsms
stack: react
---

# Status FSMs — React/Zustand application

Two in-repo implementations, each carrying a different half of the
technique: `processActivitySlice` is the keyed-machine half (concurrent
per-run lifecycles), `sceneStore` is the state-set half (per-family status
with data-presence-aware failure).

## Keyed machines: `src/stores/slices/processActivitySlice.ts`

The activity dock tracks every live process in the app —
executions, builds, chats — as `activeProcesses: Record<string, ActiveProcess>`
keyed by `domain` or `domain:runId` (`processKey()`, `:156`). The file is a
working catalog of the technique's keying disciplines:

- **One authoritative vocabulary.** `ACTIVE_PROCESS_STATUSES` (`:9-17`) is
  a `const` tuple; the type derives from it, and
  `shouldSurviveClearNonActive` (`:422`) switches over it with a `never`
  exhaustiveness arm — adding a status forces an explicit "survives
  clear?" decision at compile time instead of inheriting a default. The
  doc comment at `:107-117` even records a *renamed* status
  (`action_required` → `input_required`) precisely because a stale
  vocabulary copy once lingered in comments.
- **Composite keys guard their separator.** `processKey` throws when
  `domain` or `runId` contains `":"` (`:157-167`), with the collision pair
  (`processKey("build", "x:y")` vs `processKey("build:x", "y")`) written
  out in the comment. The invariant is enforced at the one construction
  site rather than assumed of callers.
- **Ambiguity is refused.** `processEnded` resolves its key via
  `findUniqueProcessKey` (`:200`): when no `runId` is supplied and more
  than one `domain:*` row is live, it warns and refuses (`:210-217`)
  rather than reaping an iteration-order-arbitrary row. The comment at
  `:263-269` names the corruption the old loose fallback caused — a
  finished run vanishing while the still-running one was marked completed.
  Its sibling `enrichProcess` documents the same hazard for telemetry
  (`:80-87`).
- **Entries name their reaper — twice.** `processEnded` removes the entry
  and archives it into `recentProcesses` (bounded at `MAX_RECENT = 10`);
  `reapStaleRunning` (`:393`) bounds how long `running` can credibly last,
  because a completion event lost in transit otherwise leaves a phantom
  "running" row forever (the "29 running personas" incident in the doc
  comment at `:120-128`).
- **A materialized derivation with its reason written down.**
  `activeProcessCount` (`:46-56`) duplicates `Object.keys(...).length` so
  the titlebar dock can subscribe to a primitive under `Object.is`
  equality instead of recomputing inside a selector on every telemetry
  tick — maintained by every operation that adds/removes an entry. This
  is the technique's "earned exception" shape: stored derivation, single
  writer set, documented recomputation.

## Per-family status with `stale`: `src/features/teams/sub_mastermind/lib/sceneStore.ts`

The Mastermind canvas fetches six independent data families (relations,
scans, monitoring, goals, runners, spend). Each carries its own
`FamilyStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'stale'`
(`:34`) — the canonical state set, per family rather than per page, so one
slow family cannot blank five healthy ones.

The load-bearing piece is `failStatus` (`:76-77`):

```ts
export const failStatus = (prev: FamilyStatus): FamilyStatus =>
  prev === 'loaded' || prev === 'stale' ? 'stale' : 'failed';
```

Every family's `catch` routes through it — the shared
transition-on-failure function the technique prescribes. A failed *first*
load goes `failed`; a failed *reload* of a family with data goes `stale`,
keeping real (merely unguaranteed) data on screen and feeding the page's
data-health banner instead of a failure screen. `retryFailed` (`:254`)
then treats `failed` and `stale` uniformly as retryable.

Scoping is honored downward too: `invalidateScans` (`:169-182`) refreshes
one project's rows and, on failure, logs without flipping the family —
"a single project's refresh failing shouldn't flip the whole family to
failed — the rest of the cache is still valid."

## Where the seam to async-ui-states runs

Neither file renders anything. `processActivitySlice` feeds the titlebar
dock and fleet strip; `sceneStore`'s six statuses feed a banner and the
canvas layers. The FSMs are data-layer truth; presentation derives from
them — which is exactly the boundary the golden path draws against
`docs/concepts/paths/async-ui-states/async-ui-states.md`.

## Known gap (reported, not fixed here)

`sceneStore`'s whole-family loads carry no latest-wins token, even though
the repo owns a shared primitive for it
(`src/stores/util/latestWins.ts`); concurrent `loadScans()` calls can
commit out of order. The min-interval throttles on sentry/spend mitigate
but do not close it — see the async-race-guards technique.
