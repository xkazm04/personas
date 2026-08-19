# Golden path — Shared component boundary

> Situation node: `platform-delivery/testing-and-workflow/shared-component-boundary` · [situation spine](../situation-spine.md)
> recurrence **3** · risk **LOW** · sides **server** · convergence **converged** · `twoSided: true`
> dimensions: **ui · code-quality**
> Leaf definition: *"Whether a new primitive belongs in the shared catalog, chrome, or its feature."*
> Composed 2026-08-17 against `master` @ `dfd846b3b`. **Short form** (spine header, §0, §2, §7,
> §9, §12) per the runbook's Mode 2 tiering — `risk: low`.
>
> **Sweep.** Every `.ts`/`.tsx` under `src/features/shared/` — **166** files in `components/`
> (149 non-test), **35** in `chrome/`, **50** in `glyph/`, **1** each in `charts/` and
> `dispatch/`. `eslint.config.js:165-206` (the boundary rule, read clause by clause),
> `src/features/shared/components/CATALOG.md` (128 rows), `scripts/docs/gen-shared-catalog.mjs`
> (the `CURATED` map), and `.claude/CLAUDE.md:141-175`.
>
> **Measured three ways, and all three agree exactly.** A bespoke import-graph walk, the shipped
> ESLint rule executed over the directory with `--format json`, and a census pattern in a
> private scratch registry all return **13 violating imports across 3 files** — same sites, same
> lines. Exact three-way agreement on membership is rare enough in this campaign to be worth
> stating; §12.2 records the one place they did diverge and why.

---

## 0. Headline

**The boundary is almost perfectly observed and it is pointed at the wrong question. 146 of 149
non-test files in the catalog are clean; every violation in the directory — all 13 imports — is
one component tree, `modals/ExecutionDetailModal/`, which is not a primitive and never was. It
is a domain modal shared by two features, and the taxonomy the rule enforces has no bucket for
that. So it sits in the catalog, warns forever, and cannot be moved without breaking four
importers.**

Three independent instruments, same answer:

```
impl A (bespoke import walk):  13 sites / 3 files / 149 non-test files
impl B (eslint --format json): 13 no-restricted-imports, all severity 1 (warn), 3 files
impl C (census pattern):       3 files / 13 matches over 166 walked
```

```
DataDiffSection.tsx:4         @/api/overview/executionJournal
DataDiffSection.tsx:5,6,7     @/lib/bindings/{ExecutionDataDiff,ExecutionJournalEntry,UndoExecutionResult}
DataDiffSection.tsx:8         @/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock
ExecutionDetailContent.tsx:7  @/stores/agentStore
ExecutionDetailContent.tsx:10-13  @/features/agents/sub_executions/detail/{inspector/HighlightedJsonBlock,
                                   ErrorExplanationCard,views/ExecutionMemories,views/ExecutionLogViewer}
ExecutionDetailModal.tsx:1    @/features/overview/components/dashboard/widgets/DetailModal
ExecutionDetailModal.tsx:2    @/features/agents/sub_executions/detail/ExecutionDetail
ExecutionDetailModal.tsx:5    @/lib/bindings/PersonaExecution
```

The rule names four forbidden groups and this one tree hits **all four** — `@/api`, `@/stores`,
`@/lib/bindings`, and `@/features/<other>`. It is not a near-miss. And it is in the catalog for a
comprehensible reason: it has **four importers across three features** —
`agents/sub_activity/ActivityModals.tsx:11`,
`agents/sub_executions/detail/ExecutionDetail.tsx:10`,
`overview/sub_activity/components/GlobalExecutionList.tsx:18`, and
`overview/sub_activity/components/LlmCallsTable.tsx:14`. Someone had a component two features
needed, and `shared/components/` is where this repo puts things two features need.

**That is the leaf's actual finding: the taxonomy is missing its middle term.**
`.claude/CLAUDE.md:141-159` offers three destinations — the catalog (domain-agnostic
primitives), `shared/chrome/` (app-shell chrome), or the owning feature. A component that is
**domain-coupled and shared by several features** fits none of them. There is no fourth choice
in the doc, so it lands in the catalog and generates thirteen permanent warnings that name a
real coupling and prescribe an impossible fix ("pass data via props" — through four call sites,
for a modal that fetches its own journal).

The tree has already answered the question the doc has not. `src/features/shared/` holds **five**
top-level buckets, not two:

