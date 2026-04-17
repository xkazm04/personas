# Personas Desktop — Ship-Readiness Audit (2026-04-17)

> Auditor: Claude Opus 4.7 under the revised `opus-4.7-codebase-pass.md`
> (ship-ready/OSS-deliverable lens). Phase 1 = read-only recon. **No source
> file modified.** Phase 2 awaits approval.
>
> A sibling audit `4.7-audit-2026-04-17.md` already captured micro-findings
> (SSRF DNS rebinding, stale `react-hooks` disables, ffmpeg unused `Result`,
> parity-script path bug, `coerceArgs` array recursion, reqwest client
> consolidation). This report does **not** re-enumerate those — it stacks the
> ship-readiness lens on top and surfaces gaps the earlier audit didn't have
> a scope slot for.

---

## Baseline (2026-04-17, branch `opus-4.7-pass/2026-04-17`)

| Metric | Value | Δ vs. prior audit | Notes |
|---|---|---|---|
| TS errors (`npx tsc --noEmit`) | **3** | +3 (regression) | All in `src/i18n/en.ts`: duplicate `drive:` (9845/10972), duplicate `synthesis_suggestions`/`potential_duplicates` (10190/10376/10922). **i18n merge collisions — ship-blocker**. |
| Lint errors (`npm run lint`) | **3** | — | All in `src/i18n/en.ts:8319` — `no-useless-escape` on a Windows-path placeholder `"C:\Users\me\projects…"`. The three stale `exhaustive-deps` disables from prior audit are already gone. |
| Lint warnings | **10,117** | −13,042 ✅ | Huge drop from 23,159. `custom/no-raw-*-classes` and `custom/no-hardcoded-jsx-text` still dominate. `exhaustive-deps` (now loaded) surfaces 20-ish dep warnings including one in `useAutoUpdater.ts:75`. |
| Circular deps (`npx madge`) | **0** | — | Clean. |
| Test suite | 44 `.test.ts/tsx` files | — | Full suite not run in Phase 1. |
| Bundle size | not captured | — | Deferred — costs minutes; enabled on Polish/Dist passes. |
| Locale parity (en = **8,816** keys) | 12 locales at 83.7–83.8%; `cs` at **33.0%** | en keys +1,092, most locales regressed from ~100% | Translation pipeline has fallen behind en.ts drift. Not a ship-blocker (fallback works) but a ship-embarrassment. |
| Rust warnings | 81 (prior run) | — | Cargo not re-run this phase. |
| `npm audit` / `cargo audit` | not run | — | Queued for Security track pass. |
| Package metadata (`package.json`) | `name`, `version: 0.0.1`, `license: MIT`, `private: true` | — | Missing `description`, `repository`, `author`, `homepage`, `bugs`. |
| App version (`tauri.conf.json`) | `0.0.1` | — | Needs a real release version. |
| Sentry DSN / VITE_SENTRY_DSN config | not found in grep | — | Referenced in docs; runtime consent/opt-out flow unverified. |

---

## Ship-readiness scorecard

Score 0 = missing/broken, 1 = exists but rough, 2 = acceptable, 3 = polished.

