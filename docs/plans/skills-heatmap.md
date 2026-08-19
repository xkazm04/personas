# The Skills coverage heatmap, now that a registry exists

**Status:** design. One thing here is implemented (§4, the row source); everything
else is a proposal for the operator to pick from.
**Date:** 2026-08-19.
**Surfaces:** `src/features/plugins/dev-tools/sub_skills/` (Skills module) and
`sub_workspaces/registry/` (knowledge-registry wiring).

---

## 1. What exists today

### 1.1 The page and its four tabs

`SkillsManagerPage.tsx:67` holds one piece of state — `'overview' | 'analytics' |
'registry' | 'trace'` — and lazy-mounts one surface per tab
(`SkillsManagerPage.tsx:36-39`). Three of the four labels come from i18n; the
fourth does not:

```tsx
// SkillsManagerPage.tsx:82-85
{ id: 'overview',  label: t.plugins.dev_tools.skills_tab_overview },
{ id: 'analytics', label: t.plugins.dev_tools.skills_tab_analytics },
{ id: 'registry',  label: 'Registry' },          // ← hardcoded English
{ id: 'trace',     label: t.plugins.dev_tools.skills_tab_trace },
```

`skills_tab_overview` / `_analytics` / `_trace` exist at `src/i18n/locales/en.json:13825-13828`.
**`skills_tab_registry` does not exist.** The tab was added after the i18n pass
and nobody came back for it, which is exactly the failure `custom/no-hardcoded-jsx-text`
warns about and never blocks (warn-level; see CLAUDE.md § Pre-existing Issues).

### 1.2 The "Registry" tab is a coverage matrix, and it has two axes

`registryTypes.ts:1-14` is the authority on the shape. One component, two
column axes:

| axis | columns | denominator | empty cell | mounted by |
| --- | --- | --- | --- | --- |
| `workspace` | the workspace's **projects** | contexts in the project | **adopts** the skill there | Dev Tools → Skills → Registry (`SkillsManagerPage.tsx:101`) |
| `project` | one project's **context groups** | contexts in the group | **dispatches** the skill there | the Mastermind canvas's Skills modal |

Rows are skills either way. `RegistryTab.tsx:58-60` calls both hooks
unconditionally (rules-of-hooks) and passes `null` to the inactive one so it
never fetches. Rendering is `RegistryHeatmap.tsx` — a GitHub-contribution field:
cell tint = coverage %, a small corner number = 30d invokes
(`RegistryHeatmap.tsx:121,:127-129`).

### 1.3 Where each cell's four facts come from

`useSkillsRegistry.ts` fans out per project in two phases — shape first so the
grid paints with its affordances, telemetry merged in after
(`useSkillsRegistry.ts:81-83`, `:116-117`):

| fact | source |
| --- | --- |
| rows | `listSkillsGlobal()` ∪ `PRESET_SKILLS` (`:105-108`) |
| `adopted` | `listSkills(projectId)` per project (`:85-88`) |
| `coveredUnits` | `memorySkillCoverage(projectId)` — Memory Ledger (`:124`) |
| `invokes30d` | `getSkillUsageOverview()`, `scope === 'project'` rows (`:139-141`) |
| `running` | `listSessions()` ∩ live states, matched by cwd → project root (`:143-149`) |

### 1.4 The registry lanes, and what the app does with them

`registryLinkStore.ts:53-84` models a registry as `1 registry : N workspaces`,
keyed by `owner/repo`, stored in `localStorage` under `devtools.registryLinks.v1`
(`:91`) pending promotion to SQLite (`:19-26`).

`useRegistryLibrary.ts` is the join **project → workspace → registry → `skills/`
lane** (`:45-64`), and `laneRoot()` (`:26-28`) is the single definition of that
path join. `skillsManagerData.ts:115` is the one consumer that uses it today:

```ts
// skillsManagerData.ts:114-115
// Headed at the registry lane when one is wired; the home library otherwise.
listSkillsGlobal(library.libraryRoot)
```

