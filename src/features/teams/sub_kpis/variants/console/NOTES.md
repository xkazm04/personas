# Console

## Philosophy

At 1,044 KPIs you do not need to see the estate — you need **one** of them whole
and your hands on the dial that walks to the next, so the estate's own ranking is
kept as a sequence instead of being discarded to make a picture.

## How it stays readable at scale

Scale is the reason the concept exists rather than a problem it has to survive.
The plate is always exactly one KPI, so the surface's height is constant at 6
KPIs or 90,000, and the 115-character name in this estate is set at reading size
and **wraps** — every other surface in the module has to truncate it into a cell.
The spine holds the whole estate as one 3px tick each, four wrapped rows at
1280px, two channels only (colour is the track, hatch is never-read; there is no
size channel, because the point is that ticks are comparable and individually
addressable). It is **one element, not 1,044 buttons**: a thousand tab stops would
bury the keyboard, which is the real control. The segment rail is the spine's only
text and is what makes a wrapped figure navigable without labelling 1,044 marks.

## The wow moment

Holding the right arrow and watching the plate walk down the estate's own ranking
— name, the travelled line, the next-move sentence — while the taller cursor tick
slides along a spine that holds every KPI you own. The travelled line is the
second: baseline and target as ticks, the reading as a caret where it actually
sits, **unclamped**, so an overshoot runs past the target and a regression runs
behind the baseline. `kpiProgressPct` clamps to 0–100 and no other surface in the
module can show either.

## Known limits

- No overview at all. It cannot answer "which project is worst" — it asserts the
  ranking is right and shows you the top of it. If the ranking is wrong the
  surface has no recourse.
- The spine's ticks are clickable but not focusable, so the fine-grained path is
  genuinely keyboard-or-mouse, not keyboard-or-tab.
- 1,044 DOM nodes on first paint (the Map draws 1,044 plots, so the budget is
  precedented, but it is a budget).
- The trend series is not drawn: the plate shows the travel, not the history.
- Unverified: I cannot see the running app. The key bindings are covered by tests
  against a synthetic estate; the tick width, the four-row wrap at a real window
  size and the caret's legibility have not been looked at.
