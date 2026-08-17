# Golden path — Writing a custom lint rule

> Situation node: `platform-delivery/testing-and-workflow/custom-lint-rule` · [situation spine](../situation-spine.md)
> `sides: client` · recurrence **42** · risk **medium**.
> Dimensions: **code-quality · function · resilience · cost**.
> Composed 2026-08-14 against `master` @ `09c2d482f`. Ground truth: a full
> `npx eslint src --format json` run (**4,829** files, parsed as JSON — not
> grepped), all **21** rule modules in `eslint-rules/` (**2,564** lines) read at
> source, an AST re-derivation of the i18n rule's attribute recall over **4,389**
> parsed files, a **21-rule positive-control battery**, an **18-case same-defect
> variant battery**, a **9×4 className depth matrix**, `scripts/census/lib/engine.mjs`,
> and both sibling repos (`personas-web`, `brainiac`).
> The **Deviations** section is a fix backlog.

> ### ⚠ Corrections to the brief that commissioned this path
>
> **1. One convergence claim is FALSE.** The brief states that `personas-web`'s
> "selector rule gives **backwards advice** that would degrade this repo."
> There is **no CSS-selector or dropdown rule in `personas-web` at all** — the
> search for `selector|dropdown|querySelector` in its `eslint-rules/` returns
> only one rule's own name. That rule is `custom-zustand/no-multi-zustand-selector`
> (`personas-web/eslint-rules/no-multi-zustand-selector.js`), which is about
> **Zustand store subscriptions**, and its message is:
> *"Component calls {{name}} {{count}} times. Collapse into a single useShallow
> selector to avoid duplicate subscriptions."*
> ~~That is not backwards — it is the **same prescription this repo enforces**~~
>
> **ADJUDICATED 2026-08-14 by reading the sibling's source, and this paragraph is
> WRONG.** Two composers reached opposite conclusions about the same rule, so the
> parent opened `personas-web/eslint-rules/no-multi-zustand-selector.js` directly.
> It fires on `if (info.count > 1)` — **more than one call to the same store hook
> in one component** — and prescribes collapsing them into a single `useShallow`
> bundle.
>
> That is **not** the same prescription as `custom/no-whole-store-subscription`,
> and on this axis it is the opposite one. Banning whole-store subscription says
> *"don't subscribe to everything"*; the sibling's rule says *"subscribe in one
> call"*. **A component with three narrow selectors satisfies this repo's rule and
> violates the sibling's.** `zustand-domain-slices.md` §"shared trap" is correct:
> adopting it here would flag the repo's dominant and correct idiom — 2,160 narrow
> property selectors, which allocate nothing and compare by `Object.is` — and push
> them toward a bundle that allocates an object per notification. The sibling's own
> config concedes it: scoped to 1 of its 12 stores, at `warn`.
>
> The correct part of this paragraph stands: there is no CSS-selector or dropdown
> rule in `personas-web`, so the brief's *framing* was wrong. The error was
> resolving that by declaring agreement rather than reading the predicate. **Do not
> adopt this rule.** Kept visible because a same-token, opposite-meaning collision
> between two composers is exactly the failure the convergence oracle is most
> exposed to.
>
> **2. "21 of those are the literal word `Close`" — the count is 20, not 21.**
> Measured by AST across every `.ts`/`.tsx` under `src/`, including the files the
> rule skips (`0` of the 20 are in skipped files). Everything else about that
> finding replicated exactly.
>
> **3. Every other figure in the brief verified, and `1,080 / 1,113` verified
> *exactly*** — once you know it was measured over **lowercase host elements only**.
> Counting all `title=` attributes gives 1,693 (1,637 expression-valued), because
> ~34% of them are a *component prop* named `title`, not the HTML tooltip
> attribute. Both numbers are honest; they are different populations. §7 D.
>
> **4. The brief's framing — "which rules are broken" — is the wrong question,
> and the measurement says so.** All 21 matchers are alive (§9 A). The disease is
> not dead rules. It is **narrow** rules: 21/21 fire on the textbook shape, and
> 13 of 18 fail on the same defect wearing different syntax.

---

## 1. Trigger

- "This keeps happening in review — let's add a lint rule for it."
- "Can ESLint catch X?" / "I'll write a custom rule so this can't regress."
- "The rule reports zero, so we're clean" — **this is the trigger, and it is the
  most dangerous phrasing on the list.**
- "Should this be a lint rule, a census rule, or a test?"
- "Why is this rule at `warn`?" / "can we bump it to `error`?"
- If you are about to create a file in `eslint-rules/` — or to add an id to the
  `custom:` plugin block in `eslint.config.js` — you are in this situation.

## 2. The one way

