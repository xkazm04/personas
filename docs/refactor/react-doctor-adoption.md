# React Doctor adoption + large-scale UI refactor plan

> Produced by `/research` on 2026-07-26 from <https://www.react.doctor/docs/overview/quickstart>.
> Every number below comes from a real scan of this repo at commit `c8cc3f69a`, not from
> the vendor's documentation. Raw per-partition JSON reports are reproducible with the
> commands in §2.

---

## 1. Verdict

**Yes, we can scan this repo — but only in partitions, and the tool has a silent-failure
mode that any CI wiring must defend against.**

React Doctor v0.9.1 correctly auto-detected the stack (`framework: vite`, React 19.2,
Tailwind 4.3, Zustand 5) and fired **zero** rules from irrelevant families (Next.js, Ink,
MobX, Jotai, react-three-fiber, React Native, React Router, Zod, Supabase, Firebase,
Redux, TanStack). No denoising config is required.

### Scan feasibility matrix

| Mode | Outcome |
| --- | --- |
| `npx react-doctor` (full repo, `--max-duration 900`) | ❌ `ReactDoctorError(ScanDeadlineExceeded)` — `projects: []`, **0 diagnostics** |
| Full repo, `--no-dead-code --no-supply-chain --max-duration 3300` | ⚠️ **`ok: true`, "5 issues"** — but `skippedChecks: ["lint"]`, `complete: false` |
| `--scope files --base <sha>` (350 changed files) | ✅ 225 s, 674 diagnostics |
| Per-directory partition (e.g. `./src/features/vault`, 259 files) | ✅ 149 s, `complete: true` |
| **42 partitions covering the whole frontend** | ✅ **4,230 files, all `complete: true`** |

### ✅ The lint cap IS removable — undocumented env var

**Update (2026-07-26, after the first draft).** The 300 s lint cap can be raised. The
package exposes undocumented environment variables; the source comment states plainly:
*"The env var lets CI / eval runners raise the phase budget for slow large repos without
recompiling."*

| Env var | Default | Effect |
| --- | --- | --- |
| `REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS` | `3e5` (300 s) | **The lint cap. Raise this.** |
| `REACT_DOCTOR_SCAN_DEADLINE_MS` | `9e5` (900 s) | Total scan backstop |
| `REACT_DOCTOR_OXLINT_SPAWN_TIMEOUT_MS` | `6e4` (60 s) | Per-oxlint-spawn |
| `REACT_DOCTOR_DEAD_CODE_PHASE_TIMEOUT_MS` | `15e4` (150 s) | Effect-side dead-code cap |

With the caps raised, **the whole-repo scan works and is far faster than partitioning**:

```bash
REACT_DOCTOR_LINT_PHASE_TIMEOUT_MS=5400000 \
REACT_DOCTOR_SCAN_DEADLINE_MS=7200000 \
npx react-doctor@latest --yes --no-score --no-supply-chain \
  --json --json-out report.json --max-duration 7000 .
# → 4,296 diagnostics / 1,318 files / 4,506 scanned, in 150 s
```

This **supersedes the partitioned workflow** in §2 for lint. Partitioning cross-validated
it (4,247 / 1,293 across 42 partitions); the 53-diagnostic delta is files outside the
partition set — `cloud-worker/`, `scripts/`, `.github/`, `pnpm-workspace.yaml`, and stale
`.claude/worktrees/` copies. Add `.claude/worktrees` to the ignore config so stale
worktrees stop being scanned.

**Dead-code is NOT raisable.** Its worker timeout is *computed*, not read from the env:
`min(ceiling, max(120 s, sourceFileCount × 30 ms × coreShareFactor))` — at 4,506 files
that is exactly the 135.18 s we observed. There is no env var for it. Not a loss: `knip`
(`npm run check:dead`) already covers this axis, so keep running with `--no-dead-code`.

### ⚠️ The silent-failure mode — read before wiring CI

Lint analysis has a **hard internal 300-second cap that `--max-duration` does not raise**.
When it trips, the run still exits `ok: true`, emits no `error` field, and prints a
clean-looking summary. Our full-repo run reported **"5 issues"** while having skipped
**99 %** of its own analysis. The only evidence is nested three levels deep:

```jsonc
projects[0].complete            // false
projects[0].skippedChecks       // ["lint"]
projects[0].skippedCheckReasons // { "lint": "Lint analysis exceeded 300s and was skipped." }
```