The Rust side takes an explicit root and **refuses to fall back**
(`devTools.ts:1606-1616`): a named library that is not on disk lists EMPTY,
because "showing personal skills under a 'registry' heading is worse than
showing none."

---

## 2. Problem 1 — "Registry" now means two things

Both meanings live inside the Skills module, one screen apart:

* **Registry (the tab)** — a skills × projects coverage matrix. Nothing about
  it is a registry; it is a *heatmap*. The name is a leftover from the older
  "registry of what's installed where" framing.
* **Registry (the noun the rest of the system now uses)** — `xkazm04/ai-registry`,
  a git repo with a `registry.yaml`, four-plus published lanes, a CODEOWNERS
  gate, and a clone on disk. It is wired per workspace, it is what
  `useRegistryLibrary` resolves, and it is what "the registry" means in
  `registryLinkStore.ts`, `skillTasks.ts`, `RegistryWiring.tsx` and the whole
  `sub_workspaces/registry/` directory.

The collision is already producing wrong sentences in the product. The tab's own
empty state reads *"Assign this project to a workspace to see its skills
registry"* (`en.json:14578`) — which now describes something else entirely: a
workspace with no wired registry has a perfectly good coverage matrix, and a
workspace *with* one has a registry that this string is not talking about.

### 2.1 Recommendation — rename the TAB, keep "Registry" for the repo

**Rename the tab to "Coverage".** Leave the git registry alone.

Reasoning, in order of weight:

1. **One term has an external contract; the other has a label.** `registry.yaml`,
   `docs/rkb-profile.md`, `docs/usage-lane.md`, `.personas/registry.yaml`, the
   CODEOWNERS write-path and a second consumer (Ascent) all say "registry" and
   are not ours to rename. The tab label is one string in one file. Rename the
   side that is cheap and locally owned.
2. **"Coverage" is what the surface actually answers.** Its cells are coverage
   percentages against a context denominator (`registryTypes.ts:99-102`); its
   legend's first entry is literally `skills_col_coverage`
   (`RegistryHeatmap.tsx:177`). The name would stop being a category and start
   being a description.
3. **It disambiguates without inventing a third word.** "Coverage" next to
   "Overview / Analytics / Trace" reads as a peer view, and nobody will look for
   a GitHub repo behind it.
4. **The i18n cost of doing it is the cost of fixing §1.1 anyway.** The tab label
   needs a key regardless. See below.

Alternatives considered and rejected:

* **"Adoption"** — accurate for the workspace axis (empty cells adopt) but wrong
  for the project axis, where nothing is adopted and every cell dispatches
  (`registryTypes.ts:9-11`). One component, two axes; the name has to fit both.
* **"Matrix"** — describes the widget, not the question.
* **Rename the git registry instead** (to "Knowledge Library", say) — pushes a
  rename into a public repo and a published contract shared with another
  consumer, to save one label. No.
* **Do nothing and rely on context** — the two meanings are two clicks apart
  inside one module, and one of them already reads wrong in shipped copy.

### 2.2 The i18n bill, measured

The internal key *names* (`skills_registry_*`, 14 keys at `en.json:14572-14600`)
do not need to change — they are identifiers, not copy. What changes:

| change | keys | locales |
| --- | --- | --- |
| new `skills_tab_coverage` (or `_registry`, if only §1.1 is fixed) | 1 new | 14 |
| reword `skills_registry_no_workspace` — it says "skills registry" | 1 edited | 14 |

So **2 keys × 14 locales**, closed with the standard pipeline
(`translate-extract` → per-locale fill → `translate-merge`; CLAUDE.md § Translation
completeness). That is the *whole* cost, and one of the two keys is owed already.

**Not done in this change**, per brief: renaming is the operator's call, and the
cheapest correct order is to decide the name *once* and pay the i18n round trip
*once* — adding `skills_tab_registry` now and `skills_tab_coverage` later pays
it twice and leaves a dead key that `check-coverage.mjs` fails on as an extra.

---

## 3. Problem 2 — two library sources, and the workspace was never missing

