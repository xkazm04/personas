# Convergence study — `politicas` vs the design-token / display golden paths

> Bidirectional comparison run 2026-08-14. **Repo A** = `personas` (this repo, HEAD `f9e3a33fd`).
> **Repo B** = `politicas` (`C:/Users/mkdol/dolla/politicas`, HEAD `8c25d35`).
> Scope: the design-token and number-display overlap — repo B's `no-hardcoded-colors`,
> `no-raw-number-display`, `no-server-import-in-client`, `require-source-citation`
> against [`design-token-usage.md`](../golden-paths/design-token-usage.md).
>
> Method: full `npx eslint --format json` runs over **both** repos (938 and 4,829 files),
> a twelve-axis regex census of repo B's `app/` + `features/` + `lib/` + `components/`
> (706 files), full reads of repo B's four in-scope rules, its `eslint.config.mjs`,
> `app/globals.css`, `lib/format.ts`, `lib/i18n/useFormat.ts`, its rule-doc set and its
> RuleTester suite; plus `git log --diff-filter=A` dating of every token rule in both
> repos. Repo A's numbers were re-measured, not quoted — the golden path's 66.2% colour
> figure reproduced at 66.4% and its 1,135/0/246 lint baseline reproduced exactly.
> **Read-only in both repos.**

---

## 0. Four corrections to the brief — read these first

The brief's framing is wrong in four places, and two of them change what the experiment can conclude.

**0.1 — "two independently-developed repos … no shared code" is false.** Repo B contains
`scripts/census/PROVENANCE.json`, which names its source verbatim:

```json
"source": { "repo": "personas", "commit": "f9e3a33fd", "path": "scripts/census" },
"portedAt": "2026-08-14"
```

Alongside it, `scripts/census/library-index.json` is a **vendored catalogue of this repo's
golden-path library** — `"leaves": 247, "written": 45`, generated from
`docs/concepts/situation-spine.json` at the same commit. Repo B also carries three ESLint
rules with **byte-level overlap** with this repo's (normalised, blank-stripped, sorted):
`role-button-requires-keydown` **70%**, `enforce-reduced-motion-fallback` **59%**,
`no-silent-catch` **40%**. And `eslint.config.mjs:126` labels its catalog-boundary block
"**Catalog boundary (personas pattern)**" in its own source.

*What survives:* **none of the four rules in scope are contaminated.** Measured against
their nearest repo-A analogue, `no-hardcoded-colors` vs `no-direct-white-colors` is **30%**
and `no-raw-number-display` vs `prefer-numeric` is **32%** — both at the level of the
shared ESLint module skeleton (`module.exports = {`, `meta:`, `schema: [],`), not of shared
logic. `require-source-citation` and `no-server-import-in-client` have no repo-A analogue at
all. The design-token and display comparison is valid; the *convergence* claim is void for
the three transplanted rules and must not be cited as independent evidence anywhere.

**0.2 — "~2,281 TS/TSX files" is wrong by ~2.5×.** Measured: **905** `.ts`/`.tsx` excluding
`node_modules`, `.next` and `.claude/`; **706** in the product roots (`app` 72 · `features`
486 · `lib` 146 · `components` 2). The remainder is `scripts/` (184) and `packages/` (8).
Adding `.claude/worktrees/**` — four live checkouts of the same repo — gets to 1,694; adding
`.next/` gets to 1,760. No counting reaches 2,281. **Repo B is 6.8× smaller than repo A in
the product surface, not 0.5× larger.** Every ratio in this document is affected.

**0.3 — "8 docs in `docs/rules/`" is the wrong path, and repo B does better than claimed.**
`docs/rules/` does not exist at repo B's root. The docs are at
`packages/eslint-plugin-civic-transparency/docs/rules/*.md` (8 files, 380 lines). And the
invariant is not 1:1:1 but **1:1:1 + 2**: `npm run test:rules` runs 8 RuleTester suites
**plus** a `shim equivalence` suite asserting `eslint-rules/*.cjs === plugin.rules` (so the
thin shims cannot drift from the canonical pack) **plus** a `run-all` plugin-surface check.
Verified by running it — 10 PASS, 0 FAIL.

**0.4 — "repo A has zero tests for its custom rules" is false.**
`src/test/eslint-rules/customRules.test.ts` (387 lines) is a RuleTester suite covering
**12 of repo A's 21 rules**. The accurate statement is that **9 are untested** —
`prefer-numeric`, `prefer-section-card`, `prefer-shared-clipboard`, `prefer-status-badge`,
`role-button-requires-keydown`, `enforce-reduced-motion-fallback`, `no-module-scope-en-value`,
`no-unprefixed-wide-min-width`, `no-whole-store-subscription` — and that **the rule in this
study's scope (`prefer-numeric`) is one of the nine.** The B-BETTER verdict survives on
57% vs 100% coverage and on *which* rules are missing, not on zero-vs-eight.

---

## 1. Verdict table

