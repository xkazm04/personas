# Rail Below

## Philosophy
The lifecycle is a **path the work walks**, so the whole path stays on screen as one
unbroken left-to-right rail and everything else is subordinate to keeping it visible
while you inspect one point on it.

## How it stays readable at scale
Eleven steps at 80px pitch is 880px, which overflows horizontally rather than
wrapping, so the path never breaks into a second line that reads as a second path.
The two lanes are separated by a `gap-10` and each lane's connector stops at its own
edge, so the before/after split is visible and not only announced. Each node is three
fixed lines (mark, caption, dot row) and the dot row reserves its box even when empty,
so the caption row aligns across all eleven. The step's state and its evidence sit in a
region with a reserved 26rem height, so selecting never shoves the rail.

## The wow moment
Holding ArrowRight walks the whole practice: the ring slides along the rail, the panel
beneath re-titles, and the ledger's rows re-ripple under their new outcomes. The path
does not move.

## Known limits
The rail is the only thing that answers "where am I"; it answers "is this practice
actually happening" one step at a time, because only the selected step's record is on
screen. Twenty evidence rows compressed into eight dots is the figure's whole
resolution. Below about 900px of content width the rail scrolls horizontally, which
costs the "whole path at once" property that is its entire bet. It is also the obvious
first idea, and it is kept as the baseline for exactly that reason: it is what the
owner already chose, and the three concepts beside it are measured against it.