| # | Dimension | Score | Evidence |
|---|---|---|---|
| 1 | First-run UX (fresh install → useful) | **2** | `src/features/onboarding/` has GuidedTour, AppearanceStep, TemplatePickerStep, CredentialsTourContent, PersonaCreationCoach. Haven't exercised end-to-end but the scaffolding is substantial. |
| 2 | README clarity for new users | **3** | 532 lines. Badges, per-platform setup, architecture pointer, build tiers (Starter/Team/Builder), Data Flow & Privacy table, troubleshooting, i18n docs. Unusually thorough. |
| 3 | CONTRIBUTING / dev setup reproducibility | **2** | `CONTRIBUTING.md` present; `docs/DEVELOPMENT.md` present. Have not diff-read the contents against the current repo state — may have drifted. |
| 4 | LICENSE + legal hygiene | **3** | MIT, `Copyright (c) 2025 Personas`. Clean. |
| 5 | Installer / signed binaries / updater | **1** | `tauri.conf.json`: Windows `certificateThumbprint: null`, macOS `signingIdentity: null` → unsigned. Updater configured (pubkey present, GitHub-releases endpoint). `.github/workflows/release.yml` + `installer-test.yml` exist. Users will hit SmartScreen/Gatekeeper warnings. |
| 6 | CI (build, test, lint on PRs) | **3** | `ci.yml`, `audit.yml`, `release.yml`, `installer-test.yml`. Sophisticated. |
| 7 | Issue / PR templates / CODEOWNERS | **3** | `bug_report.yml`, `feature_request.yml`, `config.yml`, PR template, CODEOWNERS all present. |
| 8 | Pre-existing bug burden (TS + hooks) | **1** | 3 TS errors (duplicate keys), 3 lint errors (escape chars). CLAUDE.md still claims ~159 pre-existing TS errors that no longer exist on this branch — stale. The duplicate-key errors will break the `npm run build` typecheck today. |
| 9 | Error states (visible + actionable) | **?** | Not surveyed in Phase 1 — needs a click-through sweep on critical paths. Error registry (`errors/errorRegistry.ts` + `useTranslatedError.ts`) is well-designed; question is whether every surface uses it. |
| 10 | Loading / empty states | **?** | Not surveyed in Phase 1. Same as above. |
| 11 | i18n coverage on critical paths | **2** | en.ts source-of-truth at 8,816 keys. ~10,117 `custom/no-hardcoded-jsx-text` warnings remain (down from prior baseline). Critical paths appear partially covered — not audited individually. `src/main.tsx:106,130` still has 2 hardcoded strings ("Something went wrong", "Try again") in the **error boundary** — visible to users on any crash. |
| 12 | Accessibility (keyboard, aria, contrast) | **?** | Not surveyed in Phase 1. BaseModal focus-trap exists (`custom/enforce-base-modal` rule). No broader a11y lint. |
| 13 | Telemetry / privacy (opt-out, transparent) | **?** | README's Data Flow table claims "PII stripped before send" for Sentry and "opt-in" framing. Did **not** locate a user-visible toggle or SENTRY_DSN env plumbing in Phase 1 grep — may exist elsewhere. **Please confirm or point me to it before Security track.** |
| 14 | Secrets hygiene (no leaks, .env.example) | **?** | `.env.example` **not found**. Users have no template for required env vars. Mitigated if the app has zero required env for core use — need to confirm. |
| 15 | Architecture docs for contributors | **3** | `ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/concepts/*`, `docs/features/*`, `docs/devops/*`. Very heavy — possibly over-documented in places but strictly better than none. |

**Total:** 24 / 45 on the knowns (6 dimensions left as `?`). **Interpretation:**
not a fresh-start project — this is a near-complete app with a few specific
ship-blockers (TS regressions in `en.ts`, version string `0.0.1`, unsigned
binaries, possibly-missing first-run telemetry toggle). Three focused tracks
close most of the gap.

---

## Per-track findings (ship-readiness lens)

For each item: **Score = Impact × Confidence ÷ Risk** where I/C/R are 1–5.

### Fix track

1. **Resolve 3 duplicate-key TS errors in `src/i18n/en.ts`.** (I5 C5 R1 → 25)
   - Evidence: `drive:` section is declared at lines 9845 **and** 10972.
     `synthesis_suggestions` + `potential_duplicates` appear three times
     (10190/10376/10922). Caused by un-merged concurrent i18n extraction
     agents (prior commits: `edb8f4d0`, `62ffb809`, `c9869d71` all in
     `i18n: extract`). Any `npm run build` today fails at the typecheck
     step. **Ship-blocker.**
   - Fix: Diff the three occurrences, keep the authoritative section, delete
     the others. For `drive:` the later block at 10972 is adjacent to the
     Google Drive section comment — likely the intended home. For the
     `synthesis_suggestions` triplicate, keep the definition nearest the
     `idea_evolution` section header.
   - Risk: Low. Duplicates must be identical strings (TS wouldn't compile
     either way); deleting two of three can't change runtime behavior.

2. **Resolve 3 `no-useless-escape` lint errors in `src/i18n/en.ts:8319`.** (I2 C5 R1 → 10)
   - Evidence: `file_watcher_path_placeholder: "C:\Users\me\projects…"` —
     backslashes not escaped. ESLint flags `\U`, `\m`, `\p`. Works at
     runtime only by accident (unrecognized escapes pass through).
   - Fix: Either double the backslashes (`"C:\\Users\\me\\projects"`) or
     switch the placeholder to forward-slashes (`"C:/Users/me/projects or
     /home/me/src"`). Forward-slash is tidier and works on Windows.

3. **Fix the stale CLAUDE.md claim of "~159 pre-existing TS errors".** (I2 C5 R1 → 10)
   - Evidence: Current tsc output is 3 errors, all freshly-introduced
     duplicates. Docs claiming 159 is noise that trains contributors to
     ignore red.
   - Fix: After #1 fix lands, update CLAUDE.md's "Pre-existing Issues"
     section to read "0 pre-existing TS errors on `master` as of
     2026-04-17" — or delete the sentence if it no longer applies.

