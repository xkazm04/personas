# Deeper-fix triage-with-probes kit

You own ONE repo's DEFER pile from the full-contexts golden-path coverage. For each
DEFER-tagged finding, classify it, then — only for the safe class — apply the fix
BEHIND A PROBE that proves behavior is preserved. This is the safe-apply path: a
behavior-changing fix is allowed iff a runnable probe demonstrates it.

## Inputs
- Your repo's findings: `.../scratchpad/findings-<repo>-*.json` — read them, take every
  finding with `tag == "DEFER"` (skip the FIX ones, already applied).
- The pairing ledger for context: `.../scratchpad/phaseC-pairing-ledger.txt`.

## Triage EVERY DEFER into exactly one class
- **(a) safe-once-verified** — a correct, minimal fix exists; it's behavior-changing only
  in the sense that a probe can pin the intended behavior. Examples: retry classifies a
  permanent error as retryable (fix = add transient/permanent split, probe = feed a 410,
  assert no retry storm); a vocabulary duplicated across copies (fix = one authority,
  probe = assert the copies agree); a missing keyboard handler on an ARIA role (fix = add
  onKeyDown, probe = assert keyboard activation); a hand-synced parity map (the parity
  TEST is itself the fix). → **FIX IT, behind a probe.**
- **(b) human-judgment** — the right call is product intent, not correctness: auth on a
  prototype, a spend/budget ceiling, a retry/timeout norm, crypto-at-rest, an unsigned-
  import roadmap item, a deliberate local-first tradeoff. A probe can't resolve it. →
  **DO NOT FIX. Add to the decision queue** (state the decision the operator must make +
  the one-line tradeoff).
- **(c) corpus-demotion** — running it shows the golden-path technique's CLAIM does not
  hold / does not transplant here (like the pilot's render-budget = DOM-weight-only).
  The repo isn't wrong; the corpus lesson is over-broad. → **DO NOT FIX the repo. Report
  as corpus feedback** (which technique, what the run showed, proposed split/boundary).

## For every (a): probe-then-fix (the discipline)
1. Write a PROBE in the repo's existing test harness that either reproduces the defect or
   pins the corrected behavior. Harness by repo:
   - **gravitone** → Playwright test-runner under `tests/golden-path/` (the pilot
     established this; import pure `.ts`/hook-free components directly; commit `53478cc`
     shows the pattern).
   - **politicas** → Vitest (`*.test.ts`, the repo has 2915 passing).
   - **pumper** → `#[cfg(test)]` / integration test in the affected crate (match the
     repo's `*_can_actually_fail`-style meta-test idiom).
2. Confirm the probe FAILS on the current code (proves it catches the defect), then apply
   the MINIMAL fix, then confirm the probe PASSES. The probe stays as the regression test.
3. Verify the repo gate BY EXIT CODE (never piped): gravitone `npx tsc --noEmit`;
   politicas `npx tsc --noEmit` + `npx eslint <touched>`; pumper `cargo check -p <crate>`
   + `cargo clippy -p <crate> -- -D warnings` + `cargo test -p <crate>`.
4. Atomic commit (probe + fix together), message naming the corpus class. Stage ONLY your
   files (`git add <path>`, never -A); `git status --porcelain` first, `git diff --cached
   --stat` after, to avoid other sessions' drift. Verify `git log --oneline -1` is yours.
5. If a candidate (a) turns out NOT safely probe-provable (the fix changes real behavior a
   probe can't bless), DOWNGRADE it to (b) and queue it — do not force it.

## Push
- **gravitone**: NO remote — commit locally only.
- **politicas / pumper**: `git push` at the end if every gate passed. Fix inline + re-push
  if a pre-push hook fails; report if you can't.

## Report (final text)
1. Triage table: finding | problem_shape | class a/b/c | one-line reason.
2. (a) applied: per fix — probe file + fix file, commit SHA, gate exit codes, "probe
   failed-before / passed-after" confirmed.
3. (b) decision queue: each with the operator-decision needed + the tradeoff.
4. (c) corpus feedback: technique + what the run showed + proposed corpus edit.
5. Whether you pushed; final `git log --oneline -N`.
Never fabricate a probe result. A probe you couldn't run is reported as such.
