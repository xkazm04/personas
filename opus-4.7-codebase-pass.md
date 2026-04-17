# Opus 4.7 Ship-Readiness Pass — Personas Desktop

A goal-directed playbook for Claude Opus 4.7 via Claude Code CLI. **The goal is
no longer "audit for fun" — it is to make Personas Desktop shippable as an
open-source product that a stranger can clone, build, run, and contribute to.**

Work happens across **specialized pass tracks** (Fix, Polish, Structure,
OSS-Readiness, Security/Privacy, Distribution, Docs). Each track has a tight
scope, entry/exit criteria, and its own verification contract. Pick tracks
based on what the product needs to ship, not on what's fun to refactor.

Optimize for *time-to-first-external-contributor* and *time-to-first-
user-install*, not volume of change.

---

## How to run

```bash
# From repo root
claude --model claude-opus-4-7 --effort xhigh
# Paste the "Mission" section below as the first message.
# Stay hands-off for Phase 1 (recon). Gate-review before Phase 3.
```

Recommended: dedicated branch so the whole session is diffable.

```bash
git checkout -b ship-ready/$(date +%Y-%m-%d)
```

---

## Mission

You are closing out Personas Desktop (Tauri 2 + React 19 + TypeScript 6 +
Zustand 5) so it can be published as an open-source product. The product is
already ~80% built; your job is the last 20% that makes it *deliverable*:
pre-existing bugs fixed, UX rough edges smoothed, structure legible to new
contributors, license/docs/CI present, install path working on a clean
machine.

Four phases: **recon → plan → execute passes → release-candidate summary**.
Proceed autonomously, but **stop after Phase 1** and wait for human approval
before touching code.

A stranger cloning this repo at the end of your session should be able to:
1. Read `README.md` and understand what it is in < 60 seconds.
2. Follow `CONTRIBUTING.md` and get a dev build running.
3. Download a signed installer from a release and run the app without warnings.
4. Open the app and not immediately hit a visible bug, missing translation, or
   broken state.
5. Find `LICENSE`, `CODE_OF_CONDUCT.md`, and a working issue template on GitHub.

Anything that doesn't serve those five outcomes is out of scope for this pass.

---

## Ground rules (non-negotiable)

1. **Read `.claude/CLAUDE.md` first and obey it fully.** In particular:
   - Never introduce hardcoded English strings in JSX/attributes — use `t` / `tx`
     from `useTranslation()` and add keys to `src/i18n/en.ts`.
   - Always use `invokeWithTimeout` from `@/lib/tauriInvoke`, never raw `invoke`.
   - Use semantic tokens (`text-foreground`, `bg-secondary`, `typo-*`,
     `rounded-*`) — never `text-white/*` or `bg-white/*` directly.
2. **Pre-existing issues are NOW IN SCOPE.** The `AccountSettings.tsx` errors,
   the ~159 pre-existing TS errors, the `react-hooks/rules-of-hooks`
   violations — these are exactly what this pass exists to fix. But fix them
   as targeted commits in the **Fix** track, not as opportunistic drive-bys
   inside other tracks.
3. **Preserve public API shape.** No breaking changes to Tauri commands,
   Zustand slice signatures, or exported component props unless explicitly
   justified and approved. If it ships 1.0, it carries the API forward.
4. **Every pass must end green.** After each code-modifying commit run:
   - `npx tsc --noEmit` — TS error count must *decrease or hold* vs. baseline.
   - `npm run lint` — no new errors; warning count must not increase.
   - `npm run test` — affected tests must pass; run full suite on structure/fix
     passes.
   - On Rust changes: `cargo check` and `cargo test` in `src-tauri/`.
5. **Commit discipline.** One atomic change per commit. Message format:
   ```
   <track>(<area>): <what changed>

   Why: <root-cause or value prop, 1–3 lines>
   Risk: <low/med/high + rationale>
   Verified: <which checks you ran>
   ```
   Where `<track>` is one of: `fix`, `polish`, `structure`, `oss`, `sec`,
   `dist`, `docs`.
