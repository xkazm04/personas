# Opus 4.7 — Personas Web OSS Release Passes

Specialized, themed passes aimed at turning **personas-web** (Next.js 16 App
Router + React 19 + TypeScript 6 + Tailwind 4 + Supabase + Sentry + Playwright)
into a deliverable open-source product. Derived from `opus-4.7-codebase-pass.md`
but narrowed: the goal here is **ship-ready polish, fixing, and code structure
quality** — not a general upgrade audit.

A senior reviewer should be able to clone this repo, run one command, read one
README, and understand the project within 10 minutes. That is the bar.

---

## How to run

```bash
# From repo root
claude --model claude-opus-4-7 --effort xhigh
# Paste the "Mission" section as the first message.
# Stop after the Recon deliverable. Gate-review before any pass executes.
```

Dedicated branch per session so diffs are reviewable:

```bash
git checkout -b oss-release/$(date +%Y-%m-%d)
```

---

## Mission

Audit **personas-web** against an OSS-release readiness bar and execute
specialized, themed passes that close the gaps. Proceed autonomously through
**Phase 1 (Recon)** only, then **stop for human approval** before touching code.

Optimize for *contributor experience and ship-ability per unit of risk*. One
pass that makes a new contributor productive is worth more than ten cosmetic
diffs. You are being judged on taste and restraint, not volume.

---

## Ground rules (non-negotiable)

1. **Read `.claude/CLAUDE.md` first and obey it.** If any rule below conflicts
   with CLAUDE.md, CLAUDE.md wins — flag the conflict in the audit.
2. **Never introduce hardcoded user-facing English** in JSX, aria-labels, alt
   text, or page metadata. Use `t` / `tx` from `src/i18n/useTranslation.ts` and
   add keys to `src/i18n/en.ts` (other locales can stay English until a
   translation pass runs).
3. **Preserve public surface.** No breaking changes to:
   - Route paths under `src/app/`
   - Supabase table names or RLS policies
   - Exported component props (unless the audit justifies it and a human
     approves)
   - Environment variable names already referenced in code
4. **Every pass must end green.** After each code-modifying commit run:
   - `npx tsc --noEmit` — error count must not *increase* vs. baseline
     recorded at session start
   - `npm run lint` — no new errors; warnings must not increase
   - `npx playwright test --project=chromium` for any page-level change
     (narrow to affected spec if possible; full suite if not)
   - `npm run build` for any change touching `next.config.ts`, middleware,
     instrumentation, or `app/` layouts
5. **Commit discipline.** One atomic change per commit:
   ```
   <pass-id>/<area>: <what changed>

   Why: <root-cause or value, 1–3 lines>
   Risk: <low|med|high + rationale>
   Verified: <tsc|lint|build|playwright:spec>
   ```
6. **Ask before destructive or externally-visible ops.** Deleting files,
   renaming routes, changing Supabase schemas, editing `.github/` workflows
   once they exist, bumping `package.json` pins, touching `sentry.*.config.ts`
   DSNs — all require confirmation.
7. **No speculative refactors.** If you cannot state the
   contributor-visible or user-visible benefit in one sentence, don't do it.
8. **OSS lens.** When in doubt, optimize for "a stranger clones this and it
   works" over "the current team knows how it works."

---

## Phase 1 — Recon (READ-ONLY, ~30 min, then STOP)

Read-only. Produce a written audit. No code changes.

### Deliverable: `audit-reports/oss-release-<YYYY-MM-DD>.md`

Structure:

```markdown
# personas-web — OSS Release Audit (<date>)

## Baseline metrics
- TS errors: <npx tsc --noEmit | count>
- Lint: <errors / warnings from npm run lint>
- Playwright: <passing / failing / skipped>
- `npm run build` status + bundle summary (first-load JS per route)
- LOC by top-level src/ subdir
- Public env vars referenced vs. documented (grep NEXT_PUBLIC_, process.env)
- Hardcoded-string risk: sample grep of JSX text in src/app/ for
  non-i18n strings

## What this repo actually is
3–5 sentences. What does it ship? Who is the target user? Where does the
complexity live? Cite concrete paths.

## OSS readiness scorecard
Score each 0–3 (0 = missing, 3 = exemplary). Cite evidence.

| Dimension | Score | Evidence | Gap |
|---|---|---|---|
| README (quickstart works as-written) | | | |
| LICENSE present and referenced | | | |
| CONTRIBUTING + PR template | | | |
| CODE_OF_CONDUCT | | | |
| SECURITY.md (how to report vulns) | | | |
| .env.example + env var docs | | | |
| One-command setup (clone → running) | | | |
| CI (lint/type/test on PR) | | | |
| Type cleanliness (tsc --noEmit green) | | | |
| Lint cleanliness (0 warnings) | | | |
| Test coverage of critical flows | | | |
| Accessibility (landmarks, alt, focus) | | | |
| i18n hygiene (no stray English) | | | |
| SEO / social (title, OG, sitemap, robots) | | | |
| Error boundaries + loading states | | | |
| Dead code / duplication | | | |
| Dependency freshness + license compat | | | |
| Sentry PII scrubbing + opt-out | | | |
| Secret hygiene (no keys in repo/history) | | | |
| Folder/naming consistency | | | |

## Per-pass opportunity list
For each specialized pass below (A–I), list the 1–5 concrete items you'd
execute and their Impact(1–5) × Confidence(1–5) ÷ Risk(1–5) score. If a
pass has nothing worth doing, say so — that is a valid answer.

## Considered but rejected
Short list of candidates you looked at and chose not to rank, with a
one-line reason. Calibration test — don't skip.

## Uncertainties
Top 3 things you don't know that would change your priorities. For each,
the single question a human could answer to unblock you.
```