4. **Hardcoded strings in the top-level error boundary (`src/main.tsx:106,130`).** (I3 C5 R1 → 15)
   - Evidence: `"Something went wrong"` and `"Try again"`. These are the
     *only* strings a user sees if the React tree crashes before locale
     bundles are loaded. High-visibility, low-effort.
   - Fix: Extract to a tiny `errorBoundaryCopy` object with language
     detection from `navigator.language`, falling back to English. The
     useTranslation hook can't run before React tree is up, so full i18n
     doesn't apply here — a minimal lookup table is fine.

5. **All items from the prior 4.7-audit** — especially SSRF DNS rebinding
   (healthcheck + trigger polling). Those remain valid and should stay in
   the Fix track queue.

### Polish track

6. **Pick and freeze the 1.0 locale set.** (I3 C4 R2 → 6)
   - Evidence: 12 locales at 83.7–83.8%, Czech at 33%. Shipping 13 languages
     where 12 are 84% and one is a third done is a worse signal than
     shipping 4 fully complete.
   - Options (for user): (a) ship English + the 4–5 most used locales with
     100% coverage, hide the rest behind a "beta" filter in the language
     picker; (b) ship all 13 with a small "partial translation" banner when
     coverage < 90%; (c) just ship as-is — fallback works. **Policy call.**

7. **Survey empty/loading/error states on five critical paths** (before
   committing polish work). (I4 C3 R1 → 12) Paths: first-run, agent CRUD,
   chat, credential add, overview. Deliverable: a table per-path listing
   which states exist and which are missing. This is a *Phase 2 artifact*,
   not a code change.

8. **Accessibility spot-check** — keyboard nav on the five critical paths,
   focus-visible rings, `aria-label` on icon-only buttons, contrast in both
   themes. Same note as #7: deliverable is a findings list, fixes come in
   Phase 3 Polish passes.

### Structure track

