---
layer: technique
subject: search
technique: query-parsing
status: forged
laws: [one-validation-door, failure-not-empty-success]
shared_with: []
---

# Query parsing

The user types in one language; the engine executes another. Query parsing is
the translation layer between them, and its first rule is that the two
languages are **never the same language**. An engine's expression syntax —
boolean operators, phrase quoting, prefix stars, column filters — is an
implementation surface. The moment raw user text reaches it unescaped, three
failure classes open at once: innocent punctuation becomes a syntax error
(a hyphenated word read as negation, a quote read as an unterminated phrase),
accidental operators silently change the query's meaning, and — where the
engine is powerful enough — user text becomes an injection vector into
whatever the expression language can reach.

## One door

All translation happens at a single, named function: raw text in, engine-safe
expression out. Every caller that executes a search goes through it; no call
site builds engine syntax by string concatenation on its own. This is the
one-validation-door law applied to queries — sanitization sprinkled across N
search boxes is sanitization minus the box added next quarter, and query
escaping is exactly the kind of subtle, easy-to-half-remember logic that
diverges when duplicated.

The door owns more than escaping: it owns the **matching policy** — case
folding, diacritic folding, whitespace handling, whether multiple words must
all match. Measured across independent codebases, this policy is the single
most re-derived decision in the subject: dozens of call sites each lowercase
and substring-match inline, none of them folds diacritics, and in a
multi-locale product every one silently fails on accented input — while the
same codebases handle locale correctly when *ordering* strings, because
ordering has one named function and matching has none. Give matching the
same treatment: one named matcher with correct-by-default normalization, and
route every surface through it, because a policy set once per call site can
never be corrected centrally.

The door's core move is **tokenize, then quote**: split the user's text into
words on whitespace and punctuation the engine treats as structure, wrap each
surviving token so the engine reads it as a literal, and only then compose the
tokens with operators *the door itself chose*. Operators are something the
door emits deliberately — never something that survives from input to output
by accident.

The door also **bounds the expression it emits**. Two limits earn their place
in every implementation: a minimum token length (single characters match half
the corpus and are noise, not signal) and a maximum term count (a pathological
paste — a page of text dropped into the search box — must become a bounded
expression, not a four-hundred-clause query handed to the engine). Both limits
are part of the door's contract, applied in one place, so every search surface
inherits them.

## Two grammars, explicitly

A well-designed search input supports structure without exposing engine
syntax, by owning a small user-facing grammar:

- **Field prefixes** — `status:failed`, `author:kim`. The parser recognizes a
  closed set of prefixes, lifts each into a typed filter, and removes it from
  the free-text remainder. Unrecognized prefixes stay in the free text as
  literals: a colon in ordinary prose must not vanish into a failed filter.
- **Phrase quoting** — quoted spans match as a unit. The parser honors
  balanced quotes and treats an unbalanced quote as a literal character, not
  an error.
- **Negation, if offered** — a deliberate, documented marker, parsed by the
  door, translated into whatever exclusion the engine supports.

The recognized structure is **reflected back visibly** — typically as removable
chips or highlighted tokens above or inside the input. This closes the loop in
both directions: the user learns the grammar by seeing what was understood,
and misparses become visible the instant they happen instead of silently
returning the wrong result set. A chip is also the correct deletion affordance:
removing a filter is one click on the thing itself, not surgery inside a text
string.

Everything the parser lifts out becomes typed state (a filter object with a
field, an operator, a value from the field's vocabulary); everything left
becomes the free-text term fed through the sanitization path. The two travel
together as the parsed query — the single artifact that downstream stages
(execution, ranking, count reporting, saved views) consume.

## The degradation ladder

A query that returns nothing is a fork in the road, and the honest path is a
**ladder of progressively weaker interpretations, each labeled**:

1. **As written** — all terms required, phrases intact, filters applied.
2. **All terms, unphrased** — phrase constraints relaxed to co-occurrence.
3. **Any term** — conjunction relaxed to disjunction; results now match *some*
   of what was typed.
4. **Prefix / partial** — terms matched as prefixes, catching the half-typed
   word and the near-miss.

Two rules govern the ladder. First, **descend only on empty** — never blend
rungs, or precise matches drown in fuzzy ones. Second, **label the rung** —
when the surface shows results for a weaker reading ("showing results matching
any of your words"), it must say so. Results from rung 3 presented as rung 1
answers a question the user didn't ask and lets them build conclusions on it.

## Failure is not an empty result

The parser and the engine can both fail, and each failure must be spelled
differently from a legitimate zero (the failure-not-empty-success law):

- **Unparseable input never errors at the user.** If the structured read
  fails, the door falls back to treating the entire input as literal text and
  searches that. Users cannot be blamed for a grammar they were never shown.
- **A degraded query is disclosed**, per the ladder above — the search that
  ran is not the search that was asked for, and the label is the difference
  between honesty and luck.
- **An engine error is an error state**, with a retry path — never rendered
  as "no results". Zero-because-nothing-matches invites the user to broaden
  the query; zero-because-the-engine-died invites them to broaden it forever.

## What the parsed query owes downstream

The parsed query is the predicate every later stage cites. Counts shown in the
surface are counts *under this parsed query* — filters included, degradation
rung included. Saved views persist the parsed form (typed filters plus raw
free text), not the raw input string alone, so that recalling a view does not
re-run a parse whose grammar may have shifted. And highlights in excerpts must
derive from the same term list the door produced — highlighting the raw input
while the engine matched the sanitized form produces marks that don't line up
with the match.
