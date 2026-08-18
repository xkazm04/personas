---
layer: golden-path
subject: docs-sync
status: forged
techniques:
  - source-doc-mapping
  - same-change-enforcement
  - coupled-surface-inventory
  - dated-corrections
  - doc-rot-detection
  - catch-up-markers
evidence:
  - scripts/docs/feature-doc-map.json                          # the coupling as data: 37 entries, 131 sourceGlobs, three target types (doc / onboardingFlows / marketingModule), 38 registered tour flows
  - scripts/docs/check-doc-map-paths.mjs                       # the one LIVE machine check in the surface: 77 named nodes all resolve, wired into `npm run check` — it validates what the map names, and can never validate what the map omits
  - src-tauri/src/commands/infrastructure/doc_rot.rs           # doc-freshness scan with UNVERIFIABLE as a first-class verdict ("rendering it as clean was this detector's biggest lie"); map-first, colocation-second coupling discovery
  - .claude/guide-sync-marker.json                             # catch-up marker: lastSyncCommit + topicsUpdated + missingCoverage as honest recorded gaps — and a cautionary "the hook now prevents this drift" note written the very day the dead hook landed
  - .claude/skills/guide-sync/SKILL.md                         # the bounded catch-up pass that reads the marker to know its range
  - .claude/CLAUDE.md                                          # the dated-correction exemplar: corrections in place with date + measurement, corrections-of-corrections, and a resolved-marker that names its verification date
  - docs/concepts/golden-paths/documentation-sync.md           # the measured autopsy: 100 transcripts replayed, 477 editing turns, 2,367 edits, 0.00% visible to the hook; satisfaction precision 45.7%; 33% of source unmapped
counter_evidence:
  - scripts/docs/check-doc-sync.mjs                            # THE never-fired hook: its transcript walk breaks on the first event shaped `type:"user"` — which is exactly the shape a tool result wears (93.0% of such events), so it exits 0 on every turn since 2026-05-16 (deferred fix #105)
  - scripts/docs/__tests__/check-doc-sync.test.mjs             # 30 assertions, all green, over synthetic transcripts containing no tool_result events — a fixture that models the input's theory, not its production shape
deviations:
  - w12-docs-sync   # anchor in docs/concepts/golden-path-deferred-fixes.md (wave-12 reconciliation; the P0 transcript-walk bug is already registered there as fix #105 — reported, not edited, per the forge brief)
---

# Docs-as-code synchronization

Documentation is a standing claim about a system that keeps changing, and every
change to the system silently re-litigates every claim ever written about it.
The build does not go red when a guide describes a tab that was renamed, a
setup step that was automated away, or an architecture line that stopped being
true two quarters ago — documentation drift is the defect class with **no
crash, no failing test, and no complaining user in the loop**, because the
reader who is misled rarely knows it and almost never files a report.
Docs-as-code synchronization is the discipline that treats documentation as a
coupled artifact of the source: the coupling is **declared as data**, the debt
is **collected at the change boundary** rather than by periodic campaign, the
prose is **corrected in place with dates and measurements**, the rot that
slips through is **detected by scan**, and the batch repair that then becomes
necessary anyway is **bounded by a marker**.

One law towers over this subject, inherited from the gate doctrine and paid
for here in full: **a sync gate must observe the change it gates.** This
subject carries the most instructive counter-example in the graph. A
per-change reminder hook — designed, wired, documented, complete with a
dismissal protocol its instruction file described as "the explicit trade-off"
— was measured by replaying one hundred real agent-session transcripts:
**477 turns edited files, 2,367 individual file edits, and the hook's input
walk saw zero of them — 0.00%, across fifteen months of operation.** Its
backward walk stopped at the first event shaped like a user message, and a
tool result is recorded in exactly that shape (93.0% of all such events), so
in any turn that used a tool the walk terminated before reaching a single
edit. Invoked directly on twelve real transcripts holding up to 209 edits
each: exit 0, twelve of twelve. Every dismissal anyone remembered making was
a dismissal of a message that was never sent, and the enforcement the
project's own instructions described was, the whole time, **documentation
cosplaying as enforcement**. The same repository also holds the discipline's
best practice — a correction culture where false claims are amended in place
with the date, the measurement, and sometimes a correction of the correction
— which is why this subject can show both edges of the blade from one tree.

## Where this subject's walls sit