| # | Clause / situation | Verdict | Backing measurement |
|---|---|---|---|
| 1 | Semantic **colour** tokens, theme-remapped | **PHYSICS** | Repo B independently reached a 10-token `@theme` palette remapped by `[data-rezim="forenzni"]` (`globals.css:15-42`, `:218-230`) and uses it **4,336×/171 files at 99.4%**. Repo A: 25,911 semantic, 66.4%. Third repo (`personas-web`) 63.4%. |
| 2 | Role-named **radius / elevation / spacing / type** tiers | **A-LOCAL** (confirmed twice) | Repo B has **0** `--radius-*`, **0** `--shadow-*`, **0** `--spacing/--density-*`, **0** `.typo-*` in `globals.css`. Its whole token set is 10 colours + 2 fonts. Second independent confirmation after `personas-web`. |
| 3 | P2 — "re-pointing Tailwind's scale in place makes raw scale classes a lie" | **A-LOCAL**, not physics | Repo B overrides **nothing** in Tailwind's scale. The hazard is a consequence of *having* a role layer, not of using Tailwind. Repo A + `personas-web` share it because they share the practice. |
| 4 | P7 — a deny-list gate certifies names it has not enumerated | **PHYSICS, reached by a different route** | Repo B never wrote an allow-list rule; it closed the vocabulary by **exhaustion** — 10 named colours, no eleventh. Result: **0** raw Tailwind palette classes, **0** `text-white`/`bg-white` across 706 files. |
| 5 | P6 — "a token you must *import* competes with a class you can *type*, and loses" | **FAILS** | Repo B's number-format token is **import-delivered** (`useFormat()` / `formattersFor()`) and sits at **826 on-token calls / 117 files vs 1 off-token call — 99.9%**. |
| 6 | §7.A — "every import-delivered token sits at 0.2–3.4%, **gate or not**" | **FAILS — the variable never varied in repo A** | All five of repo A's import-delivered axes have **zero effective enforcement** (3 have no rule, `no-raw-spacing-classes` is `off`, `prefer-status-badge` fires 3×). Repo B supplies the missing cell. |
| 7 | §7.A — "adoption tracks enforcement, not merit" | **SURVIVES, and strengthens** | Repo B: 5 of 8 rules at `error`, 2 escalated `warn`→`error` in `app/**`. Result **1 error / 12 warnings** over 938 files. |
| 8 | A third variable the corpus never controlled: **rule age at install** | **NEW — confounded with delivery format in repo A's own data** | Repo A's 94–99% axes all got their rule in the first 6 weeks (`no-raw-text-classes` day 30, `no-raw-shadow` day 38, `no-raw-radius` day 40). Its collapsed axes got a rule late (`no-direct-white-colors` day 73) or never. Repo B's colour rule shipped **in the initial commit**. |
| 9 | **Number/currency display** — which repo is right | **B-BETTER, decisively** | Repo A's `<Numeric>` binds locale via an **optional prop defaulting to `'en'`**; **8 of 226** call sites pass it. Repo B binds it in the **hook** (`useFormat()` → `useLocale()`); getting it wrong is unrepresentable. |
| 10 | Rule **testing** discipline | **B-BETTER** | Repo B 8/8 rules tested + shim-equivalence + surface check, wired into `npm run check`. Repo A 12/21, and its suite is **not** in `npm run check`. |
| 11 | Per-rule **docs** with escape hatches + adoption mapping | **B-BETTER** | Repo B: 8 docs, each with *when it fires / when it does not / escape hatches / adoption mapping*. Repo A: **0** per-rule docs. |
| 12 | **Token contract tests** (assert the CSS, not the component) | **B-BETTER** — closes repo A's own Gap 7 | Repo B has 2 vitest suites that `readFileSync` `app/globals.css` and assert theme completeness + recomputed WCAG contrast. Repo A has **0**. |
| 13 | **Severity escalation by scope** (`warn` globally, `error` where clean) | **B-BETTER** | `eslint.config.mjs:78-91`. Inventory burned **29 → 11** warnings; `app/**` held at `error` throughout. |
| 14 | Boundary the type system cannot express, enforced by lint | **PHYSICS (principle) + B-BETTER (mechanism)** | Both repos gate module boundaries. Repo A uses `no-restricted-imports` config; repo B wrote an AST rule that distinguishes `import type` from a value import and also visits `ImportExpression`. Repo A's catalog boundary is **advisory `warn` by explicit choice**; repo B's is `error`. |
| 15 | **Focus-ring** vocabulary | **CONVERGENT BLIND SPOT** | Repo A: `.focus-ring` exists, 15.7% adoption, **no rule**. Repo B: **no token at all**, 26 hand-rolled `focus-visible:outline-*`/19 files in **≥6 distinct spellings**, **no rule**. |
| 16 | **Inert / disabled** state vocabulary | **CONVERGENT BLIND SPOT** | Repo A: 594 hand-rolled `disabled:opacity-N`, **10 distinct values**, token used 4× app-side, no rule. Repo B: 19 hits, **3 distinct values** (50/40/60), **no token**, no rule. |
| 17 | Hand-rolled `Record<variant, classString>` instead of a variants lib | **PHYSICS — now n=3** | No `cva`/`clsx`/`classnames`/`tailwind-merge` in **any** of repo A, `personas-web`, repo B. Repo B has **88 files** with `Record<…, string>` class maps. |
| 18 | Declared token **mirrors** must name the gap they stand in for (P8) | **PHYSICS** | Repo B's 3 colour exemptions are named in `globals.css:7-12`, in the rule source `:8-11`, in `eslint.config.mjs:101-108`, and in the exempt file itself. Contrast repo A's radius/white exemptions, which name none. |
| 19 | `require-source-citation` — provenance on every rendered figure | **B-ONLY / DOMAIN** | No repo-A analogue. 11 warnings / 3 files; `app/**` clean at `error`. Depends on a house-formatter chokepoint being the *only* path numbers take to the page. |

