# Almanac

## Philosophy

A KPI estate is a **schedule**, so the only honest axis is the next reading — and
a KPI nobody scheduled is not an absence from that axis but a position on it, at
infinity.

## How it stays readable at scale

One band per place, so eleven projects are eleven rows and the surface does not
grow with the KPI count; descend and the same eleven rows become that project's
groups. Three channels and no sharing: **x** is lateness (square-rooted, so a
2-day debt beside a 91-day one is still a mark), **y** is population, and the
hatched share of a bar's height is the part that has never been read. Today is a
vertical rule drawn by every row's own left border, so the horizon is continuous
across the table without an overlay and a band read in the middle never has to
scroll to find out which way is late. The axis is stated above the rows and the
totals below them.

## The wow moment

The shape of the real estate: a mass of debt piled up behind today, **nothing at
all** to the right of the horizon, and a hatched right margin holding 861 of 1,044
KPIs that promised no rhythm and are therefore due never. Pinning "due never" past
the end of the axis rather than into a grey bucket is the whole move — it turns
the largest quantity in the estate from a colour into a distance, and it makes the
empty forecast side read as the indictment it is.

## Known limits

- The forecast half is dead weight on this data (0 KPIs ahead of today), so almost
  half the figure's width is currently empty. It earns itself only on an estate
  that is actually being measured.
- A place's bar reports its **extreme** lateness, not a distribution: one 91-day
  KPI and ninety 10-day ones draw the same length.
- `freshDays` is a module-wide table, not a per-KPI promise, so "overdue" is the
  module's opinion of a cadence rather than the KPI's own.
- No per-KPI mark: the KPI level is reached through the group layer.
- Unverified: I cannot see the running app. The 8.5rem label column, the 1.5fr/1fr
  split either side of the horizon and the 20px band height are reasoned, not seen.