### 3.1 The defect

`skillsManagerData.ts:115` reads the library from the wired registry's lane.
`useSkillsRegistry.ts:84` did not:

```ts
const globalSkills = await listSkillsGlobal()      // ← no root: ~/.claude/skills
```

So on a registry-wired workspace, the Overview tab and the Registry tab of the
same page listed two different libraries, and neither said which. On this
machine that is not a subtle drift: `~/.claude/skills` holds **15** skills,
`ai-registry/skills/` holds **3** (`ci-gate-check`, `test-before-commit`,
`agent-guidance-bootstrap`). The two tabs disagree about ~14 of 15 rows.

### 3.2 The stated blocker was wrong

The note carried forward was "that surface has no workspace in scope." It does,
and it always did:

```ts
// useSkillsRegistry.ts:52-60
const { workspaces } = useWorkspaces();
const workspace = (activeProjectId ? workspaceOf(workspaces, activeProjectId) : null)
  ?? workspaces[0] ?? null;
```

The workspace is resolved before the columns are built from it, and a registry
is wired *at* workspace level. Nothing was blocked; the join was simply never
made. **Implemented — see §4.**

### 3.3 Same defect, three more call sites (not fixed here)

`listSkillsGlobal()` with no root also appears at:

* `sub_skills/trace/useSkillTraceModel.ts:111` — and this one *also* already
  resolves its workspace (`:59`, `:68`). Same one-line shape as §4.
* `plugins/fleet/sub_skills/useSkillData.ts:90` — Fleet's own skills panel.
* `teams/.../passport/usePassportData.ts:150` — feeds the improve engine, so the
  adopt/share workbench counts a library that may not be the one it publishes to.

`useProjectRegistry.ts` does **not** call it — project-axis rows are the
project's installed skills — so the project axis is unaffected by any of this.

### 3.4 The row set has to grow, or the fix loses information

Heading the library at a registry *subtracts* rows. For a shelf of adoptable
things that is right. For a coverage matrix it is not: a skill installed in
three projects, with real coverage and real invokes, would vanish from the only
surface that shows where it is. So the fix unions in **everything installed in
any column** — the data was already fetched (`installedByProject`), and a matrix
cannot report coverage of a row it excludes.

### 3.5 The gap the row fix exposes (Phase 2 work, deliberately not done)

**Adopt cannot source from the registry lane.** Two independent lanes, both
hard-wired to `~/.claude/skills`:

* deterministic copy — `install_skill_copy` takes no `library_root` and reads
  `global_skills_dir()` (`src-tauri/src/commands/infrastructure/skill_files.rs:806-810`);
  a miss returns `AppError::NotFound("source skill not found: …")` (`:863-865`).
* the LLM adopt task — `adoptTaskPrompt` writes the source path as
  `~/.claude/skills/${it.name}` when `source === null`
  (`skillTasks.ts:38-40`).

This is **pre-existing and not introduced by §4** — the Overview tab has had it
since `79efb7291` headed its library at the registry, and it is why
`skillsManagerRows.ts:133-134` carries the comment *"the Dev-runner adopt task,
which sources from the user's global library."* What §4 changes is that the
heatmap now *renders adopt affordances* for registry-only rows.

Failure mode is honest and bounded: `RegistryTab.tsx:83-85` catches and shows an
error toast; nothing is written, nothing is corrupted. But it is a click that
cannot succeed, and it should be closed in Phase 2 (§6) by threading
`library_root` through `skill_files_install` and `adoptTaskPrompt` — the same
parameter `write_skill_registry` already took in `fd720f929`.

---

## 4. Implemented: the row source

`useSkillsRegistry.ts` now reads the same library the Overview tab does, and
keeps every row that is installed anywhere in the matrix.