**Stop after writing this audit.** Do not continue to any pass without
explicit approval.

---

## Phase 2 — Pick the pass set

The human selects which passes (A–I below) run this session, in what order,
with what caps. Typical first session: **A + B + one other**. Do not attempt
all nine in one sitting.

Propose a plan: passes chosen, rough LOC per pass, stop condition (e.g., "3
passes or 90 minutes or any red check"), and a rollback plan.

Wait for approval of the plan.

---

## Phase 3 — Execute the chosen passes

Each pass is a mini-workflow: recon already done → plan stated → atomic
commits → verification → pass log entry. For every pass:

1. Announce: `Pass <id> — <title>. Scope: <files>. Expected outcome: <1 line>.`
2. Make the minimum change.
3. Run verification (tsc, lint, build or playwright where relevant).
4. Commit using the message format from the ground rules.
5. Append to `## Pass log` in the audit doc: what changed, metrics delta,
   surprises, self-grade (did reality match your Phase-1 prediction?).
6. One-sentence progress update to the user.

If verification fails: `git reset --hard HEAD~1`, log the failure, move on.
Do not retry the same pass more than once.

---

## Specialized passes

Each pass is optional and independently shippable. Pick based on Phase 1.

### Pass A — Repo hygiene & OSS foundation
**Goal:** a first-time visitor can understand, trust, and run the project.

Candidate work:
- Rewrite `README.md` (what it is, screenshots/demo URL, tech stack,
  one-command local setup, env var table, license, contributing link)
- Add `LICENSE` (confirm choice with human — MIT / Apache-2.0 / AGPL)
- Add `CONTRIBUTING.md` (dev loop, commit style, branch naming, how to
  run tests)
- Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- Add `SECURITY.md` (private disclosure address, supported versions)
- Add `.env.example` mirroring every `process.env.*` the code reads
- Add `.github/PULL_REQUEST_TEMPLATE.md` and `ISSUE_TEMPLATE/` (bug + feature)
- Fill `package.json`: `description`, `repository`, `license`, `author`,
  `keywords`, `homepage`, `bugs`

**Out of scope:** redesigning the product, changing branding copy.

### Pass B — Type & lint cleanliness
**Goal:** `npx tsc --noEmit` and `npm run lint` both green, zero warnings.

Candidate work:
- Fix the current TS error backlog file-by-file; commit per file or per
  error cluster
- Remove `any` where a 1-line fix gives a real type
- Remove unused imports/vars/exports (verify with Grep before deleting)
- Enable stricter options in `tsconfig.json` only if the repo already passes
  them — no mass-churn flag flips

**Out of scope:** switching to a different type-checker, moving to `biome`.

### Pass C — Code structure & consistency
**Goal:** a new contributor can find things without asking.

Candidate work:
- Collapse duplicated helpers (e.g., multiple `format-*.ts`, two mock data
  files `mockData.ts` + `mock-dashboard-data.ts` — confirm overlap, then
  merge)
- Kebab-case vs. camelCase filename drift in `src/lib/` (decide one, migrate
  consistently — confirm with human before mass rename)
- Dead code removal (`dev.ts`, `event-bus-demo.ts` — verify unused before
  deleting)
- Co-locate single-use components next to their page; promote shared ones
  to `src/components/`
- Barrel-export audit: remove `index.ts` re-exports that serve no purpose

**Out of scope:** folder-structure overhaul, route restructuring.

### Pass D — UI/UX polish
**Goal:** consistent surface, no jarring states, predictable motion.

Candidate work:
- Replace raw `text-white` / `bg-black` with semantic tokens from the
  Tailwind config
- Add skeleton/loading states for async sections (SWR fetches)
- Add empty states for lists that can be empty
- Consistent page-level `error.tsx` / `not-found.tsx` / `loading.tsx` under
  each top-level route group
- Framer Motion: confirm `prefers-reduced-motion` respected everywhere

**Out of scope:** visual redesign, new components.

### Pass E — Accessibility & semantics
**Goal:** keyboard-navigable, screen-reader-sane, WCAG-AA contrast.

Candidate work:
- Every page has one `<h1>`, landmarks (`<main>`, `<nav>`, `<footer>`)
- Every interactive non-button is keyboard-accessible
- `alt` text on all `<Image>` / `<img>` (translated via `t`)
- Focus-visible styles on all interactive tokens
- aria-labels on icon-only buttons

**Out of scope:** full WCAG-AAA sweep, custom ARIA widgets.

### Pass F — Performance & SEO
**Goal:** green Lighthouse for public marketing pages.

Candidate work:
- `metadata` export on every public route (title, description, canonical,
  og, twitter)
- `sitemap.ts` and `robots.ts` in `src/app/`
- Image audit: all imports use `next/image` with correct sizing
- Font loading: confirm Geist uses `next/font` with `display: swap`
- Bundle check: any route >200kB first-load JS gets scrutinized

**Out of scope:** rewriting pages for perf, switching rendering modes.

### Pass G — Security & config
**Goal:** no secrets in repo, no PII to Sentry, sane CSP.

Candidate work:
- `git log -p` + `git ls-files | xargs grep -n 'sk_\\|service_role\\|SUPABASE_SERVICE'`
  — nothing sensitive committed
- Confirm `sentry-pii.ts` scrubs what it claims to (test with a sample
  event)
- `next.config.ts`: `headers()` with at minimum `X-Content-Type-Options`,
  `Referrer-Policy`, `Strict-Transport-Security` (prod), `Permissions-Policy`
- Supabase: confirm only anon key is `NEXT_PUBLIC_`; service_role server-only
- Cookie consent: confirm analytics respects it before firing

**Out of scope:** full pentest, adding WAF.

### Pass H — Testing & CI
**Goal:** every PR gets typed, linted, built, and smoke-tested automatically.

Candidate work:
- Add `.github/workflows/ci.yml`: install, `tsc`, `lint`, `build`,
  `playwright` (cached)
- Convert the 12 existing e2e specs to a `test` script in `package.json`
- Add a single unit-test harness for pure functions in `src/lib/` (vitest
  or node:test — pick the one with the smallest footprint)
- `npm run test` as the umbrella command

**Out of scope:** chasing coverage percentages, adding a second test runner.

### Pass I — Release readiness
**Goal:** repo looks and feels like a v1.0.0 deliverable.

Candidate work:
- `CHANGELOG.md` seeded with notable entries from recent commits
- Version bump in `package.json` (confirm semver with human)
- Demo deployment URL in README
- Screenshots or a short GIF in `README.md` (ask human to provide, or stub)
- Release checklist in `docs/RELEASE.md`

**Out of scope:** actually cutting the release, pushing tags, publishing.

---

## Phase 4 — Summarize

When the stop condition hits, append to the audit doc:

```markdown
## Session summary

### Metrics (before → after)
TS errors, lint warnings, test runtime, build status, first-load JS on
`/`, scorecard scores.

### Passes executed
| Pass | Title | Commits | Self-grade | Notes |

### Backlog
Phase-1 items not touched this session, with updated priorities.

### Honest self-assessment
- Where was I uncertain?
- What change am I least confident about?
- What did Phase 1 miss that surfaced during execution?
- What would a human reviewer legitimately push back on?
```

---

## Autonomy knobs (edit before running)

| Knob | Default | Options |
|---|---|---|
| Passes this session | `A + B + 1 more` | any subset of A–I |
| Max commits per pass | `8` | integer |
| Wall-clock cap | `90 min` | any |
| i18n key additions | `yes, needed for any new JSX text` | `yes` \| `no` |
| New dependencies | `no` | `ask` \| `yes` |
| Schema / RLS changes | `no` | `ask` \| `no` |
| Route renames / deletions | `ask first` | `no` \| `ask` |
| Bulk file renames | `ask first` | `no` \| `ask` |
| README screenshot stubs | `yes, placeholder paths` | `yes` \| `no` |

---

## Explicit failure modes to avoid

- Touching the `.claude/commands/goal-analysis-*.md` deletions shown in
  `git status` — that is the user's in-progress work, not yours.
- Rewriting translations across all 14 locale files. Add to `en.ts` only.
- Mass file renames to "normalize" style without a human sign-off — the
  blast radius on imports is larger than it looks.
- Editing Playwright specs so they pass. If a spec is wrong, explain why
  before changing it.
- Adding a testing library, a linter, or a bundler. This stack is fine.
- Inventing a LICENSE without confirming the user's choice.
- Committing screenshots or demo data with real user info.
- Claiming confidence you don't have. "I don't know" is a valid audit entry.

---

## Evaluator rubric

- **OSS foundation**: Can a stranger `git clone && npm install && npm run
  dev` and reach a working page in under 5 minutes using only the README?
- **Detection**: Does the Phase 1 scorecard flag the same gaps a senior OSS
  maintainer would flag? Bonus for non-obvious finds (e.g., a PII leak in
  Sentry, a license incompatibility in deps).
- **Instruction-following**: Zero hardcoded JSX strings added, zero raw
  secrets committed, zero public-API breakage, zero scope creep into
  CLAUDE.md-flagged pre-existing issues.
- **Execution**: Each commit atomic, reversible, green on checks, with a
  message a future contributor can parse without context.
- **Taste**: The "rejected" list shows judgment. The self-assessment names
  real uncertainty rather than performing confidence.
