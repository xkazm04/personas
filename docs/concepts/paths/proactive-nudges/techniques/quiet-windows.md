---
layer: technique
subject: proactive-nudges
technique: quiet-windows
status: forged
laws:
  - gate-sees-target
shared_with: []
---

# Quiet windows

Declared spans of the user's day in which the machine does not initiate
contact. Of all the policy layer's promises this is the most legible to
the user and the most expensive to break: one nudge at 03:00 undoes a
month of restraint, because the user cannot tell a rare bug from a policy
that was never real.

## Declaration

- A window is **start and end in the user's local wall-clock time**, and
  most real windows wrap midnight (22:00 → 07:00). Wrapping is the normal
  case, not the edge case; model the window as "in-quiet iff the current
  local time falls in the wrapped interval," never as `start < now < end`
  with a silent assumption that start precedes end.
- Multiple windows are allowed (nights and a focus block); overlapping
  windows union. An empty declaration means no quiet time — but the
  *default* configuration ships with a sane night window, because the
  users most harmed by 03:00 contact are exactly the ones who never open
  settings.
- Degenerate declarations get pinned meanings: start == end is either
  "always quiet" or "never quiet," and which one is a decision made once,
  documented, and tested — not an accident of the comparison operator.

## Boundary semantics, pinned by tests

Every window has two edges and each edge is inclusive or exclusive; the
choice matters exactly at the minutes users pick (on the hour), which is
where off-by-one errors concentrate. The technique's demand is not a
particular choice but that **the choice is pinned**: a test suite that
walks the full boundary surface — the minute before the start edge, the
start edge, inside, the minute before the end edge, the end edge, after;
the wrapped and unwrapped forms; the degenerate window — and asserts each
case by name. Property-style tests earn their keep here: for random
windows and random times, "in-quiet" computed by the shipping code must
agree with an independently written oracle, which flushes the wrap bugs
example-based tests miss.

The gate must also see its target
([gate-sees-target](../../_laws.md#gate-sees-target)): the quiet check
evaluates the time of the **delivery attempt**, not the time of the
notice. A notice created at 16:00 and deferred by budget must still be
quiet-checked when it finally fronts the queue at 23:30 — checking at
notice time gates a proxy, and the proxy diverges from the target
whenever deferral crosses a window edge, which is precisely when it
matters.

## The bypass is a closed class

Some events justify waking someone. The design problem is not whether a
bypass exists but how its membership is governed, because bypass creep is
monotonic — kinds enter the privileged class and never leave, until the
window gates nothing:

- The quiet-crossing property belongs to a **priority class**, drawn from
  a closed enumerated set defined in one place — never a boolean argument
  at a call site, which makes every author their own policy committee.
- Admission to the class is a reviewed policy change with a stated
  justification ("user explicitly requested to be woken for this" is the
  gold standard; "the feature team considers it important" is the
  anti-pattern).
- Bypassing deliveries are **counted and labeled** in the delivery record.
  The report "quiet window crossed twice this month, both for kind X"
  is what keeps the class honest; an uncounted bypass grows silently.

## Timezone honesty

- Evaluate against the **user's current local clock**, resolved at each
  delivery attempt — not the clock of the machine that runs the queue,
  not the offset captured when the window was declared. Travel and
  daylight-saving shifts move the user's 22:00; the window moves with it.
- Daylight-saving transition days contain a skipped or doubled hour
  inside many night windows. The wrapped-interval formulation over local
  time handles both correctly for free; window arithmetic done in UTC
  with a cached offset handles neither. Test the two transition days by
  name.
- A system that cannot know the user's timezone (no signal, headless
  profile) degrades **toward quiet**, not toward delivery: the cost of
  wrongly holding a nudge until morning is minutes; the cost of a 03:00
  miss is the channel.