```ts
// the workspace was already resolved above; useRegistryLibrary is keyed by
// PROJECT and re-derives it, so it is handed a project of THAT workspace —
// with no active project the matrix falls back to the first workspace, and
// the rows have to follow the columns into it.
const libraryProjectId = activeProjectId ?? workspace?.projectIds[0] ?? null;
const { libraryRoot } = useRegistryLibrary(libraryProjectId);
...
const globalSkills = await listSkillsGlobal(libraryRoot).catch(…);
const libraryNames = [...new Set([
  ...globalSkills.map((s) => s.name),
  ...PRESET_SKILLS.keys(),
  ...perInstalled.flatMap((r) => r.installed.map((s) => s.name)),   // ← new
])];
```

`libraryRoot` joins the effect's dep list, so wiring or unwiring a registry
re-derives the rows (`useRegistryLibrary` subscribes to the link store, so the
value is reactive).

**Deliberately kept to one file.** The natural home for a workspace-keyed
resolver is `useRegistryLibrary.ts` beside `laneRoot()`, and that was the first
implementation — but a concurrent session is mid-flight in that exact file
(adding `corpusRootFor` for the P3 corpus flip), and committing it would sweep
their uncommitted work. Passing a project of the resolved workspace gets the
same answer through the existing public hook with zero contention. If a
workspace-keyed export is ever wanted, `registryLibraryRootForWorkspace(id)`
delegating to `laneRoot` is the shape.

No strings changed → no i18n work. `npx tsc --noEmit` clean, `eslint` 0 errors.

---

## 5. Should fleet-wide usage be in the matrix?

### 5.1 What the registry actually publishes today — and what it does not

The `usage/` lane is real and specified. `ai-registry/registry.yaml` declares it
as a fifth lane; `docs/usage-lane.md` fixes the file shape
(`usage/<contributor>.json`, `schema: rkb-usage/1`, `skills: { <name>: { invokes,
lastUsed? } }`), and `scripts/check-usage.mjs` gates it. Three properties matter
for this question, and all three are contractual, not incidental:

1. **One file per contributing installation.** Two writers on one value is the
   failure the whole registry is built to avoid, and in git it is also a merge
   conflict on every sync.
2. **`catalog.json` is generated.** `build-catalog.mjs` sums the lane into each
   skill's `invokes30d` and lists `usageContributors`. The catalog is a *view*;
   the usage files are the truth.
3. **No per-project breakdown, ever.** The lane forbids paths, repo names, URLs
   and emails, and `registry.yaml` states `usage_is_aggregate_only: true`. The
   Rust writer enforces it by shape — `dev_tools_write_registry_usage` groups by
   `skill_name` alone and drops `project_id` on the floor (`7b056b893`).

**Three corrections to the brief's framing**, all measured against the live
clone at `C:\Users\mkdol\dolla\ai-registry`:

* `catalog.json` carries `invokes30d` and `usageContributors` **as
  hand-seeded placeholders** — the file's own `_note` says so, `generatedBy` is
  `"hand-seeded"`, and every entry is `invokes30d: 0, usageContributors: []`.
  Nothing real has been aggregated yet.
* **There is no `usage/` directory in the clone.** Personas writes one only as a
  piggyback on a *share* commit (`skillsManagerRows.ts:200-225`), and no share
  has run. The lane is empty by construction, not by accident.
* **Personas has no reader for any of this.** `catalog.json` appears in zero
  files under `src/`. Contribution is one-way today: we write counts out, we
  read nothing back.

`registryLinkStore.ts:40` also lists only four lanes — `knowledge, skills,
practices, memory`. **`usage` is missing**, so pairing cannot report a lane the
registry declares. One-line fix, worth doing whenever the reader lands.

### 5.2 Recommendation — yes, but as a row rail, not a column and not a cell

**Fleet usage does not belong in the matrix body.** The matrix is
skill × *place-on-this-machine*, and fleet usage has no place: it is aggregate
by contract and deliberately carries no project dimension. Any attempt to put it
in a cell has to invent a distribution that the registry refuses to publish, and
a column ("Fleet") would sit in an axis whose denominator is *contexts in a
project* — meaningless for an aggregate.

