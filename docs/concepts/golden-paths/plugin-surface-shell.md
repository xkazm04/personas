# Golden path — Plugin surface shell

> Situation node: `ui-system/layout-and-navigation/plugin-surface-shell` · [situation spine](../situation-spine.md)
> recurrence **8** · risk **MEDIUM** · sides **client** · convergence **mixed** · `twoSided: true`
> dimensions: **ui · performance · code-quality · function**
> Leaf definition: *"framing a plugin's tabs and reflecting its on/off state in sidebar and nav."*
> Merged from **Plugin panel shell** + **Plugin enable gating**.
> Composed 2026-08-17 against `master` @ `2edb8d694`. **Short form** (spine header, §0, §2, §7, §9, §12)
> per the runbook's Mode 2 tiering — `risk: medium` with recurrence 8 falls below the full-contract
> threshold of 9.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/` (`shared-facts.json#frontend.tsFiles`, re-verified
> by an independent walk: 4,829), with **746** under `src/features/plugins/`. Read in full:
> `personas/PersonasPage.tsx`, `personas/sectionRouter.tsx`,
> `plugins/{PluginBrowsePage,PluginIcons}.tsx`,
> the ten plugin shells (`artist/ArtistPage`, `companion/CompanionPluginPage`,
> `dev-tools/DevToolsPage`, `drive/DrivePage`, `fleet/FleetPage`,
> `gitlab/components/GitLabPanel`, `obsidian-brain/ObsidianBrainPage`,
> `radio/components/RadioPage`, `research-lab/ResearchLabPage`, `twin/TwinPage`),
> `shared/chrome/sidebar/sections/PluginsSidebarNav.tsx`,
> `shared/components/layout/ContentLayout.tsx`,
> `stores/slices/system/uiSlice.ts`, `stores/systemStore.ts`, `lib/types/types.ts`,
> `lib/analytics/navCatalog.ts`, `plugins/drive/hooks/useScrollShadows.ts`.
>
> **Measured by executing, not by reading.** `uiSlice.ts:542-555` (`enabledPlugins` + `togglePlugin`)
> and `PersonasPage.tsx:323-355` (the whole plugin dispatch) were transcribed **statement for
> statement** into a harness and driven through the persist round trip. That replay produced §0 and
> §7 D1 and D2 — including the fact that the obvious fix for D2 does not work, which reading would
> have got wrong in the confident direction.
>
> **Two independent implementations of every count.** Where they disagreed, §12 says so.

---

## 0. Headline

**This app ships an enable/disable switch for its plugins. It is a `role="switch"` on a card in a
Browse grid, and the user reasonably reads it as "this plugin is on". It is neither a gate nor a
setting: nothing that mounts a plugin consults it, and it is not persisted — so turning a plugin off
hides one sidebar row until the next restart, and does not stop the plugin from being mounted even
before then.**

Executed, against the real reducer and the real dispatch:

```
{"q":"Q1 after togglePlugin(\"drive\")","driveEnabled":false,"sidebarWouldShowDrive":false}
{"q":"Q1 then something sets pluginTab=\"drive\"",
 "mounted":"drive shell","consultedEnabledPlugins":false,"driveStillDisabled":true}
{"q":"Q2 persist round trip as shipped","partializeContainsEnabledPlugins":false,
 "restored":{"pluginTab":"drive"},"verdict":"the toggle is forgotten on every restart"}
```

The two halves are independent and each is enough on its own.