9. **Delete stale `CLAUDE.md` pre-existing-issues entries.** (see Fix #3)
   Same commit can prune the entries that list defunct TS errors.

10. **Prior audit #9** — migrate deprecated `src/features/home/components/releases/i18n/`
    into `src/i18n/en.ts`. Still applies.

11. **Rust migrations file split** (`src-tauri/src/db/migrations.rs` @ 4,187
    LOC). Flagged as "rejected — needs user approval" in prior audit. Still
    out of scope unless the user greenlights.

### OSS-Readiness track — **mostly done**

12. **Add `description`, `repository`, `author`, `homepage`, `bugs` to `package.json`.** (I1 C5 R1 → 5)
    - `private: true` is correct (this isn't an npm package) but metadata
      fields still help tooling and GitHub displays.

13. **Bump version for 1.0-cut.** (I3 C4 R2 → 6)
    - Both `package.json` (`0.0.1`) and `src-tauri/tauri.conf.json`
      (`0.0.1`) need a coordinated bump. Recommend `0.1.0` for a public
      pre-1.0 cut (signals "usable but not yet API-stable") unless the user
      wants to commit to `1.0.0`. **Policy call.**

14. **Add `.env.example`.** (I2 C3 R1 → 6)
    - Document every env var the app reads. Even if none are *required* for
      core use, `VITE_SENTRY_DSN`, `VITE_APP_TIER`, anything test-automation
      uses, etc. should be discoverable.

15. **Skim CLAUDE.md for stale claims.** The "Pre-existing Issues" block
    contains at least two outdated assertions (TS error count,
    post-2026-04-17 lint baseline). New contributors treat CLAUDE.md as
    ground truth — stale entries misroute them. Low-effort cleanup.

### Security & Privacy track

16. **Verify the telemetry opt-out / consent flow.** (I4 C2 R2 → 4)
    - README's Data Flow table claims Sentry is opt-in with PII stripped.
      My grep didn't locate a user-visible toggle or DSN plumbing under
      `src/`. Either it lives somewhere I didn't grep (likely under
      `src/lib/observability/` or similar), or the claim is aspirational.
      Either way, confirm before shipping so the README isn't lying.
    - Proposed verification: read `src/lib/silentCatch.ts`, `toastCatch()`,
      `src/lib/errors/`, search for `Sentry.init` / `@sentry/*` imports,
      follow the wire.

17. **Narrow `assetProtocol.scope: ["**"]` in `tauri.conf.json`.** (I3 C4 R3 → 4)
    - `["**"]` lets the Tauri asset: protocol load *any* filesystem path.
      If any renderer bug allowed an attacker-controlled URL to be set as a
      resource, this becomes arbitrary file read. Tighten to the scoped set
      of directories the app actually uses (app data, app config,
      documents-if-needed).

18. **Run `npm audit` and `cargo audit`** as a Security-track pass to
    surface CVEs. Not run in Phase 1 to stay read-only-cheap.

19. **Prior audit #1 (SSRF DNS rebinding)** stays here.

### Distribution track — **gated on user approval**

20. **Document the unsigned-binary UX.** Windows shows SmartScreen;
    macOS Gatekeeper blocks with no easy override; Linux AppImage is
    unsigned anyway. Either:
    - Add a `docs/install.md` explaining how to get past each platform's
      warning, linked from the release notes, **or**
    - Configure code signing (requires secrets, certificates,
      Apple Developer ID — outside this session).
    Recommend the first, until signing is set up as a separate project.

21. **Updater endpoint sanity-check.** `https://github.com/xkazm04/personas/releases/latest/download/latest.json`
    must actually be published as part of the release workflow for the
    updater to work. Verify `.github/workflows/release.yml` writes
    `latest.json` as a release asset. (Read-only check; Phase 1 budget.)

22. **`productName: "Personas"` is a common word** — verify no registered
    trademark conflict before 1.0 ship. Not a code task, flagging for
    awareness.

### Docs track

23. **Refresh CLAUDE.md** (see Fix #3, Structure #15). Stale TS-error
    counts and the "lint baseline: 23,419" note are both out of date.

24. **Add a one-page `docs/release-process.md`** — how to cut a release, how
    to publish the updater manifest, the version-bump dance between
    `package.json` and `tauri.conf.json`. This exists as tribal knowledge;
    new contributors need it written down.

25. **Screenshots in README.** The README is text-heavy with no visuals.
    For an OSS desktop app, one screenshot near the top of the overview
    increases adoption meaningfully. Cost: one `.webp` in `docs/images/`.

---

## Rejected candidates (calibration)

- **Bulk deletion of the 10,117 lint warnings.** CLAUDE.md forbids it; the
  warning class is a known incremental migration.
- **Installing `eslint-plugin-react-hooks` more aggressively (promoting
  `rules-of-hooks` from warn to error).** It's already loaded (the warnings
  prove it). Promoting to error surfaces 21 existing violations — that is a
  dedicated Fix track pass, not a one-commit flip.
- **Auditing 138 `useEffect` hook dependency violations across the
  warning set.** Too broad; individual bugs are higher-yield when they come
  up as Sentry incidents. Queue for a future targeted pass.
- **"Rewriting" the README.** It's already good; editing would be churn.
- **Forcing a build tier down** (e.g., shipping 1.0 as Starter-only to
  reduce surface). The tier system is production-ready; no benefit to
  hiding features.
- **Bundle-size enforcement.** `check:budget` exists. Not a ship-blocker at
  this phase; revisit when Polish track is done.
- **Adding GitHub Discussions / support forum config.** Out of scope for
  code-side audit; a maintainer config call.

---

## Uncertainties (most useful human answers)

1. **Does a user-visible Sentry / telemetry opt-out toggle already exist?**
   Yes → point me to the file. No → Security pass adds one.

2. **Target version for this ship: `0.1.0` (public beta), `1.0.0`
   (stable-API commitment), or something else?** Version string affects
   changelog framing and updater expectations.

3. **Locale policy for 1.0**: ship all 13 with partial-translation banner,
   ship only fully-complete languages, or status quo (silent fallback)?

4. **Does `.github/workflows/release.yml` emit `latest.json`** as expected
   by the updater, or is that still TBD?

5. **Code signing**: out of scope for this session (signing certs need
   external setup), or should I draft a `docs/install.md` that explains the
   unsigned-binary first-run UX on each platform?

6. **Is CLAUDE.md's "Pre-existing Issues" section load-bearing** for any
   other tool/agent, or safe to update freely?

---

## Recommended track order

1. **Fix** — land items 1–4 (duplicate keys, escape chars, stale CLAUDE.md,
   `main.tsx` hardcoded strings). Gets back to `0 TS errors, 0 lint
   errors`. ~30 min, one PR.
2. **Structure / Docs lite** — refresh CLAUDE.md, add `.env.example`, add
   `package.json` metadata, bump version. ~20 min.
3. **Security** — confirm/build the telemetry opt-out, narrow
   `assetProtocol.scope`, run `npm audit` + `cargo audit`. ~60 min.
4. **Polish** — survey empty/loading/error on five critical paths; fix the
   top-5 findings only. Screenshots for README. ~90 min.
5. **Distribution** — `docs/install.md` for unsigned-binary UX, verify
   `latest.json` publication. Signing ceremony deferred. ~45 min.
6. **(Later)** Prior-audit items (SSRF, stale disables already gone,
   ffmpeg Result, parity script, reqwest consolidation) roll into Fix +
   Security passes in this order or the next session.

Net: tracks 1–3 alone close 8 of the 15 scorecard dimensions to ≥ 2.

---

## Awaiting approval

Phase 2 blocked on your review. If you just say "go with the recommended
order", I'll produce a Phase 2 proposal per track with explicit commit
titles and stop conditions, then wait for plan approval before Phase 3.