| bucket | files | restricted-shape imports | governed by the rule? | in `CLAUDE.md`? |
| --- | --- | --- | --- | --- |
| `components/` | 149 | **13 / 3 files** | **yes** | yes |
| `chrome/` | 31 | 94 / 25 files | no | yes |
| `glyph/` | 50 | 9 / 8 files | **no** | **no** |
| `dispatch/` | 1 | 2 / 1 file | **no** | **no** |
| `charts/` | 1 | 0 | **no** | **no** |

`chrome/`'s 94 are correct by design — app-shell code is supposed to hold app state. But
`glyph/` is a **50-file library that nobody has classified**: it is not chrome, it is not
domain-agnostic (it imports `@/features/agents/sub_use_cases/...`, `@/features/templates/...`,
`@/features/vault/...`, `@/stores/themeStore`), it is not in the catalog, it is in no
documentation, and it is outside the one rule that would have an opinion. **It is the missing
bucket, already built, unnamed.** So is `ExecutionDetailModal`, filed in the wrong one.

Finally, and this is why the numbers matter less than they look: **`eslint.config.js:176` sets
this rule to `"warn"`, and per the doctrine a warn-level rule enforces nothing at either gate at
any count.** `npm run check` runs `eslint src/` with no `--max-warnings`; pre-commit runs
`--quiet --max-warnings 99999`, and the disarming token is the `99999`, not the `--quiet`. The
config's own comment is honest about it — *"This is an ADVISORY warning, not a build gate"*
(`:168-170`). Thirteen warnings and thirteen thousand would produce identical exit codes.

---

## 2. The one way

**Decide by what the component may *import*, never by who uses it — and if the honest answer is
"it needs app state and two features need it", that is a fourth bucket, not a catalog entry.**
Concretely: (a) **A component belongs in `shared/components/` only if it can be written against
props alone** — no `@/stores`, no `@/api`, no `@/lib/bindings`, no `@/features/<other>`, no
`@tauri-apps` runtime. Reuse across features is *not* the test; a domain modal used by four
features is still domain code. (b) **If it is app-shell furniture** — sidebar, titlebar, footer,
command palette, notification centre — it goes in `shared/chrome/`, where holding app state is
the point and no boundary applies. (c) **If it is domain-coupled and genuinely shared, give it a
named home rather than smuggling it into the catalog.** This repo already has two such homes
(`shared/glyph/`, `shared/dispatch/`); the work owed is to *name* the category, document it in
`CLAUDE.md` beside the other two, and put `ExecutionDetailModal` in it — not to keep pretending
it is a primitive. (d) **Add a `@catalog <one-line>` JSDoc tag when you add a primitive**, because
the generator's fallback is the first sentence-ish fragment it can find and it produces rows like
`useShakeError | the .` (§7 D3). (e) **Do not put a description in the `CURATED` map in
`scripts/docs/gen-shared-catalog.mjs` unless you also own keeping it true** — that map overrides
source extraction, so a wrong entry there is unfixable by regeneration, which is exactly how
`LoadingSpinner` shipped as "canonical loading spinner" while rendering `null` for months.
(f) **Do not argue for the boundary from the warning count.** Thirteen is not "under control";
it is *unmeasured*, because nothing fails on it. If the boundary is worth having, ratchet it
(§9); if it is not, delete the rule rather than leaving an advisory that reads like enforcement.

> **Read alongside two neighbours.** [`plugin-surface-shell`](./plugin-surface-shell.md) §7 D10
> measured the mirror image — 10 of 10 plugin shells import `@/stores` and **no rule governs
> `features/plugins/**` at all** — and its §12.1 records that the boundary question inverts:
> reach *outward* from a feature is conventional here; reach *inward* to a primitive is what this
> rule is about. [`custom-lint-rule`](./custom-lint-rule.md) owns the severity decision this
> path's §9 declines to make unilaterally.

---

## 7. Deviations

Six.

### D1 — every violation in the catalog is one tree, and it has nowhere to go · measured three ways

13 imports, 3 files, all under `src/features/shared/components/modals/ExecutionDetailModal/`,
hitting all four forbidden groups (site list in §0). Four importers across three features.

The rule's own message prescribes the fix: *"Pass data via props, or move this file to its owning
feature / `src/features/shared/chrome/`."* Neither branch works here. Props: `DataDiffSection`
calls `@/api/overview/executionJournal` itself and renders `UndoExecutionResult`; threading that
through four call sites relocates the coupling into four features instead of one file. Chrome:
this is not app-shell furniture. The third option — its owning feature — would make
`overview/sub_activity` import from `agents/sub_executions` or the reverse, which is the coupling
the boundary exists to prevent, just moved.

