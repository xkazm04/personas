---
layer: technique
subject: i18n
technique: string-extraction-enforcement
status: forged
laws: [one-validation-door, deletion-is-not-repair]
shared_with: []
---

# String extraction enforcement

The catalog is only an authority if display strings actually pass through
it — and nothing about writing code pushes them there. Typing English
directly into markup is faster, renders correctly in the author's locale,
and survives review by reviewers who read that locale. Extraction
discipline therefore cannot be cultural. It must be mechanical: a detector
that flags hardcoded display text at authoring time, plus a migration
policy for the backlog every real product already has.

Framed structurally: the catalog is the
[one validation door](../../_laws.md#one-validation-door) for the
product's voice, and hardcoded strings are writers bypassing the door.
Enforcement is the mechanism that makes the writers enumerable.

## What the detector flags

The target is **display text**: human-language content that reaches the
user's eyes or ears. That includes more than element text —

- text nodes in markup;
- the attribute surface users actually consume: placeholder text, tooltip
  and title text, accessibility labels and descriptions, image alternative
  text, confirmation prompts;
- display strings smuggled into data: label fields in constant tables
  (`{ id: 'active', label: 'Active' }`) — the standard shape is a *key*
  field (`labelKey: 'common.active'`) resolved at render time, which keeps
  constants serializable and the catalog authoritative.

Explicitly exempt, because their audience is not the user: identifiers and
class names, log and telemetry text, test fixtures, brand and technical
terms from the glossary, and user-generated content flowing through. The
exemption list is part of the rule's definition and reviewed with it —
every exemption is a hole the next hardcoded string will claim to fit.

## Enforcement posture: where the rule bites

A detector has three possible postures, and the difference is the whole
game:

- **Advisory (warn-level)** — visible as editor feedback while authoring,
  invisible at every gate. In a codebase with an existing warning backlog,
  new violations are statistically invisible; and a gate that runs with
  warnings permitted, or suppressed, enforces nothing *by construction*.
  Advisory posture correlates with adoption (authors see the squiggle) but
  it cannot hold a line.
- **Blocking (error-level) on new code** — the honest standard. New and
  modified files hold at zero violations; the gate fails on regression.
- **Blocking everywhere** — requires the backlog to be zero first; see
  migration below.

The trap between the first two: believing an advisory rule is enforcement
because it *exists*. Measure the posture at the actual gates (what fails a
commit; what fails the pipeline), not in the rule configuration's
vocabulary. And when an advisory rule's noise becomes irritating, the fix
is ratcheting it toward blocking — turning it off converts a visible
defect class into an invisible one
([deletion-is-not-repair](../../_laws.md#deletion-is-not-repair)).

## The migration policy: fix-as-you-touch

Every product that adopts extraction late has a backlog of hardcoded
strings. Two failure modes bracket the sane policy:

- **Bulk migration** churns hundreds of files in one change, floods
  translator throughput, buries real edits in mechanical ones, and — done
  by tooling — mints context-free keys nobody can review.
- **Ignoring the backlog** means the advisory count stays high forever,
  which keeps the rule un-promotable and normalizes violations.

The standard is the ratchet: **fix-as-you-touch**. Editing a file for any
reason includes extracting its hardcoded strings when the count is small;
larger files get a scoped extraction task. The backlog only shrinks, new
code holds at zero, and each extraction lands with an author who has the
context to name keys well and route them to the right section. Track the
backlog count over time — a ratchet nobody measures is a hope.

## The detector is a floor, not the test

Static detection sees string literals in known positions — and a detector
that keys on the *shape* a string wears (a text node, a known attribute)
defines its own blind spots: every shape it does not enumerate becomes a
place strings accumulate, and the strings that land there are not random
but exactly the ones that did not fit the enumerated shapes. It also
cannot see display text built dynamically, fetched from a server, or
laundered through a variable — and it cannot judge whether an extracted
key's translation actually arrived (that is
[completeness-gates](completeness-gates.md)' job). The end-to-end check is
running the product in a pseudo-locale (see
[locale-runtime](locale-runtime.md)): every unmarked string on screen is
an extraction gap, whatever the detector said. Green static analysis plus
a pseudo-locale sweep is the pair that approximates the real claim —
"every string the user sees came through the catalog".
