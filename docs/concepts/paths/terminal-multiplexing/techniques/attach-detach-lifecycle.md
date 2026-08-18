---
layer: technique
subject: terminal-multiplexing
technique: attach-detach-lifecycle
status: forged
laws: [creation-names-reaper, identity-survives-reuse]
shared_with: []
---

# Attach / detach lifecycle

The session is long-lived; the user's attention is not. This technique owns
the ladder that lets one session move freely between "being watched" and
"running unwatched" — many times over its life, in either direction, without
losing output, duplicating state, or hoarding resources it no longer needs.

## The four rungs and what each one frees

- **attached** — the session has a mounted widget, a live emulator with an
  accelerated render surface, and a live subscription to its output flow.
  This is the only rung allowed to spend attention-column resources.
- **parked** — the widget still exists but is hidden (another view is on
  top). The accelerated renderer is released or downgraded; the subscription
  may be throttled or paused, because nothing painted from it is visible.
  Parking exists so that *switching back* is instant — the widget and
  emulator state are warm — while the scarce resources are already returned.
- **detached** — no widget, no emulator, no subscription. The session is a
  child process plus a filling backend ring plus a registry entry. This rung
  costs a bounded, fixed amount per session, which is what makes an
  unbounded roster survivable.
- **dead** — the child has exited. The ring is retained briefly for
  post-mortem reading, then reaped; the registry entry becomes a tombstone
  that a list view can render without any terminal machinery at all.

The two directions are asymmetric by design. **Downward transitions are
automatic**: navigation parks, budget pressure detaches, exit kills. The
user never files a request to stop paying for what they stopped watching.
**Upward transitions are deliberate**: attach happens on explicit intent
(the user opened the view; automation asked to drive the session), because
it spends budgeted resources and because a spurious attach — triggered by a
list render, a prefetch, a hover — silently converts existence costs into
attention costs across the whole roster.

## Teardown is ordered, and the order is load-bearing

Detach tears down in the reverse order of data flow: **subscription first,
then renderer, then emulator, then widget.** Unsubscribing first matters
because every later step can yield to the event loop, and an output event
arriving mid-teardown otherwise finds a half-destroyed emulator — the
classic crash that reproduces only under load. Attach builds in data-flow
order: emulator, then renderer, then replay the ring (see
bounded-replay-buffers), then subscribe live. Replay-before-subscribe plus a
position handshake is what makes the seam between history and live flow
gapless; subscribe-before-replay interleaves live bytes into the middle of
history.

Each teardown step is the named reaper of the resource its mirror step
created ([creation-names-reaper](../../_laws.md#creation-names-reaper)): the
code that subscribes names the unsubscribe, the code that creates the render
surface names its release. A detach path assembled from "whatever cleanup
seemed necessary" is how one rung leaks one resource — and one leaked
subscription per detach is invisible at N = 3 and a firehose at N = 40.

## The budget and the parking policy

The number of simultaneously attached-or-parked sessions is a **budget**, a
small constant chosen from the scarce resource that binds first (usually
render surfaces or GPU contexts — see renderer-economics). When an attach
would exceed the budget, the manager evicts by **least recently viewed**:
the session whose user attention is oldest falls to detached. Least recently
*viewed* — not least recently *active* — because the child's own chattiness
says nothing about whether anyone cares; a noisy background build is
precisely the thing to detach, and a quiet shell the user typed in ten
seconds ago is precisely the thing to keep.

Three properties keep the policy honest:

- **Eviction is a normal detach**, running the same ordered teardown — never
  a special-cased fast path that skips steps under the pressure that most
  needs them.
- **The focused session is unevictable.** The budget must therefore be at
  least two, or focus changes deadlock the policy.
- **Eviction is observable.** A counter or log of budget evictions is the
  early-warning instrument for a budget set too low — the symptom users
  report ("my terminals keep going blank and replaying") is otherwise
  indistinguishable from a bug in replay.

## Reuse, not rebuild

Attach must first ask: **does this session already have machinery?** If the
session is parked, attach is a promotion — reveal the widget, restore the
accelerated renderer, resume the subscription — not a rebuild. The map that
answers the question is keyed by durable session identity
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)), because
the same session is reachable from multiple surfaces (a roster row, a detail
view, a notification) and view components are recycled by their framework.
Keying by view instance produces the signature defect of naive multiplexers:
every navigation creates a new emulator over the same child, each with its
own partial history, and detach destroys one of them while the others leak.

The anti-pattern this whole technique replaces is **create/dispose per
view**: terminal machinery constructed in the view's mount hook and
destroyed in its unmount hook. It is the natural shape in any
component-lifecycle framework and it is wrong in all of them, because it
welds the session's machinery to the shortest-lived object in the system.
The view's mount hook should do exactly one thing: hand its display slot to
the manager and ask for an attach.