**Any CI job or script that consumes this tool MUST assert
`report.projects.every(p => p.complete === true)`.** A gate that only reads
`summary.errorCount` will report green on a scan that never ran. This is the classic
"green gate that asserts data, not behaviour" trap.

### Other operational gotchas found

- `--base HEAD~15` is **rejected** — the ref validator bans `~`. Pass a resolved SHA
  (`git rev-parse HEAD~15`).
- `--json --json-out <path>` suppresses **all** stdout; don't pipe it expecting output.
- Default behaviour uploads to a score/share API. Every command below uses `--no-score`
  so nothing about this private codebase leaves the machine. Decide deliberately before
  removing it.
- `--supply-chain` (on by default) sends dependency metadata to Socket.dev.

---

## 2. Reproducing the scan

```bash
# Per-PR gate (what CI should run) — fast, only new issues
BASE=$(git merge-base origin/master HEAD)
npx react-doctor@latest --no-score --scope changed --base "$BASE" --json --json-out report.json

# Pre-commit (lefthook already present)
npx react-doctor@latest --no-score --staged

# Full-coverage sweep — partitioned, ~35 min wall clock across 42 partitions
for d in src/features/*/ src/features/plugins/*/ src/features/agents/sub_*/ \
         src/hooks src/lib src/stores src/api; do
  npx react-doctor@latest --yes --no-score --no-dead-code --no-supply-chain \
    --json --json-out "reports/$(echo "$d" | tr '/' '-').json" "./$d"
done
# then assert every projects[0].complete === true before trusting the aggregate
```

`--no-dead-code --no-supply-chain` is what keeps each partition under the 300 s lint cap.
Dead-code and supply-chain analysis should be run as **separate, whole-repo** jobs — the
repo already has `knip` (`npm run check:dead`) covering the dead-code axis.

---

## 3. Baseline: what the scan found

**4,247 diagnostics across 1,293 files** (4,230 files scanned, 94 distinct rules fired).

| Category | Count | Repo's existing coverage |
| --- | --- | --- |
| Bugs | 2,249 | partial — 20 custom ESLint rules, `react-hooks` at *warn* |
| Performance | 958 | none |
| Accessibility | **659** | **none** — one custom rule (`role-button-requires-keydown`) |
| Maintainability | 375 | partial — catalog/boundary scripts |
| Security | 6 | strong — see §6 |

Severity: **288 errors**, 3,959 warnings.

### Top 15 rules

| n | files | sev | category | rule |
| ---: | ---: | --- | --- | --- |
| 1,424 | 515 | warn | Bugs | `button-has-type` |
| 226 | 164 | warn | A11y | `control-has-associated-label` |
| 221 | 150 | warn | Perf | `no-transition-all` |
| 204 | 161 | warn | Bugs | `no-array-index-as-key` |
| 192 | 143 | warn | Perf | `js-combine-iterations` |
| 191 | 191 | warn | Perf | `use-lazy-motion` |
| 188 | 91 | warn | A11y | `label-has-associated-control` |
| 186 | 92 | warn | Maint | `only-export-components` |
| 146 | 64 | warn | Bugs | `no-adjust-state-on-prop-change` |
| **120** | **40** | **error** | Perf | `no-layout-property-animation` |
| **117** | **75** | **error** | Bugs | `no-ref-current-in-render` |
| 89 | 88 | warn | Maint | `no-giant-component` |
| 70 | 57 | warn | A11y | `no-static-element-interactions` |
| 53 | 48 | warn | Maint | `prefer-module-scope-pure-function` |
| 50 | 42 | warn | A11y | `click-events-have-key-events` |

### Distribution by area

| Diagnostics | Area |
| ---: | --- |
| 846 | `src/features/plugins` |
| 684 | `src/features/agents` |
| 452 | `src/features/templates` |
| 389 | `src/features/overview` |
| 381 | `src/features/vault` |
| 340 | `src/features/shared` |
| 295 | `src/features/teams` |
| 219 | `src/features/settings` |
| 206 | `src/features/triggers` |

---

## 4. The refactor plan

Sequenced by **leverage per unit of diff**, not by count. Each tier is independently
shippable and independently revertable.

### Tier A — Shared-primitive fixes — ⚠️ REVISED after implementation

The first draft called this "the highest-value finding". **Implementation showed that was
over-stated**, for two reasons found only by opening the files. Recording the correction
here so the next reader doesn't repeat the reasoning.

The 120 `no-layout-property-animation` errors split by animated property:

