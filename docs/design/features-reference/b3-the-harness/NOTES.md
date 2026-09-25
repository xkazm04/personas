# The Harness

## Philosophy
Features are wires, not rows. Each runs left to right as a line; groups stand beneath as
terminals; every context is a pad. What a feature *is* becomes where it is soldered.

## How it stays readable at scale
Both jobs share one board. **Job 1**: nineteen lines ordered by who is waiting, each ending in a
score rail with the 0.70 threshold drawn through all of them at one x. **Job 2**: the terminals
below, a load histogram saying Data Access Layer carries 18 of the 19 lines while four carry
none, and a bed where every context is a pad. Above both, one instrument head names whatever the
pointer is on — line, terminal or pad — with its sentence, its figures and its one action.

Lane height, bed depth and labels are computed from the window, so 19 over 25 fit at 1280x800.
A never-councilled line is a thin dashed grey wire — absence, not failure — and its rail is
hatched, never a zero fill.

Type: 13 on the board, 15 names and readout prose, 28 the readout name, 34 its figures, 44 the
overall.

Figures instead of text: span becomes junction dots sized by contexts claimed there; coverage a
ring; a shared context a violet pip; an untouched terminal an amber dashed zero.

## The wow moment
Click a line and it wires itself into the bed, one drop to every pad it claims, while the rest
of the harness dims to a ghost.

## Known limits
Pads compress to ~3 px at the smallest window, though the pointer target stays column-wide, and
rotated terminal names truncate. Hardest to port: the board is one computed SVG, so it wants a
ref-held renderer with an `invalidate()`, not React elements.
