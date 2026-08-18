---
layer: technique
subject: data-access
technique: query-construction
status: forged
laws: [one-validation-door, one-authority-per-vocabulary]
shared_with: []
---

# Query construction

A query is a program written in a language the host compiler cannot check,
assembled as a string, and executed with the store's full authority. Query
construction is the discipline of assembling those strings so that the unsafe
spellings are not merely discouraged but *unavailable* in ordinary code.

## The two-kinds rule: values and identifiers are different problems

Everything that goes into a query is one of two things, and they have
opposite disciplines:

- **Values** — the user's search text, an id, a timestamp bound into a
  predicate. Values are *always* bound parameters, carried alongside the
  statement and delivered to the engine out-of-band from the query text.
  No exceptions: not for integers "that can't contain quotes", not for
  values from internal callers, not for constants that are "obviously
  safe". The moment one interpolation site exists, review must distinguish
  safe interpolation from unsafe — and that distinction is exactly what
  reviewers get wrong under load. A codebase where interpolating a value is
  *never* correct is a codebase where the defect is greppable.
- **Identifiers** — table names, column names, sort directions. No
  mainstream engine accepts these as bound parameters, and the need for
  dynamic ones is real: user-selectable sort columns, filterable fields,
  per-tenant table prefixes. The discipline is the **allowlist**: a closed,
  centrally defined map from external token to internal identifier. The
  caller passes `"created"`; the map yields the real column name; an
  unrecognized token is a hard error naming the token — never a
  pass-through, never a best-effort quote-and-hope. The map is a closed
  vocabulary and it lives in exactly one place
  ([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary));
  a second copy near the UI layer will drift from it the first time a
  column is renamed.

Sort *direction* deserves the same treatment despite feeling harmless: it is
a two-value vocabulary, so it is an enum or a two-entry map, not a string
spliced into the statement.

## Builders own the placeholder bookkeeping

Static queries can be static strings — that is the best form: reviewable at
a glance, greppable, no machinery. Construction machinery earns its place
when predicates are *optional*: a listing endpoint with five filters, any
subset active.

The hand-rolled version keeps a string and a values array in parallel and
numbers placeholders manually. Its failure mode is structural: insert one
predicate in the middle and every subsequent index shifts; forget to push
one value and every later binding is silently off by one — which is not a
crash but a query that *runs and returns wrong rows*. Parallel
hand-maintained sequences drift; that is what parallel hand-maintained
anything does.

The repair is a small builder with one invariant: **a predicate and its
values are appended in a single call, and the builder derives the
placeholder indexes from its own state.** The caller writes "and this
condition with this value"; the builder tracks how many parameters exist and
emits the right placeholder. Off-by-one is no longer a spelling the API
offers. The same builder is the natural home for the assembly-order rules
(where the filtering clauses end and ordering/limiting begins) so partial
queries cannot be composed in an order the grammar rejects at runtime.

A builder is *not* a general query language for callers. It composes the
handful of shapes the repository actually needs — conjunctive filters,
membership lists, ordering from an allowlist, limits. The moment it accepts
arbitrary raw fragments from above as a convenience, every guarantee in this
document has a bypass, and the bypass is the API's fault.

## Escaping is hoisted to one place

A few constructs need actual text transformation rather than binding —
pattern-match searches are the perennial one, where the user's text must
have the pattern language's wildcards neutralized before it is bound (bound,
still! escaping and binding are complementary, not alternatives). The rule
is the one-door rule applied to text handling
([one-validation-door](../../_laws.md#one-validation-door)): **one function
owns each escaping concern, and every call site uses it.** The second,
locally re-implemented copy is the one that forgets the escape character
itself needs escaping. Hoisting has a second payoff: the single
implementation is the single place to write the property tests.

## The escape hatch is marked, not absent

Some statement will eventually be unbuildable within the safe API — an
engine-specific maintenance command, a pathological report. Refusing an
escape hatch just drives people to a lower layer with no rules at all. The
right design admits a raw path with three properties:

1. **It is named so it reads as what it is** — a name that flags unchecked
   text, unmissable in review and trivially greppable.
2. **It still binds values.** Raw statement text never implies interpolated
   values; the hatch relaxes the *shape* discipline, not the value
   discipline.
3. **Its uses are enumerable and each one is justified where it stands.**
   An audit of the hatch is a short read, forever.

## The statement should be reconstructible

Whatever machinery assembles the query, the final statement text plus its
parameter list must be observable — loggable on error, printable under a
debug flag. Diagnosing a wrong-rows report requires seeing what the store
actually received; a builder that cannot show its output turns every such
report into archaeology. (Log the parameter *shapes or redacted values*
where the data is sensitive; the statement text itself is never secret —
it contains no values, because values are bound.)

## What review still owns

Construction discipline removes the mechanical vulnerability class; it does
not make queries correct. Predicate logic, index-friendliness of the
generated shapes, whether the membership list should have been a join —
those stay human judgments, now exercised over a small, centralized, legible
surface instead of a diaspora of string fragments. That concentration of
review attention is the quiet second benefit of everything above.