| Property | n | Transform equivalent? |
| --- | ---: | --- |
| `height` | 86 | ❌ No drop-in equivalent for auto-height content |
| `width` | 23 | ✅ `scaleX` + `origin-left` — visually identical |
| `left` / `top` | 6 | ✅ `translateX/Y` |
| `marginTop/Bottom` | 5 | ✅ `translateY` |

Only **34 of 120** are safely, mechanically fixable. The other 86 are the auto-height
collapse pattern, which is a design decision, not a lint fix.

| File | Status |
| --- | --- |
| `shared/components/progress/WizardStepper.tsx:31-32` | ✅ **DONE** — `width` → `scaleX`, verified 2 → 0 errors |
| `agents/sub_lab/components/shared/TimelineEntry.tsx:112-114` | 🗑️ **DEAD CODE** — zero references repo-wide. Delete, don't fix |
| `shared/components/layout/SectionCard.tsx:203-205` | ⛔ **Do not migrate naively** — see below |

#### Why `SectionCard` must not be migrated to `Collapse`

The repo already has a `Collapse` primitive
(`shared/components/display/Collapse.tsx`, pure-CSS `grid-template-rows: 0fr → 1fr`) that
does not trip the rule — so this looks like a trivial reuse fix. **It is not.**

`Collapse` renders `{children}` **unconditionally** (line 29). `SectionCard` today wraps
its body in `AnimatePresence` + `{!collapsed && …}`, which **unmounts the content when
collapsed**. Migrating would keep every collapsed section's subtree mounted across **28
call sites** — effects still running, subscriptions still live. That is a likely
performance *regression*, the opposite of the tier's goal.

Three honest options, all design tradeoffs rather than bug fixes:

1. **Leave as-is.** The animation is user-initiated and infrequent (a click, 200 ms) — not
   a hot path like scroll or drag. The error is real but the practical cost is low.
2. **Fade only** — drop the height keyframes, keep `AnimatePresence` + opacity. Clears the
   error and preserves unmount, but loses the smooth height slide. A visual change.
3. **Extend `Collapse`** with an `unmountWhenClosed` prop, then migrate. Most work, best
   end state, needs visual verification across 28 call sites.

**Recommendation: (1) for now.** Spend Tier A effort on the mechanically-safe transform
fixes instead — done, see below.

#### ✅ Transform sweep — SHIPPED (`4322a1145`)

Converted **26 sites across 13 files**; verified `120 → 94` errors
(`width` 23→2, `left` 5→1, `top` 1→0). tsc clean, eslint 0 errors, 2,659 tests passing.

| Shape | Conversion |
| --- | --- |
| Progress bars | `width: N%` → `scaleX: N/100` on a `w-full origin-left` child |
| Indeterminate shimmers | `left` keyframes → `x` keyframes, rebased from track-relative to element-relative |
| `AthenaOrb` | `left/top` → `x/y`, anchored at origin — the hottest site (spring glide + pointer drag) |

**Not converted, deliberately** (the count was 34, the safely-convertible reality was 26):

- `GlyphCoreContent.tsx:222-223` — pulse ring whose `border-2` would scale with it.
- `PolaritySlider.tsx:30` — knob `left` is *track*-relative; Framer's `x` percentages are
  *element*-relative, so there is no equivalent without measuring the track.
- `KnowledgeAtelier.tsx:371-373`, `DeadLetterTab.tsx:625`, `SmeeRelayTab.tsx:359` — the
  `marginTop`/`marginBottom` values are bundled with `height: 0`/`auto` in the same
  keyframe, so they belong to the 86-site height class, not this one.

**Two rendering nuances, accepted rather than overlooked:** a gradient fill now spans the
whole track and is *revealed* rather than compressed into the fill; and `rounded-full` end
caps squash slightly at low fill. Both are standard for `scaleX` progress bars and
imperceptible at these bar heights (1–2 px tall), but they are **not pixel-identical**.
Revert individually if any bar looks wrong.

### Tier B — Bundle: adopt `LazyMotion` (1 architectural change + codemod)

**191 files import the full `motion` bundle; `LazyMotion` is used exactly 0 times.**
React Doctor estimates ~30 kb. Wrap the app root in
`<LazyMotion features={domAnimation} strict>` and codemod `motion.` → `m.`.

The `strict` flag makes the migration self-verifying: it throws at runtime on any
remaining full-`motion` usage, so nothing can silently regress.

**Effort:** ~half a day (mechanical codemod + one manual review pass for
`AnimatePresence`/`useAnimation` call sites). **Verify with `npm run check:budget`,
which already exists** — do not accept the vendor's 30 kb claim without measuring.

### Tier C — Mechanical sweeps (gate-able, low risk)

