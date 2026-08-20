---
name: deepen
version: 0.1
description: Review and widen an EXISTING topic in an ai-registry knowledge bundle via deep web research + training data. Scans the domain for the top-5 undercooked subjects, lets the user pick one, researches it in dynamic lanes (with optional benchmarks), then triages findings into gate-clean bundle edits. Cross-session memory in the Obsidian vault + the bundle's own log.md.
argument-hint: "[domain] [--topic <subject>] [--registry <path>]"
category: Knowledge
memory: vault
---
# Deepen

Develop an existing topic in a Reference Knowledge Bundle: **improve** (correct stale or
wrong claims), **widen** (new techniques, applications, worked specifics), and
**validate** (benchmarks where a claim's value hinges on a measurement). The forge
(`domain-knowledge-forge`) creates a bundle from a repo's ceiling; `/deepen` raises
subjects *above* any repo, using the web and training data as the hardening layer.

**Status: DRAFT v0.1** — trialled against the ai-registry bundles; hardened versions
migrate to the registry's `skills/` lane. This draft mirrors `/research`'s proven
mechanics (vault memory, numbered triage, in-session execution, decline-why learning).

## Input

- **domain** — a bundle folder under `knowledge/` (e.g. `media-generation`). If absent,
  Phase 1 asks with a single-choice question. Never guess.
- **--topic <subject>** — skip the undercooked scan and deepen this subject directly.
- **--registry <path>** — registry root. Default `C:\Users\mkdol\dolla\ai-registry`.

Ask nothing else upfront. Later questions only where a phase requires a decision.

## Constants

- **Registry contract docs** (read before editing anything): `docs/rkb-profile.md`
  (layer contract, frontmatter, purity), `scripts/check-bundles.mjs` (the gate + purity
  denylists + per-bundle `stacks:` extension), `knowledge/<domain>/_laws.md`.
- **Obsidian vault:** `C:/Users/mkdol/Documents/Obsidian/personas`
  - `Deepen/runs/` — one note per run: `YYYY-MM-DD-{domain}-{subject}.md`
  - `Deepen/domains/{domain}.md` — per-domain state: undercooked scores by date (so the
    next run measures movement, never inherits), banked leads (rejected-but-promising,
    dry lanes, sources that were rich/poor)
  - `Lessons/{YYYY-MM-DD}-deepen.md` — append-only self-reflection (Edit-append, never
    Write-replace; write LATE and re-read before the final summary — the 2026-08-13
    concurrent-Write incident applies here too)
  - `Patterns/deepen-preferences.md` — rules upgraded from Lessons after 3+ observations
- **In-repo memory:** `knowledge/<domain>/log.md` — OKF's reserved audit-trail file.
  Every run appends a public-safe block (date, subject, findings accepted/declined
  counts, source URLs). The registry itself remembers being deepened; the vault carries
  what a public repo must not (operator preferences, decline reasons, machine paths).

## Phase 0 — Locate, isolate, remember

1. Resolve the registry root; verify `knowledge/` and the contract docs exist. If the
   bundles you must edit live on an unmerged branch, work there.
2. **Git worktree, always.** `git worktree add .worktrees/deepen-<slug> <branch>` in the
   registry — the main checkout is shared with other sessions and has burned us before.
   All edits, gates, and commits happen in the worktree; remove it after merge-or-park.
3. Bootstrap the vault folders above if missing (one-time). Load memory: the domain
   state note, `Patterns/deepen-preferences.md`, and the 3 most recent Deepen Lessons.
4. Read the bundle's `index.json` — the instrument for Phase 2. **Trust it only after
   spot-checking one field against a real file**: this index once reported use_when
   0/267 on a corpus that was at 267/267 because its counter read a different shape
   than the parser emitted. An instrument is asserted before its result.

## Phase 1 — Domain

If the domain was not provided: list bundle folders under `knowledge/`, and ask ONE
single-choice question (bundle name + its one-line index.md description per option).
If provided but not found: show what exists, ask once, stop if unresolved.

## Phase 2 — Undercooked scan (top 5)

Skipped when `--topic` was given. Otherwise score every subject in the bundle:

**Deterministic signals first** (from `index.json` + the tree — cheap, honest):
- technique count at the low edge (≤4) · application count (0-1 is thin by construction)
- `status` still `forged` (never reconciled/transplant-tested)
- body mass: golden path < ~120 lines, techniques averaging < ~60
- laws cited rarely or never · `use_when` missing
- **application stack diversity**: one stack only = the subject knows one realization
- category imbalance: a category whose subjects are all thin is a bundle-level gap

**Memory signals**: the domain state note's banked leads and prior scores — a subject
deepened last run and unchanged since scores lower; a banked lead scores its subject up.

**Judgment pass last**: for the ~8 highest-scoring candidates, one honest paragraph
each from training data: *what would a principal practitioner expect here that is
missing, shallow, or likely stale?* This is the gap thesis — it names what research
would actually add, and it is what the user chooses between. A subject that is thin
but complete-for-its-scope (say so) ranks below a fat subject with a stale core.

Present the **top 5** via a single-choice question. Each option: the subject slug as
label; description = the gap thesis in one or two sentences + the deterministic tell
(e.g. "1 application, no benchmarks behind its numbers, provider landscape moved since
forge"). The user may always answer Other with a subject you didn't shortlist.

## Phase 3 — Research (dynamic lanes)

From the chosen subject's gap thesis, derive **3-6 research lanes**. The recurring lane
shapes (pick what fits, invent freely):

- **landscape** — providers / tools / models the subject's applications don't cover yet
  (e.g. image generation: more providers, models per use-case and artstyle)
- **specifics** — per-case knowledge the subject states generically (prompts per
  artstyle, settings per scenario, model-recognition pairings and comparisons)
- **counter-evidence** — actively try to REFUTE the subject's strongest current claims;
  a stale confident claim is worse than a gap
- **current-practice** — what changed in the field since the forge (releases, deprecations,
  new standards); training-data date limits stated honestly
- **training-data-only** — one lane with NO web: what the expert draft would add today,
  free of search-result gravity
- **benchmark-design** — where a claim is measurable, design the smallest test that
  would settle it (executed in Phase 4)

Dispatch lanes as parallel researchers (web lanes get WebSearch/WebFetch; cap ≤6
concurrent). **Dynamic means dynamic**: a lane reporting dry closes (bank the dryness —
it is a finding about the field); a lane reporting rich spawns one bounded follow-up.
Every lane returns FINDINGS in one shape:

```
type: correct | extend | new-technique | new-application | law-candidate | benchmark-result
claim: one sentence, falsifiable
detail: the substance (what changes / what gets added, drafted at target quality)
sources: [urls] or "training data" or "measured, n=<k>"
confidence: high | medium | low
placement: exact file path + layer (respecting purity — see below)
size: S | M | L
```

**Placement discipline — the layer contract routes the mess:**
- Product/model/provider-named knowledge NEVER enters golden paths or techniques
  (purity gate). It lands as **applications**, `stack` = a kebab-case provider/tool
  slug added to the bundle `index.md`'s `stacks:` list. "Which model for which
  artstyle" is an application named `<provider>--<technique>.md`.
- Vendor-neutral craft that generalizes lands in techniques; a genuinely new named
  concern becomes a `new-technique` (added to the golden path's `techniques:` list —
  bidirectional or the gate fails).
- A rule recurring across findings is a `law-candidate` — propose for `_laws.md`,
  never silently edit laws (they're cited by anchor across the bundle).

## Phase 4 — Validation (only where it earns its cost)

Findings whose value hinges on a measurable claim get a benchmark **when a local
harness exists** — e.g. image generation probes (the media bundle's own trial-matrix /
model-fit-probe techniques describe the method; gravitone's `pipeline/*.mts` is a
working harness; `/leonardo` tools can generate), or a code microbenchmark. Bounded:
smallest n that discriminates, n always visible, spend stated before running (ask the
user first when a benchmark costs real money). No harness → mark
`validation: untested` and present anyway — an honest untested finding beats a
laundered one. Measured results may be cited in applications with their n; never
launder a benchmark into an upper layer as a universal number.

## Phase 5 — Present findings & triage

Dynamic count — present what research actually yielded (typically 5-15; if a rich
subject yielded 3, say so rather than padding — and if lanes were dry, the honest
deliverable is "this subject is better-cooked than the scan suggested", banked to the
domain note). Order by type: corrections first (they protect existing readers), then
extensions, then applications. Detect clusters (findings that only make sense
together) and mark them: one triage decision per cluster.

Summary table (number, type, claim, confidence, validation, placement, size), then
per-finding detail. Then the `/research` triage contract:

```
Which findings should I apply? Reply with numbers ("1, 3, 4"),
"all", "none", or "ask" for a guided walkthrough.
```

## Phase 6 — Apply (in-session, gate-clean, atomic)

In-session execution is the default — same doctrine and same reasons as `/research`.
For each accepted finding/cluster, in risk-ascending order:

1. Edit the bundle files. Respect the full contract: frontmatter shape, purity per
   layer, bidirectional technique lists, laws anchors, `<stack>--<technique>.md`
   naming, `stacks:` extension when introducing a stack. Corrections keep `status:
   forged`; nothing self-promotes to `reconciled` (that's a repo-reconciliation event,
   not a research event).
2. Run `node scripts/check-bundles.mjs` after each cluster — fix inline, never stack red.
3. After the last cluster: `build-index.mjs`, then `build-catalog.mjs`.
4. Append the run block to `knowledge/<domain>/log.md` (public-safe).
5. Commit atomically per cluster in the worktree, `deepen: <short title>` prefix, body
   naming sources. Verify `git log -1` is yours.

## Phase 7 — Self-reflection (the learning loop)

1. **Decline-why, once, batched** — exactly the `/research` Phase 10a question; "skip"
   honored.
2. **Lessons** — Edit-append to `Lessons/{date}-deepen.md`: declined + reasons, lane
   yield rates (which lane shapes were rich/dry for this domain), benchmark
   cost/value, anything the skill itself should do differently. Re-read before the
   summary; restore by Edit-append if a concurrent session clobbered it.
3. **Domain state note** — rewrite `Deepen/domains/{domain}.md`: fresh undercooked
   scores (recomputed, never carried forward), banked leads with return conditions,
   source-quality memory.
4. **Patterns** — any rule now observed 3+ times across Lessons graduates to
   `Patterns/deepen-preferences.md`.

## Phase 8 — Summary

One screen: subject deepened, findings applied/declined (with the one-line why for
declines), gate status, commits, benchmark spend if any, movement ("subject X:
techniques 5→7, applications 1→4, two corrections"), and where the run notes live.

## Worked example (the calibration case)

`/deepen media-generation --topic image-prompt-composition` should be able to produce:
landscape lane → applications for additional providers/models incl. per-artstyle
strengths (`<provider>--two-block-style-and-action.md`); specifics lane → an
artstyle-to-prompt-block application or a new technique if a vendor-neutral pattern
emerges; counter-evidence lane → is the ~77-token truncation claim still true across
current encoders?; benchmark lane → a small recognition-model comparison (which VLM
judges style adherence best), measured with visible n, landing beside
`generated-output-grading`'s two-grader-disagreement technique as an application.

## Anti-patterns (from the founding arc — do not rediscover)

- **Reporting a content gap without verifying the instrument.** The undercooked scan
  is measurements first, and one measurement is spot-checked against a real file.
- **Padding the findings list.** Dry is a result. The domain note banks it.
- **Editing upper layers with product names.** The gate will catch it; don't make it.
- **Carrying forward last run's scores.** Recompute. Derived metrics drift silently.
- **Benchmarks that assert data, not behavior.** A green check that numbers
  round-tripped is not evidence the finding is true. Observe the actual output.
- **Working on the shared checkout.** Worktree, always.
