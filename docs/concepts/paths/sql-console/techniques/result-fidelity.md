---
layer: technique
subject: sql-console
technique: result-fidelity
status: forged
laws: [count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Result fidelity

The console is frequently the user's only lens on this data, and a lens must
not editorialize. Grid mechanics — column model, pagination surfaces, body
states — belong to the table subject; *this* technique is the contract for
what the console feeds that grid: values, shapes, and outcomes that survive
the trip from a foreign engine to a rendered cell without silent
falsification.

## Value truth

- **`NULL` is a fact, not an absence of text.** Three different cell
  contents — SQL `NULL`, the empty string, and the six-character text
  `"NULL"` — must render three distinguishable ways. The conventional
  solution is a styled marker for the real `NULL` (dimmed, italic, clearly
  non-textual) that no string value can imitate. A console that renders all
  three identically has destroyed exactly the distinction the user opened a
  SQL tool to see.
- **Numbers survive transport.** Result values typically cross a boundary
  whose native number type has bounded integer precision. 64-bit integers,
  arbitrary-precision decimals, and monetary types must arrive either as
  tagged strings or via a wide-integer representation — never silently
  rounded. A console that corrupts the tail digits of an id column will have
  that id pasted into a WHERE clause, and the user will mutate the wrong
  row with a tool that told them it was the right one.
- **Types render as themselves.** Numbers right-aligned in tabular figures,
  booleans as booleans, timestamps with their zone honesty (display the
  value the engine returned; if the console converts to local time, it says
  so — a silently shifted timestamp is data corruption for the person
  debugging a time bug). Binary values render as a typed summary (kind and
  size, expandable), never dumped raw into a cell.
- **Truncation with recourse.** Oversized text truncates for the grid's
  sake, but the full value stays reachable (cell expansion, copy). Copy
  copies the *value*, not the truncated rendering.

## Shape truth

A statement's outcome is one of several distinct shapes, and the console
renders each as itself:

| Outcome | Renders as |
| --- | --- |
| result set with rows | the grid |
| result set with zero rows | "0 rows" as a settled, explicit state — the query worked and the answer is none |
| mutation acknowledged | affected-row count, prominently — this *is* the result |
| refusal (safe mode) | the classification and the deliberate path forward |
| engine error | the failure surface, below |

The zero-row case and the error case are the pair implementations blur, and
[failure-not-empty-success](../../_laws.md#failure-not-empty-success) is the
rule that keeps them apart: an empty grid with no verdict could be either,
and the user's next action differs completely (refine the question vs fix
the query). Settled-empty must say it settled.

## Bounds carry their predicate

Consoles cap result windows — a `LIMIT` appended when the user wrote none, a
row ceiling on transport, a cell-size ceiling. Every cap that fired is
**announced with its bound**
([count-carries-predicate](../../_laws.md#count-carries-predicate)): "first
500 rows (console limit)" is honest; "500 rows" is a lie the user will
quote — the difference between "the query returned 500" and "the console
stopped at 500" changes analyses. The same honesty applies to timing:
elapsed time shown per execution, with engine time distinguished from
transport time where the connector can tell.

Two mechanics make the row bound both cheap and detectable:

- **Bound before materialization, not after.** Where the family's language
  allows it, the executor injects the limit *into the statement* (`LIMIT
  n+1` appended when the user supplied none) so the engine stops producing
  rows at the cap; a cap applied after fetching the full result has already
  paid for — and pulled across the wire — everything it then discards. A
  byte ceiling on the transport backs this up for the families where a
  statement-level bound cannot be injected.
- **`n+1` is load-bearing.** Fetch one row past the cap and detect
  truncation by "more than n arrived", then trim to n. Fetching exactly n
  cannot distinguish "exactly n rows exist" from "at least n" — the same
  trick the pagination technique uses for `hasMore`, for the same reason.

## Errors arrive verbatim — with one edit

The engine's error text is the diagnostic: its error code, its position
marker, its hint lines are what the user searches, and what an experienced
user pattern-matches instantly. The console relays it whole — code, message,
detail — and may *add* interpretation (a friendlier summary, a link from a
position offset back to the editor location) but never *substitutes* one. A
paraphrased engine error is the console deciding it understands the engine
better than the engine, in front of a user who needed the original.

The one permitted edit is **secret scrubbing**. Connector errors routinely
echo the request that failed — a URL with a token in it, a host string, an
auth header — and the console sits downstream of a credential vault whose
whole promise is that values do not surface. So every failure path passes
through one scrubber that redacts every credential field value it knows
about, regardless of the value's length (a short value exemption is a
short-token leak), *before* the message reaches the result area, the
transcript, or a log. Verbatim engine text; zero credential text.

## Export leaves honestly

Copy and export are part of fidelity, because they are where values leave
the console's rendering and re-enter the world as text: `NULL` must not
export as the string "NULL" indistinguishable from a real string; big
integers export with all their digits; a truncated window exports with its
truncation stated (or refuses to pretend it is the full result). The export
is quoted downstream with none of the grid's visual caveats attached — so
the caveats must travel in the data or the user carries a falsehood
somewhere the console cannot correct it.
