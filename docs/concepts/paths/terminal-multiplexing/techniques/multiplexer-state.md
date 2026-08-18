---
layer: technique
subject: terminal-multiplexing
technique: multiplexer-state
status: forged
laws: [identity-survives-reuse, creation-names-reaper]
shared_with: []
---

# Multiplexer state

Somebody has to know everything: which sessions have machinery, who is
attached where, which view slot shows which session, where each session's
scroll position was when its user looked away. This technique owns the
**manager** — the single stateful object that holds the session→machinery
map, routes attention, and survives everything short of the host itself.

## One manager, keyed by session identity

The map's key is the durable session identity minted by the roster owner —
[fleet-orchestration](../../fleet-orchestration/fleet-orchestration.md)'s
registry — and nothing else
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)). Not the
widget instance (frameworks recycle them), not the view slot (users reorder
them), not the display name (users rename them), not the child process id
(the platform recycles them, and a restarted session is the *same session*
to the user with a *different process* underneath). Every defect family in
naive multiplexers traces to a softer key: duplicate emulators over one
session when a view remounts, input routed to the session that *used to be*
in slot three, history lost on rename.

The map's value is the session's rung on the attach/detach ladder plus
whatever machinery that rung retains. The manager is the **one door** for
rung transitions: views request attach and release; nothing outside the
manager constructs terminal machinery. Single-door is what makes the
budgets enforceable and the inventory trustworthy — a rogue view that
builds its own emulator is invisible to every budget the manager keeps.

## Views borrow sessions; they never own them

The relationship between a view slot and a session is a **loan**: the view
presents a display surface and receives the session's widget into it;
navigation returns the loan. Two consequences:

- **The view's lifecycle hooks are thin.** Mount says "attach this session
  here"; unmount says "released". All teardown decisions — park or detach,
  keep or drop the renderer — belong to the manager's policy, because only
  the manager sees the whole budget picture. A view that disposes what it
  displayed destroys shared state it never owned.
- **Moving a session between surfaces is a re-loan, not a rebuild.** The
  same session shown in a side panel, then a full-screen view, then a
  picture-in-picture tile is one emulator handed across three surfaces.
  The widget re-parents; the machinery persists. If moving a session visibly
  resets it, ownership is in the wrong place.

## One inbound dispatch, not N filters

Output arrives from the backend as events tagged with session identity, and
the manager registers **one** listener that dispatches each event into the
map by key — constant work per chunk regardless of how many sessions exist.
The tempting per-session alternative — each terminal registers its own
filtered listener — runs every listener's filter on every chunk: cost per
byte scales with the number of terminals *ever created*, which is the
existence column billed at attention rates, and precisely the shape the
two-column model forbids. The single dispatcher also gets the edge cases
right for free: an event for a session with no machinery is dropped at one
known point (the backend should not have sent it; dropping is correct and
observable), and the listener itself is a create-once resource on the same
survival rung as the manager, so a code reload cannot stack a second copy
and double-write every terminal.

## Focus routing: exactly one keyboard

Input is a singleton in a way output is not: many sessions may paint, but
at any instant at most one session receives the keyboard. The manager owns
the focus pointer, and all input — human keystrokes from the focused
widget, programmatic injection addressed by session identity — resolves
through it or past it explicitly. The two invariants:

- **Focus follows the user's declared target, not paint order or event
  bubbling.** A background session that grabs focus because it repainted,
  or because its widget mounted last, is how keystrokes land in the wrong
  terminal — the multiplexer defect users forgive least, because its worst
  case is a destructive command executed somewhere unseen.
- **Injection does not require focus.** Automation drives sessions by
  identity while the user types into a different one; the two input paths
  meet only at each session's own device. Coupling injection to focus makes
  automation steal the keyboard, which converts every background job into
  a foreground interruption.

## Per-session view state outlives the view

Scroll position, selection, whether the user had scrolled away from the
tail ("follow mode" off) — this state belongs to the *session*, not the
widget, because the user experiences it as "my terminal, as I left it".
The manager keeps it per session identity across park and detach: cheap
scalars, existence-column costs. Losing scroll position on every tab
switch is a small paper cut; losing it *because* the machinery was
correctly parked is the avoidable version — the economics should be
invisible, and view-state persistence is what makes teardown undetectable.

## Surviving the reload of everything around it

In an interactively developed host, the manager's client code — views,
stores, routing — is replaced many times an hour without a restart, while
the sessions must not blink: the children are real processes and the rings
are real memory. The manager therefore lives at a scope that survives
module replacement, per the singleton ladder owned by
[client-state](../../client-state/client-state.md)'s
singleton-lifecycle technique. This technique adds the multiplexer-specific
obligations:

- **One incarnation at a time.** A reloaded module that constructs a second
  manager over live sessions creates the two-brains defect: both hold maps,
  budgets diverge, and detach in one leaks in the other. The survival slot
  is checked before construction — reuse the living manager, never shadow
  it.
- **Stale closures are inert.** Old module instances may still hold a
  reference to the manager or its callbacks after replacement. The manager
  guards against being driven by the dead — a generation or identity check
  that makes calls from superseded incarnations no-ops — because "mostly
  the old module is garbage-collected promptly" is a race, not a design.
- **Reconcile on revival, don't assume.** After a reload wave, the widget
  layer re-mounts and re-requests attachments. The manager treats these as
  reconciliation against its surviving map — re-loan the existing machinery
  — not as first contact.

## The manager names its own reaper

Survival across reload cuts both ways: an object built to outlive its
callers is an object nothing collects by accident, so its end is designed
([creation-names-reaper](../../_laws.md#creation-names-reaper)). Host
shutdown walks the map — detach all, final-drain, release rings, hand every
child to the process layer's termination path — and roster removal of a
session reaps that session's entry in full. The tell of a missing reaper is
a map that only grows: sessions dead for hours still holding entries,
tombstones accumulating without a sweep, and a "restart the app to fix the
terminals" folk remedy standing in for the shutdown path nobody wrote.