| Rule | n | files | Shape |
| --- | ---: | ---: | --- |
| `button-has-type` | 1,424 | 515 | Add `type="button"` |
| `no-transition-all` | 221 | 150 | `transition-all` → `transition-colors\|opacity\|transform` |
| `no-array-index-as-key` | 204 | 161 | Per-site judgment; semi-mechanical |

**On `button-has-type`:** the shared button primitives are **clean** —
`src/features/shared/components/buttons/` has **0** violations and `Button.tsx:222`
correctly forwards `type`. All 1,424 hits are raw `<button>` elements that bypassed the
primitive. This is the first *quantified* measure of the shared-component-reuse drift
that `.claude/CLAUDE.md` calls "the #1 source of UI drift". Two options:

- **C1 (recommended):** codemod `type="button"` onto every raw `<button>`, clearing the
  gate now; separately track primitive migration as design work.
- **C2:** migrate raw `<button>` → `@/features/shared/components/buttons/Button` where it
  is a styled button. Much larger diff, much higher long-term value, but it is a design
  decision per call site — **not** a sweep.

Do **not** conflate them. C1 is a lint sweep; C2 is the reuse-drift project.

**On `no-transition-all`:** this belongs alongside the existing `custom/no-raw-*-classes`
ESLint family. Prefer adding a custom rule so it's enforced going forward, rather than a
one-time sweep that regresses.

### Tier D — Accessibility (659 findings, net-new coverage) ⚠️ read the i18n cost

The repo has **no accessibility linting at all**. This is the largest genuinely-uncovered
surface, and the highest-value tier for product quality.

| Rule | n | files |
| --- | ---: | ---: |
| `control-has-associated-label` | 226 | 164 |
| `label-has-associated-control` | 188 | 91 |
| `no-static-element-interactions` | 70 | 57 |
| `click-events-have-key-events` | 50 | 42 |
| `no-placeholder-only-field` | 37 | 24 |
| `no-autofocus` | 29 | 29 |
| `html-no-nested-interactive` | 28 | 18 |

**The i18n multiplier is the load-bearing constraint here.** ~414 of these findings are
fixed by adding an `aria-label`, which is a **user-facing string**. Per
`.claude/CLAUDE.md` → Internationalization, every one must land in
`src/i18n/locales/en.json` and be translated into **all 14 locales in the same commit**,
gated by the `i18n-no-gaps` pre-commit hook.

So Tier D is not "add 414 aria-labels" — it is "add ~414 i18n keys × 14 locales". Budget
accordingly and use the `translate-extract` → per-locale subagent → `translate-merge`
pipeline; do not hand-edit 13 files.

**Recommendation:** ship Tier D area-by-area (start with `shared/` — 56 a11y findings
across 110 files — then the highest-traffic feature areas), batching i18n keys per area
so each commit clears `npm run check:i18n:strict`.

### Tier E — Correctness errors (288), individually reviewed

| Rule | n | files | Treatment |
| --- | ---: | ---: | --- |
| `no-layout-property-animation` | 120 | 40 | Tier A covers the shared 8; remaining 112 are per-site perf fixes |
| `no-ref-current-in-render` | 117 | 75 | **Policy decision — see below** |
| `no-effect-with-fresh-deps` | 19 | 16 | Genuine bug candidates, review each |
| `no-impure-state-updater` | 17 | 14 | Genuine bug candidates, review each |
| `effect-needs-cleanup` | 12 | 12 | Overlaps existing `custom/no-unmanaged-effect-resources` |

#### `no-ref-current-in-render` — do NOT bulk-fix

