# Golden path — Tier and capability gating

> Situation node: `backend-runtime/command-authorization/tier-and-capability-gating` · [situation spine](../situation-spine.md)
> `sides: both` · `twoSided: true` · recurrence **154** · risk **high** · convergence **mixed**.
> Dimensions: **function · security · ui · cost**.
> Composed 2026-08-14 against `master` @ `73ba613b9` from a ground-truth sweep of every
> `minTier` / `devOnly` / `useTier()` / `VITE_APP_TIER` site in the **4,829** `.ts`/`.tsx`
> files under `src/` ([`shared-facts.json`](../shared-facts.json); independently
> re-walked at 4,829 by this composition's own file walker), the navigation registry and
> all six catalogs derived from or competing with it, the four L2 content routers,
> `scripts/check-tiers.mjs`, `package.json`, `vite.config.ts`, all 7 GitHub workflows,
> the three `tauri.*.conf.json` files, and a full-text search of the **963** `.rs` files
> for any product-tier concept. Convergence checked against `../personas-cloud`,
> `../personas-web` and `../brainiac`.
> **No cargo command was run and no tier bundle was built** — the PreToolUse guard
> blocks concurrent cargo and sibling agents hold this checkout; every claim below is
> derived by reading source. `src-tauri/target/**` and `.claude/worktrees/**` excluded.
> The **Deviations** section is a fix backlog.

> ### ⚠ Three corrections to the brief that commissioned this path
>
> 1. **"`withGlobalTauri` means the IPC surface is reachable from the devtools console"
>    — TRUE IN DEV, FALSE IN A RELEASE INSTALLER.** `src-tauri/Cargo.toml:110` declares
>    `tauri = { version = "2", features = ["tray-icon", "protocol-asset"] }` — **no
>    `devtools` feature** — and `open_devtools` appears **zero** times in `src-tauri/src`.
>    Tauri enables the WebView2 inspector only under `debug_assertions` or that feature,
>    so a packaged build ships without a console. `withGlobalTauri: true`
>    (`tauri.conf.json:16`) hands the full IPC surface to **any script already running in
>    the webview**, which is the [`ipc-command-authorization`](./ipc-command-authorization.md)
>    threat model, not this one. The tier boundary is defeated far more cheaply than
>    that — see §7 A1 — so the conclusion survives on stronger evidence than the brief's.
> 2. **"`personas-cloud` already puts the tier in the same struct as the capability so its
>    two arrays cannot drift (`httpApi.ts:419-439`)" — REFUTED as stated.** That location
>    is the `AuthRoute` interface and the field is `admin?: boolean` (`:437`) — a binary
>    role flag defaulting to *false*, not a tier, and not a capability name. There are not
>    "two arrays" of that kind; there is one 58-entry `AUTHENTICATED_ROUTES` table
>    (`:494`), of which exactly 3 carry `admin: true`. The salvageable and genuinely
>    convergent idea is narrower and better: **the authorization flag is declared in the
>    same object literal as the matcher and the handler (`:437` + `:439`), so a route
>    cannot be added with its authorization decision out of scope.** That is the clause
>    this path adopts (§Convergence).
> 3. **"If any *paid* capability is enforced only in the frontend, that is a P0."** No
>    capability in this product is paid. `personas-web` **deleted** its pricing table in
>    commit `c48e678` (2026-04-14, `src/data/pricing.ts`, 136 lines) and its four tiers —
>    Local $0 / Starter $9 / Team $29-per-seat / Builder Custom — carried `comingSoon: true`
>    on every paid row; the landing `#pricing` section is now a feature showcase
>    (`personas-web/src/components/sections/pricing/index.tsx:16-18`) and the site's own
>    JSON-LD publishes `price: "0"` (`homeJsonLd.ts:21-24`). So there is **no revenue to
>    leak and no P0 of that shape**. There is a different P0, and it is a truthfulness
>    defect rather than a security one — §7 E.

---

## 1. Trigger

- "Should this be Starter or Team?" / "hide this in Simple mode"
- "Add a `minTier` to this tab" / "why can't I see Projects in the starter build?"
- "Is the tier a licence? can a user get around it?"
- "Make this Builder-only" / "gate this behind the paid tier"
- "The sidebar hides this but the page still renders it"
- "`npm run check:tiers` passed — is the starter build correct?"

If you are about to type `minTier:`, `devOnly:`, `useTier()`, `isStarter`, `isBuilder`,
`tier.isVisible(`, `isTierVisible(`, `filterByTier(`, `passesGates(`, a new entry in
`NAV_SECTIONS`, or a hardcoded `Set` of section ids — you are in this situation.

### Scope — three gating axes wear the word "tier"; this path owns exactly one

| Axis | Selector | Owned here |
|---|---|---|
| **Product tier / capability** — starter · team · builder; what a *user* is allowed to do | `VITE_APP_TIER` → `BUILD_MAX_TIER` → `minTier` / `devOnly` | **yes** |
| IPC authorization — public · auth · privileged · cloud; what a *caller* is allowed to invoke | `#[requires(...)]` + `PRIVILEGED_COMMANDS` | no — [`ipc-command-authorization.md`](./ipc-command-authorization.md) |
| Cargo features and the tier *bundles* — what is *compiled* | `desktop` · `ml` · `p2p` · the `build:starter/team/builder` scripts | no — [`feature-flagged-compilation.md`](./feature-flagged-compilation.md) |

The boundaries in prose, because two of them are one grep away from each other:

- **`ipc-command-authorization` owns "may this caller invoke this command".** Its answer is
  a token check in `wrap_invoke_handler`. It is deliberately blind to *who the user is* —
  with `withGlobalTauri: true` every tier's webview holds the same `window.__IPC_TOKEN`.
  If you are choosing between Public / Privileged / Cloud, you are in that path, not this
  one. **A tier is never an authorization tier and must never be described as one.**
- **`feature-flagged-compilation` owns "does this code exist in this build".** It measured
  that `sectionRouter.tsx:59-70` mounts all ten lazy primaries unconditionally so no tier
  bundle tree-shakes anything, and that the backend is byte-identical across tiers. This
  path *starts* from those findings (both re-verified below) and owns what follows: what
  the tier is allowed to mean, where the decision is declared, and which surfaces must
  honour it.
- **A third collision is a pure naming hazard.** `tier` appears **1,059** times in the
  Rust tree and **none** of them is a product tier: `engine/src/tier.rs`'s `TierConfig` is
  a *rate-limit* tier, `commands/infrastructure/tier_usage.rs` reports rate-limit bucket
  usage, and Athena's "memory tiers" are a storage taxonomy. A developer grepping `tier`
  in the backend will find a different concept every time.

---

## 2. The one way

**Treat the product tier as a declaration on a destination, not a branch at a call
site, and never treat it as a boundary that refuses anything.** Put the gate in the
navigation registry — `gates: { minTier }` on the `NAV_SECTIONS` entry
(`src/lib/navigation/registry.ts:74-95`) or `minTier` on the `sidebarData` item — and let
every surface derive its answer from the one evaluator, `passesGates`
(`registry.ts:154-158`) or `isTierVisible` (`uiModes.ts:49-51`); then honour that same
declaration in **both** halves of the destination, the nav list *and* the content router
that mounts it, because a filtered list with an unfiltered router is not a gate. Never
destructure `useTier()`'s convenience booleans (`isStarter` / `isTeam` / `isBuilder`) to
branch inline: an ambient boolean is invisible to `registry.test.ts`, which is the only
thing in this repo that can enumerate what a tier hides, and `npm run check:tiers` proves
only that three bundles *compile*. Never build a second list of section ids to gate
against — six catalogs of sections already exist and two of them contradict the registry
(§7 B). And never write, in a comment, a doc, or a marketing guide, that a tier *enforces*
anything: **the backend has no tier concept at all** — zero product-tier references in
963 `.rs` files — the three tier bundles ship the same byte-identical backend and the same
1,585 registered commands, and every installer ever published is the builder bundle
(§7 A1), so a tier gate is a **presentation decision and nothing else**. If a capability
ever genuinely needs to be withheld from a user, the tier is the wrong instrument: put the
refusal where the capability lives — a typed `AppError` returned by the command — and let
the tier decide only whether the control is worth showing.

---

## 3. Mandated primitives

**Frontend — the whole of the mechanism**

- **`src/lib/constants/uiModes.ts:24-28` — `TIERS`** (`starter` | `team` | `builder`) and
  **`:33-37` `TIER_RANK`**. The tiers are totally ordered; each is a superset of the last.
- **`uiModes.ts:40-41` — `BUILD_MAX_TIER`.** `import.meta.env.VITE_APP_TIER ?? TIERS.BUILDER`.
  Vite substitutes the literal at build time. **The `??` is load-bearing and it fails
  *open*:** an unset variable means *builder*, which is why every release installer has
  every capability (§7 A1).
- **`uiModes.ts:49-51` — `isTierVisible(minTier, activeTier)`.** The comparison, once.
  4 direct call sites (`sidebarData.ts:59,:328`, `SidebarLevel1.tsx:208`,
  `bridge.ts:319`) plus the injected form `ctx.isTierVisible` inside `passesGates`
  (`registry.ts:156`).
- **`src/lib/navigation/registry.ts:74-95` — `NAV_SECTIONS`,** and **`:46-51` `NavGates`.**
  The declaration site for top-level sections: `gates: { minTier?, devOnly? }` lives in the
  same object literal as the id, the icon and the reachability. 11 entries; 3 carry
  `minTier: TIERS.TEAM` (`teams`, `events`, `plugins`), 1 carries `devOnly: true` (`studio`).
- **`registry.ts:154-158` — `passesGates(gates, ctx)`.** The ONE evaluator. Sidebar rail,
  content router, command palette and footer nav all route through it. **This is the
  primitive to copy.**
- **`src/features/personas/sectionRouter.tsx:113-115` — `isSectionGated`.** The content
  router's half of the contract: a gated section fails straight to Home rather than
  mounting and then being redirected. Called at `PersonasPage.tsx:247`. **The only content
  router in the app that consults the gate.**
- **`src/features/shared/chrome/sidebar/sidebarData.ts:53-61` — `filterByTier(items, activeTier)`.**
  The L2 equivalent for sub-nav item arrays. 2 call sites (`SidebarLevel2.tsx:88`,
  `PluginsSidebarNav.tsx:117`). Note `item.minTier ?? TIERS.STARTER`
  at `:58` — **an item with no declared tier is visible to everyone**; the default is open.
  It filters `minTier` only, never `devOnly`, so every caller must filter `devOnly`
  separately (`PluginsSidebarNav.tsx:115-117` does both; `SidebarLevel2.tsx:87-88` does not,
  and compensates at `:205`).
- **`src/hooks/utility/interaction/useTier.ts:41-54` — `useTier()`.** Reach for
  **`.isVisible(minTier)`** and **`.current`**. Do **not** reach for `.isStarter` /
  `.isTeam` / `.isBuilder`; see §5.
- **`src/features/agents/sub_editor/components/EditorBody.tsx:113-117`** — the L2 redirect
  guard. When a persisted sub-tab is tier-gated, the surface must move the user off it.
  **The only place in the app that does this; copy it.**
- **`src/test/automation/bridge.ts:311-327`** — the harness's `navigate`, which refuses a
  gated section and *says why* (`Section "x" requires tier "team" (current: "starter")`).
  **The only place in the entire app where a tier gate produces an explanation instead of
  an absence.**
- **`src/lib/navigation/registry.test.ts:133-157`** — the gate's only test. It enumerates
  `['teams','events','plugins']` and asserts a starter context is refused. It works
  *because* the gates are declared data.

**Backend — there is none, and that is the finding.**

A full-text search of the 963 `.rs` files for `"starter"`, `"builder"`, `app_tier`,
`product_tier`, `min_tier` and `VITE_APP_TIER` returns **0** product-tier hits (the two
`"builder"` string literals in `db/src/repos/resources/triggers.rs:741,:2608` are a
`_managed_by` provenance marker). There is no `Tier` type, no capability enum, no
`AppError::TierRequired`, no command that reports the build's tier. **Nothing server-side
can refuse a tier-gated operation, and nothing is meant to.**

---

## 4. Steps

1. **Decide what kind of difference this is, before you write anything.** Three answers,
   and only one of them is a gate.
   *Presentation* — the same capability, arranged for a less technical user (one column
   instead of three, a shorter tour). Use a plain boolean and move on; it is not a gate
   and it does not belong in the registry.
   *Visibility* — a whole destination or control that a lower tier should not be offered.
   That is this path: declare it (step 2).
   *Refusal* — the operation must not succeed even if invoked. **The tier cannot do this.**
   Go to `ipc-command-authorization` and return a typed error from the command.
2. **Declare the gate on the destination, in the same literal as the destination.** A
   top-level section → `gates: { minTier: TIERS.TEAM }` in `NAV_SECTIONS`
   (`registry.ts:74-95`). An L2 item → `minTier: TIERS.TEAM` on the `sidebarData` entry.
   An editor tab → `minTier` on the `tabDefs` row (`EditorTabBar.tsx:15-20`). Never a
   separate list keyed by id.
3. **Honour it in the nav list.** You get this free: `SidebarLevel1.tsx:208`,
   `SidebarLevel2.tsx:87-88`, `getSettingsItems` (`sidebarData.ts:325-329`),
   `PluginsSidebarNav.tsx:115-117`, `CommandPalette.tsx:162` and `FooterSectionNav.tsx:40`
   all already filter. Adding an entry with a `minTier` is the whole of the work.
4. **Honour it in the content router too — this is the step everyone skips.** The list and
   the router are two halves of one gate. For a section, `isSectionGated`
   (`sectionRouter.tsx:113`) already does it. For a sub-tab there is no primitive: copy
   `EditorBody.tsx:113-117` — an effect that moves the user to an ungated tab when the
   active one is gated. **Three of the four L2 routers do not do this today** (§7 C).
5. **If the tab id is persisted, step 4 is mandatory, not tidy.** `settingsTab` and
   `editorTab` survive in `localStorage` (`systemStore.ts:82,:79`), so a value chosen
   under one tier outlives a rebuild under another. `overviewTab` and `templateTab` are
   not persisted — which is luck, not design.
6. **Say what the gate does, in the words that are true.** In a comment, a feature doc or
   a marketing guide, the tier *hides* and *omits*. It never *unlocks*, *enforces*,
   *protects* or *tree-shakes*. Four places in the repo currently claim one of those and
   all four are false (§7 D).
7. **Stop.** No new `Set` of section ids. No `useTier()` boolean destructure. No tier check
   in Rust — there is no tier in Rust and adding one is a much larger decision than the
   ticket in front of you. No tier→cargo-feature coupling (there is none, by design). No
   backend command that reports the tier.

### Can the primitive make the wrong call impossible? — answered

The contract asks this before §9. **Yes, twice, and convergence settles both** — all three
sibling repos independently arrived at "declare the predicate on the subject" (§Convergence),
and the one repo that instead kept the predicate in a parallel list has a documented
privilege-escalation incident to show for it.

- **`NavGates.minTier` should be REQUIRED, not optional. YES — this is the big one and it
  is a three-line change.** `registry.ts:47` declares `minTier?: Tier` and
  `filterByTier` (`sidebarData.ts:58`) resolves the absent case as
  `?? TIERS.STARTER` — **an undeclared destination is visible to everyone.** Every gating
  decision in this repo therefore has a silent default, and "nobody classified it" is
  byte-identical to "deliberately available to all". Making the field required
  (`minTier: Tier`, with `TIERS.STARTER` typed out) turns each of the 11 sections and each
  L2 item into an explicit decision, exactly as `FacetedDecisionTable`'s required
  `emptyTitle` gets 3/3 real copy where its optional-prop siblings get 5-of-20 fallbacks
  (contract, "Prefer a type over a gate"). **`brainiac` reinvented the same idea with the
  opposite polarity and wrote down why:** `mcp.rs:246-248` maps an unrecognised MCP tool to
  `"admin"` — *"so a future tool cannot slip in ungated by accident"*. Personas' default is
  the mirror image, and fails open.
- **A destination should be a single type carrying its own gate, and every catalog should
  be derived from it. YES, and it is half-done.** `NAV_SECTIONS` already is that type, with
  a compile-time exhaustiveness assertion at `registry.ts:105-108` and four consumers
  derived from it. But **six catalogs of section ids exist** and two of them —
  `SIMPLE_SECTIONS` / `DEV_MODE_SECTIONS` (`src/lib/utils/platform/platform.ts:92-104`) and
  `NAV_CARDS` (`HomeWelcome.tsx:11-20`) — are hand-written literals that no type connects
  to the registry, and they already disagree with it (§7 B1). Deriving `NAV_CARDS` from
  `NAV_SECTIONS` and deleting the two `Set`s makes that contradiction unrepresentable.
  `personas-cloud`'s `AuthRoute` (`httpApi.ts:418-440`) and `personas-web`'s `GuideTopic`
  (`data/guide/types.ts:20-28` + `lib/guide-utils.ts:37`) are the same invention twice more.
- **A capability the user must not have should be a typed refusal, not an absence. YES, and
  it does not exist.** There is no `AppError::TierRequired`, no `error_registry` key, no
  i18n string. The bridge's message (`bridge.ts:319-320`) is the only tier explanation in
  the app and it is reachable only from the test harness. Until a capability is genuinely
  withheld this is a gap rather than a bug — but it is the piece that must land *first* if
  the tier ever becomes an entitlement, because a gate whose only vocabulary is "the button
  isn't there" cannot tell a user they are not entitled.

---

## 5. Anti-patterns

- **Destructuring a `useTier()` convenience boolean to branch inline.** 13 files
  (§9 rule). `const { isStarter: isSimple } = useTier()` then `{!isSimple && <Panel/>}`
  makes the decision invisible to every enumerator: `registry.test.ts` cannot see it,
  `check:tiers` cannot see it, and no reviewer can answer "what does starter lose?"
  without reading 4,829 files. The declared form —
  `minTier` + `passesGates` — answers that question by iteration.
  `CredentialList.tsx:111` then **prop-drills `isSimple` into `CredentialListColumns`**
  (`:53,:63,:77,:109,:112,:196`), which is the ambient boolean becoming a component API.
- **Filtering the nav list and forgetting the content router.** The sidebar drops the item;
  the page still mounts it. `OverviewPage.tsx:78-93` dispatches 15 tabs of which 10 carry
  `minTier: TIERS.TEAM` and 1 is `devOnly`, with no tier import anywhere in the file.
  A gate that only removes the *link* is a gate against clicking, not against reaching.
- **Building a second catalog of section ids.** `registry.ts:1-18` exists because four
  catalogs of sections drifted apart; `SIMPLE_SECTIONS` / `DEV_MODE_SECTIONS` and
  `NAV_CARDS` re-created the same drift in two new places, and one of them is already
  wrong (§7 B1). This is the leaf's convergent trap, not its convergent licence: the
  identical shape — *"a capability named by a bare string in N literal lists a comment says
  MUST stay in sync"* — is present in both sibling repos and has caused a real
  vulnerability in one of them (§Convergence).
- **Using `isBuilder` as a synonym for "dev build".** Two sites do
  (`NavigationGrid.tsx:90`, `DesktopFooter.tsx:291`, both aliasing it to `isDevMode`).
  They are different axes: `isBuilder` is a *tier rank* that is **true in every shipped
  installer** (`VITE_APP_TIER` unset ⇒ builder), while `import.meta.env.DEV` is false there.
  Naming one after the other guarantees someone eventually gates a dev-only surface with a
  tier that is always on.
- **Believing `npm run check:tiers` checks the tiers.** `scripts/check-tiers.mjs:34-44`
  spawns `npx vite build` with `VITE_APP_TIER` set and asserts the **exit code**. It never
  reads the output, never diffs the bundles, and never verifies the variable reached Vite
  at all. Three green builds prove three compilations, nothing about what they contain —
  and because all three write to the same `dist/`, the last one silently wins
  (`ci.yml:153-155` documents having to order around that).
- **Writing that a tier "unlocks", "enforces", or "tree-shakes".** `uiModes.ts:22`,
  `ci.yml:148-149` and `docs/development/build.md:28` all claim tree-shaking; none happens
  (§7 D1). `personas-web`'s shipping guide tells customers four capabilities are
  Builder/Team-tier (§7 E); none is gated at that tier anywhere.
- **Treating the tier as a licence boundary.** The Rust backend is byte-identical across
  tiers (`package.json:79-81` set only `VITE_APP_TIER`; `tauri.conf.json:11-13` names
  `desktop-full` regardless), 963 `.rs` files contain no tier concept, and there is no
  activation, signature or account binding a machine to a tier. The strongest statement the
  tier can support is *"this build's UI does not offer that"*.
- **Justifying an unauthenticated surface by "the frontend can already do this".**
  `dev_tools_http.rs:6-8` reasons that its 31 loopback routes *"expose nothing the running
  app's frontend can't already do"*, and `lib.rs:969-972` mounts them unconditionally in
  release. In a starter build the frontend is *supposed* to be able to do less — so the
  premise and the tier are mutually incompatible, and the router wins.
- **Adding a tier check to Rust because the UI has one.** The two systems are not two
  halves of one gate today; adding a backend tier means choosing where the tier comes from
  (a licence file? an account? an env var the user controls?), which is a product decision,
  not an implementation detail. Do not smuggle it in as a `if state.tier < Team` line.

---

## 6. Evidence

**Adoption of the declared form is good and the good half is worth naming.** 21
`minTier: TIERS.TEAM` declarations across 6 catalogs, 6 filter call sites, one evaluator,
one test that enumerates. The registry consolidation (`registry.ts:1-33`) is the best piece
of gating architecture in the repo. **The hole is exactly one layer wide: the content
routers below the top level.**

- **`src/lib/navigation/registry.ts:74-95` + `:154-158` — copy this.** The gate is a field
  in the same literal as the destination; `passesGates` is the only evaluator; a
  compile-time exhaustiveness assert (`:105-108`) makes a missing entry a `tsc` failure.
  This is the shape all three sibling repos independently arrived at.
- **`src/features/personas/sectionRouter.tsx:107-115` + `PersonasPage.tsx:247`** — the
  router half done right, with a doc comment stating exactly why it exists: *"instead of
  briefly mounting a gated surface before the Sidebar redirect effect catches up."*
- **`src/features/agents/sub_editor/components/EditorBody.tsx:113-117`** — the L2 redirect
  guard, and the proof the team already knows step 4 is required. Three sibling routers
  still need it.
- **`src/lib/navigation/registry.test.ts:133-157`** — the enumerating test. It can name the
  three sections a starter tier loses. Nothing can do the same for the 13 ambient branches.
- **`src/test/automation/bridge.ts:311-327`** — refuses and explains. The template for
  `AppError::TierRequired` if the axis ever becomes real.
- **`src/features/shared/chrome/sidebar/sections/PluginsSidebarNav.tsx:113-117`** — the one
  helper that applies *both* gates (`filterByTier` **and** `devOnly`), with a comment
  recording that the fields were previously *"silently dropped by the L3 mapping, making
  `minTier`/`devOnly` dead fields."* That incident is this leaf's failure mode in one line.
- **`src/features/shared/chrome/sidebar/sidebarData.ts:44-50`** — `sections` derived from
  `SIDEBAR_SECTIONS` rather than re-declared. This is what `NAV_CARDS` should look like.
- **`docs/concepts/capability-audit.md:102-115`** (2026-05-16) — reached this path's central
  conclusion three months ago: *"a `npm run build:starter` binary still contains every
  backend command… Tier is security through obscurity at the binary level."* It proposed
  `scripts/check-tier-sync.mjs` as Ticket B. **It was never built**, and the finding has not
  moved. A prior audit that named the defect and produced no gate is itself evidence for §9.

---

## 7. Deviations found

**Five categories, 19 individually-addressable items.** All ship green under `npm run check`
(which includes `check:tiers`, `check:contracts`, `check:tauri-configs`, `census:check`,
`tsc --noEmit` and `eslint src/`) and under the full Vitest suite.

### A. The tier axis reaches no user, and could not enforce if it did — 4

**A1 — every published installer is the builder tier. This is the headline.**
`.github/workflows/release.yml:193-197` builds the frontend with

```yaml
      - name: Build frontend
        env:
          SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
          VITE_SENTRY_DSN: ${{ secrets.SENTRY_DSN }}
        run: npm run build
```

— `VITE_APP_TIER` is **not** in that `env:` block, is not set anywhere in
`installer-test.yml`, is not defined in `vite.config.ts` (`define:` at `:222-224` carries
only `VITE_PLATFORM`), is commented out in `.env.example:46`, and is absent from the local
`.env`. `BUILD_MAX_TIER` therefore folds to `TIERS.BUILDER` via the `??` at
`uiModes.ts:40-41`, in which **every `minTier` gate passes**. So: **no starter or team
installer has ever been released.** The measured distance a determined user must travel to
obtain every tier-gated capability is **zero** — they download the only artifact that
exists. `npm run check:tiers starter team` (`ci.yml:156`) compiles, on every CI run, two
bundles that are shipped to nobody.

**A2 — and if one did ship, nothing behind it would refuse.** The backend is byte-identical
across tiers: `package.json:79-81`'s three scripts set only `VITE_APP_TIER`, none passes
`--features` or a `--config`, and `tauri.conf.json:11-13` names `desktop-full`
unconditionally. **0 of 963 `.rs` files reference a product tier.** All 1,585 registered
commands are present and reachable in every bundle, and `withGlobalTauri: true`
(`tauri.conf.json:16`) publishes the invoke bridge to the webview. The tier is enforced in
exactly one process, by one JavaScript constant, with no counterpart anywhere.

**A3 — `TIERS.BUILDER` is never used as a `minTier`.** 21 declarations, all `TIERS.TEAM`;
**0** `minTier: TIERS.BUILDER`. Team and builder differ at exactly **2** call sites, both
`isBuilder` aliased to `isDevMode` (`NavigationGrid.tsx:90`, `DesktopFooter.tsx:291`). One
third of `check:tiers` validates a bundle that differs from its neighbour at two lines.

**A4 — `dev_tools_http.rs` walks around the tier entirely.** 31 routes, mounted
unconditionally in release at `lib.rs:969-972` on loopback, with **no authentication**,
registering projects and rewriting `context-map.json` and `CLAUDE.md` on disk. Its header
(`:6-8`) justifies the absence of auth with *"this exposes nothing the running app's
frontend can't already do"* — a premise that is false by construction in any build whose
frontend is tier-restricted. Cross-referenced with
[`ipc-command-authorization.md`](./ipc-command-authorization.md) §F, which owns the
transport half; the tier-relevant half is that **a starter user needs no console, no
devtools and no patched bundle — just `curl`.**

### B. Six catalogs of section ids; two are hand-written and one contradicts the registry — 3

**B1 — the Plugins card is hidden from the team bundle while the sidebar shows it.**
`src/lib/utils/platform/platform.ts:92-104` declares two hand-written sets:

```ts
export const SIMPLE_SECTIONS = new Set<string>(['home','overview','personas','credentials','design-reviews','settings']);
/** Sidebar sections only visible in dev mode. */
export const DEV_MODE_SECTIONS = new Set<string>(['plugins']);
```

`NavigationGrid.tsx:90-98` applies them: `if (!isDevMode) filtered = filtered.filter(c => !DEV_MODE_SECTIONS.has(c.id))`, where `isDevMode` is `useTier().isBuilder`. In a
`VITE_APP_TIER=team` bundle `isBuilder` is **false**, so the Home grid drops the Plugins
card — while `SidebarLevel1.tsx:208` shows Plugins, because the registry gates it at
`minTier: TIERS.TEAM` (`registry.ts:85`), which a team tier satisfies. Two catalogs, one
section, opposite answers. The comment calls the set "dev mode" while the predicate is a
tier rank; `studio`, the section that *is* `devOnly`, is not in the set at all. The drift is
only observable in the `team` bundle — which CI builds on every run and ships to nobody.

**B2 — `NAV_CARDS` is a sixth catalog, hand-written.** `HomeWelcome.tsx:11-20` lists 8
section ids as literals with no derivation from `NAV_SECTIONS` and no type linking them.
It omits `home`, `studio` and `schedules`; nothing fails if a section is added to the
registry and forgotten here, or removed from the registry and left here.

**B3 — the registry's own consolidation note is now out of date.** `registry.ts:5-13`
records that four catalogs drifted and were unified. Six exist today: `NAV_SECTIONS`, the
derived `sidebarData.sections`, `SIMPLE_SECTIONS`, `DEV_MODE_SECTIONS`, `NAV_CARDS`, and
the harness's `sidebarSections` copy read at `bridge.ts:317`. `registry.test.ts`'s
completeness test covers the derived consumers and none of the hand-written ones.

### C. The nav list is filtered; the content router is not — 3 of 4

| Router | Gated destinations it can mount | Consults the gate? |
|---|---|---|
| `sectionRouter.tsx:113` / `PersonasPage.tsx:247` (L1 sections) | 3 `minTier` + 1 `devOnly` | **yes** — the reference implementation |
| `OverviewPage.tsx:78-93` (15 overview tabs) | **10** `minTier: TEAM` + 1 `devOnly` (`certification`) | **no** — zero tier imports in the file |
| `SettingsPage.tsx:30-41` (13 settings tabs) | 3 `minTier: TEAM` + 5 `devOnly` | **no** — and `settingsTab` **is persisted** (`systemStore.ts:82`) |
| `DesignReviewsPage.tsx:34,:76+` (5 template tabs) | 2 `minTier: TEAM` (`n8n`, `presets`) | **no** |
| `EditorBody.tsx:113-117` (4 editor tabs) | 2 `minTier: TEAM` (`activity`, `lab`) | **yes** — redirects; copy this |

15 of the 21 declared `minTier` gates and 6 of the 13 `devOnly` gates sit on destinations
whose router will mount them regardless. `settingsTab` and `editorTab` survive in
`localStorage`, so a value chosen under one tier outlives a rebuild under another;
`overviewTab` and `templateTab` are not in the `partialize` whitelist, which is the only
reason those two are not also reachable across a tier change.

### D. Documentation that describes a gate the code does not implement — 5

| Path | Defect |
|---|---|
| `src/lib/constants/uiModes.ts:22` | *"Compile-time: set APP_TIER env var to tree-shake higher-tier code entirely."* Nothing tree-shakes: `sectionRouter.tsx:59-70` holds all ten `lazyRetry(() => import(…))` primaries in one unconditional object read by dynamic key at `:92`. Also names the wrong variable — it is `VITE_APP_TIER`. *(Re-verified from `feature-flagged-compilation.md` §7 D1; both halves still true at `73ba613b9`.)* |
| `.github/workflows/ci.yml:148-149` | *"Tier variants flip frontend gating via VITE_APP_TIER and tree-shake disabled features."* Repeats the claim in the one place a reader is most likely to trust it. |
| `docs/development/build.md:28` + `README.md:309-322` + `docs/development/development.md:184-192` | Present the three tier builds as producing distinct installers. `README.md:322` — *"When `VITE_APP_TIER` is not set, the build includes all tiers"* — is correct, and is also the description of every release ever published (§7 A1). |
| `docs/features/settings/README.md:9` | *"`minTier` gates Data to Team+."* Three settings tabs are `minTier`-gated, not one — `portability` (Data), `limits` and `api-keys` (`sidebarData.ts:315-317`). |
| `uiModes.ts:14-22` | The header describes a runtime tier switch (*"users can switch tiers via Settings → Account"*) that `useTier.ts:4-7` says was retired. `TIER_CYCLE` (`:55-56`), `DEFAULT_TIER` (`:59`), `TIER_LABELS` (`:65`), `TIER_I18N_KEYS` (`:71`), `getTierLabels` (`:77`) and the whole `VIEW_MODES` alias block (`:95-108`) have **0 consumers** outside the file. The `tiers.*` i18n section (4 keys × 14 locales = 56 strings) is dead with them, as are `settings.appearance.interface_mode_hint` (*"Simple mode shows only core features. Power mode unlocks the full interface."*) and `settings.appearance_extra.dev_hint` — **0 code references each**. |

### E. The shipping marketing guide gates capabilities the app does not — P0 (truthfulness) — 4

`personas-web` has **no pricing page and no purchase path** (§Corrections 3), but its
customer-facing guide still tells users four capabilities are tier-locked — 22 occurrences
across 11 files. Measured against this repo:

| Guide claim | Cite | What the app does |
|---|---|---|
| *"genome evolution (**Builder tier**)"* | `personas-web/src/data/guide/content/testing.ts:13,:158,:172,:182` | The Lab tab is `minTier: TIERS.TEAM` (`EditorTabBar.tsx:19`). **Team, not Builder** — and `TIERS.BUILDER` is used as a `minTier` nowhere in `src/`. |
| *"BYOI (**Builder tier**) means you run the orchestrator yourself"* | `.../deployment.ts:199` | The closest surface, Custom Models, is `devOnly: true` (`sidebarData.ts:314`) — i.e. **absent from every release build**, not gated at a tier. |
| *"run the cloud deploy (**Builder tier**) so the orchestrator handles scheduling server-side"* | `.../triggers.ts:101` | `cloudItems` (`sidebarData.ts:182-186`) carries **no tier gate at all**; the real gate is Google OAuth (`#[requires(cloud)]`), an unrelated axis. |
| *"the cloud deploy (**Team / Builder tier**) replicates vault state"* | `.../credentials.ts:48` | Same — ungated in the app; `personas-cloud` has no tier concept whatsoever (§Convergence). |

**Why this is a P0 and what kind.** It is *not* a security P0: no capability is paid, so
nothing leaks. It is a truthfulness P0 — shipping documentation makes four capability
claims that are false in the product, in a vocabulary (`Builder tier`) the product uses for
something else and enforces nowhere. That is the exact defect this leaf exists to prevent,
and it is the one place in the corpus where doctrine has already produced a user-visible
wrong statement. **Fix by correcting the guide, not by adding gates to match it** — adding
a `minTier: BUILDER` to make the docs true would give the tier its first paid-sounding
enforcement while the enforcement remains a JavaScript boolean in a bundle nobody ships.

### F. Ambient tier branches — 13 files (the §9 rule's baseline)

Thirteen files destructure a `useTier()` convenience boolean and branch on it inline
instead of declaring a gate. Enumerated with measured classification, because precision
matters here and half of them are legitimate:

**Hides an affordance — should be a declared gate (7):**
`ExecutionMiniPlayer.tsx:132` (6 branches at `:289,:331,:345,:358,:372,:398`) ·
`PersonaSettingsTab.tsx:52` (5 at `:173,:217,:252,:268,:286`) ·
`TemplateDetailModal.tsx:70` (3 at `:165,:187,:307`) ·
`CredentialDetailModals.tsx:23` (`if (isSimple) return null` at `:27`) ·
`CredentialManagerHeader.tsx:85` (`:90,:128` — hides the whole action row) ·
`CredentialList.tsx:27` (prop-drills `isSimple` into `CredentialListColumns.tsx:53,:63,:77,:109,:112,:196`) ·
`NavigationGrid.tsx:90` (§7 B1).

**Presentation variance — a boolean is correct, keep it (5):** `SetupCards.tsx:105`
(`:109,:113,:114,:116` — one column vs three) · `HeroHeader.tsx:36` (`:38,:46,:48`) ·
`DesktopFooter.tsx:291` (`:307`) · `TourLauncher.tsx:19` (`:25`) ·
`TourHandoffOffer.tsx:26` (`:32`) — the last two pick between two tour ids, which is
copy selection, not gating.

**Correct and required (1):** `EditorBody.tsx:104` (`:114`) — the L2 redirect guard §4
step 4 mandates.

---

## 8. Gaps in the primitive

1. **`BUILD_MAX_TIER` fails open, and so does `filterByTier`.** `?? TIERS.BUILDER`
   (`uiModes.ts:41`) and `?? TIERS.STARTER` (`sidebarData.ts:58`) both resolve "unstated" to
   "most permissive". The first is why every installer is builder; the second is why an
   unclassified item is visible to everyone. Neither default is written down anywhere a
   developer choosing a tier would read it. `brainiac` faced the identical choice for MCP
   tools and chose fail-*closed* (`mcp.rs:246-248`), with the reason in the code.
2. **There is no primitive for gating an L2 destination.** `passesGates` covers sections;
   `filterByTier` covers item *lists*; nothing covers the *router*. `EditorBody.tsx:113-117`
   is a hand-rolled effect, which is why three sibling routers do not have one. A
   `useGatedTab(activeTab, items, setTab)` hook would close §7 C in four call sites.
3. **`filterByTier` handles one of the two gate fields.** It filters `minTier` and ignores
   `devOnly`, so every caller must remember the second half; `PluginsSidebarNav.tsx:117`
   remembers, `SidebarLevel2.tsx:88` does not and patches it 117 lines later at `:205`.
   `passesGates` already handles both — the L2 path should use it.
4. **Nothing can enumerate what a tier hides below the top level.** `registry.test.ts`
   enumerates 3 sections. The other 18 `minTier` declarations live in five separate arrays
   with no shared type and no test. There is no function anywhere that answers "list
   everything a starter build loses".
5. **`check:tiers` cannot observe its own effect.** It asserts an exit code
   (`check-tiers.mjs:34-44`). It does not assert that `VITE_APP_TIER` reached Vite, that
   the bundles differ, or that any gated surface is absent — and all three tiers write to
   the same `dist/`, so it cannot compare them even in principle without an output-dir
   change.
6. **There is no typed refusal.** No `AppError::TierRequired`, no `error_registry` key, no
   i18n string, no ts-rs binding. A gated capability has exactly one vocabulary — absence —
   and absence is indistinguishable from "not built yet" or "broken".
7. **`tier` means three different things across the two languages.** 1,059 Rust
   occurrences, none of them a product tier: rate-limit tiers (`engine/src/tier.rs`,
   `commands/infrastructure/tier_usage.rs`), memory tiers, model cost tiers. Any future
   backend tier concept will land in a namespace already occupied three times over.
8. **The census runner cannot see the shape that matters most.** The real defect in §7 C is
   *"a router dispatches on an id that a sibling list gates"* — a relationship between two
   files, not a token in one. §9 item 2 measures why that cannot be a census rule and
   specifies the check that can.

---

## 9. The missing gate

Every deviation above ships green under `npm run check` — including `check:tiers`, whose
entire assertion is that three Vite builds exit 0. **The gate is not missing; it is
scoped to compilation, which is the one property that was never in doubt.** Four items,
cheapest first: one census rule, one ~15-line extension of an existing test, one fail-loud
upgrade to an existing script, and one refusal.

### 1. Census rule — `undeclared-tier-branch`

**The condition (stack-free):** *a product-tier or entitlement decision is taken from an
ambient boolean where it is used, instead of being declared on the destination where a test
can enumerate it.*

**The proxy in this repo:** destructuring one of `useTier()`'s convenience booleans.
**PRECONDITION, and an adopting repo must re-derive its own:** this works because Personas'
tier primitive is a React hook returning precomputed booleans, so the ambient form and the
declared form are syntactically distinct (`{ isStarter } = useTier()` vs
`tier.isVisible(minTier)`). A repo whose tier arrives as a server-issued claim, a context
value, a CSS class, or a route guard scores **zero** here while the condition is present at
full scale — `personas-web`'s `ALLOWED_TIERS` / `BOOST_TIERS` pair and `brainiac`'s 32
bare-string `auth_of(&state, "admin")` call sites are exactly that condition wearing
different markup.

```json
{
  "rules": [
    {
      "id": "undeclared-tier-branch",
      "goldenPath": "docs/concepts/golden-paths/tier-and-capability-gating.md",
      "title": "A product-tier decision taken from an ambient boolean at a call site instead of declared on the destination, so no test can enumerate what a tier hides",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\{[^}]*\\bis(?:Starter|Team|Builder)\\b[^}]*\\}\\s*=\\s*useTier\\(\\s*\\)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "destructuring one of useTier()'s convenience booleans (isStarter / isTeam / isBuilder) at a call site. PROXY FOR the stack-free condition: a product-tier/entitlement decision is taken from an AMBIENT boolean where it is used, instead of being DECLARED on the destination where a test can enumerate it. In this repo the declared form is `gates: { minTier }` on a NAV_SECTIONS entry (src/lib/navigation/registry.ts:74-95) or `minTier` on a sidebarData item, evaluated once by passesGates (registry.ts:154-158) or isTierVisible — and registry.test.ts:133-157 can therefore assert exactly which sections a starter tier loses. The 13 ambient reads cannot be enumerated by anything, which is why npm run check:tiers (scripts/check-tiers.mjs) can only assert that three bundles COMPILE. Deliberately does NOT match `tier.isVisible(minTier)` or `tier.current`, which are the declared-gate evaluations. MEASURED PRECISION for the narrow reading 'this hides a capability': 7 of 13 (ExecutionMiniPlayer, PersonaSettingsTab, TemplateDetailModal, CredentialDetailModals, CredentialManagerHeader, CredentialList, NavigationGrid); the other 6 are presentation variance (SetupCards, HeroHeader, DesktopFooter) a redirect guard (EditorBody) or tour selection (TourLauncher, TourHandoffOffer) — all still undeclared tier reads, so they are in scope for the ratchet but should not be filed as capability leaks. PRECONDITION: this proxy keys on a React hook that returns precomputed booleans. A repo whose tier lives in a server-issued claim, a context value, a CSS class, or a route guard scores zero here while the same condition is present at full scale — re-derive the proxy against the local tier primitive."
      },
      "baseline": { "files": 13, "matches": 13 },
      "floor": 4000
    }
  ]
}
```

**Counts verified through two independent implementations before baselining.** The census
regex and a separately-written Node parser — which finds every literal `useTier(`
occurrence, walks *backwards* to the `=` and then to the matching `{`, and inspects the
destructured binding list — both return **13 files / 13 matches**, and both walked
**4,829** files, which independently reproduces `shared-facts.json`'s `tsFiles: 4829`.
They agreed on the first run; unlike `build-gated-ipc-entrypoint`, the double
implementation surfaced no disagreement here, which is itself worth recording as the null
result.

**No `exclude` entries.** `useTier.ts` itself does not match (it declares
`isStarter: boolean` in an interface and assigns `isStarter: current === TIERS.STARTER`;
neither is a destructure), so an exclude added for symmetry would be a stale exemption on
day one.

**Fault injection against the real tree**
(`node scripts/census/run-census.mjs --check --rules <file>`), from a scratchpad file named
`census-tiergate-4f81ad.json` unique to this composition:

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK undeclared-tier-branch 13 13 13 13 4829 4000` — surviving counts printed |
| matcher matches nothing (`NoSuchTierGateXYZ`) | **1** | `[structural] matched zero files anywhere…` + both `[drift] dropped 13 → 0` |
| floor above walk (`floor: 9000`) | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `src/lib`) | **1** | `[structural] walked 1267 … floor is 4000` + `zero matches` + `files 13→0`, `matches 13→0` |
| count rises (baseline lowered to 5) | **1** | `[drift] matches rose 5 → 13 (+8)` |
| renamed root (`srcc`) | **1** | `walked 0 files but floor is 4000` + `matched zero files anywhere` + both drops |
| count drops (baseline raised to 20) | **1** | `[drift] matches dropped 20 → 13 (-7) without the baseline moving` |
| stale `exclude` | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |
| `exclude` with a 9-char `reason` | **1** | schema refusal before any scan: `needs a real "reason" — an unexplained exemption is how an allowlist becomes a place violations go to hide` |

All nine behave as the contract requires. **Checked against the existing registry first:**
`scripts/census/rules.json` holds 34 rules and none touches the frontend tier axis; the
nearest neighbour, `build-gated-ipc-entrypoint`, keys on Rust `#[cfg]` inside
`generate_handler![]` and shares no signal, no root and no extension with this one.

### 2. Extend `registry.test.ts` to cover the catalogs it does not own (≈15 lines)

`src/lib/navigation/registry.test.ts` already enumerates gates and asserts them. Add, in
the same file:

- **Every hand-written catalog of section ids is a subset of `ALL_SIDEBAR_SECTIONS`, and
  agrees with the registry on gating.** Import `SIMPLE_SECTIONS` and `DEV_MODE_SECTIONS`
  (`platform.ts:92-104`) and `NAV_CARDS` (export it from `HomeWelcome.tsx`), then assert:
  every id exists in the registry; every id in `SIMPLE_SECTIONS` has no `minTier` above
  starter; **every id in `DEV_MODE_SECTIONS` has `devOnly: true` in the registry** — which
  fails today on `plugins` (§7 B1), catching a live contradiction on the first run.
- **`SIMPLE_SECTIONS` equals the registry's starter-visible set**, computed by
  `passesGates(e.gates, prodStarter)` — which turns the hand-written set into a derived
  assertion and makes deleting it the obvious next commit.

**How it fails loudly if its own precondition is absent** — copy the `checked > 50` shape
from `ipc_auth.rs:971-976`, which this repo already treats as the model:
`expect(NAV_SECTIONS.length).toBeGreaterThanOrEqual(10)` and
`expect(NAV_SECTIONS.filter(e => e.gates.minTier).length).toBeGreaterThanOrEqual(3)` before
asserting anything about them. A registry that parses to an empty array must not read as
"no drift" — the failure mode that let a gate check nothing in four of this repo's CI jobs.

### 3. Make `check:tiers` fail loudly when the tier had no effect (≈20 lines)

`scripts/check-tiers.mjs` currently proves compilation. Two additions make it prove it
compiled *something different*, without adding a build:

- **Assert the variable arrived.** Before the loop, build once with a deliberately invalid
  `VITE_APP_TIER=__probe__` and assert the emitted bundle contains the literal `__probe__`.
  If Vite's substitution ever stops reaching `uiModes.ts:41`, every tier build silently
  becomes the builder build and the current script reports three green ticks. **This is the
  precondition assertion the contract demands, and it is the one that would have caught
  §7 A1 in CI rather than in this sweep.**
- **Give each tier its own `outDir` and assert the bundles differ.** All three currently
  overwrite `dist/`, which `ci.yml:153-155` already has to order around. With
  `--outDir dist-tier-<tier>`, assert `starter !== team` by content hash. Two identical
  bundles mean the gate did nothing, which is a failure, not a pass.
- Print the audited totals on success — `tiers OK (3 built, 3 distinct, VITE_APP_TIER
  verified reaching the bundle)` — so a build log distinguishes a clean run from an empty
  one.

The complementary one-line fix, independent of the script: **decide whether release should
build a tier at all.** Today `release.yml:193-197` produces the builder bundle by omission.
Either set `VITE_APP_TIER` explicitly there so the choice is visible in the diff, or delete
`build:starter`/`build:team` and the `check:tiers` CI step and stop paying for two bundles
per run that ship to nobody. **Both are defensible; the current state — paying for them and
shipping neither — is not.**

### 4. REFUSED — a census rule on "a nav list is gated but its router is not"

This is the highest-value condition in the leaf (§7 C: 15 of 21 `minTier` declarations sit
on destinations whose router mounts them anyway) and the census runner **provably cannot
host it**. Measured, in ascending order of fatality:

1. **The condition is a relation between two files, and the engine matches one file at a
   time.** `scanRule` (`scripts/census/lib/engine.mjs:147-239`) reads one source, applies
   one regex, counts. Expressing "`overviewTab === 'executions'` is dispatched here while
   `overviewItems` gates `executions` there" needs both files in scope simultaneously.
2. **The router shapes have nothing in common.** `OverviewPage.tsx:78-93` is a nested
   ternary ladder; `SettingsPage.tsx:30-41` is a `mountedTabs` array plus a `.map`;
   `DesignReviewsPage.tsx:76+` is a chain of `activeTab === 'x' && (…)`; `EditorBody.tsx`
   is a `useEffect`. A regex tuned to any one of the four scores zero on the other three —
   and the one it would miss most easily is `EditorBody`, the *correct* implementation.
3. **The negative is what matters, and a census rule counts positives.** The defect is the
   *absence* of a gate in a file that dispatches gated ids. A rule that matched "router
   without `useTier`" would flag every router in the app, ~90% of which dispatch nothing
   gated.
4. **The set of gated ids is data, not text.** It lives in five arrays across
   `sidebarData.ts`, `registry.ts` and `EditorTabBar.tsx`. Resolving it requires evaluating
   the modules, which is what item 2's *test* does natively and a text matcher cannot do at
   all.

**Specify instead a Vitest case beside item 2**, which has the modules in scope for free:
import each gated item array and the union type its router dispatches, and assert that for
every id carrying `minTier` or `devOnly` there exists a redirect guard — mechanically, that
the owning surface exports a `resolveVisibleTab(active, items, tier, isDev)` and uses it.
That converts the check from "detect the missing guard" to "the guard is the only way to
read the active tab", which is the §4 type answer with a test as its ratchet.

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. **Not because warnings drown in a large baseline** — the baseline is
1,135 (`shared-facts.json`), and the volume argument is not available at any count. The
count-independent argument is the only one that holds: `npm run check` runs `eslint src/`
with **no `--max-warnings`** (`package.json:51`), and the pre-commit hook runs
`--quiet --max-warnings 99999` (`lefthook.yml:20`), where `--quiet` discards warnings before
they can be counted. **A warn-level rule enforces nothing at either gate, by construction.**

---

## Convergence — what travels, one shared trap, and one result that inverts the brief

Checked against `../personas-cloud` (Node orchestrator + FastAPI facade),
`../personas-web` (Next.js App Router), `../brainiac` (Rust workspace, Postgres RLS).

**Physics — independently reinvented in all three, so §2's core clause travels:**

- **"Declare the predicate on the subject, in the same literal, and evaluate it once."**
  Three independent rediscoveries, in three languages, none sharing a document:
  `personas-cloud/packages/orchestrator/src/httpApi.ts:418-440` — `AuthRoute` puts
  `admin?: boolean` (`:437`) in the same object as the matcher and the `handler` (`:439`),
  and `httpApi.ts:1388` enforces it centrally before dispatch (58/58 routes covered, 3
  admin-gated). `personas-web/src/data/guide/types.ts:20-28` — `GuideTopic.mode` and
  `.devOnly` declared on the topic, resolved by the total function
  `isTopicVisible` (`lib/guide-utils.ts:37`). Personas' `NAV_SECTIONS` + `passesGates` is
  the same invention a third time. **This is as strong as this oracle gets, and it is
  precisely the clause §2 prescribes.**
- **A fail-*closed* default for an unclassified capability.** `brainiac` maps an
  unrecognised MCP tool to `"admin"` — `crates/brainiac-server/src/mcp.rs:246-248`, *"so a
  future tool cannot slip in ungated by accident."* Personas' two defaults both fail open
  (§8 gap 1). Same problem, opposite answer, and brainiac wrote its reasoning down. **This
  is direct external support for §4's "make `minTier` required".**
- **"A capability the build cannot provide is a typed refusal, not an absence."**
  `personas-web/src/lib/supabaseApi.ts:51-53` (`readOnly(): never` throwing
  `ApiError(501, …)` across 8 methods, with `export const supabaseApi: ApiClient` forcing
  every variant to implement the full surface) and
  `personas-cloud/packages/orchestrator/src/kafka.ts:310-325` (`createNoopKafkaClient`).
  Personas has no equivalent for a withheld capability at all (§8 gap 6).

**The shared trap — a convergent idiom that is a warning, not a licence:**

- **"A capability is a bare string, repeated in N literal lists that a comment says MUST
  stay in sync."** Present in both siblings and in Personas, and it has already caused
  real damage twice:
  `personas-web/src/app/api/feature-boosts/route.ts:26-30` — *"MUST stay in sync with
  BOOST_TIERS in src/components/sections/feature-voting/data.ts"*, two literals, two files,
  a comment as the only link. `brainiac/crates/brainiac-server/src/mcp.rs:228-231` — the
  same sentence for 18 MCP tools declared three times (definitions `:456-701`, scopes
  `:232-250`, dispatch `:725-745`), with **no test asserting the three agree**. And
  `brainiac/crates/brainiac-server/src/auth.rs:81-96` records the incident this produces:
  the `SCOPES` vocabulary and the endpoints enforcing it drifted, so narrow tokens were
  rejected as out-of-vocabulary and callers escalated to `admin` — *"collapsing 'an agent's
  token can read the library but never decree a rule' into 'give the agent the keys to the
  building'."* Personas' `SIMPLE_SECTIONS` / `DEV_MODE_SECTIONS` / `NAV_CARDS` (§7 B) are
  the same shape, one contradiction already live. **Convergent does not mean correct: this
  idiom is reinvented because it is easy, and every repo that reinvented it also
  documented it breaking.**

**This INVERTS part of the brief's framing:**

- **The tier axis is local calibration, not physics — and its own naming came from a
  pricing model that was withdrawn.** No sibling has a product tier: `personas-cloud` has
  `authType: 'user' | 'admin'` and **zero** tier/plan/quota/entitlement mechanics
  (`auth.ts:19-24`); `brainiac` has an 8-element `SCOPES` string array and no billing;
  `personas-web` has three *mutually inconsistent* tier vocabularies — `Starter/Pro/Team`
  in the FAQ across 14 locales (`i18n/en.ts:1501`), `local/cloud/enterprise` in a 30-key
  `pricing` catalog of which **1 key is consumed**, and `Team/Builder` in the guide — plus
  a section that asserts the opposite outright (`i18n/en.ts:1211`, *"ship free forever. No
  tiers, no per-seat pricing"*). The deleted pricing table
  (`git show c48e678^:src/data/pricing.ts`) had already drifted internally: 4 tiers vs 3
  comparison columns vs 3 key names, with Starter having no column at all. **The brief asks
  whether the tier is an entitlement boundary or a UI convenience. The measured answer is a
  third thing: it is the residue of an entitlement boundary that was designed, named, wired
  into the UI, and then cancelled on the commercial side without the UI being told.**
- **Consequently, the brief's P0 test does not fire and a different one does.** No paid
  capability is enforced only in the frontend, because no capability is paid. What *is*
  shipping is a customer-facing guide asserting four Builder/Team-tier capabilities that
  are gated at Team, at `devOnly`, or not at all (§7 E). **Any doctrine in this repo that
  treats the tier as security is the defect the brief predicted — and
  `docs/concepts/capability-audit.md:102-115` already said so on 2026-05-16, proposed the
  fix as "Ticket B", and nothing was built.** That, more than any count above, is the
  evidence that this leaf needs a gate rather than another audit.