6. **Ask before destructive or shared-state operations.** Deleting files,
   renaming exports, migrating data models, touching
   `src-tauri/src/db/migrations/*`, editing `.github/`, changing `package.json`
   dependency pins, publishing releases, pushing tags — all require
   confirmation.
7. **No speculative refactors.** If you can't articulate the ship-readiness
   benefit in one sentence tied to the five outcomes above, don't do it.

---

## Phase 1 — Ship-readiness recon (READ-ONLY, ~30 minutes, then STOP)

Before writing code, produce a written audit. During this phase you may only
read files, run read-only commands, and record baselines.

### Deliverable: `audit-reports/ship-ready-<YYYY-MM-DD>.md`

```markdown
# Personas Desktop — Ship Readiness Audit (<date>)

## Baseline
- TS errors: <count> (list files with > 5 errors)
- Lint errors / warnings: <counts>
- `react-hooks/rules-of-hooks` violations: <count + files>
- Test count / runtime / failures: <npm run test>
- Bundle size: <npx vite build>
- Rust warnings: <cargo check>
- i18n coverage: <node scripts/check-locale-parity.mjs --json summary>
- Sentry top issues (if accessible via /sentry skill): <top 5>
- Clean-clone build test: can you identify blockers without running it?

## Ship-readiness scorecard
Score each 0–3. 0 = missing/broken, 1 = exists but rough, 2 = acceptable,
3 = polished.

| Dimension                                | Score | Evidence |
|------------------------------------------|-------|----------|
| First-run UX (fresh install → useful)    |       |          |
| README clarity for new users             |       |          |
| CONTRIBUTING / dev setup reproducibility |       |          |
| LICENSE + legal hygiene                  |       |          |
| Installer / signed binaries / updater    |       |          |
| CI (build, test, lint on PRs)            |       |          |
| Issue / PR templates / CODEOWNERS        |       |          |
| Pre-existing bug burden (TS + hooks)     |       |          |
| Error states (visible + actionable)      |       |          |
| Loading / empty states                   |       |          |
| i18n coverage on critical user paths     |       |          |
| Accessibility (keyboard, aria, contrast) |       |          |
| Telemetry / privacy (opt-out, transparent)|      |          |
| Secrets hygiene (no leaks, .env.example) |       |          |
| Architecture docs for contributors       |       |          |

Total: __ / 45. Interpretation: < 20 = not shippable, 20–32 = needs this pass,
33+ = mostly ready.

## Per-track findings
For each track below, list concrete items (file:line where possible), each
tagged Impact (1–5) × Confidence (1–5) ÷ Risk (1–5) = Score.

### Fix track
Pre-existing TS errors, hook-rule violations, Sentry top issues, crash paths,
broken flows discovered while clicking through.

### Polish track
UI rough edges: missing empty/loading/error states, hardcoded strings on
critical paths, inconsistent spacing/typography, broken keyboard nav, obvious
a11y gaps, dead buttons, placeholder copy, TODO banners.

### Structure track
Dead code, the deprecated `features/home/i18n/` directories, duplicated
patterns across feature modules, circular deps, oversized slices, files >
800 lines that should be split, inconsistent module boundaries.

### OSS-Readiness track
Missing/weak README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md,
`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`, CODEOWNERS, CI
workflows, release workflow, `.env.example`, screenshots, demo GIF.

### Security & Privacy track
Hardcoded secrets/keys, telemetry endpoints without opt-out, leaked PII in
logs or Sentry breadcrumbs, overly broad Tauri `allowlist`, permissive CSP,
outdated crypto, dependency CVEs (`npm audit`, `cargo audit`).

### Distribution track
Installer build works on all three platforms? Code signing configured?
Auto-updater wired? First-run onboarding present? Reasonable default window
size/position? App icon present on all platforms? `tauri.conf.json` metadata
(identifier, publisher, version strategy) coherent?

### Docs track
Architecture doc for contributors, module READMEs for `agents/`, `vault/`,
`overview/`, commands doc for Tauri IPC surface, screenshots in README,
changelog, release notes template.

## Rejected candidates
Things you looked at and chose not to include, with 1-line reason. This tests
calibration — do not skip.

## Uncertainties
What do you not know? What's the single most useful thing a human could tell
you before Phase 3?

## Recommended track order
Suggest an ordering and rationale. Typical: Fix → Structure → Polish →
Security → OSS-Readiness → Distribution → Docs. Justify deviations.
```

