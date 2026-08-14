# Convergence study — `politicas` vs the error-handling / accessibility golden paths

> Bidirectional comparison run 2026-08-14. **Repo A** = `personas` (this repo, HEAD `f9e3a33fd`).
> **Repo B** = `politicas` (`C:/Users/mkdol/dolla/politicas`, HEAD `8c25d35`).
> Scope: the error-handling and a11y overlap — repo B's `no-silent-catch`, `no-silent-null-catch`,
> `role-button-requires-keydown`, `enforce-reduced-motion-fallback` against
> [`swallowed-error-telemetry.md`](../golden-paths/swallowed-error-telemetry.md),
> [`focus-management.md`](../golden-paths/focus-management.md),
> [`button.md`](../golden-paths/button.md) and
> [`motion-and-reduced-motion.md`](../golden-paths/motion-and-reduced-motion.md).
>
> **Method.** Full `npx eslint --format json` over both repos (938 and 4,829 files). A
> TypeScript-compiler-API catch-site census over both product surfaces (same script, same door
> regex, run twice). A **cross-application experiment**: each repo's rule module loaded into an
> isolated flat config and run over the *other* repo's source. An **ablation** separating the two
> changes repo B bundled into `enforce-reduced-motion-fallback`. A **line-overlap measurement with a
> control pair** for every rule in scope. `git log --diff-filter=A` dating in both repos. Every
> flagged site was opened and read before being counted as a true or false positive.
>
> Repo A's own figures were re-measured, not quoted: the golden path's `1,920` try/catch and `832`
> `.catch()` reproduced **exactly**, and its `0 errors / 1,135 warnings / 246 of 4,829 files` lint
> baseline reproduced exactly. **Read-only in both repos.**
>
> **Line-number pinning.** All repo-B citations are against HEAD `8c25d35` as it stood when measured.
> A parallel session edited `eslint.config.mjs` during this study, inserting a 7-line
> `scripts/census/__fixtures__/**` ignore block at `:35`; **every `eslint.config.mjs` citation below
> at `:61` or later is +7 in the current working tree**. The rule files themselves were not touched.
>
> **Repo B lint baseline as measured: 1 error, 12 warnings, 4 of 938 files.** The single error was
> `react/jsx-no-undef` in `scripts/census/__fixtures__/tree/hits.tsx` — an *untracked* file from the
> in-flight port of this repo's census runner, not repo B's product code, and a corpus of deliberate
> violations at that. The parallel session's ignore block resolved it mid-run. Repo B's committed
> product baseline is **0 errors / 12 warnings**, all 12 `custom/require-source-citation` at `warn`.
> **All four rules in this study report 0 findings in repo B**; §2 establishes which of those zeroes
> are extinct conditions and which are empty populations.

---

## 0. Corrections to the brief — read these first

### 0.1 The premise "independently developed, no shared code" is false for three of the four rules

I reached this before the coordinator's mid-run correction arrived, from a stronger source than
line-similarity: **the rules say so themselves.**

```
packages/eslint-plugin-civic-transparency/rules/no-silent-catch.cjs:2
 * ESLint rule: no-silent-catch (ported from personas)

packages/eslint-plugin-civic-transparency/rules/role-button-requires-keydown.cjs:2
 * ESLint rule: role-button-requires-keydown (ported from personas)

packages/eslint-plugin-civic-transparency/rules/enforce-reduced-motion-fallback.cjs:2
 * ESLint rule: enforce-reduced-motion-fallback (ported from personas)
```

Git dating closes it. All three arrived in repo B's **initial commit**, `8843635` (2026-07-23) —
two to three months *after* they were authored here:

| Rule | Added in repo A | Added in repo B |
|---|---|---|
| `no-silent-catch` | `c30907b02` **2026-05-01** ("explorer: add custom/no-silent-catch ESLint rule") | `8843635` **2026-07-23** (initial commit) |
| `role-button-requires-keydown` | `1ce612bf7` **2026-05-08** | `8843635` **2026-07-23** (initial commit) |
| `enforce-reduced-motion-fallback` | `adf77499d` **2026-05-24** | `8843635` **2026-07-23** (initial commit) |
| `no-silent-null-catch` | *(no counterpart)* | `cd80b51` **2026-07-26** ("feat(architect): lint rule no-silent-null-catch guards the loader boundary") |

A rule cannot independently converge if it appears fully formed in a repository's first commit,
months after its twin exists elsewhere, carrying a docstring naming that twin.

**Line-overlap, measured with a control.** Quote-normalised, whitespace-collapsed, comment-only
lines dropped; *containment* = shared lines ÷ lines in the smaller file, which is the honest
"was this copied" measure. `code only` strips the leading docstring so prose rewrites don't mask
copied logic.

