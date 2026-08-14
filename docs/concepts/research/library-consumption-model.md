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

## The honest limit

Nothing here demonstrates that a golden path *authored in personas* improved
politicas. One principle was adopted, and adopting it surfaced a place where
politicas was already ahead. The transfer that has actually been demonstrated is
of **method** — the census mechanism, the ledger, the discipline of measuring a
population before gating it — not of content. Whether the 45 written paths help a
repo that did not author them remains untested, and the next run should adopt a
principle politicas has *not* already solved before claiming otherwise.