---

## 2. Evidence

### 2.1 Colour is physics — and repo B's 99.4% is not caused by its lint rule

Repo B's entire token layer, read in full:

```css
@theme {                                    /* app/globals.css:15-42 */
  --color-ink / --color-paper / --color-paper-strong / --color-signal /
  --color-cobalt / --color-ochre / --color-steel / --color-hairline /
  --color-steel-aa / --color-signal-deep
}
@theme inline { --font-sans; --font-mono }  /* :53-56 */
[data-rezim="forenzni"] { …all 10 remapped… }  /* :218-230 */
```

Ten colours, two fonts, one alternate theme. Census over 706 product files:

| | repo A (`src/**`, 4,829 f) | repo B (`app`+`features`+`lib`+`components`, 706 f) |
| --- | ---: | ---: |
| semantic colour utilities | 25,911 | 4,336 (171 f) |
| raw Tailwind palette (`text-slate-400`, …) | **13,115** (1,142 f) | **0** |
| `text-white` / `bg-white` / `-black` | 109 | **0** (the 304 `font-black` hits are a font weight) |
| arbitrary colour (`bg-[#…]`) | 13 | 24 (1 file) |
| hex literals in `.ts`/`.tsx` | — | 70, and **all 70 are in the 4 declared-exempt files** |
| **semantic share** | **66.4%** | **99.4%** |

**Now the disproof, which is the important half.** `no-hardcoded-colors` matches
`#hex`, `rgb(`, `hsl(` **only** (`no-hardcoded-colors.cjs:14`). It does **not** match
`text-slate-400`. And repo B never reset Tailwind's default palette — there is no
`--color-*: initial` in `globals.css`, so `text-slate-400` still compiles. **Nothing
mechanically prevents a raw palette class in repo B, and there are zero of them.**