| Pair | full file | code only | Jaccard (code) |
|---|---:|---:|---:|
| `role-button-requires-keydown` A↔B | **84%** | **87%** | 72% |
| `enforce-reduced-motion-fallback` A↔B | **63%** | **67%** | 50% |
| `no-silent-catch` A↔B | 45% | **71%** | 44% |
| *control:* A `no-silent-catch` ↔ B `no-hardcoded-colors` | 30% | 50% | 24% |
| *control:* A `prefer-numeric` ↔ B `no-raw-number-display` | 27% | 33% | 19% |
| *control:* A `no-silent-catch` ↔ A `no-loose-event-payload` | 35% | 54% | 27% |
| **B `no-silent-null-catch` ↔ A `no-silent-catch`** | **33%** | **50%** | **27%** |

The control floor — the shared ESLint module skeleton (`module.exports = {`, `meta:`, `schema: [],`,
`create(context) {`) — sits at 27–35% full-file and 33–54% code-only. The three ported rules sit
far above it. **`no-silent-null-catch` sits *inside* the control band on every measure**, which is
the numeric form of "repo B wrote this one itself".

> My percentages run higher than the 70/59/40 quoted in the coordinator's correction because I
> normalise quotes before comparing (repo B reformatted `'` → `"` wholesale) and I report
> containment rather than symmetric overlap. Both methods rank the three rules identically and both
> place all three far above the control. Use whichever, but state the method.

**Consequence: there is no PHYSICS verdict available in this scope.** The one rule that could have
supplied it (`no-silent-catch`, which the brief offered as already-established physics) is a port.
Physics requires independent rediscovery; this is transmission. I have labelled these **INHERITED**
throughout and no row in the table below claims physics.

**What survives untouched.** B-BETTER and CONVERGENT BLIND SPOT need no independence — "repo B does
this better" and "both are blind to this" are true whether the code was copied or not. A blind spot
propagated by copying is arguably *more* urgent, because it now has two hosts. Those are the rows
that carry this document.

### 0.2 "Repo A has zero rule tests" is false

`src/test/eslint-rules/customRules.test.ts` exists (10,822 bytes) and drives `RuleTester` over
**12 of repo A's 21 rules**, including `no-silent-catch` and `async-catch-requires-helper`. It runs
inside `npm run test`. The true claim is that **9 rules are untested** — and, sharply for this
study, **both a11y rules in scope are among the 9**: `role-button-requires-keydown` and
`enforce-reduced-motion-fallback` have no test in repo A and a passing RuleTester suite in repo B.

### 0.3 "Precision 0/3, recall 0/3" belongs to a rule, not to a test

The brief attached this to repo A's rule *testing*. It is actually
[`motion-and-reduced-motion.md:365`](../golden-paths/motion-and-reduced-motion.md)'s measurement of
`custom/enforce-reduced-motion-fallback` itself: **"3 findings, 0 true positives, 6 misses"**. I
reproduced the 3 findings exactly and confirmed all three are false positives. (That doc states the
miss count as **6** at `:365` and as **5** at `:511-512` — an internal inconsistency that should be
resolved before either number is cited again.)

### 0.4 File counts

Repo B is **900 tracked `.ts`/`.tsx`** (`git ls-files`), **706** in the product roots
(`app`/`features`/`lib`/`components`). Not 2,281. My own first count of 1,694 was also wrong — it
swept `.claude/worktrees/`, which holds four live checkouts of the same repo. Repo B's product
surface is roughly **6.8× smaller** than repo A's, and every ratio below is stated with that in mind.

---

## 1. Verdict table

Labels: **INHERITED** = repo B copied it from repo A (physics unavailable) · **B-BETTER** = repo B
does it better and the library should adopt · **A-BETTER** = the reverse · **CONVERGENT BLIND SPOT**
= both miss it · **A-LOCAL** = repo A calibration, should be marked as such, not prescribed ·
**NOT B-BETTER** = a brief candidate that measurement refuted.

