# How a workspace project checks itself against the knowledge library

> Run 2026-08-14 against `politicas` (Next.js 16, 905 TS/TSX files, 706 in product
> roots). The question: *how does a repo that is not the library's home naturally
> check its implementation against the library, once per CLI session, and improve
> on it?* Two convergence studies plus a working port. Both studies are cited from
> `convergence-politicas-errors-a11y.md` and `convergence-politicas-design-display.md`.

## The finding that governs everything else

**You cannot use your consumers as your oracle.**

The convergence oracle — *a clause another codebase reinvented independently is
physics; a clause with no trace elsewhere is local calibration* — has inverted
the conclusion of twelve golden-path briefs and is the most valuable instrument
this corpus has. It requires exactly one thing to be true: **independence**.

`politicas` is not independent. Its own source says so:

| Evidence | Where |
| --- | --- |
| `* ESLint rule: role-button-requires-keydown (ported from personas)` | rule line 2 |
| `* ESLint rule: no-silent-catch (ported from personas)` | rule line 2 |
| `* ESLint rule: enforce-reduced-motion-fallback (ported from personas)` | rule line 2 |
| `# Lefthook git hooks (vzor: personas/lefthook.yml).` | `lefthook.yml:1` |
| `"source": {"repo":"personas","commit":"f9e3a33fd"}` | `scripts/census/PROVENANCE.json` |

Measured code-only containment against a control pair of unrelated rules:

| Pair | containment | verdict |
| --- | ---: | --- |
| `role-button-requires-keydown` | **87%** | inherited |
| `no-silent-catch` | **71%** | inherited |
| `enforce-reduced-motion-fallback` | **67%** | inherited |
| *control floor, unrelated rules* | 33–54% | — |
| `no-silent-null-catch` | **50%** | **inside the control band — genuinely original** |

All three inherited rules landed in politicas' **initial commit** (2026-07-23),
two to three months after personas authored them. **Zero PHYSICS verdicts are
available from this pair** on any clause they share.

Worse, and this is the part that generalises: **copying propagates defects as
faithfully as it propagates wisdom.** Politicas inherited personas'
`--quiet` pre-commit hook, which suppresses warnings before they can be counted.
It inherited the `attrObject()` recall bug in the motion rule verbatim — the same
documented six misses. The blind spot travelled with the template, and nothing in
either repo noticed, because a copied gate looks exactly like an agreed one.

**Corollary for the library:** the last thing a knowledge library should do is
hand a consuming repo a rule to paste in. That produces agreement without
evidence, and the consumer's green build then *looks* like independent
confirmation. The oracle must be fed by repos that have never read the library —
here that means `brainiac` and `personas-web`, not the workspace projects the
library is being rolled out to.

## What the experiment produced anyway

Independence is required for PHYSICS. It is **not** required for the other two
verdicts, and both paid:

**B-BETTER, confirmed under measurement (2 of 5 candidates survived):**

1. **`no-silent-null-catch` — politicas' own, and personas should adopt it.** Born
   from a real incident that "cost a day of diagnosis". Personas has **129
   doorless catches that return a degraded fallback**, visible to no rule it owns.
   Personas *reached the same conclusion by measurement* in
   `swallowed-error-telemetry.md` and did not build the gate; politicas built it.
   The reframing is what makes it buildable: **"call the reporter before you
   return the fallback"**, not "never return a fallback".
2. **Scoped severity ratchet.** `warn` globally, `error` in a narrower scope, with
   the justifying inventory written into the config comment
   (`eslint.config.mjs:81-82` vs `:88-89`). Politicas' own invention; personas has
   no equivalent and its warn-level rules consequently enforce nothing.

**Three candidates I asserted and measurement destroyed:**

- *"Politicas' `.catch()` extension is better."* **Backwards — it is A-BETTER.**
  Personas' `async-catch-requires-helper` demands a *sanctioned helper*, strictly
  stronger than "non-empty". Cross-applying politicas' rule to personas found
  exactly **1** site, already adjudicated with a reasoned `eslint-disable`.
  Personas' `.catch()` door adoption is **99.5%** (824/828); politicas' is **33%**
  (3/9).
- *"Politicas' 1:1:1 rule:doc:test invariant."* The doc leg is **not enforced** —
  `run-all.mjs` asserts rules↔tests↔presets↔shims and never that a doc exists. Its
  8 docs are discipline, exactly as personas' 12 rule tests are discipline.
