# Golden path — i18n string authoring

> Situation node: `ui-system/copy-and-vocabulary/i18n-string-authoring` · [situation spine](../situation-spine.md)
> Composed 2026-08-14. **Recurrence 1,454.**
> Sweep: `src/i18n/**` read in full (`useTranslation.ts`, `useTranslatedError.ts`, `tokenMaps.ts`,
> `CONTRACT.md`, `DebtText.tsx`, `pseudoLocale.ts`, `en.ts`); `errorRegistry.ts` / `errorPipeline.ts` /
> `ToastContainer.tsx` / `tourSlice.ts` / `GuidedTour.tsx` read in full; **a full `npx eslint` run over
> all 4,829 files**, counted per rule; an **AST re-implementation of `no-hardcoded-jsx-text`** over
> all 1,988 non-test `.tsx` files using the repo's own `@typescript-eslint/parser`, to separate what
> the rule reports from what it structurally cannot see; **execution of the 62 extracted
> `ERROR_RULES` matchers against every caller-authored toast string**; all four i18n check scripts
> run (`check-coverage`, `check-untranslated`, `check-error-registry-parity`,
> `find-unused-i18n-keys`); and a convergence census of `personas-web` (Next.js, 597 `.tsx`) and
> `brainiac` (Rust/Postgres + console).
> Dimensions: **ui · function · code-quality**.
> **Settles:** where a user-facing string is allowed to be written down, and what makes it reach the
> user in their own language.
>
> Counts below were measured during composition. Where they touch
> [`shared-facts.json`](../shared-facts.json) they agree with it exactly (1,135 warnings / 226 for
> `custom/no-hardcoded-jsx-text` / 0 errors / 246 files, reproduced). One number the brief supplied
> is **corrected** in §7.0. Deviations become `violating` cells.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its **warrant**, so an adopting repo can tell physics from local calibration.
No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** A string a human will read is *data*, not code. It belongs in a catalog
> addressed by a stable key, and the code that renders it holds the key, never the prose.
>
> **P2 — physics, and the reason P1 is not merely tidy.** A localization system has two independent
> halves: keeping the catalog internally consistent, and getting every new string *into* the
> catalog. Only the first is mechanically checkable from the catalog itself. A project that gates
> only what it can see from inside the catalog will report perfect health while the surface the
> catalog is supposed to cover grows outside it. **Measure entry, not just parity.**
>
> **P3 — physics.** Prose resolved at module-initialization time is frozen at the language active
> before the user chose one. A catalog lookup is only a lookup if it happens where the string
> renders; anywhere earlier, it is a copy.
>
> **P4 — physics.** The layer that *renders* a string decides its language. Any lookup performed
> upstream of the render — in a store, a constant, a classifier, a data module — is a language
> decision made by code that has no business making it, and it is invisible to every tool that
> audits the render layer.
>
> **P5 — physics.** A fallback that substitutes one language for another is a *display* decision
> wearing the clothes of an error handler. If unmatched input silently becomes a generic sentence,
> then the caller's own text is dead code — and dead display code looks exactly like live display
> code at the call site.
>
> **P6 — ergonomics, with a measured cause.** A checker that keys on the *shape* a string wears
> (a text node, a quoted attribute) rather than on *what the string is* will define its own blind
> spots. Every shape it does not enumerate becomes a place strings accumulate, and the strings that
> land there are not random — they are exactly the ones that did not fit the enumerated shape.
>
> **P7 — governance.** A rule that cannot fail a build is a linter for the author's editor, not a
> gate. This is true at any violation count; it is a property of how the rule is wired, not of how
> loud it is.
>
> **P8 — governance.** Machine-translated coverage is a *floor*, not a finish. A catalog that is
> 100% present and 100% non-English has cleared the only bar that matters for shipping — "no
> language mixed into another" — and that bar is worth defending mechanically even when literary
> quality is not.
>
> **Scale condition.** P1, P3, P4 and P5 pay from the second locale. P2 and P6 begin to bite once
> the catalog is larger than one person can read. P7 pays immediately and costs nothing. P8 is what
> makes a second locale shippable at all without a translation team.

**Warrant evidence — the sibling reinvented the doctrine, and reinvented its failure mode too.**
`personas-web` (Next.js, separate remote, no shared package) has **no i18n library at all** —
`next-intl`, `react-i18next`, `next-i18next`, `lingui`, `@formatjs`, `i18next` are all absent from
its `package.json`. It nevertheless built, independently:

- a hand-rolled catalog at `personas-web/src/i18n/<lang>.ts` for **the same fourteen languages**
  (en, de, es, fr, cs, ru, vi, id, zh, ja, ko, hi, bn, ar), 20,017 lines;
- a **typed** English tree (`interface Translations` exported from `en.ts:1`) so a missing key is a
  compile error — the same choice this repo makes by codegen;
- a **per-key deep-merge fallback over English** in its `useTranslation.ts:46-48` — the same
  mechanism, same granularity, arrived at with no shared document;
- **two CI-blocking gates** (`check:i18n-coverage`, `check:i18n-encoding`) plus a pre-push hook.

That is convergence on P1 and on catalog-parity enforcement: **physics.**

And it converged on the *asymmetry* too, which is the sharper result. Its hardcoded-string scanner
(`scripts/report-hardcoded-ui-strings.mjs`) is **report-only, wired to neither CI nor the hook** —
so parity reports 100% while **577 hardcoded strings (378 of them ≥2 words) sit in 75% of its
components** (149 of 597 `.tsx` import `useTranslation`). Two codebases, no shared code, both gated
the half they could see from inside the catalog and left entry ungated. **P2 is not this repo's
mistake; it is the shape of the problem.**

**What did NOT converge, and is therefore local calibration.** `personas-web` loads whole locale
modules; it has no section splitting, no route-declared section preloading, no
parse-on-demand English. This repo's `section-locales/` pipeline, `routeSections.ts` and
`enSectionStrings.ts` are a bundle-size answer to a 19,112-key catalog in a desktop app — **adopt
the principle, not this delivery mechanism.**

**The negative control confirms the boundary.** `brainiac` has no i18n mechanism anywhere (checked:
no `fluent`/`gettext`/`rust-i18n`/`icu` in any of 8 crate manifests; no `i18n`/`locales`/`messages`
dir in the console; `console/app/layout.tsx:46` hardcodes `lang="en"`). Its absence is
**structural, not accidental** — an internal service with a single-operator console has no
localization requirement. Yet even there the *weaker* sibling of P1 appears wherever a vocabulary
is enumerable: `console/src/kb/kb-data.ts:42` `STATUS_LABEL`, `DocReader.tsx:60` `LIFECYCLE_COPY`,
`KnowledgeHealth.tsx:50` `PILLAR_COPY`, each with a test asserting non-emptiness
(`kb-data.test.ts:119`). **Externalizing copy pays where enumeration pays, independent of
localization.**

---

## 1. Trigger

- "add a label to this button / column / empty state", "write the error message for this failure"
- "put a tooltip on it", "the placeholder should say…"
- "add a new status to the badge", "the backend returns a new state, show it"
- "add a config option with a description", "add a step to the tour"
- **If you are about to type a double-quoted or single-quoted English sentence anywhere in
  `src/`** — in JSX, in a `placeholder`, in a `label:` on a constant, as the second argument to a
  toast helper, as a `description:` on a menu entry — you are in this situation.
