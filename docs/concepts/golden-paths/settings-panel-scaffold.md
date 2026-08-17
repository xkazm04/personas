# Golden path — Settings panel scaffold

> Situation node: `ui-system/layout-and-navigation/settings-panel-scaffold` · [situation spine](../situation-spine.md)
> recurrence **18** · risk **LOW** · sides **client** · convergence **mixed** · `twoSided: true`
> dimensions: **ui · code-quality · performance · function**
> Leaf definition: *"the multi-section settings tab shape, including a persisted toggle+bound card."*
> Merged from **Settings panel scaffold** + **Policy threshold settings card**.
> Composed 2026-08-17 against `master` @ `2edb8d694`. **Short form** (spine header, §0, §2, §7, §9, §12)
> per the runbook's Mode 2 tiering — this leaf is `risk: low`.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` under `src/`
> (`shared-facts.json#frontend.tsFiles`, re-verified this session by an independent walk: 4,829, of
> which **4,425** production after excluding `__tests__` / `*.test.*` / `*.spec.*`). Read in full:
> `settings/components/SettingsPage.tsx`,
> `shared/components/layout/settings/{SettingsScaffold,useSectionScrollSpy}.tsx|ts`,
> all **13** panel modules named in `SettingsPage.tsx:8-22`,
> `hooks/utility/data/useAppSetting.ts`, `settings/sub_limits/components/LimitsSettings.tsx`,
> `settings/search/useSettingsSearchEntries.tsx`, `settings/shared/RecentChangeChip.tsx`,
> `shared/chrome/sidebar/Sidebar.tsx`, `triggers/TriggersPage.tsx`,
> `stores/slices/system/uiSlice.ts`, `stores/systemStore.ts`, `lib/types/types.ts`.
>
> **Measured by executing, not by reading.** Two jsdom 29.1.1 + React 19.2.6 harnesses (the repo's own
> versions, loaded through the repo's `node_modules` via `createRequire`), with
> `SettingsPage.tsx:29-92` and `TriggersPage.tsx:118,147-155` transcribed **statement for statement**.
> One substitution, recorded: framer-motion's `motion.div` → `div`. It is sound for what is under
> test — the questions are *does React preserve this DOM node* and *what does the dispatch do with an
> unrecognised key*, and `motion.div` renders a real `div` at the same tree position. That replay
> produced §0, §7 D1, D2 and D3; reading produced none of them, and reading produced a **wrong**
> answer about `TriggersPage` that §12.1 corrects.
>
> **Two independent implementations of every count.** Where they disagreed, §12 says so. One of the
> two imports `matchJsxTags` from `scripts/census/lib/instruments/` — and §12.3 records that the
> instrument caught nothing until I fixed **my own** misuse of its signature, which is a different
> lesson than the one the instrument was written for.

---

## 0. Headline

**This app's settings surface is thirteen panels behind one dispatch, and the dispatch is the only
one of its kind in the tree that has no answer for a key it does not recognise. The value it
indexes on is persisted. Two ids have been removed from that union since March, and either of them,
sitting in `localStorage`, takes the page down on every launch — for good, because nothing in the
program ever writes the value again.**

Executed, both shapes, same two stale ids:

```
{"shape":"A SettingsPage Record lookup","tab":"account",       "live":true, "threw":false}
{"shape":"A SettingsPage Record lookup","tab":"quality-gates", "live":false,"threw":true,
 "error":"Error: Element type is invalid: expected a string (for built-in components) or a
          class/function (for composite components) but got: undefined"}
{"shape":"A SettingsPage Record lookup","tab":"config",        "live":false,"threw":true, …}
```

`SettingsPage.tsx:72` reads `tabComponents[tab]` and hands the result straight to JSX at `:85`.
There is no `??`. `React.createElement(undefined)` throws, and it throws during the render of the
whole content area, not of one card.

The two ids are not hypothetical. `git log -L 424,424:src/lib/types/types.ts` dates them:

| id | added | removed | days it was a legal persisted value |
| --- | --- | --- | --- |
| `quality-gates` | `b36e5fa15` 2026-03-29 | `dc07f1a46` 2026-05-17 | 49 |
| `config` | `0e49b39cc` (pre-`b36e5fa15`) | `8b75e71dc` 2026-06-18 | ≥ 81 |

**And it cannot self-heal, which is the part worth pausing on.** `settingsTab` is persisted through
`systemStore.ts:82`. Zustand's persist merges the stored object *over* the slice defaults, so
`uiSlice.ts:400`'s `"account"` is applied only when the key is **absent** — never when it is present
and unrecognised. The one narrowing guard that exists, `Sidebar.tsx:122-126`, resets to `'account'`
for exactly two ids (`'engine'`, `'byom'`), only in production builds, and neither of them is a
removed one. So the sequence is: launch → rehydrate → render → throw → the user quits → the value is
still there. Every launch, identically, until someone clears site data.

**The repo already owns the fix and applies it two floors down.** `useAppSetting(key, default,
validate)` — `hooks/utility/data/useAppSetting.ts:26-56` — loads a persisted setting and, at
`:49-53`, **discards a stored value that fails validation and substitutes the default**. That is the
unrecognised-value arm, written, tested and shipped. Four of its seven call sites pass a validator.
It guards `monthly_cost_ceiling_usd` and `max_parallel_executions` (`LimitsSettings.tsx:42-43`) — two
numbers whose worst failure is a wrong ceiling — and it does not guard the one persisted string that
decides whether the page renders at all.

This is the shape [`entity-picker`](./entity-picker.md) named for a different leaf: *a solved problem
that did not cross a component boundary.* The prescription is transfer, not invention.

---

## 2. The one way

**A settings panel is a `sections` array handed to `SettingsScaffold`; the tab id that chooses which
panel to render is a persisted setting like any other, so give it the same validator you would give a
cost ceiling, and resolve it through one total function that cannot return `undefined`.** Concretely:
(a) declare the panel as `SettingsSection[]` — `id`, `label`, `icon`, `content` — and render
`<SettingsScaffold sections={…} navAriaLabel={…} />` from
`@/features/shared/components/layout/settings/SettingsScaffold`; do not hand-roll a heading stack, a
quick-nav rail, or a scroll-spy, and do not bring your own `overflow-y-auto` — `ContentBody`
(`ContentLayout.tsx:260`) already owns the scroll box and all 13 panels already rely on that.
(b) Put every persisted value the panel writes behind `useAppSetting(key, default, validate)` and
**always pass the third argument**, because the validator is what turns a stored string from a
program that no longer exists into a value this program can hold. (c) For the tab id itself, index
through a **total resolver** — `const Component = tabComponents[tab] ?? tabComponents[DEFAULT_TAB]` —
and write the unrecognised value back so the next launch is clean; a fallback that renders correctly
but leaves the bad value in storage fixes the symptom for one frame and re-runs the whole
rehydrate-and-fail sequence tomorrow. (d) Never let the *header* resolve with a fallback while the
*body* resolves by equality chain: that combination does not crash and does not degrade — it renders
a header naming a panel that is not below it, which is the one outcome worse than the crash because
nobody reports it.

> **Read alongside two neighbours, and the boundary between them.**
> [`view-state-persistence`](./view-state-persistence.md) owns *whether a persisted view token has an
> unrecognised-value arm at all* — its §7 D2 is **19 of 23 durable name-shaped view tokens have no
> such arm**, and its census rule `durable-view-token-with-no-rehydrate-arm` names `settingsTab`
> literally in its match set. This path owns the half that one does not reach: **what the scaffold
> DOES with the value once it is unrecognised**, which is a property of the dispatch and not of the
> store, and which §7 D1–D3 shows takes three different forms in this repo with three different
> failure modes. [`navigation-destination`](./navigation-destination.md) §7 A ("a persisted
> destination id that no longer exists throws — measured by execution") owns the same fact one level
> up, at `SidebarSection`. Three paths, one mechanism, three layers; cite, do not re-derive.

---

## 7. Deviations

Ten. D1–D3 were executed; the rest were measured. Nothing here was applied — per the runbook's
no-destructive-applies rule, and because D1's fix is a behaviour change to the app's startup path
while the operator is using it.

### D1 — the settings dispatch is the only unguarded component lookup on a persisted key, and it crashes · executed

`SettingsPage.tsx:72` — `const Component = tabComponents[tab];`, then `:85` `<Component />`. No
fallback. Harness output in §0.

The population, measured two ways (see §12.2 for the disagreement):

| | count |
| --- | --- |
| `const <PascalCase> = <map>[<non-literal>]` where the binding is later rendered as JSX | **69 sites / 65 files** |
| …of which the index is a **tab/section** value rather than an icon key, kind, or status | **2** |
| …of which the index is a value that **survives a restart** | **1 — `SettingsPage.tsx:72`** |

The other 67 are icon and widget maps keyed on data the same render produced
(`STATUS_ICON[status]`, `KIND_META[tally.kind]`, `cockpitWidgetRegistry[widget.kind]`). They are the
same construct and they are not the same risk, because their key cannot outlive the program that
wrote it. The single sibling on a store field —
`research-lab/ResearchLabPage.tsx:24` `const Active = TAB_COMPONENTS[researchLabTab]` — is the
identical crash shape and is **safe today for a reason nobody chose**: `researchLabTab` is *not* in
`systemStore.ts`'s `partialize`, so it resets to `'dashboard'` on every launch and can never hold a
removed member. Two panels, one construct, and the thing that separates them is a line in a
`partialize` list 400 files away.

### D2 — the second shape does not crash; it renders a header that names a panel that is not there · executed

`TriggersPage.tsx:118` resolves the header with `TAB_HEADERS[eventBusTab] ?? TAB_HEADERS['live-stream']`.
The body, `:147-155`, is eight `eventBusTab === "…" && <Panel/>` arms. On an unrecognised value all
eight are false:

```
{"shape":"B","tab":"live-stream",  "threw":false,"headerShown":"live-stream","bodyEmpty":false}
{"shape":"B","tab":"quality-gates","threw":false,"headerShown":"live-stream","bodyEmpty":true}
{"shape":"B","tab":"config",       "threw":false,"headerShown":"live-stream","bodyEmpty":true}
```

The page renders. It has a title, a subtitle, an icon, a pending-approvals badge and an empty
rectangle. **A crash is reported; this is not.** `eventBusTab` is one of the 11 persisted
tab/section fields, so this is reachable by the same route as D1.

Equality-chain dispatch with ≥3 arms: **9 files, 46 arms** —
`TriggersPage.tsx` (8), `plugins/dev-tools/DevToolsPage.tsx` (7), `plugins/twin/TwinPage.tsx` (7),
`plugins/obsidian-brain/ObsidianBrainPage.tsx` (6), `agents/sub_design/DesignHub.tsx` (5),
`plugins/companion/CompanionPluginPage.tsx` (4), `plugins/fleet/FleetPage.tsx` (3),
`plugins/twin/sub_brain/BrainAtelier.tsx` (3), `teams/sub_factory/l2/FactoryProjectTabs.tsx` (3).
**None has a residual arm.** Six of the nine are keyed on a persisted field.

### D3 — a third shape, in one file, that is both at once

`obsidian-brain/ObsidianBrainPage.tsx:58` — `data-testid={OBSIDIAN_PANEL_TESTID[obsidianBrainTab]}`
above an equality chain (`:61-66`). On a stale value the attribute silently becomes absent (JSX drops
an `undefined` attribute) *and* the body is empty. The comment at `:55-57` explains the map exists so
the tour has "one stable id per tab regardless of connected/empty branch" — so the failure mode is
that the tour anchor and the panel disappear together, and the surface that would notice is the tour.

### D4 — five of thirteen settings panels use the scaffold that was built for them

`SettingsScaffold` (`shared/components/layout/settings/SettingsScaffold.tsx:48`) is catalogued
("Two-column settings layout — a sticky quick-nav rail … Use for any multi-section settings
surface"). Render sites among the 13 panels named at `SettingsPage.tsx:8-22`, counted with
`matchJsxTags`:

| panel | `SettingsScaffold` | `SectionCard` | own `overflow-y-*` |
| --- | --- | --- | --- |
| account, appearance, engine, portability, limits | **yes** (5) | 0 / 0 / 1 / 0 / 0 | 0 |
| notifications, byom, network, admin, api-keys | no | 2 / 1 / 1 / 1 / 2 | 0 |
| radio, devices, history | no | 0 | 0 |

**5 adopt · 5 use `SectionCard` without the rail · 3 use neither.** The eight non-adopters are not
worse-looking by accident — they have no quick-nav, so a 572-line panel (`ApiKeysSettings.tsx`) is a
single unindexed scroll. Two further adopters exist outside Settings
(`plugins/companion/sub_setup/SetupPanel.tsx`, and `sub_portability/StorageUsageSection.tsx` nested
inside an adopter), which is why a naive grep says 7.

The one genuinely good property to preserve: **13 of 13 panels render `ContentBox` + `ContentBody`
and 0 of 13 declare their own scroll container.** The scroll box is
`ContentLayout.tsx:260`/`:271` and nothing competes with it. That is the strongest convention in this
leaf and it holds at 100%.

### D5 — the scaffold's navigation is `hidden md:block`, and nothing replaces it

`SettingsScaffold.tsx:62` — `className="hidden md:block sticky top-1 …"`. Below the `md` breakpoint
the quick-nav rail is not rendered and there is no collapsed substitute: the five adopting panels
become the same unindexed scroll as the eight non-adopters. The repo has an `IS_MOBILE` constant used
elsewhere (`ReviewInboxPanel.tsx` gates its splitter on it) — the scaffold does not use it, so this
is a silent degradation rather than a declared one.

### D6 — the scroll-spy subscribes for panels the user cannot see

`useSectionScrollSpy.ts:67-68` binds a `scroll` listener to the nearest scroll parent and a `resize`
listener to `window`, with **no active/inactive check**. `SettingsPage` keeps every tab the user
visited in the last 30 s mounted (`:24`, `:50-61`), so the subscriber count is the *mounted* count,
not the visible one. Executed:

```
{"case":"all tabs mounted inside one 30s window","mountedPanels":13,
 "liveScrollSpySubscribers":13,"activeVisibleToUser":1,"inactiveButStillSubscribed":12}
```

Bound to reality: only the **5** scaffold adopters mount a spy, so the real ceiling is 5 live
scroll-spies with 4 of them computing `getBoundingClientRect()` on every scroll frame for panels at
`opacity: 0`. The harness's 13 is the shape, not the number; recorded here rather than in §0 because
overstating it would be the exact "measurement that agrees with your thesis" the doctrine warns about.

### D7 — `useAppSetting`'s validator is optional, and the two sites that skip it are the two that could not check

7 call sites, enumerated in full:

| site | default | validator |
| --- | --- | --- |
| `LimitsSettings.tsx:42` | `'0'` | `isValidCeiling` |
| `LimitsSettings.tsx:43` | `String(CONCURRENCY_DEFAULT)` | `isValidConcurrency` |
| `NotificationSettings.tsx:45` | `'true'` | inline `v === 'true' \|\| v === 'false'` |
| `NotificationSettings.tsx:89` | `JSON.stringify(DEFAULT_PREFS)` | inline JSON parse |
| `EngineCapabilityBadge.tsx:24` | `'claude_code'` | — |
| `ProviderCredentialField.tsx:37` | — | — |
| `ProviderCredentialField.tsx:39` | — | — |

**4 of 7 validate.** That is a far better ratio than the contract's cautionary case
(`<Numeric locale>` at 8 of 197), and it is still an optional argument on the repo's only
unrecognised-value primitive. `ProviderCredentialField.tsx:39` additionally passes `''` as the key
when `field2` is absent, so a real IPC read is issued for the empty key.

### D8 — the settings-search catalog and the tab union are two lists, and only one is typed

`useSettingsSearchEntries.tsx:121` casts: `const tabId = item.id as SettingsTab;` — over
`getSettingsItems(...)`, whose ids are not the union. The cast is the join, so an item id that drifts
out of `SettingsTab` produces a search result whose `onNavigate` writes an unrecognised value into
the store — i.e. **the settings search box is a writer of the value in D1**. (This site is inside
`unchecked-destination-id-assertion`'s 56-match baseline, owned by `navigation-destination`; noted
here for the composition, not re-claimed.)

### D9 — the persisted-threshold card has no bound on the value the backend enforces

`LimitsSettings.tsx:19-22` declares `CONCURRENCY_MIN/MAX/DEFAULT` with the comment *"Mirrors the Rust
bounds in `src-tauri/src/db/settings_keys.rs` — keep in sync."* That is a hand-maintained mirror of a
constant in another language, which is the shape
[`client-rule-mirroring`](./client-rule-mirroring.md) measured: a test on either side asserts its own
copy. `isValidCeiling` (`:27-31`) accepts **any** finite non-negative number and treats `''` as
unset; there is no upper bound at all, so the ceiling card's validator constrains the shape and not
the range.

### D10 — cleared claims

Recorded because a cleared claim is worth as much as a confirmed one.

- **`SettingsPage`'s idle-unmount is not a leak.** `:46-64` deletes the `lastActive` entry for every
  tab it drops (`:57-59`), so the `Map` cannot grow past the union. Checked because a per-tab
  timestamp map is a natural place for one.
- **The `lazy()` modules are correctly cached.** The comment at `:44-45` claims re-entering an
  unmounted tab re-mounts synchronously; that is how `React.lazy` behaves once the promise has
  resolved, and the 13 `lazy()` calls at `:8-22` are module-scope so they are not re-created.
- **No settings panel declares its own scroll container** — 0 of 13, checked directly. The
  suspicion (13 panels, 13 scroll boxes, one visible) was wrong.

---

## 9. The gate — a reasoned decline, with the numbers that produced it

**Declined.** The natural rule for this leaf is *"an unguarded lookup on a persisted tab id"*, and it
fails two independent tests. Both were measured, not assumed.

**Test 1 — site-level overlap against the FINAL pattern of an existing rule.**
`durable-view-token-with-no-rehydrate-arm` (owner: `view-state-persistence`, baseline 2 files /
19 matches) was re-run this session at `2edb8d694`. Its 19 matched tokens are:

```
selectedPersonaId, activeChatSessionId, activeProjectId, fleetActiveSessionId, homeTab, cloudTab,
settingsTab, pluginTab, artistTab, obsidianBrainTab, twinTab, companionPluginTab,
companionSttModelId, companionKokoroVoiceId, companionPocketVoiceId, disabledStationIds,
collapsedSourceKinds, monitorCollapsedGroups, homeHiddenSections
```

`settingsTab` is in that list. So is `obsidianBrainTab` (D3) and `cloudTab`. A rule from this leaf
keyed on the persisted-tab side would be **100% overlapped on its headline token** and would ratchet
the same declaration in the same file. The doctrine's precedent — a gate declined at 83% file overlap
— applies here at 100% site overlap on the one site that matters.

**Test 2 — precision of the only formulation that is NOT overlapped.** The non-overlapped
formulation is the *consumption* side: a map lookup rendered as a component with no fallback. Two
independent implementations agree the population is **69 sites / 65 files**. Hand-verified: **2** are
tab dispatch and **67** are icon/widget maps keyed on same-render data. A census rule cannot join a
`Record<SettingsTab, …>` declaration to a use site 60 lines below it — the runner matches one regex
against whole file content, and the join is what carries all of the precision. Shipping the
unjoined form means **2.9% precision (2/69)**, and a gate that fires on 67 correct icon maps is worse
than no gate because the first fix anyone reaches for is to delete it.

A third formulation was tried and abandoned before measurement was even necessary: keying on the
*index variable's name* (`…Tab`, `…Section`). It gets D1 exactly backwards. `SettingsPage.tsx:72`
indexes on a local called `tab`, produced by `mountedTabs.map()` and seeded from `settingsTab` — so a
name-keyed signal reports the one site that actually crashes as safe, and reports
`ResearchLabPage.tsx:24` (which cannot go stale) as the risk. **The index variable's name is not its
lifetime.** This is the doctrine's vocabulary-recall failure arriving from a direction it had not been
recorded in: not "the word list is short", but "the word is correct at the declaration and gone by
the use site".

**What a different instrument would catch, specified so the next repo can build it.** The condition
is *a total function from a persisted union member to a rendered surface*, and it is a type question,
not a counting question:

```ts
// today — SettingsPage.tsx:8, exhaustive but not total
const tabComponents: Record<SettingsTab, React.LazyExoticComponent<React.ComponentType>> = { … };
const Component = tabComponents[tab];                       // SettingsTab in, undefined out

// the shape that removes the deviation class instead of counting it
function resolveSettingsPanel(raw: string): React.ComponentType {
  return (tabComponents as Record<string, React.ComponentType | undefined>)[raw]
      ?? tabComponents[DEFAULT_SETTINGS_TAB];
}
```

The edit that matters is **widening the parameter to `string`**, not adding `??`. `Record<SettingsTab, X>`
indexed by a `SettingsTab` is `X` as far as the compiler is concerned, so `??` on that expression is
dead code TypeScript will let you delete; it only becomes live when the input type admits the value
that actually arrives — which is what `localStorage` hands you. This is qualification **Q1** from the
doctrine, seen from the storage side: the closed union constrains exactly what it names, and the
thing crossing the boundary was never one of the things it named.

The complementary instrument already exists and should be reused rather than duplicated: pass the
persisted tab id through `useAppSetting`'s validator contract (`useAppSetting.ts:49-53`), which is
this repo's only shipped "reject a stored value" mechanism and already guards four settings.

---

## 12. Corrections

### 12.1 — to the brief: `TriggersPage.tsx:118` does not degrade correctly

The brief stated: *"`TriggersPage.tsx:118` is the same construct with `?? DEFAULT` and degrades
correctly."* **It does not, and the correction is the more interesting half of D2.**

The `??` at `:118` guards the **header only**. The panel body at `:147-155` is an eight-armed
equality chain with no residual arm. Executed on both stale ids, the page renders a header reading
*Live stream* — icon, title, subtitle, action slot — above an empty div. So the three shapes in this
repo are not `{crash, degrade}` but:

| shape | on an unrecognised persisted id | who finds out |
| --- | --- | --- |
| `Record` lookup → JSX (`SettingsPage.tsx:72`) | throws | immediately, loudly, every launch |
| `??` header + `===` body (`TriggersPage.tsx:118,147`) | correct chrome, empty body | **nobody** |
| `Record` attr + `===` body (`ObsidianBrainPage.tsx:58,61`) | missing test id + empty body | the tour, eventually |

The middle row is the one I would not have found by reading, and it is worse than the top row on the
only axis that matters after the first hour — whether anyone notices.

### 12.2 — my two implementations agreed on the total and disagreed on membership

Both returned **69 sites**. The disagreement was 2 each way:

```
only in A: TrainingAtelier.tsx:473:Icon, DesignInputAttachments.tsx:57:Icon
only in B: ConversationCards.tsx:76:M,   ChannelDetailModal.tsx:94:M
```

Cause, in both directions: **a file that binds the same JSX name twice**. Implementation A scanned
forward for every `const X = MAP[…]` and kept them all; implementation B started from the rendered
tag names and took the *first* binding of each. Neither is wrong about the count and both are wrong
about which line to cite — the doctrine's "agreement on *what* is not agreement on *where*", reached
here through a different mechanism (multiple bindings, not a newline-eating stripper). A `file:line`
is the part a reader acts on, so the sites cited in D1 were re-derived by hand.

A second, larger disagreement is recorded because I nearly published the wrong number. A
`Record<*Tab|*Section, …>`-anchored implementation reported **11 unguarded lookups**; hand-verifying
all 11 dropped it to **2**. Six of the nine false positives *do* check the result one line later
(`const deps = TAB_DIRTY_DEPENDENCIES[tabId]; return deps != null && …`, `editorTabConstants.ts:44-45`;
`if (flashAnchor)`, `athenaChatNavigation.ts:82`), two are indexed by local `useState`, and one was
`TAB_HEADERS['live-stream']` — the *fallback itself*, counted as a violation because my index-literal
exclusion was written after the first run. The count that survived hand-verification is the one in D1.

### 12.3 — I misused a shared instrument, and it failed silently in the direction of plausibility

`matchJsxTags` takes `(src, opts)` where `opts` is `{ names }`. I called `matchJsxTags(src, 'SectionCard')`.
A string is not a `RegExp` and has no `names`, so `nameOk()` returned true for everything and the
call counted **every component tag in the file**. The output looked like a finding —
`account: scaffold=24 sectionCard=24 contentBox=24`, `appearance: 16/16/16` — thirteen rows of
plausible, monotone, wrong numbers. It reads as "these panels are dense", and the equality across
columns is the only tell.

The instrument's own header records the bug it was built for (a TSX generic closing a tag early). It
did not have this one, and it could not: the failure was at the call site, before any scanning
happened. The library's guarantee is *"already been wrong at that exact task"* — the guarantee does
not extend to being invoked correctly. Two habits follow, offered upward: check a shared instrument's
signature at the call site the same way you would check a regex, and treat **equal counts across
columns that should differ** as a red flag, because a matcher that has stopped discriminating still
returns numbers.

### 12.4 — the primed claims, checked

- ***"`SettingsPage.tsx:74` does `tabComponents[tab]`"*** — the construct is real; the line is **72**
  (`:74` is the `isActive` comparison). `view-state-persistence`'s index entry cites `:74` for this
  file. The two-line drift is not worth an edit to that path, but it is recorded here because the
  corpus's citations are how the next composer finds this.
- ***"`SettingsTab` lost `quality-gates` and `config`"*** — confirmed, with commits and dates (§0).
- ***"crashes on EVERY launch and never self-heals"*** — confirmed, and the *mechanism* was not what I
  assumed going in. I expected `onRehydrateStorage` to have no repair arm; the sharper fact is that
  zustand's merge makes the slice default unreachable for a **present-but-invalid** key, so the
  default at `uiSlice.ts:400` is not a fallback at all — it is an initial value, and those are
  different things.
- ***"owned by `view-state-persistence` item 46"*** — the priming run at `2edb8d694` reports 3
  citations of this file from that path (§5, §9, `:74`); its §7 list is D1–D12 with no numbered item
  46, so I cited the rule and the D2 finding by name instead. Recorded in case the item numbering
  came from a different artifact.

### 12.5 — a spine label tested

`convergence: mixed` on this leaf was **not** tested against the sibling checkouts. The short-form
tier does not include the convergence sweep, and running a partial one would produce exactly the
kind of "3 of 5" figure the doctrine says to distrust when the cohort was never established. Recorded
as untested rather than silently omitted. `sides: "client"` **holds** here, and for a structural
reason worth naming: the crash, all ten deviations and the declined gate are frontend, and the
backend's only participation is `app_settings` returning a string it was asked for. The leaf carries
`twoSided: true` in the same spine object, which is internally inconsistent with a client-only
finding — the second side, if it exists, is `settings_keys.rs`'s bounds constants (D9), and that is a
mirroring problem rather than a scaffold one.