- *"Personas has zero tests for its custom rules."* False. `src/test/eslint-rules/customRules.test.ts`
  covers **12 of 21**. The true claim is that 9 are untested, `prefer-numeric`
  among them.

**The decisive cross-application.** Politicas' motion rule finds 4 sites in
personas where personas' finds 3 — and the extra one is a **false positive**
(`MonitorProjectColumns.tsx:74`, where `reducedMotion` is hoisted to the parent
and passed as a prop). The variant moves precision from 0/3 to **0/4**. Its
`error` severity guards **0** `repeat:` occurrences across politicas' product
surface, while personas has **28 in 25 files** — so adopting both the rule and its
severity would turn personas' CI red on three false positives and catch nothing.
**A rule's severity is not portable; it is a function of the local population.**

**Convergent blind spots, confirmed in both:** empty catches are extinct (0 and
0), while *non-empty doorless* catches run at **29.8%** (573/1,920) in personas and
**25.4%** (33/130) in politicas. The a11y rule reports 0 in both while **141**
clickable no-role elements sit in personas.

## What this means for the mechanism

The three-state ledger built this session (`politicas/scripts/census/`) is the
shape that survives the finding above, because it never asks a repo to inherit a
rule — it asks the repo to **adopt a principle and measure its own population**:

- **adopted** — a local rule enforces it, with a locally-measured baseline and
  floor. Drift fails `npm run check`.
- **declined** — reviewed and rejected *for this repo*, with a reason a later
  session can re-judge. Never nags again.
- **unreviewed** — a report, never a failure. A repo is not broken for having a
  principle nobody has considered yet.

Current state in politicas: **1 adopted · 7 declined · 37 unreviewed** of 45
vendored principles. The seven declines are the Tauri/Rust/cargo principles,
justified by zero `.rs` files. The database principles were deliberately **not**
declined — politicas has a `gen-migration.ts`, so they need real review.

Three design points earned the hard way:

1. **The engine ports; the content does not.** The census self-test passes
   **23/23** in politicas. But the schema required a `goldenPath` — a filesystem
   path into personas' corpus that cannot exist downstream. The first port failed
   on it. Fixed upstream (grounding is now `goldenPath` **or** `principle`) rather
   than forked, with a self-test asserting *both* directions.
2. **Adopting a principle means re-measuring it, not copying its rule.** Adopting
   `client-state-persistence` in politicas produced a grep/engine disagreement
   (20/10 vs 7/3) that resolved to **13 comment-only mentions** — and chasing that
   gap is what found politicas' better answer (below). A pasted rule would have
   found nothing.
3. **Vendor the catalogue, not the prose.** `library-index.json` carries ids,
   titles and recurrence — enough to enumerate what exists offline, with the
   principle text staying upstream where it can be corrected once.
4. **A ported gate brings a fixture corpus, and a fixture corpus IS a set of
   violations.** The census self-test hand-counts hits in `__fixtures__/tree/`,
   so those files contain deliberate defects — an undefined component, an
   unclosed tag. Dropping them into politicas broke **two** of that repo's own
   gates on contact: `eslint` (its only error) and `tsc --noEmit` (two errors).
   Neither was a problem with the host repo or with the port; it is that every
   gate in the host now sees a corpus authored to fail. **The port is not
   finished when the runner works — it is finished when the host's existing
   gates have been taught to ignore its fixtures.** Three separate exclusions
   were needed here (eslint `globalIgnores`, tsconfig `exclude`, and LF
   normalisation of the provenance hashes so a CRLF checkout does not read as
   drift).

## What the library owes, from this run

- **`design-token-usage.md`'s central claim is falsified.** Delivery format does
  not govern adoption: politicas' number-format token is *import-delivered* and
  sits at **99.9%**. In personas the variable was perfectly confounded — every
  import-delivered axis also had no gate that fires. Git history supplies the real
  driver: every personas axis at 94–99% got its rule in the **first six weeks**;
  every collapsed axis got one late or never; `prefer-numeric` arrived **day 121**.
  Politicas' colour rule was `"error"` in its initial commit. **Adoption is
  governed by whether a gate fires and how early it was wired.**
