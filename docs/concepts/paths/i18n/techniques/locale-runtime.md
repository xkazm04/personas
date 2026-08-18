---
layer: technique
subject: i18n
technique: locale-runtime
status: forged
laws: [creation-names-reaper]
shared_with: []
---

# Locale runtime

The catalog's architecture decides what exists; the runtime decides what
the user *experiences*: which language paints first, what a language
switch feels like, whether right-to-left users get a mirrored product or a
broken one, and whether layout survives German. These are product-quality
questions with engineering answers.

## First paint is in the user's language

The single most visible localization defect after mixed language is the
**source-language flash**: the app paints in the source locale, then
re-renders in the user's once the translation chunks arrive. To the
returning user this reads as flicker at best and "the app forgot my
language" at worst. The standard:

- The user's locale choice **persists locally** and is read before first
  render — not after mount, not from a server round-trip.
- Section loading for the persisted locale (base sections plus the
  sections of the last-active navigation context) **begins before the UI
  mounts**, and mount waits for it — behind a hard time bound. Past the
  bound, paint proceeds and fallback covers the stragglers: a bounded wait
  trades tens of milliseconds against the flash; an unbounded wait trades
  availability against it, which is the wrong trade.
- The document's language and direction attributes are set in the same
  pre-mount step, so assistive tech and font selection are correct from
  the first frame.

## Switching languages is a first-class flow

A language switch mid-session touches every rendered string. The standard
experience is: instant for the sections already loaded, near-instant for
the rest — achieved by **prefetch on intent**. The moment the user opens
the language menu (or hovers a candidate), the runtime warms that locale's
base sections in the background; by the time they commit, the switch is a
re-render, not a loading state. Cost analysis: a wrong-guess prefetch
wastes a few kilobytes; a cold switch shows the user a product that
stutters in the exact moment it is being judged on language quality.

Loaded-section state is per-locale, and a switch away releases interest in
the old locale's chunks — whatever caching layer holds them needs a stated
eviction story ([creation names its
reaper](../../_laws.md#creation-names-reaper)); "both locales stay resident
forever" is an acceptable answer only if written down as a bounded cost,
not reached by default.

## Right-to-left is a layout dimension, not a translation

Supporting a right-to-left language means the *geometry* mirrors: reading
order, chevron directions, progress direction, the side icons sit on.
Mechanically this is won or lost long before the locale ships:

- Layout uses **logical properties** (start/end) rather than physical ones
  (left/right) everywhere, so mirroring is the platform's job.
- Direction is set once at the document root from the locale, and
  exceptions (numerals, code snippets, user content in a left-to-right
  script) are explicit islands.
- Icons that encode direction (back arrows, "next" chevrons) mirror;
  icons that encode objects (a magnifier) do not. That distinction is a
  design-review item, not something a stylesheet can infer.

## Pseudo-locale testing: find the breakage before the translator does

Real translations arrive late and vary; a **pseudo-locale** is available on
day one. Generated mechanically from the source catalog, it expands every
string (~30–40%, matching the real expansion of verbose languages), wraps
it in markers (`⟦…⟧`), and optionally accents the characters. Running the
product in pseudo-locale makes three defect classes jump out:

- **Truncation and overflow** — layouts sized to source-language strings.
- **Hardcoded strings** — anything *not* wrapped in markers bypassed the
  catalog; this is the cheapest whole-product sweep for extraction gaps
  (complementing the static enforcement in
  [string-extraction-enforcement](string-extraction-enforcement.md)).
- **Concatenation seams** — markers appearing mid-sentence reveal
  fragment assembly.

Pseudo-locale is a build-time artifact riding the normal locale machinery
— it costs one generated file and pays for itself the first week.

## Layout tolerance is part of the contract

Even without pseudo-locale discipline, the runtime standard assumes string
length is locale-variable by design: buttons size to content with padding,
truncation appears only with a full-value recourse, and line-wrap is the
default for labels. A layout that only works at source-language lengths is
a localization defect filed under styling.