**A gate whose only remediation paths are all wrong for its only violation is not measuring what
it thinks it is.** The finding is the missing bucket (§0), not the three files.

### D2 — 50 files in a sibling bucket nobody classified, governed by nothing

`src/features/shared/glyph/` — `CapabilitySigil`, `ChannelTotem`, `ConnectorTotem`, `GlyphCard`,
`GlyphGrid`, `DimensionPanel`, `persona-sigil/`, `dimArt/`, `glyphs/` and more. **50 files, 9
restricted-shape imports across 8 of them**, including `@/stores/themeStore`,
`@/features/agents/sub_use_cases/.../displayUseCase`, `@/features/templates/sub_diagrams/ActivityDiagramModal`
and `@/features/vault/components/VaultConnectorPicker`.

It is not in `CATALOG.md`, not in `.claude/CLAUDE.md`'s three-way taxonomy, and outside
`eslint.config.js:172`'s `files:` glob. So the repo's largest shared-but-domain-coupled library
is invisible to every instrument that exists for exactly that question. `shared/dispatch/`
(1 file, 2 imports) and `shared/charts/` (1 file, 0) are in the same position at smaller scale.

**If the boundary rule's glob were `src/features/shared/**` minus `chrome/`, its anchor would be
22 sites, not 13** — and the eleven it does not see are the ones nobody has ever had to think
about.

### D3 — 8 of 128 catalog rows describe the component with a fragment of its own source

`CATALOG.md` is generated: a `@catalog` JSDoc tag wins, else the `CURATED` map, else a fallback
extraction. Where all three miss, the fallback emits whatever it found:

| row | published description |
| --- | --- |
| `useShakeError` | `the .` |
| `useAsyncFieldValidation` | `link .` |
| `ExecutionDetailModal` | `a single execution.` |
| `DataDiffSection` | `Undo this run" action.` |
| `useSectionScrollSpy` | `auto/scroll/overlay), else null.` |
| `PromptTemplateRenderer` | `variable}} placeholder highlighting via inline code styling.` |
| `DropZoneGlow` | `rounded-card (8) / rounded-modal (12) so the SVG outline aligns.` |
| `EstimatedProgressBar` | `if (progress < 75) return 'hsl(var(primary) / 0.` |

The last is a fragment of a `return` statement. This is the artifact `.claude/CLAUDE.md` tells
every developer to read *before writing any UI*; 6% of its rows do not describe anything. Fixed
per row by a `@catalog` tag plus `npm run gen:catalog` — a doc-only change, but eight of them,
so recorded rather than applied piecemeal.

### D4 — the rule's forbidden-import globs miss the barrel form; there are simply no barrel importers today

`eslint.config.js:191` forbids
`["@/stores/*", "@/stores/**", "@/api/*", "@/api/**", "@/lib/bindings/*", "@/lib/bindings/**"]`.
Under the gitignore-style matching `no-restricted-imports` uses for `group`, both `a/*` and
`a/**` require a slash after `a`, so **the bare barrel paths `@/stores`, `@/api` and
`@/lib/bindings` match neither.**

I expected this to be the headline and it is not: **measured, zero files in
`shared/components/` import a barrel form.** All 13 violations are deep paths and the shipped
rule catches 13 of 13. So the hole is **latent, not occupied** — which matters because the barrel
import is the dominant form elsewhere in the app (`plugin-surface-shell` §7 D10: 10 of 10 plugin
shells write `from '@/stores'`), so the first `import { useSystemStore } from '@/stores'` written
in a primitive would be invisible. Adding `"@/stores"`, `"@/api"`, `"@/lib/bindings"` to the
group is a two-line config change that cannot change today's output — recorded rather than
applied only because it edits a lint config the operator's editor reads live.

### D5 — the boundary is warn-level, and 13 warnings are indistinguishable from 13,000

`eslint.config.js:176` — `"no-restricted-imports": ["warn", …]`. Executed over the directory:
**46 messages, 0 errors, 46 warnings**, of which 13 are the boundary and the rest are
`custom/no-low-contrast-text-classes` (16), `custom/no-hardcoded-jsx-text` (15) and
`custom/prefer-status-badge` (2).