Put it in the **row header**, beside the existing `adoptedCount/columns.length`
counter (`RegistryHeatmap.tsx:103`), as a second, visually distinct figure:

```
  ⌗ scan-sweep                    3/7   ·   ▁▃▆ 412 ↗ 9
    ^ skill                        ^ this machine   ^ fleet: invokes30d, contributors
```

This is the right shape for three reasons:

1. **It matches the data's grain.** One number per skill is exactly what
   `catalog.json` holds. No invention, no imputation.
2. **It answers a question the local matrix cannot.** "We have not adopted this
   anywhere" and "nine other installations reach for it constantly" is the
   single most decision-changing pair on the page, and today the second half is
   invisible. The inverse — high local coverage, zero fleet contributors — is
   the signal that a skill is ours alone and maybe should not be in the registry.
3. **It keeps the "does not apply" state legible.** `usageContributors: []` means
   *nobody is reporting*, not *nobody uses it*; the lane doc says so explicitly.
   A row-header figure can render "—" for that. A heat cell cannot render
   "unknown" without lying in the same visual channel as "zero".

Two properties to hold onto whichever way it is drawn: **never sum local and
fleet counts into one number** (different denominators, different windows,
overlapping populations — this machine may be one of the contributors), and
**always show `generatedAt` staleness on hover**, because the aggregate updates
only when someone shares.

### 5.3 Prerequisite: a reader

None of this is buildable until Personas reads the registry clone. That is a
small, well-scoped piece — read `<clonePath>/catalog.json`, take
`skills[].{name, invokes30d, usageContributors, version}`, key by name — and it
unlocks more than this heatmap (`version` closes the drift question the Trace
tab already asks). It is Phase 3 below.

---

## 6. Phased order, cheapest useful step first

| # | step | cost | unlocks |
| --- | --- | --- | --- |
| **1** | **Row source + installed-anywhere union.** §4. | 1 file, ~10 lines. **DONE.** | The two tabs of one page stop disagreeing. Everything below assumes it. |
| **2** | Same one-liner at the three other `listSkillsGlobal()` call sites (§3.3), starting with Trace — it already has the workspace. | ~3 files. | The whole module reads one library. |
| **3** | Tab rename + the missing i18n key, decided **once** (§2). Add `usage` to `LANES` while in the area. | 2 keys × 14 locales, one pipeline run. | Kills the collision before more copy is written against the wrong noun. |
| **4** | `catalog.json` reader — `useRegistryCatalog(clonePath)` → `Map<name, {invokes30d, usageContributors, version, contentHash}>`, with the same empty-vs-unwired distinction `useRegistryLibrary` already draws (`:9-13`). | ~1 hook + 1 Rust read, or reuse the existing file read. | §5, plus version-drift for Trace. |
| **5** | Fleet rail in the row header (§5.2), behind "registry wired AND catalog present". | ~1 component change + 2 keys. | The adopt/retire decision gets its missing half. |
| **6** | Close the adopt-source gap (§3.5): `library_root` through `skill_files_install` + `adoptTaskPrompt`. | Rust param + binding + prompt. | Registry rows become adoptable — the last thing that makes a registry-headed matrix fully honest. |

Steps 2 and 3 are independent of 4-6 and of each other. Step 6 is the only one
that touches Rust, and it is last because the failure it fixes is currently
loud, safe and rare, while the ones above it are silent.

---

## 7. Open questions for the operator

1. **Tab name.** "Coverage" is the recommendation. "Adoption" and "Matrix" were
   considered and rejected in §2.1. If none of them, the name should still be
   decided before step 3 so the i18n round trip happens once.
2. **Does step 6 belong before step 5?** Fleet usage tells you *what to adopt*;
   the adopt-source fix makes *adopting it* work. Doing 5 first makes the page
   better at recommending something it then cannot do.
3. **Should the fleet rail render at all when `usageContributors` is empty?** A
   "—" is honest but adds a column of dashes to every row until someone shares.
   The alternative is to hide the rail entirely until the catalog reports any
   contributor, which is quieter but hides the fact that the lane exists.
