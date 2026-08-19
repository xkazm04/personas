---
layer: technique
subject: diff-comparison
technique: diff-honesty
status: forged
laws: [failure-not-empty-success, count-carries-predicate]
shared_with: []
---

# Diff honesty

A diff's most dangerous output is silence. The reader interprets every
unmarked region as "unchanged", every absent row as "never existed", and
an empty result as "nothing happened" — that inference is the entire value
of the surface, and the entire attack surface of its bugs. Honesty in a
comparison surface therefore reduces to one rule with five standing
applications: **every mechanism that can produce false silence must
disclose itself, on the surface, at the point where the silence occurs.**
A footnote in documentation does not count; the reader of a diff is not
reading documentation, and the disclosure must sit where the wrong
inference would form.

## Truncation is disclosed at the cut

Budgets, output caps, and first-N-differences are legitimate (the offload
technique owns choosing them). What is never legitimate is the
undisclosed tail: a diff that shows twelve differences and stops, when
forty exist, has *asserted* twenty-eight "unchanged" regions that are
nothing of the kind. The truncation marker sits at the point of cut, in
the reading flow — not a header asterisk — and it is quantified: "and 28
more differences" when the total is known, "further differences not
computed" when the budget died before counting. Those are different
statements; a truncated *computation* cannot honestly claim a remainder
count, and rounding it to one is a small lie in the place readers trust
most.

Truncation also has a **side**: it belongs on the *output*, never on the
*input* — and when input capping is unavoidable, the cut lands on a unit
boundary. Slicing two texts at a fixed character count *before* diffing
them cuts mid-line, and the alignment then dutifully reports the severed
line as an edit: a phantom difference manufactured by the safety measure,
at the exact position where the reader is told the comparison ends. Cap
by lines (or elements, or fields), never by bytes, and label the cap as a
cap rather than letting it surface as a change.

## The undiffable is declared, and "not compared" is a third state

Binary fields, encrypted values, opaque blobs, and everything the
normalization ledger excludes share one property: the comparison has
nothing to say about them. The dishonest renderings are the two easy
ones — showing them as unchanged (a fabricated claim) or omitting them
entirely (silence, read as unchanged). The honest rendering is a third
state, **not compared**, visually distinct from both changed and
unchanged, with the reason a tap away (binary; excluded as volatile;
unreadable). Comparison surfaces carry a trichotomy where most designers
assume a dichotomy — *different / same / no claim* — and the third value
is load-bearing: it is the difference between "the tool checked and found
nothing" and "the tool did not check", which is the exact distinction the
laws demand of every instrument.

## Failure is spelled as failure

An errored or timed-out comparison renders as "comparison unavailable" —
never as an empty diff, because "no differences" is a finding that
readers act on: approvals granted, reviews skipped, incidents closed
([_laws:
failure-not-empty-success_](../../_laws.md#failure-not-empty-success)).
The offload technique owns keeping the failure signal distinct in the
plumbing; this technique owns the surface obligation — the failed state
looks like a failure, sits where the diff would have been, and offers a
retry, so the cheapest path out of it is re-running the comparison rather
than trusting the void.

## Moved is not removed-plus-added

Where elements have identity and order matters, an element that moved
reads — under naive alignment — as a removal here and an addition there:
two changes, both false, drowning the true signal ("nothing changed but
arrangement") in the noisiest possible rendering. Where identity exists,
moves are detected and rendered as moves, with content-changed-and-moved
shown as both facts. Where move detection is heuristic — inferring that
"removed X, added X-prime" is one renamed element rather than two events
— the inference is *labeled* as inferred, because a wrong rename guess
actively misattributes history, and the reader has no way to distinguish
a detector's confidence from its formatting.

## The vocabulary matches the alignment

"Added" and "removed" are claims about *content* — the reader hears "this
knowledge is new" and "this knowledge is gone". A diff that aligns by an
identity which never survives the pair (fresh ids minted per run, so no
element of run A can ever match an element of run B) is an id-set
difference, and it will report two byte-identical runs as everything-added
plus everything-removed. That is honest arithmetic and a dishonest surface:
the kernel's own documentation may say "matching is by id", but the panel
is labeled a *run diff*, and the panel is what the reader reads. When the
alignment is weaker than the vocabulary, either strengthen the alignment
(match on content or a durable key) or weaken the words to what was
actually computed ("present only in run B") — never let a set difference
borrow the vocabulary of a change.

## The summary and the detail agree

Every number the surface promotes upward — badge counts, triage rows,
"3 fields changed" headers — is computed from the same comparison, under
the same predicate, as the detail it summarizes, and the predicate
travels with the number ([_laws:
count-carries-predicate_](../../_laws.md#count-carries-predicate)). The
degenerate failure is the header that says 3 while the body shows 2 —
usually one count computed pre-truncation or under a different exclusion
list than the render. A reader who catches the summary contradicting the
detail does not resolve the contradiction; they conclude the surface is
untrustworthy, and they are right. When the detail is legitimately
partial (truncated, degraded), the summary says so — "3+ fields changed"
or "partial comparison" — because a precise number over an imprecise
body is false precision wearing a badge.

## Honesty compounds

None of these disclosures is expensive; each is a label, a third state, a
marker at a cut. What they buy, jointly, is the only property that makes
the subject worth building: a reader who has seen the surface disclose
truncation, declare the undiffable, and spell failure as failure is a
reader who can finally afford the inference the diff exists for — *what
this surface does not mark did not change*. Honesty is not a garnish on
the diff; it is the mechanism by which silence becomes information.