`npm run check` ends in `eslint src/` with no `--max-warnings`, so it exits 0 regardless.
Pre-commit runs `--quiet --max-warnings 99999`; per `commit-path-gates`'s fault injection the
disarming token is the number, not `--quiet` (`--quiet --max-warnings 0` exits 1). **So the
count is not a health signal in either direction** — the directory could double its violations
without any gate noticing, and the fact that it has not is evidence about the authors, not about
the rule.

The config comment is candid about this being deliberate: *"the catalog is a recommended
reference, not enforced"*. Fair. But `.claude/CLAUDE.md:159` describes the same rule as something
that "**warns** (advisory, non-blocking)" in one breath and the catalog as the thing to check
"before you write any UI" in another, which reads to a new contributor as a soft gate. It is not
a gate at all.

### D6 — cleared claims

- **`ExecutionDetailModal` is not an accident of naming.** It genuinely serves three features,
  and the three files are internally coherent. The defect is its address, not its existence.
- **`chrome/`'s 94 restricted-shape imports across 25 files are correct.** Sidebar, titlebar,
  footer, command palette and notification centre are supposed to read app state; the rule
  deliberately does not govern them, and `.claude/CLAUDE.md` says so. Counting them as violations
  would be the mistake.
- **The catalog is not stale.** `npm run gen:catalog` runs in `predev`/`prebuild`, and
  `CATALOG.md`'s 128 rows match the tree. What is wrong is 8 descriptions (D3), not the census.
- **`LoadingSpinner`'s catalog row is already correct**, contrary to my brief — see §12.1.

---

## 9. The gate

One rule and its positive control, validated standalone in a composer-private scratch registry
(`rules-testworkflow-b7f2.json` — filename unique to this composer), then re-extracted from this
document and re-run to identical numbers. **The full registry was not run**; that is the
orchestrator's step.

**The condition the signal is a proxy for, stated stack-free:** *a module in a layer declared
dependency-free imports from a layer above it.* In this stack that is a TSX import specifier
under one directory; in a Rust workspace it is a crate dependency edge, in a Python package an
absolute import — every stack has its own spelling, and the adopting repo writes its own.

**Why a census rule when an ESLint rule already reports these exact 13 sites.** Because the
ESLint rule is `"warn"` and, per §7 D5, warn enforces nothing at either gate at any count. The
census runs on **pre-push** (`lefthook.yml`) and inside `npm run check`, and it fails on a
**rise**. Adding this rule at today's baseline therefore converts an advisory into an actual
ratchet **without changing the ESLint severity** — which would be a behaviour change to what the
operator's editor and pre-commit hook do, and is on the note-it side of the standing rules. The
two compose exactly as the contract describes: the lint rule reports and teaches at authoring
time, the census holds the line.