- If you are about to write `catch { … addToast('Failed to …', 'error') }`, you are in this
  situation **and** in [`typed-error-contract.md`](./typed-error-contract.md).

You are **not** in this situation for: brand names (Claude, Personas, GitHub, Slack, SomaFM),
technical identifiers (API, CLI, JSON, cron, webhook, SQLite, `sk-…`), a shell command shown as an
example, user-generated content (persona names, prompts), log lines, Sentry messages, `data-testid`
values, or a value persisted to SQLite that must be language-stable. Those last three are the
legitimate exceptions and they take an inline disable **with a reason**, never a weakened rule.

Boundary with a neighbouring path: the *label of a closed backend vocabulary* (execution status,
severity, healing category) is owned by
[`status-and-severity-badges.md`](./status-and-severity-badges.md), whose census rule
`untranslatable-token-label` (241 matches / 38 files) counts labels authored beside their colour.
This path owns everything else, and owns `tokenLabel()` only as the destination that path routes to.

---

## 2. The one way

**Write the key, never the prose, and resolve it where it renders.** In a component, call
`const { t, tx } = useTranslation()` and reference `t.<section>.<key>`; interpolate with
`tx(t.section.key, { count })`, never with string concatenation, because a sentence split across
JSX around an expression cannot be reordered by a translator. Add the English string to
`src/i18n/locales/en.json` under one of its 61 top-level sections, **and translate it into all
thirteen other locales in the same change** via
`translate-extract.mjs` → one subagent per locale → `translate-merge.mjs` — the pre-commit
`i18n-no-gaps` and `i18n-no-untranslated` hooks block the commit otherwise, and today the catalog is
at **19,112 keys × 13 locales with zero missing, zero extra and zero untranslated values**, which is
a state worth not being the one who breaks. For a machine token that arrived over IPC use
`tokenLabel(t, category, token)`; for a raw error string use `resolveErrorTranslated(t, raw)` —
**never `resolveError()` or `classifyErrorFull().friendly`, which are the English registry.** If the
string lives in a constant, an options array, a store slice or any other module that has no `t` in
scope, **carry the key and resolve at the render site** (`labelKey: 'group_monitoring'`, then
`t.sidebar[o.labelKey]`) — resolving upstream freezes the language before the user has chosen one,
and no gate in this repo can see it. And **do not author copy as the second argument to
`toastCatch()` or as the first argument to `addToast(…, 'error')`**: `ToastContainer.tsx:59` renders
the *classifier's* message unconditionally, so all 94 such strings in the repo are already dead code
that no user has ever read (§7.B).

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/i18n/useTranslation.ts:329`** — `useTranslation()` → `{ t, tx, language, setLanguage }` | The only sanctioned entry point in a component. `t` is a `Proxy` that triggers the section's async chunk load on first property access; `language` is what `Numeric` / `RelativeTime` need for locale-correct formatting. **1,501 of 1,989 non-test `.tsx` files (75.5%) use it.** |
| **`src/i18n/locales/en.json`** — 61 sections, **19,112 leaf keys** | The catalog. Source of truth; the 13 other locale files are keyed identically and CI-verified so. |
| **`src/i18n/generated/types.ts`** (codegen'd from `en.json` on `predev`/`prebuild`) | Makes `t.section.key` autocomplete and makes a typo a **compile error**. This is the type half of the type-over-gate answer, and it already exists. |
| **`useTranslation.ts:283` — `interpolate()` / the `tx` binding at `:358`** | `{placeholder}` substitution. **1,344 calls in 531 files.** The `_one` / `_other` key suffix carries plural variants. |
| **`src/i18n/tokenMaps.ts:35` — `tokenLabel(t, category, token)`** | Machine token → translated label, with a DEV `console.warn` on an unmapped token (`:44`). Categories: execution, event, automation, severity, priority, healing_status, healing_category, connector_status, test, dev, thinking. **40 calls in 30 files.** |
| **`src/i18n/useTranslatedError.ts:170` — `resolveErrorTranslated(t, raw)`** | Raw error string → translated `{ message, suggestion, category, action? }`. 68 `keyPrefix` rules; **all 65 distinct prefixes are CI-verified to have `_message` + `_suggestion` in `en.json`** (`npm run check:error-registry`). `:230` `friendlySeverityTranslated()` does the same for severities. **Used by 10 files.** |
| **`src/i18n/useTranslation.ts:310` — `getActiveTranslations()`** | The non-React escape hatch: reads the *currently active* bundle at call time. For a helper module that must produce a string outside a component. **16 files.** |
| **`src/i18n/routeSections.ts`** | Declares which catalog sections each sidebar route needs, so they preload; `BASE_SECTIONS` always preload. **If you add a section, add it here or its chunk is never fetched** — that exact bug hit the `debt` section and is written up in `DebtText.tsx:17-19`. |
| **`src/i18n/pseudoLocale.ts`** | Dev-only pseudo-locale: `?pseudo=1` or `window.__togglePseudoLocale__()` brackets and accents every *translated* string, so **hardcoded English is the only unbracketed text on screen.** The single best manual detector for everything §9 cannot gate. Synthesized at runtime; no JSON to maintain. |
| **`src/i18n/CONTRACT.md`** | The four-layer model (Rust → IPC → React → translators) and its invariants. I1 — "no layer above Rust ever sees English prose from below" — is the principle head of this document, written down in-repo before it. |
| **`eslint-rules/no-module-scope-en-value.cjs`** | Flags reading a *value* off the `en` shim during module init. Exists because `alertSlice.ts` shipped frozen English to every locale (`:16-27`). **6 open warnings.** |

**Explicitly NOT primitives — use only under the stated condition.**
`src/i18n/en.ts` (the `en` back-compat shim, **61 importers**) is a lazy Proxy giving a *stable
English snapshot* at module-init time. That is correct only for a persisted value, a log line or a
Sentry message; for anything rendered it is the exact defect `no-module-scope-en-value` exists to
catch. `src/i18n/DebtText.tsx` (`debtText()` / `<DebtText k=… />`, **360 call sites in 114 files**,
539 `auto_<slug>_<hash>` keys) is a **staging** channel for mechanically-extracted strings — its own
docstring calls the parallelism a hazard and records that it caused two silent failures. Do not add
to it; fold keys out of it.

---

## 4. Steps

1. **Decide what kind of string this is.** Human prose → steps 2-6. Brand name, technical
   identifier, machine token, code sample, log line, persisted value → write it literally and, if a
   gate objects, add an inline disable **with a reason**.
2. **Pick the section, add the key to `en.json`.** Use the section that owns the surface
   (`agents`, `vault`, `overview`, `triggers`, `plugins`, …); `common` only for genuinely
   cross-cutting words. Name the key for its *meaning*, not its current text.
3. **Reference it where it renders.** `const { t, tx } = useTranslation()` in the component,
   `t.section.key` in the JSX. If the string has a variable in it, **one key with `{placeholder}`
   and one `tx()` call** — not two JSX text nodes with an expression between them. Sentence
   fragments are the second-largest defect class in this document (§7.C) and they are unfixable by
   a translator.
4. **If the string is not in a component, carry the key instead.** An options array, a store slice,
   a `constants.ts`, a registry: store `labelKey: 'group_monitoring'` and resolve at the render
   site. `src/features/shared/chrome/sidebar/sidebarData.ts` does **both** — `:235` uses
   `labelKey`, `:64-68` uses `label: 'Welcome'` — and the second half is invisible to every gate.
5. **For a backend token, call `tokenLabel(t, category, token)`; for a raw error, call
   `resolveErrorTranslated(t, raw)`. And then stop** — the primitive owns the fallback, the DEV
   warning and the Sentry breadcrumb. Do not add your own `?? 'Unknown'`.
6. **Translate all thirteen locales in the same change.** `node scripts/i18n/translate-extract.mjs`
   → one Sonnet subagent per locale filling `.i18n-work/missing-<code>.json` → `translate-merge.mjs`.
   Medium machine quality is explicitly acceptable (P8); mixed English is not. `translate-merge`
   refuses any locale that dropped a key or broke a `{placeholder}`.
7. **Stage `en.json` and every locale file together.** The `i18n-no-gaps` pre-commit hook is globbed
   to `src/i18n/locales/*.json` and reads the *working tree* — a partial stage passes the hook and
   ships the gap.
8. **Ask the type question before reaching for a gate.** The English tree is already codegen'd into
   `generated/types.ts`, so a *wrong key* is a compile error today. The class this cannot reach is a
   *string that was never made into a key at all*. Where a component takes copy as a prop, that is
   fixable by signature — see the type-over-gate answer.
9. **Verify by eye, once, with the pseudo-locale.** `?pseudo=1` in a dev build. Anything still
   readable English is a string that skipped steps 2-5. This takes seconds and catches every blind
   spot in §7.D, none of which any linter in this repo can see.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `<span>No agents yet</span>` | The base case. 226 open lint warnings say so; the rule cannot fail a build, so they stay (§7.E). |
| `label="Total Runs"` on a component (not a DOM attribute) | The lint rule only knows six DOM attribute names. **97 such props in 43 files** are certified correct by a rule whose entire subject they are. |
| `<span>Showing {n} of {total} results</span>` split as text·expr·text | Three fragments, none translatable, and the word order is frozen to English. The catalog has `tx()` and 1,344 sites use it; these do not. |
| `export const OPTIONS = [{ label: 'Watch' }]` in a `.ts` module | Structurally invisible: the gate is a JSX visitor and this file has no JSX. **818 gate-visible instances across 62 files** (§7.D). |
| `import { en } from '@/i18n/en'` then `en.alerts.x` at module scope | Freezes English at import time — before the user has picked a language. This one *is* caught (6 warnings); the far commoner sibling (a plain English literal in the same position) is not. |
| `toastCatch('ctx', 'Failed to load deployments')` | **The message is discarded.** `ToastContainer.tsx:59` renders the classifier's output, which for an unmatched string is `"Something went wrong."` Verified by executing all 62 registry matchers against all 94 such strings: **0 survive** (§7.B). |
| `addToast('Failed to unlink recipe', 'error')` | Same fate, same line. |
| `classifyErrorFull(raw).friendly.message` in a component | The English registry. `resolveErrorTranslated(t, raw)` is the same lookup with the translated catalog behind it, and the catalog is already complete and CI-verified. |
| Adding a new top-level section without touching `routeSections.ts` | Its chunk is never fetched, so it renders English forever with every gate green. This happened to `debt` (539 keys) and is documented at `DebtText.tsx:17-19`. |
| `// i18n: triggers.category_pull` written next to `label: 'Watch'` | A comment pointing at the key that should have been used. `triggerConstants.ts` has 30 of these. The key exists and is translated; the constant still ships English. |
| Adding to the `debt` section | It is a staging channel with a parallel lookup that two separate scanners did not know about. Fold keys out of it; never in. |

---

## 6. Evidence

**The one site to copy:**
`src/features/overview/sub_activity/components/LlmCallsTable.tsx`. In 326 lines it does every step
correctly and nothing else does all of them together:

- `:62` — `const { t, tx, language } = useTranslation()`, taking `language` because it renders
  numbers (`:235`, `:249`, `:263` pass it to `<Numeric>`).
- `:147`, `:167`, `:176-256` — the column and filter option **arrays are built inside the
  component** with `label: t.overview.activity.col_started`. This is step 4 done right: the
  constants are shaped exactly like the frozen ones in §7.D, but they resolve at render.
- `:219` — `tokenLabel(t, 'thinking', e.thinking_level)` for a backend token.
- `:278` — `tx(t.overview.activity.showing, { count: rows.length, total: … })`: one key, one
  interpolation, translator-reorderable.
- `:289`, `:296-297` — `ariaLabel`, `title` and `aria-label` all through `t`.
- `:269` — `t` and `language` are in the `useMemo` dependency array, so a language switch rebuilds
  the columns. Omitting this is how a correct file still shows stale copy.

**For a backend token:** `src/i18n/tokenMaps.ts:35-51` — the resolver and its DEV warning. The
warning is the design detail worth copying: an unmapped token degrades to the raw token *and* tells
the developer, rather than silently rendering `queued`.

**For an error:** `src/features/vault/sub_catalog/components/foraging/ForagingStatusPanels.tsx:124`
and `src/features/vault/sub_catalog/components/design/phases/ErrorPhase.tsx:57` — the two clearest
uses of `resolveErrorTranslated(t, …)`. Ten files do this; the toast renderer, which is 596 error
sites downstream, does not.

**For the catalog gates:** run all four and read the output —
`node scripts/i18n/check-coverage.mjs` (13 locales × 19,112 keys, 0 missing / 0 extra),
`node scripts/i18n/check-untranslated.mjs` (0 untranslated values in every locale),
`npm run check:error-registry` (65 prefixes, OK),
`node scripts/i18n/find-unused-i18n-keys.mjs` (118 dead of 19,112 = 0.6%). **This half of the
system is genuinely healthy and it is worth saying so plainly.**

---

## 7. Deviations found

### 7.0 One number in the brief is wrong, and two claims in `CLAUDE.md` need splitting

**(a) "roughly 684 error toasts render English in all 14 locales" — the count is wrong, the finding
is worse than stated.** Measured: **596** error-toast emission sites — 389 `toastCatch(…)` calls in
195 files plus 207 `addToast(…, 'error')` calls in 99 files (brace-matched argument extraction, test
files excluded). Not 684.

But the framing "596 defects" is also wrong, and this is the reframing the second pass produced:
**it is one defect in one file.** `ToastContainer.tsx:54-59` is the sole render path for all 596, and
it calls `classifyErrorFull()` → `errorRegistry.resolveError()` — the **English** registry — rather
than `resolveErrorTranslated(t, …)`, which sits two imports away, is fully populated, and is
CI-verified for parity across all 13 locales. The same component already calls `useTranslation()`
and uses `t.common.dismiss_notification` at `:120`. **One call swap localizes the entire error
surface of the application.**

**(b) `CLAUDE.md` claims `custom/no-hardcoded-jsx-text` covers "JSX, placeholder, title, or
aria-label attributes". That claim is TRUE** — verified against `no-hardcoded-jsx-text.cjs:65-68`,
whose `I18N_ATTRS` is exactly `placeholder`, `title`, `aria-label`, `aria-placeholder`,
`aria-roledescription`, `aria-valuetext`. The document does not overclaim. It also does not mention
`alt`, which is in `SKIP_ATTRS` at `:56` and therefore never checked — **and that turns out not to
matter: there is exactly one translatable `alt` string in the entire repo**
(`HeroHeader.tsx:87` `alt="Personas logo"`, which is a brand name and correctly untranslated).
Alarm cleared.

### 7.A The catalog is healthy. Say so before saying anything else.

Four independent checks, all run during composition:

| Check | Result |
| --- | --- |
| `check-coverage.mjs` — key parity | **19,112 keys, 13 locales, 0 missing, 0 extra** |
| `check-untranslated.mjs` — values not byte-identical to English | **0 untranslated in every locale** (3,624 allowlisted entries) |
| `check-error-registry-parity.mjs` | **65 keyPrefixes, all with `_message` + `_suggestion`** |
| `find-unused-i18n-keys.mjs` — orphans | **118 of 19,112 = 0.6%** |

**The orphan hypothesis is refuted.** The 118 dead keys are not scattered drift — they are
`planner` (67 of 67) and `deliberation` (51 of 51), two **entire sections** authored for features
that never shipped. There is no third section, and no scattered residue: the "orphaned loading keys"
a previous session is remembered to have left behind do not appear in the scan. Whatever cleaned
them worked.

The enforcement wiring, verified from `lefthook.yml` and `.github/workflows/ci.yml`:

| Gate | Where | Mode |
| --- | --- | --- |
| `check:i18n` (key parity) | CI `ci.yml:119` + pre-push | **non-strict** — fails on extras, warns on missing |
| `check:i18n:strict` | pre-commit, globbed to `src/i18n/locales/*.json` | **strict** — fails on missing |
| `check:i18n:untranslated --strict` | pre-commit, same glob | strict |
| `check:error-registry` | CI `ci.yml:130` | fatal |

So the answer to "which mode does CI actually run" is: **non-strict.** The strict gate lives only in
the pre-commit hook. That is a smaller hole than it sounds — a missing key can only arrive via a
locale-file edit, which the hook is globbed to — but it means a `--no-verify` commit, or a merge
that combines two branches' locale edits, reaches CI with nothing checking for missing keys. The
counts are 0/0 today, so this is a latent hole, not an open one.

### 7.B The largest hole — every error toast, and 94 messages nobody has ever read

`ToastContainer.tsx:54-59`:

```tsx
const classified = useMemo(() => (toast.type === 'error' ? classifyErrorFull(toast.message) : null), …);
const friendly = classified?.friendly ?? null;
const displayMessage = friendly?.message ?? toast.message;
```

`classifyErrorFull()` (`errorPipeline.ts:125`) always sets `friendly: resolveError(raw)`, and
`resolveError()` (`errorRegistry.ts:637-657`) **always returns a `FriendlyError`** — `GENERIC_FALLBACK`
(`:620`, `"Something went wrong."`) when nothing matches. So `friendly` is never `null` for an error
toast, and the `?? toast.message` branch at `:59` is **unreachable**. Two consequences:

1. **The rendered text of every error toast is one of 63 English registry messages, plus one
   generic.** Not the raw error, not the caller's string. In every locale. `:176`'s
   `friendlySeverity()` adds four more English labels for healing toasts.
2. **All 94 caller-authored English toast strings are dead code.** Measured by extracting the 62
   `ERROR_RULES` matchers from `errorRegistry.ts` and executing each against every caller string
   (positive-controlled: `"NetworkOffline"`, `"request timed out after 30s"`,
   `"Validation failed: name"`, `"Decryption failed"` all match as expected):

| | sites | reach the user as written | replaced by "Something went wrong." |
| --- | ---: | ---: | ---: |
| `toastCatch(ctx, "…")` | 40 | **0** | 40 |
| `addToast("…", 'error')` | 54 | **0** | 54 |

Every one of `"Failed to load deployment history"`, `"Failed to update display name"`,
`"Couldn't queue the campaign"`, `"Retry limit reached — this event cannot be retried again."`,
`"Obsidian sync failed — configure vault in Obsidian Brain plugin first"` renders as
**"Something went wrong."** The authors wrote specific, useful copy; the pipeline discards it; and
because the discard happens in a different file from the call site, nothing in review would show it.

This is P5 exactly: a fallback that substitutes a generic sentence is a display decision, and it
made 94 call sites' worth of authored intent invisible.

**The fix is small and ordered.** (1) Swap `ToastContainer` to `resolveErrorTranslated(t, …)` and
`friendlySeverityTranslated(t, …)` — the catalog behind them is already complete. (2) Change `:59`
to prefer the caller's string when the classifier is `unclassified`, so specific copy stops being
discarded. (3) Then, and only then, migrate the 94 call-site strings into `en.json` — doing that
first would translate strings that still would not render.

### 7.C The tour that greets every new user is entirely English

`src/stores/slices/system/tourSlice.ts` holds **53 tour steps** and **~350 English copy strings**
(`title`, `description`, `hint`, `narration`, plus sub-step labels and hints) as plain literals in a
module-scope array. `GuidedTour.tsx` renders them directly:

- `:457` — `<h3>{tourDef.title}</h3>`
- `:458` — `<p>{tx(t.onboarding.tour_step_of, { current, total })}</p>`
- `:483` — `<p>{currentStep.narration}</p>` (also the text sent to TTS)

**Lines 457 and 458 are adjacent.** The component imports `useTranslation` and uses `t` 27 times —
for its minimize button, its dismiss button, its aria-region label. It translates its chrome and
renders its content in English. `en.json`'s `onboarding` section has 174 keys, all translated into
13 locales; not one of them is a step title.

The file *does* `import { en } from "@/i18n/en"` (`:5`) and reads it three times — so the author
knew the shim existed. `no-module-scope-en-value` sees those three and none of the 350, because it
only flags reads *of the shim*. **The rule catches the case where someone reached for the catalog
and got the timing wrong; it is blind to the case where nobody reached for it at all** — which is
40× more common in this one file.

### 7.D What the rule structurally cannot see

Measured by re-implementing `no-hardcoded-jsx-text.cjs` against the real AST
(`@typescript-eslint/parser`, all 1,988 non-test `.tsx`), reproducing its reports to within the 25
inline `eslint-disable` suppressions across 13 files, then counting what a wider net finds:

| Blind spot | Cause, from the rule source | Count |
| --- | --- | ---: |
| **English copy in `.ts` modules** | The rule has only `JSXText` and `JSXAttribute` visitors. **2,725 of the repo's 4,829 files are `.ts`** and contain no JSX at all. | **1,346 hits / 111 files** (818 / 62 under the tightened §9 signal) |
| **Single words ≤ 20 chars** | `isNonTranslatable` (`:83`) returns `true` for any `/^[A-Za-z_]\w*$/` token up to 20 characters. | **601 occurrences, 396 distinct words** |
| **Copy on component props** | `I18N_ATTRS` (`:65`) is six DOM attribute names; anything else is dropped at `:123`. | **97 hits / 43 files** |
| **`I18N_ATTRS` in an expression container** | `:126` requires `node.value.type === 'Literal'`; a template literal or `{"…"}` is not one. | **90** |
| **String literal as a JSX child** | `<span>{'text'}</span>` is a `JSXExpressionContainer`, not `JSXText`. | 6 |
| **`alt=`** | In `SKIP_ATTRS` (`:56`). | 1 (a brand name — not a defect) |

The single-word bucket is the one worth staring at, because P6 predicts exactly this: the words that
land in a rule's blind spot are not random. The top of the distribution is
**`Cancel`×15, `Retry`×12, `Refresh`×10, `Clear`×10, `Add`×6, `Save`×4, `Run`×4, `Dismiss`×4,
`Delete`×3, `Reject`×3, `Apply`×3, `Resume`×3** — i.e. **the button labels**, the single most
common user-facing string in any UI, exempted wholesale by a heuristic written to skip CSS class
names. `common.save`, `common.cancel`, `common.delete` all exist in `en.json` and are translated.

And 502 `.tsx` files (25.2%) render JSX and never touch `t` at all; **53 of them hold copy** —
`GlyphCinemaLayout.tsx`, `PersonaCoreModal.tsx`, `SensorScoreboard.tsx`, `FleetPage.tsx`,
`MemoriesPageGraph.tsx` among them.

### 7.E The rule that exists is precise, and enforces nothing

**Precision is good — the "bad rule teaches people to ignore it" hypothesis is refuted.** A
systematic sample of 37 of the 226 warnings (every 3rd attribute warning, every 9th text warning),
each read at its source line:

| | sampled | genuine untranslated user-facing English | false positive |
| --- | ---: | ---: | ---: |
| `hardcodedAttr` | 17 | 15 | 2 — `placeholder="sk-..."`, `placeholder="npx tsc --noEmit 2>&1 \| grep -c error"` |
| `hardcodedText` | 20 | 19 | 1 — `Dialogue+Cinema` (a dev-only prototype toggle) |
| **total** | **37** | **34 (92%)** | **3** |

Both false-positive classes are *technical strings that happen to contain spaces* — an API-key
format hint and a shell command. There is no systematic imprecision. Compare the wave-1 rule that
measured 0/3 precision and 0/3 recall: this one is 34/37.

**So the 226 are not open because the rule is noisy. They are open because the rule cannot fail
anything.** `npm run check` runs `eslint src/` with **no `--max-warnings`** (`package.json:51`), so
it exits 0 at any warning count. The pre-commit hook runs
`npx eslint --quiet --no-warn-ignored --max-warnings 99999` (`lefthook.yml:20`) — and `--quiet`
suppresses warnings *before* they can be counted, so the 99999 ceiling is decorative. **A warn-level
rule enforces nothing at either gate, at any count.** This is P7, and it is why the correct argument
here has nothing to do with the size of the baseline: the repo's real baseline is 1,135 warnings
across 246 files, a readable list, and `no-hardcoded-jsx-text` is its second-largest class at 226
(19.9%) — it is not drowning in noise, it simply has no teeth.

The tension this creates is worth stating plainly: **the one thing in this system that could gate
catalog *entry* is wired so it cannot.** Flipping it to `"error"` today would break the build in 56
files, so that is a sequenced fix (§9), not a one-line change.

### 7.F Copy frozen in data modules — 1,346 strings across 111 files

The `.ts` blind spot, by key and by concentration:

| key | hits | | file | hits |
| --- | ---: | --- | --- | ---: |
| `label` | 536 | | `stores/slices/system/tourSlice.ts` | 350 |
| `description` | 219 | | `lib/errors/errorRegistry.ts` | 124 |
| `hint` | 184 | | `features/templates/sub_recipes/mockRecipes.ts` | 99 |
| `title` | 101 | | `lib/harness/scenario-parser.ts` | 55 |
| `message` | 97 | | `plugins/dev-tools/constants/scanAgents.ts` | 45 |
| `suggestion` | 68 | | `lib/templates/personaSafetyScanner.ts` | 34 |
| `error` | 53 | | `lib/utils/platform/triggerConstants.ts` | 31 |
| others | 88 | | `teams/…/passport/rowDirections.ts` | 30 |

Three shapes worth distinguishing, because they need different fixes:

- **`sidebarData.ts` holds both patterns in one file.** `:235-237` uses
  `labelKey: 'group_monitoring'` — the documented "Constants with Labels" pattern, resolved at the
  render site. `:63-68` uses `label: 'Welcome'`, `label: 'Cockpit'`, `label: "What's New"`. Same
  file, same author, same week; one half participates in the catalog and one half does not, and
  nothing distinguishes them to any tool.
- **`triggerConstants.ts` writes the key as a comment.** `:51` `label: 'Watch', // i18n: triggers.category_pull`,
  and 29 more like it. The key exists. It is translated into 13 languages. The constant ships
  English and points at it. This is the most explicit possible statement that the author knew the
  right answer and had no mechanism to reach it from a `.ts` file.
- **`errorRegistry.ts` is a *deliberate* English registry** whose translated twin already exists in
  `en.json`. Its 124 strings are not an oversight; they are the fallback layer. They become a defect
  only because `ToastContainer` reads the English one (§7.B).

### 7.G `tokenLabel` adoption, and the boundary with the badge path

`tokenLabel()` has **40 call sites in 30 files** against `untranslatable-token-label`'s **241
matches in 38 files** — i.e. roughly six labels are authored beside a colour for every one resolved
from the catalog. That census rule already exists and belongs to
[`status-and-severity-badges.md`](./status-and-severity-badges.md); this path adds nothing to it and
deliberately does not re-gate the condition. Noted here only so the adoption number is on the
record: `tokenLabel` is a correct, cheap, DEV-warning-equipped primitive with ~14% adoption on its
own subject.

### 7.H The `debt` channel — a second catalog with its own scanners

`en.json`'s `debt` section is **539 keys**, the ninth-largest section, read through
`debtText()` / `<DebtText k=… />` at **360 call sites in 114 files** — never as `t.debt.x`. Its own
docstring (`DebtText.tsx:12-21`) records that this parallelism caused two silent failures: the
dead-key scanner had no pattern for it, so all 539 keys read as dead (81% of the entire dead report)
and, because both value-level gates skip scanner-dead keys, the section **sat 0% translated in every
locale behind a green board**; and no route declared the section, so its chunk was never fetched.
Both were fixed 2026-08-09. It is included here because it is the sharpest available demonstration
of P2: a green board measured the catalog it knew about.

---

## 8. Gaps in the primitives

1. **There is no way to resolve a translation from a `.ts` module at render time without the
   component's cooperation.** `getActiveTranslations()` exists and is correct (16 users), but it
   reads the *currently active* bundle — a value computed at module init still freezes. So the only
   correct pattern for a data module is "carry the key, resolve at the call site", which requires
   the *consumer* to change. That coupling is why 818 constants stayed English while the identical
   pattern (`labelKey`) sits ten lines away in the same file. **Fix:** publish a tiny
   `TranslatedLabel` / `useResolvedLabels(items)` helper in `src/i18n/` that takes an array of
   `{ ..., labelKey }` and returns it with `label` filled in, so migrating a constant is a one-line
   change at *one* call site rather than an edit at every consumer. This is the single highest-
   leverage primitive missing from the system.
2. **`resolveError()` and `resolveErrorTranslated()` are two hand-synced tables and the sync is only
   half-checked.** `errorRegistry.ts` has 63 rules; `ERROR_KEY_MAP` has 68 entries; both files carry
   comments telling the reader to keep them in lock-step, and `useTranslatedError.ts:207-220` chains
   into the English one as a fallback. `check-error-registry-parity.mjs` verifies keys exist for
   every `keyPrefix` — it does **not** verify that every `ERROR_RULES` match pattern has a
   corresponding `ERROR_KEY_MAP` entry, which is the direction that produces silent English. **Fix:**
   extend the parity script to assert the pattern sets are equal, or better, derive both from one
   table.
3. **`no-module-scope-en-value` guards the rarer half of its own condition.** It flags reads of the
   `en` shim at module scope (6 hits) and cannot see a plain English literal in exactly the same
   position (818 hits). The condition it names — "a string frozen before the user picked a
   language" — is the same in both cases. **Fix:** widen it, or accept the census rule in §9 as the
   coarse half and say so in its docstring.
4. **The catalog's own quality gate cannot see 3,624 keys.** `check-untranslated.mjs` allowlists
   `docs/i18n/untranslated-allowlist.json` — **19% of the catalog** — as legitimately identical to
   English. Most entries are placeholders and examples and are correct. But an allowlist that large
   is a place things can hide, and the entries are `*:key` wildcards across all locales. **Fix:**
   nothing urgent; record the size in the script's own output (it already does) and audit on a
   cadence.
5. **Nothing tests that a locale switch re-renders.** No test asserts that a component rebuilds its
   memoized labels when `language` changes. `LlmCallsTable.tsx:269` gets this right by including
   `t` and `language` in its dependency array; a file that omits them is correct on first paint and
   stale after a switch, and is indistinguishable from a correct file by every gate in this repo.
6. **The pseudo-locale is the best detector in the system and nothing routes anyone to it.** It
   makes every blind spot in §7.D visible in one glance, it is documented only in its own file's
   docstring, and it is mentioned in neither `CLAUDE.md` nor `CONTRACT.md`. **Fix:** one line in
   `CLAUDE.md` § Internationalization, and a mention in the PR self-review checklist.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:34-60`](../golden-path-contract.md), what
follows is a *proxy* for a semantic condition, tuned to this repo's idiom. The conditions are stated
first so an adopting repo re-derives its own proxy — and the risk is acute for this leaf: the
sibling that reinvented this doctrine has no `toastCatch`, no `addToast`, and its copy constants
live in `src/data/*.ts` under different key names, so both signals below would score **zero** there
while the condition is present 577 times.

Everything in §7 shipped under a green `npm run check`, a green CI, and four green i18n scripts.

### Semantic conditions, stated stack-free

- **C1 — copy is authored at a call site that cannot render it, so it is simultaneously
  untranslatable and dead.** *Proxy here:* a string literal containing two adjacent words passed as
  the message argument to either error-toast helper. *Precondition:* this repo funnels every error
  toast through one renderer that substitutes a classifier's output for the caller's string. A repo
  whose toast renderer displays what it was given has the untranslatable half of this condition and
  not the dead half, and must re-derive.
- **C2 — user-facing prose is authored as a value in a module with no render context, so no
  translation lookup can reach it and no render-layer audit can see it.** *Proxy here:* a
  capitalised multi-word string literal on a `label` / `description` / `hint` / `subtitle` /
  `tooltip` property inside a `.ts` file. *Precondition:* this repo separates `.ts` (logic/data) from
  `.tsx` (render) and spells display copy with those five key names. A repo that colocates
  components and data in one extension, or names the key `text` / `caption` / `copy`, scores zero
  while the condition is present.

### Conditions deliberately NOT given a census rule

- **C3 — hardcoded English in JSX.** A rule already exists, measures **92% precision on a 37-site
  sample**, and reports 226 instances. **Adding a census rule for the same condition would be a
  second counter for a signal that is already counted.** The fix is not a new gate; it is
  §"Sequencing" step 3 — raise the existing rule to `"error"` after burning the 226 down. Recorded
  here so the next composer does not add the duplicate.
- **C4 — the single-word blind spot (601 sites, `Cancel`/`Retry`/`Refresh`/…).** A regex over class
  strings cannot distinguish `<span>Cancel</span>` from `<Icon>{glyph}</Icon>`; separating them
  needs JSX structure. **The right fix is an ESLint change, not a census rule:** delete the
  `trimmed.length <= 20` identifier branch at `no-hardcoded-jsx-text.cjs:83` and replace it with a
  dictionary check (is this an English word?) or an allowlist of known non-copy tokens. That needs
  `RuleTester` fixtures, which is ESLint's job and not the census's. **Blocked on nothing but
  someone doing it** — and it is the largest single unmeasured population in this document.
- **C5 — copy passed as a component prop (97 sites / 43 files).** A census regex on `label="…"`
  would fire on `<Recharts label="…">`, chart axis labels, and every internal prop that happens to
  be called `label`. More importantly the *right* fix is a type change, not a count — see the
  type-over-gate answer. Gate it after the prop convention lands.
- **C6 — a memoized label list that omits `t` from its dependency array.** Genuinely the sharpest
  remaining correctness condition (Gap 5) and genuinely not regex-shaped: it requires knowing which
  identifiers the memo body closes over. `react-hooks/exhaustive-deps` already sees this and reports
  9 warnings repo-wide; the fix is to check whether it is being suppressed on these files rather
  than to build a parallel detector.
- **C7 — a string identical in `en.json` and a locale file.** Already gated, better than a census
  rule could: `check-untranslated.mjs` reports **0** in every locale. Not re-gating a solved
  condition.

### The rules — validated

Both were run against the working tree with
`node scripts/census/run-census.mjs --rules <scratch-file> --check` → **exit 0**, and both counts
were reproduced by an independent second implementation before baselining (contract requirement):
`discarded-toast-copy` 49 files / 94 matches by both; `frozen-ui-copy-constant` 62 files / 818
matches by both, exactly.

```json
{
  "rules": [
    {
      "id": "discarded-toast-copy",
      "goldenPath": "docs/concepts/golden-paths/i18n-string-authoring.md",
      "title": "Error-toast copy authored at the call site, where it is neither translatable nor ever rendered",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "toastCatch\\(\\s*(['\"])[^'\"]*\\1\\s*,\\s*(['\"])[^'\"]*[A-Za-z] [A-Za-z][^'\"]*\\2|addToast\\(\\s*(['\"])[^'\"]*[A-Za-z] [A-Za-z][^'\"]*\\3\\s*,\\s*(['\"])error\\4",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a multi-word English string literal handed to an error-toast helper as its message. PROXY FOR the stack-free condition: copy is authored at a call site that cannot render it, so it is simultaneously untranslatable AND dead. Both halves were verified, not assumed. Untranslatable: the literal never enters src/i18n/locales/en.json, so no locale has a translation for it. Dead: ToastContainer.tsx:54-59 computes `friendly = classifyErrorFull(toast.message).friendly` and renders `friendly?.message ?? toast.message`, and resolveError() (errorRegistry.ts:637-657) ALWAYS returns a FriendlyError - GENERIC_FALLBACK 'Something went wrong.' (errorRegistry.ts:620) when nothing matches - so `friendly` is never null and the `?? toast.message` branch is unreachable. All 62 ERROR_RULES matchers were extracted from errorRegistry.ts and executed against every one of these strings: 0 of 94 match, so 94 of 94 render as 'Something went wrong.' Positive-controlled ('NetworkOffline', 'request timed out after 30s', 'Validation failed: name', 'Decryption failed' all match as expected, so the extraction is sound). Precision on a systematic 47-site sample: 47/47 genuine. PRECONDITION (measured, must be re-derived per repo): this repo funnels every error toast through ONE renderer that substitutes a classifier's friendly copy for the caller's string, and spells the emitters `toastCatch(ctx, msg)` and `addToast(msg, 'error')`. A repo whose toast renderer displays what it was handed has the untranslatable half of this condition and not the dead half; a repo using a different toast API scores zero while the condition is present - personas-web has neither helper and 577 hardcoded strings. Template literals are deliberately NOT matched: alertSlice.ts:249 interpolates en.alerts.error_load_rules into one, which is a DIFFERENT defect owned by custom/no-module-scope-en-value. STATUS 2026-08-14: fixes (1) and (2) LANDED in the same session that merged this rule — ToastContainer.tsx now resolves through resolveErrorTranslated(t, raw) and prefers the caller's string when the classification is 'unclassified'. The DEAD half of this condition is therefore closed: these 94 strings now reach the user. The rule stays at 94 because the UNTRANSLATABLE half is untouched — they are still call-site literals absent from en.json, so they render English in all 14 locales. Step (3) is what this baseline now tracks. Do not read the past-tense analysis below as current behaviour. LEGAL FIX, in order: (1) point ToastContainer at resolveErrorTranslated(t, raw) instead of classifyErrorFull().friendly; (2) make :59 prefer the caller's string when the classification is 'unclassified', so specific copy stops being discarded; (3) only then move these 94 strings into en.json. Doing (3) first translates strings that still would not render."
      },
      "exclude": [
        {
          "path": "src/lib/silentCatch.ts",
          "reason": "the toastCatch definition itself — the destination this rule routes callers away from, not a call site"
        }
      ],
      "baseline": { "files": 49, "matches": 94 },
      "floor": 4000
    },
    {
      "id": "frozen-ui-copy-constant",
      "goldenPath": "docs/concepts/golden-paths/i18n-string-authoring.md",
      "title": "User-facing copy authored as a literal in a non-JSX module, where no translation lookup can reach it",
      "roots": ["src/features", "src/stores", "src/lib"],
      "extensions": [".ts"],
      "signal": {
        "pattern": "\\b(?:label|description|hint|subtitle|tooltip)\\s*:\\s*(['\"])[A-Z][^'\"]*[a-z] [a-zA-Z][^'\"]*\\1",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a capitalised, multi-word English string on a display-copy property inside a .ts module. PROXY FOR the stack-free condition: user-facing prose is authored as a value in a module with no render context, so no translation lookup can reach it and no render-layer audit can see it. This is the structural blind spot of custom/no-hardcoded-jsx-text, which has only JSXText and JSXAttribute visitors and therefore cannot reach ANY of the repo's 2,725 .ts files. Concentration measured: tourSlice.ts 350 (the 53-step guided onboarding tour, rendered raw at GuidedTour.tsx:457 and :483, three lines from a correctly-translated tx() call at :458), errorRegistry.ts 124, mockRecipes.ts 99, scanAgents.ts 45, triggerConstants.ts 31 - the last of which writes the correct i18n key as a COMMENT beside each English label (':51 label: Watch, // i18n: triggers.category_pull'), which is the clearest possible evidence that the author knew the answer and had no mechanism to reach it from a .ts file. sidebarData.ts holds both patterns in one file: :235 uses labelKey (correct), :64 uses label: 'Welcome' (this condition). The value is required to START uppercase and contain a lowercase-then-space-then-letter run, which excludes machine tokens, snake_case ids and SCREAMING_CONSTANTS; precision on a systematic 50-site sample after the excludes below was 42/50, the 8 misses all being test fixtures now excluded. PRECONDITION (measured, must be re-derived per repo): this repo separates .ts (logic/data) from .tsx (render) and spells display copy with these five key names. A repo that colocates data and components in one extension, or names the key `text`/`caption`/`copy`/`title`, scores zero while the condition is present at full scale - brainiac's equivalent is `STATUS_LABEL: Record<Status,string>` at console/src/kb/kb-data.ts:42, which this pattern would NOT match despite being the same condition. LEGAL FIX: carry the key, resolve at the render site - `labelKey: 'group_monitoring'` in the constant, `t.sidebar[o.labelKey]` in the component, per .claude/CLAUDE.md 'Constants with Labels' and the working precedent at sidebarData.ts:235. DELIBERATE EXCEPTIONS that keep this literal and take an inline reason instead: a value persisted to SQLite, a log line, a Sentry message, a machine-readable default."
      },
      "exclude": [
        {
          "path": "src/**/__tests__/**",
          "reason": "test fixtures are English by design and no user reads them — the condition is 'a string a user will read', and including them would baseline 197 files of deliberate English"
        },
        {
          "path": "src/**/*.test.ts",
          "reason": "same, for colocated unit tests (56 files)"
        },
        {
          "path": "src/lib/harness/scenario-parser.ts",
          "reason": "the UAT / test-automation harness — its 55 labels are read by the harness author in a report, never rendered in the product UI"
        }
      ],
      "baseline": { "files": 62, "matches": 818 },
      "floor": 1500
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   discarded-toast-copy       49     49       94     94    4829   4000
  OK   frozen-ui-copy-constant     62     62      818    818    2414   1500
  census OK — 2 rule(s), 7243 file-visits, 912 surviving violation(s) across 111 file(s).