**After writing the audit, stop.** Do not proceed to Phase 2 until told to.

---

## Phase 2 — Prioritize & plan

Once Phase 1 is approved, propose the execution plan:

- Which tracks you'll run this session and in what order.
- For each track: 2–6 specific passes (LOC estimate, files touched,
  verification strategy).
- Stop condition: e.g., "stop after 8 passes, or any test regression that
  can't be fixed in 10 minutes, or 3 hours wall time, whichever first."
- Rollback plan: per-pass `git reset --hard HEAD~1` budget, max 2 reverts
  before re-planning.

Wait for plan approval before Phase 3.

---

## Phase 3 — Specialized pass tracks

Each track is a discipline with its own contract. Stay in one track per pass
— don't mix a polish fix into a structure pass. Cross-cutting changes should
be broken into per-track commits.

### Track A — Fix (primary; do this first)
**Goal**: zero new red, fewer old reds. Make the TS baseline drop, kill
top-N runtime errors, close `rules-of-hooks` violations.

Entry: TS error count, hook violation count, Sentry top-10 recorded.
Exit: TS error count lower than baseline, no new ones introduced, any fixed
hook violations have passing tests or manual reproduction notes in the commit.

Allowed scope:
- `AccountSettings.tsx` missing imports (`Sparkles`, `TIERS`, `TIER_LABELS`).
- `DualBatchPanel`, `commandHandlers`, `Social module`, `DebtPrediction` TS errors.
- 21 `react-hooks/rules-of-hooks` violations across 7 files.
- Live Sentry issues (use `/sentry` skill).
- Flaky or failing tests (fix the code, not the test, unless the test was wrong).

Not in scope here:
- Stylistic cleanup, renaming, extraction — that's Structure.
- Adding new features or new error states — that's Polish.

### Track B — Polish
**Goal**: the app feels finished on the critical user paths (agent CRUD,
chat, vault credential add, first-run, overview dashboard).

Scope ladder (address higher rungs first):
1. **Critical path i18n**: extract remaining hardcoded strings on the five
   critical paths above. Follow CLAUDE.md's 5-strings-per-file cap when the
   file isn't otherwise being edited — but critical paths *are* being
   edited, so extract all of theirs.
2. **Error / empty / loading states**: every async surface on critical
   paths must have all three states with intentional copy and icons.
3. **Keyboard & a11y**: tab order, visible focus, `aria-label` on icon-only
   buttons, sufficient contrast in both themes.
4. **Copy pass**: no `TODO`, `lorem`, `Text here`, `Coming soon`, `WIP`,
   placeholder names visible to users.
5. **Consistency**: icons from one set, spacing tokens (not raw px), radius
   and typography tokens throughout critical paths.

Verification: screenshot the before/after of critical path screens. Add them
to the audit doc under Pass log.

### Track C — Structure
**Goal**: a new contributor can navigate the repo. Dead code gone, deprecated
dirs removed, oversized files split, module boundaries clear.

Scope:
- Delete `src/features/home/i18n/` and `src/features/home/components/releases/i18n/`
  after migrating live usage to `src/i18n/en.ts` (CLAUDE.md flags these as
  deprecated).
- Dead-code sweep: un-exported symbols with no references, orphaned components,
  unreachable branches. Use `knip` or TS compiler data — don't guess.
- Files > 800 lines on critical paths: split by concern, not by line count.
- Circular dependency check: `npx madge --circular src/`.
- Zustand slice hygiene: slices doing unrelated things get split; selectors
  using `useShallow` where they should.
- Rust: dead `#[allow(dead_code)]` cleanup, module visibility audit.

Ask before deleting any file > 200 lines or any exported symbol used outside
its module.