- **A live personas defect, invisible from inside personas.** `<Numeric>` binds
  locale through an *optional prop defaulting to `'en'`*. Of 197 value-driven call
  sites, **8** pass it — **189 (95.9%) render en-US separators in a 14-locale
  app**, seven of whose locales use a decimal comma. `formatCost`'s own comment
  instructs callers to pass `language`. `custom/prefer-numeric` verifies you
  *reached* the primitive and cannot verify you *configured* it: **a gate pointing
  at a broken destination**, a condition the corpus does not name. Politicas binds
  locale in the hook — there is no argument to forget.
- **Version-in-the-key.** `politicas/features/schranka/followCodec.ts:25` puts the
  schema version in the storage key (`politicas:schranka:v1`), so a shape change
  becomes a new key and stale data is never found. `client-state-persistence` only
  *warns* that a stored shape can drift from the code reading it — crashing exactly
  the users holding old data and never the developer. Version-in-the-key makes the
  class unrepresentable with no migration code. Adopt it into the principle.
- **Token-contract tests.** Politicas `readFileSync`s its CSS and recomputes WCAG
  contrast in a test. That closes `design-token-usage.md`'s own Gap 7.

## What happened when it met real work

The protocol was fixed before starting: run the session-start check as a session
would, do genuine work, and record whether the library fired, helped, misled, or
was ignored. It misled, twice, and that is the result.

**Observation 1 — the session-start check is generic.** It lists unreviewed
principles ranked by **personas' recurrence**, which is not politicas' recurrence,
and it has no idea what the session is about to touch. A session working on a
chart gets the same twelve lines as one working on the ingest pipeline. Ranking by
the library's own frequency is a proxy for "important here" that nothing supports.

**Observation 2 — the first adopted gate had 0% precision.** `raw-web-storage`
matched 5 code sites. Reading them:

| Site | What it actually does | Verdict |
| --- | --- | --- |
| `followCodec.ts:25` | schema version in the key | correct (and better than the principle) |
| `useSchranka.ts:32` | the designated accessor | correct |
| `GraphPage.tsx:55` | `isVariant()` type guard validates on read, falls back to `"mapa"` | **correct — validate-on-read** |
| `ReferendumPage.tsx:95` | tests existence only, never parses the value | **correct — no shape to drift** |

Three *different* correct answers to one principle, and the gate called two of them
violations. Repo-wide there are exactly **3 `getItem` sites** and **zero** that
parse storage outside the accessor. Had the gate been trusted, the "fix" would have
added version keys to two files that do not need them and could have broken the
existence-only check. **The library pointed at work that did not exist.**

**Observation 3 — the second gate also had 0% precision, and its failure is
structural.** A doorless-catch rule found 5 of 106 catch clauses. All three sampled
turned out to return the error *as a value* — `{status:'error', message}`,
`{ok:false, errors:[…]}` — or to store and rethrow after a retry loop.

That is not politicas being sloppy. **It is a Result-returning codebase**, where an
error is part of the return type rather than a side effect. `swallowed-error-telemetry`'s
central clause — *every caught error must reach a reporting door* — is calibrated to
a codebase where errors are side effects, and a caller can ignore an unreported side
effect in a way it cannot ignore a `Result`. **The clause is A-LOCAL and nobody
noticed, because personas has no Result-typed comparison to see it against.**

**The generalisable lesson, and it is about method rather than either repo:**

> Writing a census rule from a principle *before reading the code* produces ~0%
> precision. Twice in one hour, on two different principles, by someone who had
> just spent a day documenting that exact failure in other people's rules.

The corpus already knew this — nine composers refused to ship gates at 4%, 24% and
26% precision, and `stale-response-guard` refused when 245 of 246 sites were already
correct. What this run adds is that the failure is *sharpest* in a consuming repo,
because the principle arrives with the authority of having been measured somewhere
else. In its home repo a bad gate is caught by the population it was derived from;
in a consuming repo there is no such anchor.

**So the ledger grew a fourth state: `satisfied`.** The principle applies, this repo
already meets it, and the entry must carry the *mechanism*, the *evidence*, and a
`verifiedBy` command that reproduces the measurement — because "already fine" that
cannot be re-measured is indistinguishable from "nobody looked". It is explicitly a
snapshot, not a guarantee: nothing gates a regression, and the entry says so.

Final state: **0 adopted · 2 satisfied · 7 declined · 36 unreviewed**. Zero adopted
rules is the honest outcome — both principles reviewed on the merits were already
met, by mechanisms this repo invented. The census is not run when the registry is
empty, because the runner correctly treats an empty registry as structural failure.