The subject owns the *coupling* between source and every prose surface that
describes it, and the machinery that keeps the coupling honest. It does not
own general gate mechanics — instrument assertion, seeded failures, hook house
rules belong to [quality-gates](../quality-gates/quality-gates.md), and this
subject is that doctrine's sharpest applied case rather than a restatement of
it. It does not own scanning pipelines — sensors, finding lifecycles, and
triage economics are [codebase-scanning](../codebase-scanning/codebase-scanning.md);
this subject contributes the docs-specific sensor and its verdict vocabulary.
It does not own what a tour step contains
([guided-tours](../guided-tours/guided-tours.md)), what a translation catalog
demands ([i18n](../i18n/i18n.md)), or how a changelog rides a release
([release-pipeline](../release-pipeline/release-pipeline.md)) — it owns the
fact that each of those is a *coupled surface* a source change can owe.

## The six load-bearing walls

### 1. The coupling is data, not lore

Which documents a change owes is a fact about the system, and facts about the
system live in declared, machine-readable artifacts — one map, entries of
"these source areas couple to these prose targets," extended in the same
change that adds a feature area. A map nobody has to remember is the only
kind that survives staff turnover and agent-driven development. But a
declared map has a failure mode as quiet as the drift it exists to catch:
**the map is the real gate, and whatever it omits is invisible by
construction.** Measured here: a third of the source tree — 1,421 of 4,304
files, including the entire shared-component library and the entire data
layer — matched no entry at all, while the one live checker in the surface
validated only that every path the map *named* resolved. Gate the map's
*coverage*, not just its membership; prefer *deriving* the coupling from
convention where one holds, because a derived coupling cannot be a third
incomplete and repairs itself under the renames that shred a declared one
(318 boundary-crossing renames in one window; 51 of them stripped a
document's coverage entirely). The full discipline is
[source-doc-mapping](techniques/source-doc-mapping.md).

### 2. The debt is collected at the change boundary

Drift compounds per change, and the only party who reliably knows whether a
change was user-visible is the one who just made it — so the enforcement
point is the change itself, not a weekly cron that arrives after context has
evaporated. But per-change enforcement is only worth its noise if the
enforcement can *see* the change: read it from the version-control record,
which knows renames, deletions, and both sides of a move — never from a
conversation transcript, which knows only destinations, and only if a fragile
turn-boundary heuristic holds. Satisfy on the *named* target, not a directory
prefix (measured here: 54.3% of prefix-shaped satisfactions were the wrong
document). Give the advisory nag its dismissal sentence — "internal-only, no
doc update needed" is a legitimate verdict — but record dismissals somewhere
they can be counted, because an unrecorded dismissal rate cannot be improved,
argued about, or even known. The never-fired autopsy, the fixture lesson, and
the sound design are [same-change-enforcement](techniques/same-change-enforcement.md).

### 3. A user-visible change owes every coupled surface at once

A product change rarely touches one document. The reference doc, the
onboarding tour that walks the changed flow, the marketing guide that
explains it to prospects, the mode tags that control where it appears — each
is a surface the change owes, and each rots independently if the obligation
is settled surface by surface across sessions. Enumerate the surfaces per
feature in the same map, check each independently, and name each miss
specifically. Draw the enforcement boundary honestly: a surface in a sibling
repository whose check is satisfied by "any file under a sibling checkout"
has made its verdict a function of one machine's directory layout —
cross-repo coupling is a **report**, never a gate. The inventory and its
boundary discipline are
[coupled-surface-inventory](techniques/coupled-surface-inventory.md).

### 4. A correction is an event, with a date and a measurement

When a documented claim turns out false, the amateur move is to silently
rewrite it — which repairs the sentence and destroys the record, leaving
every downstream copy of the false claim uncorrectable and every reader
unable to date anything else on the page. The practiced move keeps the false
claim visible, states the date, states the measured truth, and names the
instrument that earned it: *"corrected [date]: this line said X; measured,
the value is Y, by method Z."* Corrections themselves rot — the exemplar repo
contains a correction whose own grep was truncated by its display limit and
had to be corrected again, and a resolved-warning paragraph that outlived the
defect it named by four days — so corrections carry verification dates, and
any number that travels carries its predicate or it will be reused for a
claim it does not support (a stale warning count, wrong by 9×, was cited by
five downstream documents as load-bearing rationale). The craft is
[dated-corrections](techniques/dated-corrections.md).

### 5. Rot is detected, never assumed absent

Whatever the gates catch, some drift ships — dismissed nags, unmapped areas,
imported backlogs, dead hooks. So the surface is scanned: for each document,
discover its coupled sources (the declared map first, colocation convention
second), and judge freshness. The one verdict that separates an honest
scanner from a flattering one: **a document whose coupling cannot be
discovered is *unverifiable*, not clean.** Folding the unverifiable into the
fresh — the tempting default, since both produce no finding — silently
converts the scanner's blind spot into a health claim; the exemplar
implementation's own comment calls rendering them clean "this detector's
biggest lie." Verdict vocabulary, staleness signals beyond timestamps, and
the division of labor with the scanning subject are
[doc-rot-detection](techniques/doc-rot-detection.md).

### 6. Catch-up is bounded and marked

Batch repair is not a rival strategy to per-change enforcement; it is the
recovery lane every per-change system eventually needs. What separates a
bounded repair from an unbounded rewrite is a **marker**: a small recorded
artifact naming the commit and date of the last full pass, what it covered,
and — first-class, not a footnote — what it consciously skipped. The next
pass reads the marker and scans exactly the range since. And the marker
records *what was done*, never what is hoped: the exemplar marker's note
declared "the hook now prevents this kind of drift per-session; bulk rewrites
should not be needed again" — written the same day the never-fired hook
landed, a hope recorded as a fact, poisoning the very range decision the
marker exists to inform. The artifact and its honesty rules are
[catch-up-markers](techniques/catch-up-markers.md).

## The economics: why per-change wins, and what it costs

Per-change enforcement buys the cheapest possible repair — the author still
holds the context, the diff is small, the coupled edit is minutes — at the
price of a nag on many changes and a dismissal ritual on the internal-only
ones. Batch catch-up buys silence between passes at the price of repairs made
without context, at campaign cost, against a range that grew while nobody
watched (the exemplar's one full catch-up rewrote 84 topics in a single
sitting). The mature system runs both: per-change as the primary collector,
batch as the recovery lane, the marker as the ledger between them. What the
economics do not tolerate is the third posture this subject's counter-example
manufactured by accident: the *belief* in per-change enforcement with no
live mechanism behind it — all of the nag design's reputation cost was paid
in documentation, and none of its drift prevention was ever delivered, for
fifteen months, invisibly.

## What this subject deliberately excludes

- **Gate mechanics in general.** Liveness, seeded failures, exit-code
  discipline, hook hygiene: [quality-gates](../quality-gates/quality-gates.md).
  This subject applies them to one artifact class and contributes the
  measured proof of what their absence costs.
- **Scanning machinery.** Sensor isolation, finding lifecycle, triage:
  [codebase-scanning](../codebase-scanning/codebase-scanning.md). The doc-rot
  sensor plugs into that pipeline; its verdict vocabulary lives here.
- **The content of the coupled surfaces.** Tour step design is
  [guided-tours](../guided-tours/guided-tours.md); translation completeness is
  [i18n](../i18n/i18n.md); changelog and release notes ride
  [release-pipeline](../release-pipeline/release-pipeline.md). This subject
  owns only the obligation that links them to a source change.
- **Generated reference documentation.** API docs emitted from source are a
  [codegen](../codegen/codegen.md) concern — a derived artifact with a
  regeneration path, not a hand-written claim that drifts. This subject
  governs the prose a generator cannot write.

## The techniques

- [source-doc-mapping](techniques/source-doc-mapping.md) — the coupling as a
  declared, coverage-gated artifact; derivation over declaration; rename
  resilience; the map that travelled without its machine.
- [same-change-enforcement](techniques/same-change-enforcement.md) — the
  change boundary as collection point; read the diff, not the transcript;
  satisfy on the named target; recorded dismissals; the never-fired autopsy.
- [coupled-surface-inventory](techniques/coupled-surface-inventory.md) —
  reference docs, tours, marketing, mode tags as enumerated obligations;
  independent checks with specific misses; cross-repo surfaces as reports.
- [dated-corrections](techniques/dated-corrections.md) — corrections in
  place with date, measurement, and instrument; corrections of corrections;
  expiring resolved-markers; counts that carry predicates.
- [doc-rot-detection](techniques/doc-rot-detection.md) — freshness scanning
  with *unverifiable* as a first-class verdict; staleness signals beyond
  timestamps; bounded budgets and stable truncation.
- [catch-up-markers](techniques/catch-up-markers.md) — the last-full-pass
  marker: range, coverage, honest gaps; recording what was done, never what
  is hoped.
