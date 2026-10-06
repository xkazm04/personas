# Matrix (the shipped baseline)

## Philosophy
A project is a reading LINE and a dimension is a COLUMN, so a cluster of failing
marks is found by scanning across a fixed grid rather than by reading anything.

## How it stays readable at scale
Fixed 32px row bands on the 8px grid, a sticky header, horizontal column heads,
and a spine that glows on the selected line. Alignment is the whole mechanism:
every project's cell for a dimension sits at the same x, so a column is
comparable by eye. Beyond about forty projects it stops working - 102 rows is
3,264px of scroll with no landmark in it - which is the reason the other three
concepts exist.

## The wow moment
The crosshair. Moving the roving coordinate lights the whole column and the
whole line at once, and the readout names the cell you are on.

## Known limits
Measured against the real portfolio (102 projects, 2026-10-06): the 248px name
column with `white-space: nowrap` cuts 74 of the 102 names - all of the
`Gig · <discipline> · <sentence>` family, up to 86 characters - at about thirty
characters, so for three quarters of the portfolio the identity column
identifies nothing. The rows are striped by `:nth-child(even)`. The two ABSENT
states are drawn as dots the same size as a verdict, and absence is the
dominant state here. It is kept as the control the other three are read
against, and as the owner's default until he picks.
