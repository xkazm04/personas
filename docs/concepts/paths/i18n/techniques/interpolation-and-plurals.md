---
layer: technique
subject: i18n
technique: interpolation-and-plurals
status: forged
laws: [one-validation-door]
shared_with: []
---

# Interpolation and plurals

Grammar varies by language along every axis a developer is tempted to
exploit for string reuse: word order, plural categories, gender agreement,
punctuation, capitalization. The technique's single organizing rule:
**the unit of translation is the complete message**, with dynamic values as
typed placeholders inside it — never a sentence assembled from translated
fragments.

## Concatenation is the original sin

`"Deleted " + count + " items from " + name` encodes the source language's
word order into code. Many languages put the count elsewhere, inflect
"items" by the count, or inflect "from" by the gender of the target. Every
concatenation site is a sentence no translator can fix, because no single
catalog entry contains it. The same applies to the subtler forms:
a translated message glued to a separately translated suffix, a shared
"prefix" key reused across contexts, sentence case applied
programmatically. If two surfaces need sentences that differ only by a
word, they get **two keys** — key count is cheap; grammatical correctness
across locales is not.

## Placeholders are a contract, validated at the door

A message with placeholders — `"Deleted {count} items from {name}"` — is a
function signature that happens to be prose. The placeholder set is the
contract between the code (which supplies values) and every translation
(which must consume exactly that set):

- A translation that **drops** a placeholder silently loses information in
  one locale.
- A translation that **mangles** one (`{count}` → `{cuenta}`) renders the
  broken token literally, or throws, in one locale.
- Code that renames a placeholder breaks every locale at once — which at
  least has the decency to be visible.

Because translations arrive through a pipeline (see
[completeness-gates](completeness-gates.md)), placeholder integrity is
enforced at the pipeline's merge step — the
[one validation door](../../_laws.md#one-validation-door) through which all
locale content passes. The merge refuses any value whose placeholder set
differs from the source's. This turns a class of per-locale runtime defects
into a pre-merge diff, which is the entire point of having a door.

## Plurals are variants, not arithmetic

Languages disagree on how many plural forms exist (from one to six) and on
which counts select which form. Therefore:

- A pluralized message is a **family of variants** keyed by plural
  category, selected at runtime by the locale's plural rules applied to
  the count. The source language authors the variants it distinguishes;
  each locale authors the variants *its* grammar distinguishes.
- `"item" + (n > 1 ? "s" : "")` is concatenation wearing a disguise, and
  "1 item(s)" is surrender. Both encode one language's plural system into
  every locale.
- The count usually also appears *inside* the message as a placeholder —
  selecting the variant and rendering the number are separate operations
  on the same value.
- Zero is a copy decision, not just a plural category: "0 results" and
  "No results" are different products. Where the empty case has its own
  voice, it gets its own key.

## The glossary: what translation must not touch

Every product carries terms that stay invariant across locales: brand
names, product names, protocol and format names, trademarked features.
These live in a **glossary** — a reviewed list shipped to every translator
(human or machine) and enforced where practical by the same merge door
(a glossary term present in the source but absent from a translation is at
minimum a warning). The glossary is also the tolerance list the value-parity
scan consumes: the two artifacts must be one artifact, or they drift.

## Numbers, dates, and lists are formatters, not strings

Anything with locale-dependent *rendering rules* — number grouping,
decimal separators, dates, relative times, list joining ("a, b, and c") —
goes through the platform's locale-aware formatters, not through catalog
strings or hand-built formatting. The catalog owns *words*; formatters own
*notation*. A message that needs a formatted value takes it as an
already-formatted placeholder. Hand-rolling "1,234.56" or "3 days ago" in
string logic recreates, badly, tables that every platform already ships.
