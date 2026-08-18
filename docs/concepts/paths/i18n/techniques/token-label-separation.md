---
layer: technique
subject: i18n
technique: token-label-separation
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Token–label separation

Backends and protocols speak in **machine tokens**: `queued`, `failed`,
`critical`, `paused`. Users read **display strings**: "Queued", "Fehler",
"重大". The technique is the disciplined boundary between the two — because
every defect in this area comes from one species impersonating the other.

## Tokens are identity; labels are presentation

A token is a member of a closed vocabulary. It crosses process boundaries,
lands in storage and telemetry, drives conditionals, and must therefore be
**stable and language-agnostic forever**. A label is what one locale calls
that token today, owned by the catalog, freely rewritable by a copywriter.

The two failure directions:

- **Token rendered raw.** `EXEC_QUEUED` in a badge is the visible defect —
  the system's internal vocabulary leaking into the user's field of view.
  It is also the *self-reporting* defect, which makes it the cheap one.
- **Logic branching on a label.** `if (status === "Queued")` works in the
  author's locale and breaks in thirteen others — or breaks everywhere the
  day the copy changes. This is the expensive direction because it fails
  far from its cause. The rule is absolute: **comparisons, persistence,
  filtering, and telemetry use tokens; only the final rendering step uses
  labels.** A label is a dead end — data flows *into* it, never out.

## The mapping layer: per-category token→label maps

Between the species sits one mapping layer: for each token **category**
(execution status, severity, connector state, …), a map from token to
catalog key. Structure it per category, not as one global map, because the
same token text recurs across categories with different meanings and
different translations ("failed" as an execution outcome and "failed" as a
health probe are different words in many languages).

The map is the *derived* half of a pair whose authority is the token
vocabulary itself
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)):
when the vocabulary grows a member, the map and the catalog grow with it in
the same change. The strongest form makes the compiler enforce this — the
map's domain type is the token union, so an unmapped token is a build
error. Where the vocabulary is open at the edges (tokens minted by a server
newer than the client), the map cannot be total by construction and the
next section becomes load-bearing.

## The unknown-token path is part of the design

A client will eventually receive a token it has no label for — version
skew guarantees it. The resolution function is therefore **total by
policy**:

- Render an honest degradation: the token itself, case-normalized, or a
  generic label for the category — never an empty string, never a crash.
- Report the miss to telemetry with the token and category attached — in
  production, not only in development builds, because version skew is a
  production phenomenon. An unknown token is a *mapping gap with a
  timestamp*: it names exactly which vocabulary grew without its label,
  which makes the fix a one-line catalog addition instead of a bug hunt.

The runtime report is the reactive half. The proactive half is build-time:
diff each category's label map against its vocabulary's authoritative
definition, because a label absent for a token is absent identically in
every locale and therefore invisible to every locale-parity check — the
domain-coverage gate of
[completeness-gates](completeness-gates.md).

## What stays token-shaped end to end

Some strings look user-facing but are actually tokens in transit and must
not be translated: values in export formats consumed by other software,
identifiers in deep links and query parameters, keys in configuration
files, anything an automation might match on. The test is the audience: if
any consumer is a machine, the string is a token, and a *parallel* display
label serves the humans. Translating a token because it "shows up in the
UI somewhere" fractures every automation built on it — one vocabulary,
fourteen spellings, zero matches.
