---
layer: technique
subject: status-vocabulary
technique: status-color-mapping
status: forged
laws: [one-authority-per-vocabulary]
shared_with: []
---

# Status color mapping

Color is the fastest channel a status has — read before the label, from
across the room — which is why it is also where drift is most visible and
most reinvented. The technique is a chain of two mappings with one table,
one decided fallback direction, and a redundancy rule.

## Vocabulary → semantic role → themed value

Status color is a **token-mediated coupling** between two closed
vocabularies: the status set and the design system's semantic color roles
(success, warning, danger, info, neutral, plus the handful of
domain-earned extensions). The mapping runs vocabulary → role → themed
value; the call site never touches the third link. A raw color literal
beside a status member re-decides theming, contrast, and dark-mode per
badge — and when the palette changes, the sites that hand-picked their
green are exactly the ones no sweep can find. The role layer belongs to
[design-tokens](../../design-tokens/design-tokens.md); this technique owns
the first link and its table.

The palette's shape matters too: a status color is not one value but a
small **slot set** (text, background, border, ring, icon/dot — and, where
canvas or vector consumers exist, a raw color value the class-based slots
cannot supply). When a consumer needs a slot the shared palette lacks, the
correct move is to **widen the slot set**, not fork the palette — measured
decay in one repo: a single grade vocabulary accumulated three competing
palettes with eight, three, and two slots, each individually type-safe and
collectively unmaintainable, because the shared token type was five slots
wide and the consumers wanted eight. The fork is the symptom; the missing
slot is the cause.

## One table, keyed by the union, carrying color and label together

Per vocabulary there is **one** presentation table, keyed by the wire
union, whose entries carry the color role *and* the label key side by
side. Both halves of the rule are earned:

- **Keyed by the union** — so a new member is a compile error, not an
  `undefined` lookup rendering a colorless pill. Keying the same table by
  a bare string is the single highest-leverage error in the area: the
  type system was right there, and the author turned it off.
- **Color and label in one entry** — because two parallel tables (a color
  map here, a label map there) drift precisely when a member is added to
  one of them, and the degradation is silent. The repos that learned this
  wrote the post-mortem into the merged table's own doc comment.

The badge component itself stays **vocabulary-agnostic or token-fronted**
— either it takes a color role and children (and the table wires both),
or, better, it takes the *token* and owns the table internally. Three
independent codebases converged on the token-taking signature; the one
that took children plus a color needed every consumer to hand-wire the
same three lines, and grew dozens of divergent copies.

## The unknown direction is a decision, made once, out loud

Every table needs a fallback entry, and the fallback has a *direction*:

- For a **state** vocabulary: neutral — a grey pill and an "unknown"
  label. Calm is honest here; the system merely has not learned the word.
- For a **severity or approval** vocabulary: the **most severe / least
  approved** member. A future member must never make the interface claim
  that something published itself, resolved itself, or needs no
  attention, when a human is in fact still owed a decision.

Degrading toward the calm value is the measured convergent mistake —
independent teams sent unknown severities to "low/blue" and unknown
statuses to green — and only one team in the measured set noticed there
was a direction to *choose* and wrote the reasoning beside the fallback.
Copy the reasoning, not just the entry. And never assert the raw-token
render in a test: that turns the defect into specified behavior the next
person cannot fix without "breaking" something.

## Never color alone

Each status must be distinguishable by **shape as well as color** — an
icon, a dot versus a ring, a fill versus an outline — because a
non-trivial fraction of users cannot distinguish the palette's hues, and
because status color is routinely the *only* difference between two rows.
Put the icon in the same table entry as the color role; a second
icon-only map is the two-parallel-tables drift wearing a different hat.
The deeper floor is [accessibility](../../accessibility/accessibility.md)'s;
this technique's contribution is structural: one entry, all channels.

## Scale condition — when the shared palette earns existence

The label indirection pays from the first locale; the **shared** color
palette pays from roughly ten consuming surfaces. Below that, a local
table typed against the union is correct, and consolidating it is
over-engineering. Above it, feature-local tables metastasize — measured:
eighty feature-local token→presentation maps against a shared palette
imported by ten files. The signal to consolidate is not the count alone
but the first *disagreement*: two surfaces rendering the same member in
different hues is the vocabulary speaking with two voices
([one-authority-per-vocabulary](../../_laws.md#one-authority-per-vocabulary)).
