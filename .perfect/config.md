# Perfect — repo overlay (personas)

## Gates

Run on trunk after every merge. All must be green before a direction reaches `shipped`.

```bash
npx tsc --noEmit                    # must exit 0
npm test                            # vitest run
npx eslint <touched files>          # 0 errors; no NEW warnings in touched files
npm run check:contracts             # Tauri command registry + event registry parity
```

Conditional — run only when the change touches the matching surface:

```bash
npm run check:i18n:strict           # key parity across en + 13 locales
npm run check:i18n:untranslated     # values must DIFFER from English
npm run test:rust                   # any src-tauri/ change
node scripts/i18n/gen-types.mjs && node scripts/i18n/split-locales.mjs
node scripts/generate-command-names.mjs   # after adding a #[tauri::command]
```

**Full-repo lint is not a gate.** `npx eslint src/` reports hundreds of pre-existing
warnings. Compare a diff's warnings against trunk's for the *same files*.

**`npm run check:dead:files`** exits 1 on a pre-existing ~342-unused-file baseline.
Read its output; do not treat exit code as signal.

## Wave settings

- wave size: 3 concurrent builders
- ≤ 3 directions per builder brief
- cooldown: 2 rounds
- direction sizing: ≲15 files, one builder session

## Worktree recipe

```bash
git worktree add .claude/worktrees/perfect-<ctx> -b worktree-perfect-<ctx>
```

`node_modules` is at the repo root; link rather than reinstall. Rust artifacts live in
`src-tauri/target/` — share the cache across worktrees or pay a ~6-minute cold build each.

## Repo hazards (learned the hard way)

- **Concurrent sessions.** Other Claude sessions (Personas Fleet, `/scan-sweep`) commit to
  this repo continuously. A `git commit` can silently lose its staged files to a racing
  session. **Never `git add -A`/`git add .`; stage by full path; verify every commit landed
  with `git log --oneline -1`.**
- **i18n is a two-stage write.** The app loads `src/i18n/section-locales/`, which is
  GENERATED. Editing `src/i18n/locales/` without running `split-locales.mjs` passes every
  gate and still ships English.
- **ts-rs maps `i64` → TypeScript `bigint`.** Use `u32` for counts, or the frontend cannot
  add them to other numbers.
- **`tourAnchorManifest.json` is generated** (`scripts/docs/gen-tour-anchors.mjs`) and has a
  Rust twin (`src-tauri/src/companion/generated_tour_anchors.rs`). Re-run the generator;
  never hand-edit.
- **This repo DOES have jest-dom matchers and RTL auto-cleanup** (`src/test/setup.ts`).

## User taste

Accumulated from actual gate outcomes. Weight future slates by this.

- **Engine over chrome.** The user's own asks in this repo have been structural
  (consolidate two decision centres into one; make a badge tell the truth) rather than
  cosmetic. Default to architecture-level directions; surface-only polish earns at most
  one slot.
- **Honesty over comfort.** Repeatedly chose the option that makes the product tell the
  truth — an aggregate count over a cheap partial one, a provenance strip over a clean
  "pass". A direction that removes a lie outranks one that adds a feature.
- **Respect work that just landed.** Rejected nothing, but explicitly wanted `GoalsTriage`
  (shipped hours earlier) preserved rather than replaced. Check `git log` before proposing
  anything that would undo recent work.

## Autonomy policy — set by the user 2026-08-06

The loop runs **continuously, wave by wave, reporting only on exception.** The Director picks
the cursor, scouts, proposes, self-gates, builds, reviews and wraps without checking in.

**Build on the evidence.** Features, cross-context work, refactors, new surfaces — if a
direction is evidence-backed and one builder session can ship it behind its acceptance
criteria, it does not need a gate.

**STOP and ask — the irreversible three.** These are asked about *before* any work starts,
never reported after:

1. **Deleting or retiring a surface.** Including dead code. The triage found `teams-canvas`
   (34 orphaned files), `template-generation` (17-file unreachable wizard),
   `template-adoption-questionnaire` (17 files, zero users) — all genuinely dead, none
   removable without asking. "Nothing imports it" is evidence, not authorisation: the map has
   been wrong before, and a deletion is the one mistake with no cheap undo.
2. **Destructive migrations.** Any schema change that drops a column/table, or that changes
   what existing rows *mean*. Additive columns with a backfill (e.g. `dev_tasks.updated_at`)
   are fine and do not need a gate.
3. **Security and credentials.** Anything touching the vault, credential storage, encryption,
   IPC auth, or the Playwright credential-harvesting path.

**Surface immediately, mid-wave** (do not batch into a wrap report):
- a policy escalation from the three above
- a red gate on trunk that cannot be fixed inline
- a proposal slate that comes back empty or all-weak for a cursor
- a builder returning `DECISION NEEDED` that the policy does not cover
- evidence that a previous wave's shipped work is wrong

**Otherwise stay quiet.** The vault is the progress report; `Perfect.md` and the session note
are always current because they are written incrementally.

## Skill improvement log

First run, 2026-08-05. Two waves, six directions, all shipped.

- **Scouts were the highest-leverage spend of the session, by a wide margin.** Both were told
  *"a component only exists if it renders on a real path — trace every surface to a mount
  point"*, and both came back having found comments and docs that the code contradicts. Keep
  that sentence verbatim in every scout prompt. The wave-2 scout paid for itself outright by
  discovering the requested feature was 80% already built.
- **Every serious defect this session was an ABSENCE, and absences do not fail tests.** No
  error field. No identity on a commit. No consumer for a computed value. No announcer after
  a live region was removed. No `updated_at`. 553 green tests sat on top of all of them.
  Direction drafting should explicitly hunt for what is missing, not what is wrong — the
  scout question "what is computed and never read?" found two of the six directions.