This is the second-largest error class, and **it is largely a deliberate repo idiom, not
117 bugs.** Verified at `src/hooks/utility/data/useAppSetting.ts:34-43`: the render-phase
ref writes carry an explicit comment documenting them as the fix for a *worse* bug
(per-render IPC probes clobbering the user's unsaved edits).

The rule is legitimate — React render must stay pure — and the React-19-sanctioned
replacement is `useEffectEvent` (React Doctor separately fires `prefer-use-effect-event`
33× across 18 files, pointing the same way). But converting 75 files' latch idiom is an
**architectural decision about the repo's hook conventions**, not a lint cleanup.

**Recommendation:** make an explicit call — either adopt `useEffectEvent` as the
convention and migrate deliberately, or `react-doctor rules set
react-doctor/no-ref-current-in-render warn` with the rationale recorded. Either way,
decide it; do not let 117 errors sit unexplained in the baseline.

### Tier F — Declined / not worth sweeping

| Rule | n | Why declined |
| --- | ---: | --- |
| `js-combine-iterations` | 192 | Micro-optimisation; no measured impact in a desktop app |
| `only-export-components` | 186 | Fast-Refresh ergonomics, dev-only |
| `js-set-map-lookups` | 46 | Same as above |
| `no-giant-component` | 89 | Already a stated operator directive (<200 LOC). Adopt as a **gate**, not a sweep — a mass component split is a design project |
| `client-localstorage-no-version` | 23 | Reasonable, but low priority |

---

## 5. Adoption mechanics

1. **`doctor.config.ts`** at repo root — record deliberate rule severities (notably the
   `no-ref-current-in-render` decision from Tier E) so the policy is versioned, not tribal.
2. **CI gate: `--scope changed`, `--blocking error`.** Gates *new* code only; the existing
   4,247 stay as a tracked burn-down. This is the only way to adopt a 745-rule linter on a
   mature codebase without a flag day.
3. **The `complete === true` assertion is mandatory** (see §1). Without it the gate is
   decorative.
4. **Pre-commit:** `--staged` via the existing lefthook setup.
5. **Periodic full sweep:** the 42-partition script, monthly, with the aggregate committed
   as the burn-down baseline.
6. **Do not run `npx react-doctor install`** without review — it writes agent skills and
   git hooks into the repo, and this project already has an opinionated lefthook +
   `.claude/skills/` layout.

### Relationship to existing gates

React Doctor **overlaps but does not replace** what exists:

| Existing | Overlap |
| --- | --- |
| 20 custom ESLint rules | `no-silent-catch`, `no-unmanaged-effect-resources`, `role-button-requires-keydown` overlap the Bugs/A11y categories |
| `knip` (`check:dead`) | Covers dead-code; keep knip, use `--no-dead-code` |
| `check:themes`, `no-raw-*-classes` | Design-token axis React Doctor does not cover |
| `check:i18n:strict` | React Doctor has no i18n awareness — and Tier D *creates* i18n work |

The genuinely additive surface is **Accessibility (659)** and **Performance (958)**.

---

## 6. Security findings — 6 total, verified individually

The scan is **not** a substitute for the repo's existing security posture (HMAC IPC auth,
DOMPurify sanitizers, credential encryption), and it found very little. Each was checked
against source:

| Finding | Location | Verdict |
| --- | --- | --- |
| `iframe-missing-sandbox` | `src/features/studio/StudioPage.tsx:233` | ✅ **REAL — worth acting on.** The Studio preview `<iframe>` renders **locally-built, AI-generated web apps** with no `sandbox` attribute. Default permissions allow top-level navigation, form submission and popups. Add an explicit `sandbox="allow-scripts allow-same-origin"` (or narrower) |
| `window-open-without-noopener` | `src/features/agents/.../PersonaRunner.tsx:109` | ✅ Real, trivial — add `'noopener,noreferrer'` |
| `dangerous-html-sink` | `.../HighlightedJsonBlock.tsx:30` | ❌ **False positive** — input passes through `sanitizeHljsHtml` (DOMPurify, `span`+`class` allowlist) |
| `dangerous-html-sink` | `.../DraftJsonTab.tsx:88` | ❌ Same sanitizer path |
| `insecure-crypto-risk` ×2 | `executionSlice.ts:427`, `debuggerMocks.ts:56` | ⚠️ Low — idempotency keys and test mocks, not security tokens |

React Doctor does not trace through helper functions, so it cannot see the sanitizer. Two
of six are false positives — a useful calibration on how much to trust the category.

---

## 7. Suggested sequencing

| Step | Tier | Effort | Gate |
| --- | --- | --- | --- |
| 1 | A — shared primitives | ~1 h | `npm run check` |
| 2 | CI wiring + `complete` assertion | ~2 h | scan a PR |
| 3 | B — LazyMotion | ~4 h | `npm run check:budget` (measure, don't assume) |
| 4 | E — the `no-ref-current-in-render` decision | discussion | ADR |
| 5 | C1 — `button-has-type` codemod | ~3 h | `npm run check` |
| 6 | D — a11y, area by area | multi-session | `check:i18n:strict` per area |
| 7 | E — remaining errors, reviewed individually | multi-session | per-fix tests |

Tiers A–C touch `src/features/shared/**` and are best done in a **git worktree** per the
parallel-safety primitives in `.claude/CLAUDE.md`; a concurrent session is currently live
on the main checkout in `sub_workspaces` / `sub_manual-review`.
