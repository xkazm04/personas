---
layer: technique
subject: i18n
technique: completeness-gates
status: forged
laws: [gate-sees-target, count-carries-predicate, failure-not-empty-success]
shared_with: []
---

# Completeness gates

A localized product's most expensive defect is quiet: a locale that claims
to be complete and is not. Users in that locale see the failure daily; the
team, living in the source language, never does. Completeness therefore
cannot be a posture ("translators catch up asynchronously") — it must be a
gate, and the gate must observe the right thing.

## The two parities — and the coverage question behind them

**Key parity** — every locale defines exactly the key set the source
defines:

- **Missing keys** are gaps: the locale will render source-language text
  through the fallback chain. Gaps are the visible half.
- **Extra keys** are drift: strings that survived a rename or deletion in
  the source. Extras are strictly worse than gaps — they cost bundle bytes,
  they shadow nothing, they rot silently, and their existence proves the
  pipeline let a structural change through unreconciled. **Extras always
  fail, in every mode of every check.** A gate lenient on extras converts
  every key rename into permanent sediment.

**Value parity** — a defined key is not necessarily a *translated* key. A
locale seeded by copying the source file passes key parity at 100% while
every value is byte-identical source text. This is the classic lie of the
subject: a green "0 missing" report over a locale no native speaker could
call translated. The key-parity gate reads key *sets*; the thing it exists
to protect is translated *values*; those diverge exactly when someone
bulk-copies to silence the gate —
[the gate must see its target](../../_laws.md#gate-sees-target).

So the standard requires **both checks**: set difference for key parity,
and a value-identity scan for untranslated content. Two scoping decisions
make the value scan honest rather than noisy:

- **A tolerance list** — brand names, technical terms, and short cognates
  are legitimately identical across locales. The list is a maintained,
  reviewed artifact, because it is precisely the hole through which the
  next bulk-copy will try to pass; and it should be the same artifact as
  the translation glossary (see
  [interpolation-and-plurals](interpolation-and-plurals.md)), or the two
  drift.
- **Scope to live keys.** An untranslated value on a key no consumer
  references is not a user-visible defect — it is dead weight for the
  purge pass, and counting it dilutes the gate's signal. But liveness is
  itself a measurement: if the reference scanner cannot run, the gate must
  fail safe by checking *everything*, not skip what it cannot classify.

## The third check: domain coverage

Both parities compare **catalogs to catalogs** — and a symmetry limit
follows: a key absent *identically* from every locale (minted in a backend
vocabulary, never added to the source catalog at all) is invisible to any
locale-vs-locale comparison, by construction, not by oversight. The user
sees a raw token or silent source-language text; every parity board is
green.

The vocabularies a catalog exists to label live **outside** it — enum
definitions, storage constraints, protocol contracts — so completeness
against them is a cross-boundary check: diff the catalog's label space
against each vocabulary's authoritative definition (the same authority
[token-label-separation](token-label-separation.md) binds its maps to).
And place the gate where that defect is created: a domain gap is born by
an edit to the *vocabulary*, usually in another language and another
directory than the catalog — a gate that fires only on catalog edits is
watching the wrong door. Ask what edit creates the defect; attach the gate
to that edit.

Every completeness number states its predicate
([count-carries-predicate](../../_laws.md#count-carries-predicate)):
"0 missing **keys**" and "0 untranslated **values**" are different claims,
and a report that says only "0 missing" will be quoted as the second claim
while proving only the first.

## Where the gate runs: at the door, not in a report

The enforcement point is **the commit that touches the catalog**. When a
change adds keys to the source, the same change carries the translations
for every shipped locale, and a pre-commit check blocks the gap from ever
entering history. Weekly coverage reports are archaeology; commit-time
gates are prevention — and the difference compounds, because a gap that
lands invisibly (fallback renders source text; nothing looks broken to the
author) is a gap nobody is assigned to.

Gate mechanics that matter:

- The check reads the working tree, so source and locale files must stage
  together — a gate that reads only staged content can be split around.
- The strict (fail-on-gap) mode binds to catalog-touching commits; the
  advisory mode may run wider. But an advisory mode is telemetry, not
  enforcement — never count it as the gate.
- The gate distinguishes "checked, zero gaps" from "found nothing to
  check": a run that matched no catalog files, or failed to parse one, is
  an error, not a pass
  ([failure-not-empty-success](../../_laws.md#failure-not-empty-success)).

## The pipeline that makes the gate humane

A gate that blocks gaps is only sustainable if closing a gap costs minutes,
not an afternoon of hand-editing a dozen locale files. The standard
pipeline has three stages:

1. **Extract** — compute the exact gap: which keys, which locales, emitted
   as per-locale work units carrying the source text and any translator
   context.
2. **Fill** — translate each work unit, one worker per locale (human,
   machine, or model-assisted; the pipeline is agnostic). Machine-quality
   translation is an acceptable floor here: the bar the gate enforces is
   "no source language mixed into a shipped locale", and a human can polish
   later without re-running anything, because the keys are all present.
3. **Merge, validating** — the merge is the door
   ([one validation door](../../_laws.md#one-validation-door) for the
   locale files), and it refuses: any locale that dropped keys, any value
   that broke a placeholder (see
   [interpolation-and-plurals](interpolation-and-plurals.md)), any file
   that no longer parses. On success it re-derives the split sections and
   re-asserts strict parity — the pipeline ends by re-running the gate it
   exists to satisfy.

## The fallback moral hazard, restated as policy

Runtime fallback makes every gap invisible in the source locale, which is
where the whole team lives. Policy, therefore: fallback is for *lag the
gate has not yet seen* (a section chunk in flight, an emergency hotfix
string), never a shipping state. The moment "the fallback will cover it"
appears in a review comment, the completeness standard is being repealed
one string at a time.
