---
layer: technique
subject: status-vocabulary
technique: vocabulary-evolution-checklist
status: forged
laws: [one-authority-per-vocabulary, identity-survives-reuse, deletion-is-not-repair]
shared_with: []
---

# Vocabulary evolution checklist

The four-layer structure of a display vocabulary is paid for on every
change: one new member touches storage constraint, wire token, label
catalog, and presentation table — **in one change** — or the chain drifts
at whichever layer was forgotten. The forgotten layer always fails
silently: a write the storage still rejects, a raw token in a badge, a
grey pill with no label. So the discharge list is not documentation
around the technique; it **is** the technique, because the failure mode
is precisely "a competent person did three of the four."

## Adding a member

1. **Establish that the vocabulary does not already exist.** Search the
   wire types for a union with your members and the catalog for a
   category — before minting. The measured failure is two severity
   scales sharing one catalog category, with the member unique to the
   second scale rendering raw in the very file that declared it. Do not
   make it three.
2. **Extend the authority** — the closed type at the source of writes.
   Everything else derives from this edit.
3. **Mirror the storage constraint in the same change**, so the database
   accepts what the type now allows. (Prefer widenable constraint forms:
   where the storage engine's native enumerated types make adding a
   member a migration ordeal, teams measurably stop extending the
   vocabulary and start overloading existing members — one sibling chose
   the widenable form 26 consecutive times after two experiences with the
   native one.)
4. **Regenerate the wire artifact and commit it.** This is the step that
   makes the member exist for the consumer; skipping it is how
   status-shaped fields decay to bare strings.
5. **Add the label to the catalog — in every shipped locale, same
   change** — through the translation pipeline, not by hand. Write the
   human phrasing, not a title-cased echo of the token: an editorial gap
   ("in_flight" → "In Flight") is why nobody notices the label was never
   really written.
6. **Extend the one presentation table.** If it is keyed by the union —
   as [status-color-mapping](status-color-mapping.md) requires — the
   compiler has been pointing at this step since step 2.
7. **Re-affirm the unknown direction.** The fallback entry still exists
   and still degrades the right way; if this member changed the
   vocabulary's severity ordering, the fallback may need to move.

Steps 2–6 are one commit. The compile-time coverage check from
[vocabulary-chain-integrity](vocabulary-chain-integrity.md) turns "forgot
step 5 or 6" into a build error that names the member; without it, the
checklist is held up by memory alone.

## Renaming a member

There is no in-place rename. A stored token is **identity** — it survives
in rows, exports, telemetry, and other systems' automations
([identity-survives-reuse](../../_laws.md#identity-survives-reuse)) — so
a rename is *add the new member → migrate stored data → retire the old
member*, three steps with the retirement gated on measured zero
occurrences. What a rename usually wants is actually a **label** change:
the catalog is freely rewritable precisely so the token never has to be.
Confusing the two is the root of most rename pain; say which one you
mean before touching anything.

## Retiring a member

The mirror checklist runs **top-down** — consumers first, authority last:

1. Stop producing the member; migrate or terminally resolve stored rows.
2. Verify zero occurrences at rest and in flight (and remember external
   consumers: exports and automations match on tokens).
3. Narrow the presentation table and the catalog.
4. Narrow the wire type, regenerate, narrow the storage constraint.

Deleting the label or the table entry *first* converts every remaining
occurrence into the unknown-token path — shipping the degraded rendering
to exactly the rows that still exist
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)). The
unknown path is a safety net for skew, not a retirement mechanism.

Dead members rot in the other direction too: labels for tokens the wire
can no longer emit survive every completeness check (they are present in
every locale) and cost translation forever. The authority-↔-catalog
coverage gate should diff **both directions**
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)
cuts both ways: the catalog must not lag the vocabulary, and must not
outlive it).