```json
{
  "id": "catalog-boundary-escape",
  "goldenPath": "docs/concepts/golden-paths/shared-component-boundary.md",
  "roots": ["src/features/shared/components"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "from\\s*['\"]@/(?:stores|api|lib/bindings)(?:['\"]|/)|from\\s*['\"]@/features/(?!shared['\"/])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a domain-agnostic catalog primitive importing app state, IPC, a generated binding, or another feature. PROXY FOR the stack-free condition: a module in a layer declared dependency-free imports from a layer above it. Mirrors eslint.config.js:189-197, which reports the same 13 sites at \"warn\" and therefore fails nothing — `npm run check` passes eslint with no --max-warnings and pre-commit passes --max-warnings 99999. Unlike the lint rule, this pattern also catches the BARE barrel forms (`@/stores`, `@/api`, `@/lib/bindings`), which the rule's `a/*` + `a/**` globs cannot match; there are zero such imports today, so the baseline is unchanged and the first one written will raise it."
  },
  "baseline": { "files": 3, "matches": 13 },
  "floor": 100
}
```

```json
{
  "id": "catalog-boundary-escape-positive-control",
  "goldenPath": "docs/concepts/golden-paths/shared-component-boundary.md",
  "roots": ["src/features/shared/chrome"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "from\\s*['\"]@/(?:stores|api|lib/bindings)(?:['\"]|/)|from\\s*['\"]@/features/(?!shared['\"/])",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL - the IDENTICAL predicate in the sibling bucket where the same import is correct by design. App-shell chrome is supposed to hold app state; the boundary deliberately does not govern it. Partitions src/features/shared/ by the only thing that distinguishes the two buckets, which is the rule's `files:` glob and not anything about the imports themselves."
  },
  "floor": 25
}
```

**Baseline, as run:** gate **3 files / 13 matches** over **166** walked (floor 100); control
**26 files / 77 matches** over **35** walked (floor 25).

**The control is the strongest form the doctrine asks for, and it is unusually informative
here.** It is not "the compliant spelling of the same construct" — it is *the same construct,
byte for byte, in the directory next door, where it is correct*. 77 legal instances against 13
illegal ones, separated by nothing but which `files:` glob the linter was given. That is a
77-vs-13 partition **and** an argument: the boundary is a property of the *address*, not of the
code, which is why §0's prescription is about naming a fourth address rather than rewriting three
components.

**Hand-verified precision: 13/13.** Every site was printed with its specifier and opened; all
thirteen are genuine cross-layer imports. Independently corroborated by ESLint's own AST-based
`no-restricted-imports` returning the same 13 `file:line` pairs — a regex and a parser agreeing
on membership, not just on a count.

**Overlap, measured at SITE level against the FINAL pattern.** **84** registered census rules
have roots and extensions that reach `src/features/shared/components`. Each was replayed over
the directory and its `file:line` sites intersected with this rule's:

| neighbour rule | its sites in this root | site overlap |
| --- | --- | --- |
| `typo-token-overpainted` | 41 | **0** |
| `native-title-tooltip` | 29 | **0** |
| `frozen-ui-copy-constant` | 24 | **0** |
| `hand-rolled-disabled-state` | 21 | **0** |
| `raw-web-storage` | 17 | **0** |
| `hand-rolled-spinner` | 12 | **0** |
| …27 further rules with ≥1 site here | — | **0** |

**Maximum site overlap across all 84: zero.** No registered rule keys on an import specifier
except `verdict-write-outside-door` (a named-function allowlist rooted at `src`, 0 sites here)
and two `import.meta.env` rules. **No census rule roots anywhere under `src/features/shared/`
today**, so this is also the registry's first entry in that subtree.

**Fault injection — verified by exit code, never through a pipe.** The gate/control pair was
driven through the runner's seven failure modes in a synthetic scratch corpus and against the
real tree: correct baseline → `exit 0`; a rise → `exit 1`; a silent drop → `exit 1`; a floor
breach → `exit 1`; an empty root → `exit 1` (reported as a drop to zero); a positive control
declared **with** a `baseline` → `exit 1` from `validateRule` (*"a positive control must NOT
carry a baseline"*); the real repo at the published numbers → `exit 0`. Near-misses that must
**not** match were checked in the pattern's own construction: `from '@/features/shared/…'`
(the escape hatch, 6 such imports in `glyph/` alone), `from '@/lib/utils'`, `from '@/i18n/…'`,
and `from './relative'` — none matches.

**What this gate cannot do.** It cannot see D2 (`glyph/` is outside its root by the same
arbitrary line the ESLint rule draws), it cannot see D3 (a catalog row's description quality is
not a count of anything), and it cannot express the thing §0 actually wants — *does every shared
component have a declared home?* That last is an **inventory comparison**: enumerate the
directories under `src/features/shared/`, compare against the set `CLAUDE.md` documents and the
set the lint config governs, and fail when a directory is in neither. It is ~25 lines with an
exit-2 guard if it finds fewer than 3 buckets, and it would have surfaced `glyph/`, `dispatch/`
and `charts/` the day each was created. Registered as **deferred fix #75**.

---

## 12. Corrections

### 12.1 — to the brief: the `LoadingSpinner` row was fixed four days ago

The brief stated that `CATALOG.md`'s `LoadingSpinner` row *"is **wrong on both halves**
('Canonical loading spinner… use for any full-element loading state' — it renders `null`)"*, that
the text is hardcoded in the `CURATED` map at `scripts/docs/gen-shared-catalog.mjs:56` so
*"regenerating the catalog will not fix it"*, and offered the correction as *"an owed follow-up
you may apply"*. `.claude/CLAUDE.md` carries the same warning in a blockquote.

**It is already correct.** `gen-shared-catalog.mjs`'s `CURATED.LoadingSpinner` now reads:

> *"RENDERS NOTHING. Spinners are disabled app-wide; this survives for import compatibility and
> emits an sr-only `role="status"` only when given `label`. Never use it as a visual loading
> state — for a SURFACE use a calm delayed ghost (docs/design/overview-loading.md), for an ACTION
> use Button/AsyncButton, which render real spinners by design."*

and `CATALOG.md:97` carries it verbatim. Landed **2026-08-13** in `ddeb19cc0`,
*"fix(catalog): the one line that manufactured 184 hand-rolled spinners"*. The brief's mechanism
was exactly right — a `CURATED` entry overrides source extraction and survives regeneration —
which is presumably how the fix was aimed correctly. **The stale artifact is the warning, not the
row**, and it is still live in `.claude/CLAUDE.md`, where it tells every session in this repo
that a corrected doc is wrong. Recorded rather than applied: it is a same-file edit to a document
five concurrent composers have loaded.

### 12.2 — to `.claude/CLAUDE.md`: ~115 primitives is 128, and the three-way taxonomy is five-way

`.claude/CLAUDE.md:146` says *"**~115 reusable, domain-agnostic primitives** under
`src/features/shared/components/`"* and `:159` cites *"the 2026-06-18 curation (206→115)"*.
`CATALOG.md`'s generated header says **128**, and the generator runs on every `predev`/`prebuild`.
The curation figure is correct as history; the standing figure has drifted by 13 and the doc has
not moved with it. A generated count and a hand-maintained count of the same set is a drift pair
with no gate, which is the shape `cross-artifact-drift-gate` owns.

The larger correction is §0's: `:141-175` presents **three** destinations for a new component,
and `src/features/shared/` has **five** buckets, two of which (`glyph/` at 50 files, `dispatch/`)
are domain-coupled shared code — the category the three-way split says does not exist. Both are
doc edits and both are recorded rather than applied, for the same concurrent-composer reason.

### 12.3 — my implementations agreed on the gate and disagreed on the control

Three instruments returned **13 sites / 3 files** for `components/` with identical membership —
a bespoke regex import walk, ESLint's AST rule, and the census pattern. That is stronger than a
matching count, and it is the reason §7 D1 is stated without hedging.

They diverged on the **control**: my bespoke walk reported `chrome/` at **94** sites / 25 files;
the census pattern reports **77** / 26. The gap is a deliberate scope difference, not an error —
my walk also matched dynamic `import('@/…')` and `export … from` forms, which the census pattern
(anchored on `from\s*['"]@/`) does not, and my walk excluded `.test.tsx` files while the census
walked them. Both are right about what they measure. **Published: 77/26 from the census**, since
that is the number the rule will ratchet, with 94 kept in §0's table because the design question
"how much app state does chrome hold" wants the wider definition.

I also predicted, before measuring, that the rule's `@/stores/*` + `@/stores/**` globs would be
leaking barrel imports at scale, by analogy with `plugin-surface-shell`'s finding that 10 of 10
plugin shells import `@/stores`. **Measured: zero barrel imports in the catalog, and the shipped
rule catches 13 of 13.** The hypothesis was wrong and testing it was still worth it — it turned a
would-be headline into D4, a latent hole with a two-line fix and no current occupants, which is a
much more useful thing to hand the next contributor than a false alarm.

### 12.4 — spine labels

**`sides: "server"` is contradicted, and inverted.** Every artifact here is client-side:
166 `.tsx` files, an ESLint config, a generated markdown catalog, a node generator script.
Nothing in `src-tauri/` participates. This is the eighth recorded `sides` contradiction.

**`twoSided: true` is contradicted.** There is no server half. The nearest thing is
`@/lib/bindings/*`, which is a *generated projection* of Rust types, and the four binding imports
in `DataDiffSection` and `ExecutionDetailModal` are violations precisely *because* they drag a
backend contract into a layer that should not know one — that is the client half of the boundary,
not a second side of it.

**`convergence: converged` was not tested.** The short-form tier does not include a sibling
sweep. Recorded as untested rather than silently omitted. One in-repo comparison is worth stating
in its place, because it is the same author solving the same problem twice with opposite results:
this boundary governs `shared/components/**` and is 98% observed, while
[`plugin-surface-shell`](./plugin-surface-shell.md) §7 D10 measured that **no rule governs
`features/plugins/**` at all** and 10 of 10 shells import `@/stores`. Same repo, same week, same
concept, one directory with a rule and one without — and the difference in outcome tracks the
rule's *existence*, not its severity. That is a weak-but-real argument that even an advisory rule
changes authoring behaviour through editor squiggles, which is exactly the distinction the
doctrine draws between adoption pressure and enforcement.