```

Floors sit below the observed walks with margin (4,829 `.ts`+`.tsx` under `src`; 2,414 `.ts` under
the three narrower roots), consistent with the existing `raw-select` and `raw-web-storage` rules
that walk the same tree.

### How each fails loudly if its own precondition is absent

Not asserted — **executed.** Every failure mode was induced against the real working tree and the
exit code captured:

| Induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 7243 file-visits` |
| R1 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| R1 `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| R1 baseline inflated (a silent drop) | **1** | `[drift] files dropped 120 -> 49 (-71) without the baseline moving.` |
| R1 baseline deflated (a rise) | **1** | `[drift] files rose 20 -> 49 (+29). New violations of …i18n-string-authoring.md` |
| R1 `exclude` path renamed | **1** | `[structural] exclude "src/lib/silentCatchMOVED.ts" matched no file. The exemption is stale` |
| R1 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| R1 `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |
| R2 `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere.` |
| R2 `floor` → 9000 | **1** | `[structural] walked 2414 files but floor is 9000.` |
| R2 baseline inflated (a silent drop) | **1** | `[drift] files dropped 900 -> 62 (-838) without the baseline moving.` |
| R2 baseline deflated (a rise) | **1** | `[drift] files rose 30 -> 62 (+32).` |
| R2 `exclude` glob matches no file | **1** | `[structural] exclude "…scenario-parserMOVED.ts" matched no file. The exemption is stale` |
| R2 `roots` renamed away | **1** | `[structural] walked 0 files but floor is 1500` |
| R2 `exclude` `reason` removed | **1** | `exclude[0] ("src/**/__tests__/**") needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |

The stale-`exclude` check earned its keep during composition: the first draft of
`frozen-ui-copy-constant` had no excludes at all and baselined 1,129 matches, ~14% of which were
test fixtures. The reason-required check forced each of the three exemptions to name what it stands
in for, which is how the harness exclusion got scoped to one file rather than a `src/lib/harness/**`
glob that would have hidden future render-facing code.

### Sequencing

1. **`discarded-toast-copy` immediately, but ship the `ToastContainer` fix in the same commit.** The
   rule counts 94 sites whose *current* fix is "delete the argument, it does nothing" — which is
   true but useless copy advice. Point `ToastContainer.tsx:54-59` at
   `resolveErrorTranslated(t, …)` / `friendlySeverityTranslated(t, …)` first, make `:59` prefer the
   caller's string on an `unclassified` classification, and then the rule's 94 sites have a real
   destination. **This one change localizes every error toast in the app**, and the catalog behind
   it is already complete and CI-verified.
2. **`frozen-ui-copy-constant` immediately.** 818 sites, one legal fix (`labelKey` + resolve at the
   render site), with a working precedent ten lines away in one of the affected files. Start with
   `tourSlice.ts` (350 of the 818, and the first screen every new user sees).
3. **Fix the 226 `no-hardcoded-jsx-text` warnings, then raise it to `"error"`.** 92% precision means
   the backlog is real work, not triage. Until it is `"error"` it enforces nothing at either gate
   (§7.E) — and it is the only mechanism in this system that gates catalog *entry* rather than
   catalog parity, which §"Warrant evidence" shows is the half both codebases left ungated.
4. **Delete the `length <= 20` identifier branch at `no-hardcoded-jsx-text.cjs:83`** (C4) and
   replace it with a targeted allowlist. 601 sites become visible, dominated by button labels whose
   keys already exist in `common`. Do this *after* step 3 so the count does not jump while the
   backlog is being burned down.
5. **Gap 1 — publish the `useResolvedLabels` / `labelKey` helper**, so migrating a constant is one
   edit rather than one per consumer. This is what makes step 2 cheap.
6. **Gap 2 — make `ERROR_RULES` and `ERROR_KEY_MAP` one table**, or extend
   `check-error-registry-parity.mjs` to assert the pattern sets are equal in both directions.
7. **Add the pseudo-locale to `CLAUDE.md` and the PR self-review list** (Gap 6). Zero cost, and it
   is the only tool that sees all six blind spots at once.

---

## Type over gate — the answer

**Partly yes, and the type that would help most already exists — for the wrong half of the problem.**

**1. The catalog is already a closed type, and it works.** `scripts/i18n/gen-types.mjs` codegens
`generated/types.ts` from `en.json`, so `t.agents.nosuchkey` is a **compile error**, not a runtime
blank. `personas-web` reinvented the identical guarantee by hand (`interface Translations` exported
from its `en.ts:1`) with no shared code. Two stacks, same choice: **making the key space a closed
type is physics.** And the evidence that it holds is the dead-key scan — 118 orphans out of 19,112,
all in two unshipped sections. Compare the *other* direction, where nothing is typed: 818 constants
and 226 JSX strings that never became keys at all.

**So the type this system has makes it impossible to reference a key that does not exist, and does
nothing to make it hard to write a string that is not a key.** That asymmetry is the whole document.

**2. Where a type *can* close the remaining gap: component props that carry copy.** 97 string
literals sit on `label` / `subtitle` / `hint` / `disabledReason` / `tooltip` props across 43 files,
invisible to a rule that knows six DOM attribute names. This is the one deviation class that passes
through a component boundary, and therefore the one a signature can reach. The move is the same one
`FacetedDecisionTable` made for `emptyTitle` (3/3 real copy where its optional-prop siblings fell
through to `"No data"`, per the contract's own §"Prefer a type over a gate"): **type the prop as a
catalog reference rather than a string.**

```ts
// today
interface Props { label: string }        // <Stat label="Total Runs" />

// closed
type CopyKey = LeafKeysOf<Translations>;  // already derivable from generated/types.ts
interface Props { labelKey: CopyKey }     // <Stat labelKey="overview.total_runs" />
```

`LeafKeysOf<Translations>` is a pure type-level derivation over a tree the codegen already emits.
Once a prop is typed that way, `label="Total Runs"` does not compile, and no gate is needed for
those 97 sites — ever. The same trick closes C5 and makes Gap 1's `useResolvedLabels(items)` helper
type-safe for the 818 constant sites: `{ labelKey: CopyKey }` is checkable where `{ label: string }`
is not.

**3. Where no type can reach, and this is the leaf's real finding.** The two dominant deviation
classes do not cross any boundary a signature guards:

- **A JSX text node is not a parameter.** `<span>No agents yet</span>` passes through nothing. Only
  a linter sees it, which is why step 3 of the sequencing (raise the existing rule to `"error"`)
  matters more than any type change here.
- **`toastCatch(ctx, "Failed to load")` type-checks perfectly**, because the parameter *is*
  `string | undefined` and a string is what was passed. The defect is not in the type; it is that
  the value is discarded 200 lines away in a different file. **No signature can express "this
  argument is read by nobody."** The structural equivalent of a type for that case is to *delete the
  parameter* — `toastCatch(context: string)` with no second argument — which makes the 39 call sites
  a compile error and forces each to a real destination. That is a genuine type-over-gate move, and
  it is available today at a cost of 39 mechanical edits.

**4. The one type change that would have prevented the largest defect is not in the frontend at
all.** `CONTRACT.md`'s invariant I1 says no layer above Rust ever sees English prose from below.
`resolveError()` exists precisely because Rust sends English sentences that the frontend then
pattern-matches with 63 substring rules — a lossy parse of prose back into a code, which is the
exact operation I1 exists to prevent. If Rust returned `{ code, params }` instead, there would be no
English registry to accidentally render, no two hand-synced tables to keep in lock-step (Gap 2), and
no `"Something went wrong."` fallback swallowing 94 authored messages. **The 596-toast hole is
downstream of a missing type at the IPC boundary**, and the frontend fix in step 1 is a correct,
cheap patch over it — not the cure. The cure belongs to
[`typed-error-contract.md`](./typed-error-contract.md), and this document's contribution is the
measurement that says how much it is worth.

So the general rule for this situation, and it is the mirror of what
[`design-token-usage.md`](./design-token-usage.md) found: **there, the token vocabulary was open
strings and the fix was to close it. Here the vocabulary is already closed and enforced by the
compiler — so the leverage is not in the catalog at all, it is in making every place copy can be
written accept a key instead of a string.** Every remaining deviation in this document is a place
that accepts `string` where it could accept `CopyKey`.
