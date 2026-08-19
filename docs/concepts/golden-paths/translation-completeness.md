# Golden path — Translation completeness

> Situation node: `ui-system/copy-and-vocabulary/translation-completeness` ·
> [situation spine](../situation-spine.md) · recurrence 9 · risk **high** ·
> sides: **client** · convergence: **mixed** ·
> dimensions: **function · ui · code-quality**
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`, walked twice by two independent
> implementations. `useTranslation.ts`, `routeSections.ts`, `tokenMaps.ts`, `CONTRACT.md`,
> `check-coverage.mjs`, `check-route-sections.mjs`, `chainStopReasons.parity.test.ts`,
> `lefthook.yml` and `main.tsx` read in full. All **61** catalog sections and all **13** non-English
> locale trees (**19,112** leaf keys each) parsed. **All 26 `status_tokens` categories diffed
> against their backend domains** — Rust enums, SQL `CHECK` lists and ts-rs bindings — with a
> live-writer trace for every arm found missing. Convergence oracle run against all five siblings
> — `personas-web`, `brainiac`, `personas-cloud`, `vibeman`, `ascent` — plus `politicas` and
> `pumper` as non-canonical secondaries.
>
> **Measured by execution, not by reading.** `check-coverage.mjs`, `check-untranslated.mjs` and
> `check-route-sections.mjs` were all run. The pre-commit hook's staging semantics were **proved
> with a throwaway git repository** in the scratchpad, not argued from the glob (§7 D6/D7). The
> census rule and its positive control were validated in a private scratch registry, and every
> failure mode was **induced** and its exit code captured (§9).
>
> **`cargo` was not run**; the Rust citations are static reads. **No locale file was edited, the
> translate pipeline was not run, and nothing was staged or committed.**
>
> **Extends, does not re-derive,
> [`i18n-string-authoring`](./i18n-string-authoring.md)** (recurrence 1,454). That path owns
> catalog **entry** — *is this string a key at all*. This path owns everything after: *does the key
> space cover the domain, and does the value reach the screen in the user's language*. The boundary
> is stated in §1.
>
> **Settles:** which absences this system can see, and which it renders as English while reporting
> success.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant. No file path, primitive name or count appears below this line
until the head ends.

> **P1 — physics, and the whole leaf.** A parity check between translation catalogs is a
> **symmetry** check. An absence punched identically through every catalog is symmetric, so it is
> invisible to that check *by construction* — not by oversight, and not fixable by making the check
> stricter. **A locale-vs-locale gate can never decide completeness; only a domain-vs-catalog gate
> can.**
>
> **P2 — physics.** The domain a label set must cover lives **outside** the catalog: a backend
> enum, a database constraint, a set of user-defined values. Completeness is therefore a
> cross-boundary property, and no instrument that reads only the catalog is entitled to an opinion
> about it.
>
> **P3 — physics.** Catalog completeness is not screen completeness. Between the catalog and the
> render there is a **delivery layer**, and it carries its own, separate completeness obligation. A
> string that is present, translated, and never fetched is indistinguishable at every gate from one
> that is present, translated and shown.
>
> **P4 — physics.** A fallback that substitutes one language for another is a display decision
> wearing the clothes of a safety net. It converts a *detectable* failure (a blank, a raw key, a
> throw) into an *undetectable* one, and it does so at the exact moment the evidence existed. The
> silence is the cost of the safety net, not a separate bug.
>
> **P5 — governance, the sharpest transferable clause.** A gate fires on an **event**, and the
> event that creates an incompleteness is frequently not the event the gate watches. A gate keyed
> to "the catalog changed" cannot see an incompleteness created by "the domain changed" — and the
> domain usually lives in another language, another directory, sometimes another process.
> **Ask what edit creates the defect, then check that the gate is attached to that edit.**
>
> **P6 — governance.** A checker that reads the working tree certifies the working tree. It does
> not certify the commit, and the two differ exactly when a stage is partial.
>
> **P7 — governance.** When a checker has a strict mode and a lax mode, the mode that runs by
> default is the only mode that exists. Every other mode is documentation.
>
> **P8 — ergonomics.** A type generated **from** the artifact it is meant to constrain cannot
> constrain that artifact. It will faithfully encode whatever is there, including the hole.
>
> **Scale condition.** P1, P2 and P4 pay from the second locale. P3 pays from the first
> code-split. P5–P7 pay immediately and cost nothing. P8 bites once the catalog is large enough
> that nobody reads it end to end.

### Warrant — what the oracle returned

**Four of the five canonical siblings have no localization mechanism at all, and this must be
reported as silence, not as leadership.** Opened, not inferred from manifests: `brainiac` records
English-only as an explicit launch decision (`mvp-passport.json:43`) and has zero i18n crates
across eight `Cargo.toml` files; `personas-cloud` returns **zero** matches for
`i18n|locale|translat` repo-wide; `vibeman`'s 38 matches are all `toLocaleString`; `ascent`'s single
code hit is a path literal copied from another repo's dev inspector, pointing at a directory it
does not have. For four of five siblings, **every clause here is untested.**

**The one canonical sibling that localizes reinvented both the doctrine and its failure mode.**
`personas-web` has no i18n library, and independently built a hand-rolled catalog for **the same
fourteen languages** (1,086 leaf strings each), a **silent per-key deep-merge over English**
(`personas-web/src/i18n/useTranslation.ts:46-48`), and a CI + pre-push completeness gate. On P4 that
is convergence: **physics.**

And then it produced **the same defect this document is about, in a different domain**. Its guide
has an **11-member** category domain (`src/data/guide/categories.ts:12-13`) against a **10-arm**
catalog (`src/i18n/en.ts:1021-1032`); the `companion` arm is absent from **all fourteen** locale
files; it renders as raw English in 13 languages at
`GuideCategoryGrid.tsx:89` (`{labels.categories[category.id] ?? category.name}`); and its coverage
gate prints **100%**.

**And so does the third. Every repo in the sweep that gates locale-vs-locale parity is carrying a
live enum-vs-catalog gap right now, and all three boards are green:**

| repo | domain | catalog | gap | what the user sees |
| --- | ---: | ---: | ---: | --- |
| **personas** | 6 (`dev_kpi_measurements` CHECK) | 5 | **1** | raw token `ai-compose` |
| **personas-web** | 11 (`guide/categories.ts:12-13`) | 10 | **1** | silent English in 13 languages |
| **politicas** | 17 (`KG_EDGE_RELS`, `lib/analysis/kg-verdict.ts:25-58`) | 13 | **4** | raw key `graph.rels.rapporteur` |

Three codebases, no shared code, three different stacks (hand-rolled proxy, hand-rolled module,
next-intl), three different domains, **same defect**. In every case the missing arms are absent
*identically* from every locale, which is why every parity gate reports success. **P1 is not this
repo's mistake — it is the shape of the problem, and it is now the most replicated finding in this
document.** The only thing that varies is the failure's costume: a machine token, the wrong
language, or a dotted key path.

**The asymmetry converged in shape and inverted in direction, which is the strongest evidence it
was never principled.** Both repos built an *asymmetric* completeness gate. This repo fails on
extra keys and only warns on missing ones (`scripts/i18n/check-coverage.mjs:8-22`).
`personas-web` does the exact opposite — missing keys hard-fail (`check-i18n-coverage.mjs:127`)
while extras are **structurally undetectable**, because `compareShape` iterates only
`Object.keys(expected)` (`:89`). Neither author chose an asymmetry; each gated the direction they
happened to think of. **Symmetric is the answer, and it is available for free.**

**One repo is ahead of this one on mechanism — and it is the proof that mechanism is not enough.**
`politicas` (next-intl, 2 locales, 2,850 keys) has everything §9 below recommends: a **symmetric**
default gate — 15 per-feature vitest suites asserting
`expect(keys).toEqual(Object.keys(en).sort())`, which fails on missing *and* extra, plus
ICU-variable and rich-tag parity that neither repo here checks; a **loud** runtime — no
`getMessageFallback` override, so a missing key renders the raw dotted key path and console-errors,
**never silently English**; and, uniquely, **domain-enumerating tests**
(`votetrack/messages.test.ts:628-636` walks `PAGE_SECTIONS`) plus a runtime existence guard
(`t.has(kindKey) ? t(kindKey) : …`, `opengraph-image.tsx:137-139`).

**It still has the largest gap of the three, and the reason is a lesson for our own §9.** Its
discipline is applied **per feature, by hand, opt-in**: the 15 suites cover `atlas budget
civicscore dashboard … votetrack`. The `graph` feature has three test files and **no
`messages.test.ts`** — it is the one large feature never enrolled, and it is exactly where the
4-of-17 gap sits, reachable through 6 unguarded `t(\`rels.${row.rel}\`)` sites
(`PermalinkPage.tsx:185`, `TrailFinder.tsx:264`, `VariantTrasy.tsx:110,:189`,
`VariantMapa.tsx:280,:406`), none of which uses the `t.has()` guard the same repo invented. Live
writers emit three of the four missing arms
(`scripts/data-analysis/kg-bill-roles-ingest.ts`, `kg-bill-engagement-ingest.ts`).

**So: an opt-in domain-parity discipline leaves its hole precisely where nobody opted in, and
nothing reports the omission.** That is why §9's third recommendation specifies a **closed**
enumeration — one row per category, with `null` + a dated reason as the only way out — rather than
a suite each feature adds when it remembers to. Copied straight from `UNREFERENCED_SECTIONS`
(`check-route-sections.mjs:68-77`), which already gets this right in this repo, and it is the
difference between a gate and a habit.

**What did NOT converge, and is therefore local calibration.** The section-split lazy-loading
pipeline, route-declared preloading and parse-on-demand English are a bundle-size answer to a
19,112-key catalog in a desktop app. No sibling has anything like it. **Adopt P3; do not adopt this
delivery mechanism** — but note that P3 is precisely what *this* mechanism made expensive, so a
repo that avoids the mechanism avoids the hazard.

---

## 1. Trigger

- "add a status/kind/severity to the badge", "the backend returns a new state — show its label"
- "widen this CHECK constraint", "add an arm to this Rust enum", "add a `stop_reason`"
- "add a new translation section", "move this feature to a different tab"
- "is the app fully translated?", "why is this screen in English when I picked Japanese?"
- **If you are about to look a label up by a value that arrived at runtime** — a database column, an
  IPC field, a URL parameter — you are in this situation.
- **If you are about to widen a domain in Rust or SQL**, you are in this situation, and the work is
  in TypeScript.

You are **not** in this situation for: writing a string that is not yet a key (that is
[`i18n-string-authoring`](./i18n-string-authoring.md)); choosing the *wording* of a translation; or
number/date formatting ([`number-and-cost-formatting`](./number-and-cost-formatting.md),
[`timestamp-display`](./timestamp-display.md)).

**Boundary with the two neighbouring paths, stated as a question each answers.**

| Path | Question it settles |
| --- | --- |
| [`i18n-string-authoring`](./i18n-string-authoring.md) | Is this string a key at all? |
| **this path** | Does the key space cover the domain, and does the value reach the screen? |
| [`status-and-severity-badges`](./status-and-severity-badges.md) | Where is a closed vocabulary's presentation authored? |

The three are disjoint and all three are needed: a string can be a key (authoring ✓), be missing an
arm the backend emits (completeness ✗), and be coloured beside its label (badges ✗) independently.

---

## 2. The one way

**Gate the catalog against its domain, and gate delivery against the route — because the parity
gates cannot, ever.** When you add an arm to a closed vocabulary anywhere (a Rust enum, a SQL
`CHECK`, a TS union), add the matching arm to `status_tokens.<category>` in
`src/i18n/locales/en.json` **and** add or extend a **domain-parity test** that asserts the catalog's
arm set *equals* the domain's — copy `src/i18n/__tests__/chainStopReasons.parity.test.ts`, the only
instrument in the repo that asserts a catalog against a **backend** domain, and exactly right. Resolve the token with
`tokenLabel(t, category, token)` and **stop**; never index the catalog yourself, and above all never
write `as Record<string, string>` over a `t.` expression, which deletes the one type that was
working. When you add a translation section, or move a feature between tabs, add the section to
**every** `ROUTE_SECTIONS` entry whose route renders it — not just one — because
`getResolvedSection()` returns English synchronously for an unfetched section and the `t` Proxy
**deliberately does not start a load on property access**. Stage `en.json` and all thirteen locale
files **in the same commit**, because the hook reads the working tree and a partial stage ships the
gap. And accept that the strongest gate you have is a pre-commit hook with a staging precondition:
when your change is on the *domain* side — a Rust enum, a migration — **no i18n gate will run at
all**, so the parity test is the only thing standing there, and you must write it yourself.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| **`src/i18n/__tests__/chainStopReasons.parity.test.ts`** | **The pattern to copy.** A mirrored list of the backend's 13 `stop_reason` consts asserted `toEqual` the catalog's arm set. Its comment (`:4-12`) states the failure mode better than this document could. **Adoption: 1 of 26 token categories.** |
| **`src/i18n/tokenMaps.ts:35` — `tokenLabel(t, category, token)`** | The only sanctioned open-domain lookup. Falls back to the raw token **and DEV-warns once per token** (`:40-49`). **42 call sites / 32 files.** |
| **`src/i18n/routeSections.ts`** | `BASE_SECTIONS` (13) + `ROUTE_SECTIONS` (11 routes). **Load-bearing, not an optimization** — its own docstring (`:4-14`) says so. A section no route declares is never fetched. |
| **`scripts/i18n/check-route-sections.mjs`** | Asserts every *referenced* section is declared by **some** route or base. Exports `analyzeRouteSectionCoverage()` and `suggestRoutes()`; hosted by `src/i18n/__tests__/routeSectionCoverage.test.ts` so `npm run test` runs it. Currently **61 sections, 59 referenced, 59 covered, exit 0.** |
| **`scripts/i18n/check-coverage.mjs --strict`** | Key parity, **symmetric** in strict mode. **19,112 keys × 13 locales, 0 missing, 0 extra** — verified by execution. |
| **`scripts/i18n/check-untranslated.mjs --strict`** | Value parity: fails when a live value is byte-identical to English. **0 untranslated in all 13 locales** (3,624 allowlisted). |
| **`scripts/i18n/check-error-registry-parity.mjs`** | The repo's *other* domain-vs-catalog gate: every `ERROR_KEY_MAP` prefix has `_message` + `_suggestion`. Fatal in CI. |
| **`src/i18n/CONTRACT.md` I4** | "Do not bypass the type with `as any` or `t['section']?.['key']`." The census rule in §9 is the mechanization of this sentence, which has existed as prose and a manual "grep for" instruction since 2026-04. |
| **`src/i18n/generated/types.ts`** | Closes the **key space**: `t.agents.nosuchkey` is a compile error. Read the type-over-gate section for the four things it does not close. |

**Explicitly NOT primitives.**
`src/i18n/en.ts` — the `en` shim — is **always English at any scope**, because its proxy get trap
(`en.ts:33`) calls `getEnglishSection()`, which parses the English bundle unconditionally
(`englishSections.ts:15-20`). It is correct only for a persisted value, a log line or a Sentry
message. `src/i18n/pseudoLocale.ts` is the best manual detector for *authoring* defects and is
**structurally blind to everything in this document** (§7 D8).

---

## 4. Steps

1. **Name the domain before you touch the catalog.** Where is the authoritative list of arms — a
   Rust enum, a `CHECK (x IN (…))`, a ts-rs union, a user-defined set? Write the answer down. If
   the domain is genuinely open (user-supplied), stop: completeness is impossible, so pick a
   humanizing fallback and say so in a comment (the correct precedent is
   `usePickerFilters.ts:131-132`).
2. **Add the arm to `status_tokens.<category>` in `en.json`, and translate all thirteen locales in
   the same change** (`translate-extract` → one subagent per locale → `translate-merge`). Match the
   domain's spelling exactly — `'ai-compose'` is hyphenated, not `ai_compose`.
3. **Write or extend the domain-parity test.** Copy `chainStopReasons.parity.test.ts`. Mirror the
   domain list with a `file:line` comment pointing at it, and assert **set equality**, not
   containment — an extra catalog arm is a dead label and worth knowing about too.
4. **Resolve with `tokenLabel(t, category, token)` and then stop.** Do not add your own
   `?? 'Unknown'`; the primitive owns the fallback and the DEV warning.
5. **If the string is a section you added, or a feature you moved: declare it on every route that
   renders it.** Not one route — every route. `sectionsForRoute(route)` is
   `BASE_SECTIONS ∪ ROUTE_SECTIONS[route]`, and nothing else loads.
6. **Ask the type question before the gate question.** The generated type is derived *from*
   `en.json`, so it can never notice `en.json` is short an arm (P8). Where the domain has a ts-rs
   binding, type the catalog map as `Record<TheDomainUnion, string>` and the missing arm becomes a
   compile error at codegen time — see the type-over-gate answer.
7. **Stage `en.json` and all thirteen locale files together.** Verify with
   `git diff --cached --name-only | wc -l` before committing. A partial stage passes the hook and
   ships the gap — proved in §7 D7.
8. **If your change is on the domain side only** — a migration, a Rust enum, a widened `CHECK` —
   understand that **no i18n hook will fire**, because the pre-commit jobs are globbed to
   `src/i18n/locales/*.json`. Your parity test from step 3 is the entire gate. Do not skip it.
9. **Verify by eye once, in a non-English locale, on a cold start.** Not the pseudo-locale — it
   builds from English and bypasses the section loader entirely, so it cannot show you a delivery
   gap. Set the language, restart, and look at the first screen.

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
| --- | --- |
| `t.kpis.measurement_source as Record<string, string>` then `[m.source] ?? m.source` | Deletes the one type that worked, and prints the machine token when the arm is missing. **Live: `ai-compose` renders raw** (§7 D2). |
| Reading `t.<section>.…` in a component whose route does not declare `<section>` | Renders English in all 13 locales until the user happens to visit a route that does declare it. **26 such pairs, 121 files** (§7 D1). |
| Widening a SQL `CHECK` / Rust enum without touching `en.json` | No i18n gate runs — none is globbed to `.rs` or to migrations. The new arm ships as a raw token in 14 languages. |
| A parity test asserting the catalog **contains** the domain | Passes forever on a dead label. Assert `toEqual` on sorted arrays, as `chainStopReasons.parity.test.ts:37` does. |
| Trusting `npm run check:i18n` / the pre-push `i18n-coverage` job to catch a missing key | **Both run non-strict.** Executed: with one key missing from 13 locales, the default mode exits **0** with a `WARN` (§7 D6). |
| `git add src/i18n/locales/en.json` alone, with the locales fixed but unstaged | The hook reads the working tree, passes, and `HEAD` carries the gap. Proved with a real git fixture (§7 D7). |
| `const t = en;` at module scope, then building a label array from it | The lint rule tracks the *import's local name* and does no alias analysis, so it sees none of it. **8 screen-reaching strings hidden this way** (§7 D5). |
| `en.overview.chart_error.chart_unavailable` inside a class `render()` | Not a module-scope defect and not caught by the rule that exists — `en` is English **at any scope** (§7 D5). |
| Using the pseudo-locale to check whether the app is fully translated | It renders `buildPseudoBundle(getEnglishTranslations())` (`useTranslation.ts:224-226`), bypassing the section loader. Every delivery gap looks perfect (§7 D8). |

---

## 6. Evidence

**The one site to copy: `src/i18n/__tests__/chainStopReasons.parity.test.ts`.** Forty-one lines, no
dependencies, and it is the only instrument in this repo that closes the P1/P2 hole. Copy four
things from it:

- `:15-29` — the domain list **mirrored verbatim**, with `src-tauri/db/src/chain.rs:45-81` named in
  the comment so the next reader can diff it by hand in ten seconds.
- `:32-34` — an assertion on the **length of the mirror itself**. This is the fail-loud precondition:
  if someone edits the mirror without editing the source, the count assertion fires first and names
  the mirror as the thing that moved.
- `:36-40` — `toEqual` on **both sides sorted**. Set equality, so a dead catalog arm fails too.
- `:4-12` — the comment, which states the mechanism (`reason_token` is a raw `String`, nothing
  typechecks it, `tokenLabel` degrades to the raw token with only a DEV warning) rather than
  restating the assertion.

**For the resolution itself:** `src/i18n/tokenMaps.ts:35-51`. The design detail worth copying is
`:40-49` — an unmapped token degrades to the raw token *and tells the developer once*. That
per-token `warnedTokens` set is the only runtime signal of an absence anywhere in this system.

**For the delivery layer:** `src/i18n/routeSections.ts:42-52`. The `debt` entry is the best comment
in the i18n tree: it records that the section "loaded on no route at all and rendered English
everywhere" before 2026-08-09, names its cost (~37KB per locale), and says what the real fix is
(retire the section). That is what a load-bearing exception should look like.

**For the catalog gates, run all four and read the output** — this half of the system is genuinely
healthy and it is worth saying so plainly before anything else:

| Check | Result (executed during composition) |
| --- | --- |
| `check-coverage.mjs --strict` | **19,112 keys × 13 locales, 0 missing, 0 extra** — exit 0 |
| `check-untranslated.mjs` | **0 untranslated values in every locale** (3,624 allowlisted) |
| `check-route-sections.mjs` | **61 sections, 59 referenced, 59 covered** — exit 0 |
| `check-error-registry-parity.mjs` | 65 prefixes, all present — fatal in CI |

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692` and was verified by executing a checker, by running a
scratch fixture, or by reading the file. **Nothing here was applied** — the app is in daily use
(runbook standing rule), and every fix below changes runtime behaviour.

### D1 — 27 section/route pairs render English on a cold start · 18 sections · 121 files

> **Corrected 2026-08-17** by the `first-run-onboarding` composer. The pass below missed
> `onboarding`, and it is the worst-shaped member of the population: 16 files plus
> `DesktopFooter` use `t.onboarding.*` (160 refs over 174 keys), the surfaces mount **above
> the router** at `App.tsx:367-370`, and the section is declared only on `home` — so it
> renders English on **10 of 11 routes** in all 13 non-English locales. The two
> implementations below agreed at 26/17 because both enumerated from the route table, and a
> surface that mounts above the router is not in it. Agreement between two passes that share
> a starting set is not independent confirmation.

`useTranslation.ts:229-241` — the `t` Proxy's `get` trap is a **pure read**. It deliberately does
*not* call `preloadSections`, and the comment (`:234-240`) says why: doing so caused a render storm
under language switch. So the only loaders are `useTranslation`'s effect (`:341-343`), which loads
`sectionsForRoute(activeRoute)`, and `main.tsx:173-181`, which loads the same set before mount.
`getResolvedSection` (`:211-212`) returns the **English** section synchronously when the locale
chunk is not cached.

`check-route-sections.mjs` asserts `covered.has(section)` (`:115`), where `covered` is the **union**
of `BASE_SECTIONS` and every route's list. **That is set membership, not route membership.** A
section declared for route A and rendered on route B is fully covered by the gate and fully English
on B.

Measured by two independent implementations — the first using the repo's own
`scanSectionReferences` + `suggestRoutes`, the second a raw walk that imports nothing from
`scripts/` — which after one correction (below) **agree exactly at 26 pairs / 17 sections / 121
files**. The top of the distribution:

| section | rendered on route | files | translated arms that never load |
| --- | --- | ---: | --- |
| `plugins` | `overview` | 17 | e.g. `sub_patterns/KnowledgeLibrary.tsx:46` |
| `recipes` | `events` | 14 | `sub_editor/components/RecipeEditor.tsx` |
| `plugins` | `home` | 14 | 8 `sub_cockpit/widgets/*` |
| **`overview`** | **`home`** | **13** | **`sub_cockpit/CockpitPanel.tsx:141`** |
| `shared` | `personas` | 12 | `components/IconSelector.tsx` |
| `recipes_catalog` | `design-reviews` | 11 | `sub_recipes/components/RecipeDetailPanel.tsx` |

**The sharpest instance is on the default landing screen.** `readPersistedSidebarSection()`
(`main.tsx:161-171`) returns `"home"` for a fresh install. `ROUTE_SECTIONS.home` declares
`cockpit` — a section with **2 keys**. `CockpitPanel.tsx:141` reads `t.overview.cockpit`, a
sub-object with **86 keys**, and `overview` is not declared for `home`. Verified end to end:
`es.overview.cockpit.briefing_title` is `"Informe matutino"`, `ja` is `"モーニングブリーフィング"`,
both present in `section-locales/{es,ja}/overview.json` — and neither is ever fetched on the route
that renders them. **86 fully-translated keys, on the first screen, that no non-English user has
seen on a cold start.** The author declared a section named `cockpit` and the strings live under
`overview.cockpit`.

**It is order-dependent, which is worse than permanent.** `sectionCache` (`useTranslation.ts:42`)
is module-scoped and never cleared, so once the user visits a route that *does* declare the section
it becomes correct for the rest of the process. The defect reproduces on cold start and evaporates
under exploration — the worst possible shape for manual QA.

> **Method note, because it inverted a count.** Implementation B first reported 23 pairs. Its regex
> required a trailing `.` or `[` after `t.<section>`, and so missed the **aliased** form
> (`const st = t.sharing;` — `RemoteJobNoticeChip.tsx:57`, `TeamPublishButton.tsx:23`,
> `SchemaParseErrorBanner.tsx:10`). Dropping the trailing-token requirement — the section name is
> already a 61-word closed vocabulary — brought it to 26, matching implementation A exactly. The
> three it missed are the aliased ones, i.e. **the shape that hides the section name from a naive
> scan is the shape a naive scan misses.**

### D2 — `t.kpis.measurement_source`: 5 arms against a 6-arm CHECK, with a live writer

`en.kpis.measurement_source` has **5** arms: `evaluator`, `manual`, `scan`, `health_snapshot`,
`simulation`. The database constraint has **6**: migration
`widen_kpi_measurement_source_with_ai_compose` (`src-tauri/db/src/migrations/incremental.rs:8232`,
`:8255`) rewrites the CHECK to add `'ai-compose'`.

**There is a live writer.** `src-tauri/db/src/repos/dev_tools.rs:7100` —
`VALUES (?1,?2,?3,'ai-compose','production',?4,?5)`. This is not latent.

The render is `KpiDetailModal.tsx:302` + `:320`:

```tsx
const sourceLabels = t.kpis.measurement_source as Record<string, string>;
…
{sourceLabels[m.source] ?? m.source}
```

So an AI-composed measurement renders the literal string `ai-compose` in all fourteen languages —
including English, where it is equally wrong. Three gates were green throughout: key parity (the
arm is missing from *every* locale, so the locales agree), value parity (all 5 present arms are
translated), and `tsc` (the cast made the index `string`).

`:315` is the same shape one line away: `(t.kpis.env_labels as Record<string, string>)[m.env] ?? m.env`.

### D3 — the right instrument exists at 1 of 26 categories, and the other 25 hide 36 missing arms

`status_tokens` has **26** categories. `chainStopReasons.parity.test.ts` covers **one**. The other 25
were diffed against their domains during composition. **24 of 25 have a discoverable grounded
domain** (only `dev` does not — three disjoint candidates, matching none). Against those:

| | count |
| --- | ---: |
| categories with ≥1 arm missing from the catalog | **10 of 24** |
| total missing arms | **36** |
| of those, **ACTIVE** — a live writer *and* a reachable render path | **13** |
| categories with **no consumer at all** — never passed to `tokenLabel`, never read | **8 of 25** |

The 13 active ones render a raw machine token to the user today:

| arm(s) | category | live writer | renders raw at |
| --- | --- | --- | --- |
| `generating` | execution | `db/src/repos/lab/arena.rs:71-72` (and the column default, `schema.rs:777`) | `LabHistoryTable.tsx:90`, `LabResultModal.tsx:41` |
| `pending`, `matching`, `done`, `skipped` | execution | `db/src/repos/orchestration/team_assignments.rs:220-223`; `engine/team_assignment_orchestrator.rs:801,:991,:336` | `teams/sub_goals/GoalTaskTable.tsx:97` |
| `awaiting_review`, `done`, `aborted` | execution | `engine/team_assignment_orchestrator.rs:623-628,:643-645,:349` | `GoalDetailDrawer.tsx:639` |
| `warning`, `error` | severity | `engine/director.rs:432` → `manual_reviews.rs:57-62` | `sub_director/PersonaDetailModal.tsx:278` |
| `external`, `tool`, `prompt` | healing_category | `core/src/healing.rs:172,:459,:522` (`external` is 14 of 20 construction sites) | `HealingEffectivenessPanel.tsx:101` |
| `xhigh` | thinking | UI-selectable at `modelCatalog.ts:87` → stamped at `runner/mod.rs:1813-1818` | `LlmCallsTable.tsx:219`, `ExecutionValueBadges.tsx:44` |

Two of these fire on essentially every run: `generating` (every arena run is born in it) and
`pending` (every team-assignment step).

**Three of these deserve to be read slowly, because each shows the leaf from a different angle.**

- **`thinking.xhigh` is the same concept translated in one map and missing from the other.**
  `models.effort_xhigh` exists and is translated in all 14 locales (`en.json:17255`);
  `status_tokens.thinking.xhigh` does not exist. `EFFORT_LEVELS` has four arms
  (`db/src/model_routing.rs:25`), the catalog has three, and `thinking_level` is `string | null` in
  the binding (`GlobalExecutionRow.ts:17`) so nothing typechecks it. **It renders raw at
  `LlmCallsTable.tsx:219` — the exact file [`i18n-string-authoring`](./i18n-string-authoring.md) §6
  names as "the one site to copy".** That file is genuinely exemplary on authoring and still prints
  a machine token, which is the cleanest possible demonstration that these are two different leaves.
- **`severity.warning` renders correctly-coloured and wrongly-worded.** `PersonaDetailModal.tsx:21-30`
  keys its own styling maps on exactly `error`/`warning`/`info`, so a Director verdict of `warning`
  produces a correct amber chip whose text is the literal string `warning`. **The presentation
  vocabulary is complete and the label vocabulary is not** — precisely the split between
  [`status-and-severity-badges`](./status-and-severity-badges.md) and this path.
- **`execution` is not one domain.** The category is applied to **five structurally unrelated
  columns**: `persona_executions.status` (`schema.rs:108`), `lab_arena_runs.status`
  (`LabRunStatus.ts:3`), `dev_tasks.status` (`dev_tools.rs:1362`), `team_assignments.status`
  (`incremental.rs:5799`) and `team_assignment_steps.status` (`incremental.rs:5827`). The catalog
  covers the first and third; **7 of its 9 missing arms come from the lab and teams spines**, which
  were never considered when the category was named. Its one arm nothing emits — `error` — looks
  inherited from the legacy `execution_status` section. **A single category name is doing duty for
  five domains, so "is this category complete" has no well-formed answer until it is split.**

**The other direction matters too: 8 of 25 categories have no consumer at all** (`automation`,
`priority`, `healing_status`, `connector_status`, `task_phase`, `goal_state`, `test`, `dev`). Their
arms are dead strings shipped in 14 locales — and several are *wrong*, not merely unused:
`healing_status` mixes `IncidentStatus` arms with `auto_fixed`, which is a **boolean column name**,
not a status; `connector_status.no_credential` is a stale rename of `missing`. **Wiring one of these
up naively would create a new leak rather than close one**, which is why §9's recommendation asserts
set equality in both directions and why step 3 of the sequencing is enumeration-first, not fix-first.

`event_reason` carries **`_comment_section`** as an arm (`en.json:12882`) — a JSON pseudo-comment
sitting inside a token map, indistinguishable from a real token to `tokenLabel`'s `token in section`
test (`tokenMaps.ts:37`). It is the only underscore-prefixed key among all 26 categories, out of 301
such comment keys living harmlessly in ordinary label sections elsewhere in `en.json`. It cannot
render — `EventReasonView.tsx:16` only labels tokens that first pass the 9-member
`EVENT_REASON_TOKENS` gate (`eventReason.ts:17-27,56`) — but **it was translated verbatim into all
14 locales, and it would fail a naive parity test while a containment test would miss it.** It is the
argument for `toEqual` in one line.

> **Neighbour interaction, per [doctrine §6](../golden-path-doctrine.md#6-check-your-prescription-against-your-neighbours).**
> [`status-and-severity-badges.md:277`](./status-and-severity-badges.md) already publishes a
> category → union pairing table, and it is **wrong on at least two rows** — it pairs
> `healing_status` with `IncidentStatus` and `deployment` with `AutomationDeployStatus`. That
> document concedes at `:286` that "there is no declared link between a category and its union
> anywhere in the repo" and that its pairings were inferred from member overlap. **Do not seed §9
> step 3 from that table.** Two individually-reasonable documents compose into a wrong fix here: this
> path says "assert the catalog against its domain", that path supplies a domain list, and the list
> is a guess. The enumeration must be re-derived from the writers, as it was above.

`VerdictBadge.test.tsx:12-16` is a *second* parity test in the repo and does not close the gap: it
asserts a **frontend** map against the catalog, while `VerdictBadge.tsx:41` falls back past that map
into `tokenLabel`, and the Rust side passes a `scorecard.json` string through unvalidated
(`eval_runs.rs:504-513`). A parity test whose left-hand side is also frontend code cannot see the
backend.

### D4 — 7 catalog lookups with the type check explicitly waived

The census signal (§9). All eight raw matches were read at source; the split by what the miss
renders:

| site | index | fallback renders |
| --- | --- | --- |
| `KpiDetailModal.tsx:302`→`:320` | `m.source` | raw token — **D2, live** |
| `KpiDetailModal.tsx:315` | `m.env` | raw token |
| `LabProgress.tsx:74` | `PHASE_LABELS[phase.key] ?? ''` | raw token (`?? phase.key`) |
| `DesignHub.tsx:56`→`:74` | `tab.labelKey` | raw key |
| `connectorLicensing.ts:55` | `tier` | **frozen English** (`LICENSE_TIER_META[tier].label`) |
| `connectorRoles.ts:146` | `r.labelKey` | **frozen English** (`r.label`) |
| `connectorRoles.ts:231` | `pg.labelKey` | **frozen English** (`pg.label`) |
| *`usePickerFilters.ts:133`* | *`cat`* | *`capitalize(cat)` — **legitimate**, see below* |

Both fallback flavours are the same condition for this leaf: **the lookup can miss, and the miss is
silent.** The three `?? englishLabel` sites are arguably worse than the raw-token ones, because a
raw `ai-compose` at least *looks* broken; a fluent English sentence in a Japanese UI looks like a
translation nobody got to.

`usePickerFilters.ts:133` is the one legitimate instance and is excluded by name in §9: connector
categories are **user-defined**, so the domain is genuinely open and completeness is impossible by
construction. Its own comment says so at `:131-132`. That is the correct shape for an open domain
and the right precedent to copy.

**The repo already prescribed this.** `CONTRACT.md` I4 says "Do not bypass the type with `as any` or
`t['section']?.['key']`", and the module rubric (`:118-119`) says "Grep for `t as any`, `t['...']`,
or string-indexed access into `t`." Measured: `t as any` → **0 sites**; `t['literal']` → **0 sites**.
Two of the rubric's three greps describe extinct conditions. The third is live at 7 sites and has
never been mechanized — the instruction is literally "grep for", performed by hand, if at all.

### D5 — the `en` shim: three of the brief's premises are wrong and the rule's condition is the wrong condition

**Corrected counts.** `CLAUDE.md` and the brief say "~48 modules bind English at module scope"; a
prior path says 61 importers. Measured: **67 importers**, of which **only 14 import the value `en`**
— the other 53 are `import type { Translations }` and are erased at compile time. Of those 14,
**5 read at module scope**, freezing ~35 strings; of those, exactly **14 strings reach the screen,
across 2 files**:

- `EventConfigSubPanels.tsx:20-22` → 6 strings → rendered at `EventTemplateCard.tsx:49,:51,:59,:71`
  (Vault → credential detail → Event Triggers).
- `cloudSchedulesHelpers.tsx:13,:29-36` → 8 strings → rendered at `CreateTriggerForm.tsx:108-119`
  (Agents → Deployment → Cloud, cron preset chips).

The other 21 are **dead exports**: `templateFeedback.ts:39` `FEEDBACK_LABELS` (11 strings) and
`evalFramework.ts:227` `STRATEGY_META` (10 strings) both have **zero consumers**.

**`no-module-scope-en-value` reports 6 warnings — all six in one file — and misses 8 of the 14.**
Verified by running it. It resolves the root identifier of a `MemberExpression` back to the import
binding named `en` (`:126-131`, `:145`); `cloudSchedulesHelpers.tsx:13` writes `const t = en;` and
then reads `t.deployment.cron_every_5min`, so the root identifier is `t` and the visitor returns
early. It does no alias or dataflow analysis. It is also blind to `en` **passed as an argument** at
module scope (`getFeedbackLabels(en)`, `getStrategyMeta(en)`) — twice over, since the call site is a
bare `Identifier` and the reads inside the callee sit in a `FunctionDeclaration`.

**The rule's condition is the wrong condition, and this is the finding.** Its own doc comment
(`:39-40`) claims function-body reads "follow the active bundle as far as the shim can". **The shim
cannot follow the active bundle at all**: `en.ts:33`'s get trap calls `getEnglishSection()`, which
parses the English bundle unconditionally (`englishSections.ts:15-20`). Module scope makes a value
*frozen*; a function body makes it *recomputed English*. **Neither localizes.** The proof is
`ChartErrorBoundary.tsx:44` — `en.overview.chart_error.chart_unavailable`, read inside a class
`render()`, correct scope by the rule's lights, English in fourteen languages. The brief called this
a module-scope binding; it is not, and that is why nothing catches it. `:51` of the same file is a
hardcoded `Retry` literal that `custom/no-hardcoded-jsx-text` also cannot see, because its
`isNonTranslatable` branch exempts any single word ≤ 20 characters. **Two gates, two different
structural blind spots, one 40-line component.**

> Clean result worth recording: `getActiveTranslations()` is the same hazard by a different door,
> and it is **0 for 25** — every one of its 25 call sites is inside a function body. That is
> convention holding with no enforcement at all, and two sites (`seedOnboarding.ts:15-16`,
> `useHealthDigestScheduler.ts:85-86`) carry written rationale. Do not "fix" this.

### D6 — the only mode that sees a missing key runs in one place, behind a staging precondition

Executed against a copy of the real 14-locale catalog with **one** key added to `en.json`:

| invocation | where it runs | exit |
| --- | --- | ---: |
| `check-coverage.mjs --strict` | pre-commit `i18n-no-gaps`, **glob `src/i18n/locales/*.json`** | **1** ✔ |
| `check-coverage.mjs` (default) | CI `check:i18n` **and** pre-push `i18n-coverage` | **0** ✗ (a `WARN`) |

So the strict mode — the only one that can see this leaf's core failure — runs **exclusively** in a
pre-commit hook that fires only when the commit stages a locale file. **CI and pre-push both run
the mode that exits 0.** This is P7 and P5 together: the strong mode is not the default, and the
gate is attached to the wrong event.

The consequence for the domain side is total: `lefthook.yml:38` and `:50` are globbed to
`src/i18n/locales/*.json`. A commit that widens a SQL `CHECK`, adds a Rust enum arm, or moves a
component between routes stages **no** locale file, so **neither i18n job runs at all** — which is
exactly how D1, D2 and D3 arrived.

### D7 — the hook reads the working tree, so it cannot certify the commit

`check-coverage.mjs:38-39,67` reads `process.cwd()/src/i18n/locales/*.json` with `readFileSync`. It
never consults the index. Proved with a throwaway git repository (3 locales, real script):

1. Add a key to **all three** locale files in the working tree.
2. `git add src/i18n/locales/en.json` only. The hook's glob matches, so the job runs.
3. `check-coverage.mjs --strict` → **exit 0.** The hook passes.
4. Commit. Check out `HEAD` into a clean tree and re-run → **exit 1, 1 missing key in 2 locales.**

The commit shipped the gap and the gate said yes. [`i18n-string-authoring`](./i18n-string-authoring.md)
step 7 warned about this in prose; this is the measurement. **All three localizing repos in the
sweep have it** — `personas-web`'s gate reads `repoRoot` directly (`check-i18n-coverage.mjs:8-14`),
`politicas`' suites `import` the catalogs. None reads the index.

### D8 — the loaded state is not observable at runtime, and the best detector is blind to the leaf

`sectionCache`, `bundleCache`, `loadingPromises` and `bundleVersion` are all module-private
(`useTranslation.ts:42-44,:263`), and nothing in the module's eight exports reveals them. There is
no `window.__i18n`, no missing-key handler, no telemetry. The four runtime signals that exist and
what each cannot see:

| signal | fires when | blind to |
| --- | --- | --- |
| `tokenMaps.ts:44` DEV warn | an unmapped token reaches `tokenLabel` | the 7 hand-rolled lookups (D4); production |
| `useTranslation.ts:291` DEV warn | `tx()` gets a non-string leaf | anything, in practice — parity is 0-missing |
| `routeSections.ts:102-106` DEV warn | a `SidebarSection` has **no** mapping | a route with a mapping that is short a section (D1) |
| `pseudoLocale.ts` | `?pseudo=1` | **all of D1** — see below |

The pseudo-locale is the repo's best manual detector and it is **structurally incapable of showing
a delivery gap**: `getBundle` (`useTranslation.ts:224-226`) returns
`buildPseudoBundle(getEnglishTranslations())` when pseudo is active, bypassing `getResolvedSection`
and the section loader entirely. Every string is bracketed whether or not its locale chunk would
have loaded, so a screen with 86 undelivered keys looks identical to a perfect one.

`personas-web` is in the same state — a repo-wide grep for
`missingKey|onMissing|MISSING_TRANSLATION|pseudo|untranslated` returns exactly one hit, and it is a
comment about particle offsets. `politicas` gets this for free by *not* overriding next-intl's
default: a missing key renders the dotted key path and console-errors.

### D9 — a note on scale, so D1 is not read as the whole story

`section-locales/` holds **13 locale directories × 61 sections = 793** generated chunk files, and
the split is complete — every section exists for every locale. The delivery defect is entirely in
the 24-line hand-maintained `ROUTE_SECTIONS` table. **The expensive machinery is correct and the
free-form list beside it is not**, which is the ordinary shape of this class of bug and the reason
§9 proposes extending a script rather than building one.

---

## 8. Gaps in the primitives

1. **`check-route-sections.mjs` asserts union membership when it already has everything it needs to
   assert route membership.** It computes `refs` (section → referencing files) and ships
   `suggestRoutes(files)` (`:152-167`), a file-path → route map — and then uses `suggestRoutes`
   **only to print a suggestion in the failure branch** (`:191`). The join that would have caught
   all 26 pairs is already written and is thrown away. **Fix in §9.**
2. **There is no existence probe.** Nothing answers "does this key resolve for the active locale?"
   `politicas` has `t.has(key)` from next-intl and uses it exactly where it matters
   (`opengraph-image.tsx:137-139`). Here, the only way to ask is to read the value and compare it to
   the English one — which is what `check-untranslated.mjs` does offline and nothing does at
   runtime.
3. **`useTranslation` is a hook, and an error boundary must be a class.** This is a real limitation,
   not laziness: `ChartErrorBoundary` cannot call `useTranslation()` from `render()`, which is why it
   reaches for the `en` shim. The repo already solved it — `ErrorBoundary.tsx:33` is the class,
   `:76` `ErrorFallback` is a **function** component that calls `useTranslation()` at `:89`. The
   pattern exists and was not applied to the chart boundary. **Fix:** extract the fallback; do not
   add a non-hook resolver.
4. **The `t` Proxy cannot self-heal, and the reason is sound.** Loading from the `get` trap caused a
   render storm (`:234-240`), so delivery correctness is a hand-maintained list by deliberate
   design. Any fix must live in tooling around `ROUTE_SECTIONS`, not in the getter. A middle path
   nobody has tried: fire a **DEV-only warning** from the getter when the requested section is not
   in `sectionsForRoute(currentRoute)` — no load, no storm, one console line naming the exact
   section/route pair.
5. **Nothing lets a catalog map declare its domain.** The only expression available is a
   hand-mirrored list in a test (`chainStopReasons`), which is a *copy* of the domain and can rot in
   the direction the test cannot see — someone edits `chain.rs` and the mirror, together, wrongly.
   The type-level fix is in the next section.
6. **`check-untranslated.mjs` allowlists 3,624 keys — 19% of the catalog.** Most are placeholders
   and correct. It is recorded here only because an allowlist that size is the natural place for
   the next uniform absence to hide, and its entries are `*:key` wildcards spanning all locales.

---

## 9. The missing gate

**Manifestation layer.** Per [`golden-path-contract.md:43-69`](../golden-path-contract.md), what
follows is a proxy for a semantic condition, tuned to this repo's idiom. The risk is acute here:
four of five canonical siblings have no i18n at all, and the one that does has neither
`tokenLabel` nor `ROUTE_SECTIONS` — **every signal below would score zero in `personas-web` while
the condition is live there 8 times** (its `guide.categories` hole, plus 8 unverified dynamic
indexes). Conditions are stated first so an adopting repo re-derives its own proxy.

**Everything in §7 shipped under a green `npm run check`, green `check:i18n`,
green `check:i18n:untranslated`, green `check-route-sections`, and a clean `tsc`.**

### §9 calibration — the honest answer about gate placement

**The strongest gate available for this leaf's core condition is a pre-commit hook with a staging
precondition, and that is a finding about placement, not a failure.** `ci.yml` is red on 10
pre-existing failures, so a CI-only gate runs nowhere. Of the mechanisms that *do* run:

| mechanism | runs | sees this leaf? |
| --- | --- | --- |
| pre-commit `i18n-no-gaps` (`--strict`) | only when a locale file is staged | missing keys ✔ · uniform absence ✗ · delivery ✗ |
| pre-push `i18n-coverage` (default) | every push | **nothing** — exits 0 on missing (D6) |
| pre-push `golden-path-census` | every push | the census rule below ✔ |
| `npm run test` (vitest) | **CI only** — `ci.yml:190`, in no lefthook hook | `routeSectionCoverage` + `chainStopReasons` ✔ |

So the two instruments that actually cover P1/P2/P3 — the parity test and the route-section test —
are **vitest tests hosted in a suite that runs at `ci.yml:190` and nowhere else**, and CI is red. The census is the only
per-push mechanism that reaches any part of this leaf. **That is why the rule below is scoped to the
one condition a regex can express, and the other two recommendations are script extensions rather
than new gates.**

### Semantic conditions, stated stack-free

- **C1 — a display label is resolved from the catalog by a key that is open at runtime, with the
  compiler's check explicitly waived, so an absent arm is invisible to both the type system and
  every locale-vs-locale gate and surfaces as a machine token or as the wrong language.**
  *Proxy here:* a cast of a `t.` expression to `Record<string, string>`. *Precondition:* this repo
  closes its key space with a generated type, so bypassing it requires an explicit cast that a regex
  can find. **A repo whose catalog is typed `Record<string, string>` to begin with has nothing to
  cast and scores zero while the condition is universal** — which is exactly `personas-web`, where
  the erasure happens at a prop declaration (`GuideCategoryGrid.tsx:21-22`) instead.
- **C2 — a translated resource exists, is complete, and is never delivered to the surface that
  renders it.** *No proxy is offered.* See below.
- **C3 — a catalog's arm set is narrower than the domain it must cover.** *No proxy is offered.*
  See below.

### Conditions deliberately NOT given a census rule — with the numbers

- **C2 (delivery, 26 pairs / 121 files) — declined, because the census cannot express a join.** The
  condition is "section X is referenced in a file whose route does not declare X". A census rule is
  one regex over file contents with fixed `roots`; deciding it requires reading
  `routeSections.ts`, mapping file → route, and intersecting. Scoping a rule to
  `roots: ["src/features/home"]` with a pattern listing the sections `home` omits *would* work for
  one route, and that is precisely the contract's §9 anti-pattern — a signal keyed to one
  manifestation, green forever in the other ten. **The right instrument already exists and needs
  ~15 lines:** `check-route-sections.mjs` already computes `refs` and already exports
  `suggestRoutes` (Gap 1). Change `covered.has(section)` (`:115`) to a per-route intersection over
  `suggestRoutes(files)`, add the 26 pairs as a dated, explained baseline in the file's existing
  `UNREFERENCED_SECTIONS` style, and `routeSectionCoverage.test.ts` inherits it for free. Its
  fail-loud precondition is likewise already there — the script fails if a section is neither
  referenced nor documented, so a broken scanner cannot read as a clean repo.
- **C3 (domain parity — 25 of 26 categories ungated, hiding 36 missing arms of which 13 are live)
  — declined, because the census cannot assert an absence.** Per the doctrine, a census rule
  ratchets a count of something *present*; "this catalog covers that enum" is a set-equality claim
  across two languages and two build systems, and the thing to be counted does not exist. The right
  instrument is the one the repo already wrote: **generalize
  `chainStopReasons.parity.test.ts` to a table-driven suite**, one row per category, each row
  naming its domain's `file:line`. Rows whose domain is genuinely un-enumerable get an explicit
  `null` with a dated reason, so "no domain" stays distinguishable from "nobody looked" — the same
  discipline `UNREFERENCED_SECTIONS` already uses. Its fail-loud precondition is the length
  assertion at `:32-34`.
  **The enumeration must be closed — driven off `Object.keys(en.status_tokens)` so a new category
  fails the suite until it declares a domain or a `null`.** This is not a style preference: it is
  the one design detail that separates this recommendation from `politicas`, which built the same
  instrument, applied it opt-in per feature, and now carries the sweep's largest gap (4 of 17) in
  the single feature nobody enrolled. An opt-in parity discipline reports green on the code it was
  never pointed at, which is the same failure as a gate that no-ops.
- **Casts on the index expression (`map[value as SomeUnion]`) — declined at 24% precision.**
  Measured: **25 matches / 19 files**, of which only ~6 resolve a *label* (`tokens.ts:101,117,130`,
  `SystemTraceViewer.tsx:251`, `LiteratureSearchPanelWorkbench.tsx:309`). The rest index icon,
  colour and config maps (`STATUS_ICONS`, `SLA_CARD_COLOR_CLASSES`, `INTENT_TEXT_CLASS`), and one is
  a pure false positive (`voicePlayback.ts:36`, `bytes as BlobPart`). **A gate that fires on correct
  content is worse than no gate.**
- **Computed catalog indexes generally (141 matches / 74 files) — declined, because most are
  correct.** The dominant form is `t.agents.health_proposals[labelKey]` where `labelKey` is a typed
  string union (`sub_health/types.ts:36-42`), which **is** compiler-checked against the catalog and
  is the pattern this path recommends. Counting them would ratchet the good answer.
- **Hardcoded English (`Retry` at `ChartErrorBoundary.tsx:51`) — belongs to
  [`i18n-string-authoring`](./i18n-string-authoring.md)**, whose §9 C3/C4 already own the condition
  and already declined to double-count it. Noted here only because that file demonstrates two
  blind spots at once.

### The rule — validated

Validated standalone in a private scratch registry
(`node scripts/census/run-census.mjs --rules <scratch> --check` → **exit 0**). The full registry was
**not** run, per doctrine. Counts were produced by two implementations and all eight matches
hand-read at source before baselining.

```json
{
  "rules": [
    {
      "id": "unverifiable-catalog-lookup",
      "goldenPath": "docs/concepts/golden-paths/translation-completeness.md",
      "title": "A catalog lookup keyed by an open runtime value, with the compiler's check waived by a cast and a silent fallback",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\bt\\??\\.[A-Za-z_0-9.]+\\s+as\\s+Record<\\s*string\\s*,\\s*string\\s*>",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a cast of a translation-catalog expression to Record<string, string>, which deletes the generated key type and reopens the key space to any runtime value. PROXY FOR the stack-free condition: a display label is resolved from the catalog by a key that is open at runtime with the compiler's check explicitly waived, so an absent arm is invisible BOTH to the type system AND to every locale-vs-locale parity gate (the arm is missing identically in all 14 locales, and a parity check is a symmetry check), and surfaces as a raw machine token or as the wrong language. All 8 raw matches were read at source; the miss renders a RAW TOKEN at 4 (KpiDetailModal.tsx:302->:320 `sourceLabels[m.source] ?? m.source`, KpiDetailModal.tsx:315 `[m.env] ?? m.env`, LabProgress.tsx:74 `?? phase.key`, DesignHub.tsx:56->:74 `?? tab.labelKey`) and FROZEN ENGLISH at 3 (connectorLicensing.ts:55 `?? LICENSE_TIER_META[tier].label`, connectorRoles.ts:146 `?? r.label`, connectorRoles.ts:231 `?? pg.label`). Both flavours are the same condition: the lookup can miss and the miss is silent. LIVE DEFECT, not hypothetical: en.kpis.measurement_source has 5 arms against the 6-arm CHECK that migration widen_kpi_measurement_source_with_ai_compose (src-tauri/db/src/migrations/incremental.rs:8232,:8255) installed, and there IS a live writer at src-tauri/db/src/repos/dev_tools.rs:7100 (VALUES (?1,?2,?3,'ai-compose',...)), so an AI-composed KPI measurement renders the literal string `ai-compose` in all 14 languages. THIS IS THE REPO'S OWN PRESCRIPTION, NEVER MECHANIZED: src/i18n/CONTRACT.md I4 says 'Do not bypass the type with `as any` or `t[\"section\"]?.[\"key\"]`' and its module rubric (:118-119) says 'Grep for `t as any`, `t[\"...\"]`, or string-indexed access into `t`' — a manual instruction. Measured: `t as any` = 0 sites and `t['literal']` = 0 sites, so two of the rubric's three greps describe extinct conditions and only this one is live. PRECISION on the stated condition: 8/8, every match hand-verified; 7/8 are defects after excluding the one legitimate open-domain instance below. PRECONDITION (measured, must be re-derived per repo): this repo CLOSES its key space with a codegen'd type (src/i18n/generated/types.ts from scripts/i18n/gen-types.mjs), so reopening it requires an explicit cast a regex can find. A repo whose catalog is typed Record<string,string> to begin with has nothing to cast and scores ZERO while the condition is universal. Measured in BOTH other localizing repos in the sweep, and they fail this pattern in two different ways: personas-web performs the identical erasure at a PROP DECLARATION (GuideCategoryGrid.tsx:21-22 `categories: Record<string, string>`), carrying an 11-member guide domain against a 10-arm catalog that renders English in 13 languages behind a gate reporting 100%; politicas performs NO erasure at all, because next-intl's t() already takes a string, so the lookup is a bare template literal (`t(\\`rels.${row.rel}\\`)` at PermalinkPage.tsx:185 and 5 more sites) — carrying a 17-arm KG_EDGE_RELS domain (lib/analysis/kg-verdict.ts:25-58) against a 13-arm catalog in BOTH locales, with live writers. THREE repos, three stacks, same enum-vs-catalog gap, three green boards — and this regex would find it in exactly one of them. Re-derive the proxy; the condition is universal and its costume is not. DELIBERATELY NOT MATCHED: `map[value as SomeUnion]` (25 matches/19 files, only ~24% resolve a label — the rest index icon/colour/config maps, declined on precision) and plain computed indexes like t.agents.health_proposals[labelKey] (141 matches/74 files, mostly CORRECT because labelKey is a typed union that IS checked). LEGAL FIX, in order: (1) delete the cast and type the catalog map from the DOMAIN rather than from en.json — `Record<KpiMeasurementSource, string>` where the union is the ts-rs binding — which makes the missing arm a compile error at codegen time; (2) where no binding exists, resolve through tokenLabel(t, category, token) (src/i18n/tokenMaps.ts:35), which centralises the fallback and DEV-warns once per unmapped token; (3) add a domain-parity test copying src/i18n/__tests__/chainStopReasons.parity.test.ts, asserting SET EQUALITY (toEqual on sorted arrays), not containment."
      },
      "exclude": [
        {
          "path": "src/features/vault/sub_catalog/components/picker/usePickerFilters.ts",
          "reason": "the one legitimate instance of the eight: connector categories are USER-DEFINED, so the domain is genuinely open and catalog completeness is impossible by construction rather than by omission. Its own comment says so at :131-132 and it falls back to capitalize(cat) — a humanizing transform — not to a machine token. This is the correct shape for an open domain and is the precedent §4 step 1 points at; counting it would ratchet the right answer."
        }
      ],
      "baseline": { "files": 5, "matches": 7 },
      "floor": 4000
    },
    {
      "id": "unverifiable-catalog-lookup-positive-control",
      "goldenPath": "docs/concepts/golden-paths/translation-completeness.md",
      "title": "CONTROL — the same anchor pointed at the COMPLIANT form: an open-domain token resolved through tokenLabel()",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\b(?:tokenLabel|tToken)\\s*\\(",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "CONTROL, NOT A GATE — no baseline, so the merger skips it. Same anchor as unverifiable-catalog-lookup ('resolve a display label from a key that is open at runtime') pointed at the COMPLIANT resolution: tokenLabel(t, category, token) / its tToken alias (src/i18n/tokenMaps.ts:35,:61), which centralises the fallback and emits a once-per-token DEV warning at :40-49. Measured 42 matches / 32 files against the violating form's 7 / 5, so the anchor PARTITIONS: 86% of open-domain label resolution in this repo already goes through the sanctioned primitive and 14% hand-rolls a cast. A control returning ~0 would mean the pattern is not discriminating on what the rule claims — that there is a sanctioned destination these 7 sites are bypassing. It returns 42, so the destination exists, is adopted, and the violations are bypasses rather than the only available option. Note the raw grep count is 48; ignoreCommentLines drops the 6 occurrences inside tokenMaps.ts's own docstring and export line, which is the correct code-only count."
      },
      "floor": 4000
    }
  ]
}
```

**Measured result:**

```
  rule                    files   base  matches   base  walked  floor
  OK   unverifiable-catalog-lookup                   5      5        7      7    4829   4000
  OK   unverifiable-catalog-lookup-positive-control 32      —       42      —    4829   4000
  census OK — 2 rule(s), 9658 file-visits, 49 surviving violation(s) across 37 file(s).
```

`floor: 4000` sits below the observed 4,829 `.ts`+`.tsx` under `src` with margin, matching the
existing `raw-select` and `discarded-toast-copy` rules that walk the same tree.

### How it fails loudly if its own precondition is absent

Not asserted — **induced**, against the real working tree, exit codes captured:

| induced fault | exit | runner says |
| --- | :---: | --- |
| (unmodified) | **0** | `census OK — 2 rule(s), 9658 file-visits` |
| `pattern` → a token appearing nowhere | **1** | `[structural] matched zero files anywhere. A census rule that finds nothing is a broken regex far more often than a finished migration.` |
| `floor` → 9000 | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| baseline inflated (a silent drop) | **1** | `[drift] files dropped 80 -> 5 (-75) without the baseline moving.` |
| baseline deflated (a rise) | **1** | `[drift] files rose 2 -> 5 (+3). New violations of …translation-completeness.md` |
| `exclude` path renamed | **1** | `[structural] exclude "…usePickerFiltersMOVED.ts" matched no file. The exemption is stale` |
| `exclude` `reason` removed | **1** | `exclude[0] … needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |
| `roots` renamed away | **1** | `[structural] walked 0 files but floor is 4000` |
| `extensions` → `.svelte` | **1** | `[structural] walked 0 files but floor is 4000` |

### Sequencing

1. **`unverifiable-catalog-lookup` immediately**, and fix `en.kpis.measurement_source` in the same
   change — add the `'ai-compose'` arm to all 14 locales. The rule's 7 sites otherwise have a
   destination (`tokenLabel`) but the D2 site would still print a raw token, and a ratchet on a
   defect whose data is still wrong teaches people the rule is cosmetic.
2. **Extend `check-route-sections.mjs` from union to per-route** (Gap 1, ~15 lines, all inputs
   already computed). Baseline the 26 pairs with dated reasons, then burn down starting with
   `overview` on `home` — 13 files, 86 keys, the default landing screen.
3. **Table-drive `chainStopReasons.parity.test.ts` across the other 25 token categories**, one row
   per category naming its domain's `file:line`, `null` + a dated reason where no domain is
   enumerable, and the table **driven off `Object.keys(en.status_tokens)`** so a new category cannot
   quietly skip enrolment. This is the instrument for P1/P2 and the repo already owns it.
   **Land it as an enumeration first and a fix second.** The diff in D3 says why: 36 arms are
   missing but only 13 are live, 8 categories have no consumer at all, and two of those
   (`healing_status`, `connector_status`) are keyed on stale or wrong vocabularies — so
   "add the missing arms" is the wrong first move and would ship new dead labels in 14 locales.
   Baseline the 36, fix the 13 that render, and delete or re-point the dead categories separately.
   **Do not seed the domain column from
   [`status-and-severity-badges.md:277`](./status-and-severity-badges.md)** — that table is inferred
   from member overlap, its own document says so at `:286`, and it is wrong on at least two rows.
   Start with `thinking.xhigh`: one arm, already translated in 14 locales under a different key
   (`models.effort_xhigh`), rendering raw in the file the corpus holds up as exemplary.
4. **Make the pre-push `i18n-coverage` job `--strict`.** One word in `lefthook.yml:78`. It is
   currently 0 missing / 0 extra, so the change is free today and closes D6's CI-side hole
   permanently. **This is the single cheapest item in the document.**
5. **Extract `ChartErrorBoundary`'s fallback into a function component** that calls
   `useTranslation()`, mirroring `ErrorBoundary.tsx:33`/`:76`, and move `Retry` into `common`
   (the key exists). Closes Gap 3 and both of `ChartErrorBoundary`'s defects.
6. **Rename `no-module-scope-en-value`'s condition from scope to purpose** — the hazard is "reading
   the `en` shim for something that renders", at any scope (D5). At minimum, correct its doc comment
   at `:39-40`, which currently asserts something false about the shim.
7. **Add the DEV-only getter warning from Gap 4** — one console line when a section is requested
   outside `sectionsForRoute(currentRoute)`. No load, no render storm, and it makes all 26 pairs
   visible the first time anyone runs the app in a non-English locale.

---

## Type over gate — the answer

**The generated type is real, it works, and it is closed around the wrong set. That sentence is the
whole leaf.**

**1. What it does catch.** `scripts/i18n/gen-types.mjs` codegens `src/i18n/generated/types.ts` from
`en.json`, so `t.agents.nosuchkey` is a **compile error**, not a runtime blank. The evidence it
holds is strong: 19,112 keys, 13 locales, 0 missing, 0 extra, and only 118 orphans — and
`personas-web` reinvented the identical guarantee by hand (`interface Translations`, its `en.ts:1`).
**Closing the key space is physics.**

**2. What it cannot catch, and why it is not a gap that a stricter type fixes.** The type is
**derived from `en.json`**. Its `measurement_source` member is a closed object type with exactly
five named properties — a perfectly good type, faithfully encoding a catalog that is short an arm.
This is doctrine Q1 exactly: *a closed type carries only what it actually encodes.* The union
`'evaluator' | 'manual' | 'scan' | 'health_snapshot' | 'simulation'` is a correct description of the
catalog and says nothing about the database. **P8: a type generated from the artifact it is meant to
constrain cannot constrain that artifact.**

Three further reaches it does not have:

- **A cast reopens it.** 7 sites (D4). This is the one class a *gate* is right for, and it is the
  census rule.
- **It cannot see the delivery layer at all.** `t.overview.cockpit.briefing_title` type-checks
  perfectly and renders English on the home route in 13 languages (D1). No signature exists for
  "was this section fetched"; the value crosses no parameter.
- **It cannot see a string that never became a key** — the other path's half.

**3. The type change that would actually close C3, and it is a codegen change, not a signature
change.** Invert the derivation for the maps whose domain is closed: type the catalog map from the
**domain**, not from the catalog.

```ts
// today — derived from en.json, so it encodes the hole
measurement_source: { evaluator: string; manual: string; scan: string;
                      health_snapshot: string; simulation: string };

// closed against the domain — the ts-rs binding is already generated
measurement_source: Record<KpiMeasurementSource, string>;
```

`Record<Union, string>` is **exhaustive**: omit `'ai-compose'` and the object literal in `en.json`'s
generated shape fails to satisfy it. No test, no gate, no baseline — a compile error at the moment
the migration widened the CHECK. `gen-types.mjs` would take a small declarative table
(`status_tokens.<category>` → the binding to key it by), and the 26 categories in `status_tokens`
are exactly the inventory for it. **This is the same move `chainStopReasons.parity.test.ts` makes at
runtime, moved to compile time and generalized** — and it is available today for every category
whose domain has a ts-rs binding.

**4. And the honest limit.** `chain_stop`'s domain is `pub mod stop_reason` string consts and
`reason_token` is a raw `String` column — **there is no binding to key on**, which is precisely why
its author wrote a mirrored test instead. So the answer is layered, and the layering is the
prescription: **derive the type from the domain where a binding exists; mirror the domain in a
set-equality test where it does not; and gate the casts that reopen either.** The census rule holds
the third line while the first two land.

The general form, and it is the mirror of what [`metric-definition`](./metric-definition.md) found:
there, a correctly-closed union failed to prevent a bug because the hazard lived in the number
beside the tag. **Here the type is closed around the catalog when the hazard lives in the domain
beside it.** Both are Q1. In this repo the fix is unusually cheap, because the domain is already
generated into TypeScript and nobody thought to point the catalog's type at it.