**Before writing a rule, try to delete the need for it: a required prop, a
newtype, a factory that owns the dangerous argument, or a default that is correct
makes the wrong call unrepresentable, and a rule only counts it (§ "Type over
gate"). If a rule is still the answer, write the rule and its adversary in the
same commit.** The adversary is three fixtures in
`src/test/eslint-rules/customRules.test.ts`: a **positive control** (the textbook
shape — proves the matcher is alive), a **variant** (the identical defect wearing
different syntax — proves the matcher is not keyed on one author's formatting),
and a **negative** (correct code — proves it will not fire on content that is
already right). Visit AST nodes, never raw file text; never decide a file is
exempt because some token appears *somewhere* in it; and never abort an ancestor
walk at the first enclosing function, because that is exactly where the
population lives. Then set severity by **whether the condition is extinct**, never
by how many warnings it produced: a condition you have driven to zero and
positive-controlled goes to `"error"` and stays there forever (`no-silent-catch`
is the proof); a condition with a live backlog goes to the **census** as a
ratcheting baseline, because a `warn` in this repo is a squiggle in your editor
and **nothing at either gate** (§ "The severity trap").

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `eslint-rules/<rule-id>.cjs` | The rule module. CommonJS, `module.exports = { meta, create }`. `meta.docs.description` and `meta.messages` are both required — the message is the only teaching surface the developer ever sees. |
| `eslint.config.js` `custom:` plugin block (`:40-64`) + `rules:` (`:95-121`) | Registration and severity. A rule file that is not in **both** lists is dead code. |
| `src/test/eslint-rules/customRules.test.ts` | The `RuleTester` host. Already wired to vitest (`RuleTester.it = it`, `:31-33`) with `@typescript-eslint/parser` and `ecmaFeatures.jsx` (`:35-44`). **Add your cases here — do not create a new test file.** |
| `scripts/census/rules.json` + `npm run census:check` | The ratcheting-baseline gate for a condition with a live backlog. Fails on rise, on silent drop, on a stale exclude, on a broken walk. |
| `scripts/census/lib/engine.mjs` `assertRule` (`:250-316`) | The fail-loud contract, implemented once. Read it before writing any counting script — you almost certainly do not need to write one. |
| `sourceCode.getScope(node)` / `context.sourceCode` | The supported way to reason about scope. Not `getText()`. |

**Do not invent a second rules directory, a second test file, or a bespoke
counting script.** There is exactly one of each.

## 4. Steps

1. **Ask whether a type can end the situation.** Can the primitive take a
   required prop, return a scoped handle, or default to the correct value? If
   yes, do that instead and stop — you do not need a rule. (§ "Type over gate".)
2. **Ask which instrument this is.** Three-way decision table in §5 A. "Must be
   zero forever" → ESLint at `"error"`. "Large live backlog, must not grow" →
   census. "A cross-file structural invariant" → a test. Getting this wrong is
   the single most common mistake in this leaf.
3. **Write the failing fixture first** — the invalid case in
   `customRules.test.ts`. Watch it fail for the right reason.
4. **Write the rule against AST nodes.** Pick the narrowest node type that
   *contains* the condition, not the narrowest that contains the example you
   have in mind.
5. **Write the variant fixture.** Take your invalid case and re-dress it: wrap
   the literal in `{…}`, build the string with `cn()`, put it behind a ternary,
   alias the import, move the value into a `variants` object, destructure the
   receiver. **If your rule does not catch its own variant, it will not catch
   production code**, because production code is where all six of those live.
6. **Write the negative fixture** — correct code that is near the boundary. This
   is where you discover you are matching text instead of structure.
7. **Register it in `eslint.config.js`** in both the plugin map and the rules
   map, with a comment stating *why* the chosen severity is right.
8. **Run it over `src/` and read the first twenty reports at source.** Not the
   count — the reports. This is where you learn your false-positive class.
9. **Baseline it if it is a census rule; leave it alone if it is an ESLint rule.**
   And then stop — `assertRule` owns ratcheting, drift, staleness and the
   fail-loud contract from here. Do not write a script.

## 5. Anti-patterns

### A. Reaching for the wrong instrument

The three mechanisms are not interchangeable, and the boundary is sharp:

| Condition | Instrument | Why |
| --- | --- | --- |
| **Must be zero, forever** | **ESLint at `"error"`** | The census **cannot express this by construction.** `engine.mjs:264-273` treats `matches === 0` as a *structural failure* and says so: *"a rule pinned at 0 is a gate that can never fail"* — it instructs you to **delete** the rule. So a permanently-extinct condition has exactly one home. `custom/no-silent-catch` is it. |
| **Large live backlog, must not grow** | **census rule** | A count of 705 cannot go to `"error"` without breaking every build, and at `warn` it enforces nothing. The census ratchets it. |
| **A cross-file / registry invariant** | **a test** | "Every registered rule has a fixture", "every route in the nav is in the dispatcher", "every variant carries the focus ring". ESLint sees one file at a time; the census matches one regex per file. Neither can join across files. A vitest that walks the filesystem can. |

### B. Deciding a whole file is exempt from a token appearing in it

`enforce-reduced-motion-fallback.cjs:110-112`:

```js
const fileText = sourceCode.getText();
const fileHasFallback = FALLBACK_TOKENS.some((tok) => fileText.includes(tok));
if (fileHasFallback) return {};
```

The word `useReducedMotion` in a **comment** disables the rule for the entire
file. Measured: a fixture with `// TODO: useReducedMotion here one day` above a
`repeat: Infinity` animation is **not reported** (§9 B). This is not a subtle
bug — it is the rule's design, and it converged independently in the sibling repo
(§ "Convergence", finding 1), which makes it the most important anti-pattern here.

### C. Reading only `Literal` in a codebase that writes `{expressions}`

`no-hardcoded-jsx-text.cjs:126`:

```js
if (!node.value || node.value.type !== 'Literal' || typeof node.value.value !== 'string') return;
```

Of **3,134** `placeholder` / `title` / `aria-label` / `aria-*` attributes in the
files this rule actually visits, **166 (5.3%)** are bare string literals. The
other **94.7% are expression containers and the rule returns before looking at
them.** Most of those are correct (`aria-label={t.common.close}`) — but at least
**92** contain real English prose inside the expression (§7 D). The rule's entire
attribute yield is 50.

### D. Aborting the ancestor walk at the first enclosing function

`prefer-numeric.cjs:80`:

```js
while (p) {
  if (p.type === 'CallExpression' || p.type === 'ArrowFunctionExpression' || p.type === 'FunctionExpression') return;
```

This was written to suppress false positives on formatter callbacks. It also
suppresses every genuine display site reached through a helper call or a
`.map(…).join()` — both measured as missed (§9 B). The comment at `:72-76`
explicitly reasons about why the arrow bail is safe, and is wrong.

### E. Arguing severity from warning volume

Several documents in this corpus have argued that a rule deserves `"error"`
because a warning is "invisible in a sea of thousands". **The volume is
irrelevant, and so is the direction of the argument.** See § "The severity trap":
a warn-level rule enforces nothing at any count, including a count of one.

### F. Treating "zero findings" as evidence

Nine of the 21 rules report zero. Five of those nine have **no test at all**, so
until this composition nothing in the repo distinguished "the condition is
extinct" from "the matcher never fires." (It turned out to be the former for all
of them — §9 A — but that was luck, not design.) `personas-web`'s motion rule
reports zero and is blind to the entire library it claims to guard.

### G. Writing a counting script

`npm run census` exists. It already implements floor assertions, zero-match
detection, stale-exclude detection, rise **and silent-drop** drift, and prints
surviving counts so a green log is distinguishable from a log that checked
nothing. A bespoke script re-derives all of that and gets the multiline-comment
case wrong (`engine.mjs:196-211` documents the exact bug, measured 127 → 126).

## 6. Evidence

**The one to copy: [`eslint-rules/no-silent-catch.cjs`](../../../eslint-rules/no-silent-catch.cjs).**
It is 70 lines and it is the only custom rule in this repo that passes every test
this document defines:

- **Structural, not textual.** It visits `CatchClause` and asks
  `node.body.body.length === 0` (`:54-61`). There is no regex, no `getText()`, no
  filename heuristic, and nothing to re-dress.
- **Survives its variant.** A catch body containing only a justifying comment is
  still caught (verified, §9 B) — because a comment is not a statement, so the
  AST question is the *semantic* question. That is what "key on structure" buys.
- **Positive-controlled and tested** — `customRules.test.ts:228-249`, two valid
  and two invalid cases.
- **`"error"` severity, earned.** `eslint.config.js:104`. It reports **0** across
  4,829 files, and the positive control proves the matcher is alive. The
  condition is extinct and cannot come back.
- **The message teaches** (`:46-48`): it names the fix, the module to import,
  and pre-empts the objection — *"A comment-only justification … is not enough —
  the next person debugging in production needs the breadcrumb, not the comment."*

Two supporting exemplars, each for one property:

- **Documentation:** [`eslint-rules/no-module-scope-en-value.cjs:18-30`](../../../eslint-rules/no-module-scope-en-value.cjs)
  cites the real production bug that caused the rule to exist, with the offending
  source quoted. Every rule should open this way. (Its *implementation* is not
  exemplary — §7 F.)
- **Precision-by-narrowness, stated:** [`eslint-rules/prefer-status-badge.cjs:14-19`](../../../eslint-rules/prefer-status-badge.cjs)
  explains that it requires the complete three-class combo at canonical
  opacities, and that near-matches are *deliberately* not flagged because
  migrating them would be a visual redesign. A rule that writes down what it
  chose not to catch is a rule whose zero you can trust.

## 7. Deviations

Counts are from the JSON ESLint run at `09c2d482f`, matching
[`shared-facts.json`](../shared-facts.json) `lint` exactly (1,135 warnings /
0 errors / 246 of 4,829 files).

### A. Nine of 21 rules have no test — and five of those report zero

`customRules.test.ts` covers **12** rules (`:16-27`). Untested: `enforce-reduced-motion-fallback`,
`no-module-scope-en-value`, `no-unprefixed-wide-min-width`, `no-whole-store-subscription`,
`prefer-numeric`, `prefer-section-card`, `prefer-shared-clipboard`, `prefer-status-badge`,
`role-button-requires-keydown`. Five of them (`no-whole-store-subscription`,
`prefer-shared-clipboard`, `prefer-section-card`, `no-unprefixed-wide-min-width`,
`role-button-requires-keydown`) report **0 findings**, so nothing in the repo
could tell a finished migration from a broken matcher. `role-button-requires-keydown`
is at **`"error"`** with zero coverage.

Also: the file's own closing assertion says *"registered RuleTester cases for all
**12** custom rules"* (`:384`) — accurate when written, now describing 57% of the set.

### B. Every rule's finding count, severity, and coverage

| Rule | Severity | Findings | Files | Test | Positive control | Variant |
| --- | --- | ---: | ---: | :-: | :-: | :-: |
| `no-low-contrast-text-classes` | warn | **705** | 179 | ✓ | fires | **caught** |
| `no-hardcoded-jsx-text` | warn | **226** | 56 | ✓ | fires | **missed ×2** |
| `no-raw-radius-classes` | warn | 128 | 44 | ✓ | fires | **missed** |
| `no-raw-text-classes` | warn | 16 | 12 | ✓ | fires | — |
| `enforce-base-modal` | warn | 8 | 8 | ✓ | fires | **missed** |
| `no-module-scope-en-value` | warn | 6 | 1 | ✗ | fires | **missed** |
| `prefer-numeric` | warn | 5 | 4 | ✗ | fires | **missed ×2** |
| `enforce-reduced-motion-fallback` | warn | 3 | 2 | ✗ | fires | **missed ×2** |
| `no-unmanaged-effect-resources` | warn | 3 | 3 | ✓ | fires | **caught** |
| `prefer-status-badge` | warn | 3 | 2 | ✗ | fires | — |
| `no-direct-white-colors` | warn | 3 | 3 | ✓ | fires | **caught** |
| `async-catch-requires-helper` | warn | 1 | 1 | ✓ | fires | **caught** |
| `no-silent-catch` | **error** | 0 | 0 | ✓ | fires | **caught** |
| `no-loose-event-payload` | **error** | 0 | 0 | ✓ | fires | — |
| `role-button-requires-keydown` | **error** | 0 | 0 | ✗ | fires | **missed** |
| `no-raw-shadow-classes` | warn | 0 | 0 | ✓ | fires | — |
| `no-whole-store-subscription` | warn | 0 | 0 | ✗ | fires | **missed** |
| `prefer-shared-clipboard` | warn | 0 | 0 | ✗ | fires | **missed** |
| `prefer-section-card` | warn | 0 | 0 | ✗ | fires | — |
| `no-unprefixed-wide-min-width` | warn | 0 | 0 | ✗ | fires | **missed** |
| `no-raw-spacing-classes` | **off** | 0 | 0 | ✓ | fires | — |

**3 `error`, 17 `warn`, 1 `off`.** All 21 matchers are alive. **13 of 18
same-defect variants are missed (72%).**

### C. `enforce-reduced-motion-fallback` — 3 reports, and both blind spots are structural

The brief's "0 true positives, 6 blind spots" is consistent with what the source
shows, and this composition adds the mechanism. Two independent escapes, both
measured:

1. **`variants=` is invisible.** The rule requires an `animate=` attribute
   (`:130-131`) and then reads only `transition=` or `animate.transition` as
   `ObjectExpression`s (`:137-153`). The idiomatic Framer form —
   `<motion.div variants={V} animate="pulse" />` with `repeat: Infinity` inside
   `V` — has no ObjectExpression at either place and is **not reported**.
2. **A comment disables the file** (anti-pattern B).

Both were confirmed by injection, not by reading. Note also that
`isMotionElement` (`:39-47`) matches only `motion.X` / `m.X` member expressions,
so any wrapped or aliased motion component is out of scope, and Tailwind
`animate-pulse` / `animate-spin` (101 and 184 files per `shared-facts.json`) are
entirely outside the rule's world.

### D. `no-hardcoded-jsx-text` — the attribute half reaches 5.3% of its own population

AST census over the **4,389** files the rule visits (440 skipped by its own
filename filter; 4,389 + 440 = 4,829, so file coverage is exact):

| Attribute | literal | `{expression}` | reported | suppressed |
| --- | ---: | ---: | ---: | ---: |
| `aria-label` | 66 | 834 | 22 | 44 |
| `title` | 56 | 1,637 | 22 | 34 |
| `placeholder` | 43 | 495 | 20 | 23 |
| `aria-roledescription` / `aria-valuetext` | 1 | 2 | 0 | 1 |
| **total** | **166** | **2,968** | **64** | **102** |

(The 64 is a faithful replay of the rule's predicates on the same 4,389 files;
real ESLint reports **50**. `src/` carries **25** `eslint-disable` directives
naming this rule, which is the likely source of most of the 14-report delta — I
did not attribute them individually, so treat the two numbers as bracketing the
truth rather than the smaller one as fully explained.)

- **All 44 `aria-label` suppressions come from one clause** —
  `isNonTranslatable` line 83, *"any identifier-shaped word ≤20 chars is a
  token"*. **20** of them are the literal word `Close`; the rest are `Dismiss`
  (6), `Accept` (5), `Reject` (5), `Refresh` (5), `Remove`, `Cancel`, `Delete`,
  `Save`, … Every one is a user-visible accessible name. **The clause exists to
  skip CSS tokens and it is eating the button labels.**
- **`title` on host elements: 1,080 of 1,113 are expressions** — the brief's
  figure, reproduced exactly. Across *all* elements it is 1,637 of 1,693; the
  difference is 580 `title` **props** on components, which the rule also flags
  and which are a different concern.
- **≥92 expression-valued sites contain real English prose.** Two independent
  detectors (a two-word regex; a tokeniser that rejects identifiers, snake_case,
  dotted paths and URLs) agree on **92** with **zero** A-only disagreement.
  Examples: `AutomationCard.tsx:92 title={… "Test is already running" …}`,
  `UseCaseRow.tsx:149 aria-label={… "Activate capability" …}`,
  `CloudDeployPanel.tsx:300 title={… "Health-check round-trip latency:" …}`.
  **The rule's structural blind spot is 1.8× its entire attribute yield.**

  > A caution earned during this composition: my *first* detector reported 245,
  > and ~60% of the excess was `aria-label={… "auto_design_conversation_controls_ab77f46f" …}` —
  > i18n **keys**, which are indistinguishable from English words at the AST
  > level. A single-implementation composition would have shipped that number.

**Precision, re-verified independently:** all 50 attribute reports read at
source → **45 true positives (90%)**. The false-positive class is specific and
worth knowing: **technical example strings in `placeholder`** —
`"https://example.com/product/123"`, `".price, h1, a.title"`, `"/data/0/name"`,
`"sk-..."`, `"npx tsc --noEmit 2>&1 | …"`. Consistent with the brief's 92%/37.
I did **not** re-sample the 176 text-half reports at source, so I neither
confirm nor dispute precision on that half.

### E. `prefer-numeric` — 5 findings, and a doc calls the migration done

Confirmed at 5 warnings / 4 files. Both display-intent variants (through a helper
call; through `.map(…).join()`) are missed. The `"✅ Done — 0 remaining"` claim
the brief cites is downstream of exactly this: the rule's count *is* near zero,
and the count was mistaken for the population.

This rule is also the corpus's standing example of the contract's **fifth failure
mode** (`golden-path-contract.md:84-107`): it routes callers to `<Numeric>`,
which bound its locale through an optional prop defaulting to `'en'`. Reaching
the destination was gated; the destination was wrong.

### F. Nine className readers, four depths, no shared code

`eslint-rules/` contains **zero** cross-rule `require()` calls. Nine rules
independently implement "get the static class string out of this `className`",
and they do not agree. Measured behaviourally — same class, four syntaxes:

| Shape | Rules that catch it |
| --- | --- |
| `className="X"` | **9 / 9** |
| ``className={`X ${y}`}`` | **9 / 9** |
| `className={cn("X")}` | **6 / 9** |
| `className={b ? "X" : "Y"}` | **6 / 9** |

`no-raw-radius-classes`, `no-raw-shadow-classes` and `no-raw-spacing-classes`
stop at template literals; the other six walk call arguments and conditionals.
Nothing in the rule list, the config, or the docs reveals which is which.

> **Disproof — the exposure is not where the capability gap is.** I expected this
> to hide a large backlog and measured it: raw radius classes living inside
> `cn()`/ternary `className` values number **1** (both implementations agree,
> across 1 file: `MessageDetailModal.tsx:598`), against 128 already reported.
> **The depth gap is real as a capability and negligible as exposure for the
> design-token rules.** It matters for `no-hardcoded-jsx-text` (§7 D, 92 sites)
> and it will matter for the next rule someone writes. Do not fix the three
> shallow rules for the backlog; fix them so the shared helper has one shape.

### G. The rule files are not covered by the main gate

`npm run check` runs `eslint src/` (`package.json:51`). `eslint-rules/` is
outside `src/`, so the rule modules themselves are linted only by the pre-commit
hook's staged-files glob (`lefthook.yml:19-20`, `*.{ts,tsx,js,cjs,mjs}`) — and
that invocation passes `--quiet`.

## 8. Gaps

1. **ESLint cannot see across files.** "Every registered rule has a fixture",
   "every event name is in the registry" — these are joins. ESLint has one file.
   This is not a limitation to work around; it is the boundary that tells you the
   instrument is a **test** (§5 A, and `brainiac`'s answer under Convergence).
2. **The census cannot express "must be zero"**, by explicit construction
   (`engine.mjs:264-273`). It is a *ratchet*, and a ratchet needs something to
   ratchet against. This is the exact complement of gap 1: between them, ESLint
   at `"error"` and the census cover the two ends, and neither covers the middle.
3. **A rule cannot know its own recall.** It reports what it matched. Nothing in
   ESLint estimates the population it failed to match — which is why 21 rules
   could all report plausibly and 13 of 18 variants still escape. **The variant
   fixture is the only affordable proxy**, and it is a proxy: it proves the rule
   survives *one* re-dressing, not all of them.
4. **`isNonTranslatable` is asked an undecidable question.** `Close` (a button
   label) and `auto_close_814f` (an i18n key) and `flex` (a CSS token) are the
   same AST node. My own detector fell into this (§7 D). No cleverer regex fixes
   it; the fix is to change what the rule looks at — attribute *position* and
   element role, not string shape.
5. **`type: 'problem'` vs `'suggestion'` carries no enforcement.** It is metadata.
   Four rules declare `problem`; it changes nothing at either gate.
6. **The census `floor` is weak on a small tree.** `eslint-rules/` has 21 files,
   so the "did the walk break?" assertion has little room. The positive control
   in §9 C exists precisely because `floor` alone cannot carry that weight here.

## 9. The missing gate

> **What condition is the signal a proxy for?** *A custom lint rule that buys
> precision by not looking — one that decides scope from raw text, or refuses any
> value that is not a bare literal, or stops its ancestor walk at the first
> enclosing function.* A repo adopting this path must derive its own proxy: in
> `personas-web` the identical defect wears an `ImportDeclaration` handler setting
> a file-wide boolean, and this repo's regex would find nothing there.

### A. The finding that reframes the gate — 21/21, not 0/21

Every one of the 21 rules was fault-injected with a fixture containing the exact
condition its own docstring claims it detects.

**All 21 fire.** There are no dead matchers in this repo. Nine rules report zero
because their conditions are genuinely absent, not because they are broken.
That is a **cleared claim**, and it inverts the gate this leaf initially wanted
(a "detect the dead rule" check would find nothing).

> **And the harness proved the point about itself.** My first run reported
> **0 of 21 firing** — including `no-low-contrast-text-classes`, which has 705
> real findings. The bug was mine: the synthetic filename sat outside ESLint's
> flat-config base path, so every rule returned *"No matching configuration
> found"* and the run looked like a catastrophic discovery. **It was caught only
> because one rule had a known non-zero count to contradict it.** A harness with
> no known-positive would have shipped "every custom rule in the repo is dead" as
> a finding. This is the fifth failure mode of §9, committed inside the
> verification of §9.

### B. The gate this leaf actually needs is a TEST, not a lint rule and not a census rule

The primary instrument for this leaf is a cross-file join, which §8 gap 1 says
belongs to a test. Add to `src/test/eslint-rules/customRules.test.ts`:

```
For each rule id registered in eslint.config.js's `custom:` plugin block:
  assert a ruleTester.run(...) block exists for it            → fails today for 9
  assert it declares >= 2 invalid cases                       → the positive control + the variant
  assert it declares >= 1 valid case                          → the negative
```

- **Signal:** the set difference between the ids in `eslint.config.js` and the
  ids passed to `ruleTester.run(...)`. Both are parsed from source, so the
  assertion cannot drift from either.
- **Mechanism:** vitest, already in CI via `npm run test`.
- **Allowlist:** none. A rule too awkward to fixture is a rule whose zero nobody
  should trust.
- **How it fails loudly if its own precondition is absent:** it asserts the
  extracted id list is **non-empty and ≥ 21** before comparing. A regex that
  stops matching `eslint.config.js` yields an empty set, whose difference from
  anything is empty — the classic green-while-checking-nothing shape. The length
  assertion is the whole gate.

This is what `brainiac` already does for its own conventions (Convergence, 3):
`console/src/design/focus-contract.test.ts` walks `.tsx` files from disk and
asserts structural conditions with an allowlist that **requires a written
reason** — the same discipline `engine.mjs:352-356` enforces on census excludes.

Measured evidence that the variant clause is the load-bearing half: **13 of 18**
same-defect variants escape today, across **10** different rules.

### C. The census rule — for the countable half only

A census rule cannot express "every rule has a fixture" (§8 gap 1). It *can*
count the three not-looking shortcuts named in §5 B/C/D, which is the part of
this leaf that is a per-file regex condition. **Checked first: none of the 59
existing rules gates `eslint-rules/`, or lint-rule authorship, at all.**

**Two independent implementations, run before baselining** (contract requirement):
a whole-file regex and a line-based scanner with different logic. Both report
**3 files / 3 matches**, with **zero** disagreement in either direction:
`enforce-reduced-motion-fallback.cjs:110`, `no-hardcoded-jsx-text.cjs:126`,
`prefer-numeric.cjs:80` — the three lines §5 B/C/D quote.

**False-positive audit (a gate that fires on correct content is worse than no
gate):** all **6** `ArrowFunctionExpression` mentions in the directory were read.
The three in `no-unmanaged-effect-resources.cjs` (`:116`, `:163`, `:213`),
`async-catch-requires-helper.cjs:159` and `no-module-scope-en-value.cjs:71` use
the node type to *identify* a callback — correct usage. The `return`
co-occurrence requirement excludes all five. **3/3 true positives, 0 false
positives, verified by reading every candidate line.** No lookbehind is used;
the one multi-line alternative is forward-anchored and bounded (`{0,200}?`).

```json
{
  "id": "unlooking-lint-rule",
  "goldenPath": "docs/concepts/golden-paths/custom-lint-rule.md",
  "roots": ["eslint-rules"],
  "extensions": [".cjs"],
  "signal": {
    "pattern": "(?:getText\\(\\)|sourceCode\\.text)[\\s\\S]{0,200}?\\.includes\\(|\\.type !== ['\"]Literal['\"]|\\.type === ['\"]ArrowFunctionExpression['\"][^\\n]{0,80}return",
    "flags": "g",
    "description": "A custom ESLint rule that buys precision by NOT LOOKING: it trusts a whole-file text scan to decide whether to run (getText().includes(token)), rejects any attribute value that is not a bare Literal, or aborts its ancestor walk at the first enclosing arrow/function. Each shortcut silently removes most of the rule's own target population — measured: 13 of 18 same-defect variants escape.",
    "ignoreCommentLines": false
  },
  "baseline": { "files": 3, "matches": 3 },
  "floor": 15
}
```

`ignoreCommentLines` is deliberately **false**: the multi-line alternative would
hit the match-swallowing hazard `engine.mjs:196-211` documents (a comment
containing the opening token consumes every real hit in its span, which is how
`build-gated-ipc-entrypoint` silently dropped 127 → 126). The cost is that a
docstring *describing* one of these shortcuts would count — acceptable, and
arguably correct.

**Positive control** — published without a `baseline`, with `positive-control` in
the id. `engine.mjs:362-372` gives this shape **first-class support**: it detects
the id and *inverts* the baseline requirement, erroring if one is present
("a baselined control would ratchet against improving adoption"), and
`merge-published-rules.mjs` skips it by construction.

> **Corrected during composition.** My first control was
> `^module\.exports = \{` — a walk-liveness probe. That is **not** what
> `engine.mjs:348-355` asks for: a control must point **the same anchors at the
> COMPLIANT form**, which is what proves the matcher discriminates on *shape*
> rather than on a *token*. A liveness probe would have passed while telling us
> nothing about whether the gate can tell `ArrowFunctionExpression`-to-abort from
> `ArrowFunctionExpression`-to-identify-a-callback. Replaced:

```json
{
  "id": "unlooking-lint-rule-positive-control",
  "goldenPath": "docs/concepts/golden-paths/custom-lint-rule.md",
  "roots": ["eslint-rules"],
  "extensions": [".cjs"],
  "signal": {
    "pattern": "\\.type === ['\"]ArrowFunctionExpression['\"](?![^\\n]{0,80}return)",
    "flags": "g",
    "description": "COMPLIANT form of the gate's third anchor: a rule that uses ArrowFunctionExpression to IDENTIFY a callback rather than to abort its ancestor walk. The gate must not match these and this control must — if the two populations ever overlap, the gate is keyed on the token, not the shape."
  },
  "floor": 15
}
```

**Validation, run standalone against the real engine (no edit to `rules.json`):**

```
validateRule(main): OK          validateRule(control): OK (no baseline, as required)
[main]     walked=21 scanned=21 files=3 matches=3
   eslint-rules/enforce-reduced-motion-fallback.cjs  x1  line 110
   eslint-rules/no-hardcoded-jsx-text.cjs            x1  line 126
   eslint-rules/prefer-numeric.cjs                   x1  line  80
assertRule: CLEAN
[control]  walked=21 files=2 matches=3
   eslint-rules/no-unmanaged-effect-resources.cjs    x2  lines 116,163
   eslint-rules/async-catch-requires-helper.cjs      x1  line  159
[fault-injection: bogus root]       -> floor, zero-matches, dropped, dropped
[fault-injection: baseline too low] -> rose, rose
RE-EXTRACTION VALIDATION PASSED
```

**Both populations and their overlap.** Gate: **3 files** —
`enforce-reduced-motion-fallback`, `no-hardcoded-jsx-text`, `prefer-numeric`.
Control: **2 files** — `no-unmanaged-effect-resources`, `async-catch-requires-helper`.
**Overlap: 0.** The violating file `prefer-numeric.cjs` is absent from the control
and the two compliant files are absent from the gate, so the discriminator is
demonstrably the `return` co-occurrence — the *shape* — and not the token
`ArrowFunctionExpression`, which appears in both populations. If a future edit
makes these two sets intersect, the gate has decayed into a token match and
should be deleted rather than tuned.

Both blocks above were **re-extracted from this finished document and re-run**
(not from the draft), and the baselines match measured reality exactly.

### D. Severity, and the boundary with build/test gating

`custom/no-silent-catch` should stay at `"error"` — not because empty catches are
worse than low-contrast text, but because **the condition is extinct and
positive-controlled**, which is the only argument that survives. The same test
now passes for `no-loose-event-payload`. `role-button-requires-keydown` is at
`"error"` with **no fixture**; it should get one before anyone relies on its zero.

**Do not promote any of the other 17 to `"error"`.** And do not argue the
converse from volume either — see below.

**Boundary with the two build/test paths.** ESLint is the wrong instrument for
anything that requires compiling or running:

- [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) — a
  condition that depends on which cargo features are active is invisible to
  ESLint (which never sees `src-tauri/` at all — `eslint.config.js:30` ignores
  it). Those gates belong in CI as *correctly-flagged* cargo invocations, and
  that path's §7 B documents a second CI file still missing `--features desktop`
  while printing `Rust lint (clippy) ✓` unconditionally — the same
  green-while-checking-nothing shape as §9 A above, in a different tool.
- [`rust-unit-test-harness.md`](./rust-unit-test-harness.md) — the Rust half of
  "the adversary ships with the code". A custom lint rule's `RuleTester` cases
  are the JS equivalent of that path's fixture DDL discipline, and both fail the
  same way: a harness that cannot run reports success.

## The severity trap — read this before proposing `"error"`

```
package.json:51   "check": "… && tsc --noEmit && eslint src/"
lefthook.yml:20   npx eslint --quiet --no-warn-ignored --max-warnings 99999 {staged_files}
```

`npm run check` (the CI gate, `ci.yml:111`) passes **no `--max-warnings`**, so it
exits 0 with 1,135 warnings and would exit 0 with 100,000. The pre-commit hook
passes `--quiet`, which discards warnings *before* the 99,999 ceiling can count
them. **A warn-level rule enforces nothing at either gate, at any count.** It is
not "weak enforcement" — it is zero enforcement, by construction, and no volume
argument changes that. Warn-level rules still change behaviour, through editor
squiggles at authoring time, which is why they correlate with adoption without
ever failing a build.

The fix is **not** per-rule promotion (which would break every build on 705
findings). It is a repo-level ratchet — `eslint src/ --max-warnings 1135`, lowered
as counts drop. That is precisely what `brainiac` does with `-D warnings`
(Convergence, 3): declare lints as `warn` locally and promote the whole class to
fatal at the CI boundary. **One flag replaces twenty severity arguments.**
Filed here rather than applied — this document does not edit config.

## Convergence

`personas-web` (Next.js) and `brainiac` (Rust) were read for this leaf. Both
were decisive, and one contradicted the brief (see corrections, top).

1. **The whole-file-trust escape is PHYSICS — independently reinvented.** Both
   repos' motion rules decide "this file is fine" from a **file-level name
   check**, with no proof any animation is gated:
   - here: `fileText.includes(tok)` over the raw source (`enforce-reduced-motion-fallback.cjs:110-112`);
   - there: an `ImportDeclaration` handler setting a file-wide `hasReducedMotion`
     flag (`require-animation-gating.js:38-42`), consumed at `:83`.

   Two authors, no shared document, same shortcut, same failure: an **unused
   import** silences it there, a **comment** silences it here. That is the
   strongest possible evidence that §5 B is doctrine and not local taste — and
   it is why the census rule in §9 C targets exactly this line.

2. **The blind spot converged; the fix did not — and that is the signature of a
   spec-only requirement.** The brief predicted `personas-web`'s motion rule would
   be "also structurally blind to `repeat: Infinity`". It is blind in a stronger
   sense than predicted: its **entire** trigger surface is `requestAnimationFrame`,
   `cancelAnimationFrame`, and `<canvas>` (`:48-58`, `:72-79`). It has no
   `Property`, `ObjectExpression`, `JSXAttribute` or `Literal` visitor, and the
   string `Infinity` appears nowhere in its rules directory. It reports **0**.
   So: **two repos, two motion rules, two zeros, and neither can see the hazard**
   — while the *fix* (a variant fixture, an AST-level repeat check) exists in
   neither. Per the lesson this campaign earned: convergence measures
   discoverability, not whether a requirement is real. Both authors discovered
   the same cheap shortcut; neither discovered the remedy. **Treat §9 B's variant
   clause as a spec-only requirement with no field precedent — which is exactly
   why it must be written down rather than assumed.**

3. **`brainiac` writes no custom lint at all, and is better enforced.** No dylint,
   no custom clippy lint, no `clippy.toml`, no `xtask`. One stock lint
   (`unwrap_used = "warn"`, `Cargo.toml:59-60`) opted into by all 8 crates — and
   `cargo clippy --workspace --all-targets -- -D warnings` (`ci.yml:37-38`)
   promotes it to fatal in CI. The conditions that *would* be bespoke rules
   elsewhere are instead **filesystem-walking vitest guard tests** that fail the
   build (`focus-contract.test.ts`, `routes.test.ts`, `kb-data.test.ts`) — with an
   allowlist requiring a written reason, and a header that pre-empts its own
   abuse: *"If you are here because this failed: the fix is almost never to widen
   the allowlist."* Its ESLint config states the governing principle directly:
   *"Where a stock rule disagreed with an established, deliberate pattern in this
   repo at scale, the rule is downgraded to `warn` with the reason written down —
   never satisfied by rewriting working code."* Both of this path's §9 answers
   (a test for the join; `-D warnings` for severity) were found already shipped
   there, independently.

4. **The structural fact converged too.** `personas-web`'s lint script is
   `"lint": "eslint"` — no `--max-warnings` — run in CI (`ci.yml:27`), currently
   green with **21 outstanding warnings**; its git hooks run i18n checks and **no
   ESLint at all**. Identical shape to this repo at 1/54th the scale. Two repos
   independently built a bespoke rule set and independently forgot to give it a
   gate. That is physics, and it is the single most portable claim in this
   document.

5. **"Rules ship untested" is the norm; this repo is ahead.** `personas-web`:
   **0 of 5** rules have any `RuleTester` case (verified with a control search
   that *did* match inside `node_modules`, so the negative is real). Here: 12 of
   21. Neither repo has a **shared helper module** in its rules directory — both
   duplicate string-scanning logic across rules at differing depths (§7 F). **A
   clause with no trace anywhere else should be suspected of local calibration;
   "extract a shared className/string extractor" has no field precedent in either
   sibling**, so §7 F is filed as a house convention, not doctrine.

## Prefer a type over a gate — answered explicitly

**Yes for the deviations, no for the leaf itself.** Both halves are load-bearing.

**Where a type ends the situation — do this instead of writing the rule:**

- **`no-hardcoded-jsx-text`'s attribute half (§7 D) should not be a lint rule at
  all.** The condition "this accessible name is not translated" is decidable at
  the type level and undecidable at the string level (§8 gap 4). A
  `TranslatedString` branded type returned by the `t` proxy, with
  `aria-label`/`title`/`placeholder` on the repo's own primitives typed to accept
  only it, makes `aria-label="Close"` a **compile error** — and covers all 3,134
  sites, literal and expression alike, instead of the 166 the rule can reach.
  The rule then guards only raw DOM elements.
- **`prefer-numeric` (§7 E)** is the contract's own example of a gate pointing at
  a broken destination. The fix that mattered was making `<Numeric>`'s locale
  correct by default — one edit at the primitive corrected ~212 call sites; no
  ratchet moved one.
- **`no-whole-store-subscription`** disappears if the store's exported hook type
  requires a selector argument. `useAgentStore()` with no argument becomes a type
  error, and the aliased-import escape (§9 B, missed) closes with it.
- **`prefer-section-card` / `prefer-status-badge`** are hunting for hand-rolled
  copies of a primitive. Both report ≤3. The durable fix is the primitive being
  easier than the copy, not a rule counting copies — and `FacetedDecisionTable`'s
  required `emptyTitle` (3/3 real copy vs 5-of-20 fallthrough among its
  optional-prop siblings) is the precedent.

**Where no type is available — and this is the leaf's own answer.** "This rule
has a fixture", "this rule does not decide scope from raw text" are properties
**of the rule module**, and a `.cjs` ESLint rule has no type system to make them
unrepresentable. `meta.schema` types the rule's *options*, not its rigour. The
closest available move is the one §9 B proposes: make the fixture a **structural
requirement enforced by a test that fails when it is absent** — which is the
weaker, test-shaped cousin of unrepresentability, and the best this layer offers.

**So the honest ordering for this leaf:** try the type (it removes several of
these rules entirely) → if no type, write the rule *with its adversary* → gate
the adversary's existence with a test → ratchet the residue with the census →
and never, at any point, argue severity from volume.