So the rule is not the cause. The cause is that repo B's token layer **emits only token
classes**, so there is no in-repo example of a palette string to copy. Repo A's does the
opposite: `STATUS_PALETTE.success.text` *is* the string `'text-emerald-400'`, so the token
layer itself teaches the palette spelling — which is precisely
[Gap 3](../golden-paths/design-token-usage.md#8-gaps). **Repo B is the natural experiment
for Gap 3, and it says Gap 3 is worth more than any rule on that axis.**

### 2.2 A-LOCAL confirmed twice: only colour is a token here

Grepped against `app/globals.css`: `--radius-*` **0** · `--shadow-*` **0** ·
`--spacing-*`/`--density-*` **0** · `--text-*`/`.typo-*` **0**. The axes repo A tokenises
with role names, repo B writes raw and does not gate:

| axis | repo B usage | token? | rule? |
| --- | ---: | :---: | :---: |
| type size | 1,166 raw `text-{xs..9xl}` / 133 f | no | no |
| spacing | 4,291 raw `p-N`/`gap-N`/… / 162 f | no | no |
| radius | 22 raw `rounded-{sm..full}` / 18 f | no | no |
| elevation | 3 raw `shadow-{sm..2xl}` / 3 f | no | no |

**One honest confound.** Repo B's art direction is a functionalist poster — `borderRadius: 0`
is written into its own chart chrome (`features/landing/palette.ts:33`) — so its 22 radius
hits partly reflect "this design language has almost no radius", not only "role tokens are
house style". `personas-web` is the cleaner control on that axis: it *renamed* Tailwind's
radius scale and still added **zero** role tokens. Two repos, two different reasons, same
verdict. `rounded-card` / `shadow-elevation-2` / `CARD_PADDING` are **this house's
calibration of P1**, now confirmed against two outside stacks.

### 2.3 The gradient's counter-example: an import-delivered token at 99.9%

Repo B's number formatting is import-delivered in exactly the sense P6 warns about — you
must `import { useFormat }`, call it, and hold the result, versus typing `.toLocaleString()`
inline with no import at all. Measured over `app/**` + `features/**`:

| | count |
| --- | ---: |
| on-token formatter calls (`f.dec`/`f.int`/`f.czk` + named chokepoint formatters) | **826** |
| files importing the chokepoint | **117** |
| off-token `.toFixed`/`.toLocaleString*` | **1** — `features/budget/tools/generate-municipal-suppliers.ts`, a build-time generator |
| `Intl.NumberFormat`/`DateTimeFormat` | 5, of which **3 are comments explaining why not to** and 2 are a Prague wall-clock computation |
| `// raw-format-ok:` escape hatches used | **1** |
| **adoption** | **99.9%** |

`custom/no-raw-number-display` reports **0**. The condition is **extinct**, not unenforced —
`app/**` runs it at `error` (`eslint.config.mjs:88-89`), which `--quiet` cannot suppress.

Set against repo A's own §7.A table, this is the cell that was never filled:

| delivery | gate that actually fires | adoption |
| --- | --- | ---: |
| class | yes (repo A `typo-*`, `shadow-elevation-*`, `rounded-<role>`) | 94–99% |
| class | no (repo A `focus-ring`, `is-disabled`) | 15.7%, 1.0% |
| class | yes, at `error`, from commit 1 (repo B colour) | **99.4%** |
| **import** | **yes, at `error` in the hot scope (repo B format)** | **99.9%** |
| import | **no** — all five repo-A axes | 0.2–3.4% |

Repo A's five import-delivered axes are `MOTION` (no rule), `BORDER_*` (no rule),
`SECTION_GAP` (`off`), `CARD_PADDING` (`off`), `STATUS_PALETTE` (`prefer-status-badge`,
3 hits repo-wide). **Not one of them has a gate that fires.** The claim "import-delivered
sits at 0.2–3.4%, *gate or not*" generalises from a set in which the gate variable was
constant at zero.

### 2.4 The third variable: rule age at install

`git log --diff-filter=A` on every token rule, against each repo's first commit:

| rule | repo | added | days after repo start | code volume when installed | adoption today |
| --- | --- | --- | ---: | --- | ---: |
| `no-raw-text-classes` (`typo-*`) | A | 2026-03-19 | 30 | small | **99.0%** |
| `no-raw-shadow-classes` | A | 2026-03-27 | 38 | small | **99.4%** |
| `no-raw-radius-classes` | A | 2026-03-29 | 40 | small | **94.0%** |
| `no-low-contrast-text-classes` | A | 2026-04-08 | 50 | growing | 705 open warnings |
| `no-direct-white-colors` | A | 2026-05-01 | 73 | large | 66.4% (and white-only) |
| `prefer-numeric` | A | 2026-06-18 | **121** | 4,000+ files | 5 warnings / 197 broken sites |
| `no-hardcoded-colors` | B | 2026-07-23 | **0 — initial commit** | zero | **99.4%** |

In repo A, delivery format and rule age are **perfectly confounded**: every class-delivered
token got its rule in the first six weeks, and every import-delivered token got its rule
late or never. Repo B breaks the tie in the one direction that matters — its *import*-delivered
axis got an early, firing gate and landed at 99.9%.

This also reframes what repo B proves. Repo B is **460 commits and 22 days old** (2026-07-23 →
2026-08-13) against repo A's **7,281 commits and 179 days**. Its colour rule predates all of
its code. So repo B is not evidence that *a gate converges an existing codebase* — it is
evidence that **a gate installed at t=0 prevents the condition from ever existing.** Repo A's
13,115 palette literals accumulated in the 73 days before any colour rule existed, and the
rule that eventually arrived matched only `text-white`/`bg-white`.

### 2.5 Number display — repo B is right, and repo A's primitive re-creates the bug it exists to fix

This is the sharpest single finding in the study.

**Repo A.** `custom/prefer-numeric` routes call sites to
`src/features/shared/components/display/Numeric.tsx`, whose docstring promises
"locale-aware formatting". The locale arrives through an **optional prop**:

```ts
// src/lib/utils/formatters.ts:107
const language = opts?.language ?? 'en';
```

Measured across `src/**`:

- `<Numeric …>` — **226 occurrences / 114 files** (of which 4 are JSDoc examples inside
  `Numeric.tsx` itself and 3 are JSDoc in `.ts` files, so ~219 are real call sites)
- **197 pass `value=`** — the population where the formatter actually runs
- of those 197, **8 pass `language=`** — all in three files under `overview/sub_activity` and `sub_observability`
- **189 of 197 formatter-driven call sites (95.9%) render `en` number formatting**

Repo A ships **14 locales**, seven of which (cs, de, es, fr, id, ru, vi) use a decimal comma.
Of the 197 value-driven sites, **96 carry an explicit `unit=`** and **101 default to `plain`** —
and every unit in flight is locale-sensitive: `usd` ×32, `count` ×24, `percent` ×11,
`compact` ×9, `ratio` ×7, `ms` ×7, `plain` ×7. `formatCost` states the defect in its own
comment (`formatters.ts:109-111`):

> "UI callers **should** pass `language` from useTranslation() so non-English locales see
> e.g. `0,0042 $` in fr-FR instead of `$0.0042`."

A written instruction, and 96% non-compliance — the corpus's own "documentation does not
hold a line", one level above where the golden path looked. And `custom/prefer-numeric`
cannot see it: the rule checks that you *reached* the primitive, not that you *configured*
it. It reports **5 warnings across 4 files** while 189 correctly-migrated call sites render
the wrong separator.

**Repo B.** The locale is bound in the hook, not at the call site:

```ts
// lib/i18n/useFormat.ts
export function useFormat(): Formatters {
  const raw = useLocale();                       // next-intl — ambient, not a prop
  const locale = isLocale(raw) ? raw : defaultLocale;
  return useMemo(() => formattersFor(locale), [locale]);
}
```

There is no argument to forget. `f.dec(x)` is correct for the active locale by construction.
Repo B goes further and makes the formatters **deterministic and Intl-free**
(`lib/format.ts:17-30` — hand-rolled `groupDigits`) because "server and client can ship
different ICU versions … and break hydration" — an SSR concern repo A does not have, but the
determinism is a free win either way.

**Verdict: repo B is right.** Not because it has fewer locales (2 vs 14) — the opposite; the
more locales you ship, the more expensive an optional locale prop is. It is right because it
chose **ambient binding over per-call-site configuration**, which is the same move as
[`focus-management.md`](../golden-paths/focus-management.md)'s "derive the guarantee from a
prop that already existed", applied to locale.

**One disproof attempt against repo B, which found a real crack.** `lib/format.ts`'s header
claims "deterministic, no `Intl`" — but `:144` and `:147` call
`k.toLocaleString("cs-CZ")` / `("en-US")` inside the currency formatter. The locale is
explicit so the output is locale-correct, but the ICU-version hydration hazard the file
exists to avoid is still present in `czk`. Repo B's own rule cannot catch it: `lib/**` is
outside `no-raw-number-display`'s scope by design, because the chokepoint legitimately calls
`toFixed`. **The exemption that makes the chokepoint possible is also the one place the
chokepoint's own doctrine is violated** — an instance of P8 ("an exemption makes a directory
unmeasured, not compliant") in the repo that otherwise honours P8 best.

### 2.6 `no-server-import-in-client` — the principle is portable, the mechanism is better

The Next.js specifics do not port: repo A has no `"use client"` directive, no bundle
boundary, no PGlite-in-the-browser hazard. **The principle ports completely**, and both
repos already hold it:

| | repo A | repo B |
| --- | --- | --- |
| boundary 1 | raw `invoke` → `invokeWithTimeout` (`eslint.config.js:73-82`, **error**) | server loader / `lib/db` value-imports in `"use client"` (**error**) |
| boundary 2 | `shared/components/**` must not import `@/stores`, `@/api`, `@/lib/bindings`, a feature (`:175`, **warn**, "ADVISORY … not a build gate") | `features/shared/**` must not import `@/lib/civic/*` or a feature (`:141-162`, **error**) |
| mechanism | `no-restricted-imports` — path patterns only | custom AST rule |

Two mechanical advantages repo B has that `no-restricted-imports` structurally cannot give:

1. **Type-only imports are exempt correctly.** `import type { X } from "./getXData"` erases
   at compile time and is legal; a value import of the same module is a breach. The rule
   checks `node.importKind === "type"` **and** the all-type-specifier form
   `import { type A, type B }` (`no-server-import-in-client.cjs:44-46`). Repo A's base
   `no-restricted-imports` has no such distinction, so it must ban the path outright or not
   at all.
2. **Dynamic imports are covered.** `ImportExpression` is a different AST node that an
   `ImportDeclaration` visitor never sees; repo B added a second visitor with a comment
   explaining that there is no type-only concept for a dynamic import, so **every** dynamic
   import of a server module is a real breach (`:57-64`). This was a follow-up fix
   (`07909f6 fix(lint): no-server-import-in-client now checks dynamic import() too`) — a
   hole found and closed, which is what the test suite is for.

Also relevant to repo A directly: repo B took repo A's **own** catalog-boundary pattern
(its config says so), widened it from `components/**` to all of `features/shared/**`, ran it
at **`error`** — and validated the widening with a **probe** before shipping: two synthetic
files (`poster/__probe.tsx` importing `@/lib/civic/data`, `forensic/__probe.tsx` importing a
feature) confirmed accepted by the old scope and rejected by the new, with the widening
verified as a no-op on real code (`eslint.config.mjs:130-140`). Repo A's version of the same
rule is `warn` and explicitly disclaimed as advisory.

### 2.7 Convergent blind spots — three, and all three are unowned axes

**Focus ring.** Neither repo tokenises it and neither gates it.

- Repo A: `.focus-ring` exists (`globals.css:11-16`), **616 uses / 289 files = 15.7%**, no rule.
- Repo B: **no token exists.** `globals.css:85-88` describes the intended idiom in a prose
  comment — `focus-visible:outline-2 outline-offset-2 outline-cobalt`, "~30 places" — and
  109 `focus-visible:` occurrences across 19 files have already drifted into **at least six
  distinct spellings**:

  ```
  focus-visible:outline-2 focus-visible:outline-cobalt                                   (no offset)
  focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cobalt
  focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cobalt
  focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cobalt   (NEGATIVE — inward ring)
  focus-visible:outline-2 outline-offset-2 outline-cobalt                                (offset+colour unprefixed → always on)
  focus-visible:outline-2 focus-visible:outline-cobalt disabled:opacity-60
  ```

  Only **11** `outline-offset-*` for **26** `focus-visible:outline-2`. Repo A's failure is a
  token nobody adopts; repo B's is a convention nobody can adopt because it was never
  published as anything but a comment. Same condition, and the shape of it is that **an axis
  with no owner drifts regardless of whether a token exists**.

**Inert state.** Repo A: 594 `disabled:opacity-N` across **10 distinct values**, token value
0.45 appearing once, `is-disabled` at 4 app-layer uses, no rule. Repo B: 19 hits across
**3 distinct values** (`50`×6, `40`×5, `60`×1) plus 7 `disabled:cursor-not-allowed`, **no
token at all**, no rule. Repo B's absolute numbers are small — it is 6.8× smaller — but its
*fragmentation rate is the same story at a smaller scale*: three values for one decision, in
22 days.

**No variants library, ~50–90 hand-rolled lookup maps per repo.** Neither `cva`, `clsx`,
`classnames`, `tailwind-merge` nor `tailwind-variants` appears in **any** of repo A,
`personas-web` or repo B's `package.json`. Repo B has **88 files** carrying a
`Record<…, string>` class map. This raises the golden path's "personas-web independently
arrived at the identical shape 45 times" from n=2 to **n=3, three stacks, no shared code** —
the strongest physics claim in this document, and the clearest missing shared abstraction.

### 2.8 The gate state in both repos, and what `--quiet` actually costs

Repo B's lefthook pre-commit is `npx eslint --quiet --no-warn-ignored {staged_files}` —
`--quiet` drops warnings before they can be counted, so its two `warn`-scoped rules
(`require-source-citation`, `no-raw-number-display` under `features/**`) enforce nothing at
the hook. Its `npm run lint` is bare `eslint` with no `--max-warnings`, so warnings do not
fail CI either. **This is structurally identical to repo A** (`lint: eslint src/`, hook
`--quiet --max-warnings 99999`).

**Repo B's mitigation is what separates them:** 5 of 8 rules run at `error` globally, and the
two doctrine rules are escalated `warn → error` in `app/**` — the scope that was measured
clean first (`eslint.config.mjs:72-91`, whose comment records the 2026-07-30 inventory of
29 warnings). Re-measured today: **11**. The burn-down is real and the ratchet held.

Full lint state, both repos, measured today:

| | repo A | repo B |
| --- | ---: | ---: |
| files linted | 4,829 | 938 |
| **errors** | **0** | **1** |
| warnings | **1,135** (246 files) | **12** (4 files) |
| warnings per 1,000 files | 235 | 12.8 |
| in-scope rules at `error` | 0 of 5 token rules | 5 of 8 (+2 scope-escalated) |

Repo A's run reproduces the golden path's §7.0 table exactly (705 / 226 / 128 / 16 …).
`custom/prefer-numeric`: **5 warnings, 4 files** — `ReferenceBoard.tsx:348`,
`PreviewResults.tsx:21`, `MissionLearning.tsx:140,142`, `ZoomBadge.tsx:24` — against 142
`.toFixed`/`.toLocaleString` in `.tsx` files and the 189 mis-localised `<Numeric>` sites the
rule is blind to.

**Repo B's single error needs a caveat, and it clears repo B.** It is
`scripts/census/__fixtures__/tree/hits.tsx:35 react/jsx-no-undef` — a deliberate-violation
fixture belonging to **this repo's census runner, ported into repo B today and still
untracked** (`git status` → `?? scripts/census/`). At repo B's committed HEAD the lint is
**0 errors / 12 warnings**. The port needs an `eslint.config.mjs` ignore entry before it is
committed, or it will turn repo B's CI "Lint (incl. custom rules)" step red. That is a
finding about the library's porting kit, not about repo B.

### 2.9 B-ONLY / DOMAIN — what the library needs to hold `require-source-citation`

`require-source-citation` has no analogue in repo A and never will: it encodes
politicas's editorial brand promise ("every rendered number carries its source") as a lint
gate. Repo B's implementation is the most sophisticated of the eight — file-scoped rather
than subtree-scoped (with the reason written down: a figure in a leaf and its `SourceNote`
as a sibling caption is the *correct* layout a subtree walk would flag), precision-over-recall
triggers, three satisfier classes, and `// citation-ok:` for a citation living in a parent
file (16 in use).

The category is real and the library must be able to hold it. What such a leaf needs, that a
convergent leaf does not:

1. **An explicit non-portability declaration in the head**, so an adopting repo skips it in
   O(1) instead of re-deriving why it does not apply. The [portability
   test](./portability-test.md) already measured four ported signals at zero true positives;
   a domain leaf should say up front that its expected transfer is zero.
2. **A separated substrate clause.** The *rule* is domain-specific; its **precondition** is
   not — it requires a formatting chokepoint that is the only path numbers take to the page,
   which is why `no-raw-number-display` is its sibling and had to land first. That
   dependency (*"a provenance gate is only detectable if a chokepoint gate already holds"*)
   is a **transferable claim about gate ordering** and belongs in the corpus even though the
   rule does not. Repo B's own doc says exactly this: "One chokepoint is what makes the
   sibling rule `require-source-citation` *detectable*."
3. **Escape-hatch accounting as first-class content.** Repo B's `// citation-ok:` sits at 16
   uses against 11 open warnings — the hatch is more used than the violation. A domain leaf
   without a published hatch budget cannot be audited by anyone but its author.
4. **Permission to be the corpus's only instance.** A situation spine sized on *recurrence*
   will never surface a leaf with recurrence 1 in one repo. The category needs its own
   admission rule, not a threshold.

---

## 3. What the library must change — B-BETTER items only

**B1 — Wire the RuleTester suite into `npm run check`, and cover the 9 untested rules.**
Repo A: `check: … tsc --noEmit && eslint src/`. `src/test/eslint-rules/customRules.test.ts`
runs only under `npm run test`, which `check` does not call. Repo B:
`check: typecheck && lint && test && test:rules`.
*Edit:* append `&& npm run test -- --run src/test/eslint-rules/` to `package.json`'s `check`
(or add a `check:rules` script and chain it), and add RuleTester cases for the nine uncovered
rules, `prefer-numeric` first — it is in the study's scope, is untested, and reports 5
findings against a condition of ~190.

**B2 — Give every custom rule a doc with the four sections repo B uses.**
Repo A has 21 rules and **0** per-rule docs; the rationale lives in each `.cjs` header where
no adopter will look. Repo B's 8 docs each carry *Why · When it fires · When it does not fire ·
Escape hatches · Adoption mapping* in ~45 lines.
*Edit:* create `eslint-rules/docs/<rule>.md` per rule with those five headings, and add a
`README.md` table mapping rule → guards → recommended severity → strict severity. Start with
the five token rules, since [`design-token-usage.md` §7.C](../golden-paths/design-token-usage.md#7c-the-primitive-layer-is-where-the-tokens-are-not-spoken--and-it-is-exempt)
already shows nobody can currently reconstruct which rule exempts which directory or why.

**B3 — Ship token-contract tests that read the CSS. This closes repo A's own Gap 7.**
`design-token-usage.md` Gap 7 states "Nothing tests any token contract" and repo B has the
working pattern in 108 lines: `readFileSync('app/globals.css')`, slice the layer by its
comment markers, assert **completeness** (every core token is remapped — a half-inversion
leaves dark text on a dark ground), assert **contrast** by recomputing WCAG luminance from
the hex values in the file, assert **calm** (the layer introduces no transition).
*Edit:* add `src/test/design/tokenContract.test.ts` asserting, from `globals.css` /
`typography.css` text: (a) `--radius-card` = 12px, `--radius-input` = 8px,
`--radius-interactive` = 6px, `--radius-modal` = 16px; (b) `--disabled-opacity` = 0.45 and
`.is-disabled` sets opacity + cursor + `pointer-events`; (c) **every `.typo-*` tier declares
`font-weight`** — this is the premise the 2,005-site `typo-token-overpainted` census rule
rests on and it is currently asserted nowhere; (d) `[data-theme^="light"]` remaps every token
the dark set defines, no half-inversion. This is the single highest-value item in the list:
every §7.C deviation could be fixed today and silently regress tomorrow.

**B4 — Adopt scope-escalated severity for the token rules.**
Repo A runs all five token rules at `warn`, which enforces nothing at either gate (`lint` has
no `--max-warnings`, the hook has `--quiet`). Repo B's answer is not "flip everything to
error" — it is *find a scope that is already clean and hold it at `error` while the rest burns
down at `warn`*, with the inventory date and count written into the config comment.
*Edit:* for `custom/no-raw-radius-classes` (128 warnings / 44 files) measure a clean subtree —
`src/features/shared/chrome/**` and any feature with 0 findings — and add a scoped `error`
block naming the inventory date and count, in repo B's format. Same for
`custom/no-raw-text-classes` (16 / 12 — small enough to burn down entirely and then go global
`error`). Repo B's config comments are the template: they state *what was measured, when,
and what it measured to*, so a later reader can re-run the claim.

**B5 — Bind locale ambiently in `<Numeric>` instead of via an optional prop defaulting to `'en'`.**
189 of 197 formatter-driven call sites currently render en-US separators in a 14-locale app.
*Edit:* have `Numeric` read the active language itself — `const { language } = useTranslation()`
inside the component — and keep the `language` prop only as an override. This makes the 8
explicit sites redundant rather than special and fixes 189 sites with no call-site churn.
Same for `formatNumeric`/`formatCost`/`formatPercent`/`formatCount`/`formatCompactNumber` in
`lib/utils/formatters.ts`: replace `opts?.language ?? 'en'` with a
`getActiveTranslations()`-style ambient default (the shim at `@/i18n/en` already establishes
that non-React modules can read the active locale). This is the same *class* of change as
Gap 3 and Gap 4 — **move the correct behaviour from opt-in to structural** — and it is more
urgent than either, because unlike a wrong radius it is visibly wrong to the user.

**B6 — Make the porting kit lint-safe.**
`scripts/census/__fixtures__/**` contains deliberate violations. In repo A they sit outside
`eslint src/` and are invisible; in repo B they landed inside the lint root and produced the
one error in the repo. *Edit:* have whatever emits `scripts/census/` into a target repo also
emit (or instruct) an ignore entry for `scripts/census/__fixtures__/**`, and add that to
`PROVENANCE.json`'s note. A knowledge library whose transport mechanism turns the recipient's
CI red is spending its credibility on its own packaging.

**B7 — Name the gap in every exemption (P8 is already doctrine here; repo B is the exemplar).**
Repo B's three colour exemptions are named in four places: the CSS header, the rule source,
the config block, and the exempt file itself. Repo A's `no-raw-radius-classes.cjs:46-52` and
`no-direct-white-colors.cjs:28-33` exempt `shared/components/` and `src/lib/` and name
nothing — and §7.C measures that those exemptions hide **57.7%** of the radius violations.
*Edit:* add a `reason` comment per exempted root pointing at the Gap that must close before
it is removed (Gap 1 for radius, Gap 3 for white/colour), matching the census runner's own
`exclude[].reason` contract. Repo B also shows the missing half: its `palette.ts` mirror says
"when a token changes, change both places" and **no test asserts it**. Do not repeat that —
whatever exemption repo A keeps, pair it with a parity test (which is B3).

---

## 4. Did the delivery-format gradient survive contact with a second stack?

**No. It is falsified as stated, and what replaces it is stronger.**

The claim was: *class-delivered + rule → 94–99%; class-delivered, no rule → 1–16%;
import-delivered → 0.2–3.4%, gate or not.* Repo B breaks the third clause outright. Its
number-format token is import-delivered — a hook you must import and call, competing against
a method you can type inline with no import — and it sits at **99.9%** (826 on-token calls,
1 off-token, that one in a build-time generator). It is not a marginal counter-example; it is
the top of the range.

The reason the gradient looked real is now measurable: **in repo A, delivery format is
perfectly confounded with two other variables.** Every import-delivered axis is also an axis
with *no gate that fires* (three have no rule, two are `off`, one fires three times
repo-wide), and also an axis whose rule — where one exists — arrived late into a large
codebase. Every class-delivered axis at 94–99% got its rule inside the first six weeks. With
n=1 repo, those three variables cannot be separated. Repo B separates them and delivery
format is the one that drops out.

What survives, restated:

> **Adoption is governed by whether a gate fires and by how early it fires — not by
> whether the token is a class or an import.** A gate that fires converges its axis
> regardless of delivery format. A gate installed before the violations accumulate does not
> converge an axis so much as prevent it from ever diverging: repo B's colour rule shipped in
> its **initial commit** and its palette has **zero** off-token classes in 706 files, while
> repo A's colour rule arrived on day 73 and matched only `text-white`.
>
> **P6 is not dead, but it is demoted from a predictor to an ergonomic preference.** Ship a
> token as a class where the platform allows it, because it is cheaper to type and cheaper to
> grep — not because the import will fail. Gap 4 (`p-density`) and Gap 3 (`text-status-*`)
> are still worth doing, but their justification changes: Gap 3's real payoff is that
> `STATUS_PALETTE` currently publishes `'text-emerald-400'`, so the token layer *teaches the
> violation* — and repo B, whose token layer emits only token classes, has **zero** palette
> strings without any rule capable of matching one. That is the mechanism, and it is about
> **what the token layer exemplifies**, not about class-vs-import.

Two caveats that keep this honest. Repo B is **22 days and 460 commits old with 706 product
files** against repo A's **179 days, 7,281 commits and 4,829 files** — it has not yet had time
to accumulate the drift that a gate must *converge* rather than *prevent*, and its 3-distinct-
disabled-opacities and 6-spelling focus ring show that drift starts immediately on any
ungated axis. And repo B's census subsystem was ported from this repo **today**, so nothing
downstream of `scripts/census/` — including its `library-index.json` — is independent
evidence of anything.

The finding that most deserves to leave this study is not about tokens at all. It is that
repo A's `<Numeric>` primitive, which `custom/prefer-numeric` exists to route people toward,
renders **en-US number formatting at 189 of 197 formatter-driven call sites in a 14-locale
app**, and states the requirement in its own source comment while 96% of callers do not meet
it. **A gate that verifies you reached the right primitive, and cannot verify you configured
it, is a gate pointing at a broken destination.** That is a new condition the corpus does not
name, it was invisible from inside repo A, and it took a repo that binds locale ambiently to
make it visible.