- **Builders corrected a Director premise in five of six directions and were right every
  time.** The brief must invite that in its own words; the one place I stated a premise as
  settled fact (`filtered` under-detects) was the one place I was wrong. Standing brief line:
  *"if a premise is wrong when you check it, say so plainly rather than forcing it."*
- **Read the diff against the direction's acceptance criteria, never the test result.** The
  one redo of the session (`nothing-colour-only`) was fully green and had introduced an
  accessibility regression inside an accessibility direction. Only the criteria caught it.
- **Sequential builders beat worktrees here.** Worktrees would have needed `node_modules`
  junctioned before a single test could run; sequencing by file-overlap (1+3 share
  `useUnifiedTriage`, 1+4 share `TriageDeckVariant`) cost nothing and conflicted never. But
  see the hazard below — sequencing does not protect against *other people's* sessions.
- **Commit latency is the real risk on this repo, not merge conflicts.** A concurrent session
  swept an uncommitted builder diff into its own commit. Per-file staging did not prevent it;
  only committing fast shortens the window. Add to every builder brief: *commit each
  direction the moment it is verified, never batch.* (It was already there — and the one
  builder that held work for a 25-minute test run is the one that got swept.)
- **Next run:** the queue is scored (2026-08-06, `contexts/_scores.md`). Pick the cursor from
  the thirteen 8s, or from a context whose fix compounds into the loop itself.

### Added after waves 3-4 (autonomous mode)

- **Ask when the answer is surprising, even under a broad autonomy grant.** The promote-gate
  decision came back as the inverse of the evidence — keeping the two indefensible paths and
  dropping the two defensible ones. One confirming question cost a turn and caught a polarity
  flip that would have shipped the exact defect I had just argued against. A broad "build on
  the evidence" grant is not a licence to implement an answer that contradicts the evidence.
- **A verdict change must land on every surface that recomputes it.** Fixing the promote gate
  in Rust alone would have replaced a false green with a false *red*: `useLifecycle.ts` derives
  `allPassed` independently, and `TestReportModal`'s status chain had no default branch. Before
  changing what a status *means*, grep for everywhere it is re-derived.
- **Implement the principle, not the sentence.** Two builders correctly refused a literal
  reading of my note (`is_builtin_platform` folded in with `cli_native`; validating `db_tables`
  against Personas' own schema rather than the scanned project's). Briefs should state the
  principle *and* the evidence, so a builder can tell when the sentence is wrong.
- **Measure before and after, on real data.** The doc-rot wave's before/after table showed the
  detector was *already* at 66.8% dirty — the opposite of the under-reporting the direction
  assumed. Two false positives were found by sampling the measurement, not by reasoning.
- **Verify a scout's alarming claim before relaying it.** "The promote endpoint has no auth"
  was wrong — it is Bearer + scope gated. Checking cost two greps; relaying it would have sent
  a future session after a phantom.

### Added after wave 6 — the most important lesson so far

- **A direction note that contradicts itself will ship the contradiction.**
  [[the-correction-under-a-do-not-follow-banner]]'s Evidence said *"nothing else in the codebase
  reads `_fix_instruction`"* while its own non-goals said *"`mod.rs:227-236` is the same string
  arriving by the other route."* Both were written by the Director, in one document, and the
  defect described was the **inverse** of the real one — the string was not muzzled, it was
  being spliced raw into trusted prompt structure above the canary, since the feature shipped.
  **Before dispatching, read the note's own sections against each other.** The builder caught
  it; the note should not have reached them.
- **"Grep found no other reader" is a claim about the grep, not the code.** The sibling's grep
  correctly showed `replace_variables` skips `_`-prefixed keys, and that was generalised into
  "nothing reads it". A key can be read by something that is not the substituter. Trace the
  consumer, don't infer its absence.
- **Encode the invariant in the type when you can.** The fix used
  `FixInstruction { framing: &'static str, evidence: Vec<String> }` — `&'static str` makes it
  *impossible* for the system-authored half to pick up runtime text. That is stronger than any
  test, and it is the shape to reach for when a boundary matters.
- **Render trusted text from the constant, never from the payload.** `render_correction_required`
  emits the framing from a shared constant rather than echoing what arrived in `input_data`, so
  a planted `_fix_instruction` renders as data. The general rule now in `prompt/README.md`:
  *nothing that arrives in `input_data` is rendered as instruction.*

### Added after wave 5

- **A test cannot catch a build-flag defect, because the test runs on the safe side of the
  flag.** Vitest has `import.meta.env.DEV === true`, so any `import.meta.env.DEV &&` branch
  resolves the *working* way in exactly the configuration that ships broken. Pin these by
  asserting over **source text** (`src/__tests__/structural/*` is the precedent), or by reading
  the production bundle. A green suite is not evidence about production here.
- **Check the nav gate before trusting a context's reach.** `studio` scored 8 as a "routed
  flagship section"; `registry.ts:88` gates the whole section `devOnly: true`, so 18 of its 19
  files are unreachable in any shipped build. Corrected to 2. **Reach is a property of the
  gate, not the description** — the scoring rubric should say so.
- **A component's own justification comment can be stale.** `FleetGridLayer`'s comment named a
  consequence (`FleetFooterIcon` blank) that is now itself dev-gated. The direction was right
  and the stated reason was obsolete; the builder found the *real* consumers
  (`PluginsSidebarNav`'s waiting badge, `ingestOutboxForCwd`). Re-derive the consequence, don't
  inherit it.
- **Look for the near-miss that would make a direction seem moot.** `useFleetCompanionBridge`
  already performed one third of the acceptance criteria in production, and a faster builder
  could have concluded the whole thing was already fixed. It wasn't — the bridge returns
  without refreshing on the one event Rust emits unpaired.
