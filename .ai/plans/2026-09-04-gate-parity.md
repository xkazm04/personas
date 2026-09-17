# Gate parity: derive CI's lint legs from lefthook.yml

Registry subject: `software-engineering/engineering-process/continuous-integration/pipeline-authoring`
Technique: `foreign-config-replay` (landed 2026-09-04)
Status: step 1 done on `intake/foreign-config-replay`; steps 2-3 open

## The problem, measured

`lefthook.yml` and `.github/workflows/` are two independently authored answers
to "which checks apply to this repo, over which files". Nothing connects them.
The registry technique's claim is that two implementations of one selection
semantics drift silently, and that the drift is invisible in the direction that
matters — a check that runs locally and nowhere else looks green to everybody.

Measured on this tree, 2026-09-04, by `scripts/check-gate-parity.mjs`:

| arm | local jobs | with no CI counterpart |
|---|---|---|
| A — CI authored independently (today) | 11 | **3** |
| B — CI legs derived from `lefthook.yml` | 11 | 0 by construction |

The three:

- **`gitleaks-staged`** (`scripts/secret-scan.mjs`). The lefthook comment calls
  this "the shift-left D9 control: a leaked key is blocked BEFORE it leaves the
  machine (CI catching it is already a leak)". CI never catches it either — the
  local hook is the only enforcement, and it is skipped by `LEFTHOOK=0`, by a
  fresh clone that has not run `npm install`, and by any push from a machine
  without the hook installed.
- **`i18n-no-untranslated`** (`scripts/i18n/check-untranslated.mjs`). The npm
  script `check:i18n:untranslated` exists but is in no workflow and not in the
  `npm run check` chain. Its own comment records that this blind spot hid ~57k
  raw-English strings (~24% of the app) behind a green "0 missing" report until
  2026-07-12 — the check written to close that hole is not enforced on push.
- **`ai-context-freshness`** (`.ai/maintain.mjs check`).

`rustfmt-staged`, `eslint-staged`, `i18n-no-gaps`, `typecheck`,
`golden-path-census`, `i18n-coverage`, `evals` and `ai-conformance` all have CI
counterparts — several only transitively, through `npm run check`, which is why
the checker expands npm wrappers rather than grepping workflow files. A first
version of this measurement that grepped workflows directly reported 9 gaps and
was wrong about 6 of them.

## Steps

**1. Presence parity (done).** `scripts/check-gate-parity.mjs` asserts every
lefthook job has a CI counterpart or a reasoned exemption. Exit 1 on a gap.
Currently red with the three above — deliberately, so the number is visible
before it is silenced. ~150 lines, no dependencies.

**2. Close the three gaps, or exempt them with an argument.** The secret scan is
the one to fix first; a control whose whole premise is "before it leaves the
machine" still needs the server-side backstop for the machines that skipped it.
Each closure is a workflow step, or an `ALLOWED_LOCAL_ONLY` entry naming why the
check cannot run in CI.

**3. Wire the checker into a gate.** Add it to `npm run check` (so CI runs it
via the existing `frontend-checks` job) and to pre-push. Until then this is a
script nobody runs, which is the same defect one level up.

**4. (Optional, larger) Scope parity.** Presence is the cheap half. The
technique's stronger form derives the CI legs *from* `lefthook.yml` — one job
per lefthook job that has matching changed files, replaying lefthook's own
`glob:`/`exclude:` over the diff — so a check narrowed locally is narrowed in
CI and a check added locally is scheduled without editing a workflow. That is a
real change to `ci.yml`'s shape and wants its own decision; do not start it
before step 3 has been green for a while.

## Measurable

`node scripts/check-gate-parity.mjs` exit code, and the gap count it prints.
Today: 3. Step 2 takes it to 0. Step 3 makes it stay there.

## What would falsify the premise

If all three gaps turn out to be deliberate — checks that genuinely cannot run
in CI — then the divergence is intentional and the right outcome is three
`ALLOWED_LOCAL_ONLY` entries, not three workflow steps. The checker is still
worth having, because it turns an invisible property into a reviewed one.