**What the library was actually worth here** was not a gate. It was two verified
"you are already fine, and here is precisely how" results, and two upgrades
travelling the other way (version-in-the-key; Result-as-contract). For a consuming
repo that may be the normal case rather than a disappointment — a mature codebase
should mostly *pass*, and a library whose only output is new gates would be
measuring its own novelty rather than the repo's health.

## The one downward transfer, and what actually caused it

After two failed adoptions, one change did land in politicas from this direction —
but the mechanism was not the one the design predicts, and that distinction is the
point.

`lib/format.ts` is built around determinism. It hand-rolls thousands-grouping
(`groupDigits`, `groupedInt`) and states why: *"server and client can have
different ICU versions, which can vary the grouping separator byte-for-byte and
break hydration."* Four calls in `formatCompactCzk` used `toLocaleString("cs-CZ")`
and `toLocaleString("en-US")` anyway — the only survivors of the very API the
module was written to avoid, reintroducing exactly the hazard it documents.
`toLocaleString("cs-CZ")` emits the Czech separator as **U+00A0** on some ICU
versions and **U+202F** on others, so the module's own `czechInt` (pinned to
U+00A0, ČSN 01 6910) and `formatCompactCzk` could disagree byte-for-byte on the
same number, across 8 consumer sites.

Fixed by routing those four calls through the module's own `groupedInt` with the
separators its primitives already pin. Verified byte-for-byte against the old
output on this runtime for both locales including negatives — identical now, and
no longer ICU-dependent at all.

**What found it was not a golden path.** No principle in the library covers
hydration determinism. The convergence *comparison* surfaced the inconsistency,
and what made it legible as a defect was **the repo's own comment** — the file
states its rule, so the exception is visible without any external doctrine. What
the library contributed was pattern recognition: having just fixed an implicit-locale
defect in `<Numeric>` upstream is what made a hardcoded locale downstream read as a
defect rather than as a detail.

That is a real transfer mechanism and worth naming, because it is *not* the one
the ledger implements. The ledger transfers **enforcement**. This transferred
**attention** — and attention is what actually moved in every productive step of
this run: the `<Numeric>` defect was invisible from inside personas until politicas
showed a codebase that binds locale in the hook; the Result-vs-door distinction was
invisible until a Result-typed codebase sat next to a door-typed one. Nothing was
gated into existence. Things became *visible* by comparison.

**A caveat on the test that appeared to protect this.** `deriveRadar.test.ts:184`
asserts `expect(e.detailCs).toContain(formatCompactCzk(czk, "cs"))` — the function
compared against itself, which passes whatever it returns. It would not have caught
a separator change. The 30 green tests in `lib/civic/data.test.ts` pin the
primitives, not this function. Both were checked before relying on either, and the
real verification was a direct old-vs-new byte comparison.

## The honest limit

**No golden path authored in personas improved politicas.** That remains true at
the end of the run, and it is the result that should govern how much more of the
corpus gets written before the next check.

Three kinds of transfer were attempted; they did not fare equally.

| Transfer of | Attempted via | Outcome |
| --- | --- | --- |
| **Enforcement** | adopt a principle, write a local gate | **Failed twice.** Both gates 0% precision; both principles already satisfied by better local mechanisms. |
| **Method** | port the census engine, the ledger, measure-before-gating | **Succeeded.** Self-test 23/23 in a foreign stack; the ledger is what made the two failures legible instead of shipping them. |
| **Attention** | put two codebases side by side | **Succeeded, and did all the real work.** |

That third row is the finding this run actually earned. Every productive step came
from *comparison*, not from doctrine: `<Numeric>`'s locale defect was invisible from
inside personas until politicas showed a codebase binding locale in the hook; the
Result-vs-door distinction was invisible until a Result-typed codebase sat beside a
door-typed one; `format.ts`'s four stray `toLocaleString` calls became a defect only
because that file states its own rule. **Nothing was gated into existence. Things
became visible by being placed next to something different.**

Which is uncomfortable for the corpus's premise, because attention does not
obviously need 247 written paths — it needs two codebases and someone measuring.
The next run should test the one thing still untested: adopt a principle politicas
has **not** already solved, and see whether the *written path* — rather than the
comparison — is what closes it. Until that is shown, the honest claim for the
library is that it is an excellent instrument for *seeing*, and an unproven one for
*telling*.