| # | Clause / situation | Verdict | Backing measurement |
|---|---|---|---|
| **E1** | An empty `catch {}` deserves a machine gate | **INHERITED** | Docstring "(ported from personas)"; repo B initial commit 2026-07-23 vs repo A 2026-05-01; 71% code containment vs 33–54% control |
| **E2** | The empty-catch gate must also visit `.catch(() => {})` | **A-BETTER** (brief said B-BETTER) | Repo A's `async-catch-requires-helper` requires a *sanctioned helper*, strictly stronger than "non-empty". B's extension found exactly **1** site in repo A — `tauriInvoke.ts:509` — which repo A already adjudicated with a reasoned `eslint-disable`. Repo B has **3 doorless `.catch()` sites** its own rules cannot see |
| **E3** | `catch { return null }` — degradation with no trace — needs its **own** gate | **B-BETTER (strongest row)** | `no-silent-null-catch` is repo-B-original (33%/50% vs control's 33%/54% — indistinguishable). Repo A has **129** doorless catches returning `null`/`[]`/`{}`/`false`/`undefined`, in **0** rules' sight |
| **E4** | That degradation gate must also visit `.catch()` handlers | **CONVERGENT BLIND SPOT** | B's rule has only a `CatchClause` visitor (`no-silent-null-catch.cjs:47`). Its own `features/schranka/useNews.ts:41` is `.catch((): null => { … return null })` with a comment and no trace — the exact shape the rule exists to stop |
| **E5** | A **non-empty** catch that reaches no telemetry door | **CONVERGENT BLIND SPOT** | Empty catches are **extinct in both** (0 and 0). Doorless non-empty: repo A **573/1,920 = 29.8%**, repo B **33/130 = 25.4%**. Neither repo's rules see any of them |
| **E6** | `silentCatch`/`toastCatch` curried-helper form | **A-LOCAL** | Repo B routes to `Sentry.captureException` / `reportLoaderFailure` directly. Already marked local calibration in `swallowed-error-telemetry.md`; this study corroborates rather than extends |
| **A1** | `role="button"` + `onClick` requires `onKeyDown` | **INHERITED** | 87% code containment, 72% Jaccard — the highest pair in the study; logic is character-identical modulo quote style |
| **A2** | …but the rule never checks `tabIndex`, and is blind to clickables with **no** `role` | **CONVERGENT BLIND SPOT (inherited verbatim)** | Both rules report **0**. Repo A: **141** host elements with `onClick`, no `role`, no key handler (repo A's own stricter proxy: **38**, precision 37/38, `focus-management.md:423-426`). Repo B: **2** (`StateGraphCanvas.tsx:175`, `MobileNav.tsx:75`) |
| **A3** | Repo B's `error` severity on this rule is a meaningful ratchet | **NOT B-BETTER** | Repo B's guarded population is **1** `role="button"`+`onKeyDown` site. Repo A's is **26**. Same severity in both (`eslint.config.js:106` / `eslint.config.mjs:63`) — no delta to adopt |
| **M1** | Looping framer animation on a non-positional property needs a gate | **INHERITED, then diverged** | 67% code containment; repo B rewrote the docstring and two mechanics |
| **M2** | Component-scoped fallback detection beats file-scoped | **NOT B-BETTER — measured *worse*** | Cross-applied to repo A, B's rule finds **4** vs A's **3**. The one extra — `MonitorProjectColumns.tsx:74` — is a **false positive** I opened and verified: `reducedMotion` is hoisted to `MonitorProjectColumnsImpl` (`:96`) and passed into `AttentionRow` (`:45`) as a prop, and the element is gated `running && !reducedMotion`. B's variant takes the rule from precision 0/3 to **0/4** |
| **M3** | Real `Identifier` matching beats `fileText.includes()` | **NEUTRAL (adopt if free)** | Ablation isolating this axis alone: **zero** delta over 3,386 repo-A files. Theoretically correct hardening, no measured effect. Do not claim it finds anything |
| **M4** | `attrObject()` returns `null` for any non-`ObjectExpression` `transition=` | **CONVERGENT BLIND SPOT (inherited verbatim)** | The **6 misses** at `motion-and-reduced-motion.md:365`. Repo B copied `attrObject` unchanged — it does not appear in the A↔B diff at all. Repo B fixed the scoping and left the recall bug |
| **M5** | Escalate the motion rule from `warn` to `error` | **B-BETTER in principle, NON-TRANSFERABLE as-is** | Repo B has **0** occurrences of `repeat:` in its entire product surface. Its `error` guards an empty set and can never fire. Repo A has **28 in 25 files**. Adopting the severity today would turn CI red on **3 false positives** |
| **G1** | Every rule has a doc **and** a test | **B-BETTER** | Repo B: 8 rules / 8 `docs/rules/*.md` / 8 RuleTester suites, all passing. Repo A: 21 rules / **0** rule docs / **12** tested. No `docs/rules/`, no `eslint-rules/README.md` |
| **G2** | The rule suite is wired into the repo's own check gate | **B-BETTER** | `check = typecheck && lint && test && test:rules`; `test:rules` is a zero-dependency `node run-all.mjs`. Repo A's rule tests ride inside a 2,400-test Vitest run with no named gate |
| **G3** | The rule↔shim↔preset wiring is machine-asserted | **B-BETTER** | `run-all.mjs:42-62` asserts all 8 rules exported, each has `meta.docs.description`, both presets resolve; `:67-79` asserts `eslint-rules/*.cjs === plugin.rules` so shims cannot drift |
| **G4** | …but the doc leg of "1:1:1" is *not* machine-asserted | **NOT B-BETTER (brief overstated)** | Nothing in `run-all.mjs` checks that `docs/rules/<name>.md` exists. Docs are convention in repo B too — better-populated, equally ungated |
| **G5** | Scoped ratchet: `warn` broadly, `error` on the clean subset | **B-BETTER** | `eslint.config.mjs:78-91` — `require-source-citation` + `no-raw-number-display` at `warn` over `features/**`+`app/**`, re-declared `error` over `app/**` alone, with the inventory that justified it written into the comment (`:72-77`). Repo A has no scoped severity anywhere |
| **G6** | `--quiet` in the pre-commit hook silently voids every `warn` rule | **CONVERGENT BLIND SPOT (inherited)** | Both hooks run `npx eslint --quiet …`. Repo B's `lefthook.yml:1` names its source: *"vzor: personas/lefthook.yml"*. Neither `npm run check` passes `--max-warnings`. A warn-level rule enforces nothing at either gate in either repo |

---

## 2. Evidence

### E1 · The empty-catch gate is inherited, and the condition is extinct in both

Both rules test `CatchClause` → `node.body.type === "BlockStatement"` → `node.body.body.length === 0`.
That is not convergence; repo B's file says "ported from personas" on line 2 and landed in the repo's
first commit. See §0.1.

The interesting part is that it **worked, in both**. My census found **0** empty catch blocks in repo
A's 3,386 production files and **0** in repo B's 516. Repo A's full ESLint run: `custom/no-silent-catch`
**0 findings** at `error`. Repo B's: **0 findings** at `error`. Two repos, one transplanted rule, the
same extinct condition. That is a genuine, if unglamorous, win for the mechanism — and it is the
strongest evidence in this study that *transplanting a rule transplants its effect*.

### E2 · Repo A's `.catch()` coverage is stronger than repo B's — the brief had this backwards

The brief's first B-BETTER candidate was that repo B's `no-silent-catch` also visits
`.catch(() => {})` (`no-silent-catch.cjs:46-65`) where repo A's does not. It does. But repo A does
not have a gap there — it has a **different and stricter rule** covering the same ground.

`eslint-rules/async-catch-requires-helper.cjs` requires a `.catch()` handler to *be* one of
`silentCatch` / `toastCatch` / `silentCatchNull`, or to invoke one as a top-level statement. An
empty arrow is definitionally not a sanctioned helper, so repo A's rule **already flags everything
repo B's extension flags, plus every non-empty handler that merely logs**. Repo B has no equivalent.

Cross-applying repo B's rule to repo A's source returned exactly one site:

```
src/lib/tauriInvoke.ts:509
    // eslint-disable-next-line custom/async-catch-requires-helper -- deliberately inert:
    // `invocation`'s rejection is the real error and is already observed (logged/breadcrumbed)
    // via the Promise.race branch below. Adding a helper here would double-report every single
    // failed invoke across the whole app.
    .catch(() => {/* rejection handled by Promise.race */});
```

This is not an uncovered site. It is a site repo A's stronger rule *did* flag, that a human
adjudicated, and that carries a written reason. Repo B's rule would re-report it under a second id.

The adoption measurement backs the ordering: repo A's `.catch()` sites reach a door **824 / 828 =
99.5%**; repo B's reach one **3 / 9 = 33.3%**. The three doorless ones are
`features/schranka/useNews.ts:41`, `lib/db/pglite/internals.ts:52` and `lib/db/store.ts:297` — the
last two are cache-invalidation handlers of exactly the `tauriInvoke.ts:509` shape, and repo B has
no rule that asks them the question.

**Verdict: A-BETTER.** Nothing to adopt; the row is here because the brief named it a top-three
B-BETTER candidate and it is the opposite.

### E3 · `no-silent-null-catch` — the strongest B-BETTER in the study

This is repo B's own invention, and it is the one clean independent datapoint in scope. Overlap with
its nearest repo-A analogue is 33% / 50% — **inside the control band**. It was added `cd80b51`
(2026-07-26) by repo B's own `/architect` run, three days after repo init, and its docstring names
the incident that motivated it:

```
no-silent-null-catch.cjs:5-11
 * That rule only flags EMPTY catch blocks; the loaders' actual failure shape is
 * `catch { return null; }` (or `return []`), which passes it while still swallowing every
 * trace of the failure — the surface silently degrades to mock/empty and a dead store becomes
 * indistinguishable from an empty graph (this class of bug cost a day of diagnosis on 2026-07-25)
```

It also carries a hardening repo A should copy verbatim in spirit. Commit `6145e52` — *"no-silent-null-catch
can no longer be defeated by an extra statement"* — replaced a `body.length === 1` shape check with
a scan of every statement, because gating on a single-statement shape was bypassed by prepending any
no-op (`:49-53`).

**The population this covers in repo A is 129 sites** — non-empty catches that reach no door *and*
return a degraded fallback. 122 of the 129 are bindingless `catch {`, and only 18 carry any comment
at all. Sample:

```
src/api/liveRoadmap.ts:90            fn=fetchLiveRoadmap   catch { return null; }
src/api/pipeline/teamLearning.ts:50  fn=parseOutcomeSteps  catch { return []; }
src/features/overview/sub_incidents/components/IncidentsInbox.tsx:103   catch { return null; }
src/features/plugins/artist/sub_media_studio/CompositionPreview.tsx:85  catch { return null; }
```

This is precisely the shape `swallowed-error-telemetry.md` names its "single most damaging" —
*"A failure that renders as an empty state … indistinguishable from success on both channels"* — and
which that path explicitly declines to gate, on the reasoning that a call-site rule would mis-fire on
legitimate parse fallbacks. Repo B's rule shows the gate is constructible: it demands not "never
return null" but "**call the reporter before you do**", which the legitimate parse fallbacks can
satisfy as easily as the illegitimate ones. That is the design move worth importing.

**Disproof attempted.** 52 of the 129 sit in functions named `parse*`/`decode*`/`read*`/`safe*`/`try*` —
the documented-fallback shape (`parseJson.ts`) the path deliberately exempts. So the honest uncovered
population is bounded below by ~77 and above by 129, not a clean 129. The rule as repo B wrote it
would flag all 129; tuned to repo A it needs the same escape hatch repo B gives it.

### E4 · Repo B fixed one visitor and not the other — a blind spot of its own making

Repo B extended `no-silent-catch` to `.catch()` (`0bf9e9b`, 2026-07-26) and did **not** extend
`no-silent-null-catch` the same way. Its only visitor is `CatchClause` (`:47`). The consequence is
live in its own tree:

```
features/schranka/useNews.ts:41
    .catch((): null => {
      // Síť/parse selhaly → null; odběratel kreslí čestný stav, cache
      // neúspěch nedrží (příští dotaz to zkusí znovu).
      cache.delete(query);
      return null;
    });
```

Network or parse failure → `null`, a justifying comment, and no trace. It is the rule's target shape
written in the one syntax the rule does not visit — and the comment-instead-of-a-record pattern that
repo B's *other* rule doc explicitly rejects (`docs/rules/no-silent-catch.md:8-11`).

### E5 · The non-empty doorless catch — confirmed convergent, at similar rates

Same script, same door regex (`Sentry.*` · `captureException` · `console.error|warn|log` ·
`silentCatch`/`toastCatch`/`reportError`/`recordSwallow` · `reportLoaderFailure` · `logger.*` ·
`addToast`/`toast.*`), run over both product surfaces:

| | repo A (`personas`) | repo B (`politicas`) |
|---|---:|---:|
| production `.ts`/`.tsx` walked | 3,386 | 516 |
| `CatchClause` total | 1,920 | 130 |
| — empty body | **0** | **0** |
| — non-empty, **no door** | **573 (29.8%)** | **33 (25.4%)** |
| — non-empty, reaches a door | 1,347 (70.2%) | 97 (74.6%) |
| — bindingless `catch {` | 374 | 24 |
| files containing ≥1 doorless catch | 365 | 22 |
| of the doorless, return a degraded fallback | 129 | 8 |
| `.catch(handler)` total | 828 | 9 |
| — reaches a door | 824 (**99.5%**) | 3 (**33.3%**) |

Repo A's `1,920` and `828` reproduce the golden path's own figures exactly, which validates the
analyzer. My doorless count (573) is lower than the path's 795 / `CLAUDE.md`'s 760 because my door
regex is more generous — it counts a bare `console.warn` as a door, and it matches anywhere in the
block rather than at statement level. **Read 573 as a floor and 795 as a ceiling on the same
population**; the conclusion does not turn on which.

The convergence is real and the rates are close: **roughly one in four non-empty catches in each
repo reaches no telemetry door**, and *no rule in either repo visits a non-empty catch body at all*.
Both `no-silent-catch` implementations return early unless the body has zero statements; repo B's
`no-silent-null-catch` narrows further to a `null`/`[]` return inside a 42-file scope. The gate
difference between the two syntaxes remains the sharpest finding: repo A's `.catch()` sits at 99.5%
adoption against try/catch's ~70%, and the only structural difference is that a rule visits one and
not the other.

### A1–A3 · The a11y rule is a byte-level port, and both copies are blind to the same larger population

`role-button-requires-keydown` is the most copied pair in the study (87% code containment). The two
files differ in quote style and brace placement; `getElementName`, `getAttribute`,
`getStaticStringValue` and the four-guard `JSXOpeningElement` body are the same code. Cross-applied
both directions, both rules report **0** on both repos.

Zero findings at `error` reads as "extinct condition" — and `focus-management.md:555-562` already
established that it is not. Gap 7 records that the rule *"checks the wrong half"*: it never checks
`tabIndex`, so it passes on a control that cannot be focused at all (`DragHandle.tsx:42`), and it
*"cannot see the far larger population that carries no `role` at all"*.

I measured that population in both repos with one script. Buckets every JSX element carrying
`onClick`; `motion.button`/`m.a` are resolved to their base tag (an early version of my script
miscounted 29 `motion.button` elements as defects — corrected before any number below was quoted):

| | repo A | repo B |
|---|---:|---:|
| `.tsx` files | 1,989 | 217 |
| real `<button>` / interactive host / `*Button` component | 3,558 | 101 |
| `role="button"` **with** `onKeyDown` (rule satisfied) | 26 | 1 |
| `role="button"` **without** `onKeyDown` — **what the rule sees** | **0** | **0** |
| host element, no `role`, no key handler — **what the rule cannot see** | **141** | **2** |
| host element, no `role`, has a key handler | 8 | 1 |

Repo A's own stricter proxy for this class (adding `cursor-pointer` and a `tabIndex` check) is **38
elements across 32 files at precision 37/38** (`focus-management.md:423-426`); my 141 is a
deliberately broader, cross-repo-comparable superset. Either way the ratio to what the rule catches
is *n* : 0.

**The blind spot is inherited, not convergent-by-discovery** — it exists in repo B because the code
came from repo A. That distinction matters for the oracle: this row is *not* evidence that the blind
spot is intrinsic to the problem. It is evidence that a copied rule copies its gaps. Repo B did add
the one thing repo A lacks here — a RuleTester suite (`__tests__/role-button-requires-keydown.test.mjs`)
— but the suite tests the behaviour the rule has, so it locks the gap in rather than exposing it.

**A3.** The brief implied repo B's `error` severity is a ratchet worth importing. Both repos already
run this rule at `error` (`eslint.config.js:106` and `eslint.config.mjs:63`), and repo B's guards a
population of one. There is no delta.

### M1–M5 · The motion rule: repo B improved the packaging and regressed the logic

Repo B rewrote two things and left a third. The ablation separates them. Three variants over repo A's
`src/`, identical harness, only the named axis varying:

| Variant | Findings |
|---|---:|
| **V1** file scope + `fileText.includes()` — *repo A as shipped* | 8 |
| **V2** file scope + real `Identifier` match — *hybrid* | 8 |
| **V3** component scope + `Identifier` match — *repo B as shipped* | 9 |

- **V2 \ V1 = ∅** and **V1 \ V2 = ∅**. The substring→`Identifier` fix (**M3**) changes nothing across
  3,386 files. Repo B's comment justifies it by a hypothetical match inside `useReducedMotionValue`;
  no such collision exists in repo A. Correct hardening, zero yield — adopt if free, claim nothing.
- **V3 \ V2 = exactly one site**, `MonitorProjectColumns.tsx:74`.

*(The harness reports 8/8/9 where the real rules report 3/3/4: my probe checks only the immediately
preceding line for a `// reduced-motion-ok:` annotation, while the shipped rules scan a window, so 5
annotated sites — `PhaseIndicator.tsx:67`, `GlyphCoreContent.tsx:138`, `QuestionnaireHeaderBand.tsx:57`,
`ucClockVariant.tsx:113`, `ucPowerRail.tsx:45` — survive in all three variants. The **deltas** are
computed inside one consistent harness and are unaffected. The 3-vs-4 figure from the real modules is
the one quoted in the table.)*

**M2 — the one new finding is a false positive.** I opened it:

```
MonitorProjectColumns.tsx:45  function AttentionRow({ card, selected, reducedMotion, … })
MonitorProjectColumns.tsx:73    {(segs || running) && (running && !reducedMotion ? (
MonitorProjectColumns.tsx:74      <motion.span … transition={{ duration: 1.9, repeat: Infinity … }}>
MonitorProjectColumns.tsx:94  function MonitorProjectColumnsImpl({ … }) {
MonitorProjectColumns.tsx:96    const reducedMotion = useReducedMotion() ?? false;
MonitorProjectColumns.tsx:187                     reducedMotion={reducedMotion}
```

The hook is hoisted to the parent component and the boolean is passed down as a prop — the ordinary
React idiom — and the looping element is correctly gated behind it. Repo B's component-scoping keys
the fallback to the *outermost enclosing function*, so the hook call in `MonitorProjectColumnsImpl`
and the animation in `AttentionRow` land in different scopes and the rule fires.

So repo B's variant trades one real gap (a second component in the same file inheriting the first's
exemption) for one real false positive (a gate crossing a component boundary via props). On repo A's
corpus the trade is measurably negative: **precision 0/3 → 0/4**. This is the clearest case in the
study of a brief candidate that measurement refuted, and the reason the ablation was worth running —
the two changes were bundled in one commit and only one of them is defensible.

**M4 — repo B inherited the recall bug verbatim.** `motion-and-reduced-motion.md:365` records 6 sites
the rule cannot see because `attrObject()` returns `null` for any `transition=` that is not a literal
`ObjectExpression`. That helper does not appear in the A↔B diff at all — repo B copied it unchanged.
Repo B fixed the scoping (badly) and left the recall gap (entirely). Both copies miss the same 6 sites
for the same reason.

**M5 — the severity escalation does not transfer.** Repo B runs this rule at `error`
(`eslint.config.mjs:64`) and repo A at `warn` (`eslint.config.js:108`), and on the brief's framing
that is a straightforward ratchet to adopt. It is not, because repo B's rule guards nothing:

- `repeat:` occurrences in repo B's `app`/`features`/`lib`/`components`: **0**
- repo A's: **28 across 25 files** (`motion-and-reduced-motion.md:656-658`)

Repo B imports `framer-motion` in 36 files and renders `<motion.*>` in 30, references
`useReducedMotion` 67 times, and has a CSS blanket at `app/globals.css:62` — it gates motion
properly, and it simply never writes a looping animation. Its `error` severity is free because the
population is empty. Repo A escalating today would fail CI on three false positives while still
missing six real defects. **The severity is the last step, not the first.**

### G1–G6 · Rule governance — where repo B is genuinely ahead

Repo B's `npm run check` is `typecheck && lint && test && test:rules`, and `test:rules` is a
dependency-free `node packages/eslint-plugin-civic-transparency/__tests__/run-all.mjs`. I ran it:

```
PASS enforce-reduced-motion-fallback (RuleTester)      PASS no-silent-catch (RuleTester)
PASS no-hardcoded-colors (RuleTester)                  PASS no-silent-null-catch (RuleTester)
PASS no-raw-number-display (RuleTester)                PASS require-source-citation (RuleTester)
PASS no-server-import-in-client (RuleTester)           PASS role-button-requires-keydown (RuleTester)
PASS shim equivalence (eslint-rules/*.cjs === plugin.rules)
PASS run-all (8 suites + plugin surface checks)
```

Beyond the 8 suites, `run-all.mjs:42-62` asserts every rule is exported, every rule has a
`meta.docs.description`, and both presets resolve to real rules; `:67-79` asserts each thin shim in
`eslint-rules/` is the *same object* as the packaged rule, so the two trees cannot drift. Repo A has
no equivalent of any of it: 21 rules, 12 tested, no `docs/rules/`, no `eslint-rules/README.md`, and
the rule tests ride anonymously inside a 2,400-test Vitest run.

The per-rule docs are a real artifact, not a stub. `docs/rules/no-silent-catch.md` runs
Why / When it fires / **When it does not fire** / Escape hatches — and the third section is the one
repo A has nowhere, the one that stops a reader from filing the next false-positive bug.

**G4 is where I have to disagree with the brief.** The "1:1:1 rule:doc:test invariant" is not an
invariant. `run-all.mjs` never checks that a doc exists; no rule declares `meta.docs.url`. Repo B
has 8 docs for 8 rules by discipline, exactly as repo A has 12 tests for 21 rules by discipline. The
*tests* are gated; the *docs* are not. Adopt the doc set because it is good, not because repo B
found a way to enforce it — it did not.

**G5, the scoped ratchet**, is real and is repo B's own invention (no repo-A analogue):

```
eslint.config.mjs:78-83   files: ["features/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"]
                            "custom/require-source-citation": "warn"
                            "custom/no-raw-number-display":   "warn"
eslint.config.mjs:85-91   files: ["app/**/*.{ts,tsx}"]
                            "custom/require-source-citation": "error"
                            "custom/no-raw-number-display":   "error"
```

with the justification measured and written into the comment above it (`:72-77`): *"Both ship at
`warn` while the existing-violation inventory burns down; `app/**` measured clean for BOTH rules
(2026-07-30 inventory: 29 warnings, all under features/**), so app routes are already at `error`."*
That is the missing move in repo A's rule-severity story — a way to make a rule *block* on the part
of the tree that is already clean, instead of waiting for the whole tree.

The same pattern appears at `eslint.config.mjs:120-125`, where `no-silent-null-catch` runs at `error`
over `features/**/get*.ts` + `features/**/*Loader.ts` — **42 files**. And it demonstrably ratcheted:
`:113-119` records that a temporary `features/graph/**` carve-out was removed on 2026-08-13 after it
was found hiding a real defect (`getNodeDetail`'s bare `catch { return null }`, which *"pinned an
empty `/graf` for the whole process lifetime"*).

**Disproof attempted, and it partly lands.** Unscoped, `no-silent-null-catch` finds **9** sites in
repo B — and **all 9 are outside its configured scope** (`app/opengraph-image.tsx:32`,
`lib/claims/claim.ts:115`, `lib/ingest/sources/pumper.ts:99,113`, `features/schranka/useSchranka.ts:33`,
`features/graph/permalink.ts:177`, …). In-scope it finds 0. The scope is a real limitation, not only
a virtue. Worse, inside the scope its value-shape whitelist is narrower than its own concept:
`features/admin/getAdminData.ts` is squarely in scope and contains doorless catches returning `{}`,
`base`, and `emptyProgress(…)` (`:203`, `:307`, `:608`, `:646`) — the same silent degradation in a
shape the rule's `null`/`[]` check does not match.

**G6.** Repo B's `lefthook.yml` runs `npx eslint --quiet --no-warn-ignored {staged_files}` and names
its origin on line 1: *"Lefthook git hooks (vzor: personas/lefthook.yml)"* — "vzor" is Czech for
"template". Repo A's is `npx eslint --quiet --no-warn-ignored --max-warnings 99999 {staged_files}`.
`--quiet` drops warnings before they can be counted, and neither repo's `npm run check` passes
`--max-warnings`. The doctrine in repo A's `CLAUDE.md` — *a warn-level rule enforces nothing at
either gate, by construction* — is now true in two repos because the hook was copied along with
everything else.

---

## 3. What the library must change

Only B-BETTER rows. Each with the concrete edit it implies.

**1 — Add a degradation gate: `catch → fallback` with no reporter. (E3, strongest item.)**
Port the *concept* of `no-silent-null-catch`, not the file. Add
`eslint-rules/no-silent-degradation.cjs` visiting `CatchClause`, reporting when the block contains a
return of a degraded value (`null`, `[]`, `{}`, `false`, `undefined` — repo B's whitelist is too
narrow; `getAdminData.ts:203` escapes its own rule) **and** no statement anywhere in the block calls
a sanctioned door (`silentCatch`, `toastCatch`, `silentCatchNull`, `reportError`). Copy repo B's
`6145e52` hardening: scan **every** statement, never gate on `body.length === 1`, or the rule is
defeated by prepending a no-op. Measured target population in `src/`: **129** sites, bounded below
by ~77 once the documented `parse*`/`decode*` fallbacks are exempted. Ship at `warn`, then use
item 3 to make it `error` where the tree is already clean.
This is the gate `swallowed-error-telemetry.md` declined to build; repo B's framing — *"call the
reporter before you return the fallback"*, not *"never return a fallback"* — is what makes it
buildable, and that reframing belongs in the path's §9.

**2 — Extend the degradation gate to `.catch()` in the same commit. (E4.)**
Repo B fixed one visitor and not the other, and its own `useNews.ts:41` is the cost. Add the
`CallExpression` visitor for `.catch(handler)` when the new rule lands, not afterwards. Repo A's
`.catch()` surface is 828 sites at 99.5% door adoption, so the marginal cost is near zero and the
regression protection is permanent.

**3 — Adopt the scoped-severity ratchet. (G5.)**
Repo A has no scoped severity anywhere; every custom rule is one global severity. Add narrowed
`error` blocks over subtrees measured clean, keeping `warn` globally — starting with
`custom/no-hardcoded-jsx-text` (226 warnings, but likely 0 in several feature subtrees) and the new
rule from item 1. Copy repo B's discipline of writing the inventory that justifies the scope into
the config comment (`eslint.config.mjs:72-77`), and its precedent of *removing* a carve-out once the
work behind it lands (`:113-119`). This is the concrete answer to "a warn-level rule enforces
nothing": make it enforce something *somewhere* today rather than everywhere someday.

**4 — Close the rule:test gap and name the gate. (G1, G2, G3.)**
Nine of repo A's 21 rules are untested, including both a11y rules in this study. Extend
`src/test/eslint-rules/customRules.test.ts` to all 21 — the file's own closing assertion already
counts registered rules (`:384`), so make it assert 21 and fail when a rule ships without a suite.
Add repo B's **shim/surface check** as a `check:rules` script wired into `npm run check`, so a rule
that loses its `meta.docs.description` or drops out of the registry fails a named gate instead of
disappearing into a 2,400-test run.

**5 — Adopt per-rule docs, with repo B's four-section shape. (G1, tempered by G4.)**
Create `docs/rules/<rule>.md` for all 21, following `docs/rules/no-silent-catch.md`:
Why / When it fires / **When it does not fire** / Escape hatches. The third section is the one that
prevents the next false-positive report. **Do not claim this as an enforced invariant** — repo B
does not enforce it either (§G4); it is discipline in both repos.

**6 — Fix `enforce-reduced-motion-fallback` in this order: recall, then precision, then severity.**
The brief's ordering was severity-first and that is backwards.
 a. Fix `attrObject()` (`:77-87`) to handle non-`ObjectExpression` `transition=` — recovers the
    **6 documented misses**, of which 4 are genuine WCAG 2.3.3 defects. Repo B did not fix this and
    has nothing to offer here.
 b. Fix the **3 existing false positives** before touching severity.
 c. **Do not adopt repo B's component-scoping as shipped** — measured, it takes precision from 0/3 to
    0/4 on repo A's corpus by mis-firing on the hoisted-hook-passed-as-prop idiom
    (`MonitorProjectColumns.tsx:45,74,96,187`). If component scoping is adopted at all, the fallback
    set must be seeded from **props named for the preference** as well as from hook call sites.
 d. Repo B's `Identifier`-over-substring change is free and harmless — take it, claim nothing
    (measured delta over 3,386 files: **0**).
 e. Only then consider `error`. Repo B's `error` is affordable because it guards **0** `repeat:`
    sites; repo A has **28**.

**7 — Record the corrections in the paths themselves.**
`swallowed-error-telemetry.md`'s convergence table marks "a lint rule bans the empty catch" as
**LOCAL CALIBRATION — zero reinventions in three repos**. That verdict survives this study and is
strengthened: repo B did not reinvent it either, it *received* it. The row should say so, because
"a fourth repo has this rule" would otherwise look like the physics evidence it is not.
`focus-management.md` Gap 7 should record that the same rule, transplanted to a 6.8×-smaller repo,
reproduced the same 0-findings-over-a-real-population result — a copied rule copies its blind spot.
And `motion-and-reduced-motion.md` should resolve its own 6-vs-5 miss-count inconsistency
(`:365` vs `:511-512`) before either figure is cited again.

---

## 4. What this study could not establish

**No PHYSICS verdict is available in this scope**, and that is the headline. The four rules the brief
selected as an independent-convergence test turned out to be three transplants and one repo-B
original. The transplants can still tell us that *a rule's effect travels* (E1: the empty-catch
condition is extinct in both) — but they cannot tell us that the clause is universal, because the
second data point was not independently generated.

The one clean signal, `no-silent-null-catch`, points somewhere specific: the repo that had no
contact with repo A's error-handling doctrine on this axis independently concluded that **the empty
catch is the wrong target** and that the real shape is the *fallback return with no report*. Repo A
reached the same conclusion by measurement (760/795 doorless bodies) and did not build the gate.
Repo B built it. That is one independent rediscovery of the *problem* and one existence proof for
the *solution*, which is the most this comparison can honestly supply — and it is enough to justify
item 1.
