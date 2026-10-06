# Crosscheck

## Philosophy
A practice you cannot see happening is a document, not a practice, so the figure is the
**record**: every step crossed with every recent change, all of it at once, with no
selection needed to see where the practice leaks.

## How it stays readable at scale
The container is a crosstab, which is the one shape that holds 11 x 20 = 220 facts
without a scroll: steps are 28px rows in journey order, changes are 10px columns oldest
to newest, and a cell is one outcome. Column alignment does the work a legend cannot -
a change that skipped four steps is a vertical gap you see before you read anything.
Each row carries its own `kept/observed` at the right edge, on the figure, and
`observed` excludes `unknown`. A step with no observations reads `--`. The 220 cells are
`aria-hidden`; the accessible record is the ledger table on the second plate, and the
row's own label carries step, state and tally.

## The wow moment
The holes. On a real project the `docs` and `tests` rows are a pale band across the
whole window while `gate` is solid green, and that comparison is not available anywhere
else in the app.

## Known limits
Twenty columns is the backend's `EVIDENCE_LIMIT`; a longer history would need a scroll
or a bucket and the figure does not yet say which. The columns are not individually
identified on the figure - which change a cell belongs to is answerable only from the
ledger below, in time order. Sequence is demoted from a figure to a row order, so "what
is behind me and what is ahead" reads weaker here than on the rail.