**It does not gate.** `PersonasPage.tsx:329-352` is an eight-armed `if` chain over `pluginTab`, and
its only other input is `import.meta.env.DEV`. `enabledPlugins` is read at exactly **three** sites in
4,829 files — `PluginBrowsePage.tsx:52` (the toggle's own card),
`PluginsSidebarNav.tsx:108` (the sidebar filter), and `MessageDetailModal.tsx:131` (one unrelated
feature check) — and **none of them is at a mount point**. Against that: **26 writes to
`setPluginTab` across 15 files**. The only reason a disabled plugin usually stays unreached is a
side-effect buried in the reducer — `uiSlice.ts:550` resets `pluginTab` to `'browse'` if you disable
the plugin you happen to be standing on — which handles one entry route out of twenty-six.

**It does not persist.** `enabledPlugins` appears **nowhere** in `systemStore.ts`. And the naive fix
is a trap the harness caught:

```
{"q":"Q2b if enabledPlugins were simply added to partialize",
 "serialized":"{\"enabledPlugins\":{}}","restoredValue":{"enabledPlugins":{}},
 "restoredIsASet":false,
 "verdict":"a Set JSON-stringifies to {} — the naive fix silently persists an empty object,
            and .has() would throw on rehydrate"}
```

`Set` has no `toJSON`. Adding the key to `partialize` writes `{}` on every save and rehydrates a
plain object, at which point `enabledPlugins.has(...)` — the three call sites above — throws on
launch. **The one-line fix turns a forgetful feature into a startup crash**, which is why this is a
note and not an applied fix.

Underneath both halves is one structural fact: **there are five registries of what a plugin is, and
they declare 9, 9, 8, 8 and 5.**

---

## 2. The one way

**A plugin surface is a leaf of one registry, and the shell's whole job is to be the place that
registry is read.** Concretely: (a) declare the plugin **once** — id, label key, icon, dev-only flag,
tier, enable-default, sub-tabs — in one exported catalog, and derive the union type from it rather
than hand-maintaining both; today five lists are hand-maintained and four of them are unexported
literals inside a component. (b) Resolve the surface through a **total function** from the persisted
id to a component, with a fallback that also *writes the corrected id back* — the fall-through-to-Browse
that `PersonasPage.tsx:354` gets for free is the right behaviour and the wrong implementation,
because it is silent about why. (c) **Read the enable state where the surface mounts, not only where
it is listed.** A gate enforced in the chrome is a display filter; the twenty-six writers of
`pluginTab` are not going through the chrome. (d) Frame the shell with the shared chrome —
`ContentBox` / `ContentHeader` / `ContentBody` from `@/features/shared/components/layout/ContentLayout` —
and let it own the scroll box; eight of ten shells already do and the two that do not each
re-implement a piece of it. (e) Where a plugin needs a capability the app already has — a scroll
shadow, a tab strip, a busy button — **import it, do not re-derive it inside the plugin**; a plugin
directory is a feature folder, not a sandbox, and the isolation it looks like it has is not enforced
anywhere. (f) If a plugin genuinely must be isolated, say so with a boundary that fails a build; the
`shared/components` boundary rule in `eslint.config.js` is advisory and warn-level, and per the
doctrine a warn-level rule enforces nothing at either gate at any count.

> **Read alongside two neighbours.** [`navigation-destination`](./navigation-destination.md) owns the
> single-resolver prescription in (b) generally, and its §7 E ("twenty catalogs of eleven ids, and the
> drift is live") is the app-wide form of this leaf's §7 D3; cite it, do not re-derive it.
> [`settings-panel-scaffold`](./settings-panel-scaffold.md) owns what a dispatch does with an id it
> does not recognise — and the plugin dispatch is the **only** one of the three shapes measured there
> that degrades correctly, which is why (b) says the behaviour is right and the implementation is not.

---

## 7. Deviations

Eleven. D1 and D2 were executed; the rest were measured.

### D1 — the enable switch gates the sidebar and nothing else · executed

Reads of `enabledPlugins`, whole tree: **3**. Writes of `setPluginTab(<value>)`: **26 across 15
files** (21 across 14 excluding `src/test/automation/bridge.ts`, which drives every destination
deliberately). Not one of the 26 consults the 3.

The 21 production writers: `PluginsSidebarNav.tsx:267,278,298`, `useBreadcrumbTrail.ts:178,182,185`,
`GuidedTour.tsx:133,144`, `FleetStatsSidePanel.tsx:121,127`,
`teams/sub_mastermind/lib/navigate.ts:29,44`, `PersonaDecisionsFooter.tsx:66`,
`fleet/monitor/navigateToProcess.ts:25`, `powerMoves/launchPowerMove.ts:36`,
`DirectorCoachingTab.tsx:87`, `backlog/BacklogPanel.tsx:200`,
`companion/applyClientAction.ts:68`, `companion/companionRoutes.ts:38`,
`fleet/FleetFooterIcon.tsx:59`, `NotificationCenter.tsx:111`.

Three of those are worth naming because they are not user gestures:
`applyClientAction.ts:68` is the companion **model** dispatching a client action;
`launchPowerMove.ts:36` reads a destination out of a registry (`powerMoves/registry.ts:153`); and
`NotificationCenter.tsx:111` routes a notification. A disabled plugin is one notification away from
being on screen.

### D2 — the switch is forgotten on every restart, and the obvious fix crashes the app · executed

`enabledPlugins` is absent from `systemStore.ts` entirely. Harness output in §0, including the
`Set` → `{}` result for the naive `partialize` addition. The working shape is an array in
`partialize` with a `Set` reconstructed in `onRehydrateStorage` — or, better, storing the *disabled*
ids so a plugin added in a later version defaults to on rather than being invisible to every existing
user. Both are behaviour changes to startup; recorded, not applied.

### D3 — five registries of what a plugin is: 9, 9, 8, 8, 5

| registry | file:line | declares | exported? |
| --- | --- | --- | --- |
| `PluginTab` union | `lib/types/types.ts:430` | **9** (incl. `browse`) | yes (type only) |
| `allPlugins` — sidebar catalog | `shared/chrome/sidebar/sections/PluginsSidebarNav.tsx:93-103` | **9** | **no** — inside a `useMemo` |
| `enabledPlugins` default | `stores/slices/system/uiSlice.ts:542-544` | **8** | via the store |
| the mount chain | `personas/PersonasPage.tsx:329-352` | **8** | n/a |
| `PLUGINS` — Browse grid | `plugins/PluginBrowsePage.tsx:28-34` | **5** | **no** — inside the component |
| `PLUGIN_ICONS` | `plugins/PluginIcons.tsx:117-123` | 5 (`Partial<Record<…>>`) | yes |
| `PLUGIN_TABS` — analytics | `lib/analytics/navCatalog.ts:96` | **9** | yes |

Executed divergence check across the five primary lists:

```
{"q":"Q3 divergence","id":"artist",      "inRegistries":"4/5","missingFrom":["PLUGINS browse grid"]}
{"q":"Q3 divergence","id":"research-lab","inRegistries":"4/5","missingFrom":["PLUGINS browse grid"]}
{"q":"Q3 divergence","id":"scraper",     "inRegistries":"4/5","missingFrom":["PLUGINS browse grid"]}
{"q":"Q3 divergence","id":"browse",      "inRegistries":"2/5",…}
```

The nearest thing to a canonical registry is `allPlugins`, and it is **declared inside a component's
`useMemo` and not exported**, which is precisely why `PluginBrowsePage` has a divergent five-item
copy with its own labels and its own lucide imports.

### D4 — three plugins have an enable flag and no control anywhere in the UI

```
{"q":"Q4 plugins with an enable flag but no toggle control anywhere in the UI",
 "ids":["artist","research-lab","scraper"]}
```

They are in `enabledPlugins` (`uiSlice.ts:542-544`) and gated by `devOnly` in the sidebar
(`PluginsSidebarNav.tsx:96,101,102`), but they have no Browse card, so `togglePlugin` can never be
called for them from the UI. Two defects cancel: because the set is not persisted (D2), the flag they
can never change also never changes. Fix D2 alone and these three become permanently
un-re-enable-able for anyone who ever disabled them.

### D5 — 10 directories, 8 plugins, and the two categories do not line up in either direction

`src/features/plugins/` holds 10 directories. **Three are not plugins**: `fleet` (mounted at
`DevToolsPage.tsx:35` under `devToolsTab === 'fleet'`), `gitlab` (mounted at `PersonasPage.tsx:270`
under `sidebarSection === 'cloud'`), `radio` (mounted at `SettingsPage.tsx:12` as a *settings tab*).
None has a `PluginTab` id, a Browse card, or an enable flag. **And one plugin is not in the
directory**: `scraper` is a declared `PluginTab` with a toggle and a sidebar row, and its code lives
at `src/features/scraper/ScraperPage.tsx`.

`radio` is the one worth flagging beyond bookkeeping: it is simultaneously a member of `SettingsTab`
(`types.ts:424`) and a resident of `plugins/`, so it inherits the settings scaffold's crash surface
([`settings-panel-scaffold`](./settings-panel-scaffold.md) §7 D1) while looking, in the tree, like
plugin code.

### D6 — the shell provides chrome to 8 of 10, and the two opt-outs each rebuild part of it

| shell | `ContentBox`/`ContentHeader` | note |
| --- | --- | --- |
| artist, companion, drive, gitlab, obsidian-brain, radio, research-lab | shared | — |
| **dev-tools** (`DevToolsPage.tsx:24`) | **none** — a bare `<div className="h-full w-full flex flex-col">` | each sub-page brings its own |
| **twin** (`TwinPage.tsx:13-15`) | **opts out deliberately**, with a comment at `:9-12` | re-implements `ContentBox`'s responsive width ladder as a local const |
| **fleet** (`FleetPage.tsx:48-50`) | hand-rolled `<h1 className="typo-heading">Fleet</h1>` | imports `ContentBox`/`ContentHeader` at `:4` and uses them only in a helper at `:103-118` |

`twin`'s is the honest kind of deviation — a written decision with a stated reason — and it is also
the one that will drift, because the width ladder it copied now exists in two places.

### D7 — no plugin shell uses the app's tab primitives; the one that framed its own tabs hand-rolled them

Eight of ten shells push their tab row into the L3 sidebar and render only the selected panel.
`gitlab` uses the shared `PanelTabBar` (`GitLabPanel.tsx:8,129-131`) — the only plugin-land use of it.
`fleet` hand-rolls a `<button>` map with inline classnames (`FleetPage.tsx:48-81`, `TABS` at `:19-23`).
**`SegmentedTabs` is used by zero plugin shells** (it appears inside plugin *sub*-pages six times).

The eight that delegate pay for it in a different currency: `PluginsSidebarNav.tsx:119-152` is a
per-plugin `switch` **triple** — `subItemsFor` / `activeSubTab` / `selectSubTab` — each with a
`default:` that returns empty or no-ops. Adding a plugin means editing all three, and forgetting one
produces a plugin with rows that select nothing rather than a build error.

### D8 — plugin sub-tab persistence is split four ways and the split looks unconsidered

| plugin | field | in `partialize`? | restores after restart |
| --- | --- | --- | --- |
| artist, twin, obsidian-brain, companion | `artistTab`, `twinTab`, `obsidianBrainTab`, `companionPluginTab` | **yes** (`systemStore.ts:97,101,103,104`) | yes |
| dev-tools | `devToolsTab` (`uiSlice.ts:136`) | **no** | snaps to `overview` |
| research-lab | `researchLabTab` (`uiSlice.ts:138`) | **no** | snaps to `dashboard` |
| fleet | local `useState` (`FleetPage.tsx:37`) | n/a | resets on remount |
| gitlab | local `useState` (`GitLabPanel.tsx:34`) | n/a | resets on remount |

`pluginTab` itself **is** persisted (`systemStore.ts:96`), so the app restores *which plugin* you were
in and then discards *where you were in it* for four of the eight. The two `uiSlice`-parked fields are
also the only plugin sub-tabs that never got their own slice, which is a plausible reason nobody
noticed them at `partialize` time. Their non-persistence is accidentally load-bearing, though:
`ResearchLabPage.tsx:24` is an unguarded `Record<ResearchLabTab, ComponentType>` lookup rendered as
JSX, and it is safe **only** because `researchLabTab` cannot survive a restart
(see [`settings-panel-scaffold`](./settings-panel-scaffold.md) §7 D1). Persisting it — the obvious
consistency fix — would ship the settings crash into Research Lab.

### D9 — the plugin catalog is half-translated, in a 14-language app

`PluginsSidebarNav.tsx:94-102`: three labels go through `t.shared.sidebar_extra.*`
(`dev_tools_label`, `obsidian_brain`, `research_lab`) and **six are hardcoded English literals** —
`'Browse'`, `'Artist'`, `'Drive'`, `'Twin'`, `'Companion'`, `'Scraper'`. They are string properties
of an object rather than JSX text, so `custom/no-hardcoded-jsx-text` does not see them (and would
only warn if it did). `PluginBrowsePage.tsx:29-33` translates all five of its labels, so the same
plugin is "Drive" in the sidebar and a translated string on its own card.

### D10 — every shell holds the whole global store, and the boundary that would say otherwise is advisory

**10 of 10 shells import `@/stores` directly.** Nine take `useSystemStore`; `GitLabPanel.tsx:3-5`
additionally takes `agentStore` and `vaultStore`, neither of which is gitlab-owned.
`DrivePage.tsx:15,17,50` is the only shell reaching `@/api` directly, and one of its two modules is
another feature's vault database layer (`@/api/vault/database/vectorKb`).

No shell imports `@/lib/bindings` — but **166 files under `src/features/plugins/` do**, so the Tauri
boundary is crossed deep inside each plugin rather than at its shell. There is no injected or scoped
store; a plugin has the same reach as the app shell, and the only thing resembling a boundary is the
advisory ESLint rule for `shared/components/**`, which does not cover `features/plugins/**` at all.

**Cross-plugin imports: 10** (`from '@/features/plugins/<other>/…'`), all in one cluster:

| from | to | sites |
| --- | --- | --- |
| dev-tools | companion (`guidance/appActions`) | 6 — `ContextDetail.tsx:7`, `contextLedgerShared.tsx:17`, `LifecycleProjectPicker.tsx:6`, `ProjectOverviewPage.tsx:19`, `PrBridge.tsx:42`, `TaskCard.tsx:8` |
| companion | fleet | 3 — `FleetStatsSidePanel.tsx:10,11,12` |
| fleet | companion (`companionStore`) | 1 — `useFleetOverlayActions.ts:4` |

dev-tools → fleet → companion → fleet is mutually circular. Artist, drive, obsidian-brain, radio,
research-lab, twin and gitlab are cleanly isolated from other plugins, and there are **zero**
relative-path escapes (`../../<otherplugin>`), so the coupling that exists is deliberate and legible.

### D11 — a plugin re-implemented a shared primitive rather than importing it

`plugins/drive/hooks/useScrollShadows.ts:13` is a second, plural-named copy of
`hooks/utility/interaction/useScrollShadow.ts:10`, used by three Drive files
(`DriveFileList.tsx:306`, `DriveSidebar.tsx:49`, `DriveToolbar.tsx:441`). The shared version carries a
comment (`useScrollShadow.ts:31-33`) recording that a `MutationObserver` was removed because it caused
a render→mutate→setState→render loop — a documented negative result that the copy does not have. This
is the concrete cost of (e) in §2, and it is measured in
[`scroll-and-resize-affordances`](./scroll-and-resize-affordances.md) §7 D10.

### D12 — cleared claims

- **The plugin dispatch degrades correctly on an unrecognised id.** `PersonasPage.tsx:354` falls
  through to `renderSectionRoute('plugins', goHome)` → `PluginBrowsePage`. Checked because the two
  sibling dispatches in this batch do not (crash and blank-body respectively); this one is the good
  example. Its only flaw is silence — a production user with a persisted `pluginTab: 'artist'` lands
  on Browse with no explanation, because the DEV-only arms fall through the same way.
- **Every shell is wrapped in an `ErrorBoundary` and a `Suspense`** — 9 of 10 at the dispatch
  (`PersonasPage.tsx:330-352`), `fleet` behind `Suspense` only. The `RouteChunkSkeleton` fallback and
  the comment explaining it (`:324-328`) are the loading-pattern-v2 prescription applied correctly.
- **`src/features/fleet/` at top level is not a second fleet plugin** — it is `monitor/` only, a
  component library the fleet plugin consumes.

---

## 9. The gate

One rule, validated standalone in a composer-private scratch registry
(`rules-uilayoutnav-2be17a89.json` — filename unique to this composer), hand-verified,
positive-controlled, fault-injected, then re-extracted from this document and re-run to identical
numbers.

**The condition it is a proxy for, stated so another repo can re-derive its own signal:** *a
capability the product presents to the user as switchable is consulted only by the surface that lists
it, never by the surface that mounts it.* In this stack that manifests as a destination-setter call
with no gate read; in a stack with a router it will manifest as a route with no guard.

```json
{
  "id": "ungated-plugin-destination-write",
  "goldenPath": "docs/concepts/golden-paths/plugin-surface-shell.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\bsetPluginTab\\s*\\(\\s*['\"\\w]",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "a write that lands the user on a plugin surface. PROXY FOR the stack-free condition: a plugin's own enable/disable state is consulted by the chrome that lists plugins and by nothing that mounts one, so every arrival door is a bypass of the gate the product presents to the user."
  },
  "exclude": [
    {
      "path": "src/test/automation/bridge.ts",
      "reason": "the test-automation IPC bridge deliberately drives every destination without the UI; gating it would defeat the harness."
    }
  ],
  "baseline": { "files": 14, "matches": 21 },
  "floor": 4000
}
```

```json
{
  "id": "ungated-plugin-destination-write-positive-control",
  "goldenPath": "docs/concepts/golden-paths/plugin-surface-shell.md",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\benabledPlugins\\s*\\.\\s*has\\s*\\(",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "POSITIVE CONTROL — the gate the violating form skips. Partitions the plugin-reach surface: writes that land you on a plugin vs reads that ask whether you may be there."
  },
  "floor": 4000
}
```

**Baseline, as run:** gate **14 files / 21 matches**; control **3 files / 3 matches**, with **0 site
overlap** between them. The 21-to-3 ratio *is* the finding, and the control's job here is narrower
than usual, so it is worth being precise about what it does and does not establish. It establishes
that the pattern is not accidentally matching gate reads. It does **not** establish a
violating/compliant partition of one construct — because **there is no compliant form of this write
anywhere in the tree**. Every one of the 21 is ungated; a gated arrival does not exist to control
against. That is a weaker control than the doctrine's strongest form, and it is weak for a reason
that is itself the deviation, so it is reported rather than dressed up.

**Overlap, measured at SITE level against the FINAL pattern**, against the two registered rules that
touch the same setters:

| rule | owner | sites | site overlap with this gate |
| --- | --- | --- | --- |
| `unnamed-cast-at-navigation-door` | `cross-surface-deep-link` | 20 / 9 files | **1** (`NotificationCenter.tsx:111`) — 3.8% |
| `unchecked-destination-id-assertion` | `navigation-destination` | 56 / 20 files | **1** — 1.8% |

File-level overlap is higher (4 and 5 of 14 files), which is exactly why the doctrine says to measure
at site level: the two neighbours key on a **cast** (`as never`, `as PluginTab`) and this one keys on
the **call**, so they meet only where a writer does both. The 20 sites those two rules cover and this
one does not are casts at destinations other than plugins; the 20 this one covers and they do not are
plugin arrivals that are type-clean and gate-free — which is the majority, and the population that
matters.

**Fault injection — verified by exit code, never through a pipe:**

| injection | expected | result |
| --- | --- | --- |
| 4 synthetic violations (`setPluginTab('drive')`, `sys.setPluginTab("companion")`, `s.setPluginTab(nav.pluginTab)`, `setPluginTab('dev-tools' as never)`) | all 4 match | 4/4 ✓ |
| 4 near-misses (`useSystemStore((s) => s.setPluginTab)` selector; a dep array `[…, setPluginTab, …]`; `setDevToolsTab('fleet')`; `setPluginTab()` with no argument) | none match | 0/4 ✓ |
| the control on `enabledPlugins.has('drive')` | matches | ✓ |
| baseline 99, actual 4 (silent drop) | fail | `exit 1` |
| baseline 2, actual 4 (rise) | fail | `exit 1` |
| baseline 4, actual 4 | pass | `exit 0` |
| empty tree (floor + zero-match assertions) | fail | `exit 1` |
| `exclude` pointed at a non-existent path (stale exemption) | fail | `exit 1` |
| real repo, as published | pass | `exit 0` |

The three near-misses that matter are the selector and the dep array: `setPluginTab` appears in both
without being a call, and both are common enough that a looser pattern (`\bsetPluginTab\b`) would
have taken the baseline from 21 to roughly 30 with a third of it noise. Requiring
`\(\s*['"\w]` — an open paren followed by the start of an actual argument — is what buys 21/21.

**What this gate cannot do.** It cannot see the two conditions that made D3 and D4 findings, because
both are absences: *no registry is canonical* and *three ids have a flag with no control*. The census
ratchets a count of something present and cannot assert that a set covers another set — the same wall
`check-csp-hosts.mjs` was written to get around. The instrument those want is an **inventory
comparison**: derive the id set from `PluginTab`, then assert that the sidebar catalog, the Browse
grid, the enable default, the mount chain and `navCatalog.PLUGIN_TABS` are each either equal to it or
a *declared* subset with a named reason. That is ~40 lines with an exit-2 guard if it finds fewer
than 5 registries — and per the contract's fail-loud requirement, that guard is the part that keeps
it from silently measuring nothing after someone renames a file.

---

## 12. Corrections

### 12.1 — to the brief: the boundary question inverted

The brief asked *"whether a plugin can reach app state it shouldn't (shared/components boundary is
advisory ESLint, non-blocking)"*, framing the risk as a plugin escaping a boundary.

**There is no boundary to escape.** The advisory ESLint rule the brief names governs
`src/features/shared/components/**` and says nothing about `src/features/plugins/**`. Plugins are
ordinary feature folders: 10 of 10 shells import `@/stores` (D10) and that is *conventional* here,
not a violation. Measured against the framing the brief expected — plugin A reaching into plugin B —
the answer is **10 imports in one three-node cluster, zero relative-path escapes**, which is modest
and legible.

The real finding is the mirror image, and I would not have looked for it if I had kept the brief's
frame: **the plugin system has a gate and does not use it.** The question is not "can a plugin reach
what it shouldn't" but "can *anything* reach a plugin the user switched off" — and the answer is 26
writers against 3 reads, none of them at a mount point. Reach outward is fine; reach *inward* is
unguarded.

### 12.2 — my two implementations disagreed, and the disagreement was about what a plugin is

Implementation A counted plugin directories (**10**). Implementation B counted `PluginTab` members
minus `browse` (**8**). Neither is wrong and the gap is D5 in its entirety: `fleet`, `gitlab` and
`radio` live in `plugins/` and are not plugins; `scraper` is a plugin and does not live in
`plugins/`. I nearly published "10 plugins" from the directory listing, which is the number a
newcomer would form in ten seconds and is wrong in two directions at once.

A second disagreement, smaller and sharper: a first pass at the cross-plugin import count returned
**27**, and hand-classification split it into **10** cross-plugin, **13** self-plugin absolute-alias
imports (`gitlab/components/GitLabPanel.tsx:10-15` imports six of its own siblings through `@/`), and
**4** imports of the plugin-root shared `PluginIcons.tsx`. Publishing 27 as "cross-plugin coupling"
would have been wrong by 2.7×, and the error is invisible to any regex that cannot compare a match
against the path of the file it came from — which is also why §9 does not gate on it.

### 12.3 — the primed leads, checked

- ***"the app has plugins (artist, companion, dev-tools, drive, obsidian-brain, research-lab, twin)
  each with a shell"*** — seven named; the tree has ten directories and the union has eight members.
  `fleet`, `gitlab`, `radio` and `scraper` were all missing from the brief's list, and three of the
  four are exactly the cases that make D5 a finding.
- ***"measure what a plugin shell provides vs re-implements"*** — confirmed and quantified: shared
  chrome 8/10 (D6), shared tab primitive 1/10 (D7), and one outright re-implementation of a shared
  hook (D11). The strongest single number is that **`SegmentedTabs` is used by zero plugin shells**,
  which matters because [`tab-strip`](./tab-strip.md) measured it as the app's dominant tab primitive
  at 21 call sites — plugin-land is where it isn't.
- ***"there is no `Record<PluginTab, Component>`"*** — I expected one, by analogy with
  `SettingsPage.tsx:8`. It is an `if` chain (`PersonasPage.tsx:329-352`), and the `if` chain is the
  **better** construct here: it degrades to Browse instead of throwing. Recorded as a cleared claim
  (D12) rather than buried, because the batch's other two leaves both punish the same-shaped code and
  this one is the counter-example.

### 12.4 — spine labels

`sides: "client"` **holds**, structurally: the enable set lives only in a zustand slice, the mount
decision is a React branch, and the backend has no representation of a "plugin" at all. The leaf also
carries `twoSided: true`, which is **contradicted** — there is no server half to report. That is the
seventh-contradiction shape the doctrine records (`"client"` incomplete vs `"client"` inverted): here
it is neither incomplete nor inverted, it is `twoSided` that is wrong, and the two fields disagree
inside one spine object.

`convergence: mixed` was **not tested** — the short-form tier does not include the sibling sweep, and
the plugin concept is Personas-specific enough that establishing a cohort would have been most of the
work. Recorded as untested rather than silently omitted, since an untested `convergence` label is
what thirteen previous leaves were before they failed.
