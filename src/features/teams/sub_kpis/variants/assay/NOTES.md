# Assay

## Philosophy

An estate of KPIs is an estate of **instruments**, and this one's subject is
instrumentation rather than performance — so the surface is organised by how a
reading is obtained and where that mechanism stalls, not by how anything is doing.

## How it stays readable at scale

One lane per `measure_kind`, so the whole estate is four rows whatever its size:
1,044 KPIs or 90, the surface has the same height. The channel is a **constant
height**, so a lane's shape is its yield and never its population — scaling by
size would draw the 1-KPI lane at 3px of 76 and hide the only comparison that
matters. Size is stated as a figure and drawn by the module's existing `SizeBar`.
The attrition number is printed *inside* the loss band where the loss is, not in a
legend, and drops to the lane caption below 20px rather than clipping. The rail of
places that own the loss caps at 6 and prints "+n more" past it, because 71 groups
would wrap for six lines and stop being a rail.

## The wow moment

On this machine's real data the four lanes are wildly different shapes:
`entered by you` is 829 declared and a 0.6% channel — a line you can barely see —
while `measured from the code` runs at 75% and `fetched from a service` is 30
declared with a channel of literally nothing. You read in one second that the
estate is dark because nobody enters numbers by hand, which no other surface in
the module can say at all. It is a comparison of **shapes**, not of colours; the
palette could be removed entirely and the finding survives.

## Known limits

- It has no answer for an estate whose KPIs all share one mechanism: a single lane
  is a bar chart with two gates, and the comparison that carries the concept is gone.
- The KPI level is reached through the group layer, not directly — there is no
  per-KPI mark on the surface, so "which instrument" is one more click than on Map.
- Four lanes means four yields and no ranking between them; a lane that is small
  *and* broken sits visually beside one that is large and broken.
- Unverified: I cannot see the running app. The flume's band proportions, the
  20px label floor and the four-lane height were reasoned from measurements and
  the browser has not confirmed them.