### Track D — OSS-Readiness
**Goal**: the repo looks like a real open-source project on GitHub at a glance.

Deliverables (ask before adding/editing any of these — they're policy):
- `LICENSE` — confirm the license with the user. MIT, Apache-2.0, or AGPL are
  most common for dev-tools desktop apps. Do not pick one without approval.
- `README.md` — rewrite as a product README: one-line pitch, screenshot,
  install/run, features, architecture pointer, contributing pointer, license.
  Current `README.md` (if any) is probably dev-scratch.
- `CONTRIBUTING.md` — dev setup from a clean clone (Windows/mac/Linux), how
  to run tests, commit message conventions, PR checklist.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 is standard.
- `SECURITY.md` — where to report vulns, SLA, PGP key or private email.
- `.github/ISSUE_TEMPLATE/bug.yml` + `feature.yml` — structured forms.
- `.github/PULL_REQUEST_TEMPLATE.md` — checklist matching ground rules.
- `.github/workflows/ci.yml` — typecheck + lint + test + `cargo check` on PR.
- `.github/workflows/release.yml` — tag-triggered Tauri build for three
  platforms (ask before adding; this needs secrets configured).
- `CODEOWNERS` — if the repo has multiple maintainers.
- `.env.example` with all env vars the app reads, commented.

### Track E — Security & Privacy
**Goal**: nothing in the repo or the built binary leaks secrets or tracks
users without consent.

Scope:
- `git grep -E '(api[_-]?key|secret|token|password)' -n` — triage every hit.
- Sentry DSN, GA IDs, posthog keys: must be env-injected, not committed;
  and must have a user-visible opt-out at first run.
- Tauri `allowlist` / capabilities: principle of least privilege.
- CSP in `tauri.conf.json`: no `unsafe-eval`, tight `connect-src`.
- `npm audit --omit=dev` and `cargo audit` — fix criticals, document
  accepted risks.
- Keyring usage: confirm no plaintext fallback path exists.
- Log hygiene: Rust `tracing::error!` and `console.error` calls that include
  user data or secrets.

### Track F — Distribution
**Goal**: a user downloads a release asset and runs the app.

Scope:
- `tauri.conf.json`: `identifier`, `productName`, `version`, `publisher`,
  window defaults, icon paths — all coherent.
- Icons present at every required size for every platform.
- First-run UX: welcome screen, permissions explainer, opt-in telemetry
  toggle, links to docs/Discord.
- Auto-updater: wired, endpoint configured (or explicitly disabled for 1.0).
- Installer: `.msi` on Windows, `.dmg` on mac, `.AppImage` + `.deb` on Linux.
- Code signing: at minimum document what signing setup is needed; don't run
  signing ceremonies without user approval.
- Release workflow dry-run on a fork/tag.

This track is almost entirely gated on user approval because it touches
infrastructure and may require secrets.

### Track G — Docs
**Goal**: a contributor can understand the architecture in 30 minutes.

Scope:
- `docs/architecture.md` — high-level diagram (Tauri IPC boundary, stores,
  engine, DB), pointer to each top-level dir's purpose.
- `docs/adding-an-integration.md` — distill the 9-step playbook from
  `MEMORY.md` into public docs.
- `docs/i18n.md` — extract the CLAUDE.md i18n rules into public docs.
- Per-module READMEs for `agents/`, `vault/`, `overview/`, `src-tauri/`.
- `CHANGELOG.md` — initialize with `[Unreleased]` and the changes in this
  session.
- Screenshots / GIF embedded in main README.

Docs track is usually last because it should reflect the final state.

---

## Per-pass execution protocol

For every single pass:

1. Announce: `Pass N [track]: <title>. Scope: <files>. Expected outcome: <1 line>.`
2. Make the minimum change that achieves the outcome.
3. Run verification commands appropriate to the track (see Ground rule 4).
4. Commit atomically with the message format.
5. Append to the audit doc under `## Pass log`:
   - Track, title, commit sha
   - Metrics delta (TS errors, lint warnings, test counts, bundle size)
   - Screenshots for Polish passes
   - Self-grade: Did this match the predicted impact? (A/B/C)
   - Surprises
6. One-sentence user update.

If verification fails: `git reset --hard HEAD~1`, record the attempt in the
pass log with *why it failed*, move to the next item. No more than 2 reverts
before pausing to re-plan with the user.

---

## Phase 4 — Release-candidate summary

When the stop condition hits, append to the audit doc:

```markdown
## Release-candidate summary

### Scorecard delta
| Dimension | Before | After | Δ |
|-----------|--------|-------|---|
(from Phase 1 scorecard)

### Metrics delta
- TS errors, lint warnings/errors, hook violations, test runtime, bundle size,
  rust warnings, i18n coverage per locale.

### Passes completed
| # | Track | Title | Commit | LOC± | Self-grade |
|---|-------|-------|--------|------|-----------|

### Still-broken / known issues
What a user will hit. Ranked by severity. Each gets a GitHub issue draft
(title + body + labels) so they can be filed after merge.

### Shippable? (honest verdict)
- Minimum-viable-OSS-release: yes / no + what still blocks.
- If no: what's the smallest next session that would close the gap?

### Honest self-assessment
- Most uncertain change.
- Scope creep incidents.
- What a human reviewer would rightly push back on.
- Did Phase 1 predictions match Phase 3 reality?
```

---

## Autonomy knobs (edit before running)

| Knob | Default | Options |
|------|---------|---------|
| Tracks enabled | `Fix, Polish, Structure, OSS, Sec, Docs` | any subset; `Distribution` is opt-in |
| Max passes per session | `10` | integer |
| Wall-clock cap | `3 hours` | any |
| i18n extraction | `full on critical paths; 5/file elsewhere` | `full` \| `critical-only` \| `none` |
| Delete deprecated dirs | `ask first` | `no` \| `ask` \| `yes` |
| Dependency upgrades | `patch-only, ask before each` | `no` \| `patch` \| `minor` \| `yes` |
| Touch migrations / schema | `no, ask first` | `no` \| `ask` |
| Touch Tauri command signatures | `no` | `no` \| `ask` |
| License selection | `ask first, do not assume` | `ask` \| explicit license name |
| Push tags / publish release | `never` | `never` \| `ask` |
| Edit `.github/` | `ask first` | `ask` \| `yes` |

---

## Explicit failure modes to avoid

- **Bundling tracks in one commit.** A fix + a polish change in one commit
  makes review impossible. Split them.
- **Chasing the TS error count down by deleting tests or `@ts-ignore`ing.**
  Errors get *fixed*, not muted.
- **Bulk i18n migration on non-critical paths.** CLAUDE.md forbids it; still
  forbidden here except on the five critical paths.
- **Adding dependencies to solve problems that don't need them.**
- **Inventing a license.** Pick only what the user confirms.
- **Committing secrets** while adding `.env.example` — double-check every
  value.
- **"Improving" code style without a ship-readiness benefit** — if it's not
  in one of the seven tracks, it's out of scope.
- **Silent scope creep.** If a pass grows, stop and re-plan.
- **Performative confidence.** If evidence is weak, say so in the pass log.

---

## What "ship-ready" looks like (evaluator rubric)

Cross-check the final report against this:

- **Detection**: Phase 1 audit identifies real blockers a senior engineer
  shipping this product would also flag. Bonus for catching non-obvious ones
  (dead code, subtle a11y gaps, CSP holes, opt-out flow missing).
- **Track discipline**: Each commit stays in its track. Commit log reads as
  a narrative a maintainer could summarize in 30 seconds.
- **Calibration**: Rejected-candidates list shows taste. Self-grades align
  with actual impact visible in the diff.
- **Instruction-following**: Zero hardcoded JSX strings introduced, zero
  raw `invoke` calls, zero semantic-token violations, no unapproved deletes
  or `.github/` edits.
- **Ship-readiness delta**: Scorecard moves up meaningfully. The "can a
  stranger clone, build, run, contribute?" test is closer to yes.
- **Honesty**: Self-assessment surfaces real uncertainty; known-issues
  section is filed and visible, not swept under the rug.
