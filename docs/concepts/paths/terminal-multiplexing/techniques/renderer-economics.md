---
layer: technique
subject: terminal-multiplexing
technique: renderer-economics
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Renderer economics

A terminal at interactive quality is a demanding render target: a dense
monospaced grid, styled per cell, repainting in bursts at the producer's
speed. Hardware acceleration — a GPU context, a glyph atlas, damage-tracked
draws — is what makes one such terminal feel instant. This technique owns
the fact that what makes *one* terminal fast makes *forty* impossible, and
the lifecycle discipline that resolves the tension.

## The scarce resource is counted, not metered

GPU contexts are not a smooth cost that degrades gracefully as you add
more; platforms cap them at a small integer per process, and exceeding the
cap does not slow the newest context — it **revokes the oldest**, usually
the one under the terminal the user is actually reading. This changes the
design question. A metered resource can be managed reactively ("optimize
when profiling says so"); a counted resource must be budgeted structurally,
because the failure mode is not slowness but a working surface going dark
at a distance from the change that caused it. Hence the rule inherited from
the golden path, stated here as the technique's first law: **accelerated
renderers are attach-scoped. The number that exists equals the number of
terminals on screen, and N parked or detached sessions hold zero.**

## The renderer is an accessory, not an organ

The naive object design bundles emulator state (grid, scrollback, parser
state) and renderer (the thing that paints the grid) into one object with
one lifetime. The technique's structural move is the divorce: the
**emulator** is cheap, owns the truth of the screen, and may live as long
as parking policy wants; the **renderer** is expensive, owns no truth at
all, and is created on attach and destroyed on detach. Because the renderer
is derivable from the emulator at any moment, destroying it loses nothing —
which is precisely what makes it safe to treat as a disposable accessory.
Any state that would be lost with the renderer (selection, scroll position)
is state that was stored in the wrong object.

Destruction is explicit, immediate, and owned by the detach path
([creation-names-reaper](../../_laws.md#creation-names-reaper)). GPU handles
are the worst possible candidates for garbage-collected cleanup: the
collector sees a small wrapper object and feels no pressure, while the
driver holds megabytes of atlas and one of a countable few contexts. A
renderer released "whenever finalization gets to it" is a renderer that is
still holding its context when the budget math says it is not.

## The fallback ladder

Acceleration is a privilege that can be refused or revoked: driver
blacklists, headless environments, context-count exhaustion, and the
platform's own "context lost" events (which real drivers emit under memory
pressure and after resume-from-sleep). The technique requires a **ladder,
chosen per rung of attention**:

- **Visible and focused** — accelerated renderer.
- **Visible but parked behind another view, or acceleration refused** — a
  plain text-flow renderer: slower, allocation-light, correct. Degradation
  is a less silky terminal, never a blank one.
- **Not visible** — no renderer at all. The emulator (if parked) or the
  backend ring (if detached) holds the truth; pixels for nobody are pure
  waste.

One rung sits deliberately outside the ladder: **the preview is not a
terminal.** A grid or roster of unwatched sessions shows each one's recent
output as plain text cooked from the backend ring (see
bounded-replay-buffers), not as a miniature live terminal. Mounting a real
emulator-plus-renderer per tile turns a forty-session glance into forty
attention-column spends — the exact multiplication the budget exists to
prevent. The focused tile gets the real terminal; every other tile gets an
approximate, renderer-free snapshot, and that asymmetry is a feature to
state in the design, not a compromise to apologize for.

Context loss is handled as an *event with a recovery path* — drop to the
fallback, attempt re-acceleration on the next attach — not as an error. A
terminal that crashes or blanks on context loss has treated a documented,
recoverable platform condition as an invariant violation.

## Resize and reflow are the hidden bill

A terminal resize is not a blit. It re-wraps every buffered line to the new
column count, resizes the child's notion of its window (see
pty-management), and typically triggers the child to repaint. Costs scale
with buffer depth, and resizes arrive in **storms** — interactive drags,
layout animations, window snaps emit dozens per second. Two disciplines:

- **Coalesce at the source, and skip the no-ops.** Resize propagation is
  debounced so the emulator and child see the settled size, plus at most a
  few intermediate sizes for visual continuity — not sixty. And a resize
  that computes the *same* columns and rows propagates nowhere: layout
  churn frequently changes the box without changing the grid, and an
  unconditional push turns every such event into a boundary crossing and a
  possible child repaint for nothing. The child-facing step matters most:
  each size change delivered to the device tells the child to reflow and
  repaint, so an uncoalesced storm turns one drag into dozens of
  full-screen repaints arriving through the ring — and, where a headless
  screen model is fed from the ring (see bounded-replay-buffers), each new
  size can also invalidate that model into a full rebuild.
- **Never resize the invisible.** Parked and detached sessions do not track
  the layout's every move. Reconciling size is an attach-time step: on
  promotion, the emulator is resized once to the slot it is entering. The
  alternative — broadcasting layout changes to N sessions so they are
  "ready" — spends N reflows to save one, on the session that may never be
  looked at again.

## The budget is one number, derived, and enforced in one place

How many accelerated terminals may exist is a single constant derived from
the platform cap with headroom for the rest of the application (other
surfaces want GPU contexts too — charts, maps, media). It is enforced by
the multiplexer's attach path — the one door through which renderers are
created — not by each view's self-restraint. A budget enforced by
convention across call sites is a budget that a new surface breaks the
quarter after everyone forgets; the door pattern makes the next call site
inherit the discipline automatically.
