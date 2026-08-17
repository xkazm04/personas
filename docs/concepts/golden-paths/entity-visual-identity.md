# Entity visual identity

> `ui-system` › `design-tokens-theming` › **entity-visual-identity** — recurrence 66
> Composed 2026-08-15. Sweep: 41 source files read; 15 executable measurements run
> against the live modules (vitest harness over the real `src/`, not re-implementations);
> 4,829 `.ts`/`.tsx` files walked by the census runner; 2 sibling repos
> (`personas-web`, `brainiac/console`) measured as a convergence oracle.
> Shared counts cited from [`shared-facts.json`](../shared-facts.json) @ `211d519bb`.

---

## The question this path answers

**Does the same entity look like the same entity everywhere, and what happens when it
has no icon?**

Measured answer for this repo, today: **no, and the fallback is the worst part.**

- One persona with `color = null` renders in **8 different colours across 9 surfaces**.
- The persona icon picker offers **133 connector marks**; the number for which the
  picker preview and the saved persona render **agree is zero** — the two sanitizers
  guarding that one string are exact complements.
- **63 of 69** `<PersonaIcon/>` call sites can only ever render the same generic robot,
  because the prop that unlocks initials is optional and nobody passes it. The prop
  right next to it is required and is passed at **69 of 69**.
- The shared initials helper the whole app is supposed to route through **emits a lone
  UTF-16 surrogate** — a literal `�` — for any name that starts with an emoji.

Every one of those shipped under a green `npm run check`, and **zero tests cover any
identity path** (`grep` over every `*.test.ts{,x}` for `resolvePersonaIcon`,
`personaInitials`, `PersonaAvatar`, `memberColor`: no files).

---

## 1. Trigger

You are in this situation when you type or say any of:

1. "show the persona's avatar in this row" / "put the agent's icon on the card"
2. "give teams a colour so you can tell them apart in the grid"
3. "what do we show when a persona has no icon?"
4. "tint this chip with the entity's colour"
5. "pull the project's favicon onto the wall card"
6. "let the user pick an icon for this thing"

**The "if you are about to write X" test.** You are in this situation if you are about
to write any of:

```tsx
name.charAt(0).toUpperCase()          // a monogram
{ backgroundColor: `${x.color}20` }   // an identity tint
PALETTE[i % PALETTE.length]           // a colour "assigned" to an entity
<img src={someEntity.iconUrl} />      // an entity's mark
color ?? '#6B7280'                    // a no-colour default
```

You are **not** in this situation when the colour means a *state* — running, failed,
degraded, pending. That is [`status-and-severity-badges.md`](./status-and-severity-badges.md)
and [`design-token-usage.md`](./design-token-usage.md). Telling the two apart is §2's
first job, because in this repo they are currently **wired into the same 24-pixel box**
(§7-D4).

**Boundary with [`empty-and-demo-states.md`](./empty-and-demo-states.md).** That path owns
*a surface with no rows*. This path owns *a present entity with a missing attribute*.
The distinction is load-bearing and settles a real ambiguity: a persona with no icon is
**not** an empty state — the entity exists, the user knows its name, and something must
occupy its identity slot. An empty state says "there is nothing here"; an identity
fallback says "this specific thing, drawn from what we do know about it." Never render
`ScenarioEmptyState` for a missing avatar, and never render an entity fallback for an
empty list.

---

## 2. The one way

**Route every entity mark through one total classifier that turns the entity's stored
identity string into a closed, exhaustive union of render kinds, and give that
classifier's consumer a signature where the fallback inputs are REQUIRED props — then
derive nothing.** An entity's colour and mark are *data*, assigned once at creation and
persisted; they are never recomputed at render time from a hash, a list index, or a
name. When the data is absent, the fallback is a monogram cut on **codepoints, not code
units**, tinted from a palette that is disjoint from the semantic status ramp, and the
whole chain must be total: every input string, including `""`, `"🤖"`, `"日本語"`, a
dead URL and a 400-character paste, maps to something renderable. If you find yourself
choosing between two answers here, prefer **persist an assignment** over **derive at
render**: derivation looks cheaper and is the source of every drift in §7, because a
derived value is only as stable as the least stable input any one renderer happens to
have on hand — and the index of a row in a sorted list is the least stable input there
is.

---

## 3. Mandated primitives

| Primitive | What it gives you |
| --- | --- |
| `@/lib/icons/resolvePersonaIcon` → `resolvePersonaIcon(icon)` | **The classifier chokepoint.** Total function `string \| null \| undefined` → a 5-arm discriminated union `{kind:'builtin'\|'custom'\|'url'\|'emoji'\|'fallback'}`. URL sanitisation and the emoji heuristic happen once, here. Never re-classify an `icon` string at a call site. |
| `@/lib/icons/personaInitials` → `personaInitials(name)` | The monogram helper. Strips a `T:` team prefix, returns `?` for a blank name. **Currently broken on astral codepoints — see §7-D1 and §8-G1; fix it before routing more callers to it.** |
| `@/features/agents/components/PersonaIcon` → `<PersonaIcon icon color name display frameSize/>` | The universal persona mark: sprite / custom file / URL / emoji / initials / Bot, framed or "pop". 69 call sites. **Always pass `name`** — §7-D3. |
| `@/features/agents/components/PersonaAvatar` | The larger, name-aware sibling. Same classifier, bigger sizes, `fallbackStyle: 'initial' \| 'bot'`. |
| `@/lib/connectors/connectorMeta` → `getConnectorMeta(name)`, `<ConnectorIcon meta/>`, `<ThemedConnectorIcon url label color/>` | **The exemplary shape in this repo.** `ConnectorMeta.Icon` is a *required* component field, so a connector without a fallback is unrepresentable; `getConnectorMeta` is total and synthesises a meta for any unknown name. 142 entries, **0 without `Icon`**. |
| `@/lib/utils/sanitizers/sanitizeUrl` → `sanitizeIconUrl(url)` | HTTPS-only, private-range-blocked, credential-stripped image URL, or `null`. Already called inside `resolvePersonaIcon` — do not call it again at the call site. |
| `@/lib/connectors/connectorMeta` → `normalizeIconUrl(url)` | Bundled-asset allowlist (`/icons/connectors/<slug>.svg`). **Complementary to `sanitizeIconUrl`, not a superset** — §7-D2. |
| `@/features/shared/components/forms/ColorPicker` → `COLOR_PRESETS`, `DEFAULT_PERSONA_COLOR` | The 10-swatch identity palette and its default. The only identity palette anyone should import. |
| `@/lib/utils/colorWithAlpha` → `colorWithAlpha(hex, a)` | Identity tint at an alpha. Use this instead of welding `'20'` onto a hex string — a 4-digit hex breaks it, and four different alpha suffixes are already in the tree. |
| `@/lib/icons/customIconStore` → `useCustomIconSrc(assetId)` | Resolves `custom-icon:{sha256}` to a webview-loadable `asset:` URL. Returns `null` while resolving — treat that as `fallback`, which `PersonaIcon` already does (`PersonaIcon.tsx:109-110`). |

**Do NOT reach for:** a new hash function (six already exist, §7-D5), a new palette (five
already exist, §7-D6), `STATUS_PALETTE` / `text-status-*` / `--status-*` for anything that
identifies rather than reports (§7-D4).

---

## 4. Steps

1. **Decide whether the colour identifies or reports.** If a user could change it in a
   settings panel without lying, it identifies. If it is derived from a health score, a
   run outcome, or a severity, it reports — leave this path and go to
   [`status-and-severity-badges.md`](./status-and-severity-badges.md). Never let one
   element carry both meanings; §7-D4 is what that looks like when you do.

2. **Persist the identity at creation, do not derive it at render.** A new persona / team
   / workspace gets a `color` written to its row when it is created (see
   `autoAssignIcons.ts:102-104`, which assigns `icon` *and* `color` together). A renderer
   that needs a colour reads the column. The word "derive" should not appear in a
   renderer.

3. **Classify once.** `const resolved = resolvePersonaIcon(entity.icon)`. Branch on
   `resolved.kind` and nothing else. Do not test `icon.startsWith('http')`,
   `icon.length <= 8`, or `isAgentIcon(icon)` at a call site — all three already live in
   the classifier, and `autoAssignIcons.ts:70-73` re-implementing the emoji heuristic is
   how the two drift.

4. **Make the fallback inputs REQUIRED in the signature — this is the step that decides
   whether any of the rest happens.** Before you write §9's gate, ask whether the
   primitive can make the wrong call impossible. Here it demonstrably can, and this repo
   contains a controlled experiment proving it:

   | `PersonaIcon` prop | Declared as | Passed at |
   | --- | --- | --- |
   | `color` | `color: string \| null \| undefined` (**required**) | **69 / 69 — 100%** |
   | `name` | `name?: string \| null` (**optional**) | **6 / 69 — 8.7%** |

   Same component, same call sites, same authors, same JSDoc explaining why `name`
   matters. The *only* difference is one `?`. Make the prop that unlocks the fallback
   required and it gets passed; leave it optional and 91.3% of your surfaces render the
   generic robot. `ConnectorMeta.Icon` (required, 142/142 present) is the same lesson
   from the other direction.

5. **Cut the monogram on codepoints.** `[...name][0]` or `Array.from(name)[0]`, never
   `charAt(0)` / `slice(0,2)` / `substring(0,2)`. There are currently **zero**
   codepoint-safe monogram cuts anywhere in `src/`, including inside the shared helper.

6. **Tint through `colorWithAlpha`, and use the identity palette.** `colorWithAlpha(c,
   0.18)` — not `` `${c}20` ``, not `` `${c}1f` ``, not `` `${c}10` ``. If you need a
   palette pick because the entity has none, take it from `COLOR_PRESETS`, keyed on the
   entity's **stable id**, and persist the result. Never key on a render index.

7. **Give the mark an accessible name at the primitive, not the call site.** 0 of 69
   `<PersonaIcon/>` sites declare any `aria-*` or `role`. That is correct — the primitive
   should own it. Today it half does (`role="img"` on the emoji arm only, `aria-hidden`
   on the initials arm), which means an initials-only persona is invisible to a screen
   reader. Fix it in `PersonaIcon`, not in 69 places.

8. **Handle the dead image.** Any `<img>` whose `src` came from outside the bundle needs
   an `onError` that flips to the classifier's `fallback` arm. 3 of 68 `<img>` tags in
   `src/` have one (4.4%); **none** of them is an entity mark.

9. **And then stop.** Once you have `resolvePersonaIcon` + `<PersonaIcon icon color
   name/>`, you are done. Do not add a wrapper, do not add a size map, do not add a
   local palette. If the primitive cannot express what you need, that belongs in §8, not
   in a ninth renderer.

---

## 5. Anti-patterns

**A. The monogram cut on a UTF-16 code unit.**
```tsx
{name.charAt(0).toUpperCase()}        // PersonaAvatar.tsx:105
```
*Failure mode:* `"🤖 Ops Bot".charAt(0)` returns `"\ud83e"` — half a surrogate pair.
The browser renders `�`. Every emoji-named persona, every CJK name whose first
grapheme is a variation sequence, every flag. Measured: 3 of 11 representative names
produce a lone surrogate. The fix is `[...name][0]`, and it is one character longer.

**B. Positional identity — a palette indexed by where the row happens to be.**
```ts
export function agentColor(agent: CronAgent, index: number): string {
  return agent.persona_color || PALETTE[index % PALETTE.length]!;   // calendarHelpers.ts:164
}
```
*Failure mode:* the entity's colour is a function of the **list**, not the entity. Run
over indices 0..8: **8 distinct colours for the same agent.** Re-sort the calendar,
filter one row out, add a schedule — everything recolours. This is not a colour that
identifies anything; it is a stripe pattern. Both sibling repos reinvented this exact
bug independently (see Convergence).

**C. A second hash over the same string.**
Six string hashes exist in `src/`. Two of them — `eventModel.ts:124` (`h*31 + c`) and
`useIllustration.ts:109` (`(h<<5) - h + c`) — are **literally the same algorithm**
(`(h<<5) - h` *is* `31h`), differing only in overflow discipline (`>>> 0` vs `| 0` +
`Math.abs`). Run over 9 sample ids they **agree on 5 and diverge on 4** — they agree
until the value overflows 32 bits, then never again. *Failure mode:* a spot-check in
review passes; production diverges on longer ids. A hash that agrees sometimes is worse
than one that never does.

**D. Two sanitizers on the same string with disjoint acceptance sets.**
`normalizeIconUrl` admits only `^/icons/connectors/[a-z0-9-]+\.svg$`. `sanitizeIconUrl`
admits only `https://…`. A string cannot start with both, so **their intersection is
empty by construction**. Both guard `persona.icon`. *Failure mode:* the picker preview
and the saved render can never agree — measured at 0 of 133 (§7-D2).

**E. Semantic tokens on an identity element.**
```tsx
{favicon ? <img src={favicon}/> : <span style={{ background: worst }}/>}  // CoverBody.tsx:107-110
```
where `worst = scoreInk(min(automationReadiness, productionReadiness))`. *Failure mode:*
the identity slot and the health signal share one 24-pixel box and are **mutually
exclusive** — a project with a favicon has no visible health dot, and a project without
one is identified by its worst score. An entity tinted `--status-error` reads as broken
rather than as itself.

**F. `color ?? '<a different literal each time>'`.**
Seven distinct no-colour defaults across nine surfaces: `#6B7280`, `#8b5cf6`,
`var(--primary)` (theme-dependent, 11 values), `var(--color-primary)`,
`var(--color-primary-5)`, `var(--color-muted-foreground)`, a hashed palette pick, and a
positional pick. *Failure mode:* the user opens two tabs and sees two different personas.

**G. Re-implementing the classifier's heuristic at a call site.**
`autoAssignIcons.ts:70-73` carries a byte-for-byte copy of `looksLikeEmoji`'s body under
a different name. *Failure mode:* the classifier's heuristic is wrong in two directions
(§8-G2); when it is fixed, the copy will not be, and the auto-assign pass will start
overwriting icons the renderer still honours.

**H. `<img>` on an entity mark with no `onError`.**
*Failure mode:* a dead remote URL leaves the browser's broken-image glyph in a 24px box
forever. The classifier already has a `fallback` arm; nothing routes a load failure back
into it. 65 of 68 `<img>` tags cannot.

**I. Keying an identity asset on the display name.**
Not present here, but the near-miss `IMAGE_BY_NAME[name]` in `personas-web` is a live
bug there (rename the persona, lose the portrait). If you are tempted, key on the id.

---

## 6. Evidence

### The ONE site to copy

**`src/lib/connectors/connectorMeta.tsx:57-62` + `:283-287` + `:409-422`.**

```tsx
export interface ConnectorMeta {
  label: string;
  color: string;
  iconUrl: string | null;                                     // may be absent
  Icon: React.ComponentType<{ className?: string; … }>;       // MAY NOT be absent
}

export function getConnectorMeta(name: string): ConnectorMeta {
  if (!name) return { label: 'Unknown', color: '#6B7280', iconUrl: null, Icon: Plug };
  if (CONNECTOR_META[name]) return CONNECTOR_META[name];
  return { label: name, color: '#6B7280', iconUrl: null, Icon: Plug };   // TOTAL
}

export function ConnectorIcon({ meta, size }: { meta: ConnectorMeta; size?: string }) {
  const FallbackIcon = meta.Icon;
  const safeUrl = normalizeIconUrl(meta.iconUrl);
  if (safeUrl) return <ThemedConnectorIcon url={safeUrl} label={meta.label} color={meta.color} size={size}/>;
  return <FallbackIcon className={size} style={{ color: meta.color }}/>;
}
```

Three things make this the model, and each maps to a step in §4:

- **The fallback is a required field.** `Icon` has no `?`. **142 of 142 entries carry
  one** — verified by scanning every entry. There is no code path that produces a
  connector without a renderable mark, because the type does not permit one.
- **The resolver is total.** `getConnectorMeta('')`, `getConnectorMeta('../../etc/passwd')`
  and `getConnectorMeta('🤖')` all return a renderable meta with `Icon: PRESENT`
  (executed, all five probe inputs).
- **The renderer never derives.** Colour and label come off the record. No hash, no
  index, no `charAt`.
- **`ThemedConnectorIcon` carries its own accessible name** — `role="img"` +
  `aria-label={label}` on the mask span, and a labelled `<Plug>` on the fallback arm
  (`:387`, `:392-393`). It is the only identity renderer in `src/` that labels *both*
  arms.

Copy this shape. Its one flaw is a **data** bug, not a shape bug — §7-D2.

### The classifier to copy

**`src/lib/icons/resolvePersonaIcon.ts:54-78`.** A total function into a closed
discriminated union, with the sanitisation folded in, and a docstring that names the
divergence it was written to end ("`PersonaIcon` silently dropped HTTPS URLs while
`PersonaAvatar` honored them"). Executed over 19 hostile inputs it never threw and never
returned `undefined`; `javascript:`, `data:` and `http://` all correctly close to
`fallback`. Its heuristic arm is wrong (§8-G2) but its *shape* is right.

### Secondary exemplars

- **`src/features/agents/components/PersonaIcon.tsx:118-123`** — the `pop` display mode
  deliberately *downgrades* to `framed` for `fallback` / `custom` / `url` kinds, with a
  comment explaining that a 3× burst suits curated art and emoji but turns a user upload
  into "an oversized blob that bleeds into adjacent text." Kind-aware layout, decided
  once in the primitive. Copy this instinct.
- **`src/lib/connectors/connectorMeta.tsx:349-366`** — `ensureContrast()` lifts a brand
  colour's luminance per theme before painting it. The only place in the repo where an
  identity colour is made theme-aware at all.
- **`src/features/teams/sub_factory/passport/CoverBody.tsx:107`** — the Statband's project
  favicon is a **`data:` URL produced by a Rust probe**
  (`dev_tools_get_project_favicon`, `src-tauri/src/commands/infrastructure/dev_tools.rs:2560`,
  walking 11 well-known paths with a size cap). Copy the *architecture*: an identity
  image sourced locally and inlined needs no network, no CSP host, and cannot 404. Do
  **not** copy its fallback (§7-D4).

---

## 7. Deviations

Every count below was produced by executing the real modules or by walking the real tree.
Ordered by blast radius.

### D1 — The shared monogram helper emits a lone surrogate. `src/lib/icons/personaInitials.ts:15-16`

```ts
if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase();
return (words[0]![0]! + words[1]![0]!).toUpperCase();
```

Executed:

| name | `personaInitials` | renders as |
| --- | --- | --- |
| `"Ada Lovelace"` | `"AL"` | AL |
| `"T: Growth Squad"` | `"GS"` | GS |
| `"🤖"` | `"\ud83e"` | **`�`** |
| `"👨‍👩‍👧‍👦 Family"` | `"\ud83dF"` | **`�F`** |

**This is the contract's fifth §9 failure mode, live.** The prescription "route callers
to the shared helper" is *correct* and would still be *useless* here, because the
destination has the same bug as the 9 hand-rolled sites it is supposed to replace. Fix
`personaInitials` to `[...words[0]!][0]!` **first**; only then is routing to it an
improvement. One edit at the primitive corrects all 4 current consumers plus the 63
call sites step D3 unlocks.

### D2 — Two sanitizers with an empty intersection guard one string. 0 of 133 agree.

`IconSelector.tsx:68` writes a connector's `icon_url` **directly into `persona.icon`**:
`onClick={() => onChange(c.icon_url!)}`. Two different functions then read that string:

| | admits | of the 133 connectors with an `iconUrl` |
| --- | --- | --- |
| picker preview → `ThemedConnectorIcon` → `normalizeIconUrl` (`connectorMeta.tsx:310`) | `^/icons/connectors/[a-z0-9-]+\.svg$` only | **78 show the brand mark, 55 show a grey `Plug`** |
| saved persona → `PersonaIcon` → `resolvePersonaIcon` → `sanitizeIconUrl` | `https://…` only | **54 render, 79 resolve to `fallback` and render nothing** |
| **both agree and show the mark** | — | **0** |

A string cannot begin with both `/icons/` and `https://`, so this is not a coincidence —
**the intersection is empty by construction.** Every icon that previews correctly
vanishes when saved; every icon that saves correctly previews as a grey plug. Neither
function logs, and there is no `onError`, so the failure is entirely silent.

Two second-order findings fell out of the same run:

- **45.1% of `CONNECTOR_META` renders the generic lucide fallback, not its brand mark.**
  142 entries: 78 admitted by `normalizeIconUrl`, **54 rejected remote**
  (`https://cdn.simpleicons.org/...`), **1 rejected local**, 9 `null` by design.
  Verified by two independent implementations (module import; regex over the source
  text) which agreed exactly.
- **The 1 rejected local path is `mcp_gateway` → `/icons/connectors/mcp_gateway.svg`.**
  `SAFE_ICON_URL_RE` is `[a-z0-9-]+` — no underscore. One character in a regex silently
  demotes one connector.
- **The CSP explicitly allowlists `https://cdn.simpleicons.org`**
  (`src-tauri/tauri.conf.json:44`) — someone deliberately opened the network path for
  exactly these 54 icons, and the sanitizer in the same file discards them all. That CSP
  entry is currently dead policy surface for `ConnectorIcon`; it is live only for the 4
  `<ComposerBrandIcon>` call sites, which use `meta.iconUrl` raw
  (`ComposerBrandIcon.tsx:23-24`, no sanitizer). **So GitHub renders as the GitHub logo
  in the Composer and as a generic `Plug` in the vault, from the same record.** 64
  sanitized call sites vs 7 raw ones vs 2 more that pass `iconUrl` to a bare `<img>`
  (`matrixShared.tsx:81`, `AssignmentMatrix.tsx:66`) — where a `currentColor` SVG renders
  monochrome black, per `ComposerBrandIcon`'s own docstring.

### D3 — 63 of 69 `<PersonaIcon/>` sites can only ever render the generic Bot.

`PersonaIcon`'s `name` prop is optional and its JSDoc explains exactly what it buys
("so unkeyed personas stay visually distinguishable… Omit it to keep the Bot fallback").

| | passed at |
| --- | --- |
| `color` — **required** in the interface | 69 / 69 (100%) |
| `name` — **optional** (`name?:`) | 6 / 69 (8.7%) |

The 63 sites are listed in the §9 rule's territory; they span `sub_director`,
`sub_manual-review`, `sub_health`, `teamStudio`, `sub_studio`, `fleet/monitor`,
`quick-answer`, `schedules` — i.e. every surface where a user compares one persona to
another. The initials branch (`PersonaIcon.tsx:188-203`) and `personaInitials` both exist
and are unreachable from 91% of the app.

### D4 — Identity colour and semantic colour share slots and swatches.

**(a) The Statband shares one box.** `CoverBody.tsx:107-110`: `favicon ? <img/> :
<span style={{background: worst}}/>` where `worst` is a readiness-score colour
(`:85`). Identity and severity are mutually exclusive in the same 24px slot. The
docstring at `:34` records this as intentional ("null → the worst-state dot stays"),
which makes it a design decision rather than an oversight — and it is the wrong one: a
project either has a health signal or it has a name-mark, never both.

**(b) 6 of 57 identity swatches are byte-identical to a semantic status token.**

| identity palette | swatches | exact collisions with `--status-*-raw` |
| --- | --- | --- |
| `MEMBER_FALLBACK_PALETTE` (`eventModel.ts:116`) | 10 | **4** — `#34d399` = `status-success`, `#f87171` = `status-error`, `#fbbf24` = `status-pending`, `#60a5fa` = `status-processing` |
| `AGENT_ICONS[].suggestedColor` | 21 | 2 — `#94a3b8` = `status-neutral`, `#fbbf24` = `status-pending` |
| `COLOR_PRESETS` (`ColorPicker.tsx:9`) | 10 | 0 |
| `PALETTE` (`calendarHelpers.ts:159`) | 8 | 0 |
| `WORKSPACE_COLORS` (`workspaceStore.ts`) | 8 | 0 |

`MEMBER_FALLBACK_PALETTE` is the *hashed fallback* — the palette a persona lands in
precisely when it has no colour of its own. **A colourless persona has a 40% chance of
being painted in exactly the app's success, error, pending or processing colour** on
every channel surface (8 `memberColor` call sites across 6 files: `ConversationCards`
×3, `ConversationSidebar`, `ChannelMap`, `Stream`, `StreamRow`, `collabRender`).

**(c) Identity colour is the one colour system that ignores the contrast setting.**
`--status-*-raw` is redefined 3–4× (base, high-contrast dark, high-contrast light) and
each theme further derives the resolved token via `color-mix`. Identity colours are raw
hex literals stored in a DB column and painted as-is. In high-contrast light theme every
semantic colour remaps to a near-black (`#7f1d1d`, `#064e3b`); a persona's `#ef4444`
does not move. `ensureContrast()` (`connectorMeta.tsx:349`) exists and solves this — for
connectors only.

> **A premise in the brief, corrected.** The brief anticipated that an entity tinted
> `text-status-error` would be the collision. Measured, that specific shape does not
> occur: `STATUS_PALETTE` is a map of Tailwind *class strings*, entity tints are inline
> `style` hexes, and no call site tints an entity with a `text-status-*` class. The
> collision is real but lives one layer down — in the raw hex values and in slot sharing,
> not in the class names. A class-name gate would have found nothing.

### D5 — Six string hashes, five different answers for the same id.

| # | file:line | body | shape | used for |
| --- | --- | --- | --- | --- |
| 1 | `src/lib/channel/eventModel.ts:124` | `h*31 + c`, `>>>0` | private | **member identity colour** |
| 2 | `src/features/plugins/companion/inbox/hooks/useIllustration.ts:106` | `(h<<5) - h + c`, `\|0`, `abs` | exported `hashId` | **persona illustration category** |
| 3 | `src/features/fleet/monitor/channels/map/mapModel.ts:61` | FNV-1a → `[0,1)` | exported `hashUnit` | map layout |
| 4 | `src/features/plugins/fleet/sub_monitor/monitorModel.ts:19` | FNV-1a → u32 | private `fnv` | simulated stats |
| 5 | `src/features/home/sub_welcome/HeroHeader.tsx:12` | FNV-1a → u32 | private `hashString` | background pick |
| 6 | `src/features/teams/sub_mastermind/lib/hex.ts:17` | djb2 → `[0,1)` | exported `hash01` | layout jitter |

`#1` and `#2` are the same algorithm. `#3`, `#4`, `#5` are three copies of FNV-1a, two of
them private. Executed over the same id `"p_7f3a91b2"`, the palette slot (`mod 10`) each
one selects is **6, 0, 9, 1, 1** — five implementations, four different answers.

Only #1 and #2 currently drive an identity visual, and they drive *different* visuals
(colour vs illustration) from the *same* `persona.id`, so a persona's colour family and
its illustration are uncorrelated by construction. Not user-visible today; a trap the
moment anyone wants them to match.

### D6 — Five hard-coded identity palettes; positional assignment in three of them.

29 distinct swatches across 5 arrays; 14 appear in 2+ palettes, 15 in exactly one — so
the palettes are neither shared nor deliberately distinct. Positional assignment:

- `calendarHelpers.ts:164` — `agentColor(agent, index)`, index from `.map((e,i)=>…)` at
  `ScheduleCalendar.tsx:47`. **Executed: same agent, 9 positions, 8 colours.**
- `workspaceStore.ts:110` — `w.color ?? WORKSPACE_COLORS[i % …]` at render, `i` from the
  map index.
- `workspaceStore.ts:146` — `WORKSPACE_COLORS[snapshot.workspaces.length % …]` at
  *creation*. This one is defensible: it is assigned once and persisted. It is the
  correct half of the pattern, sitting 36 lines from the incorrect half.

### D7 — Nine hand-rolled monograms, plus the helper. `code-unit-monogram`: 10 files / 10 matches.

`PersonaAvatar.tsx:105` · `PersonaRunner.tsx:219` · `ComposerEventPersonaList.tsx:71` ·
`ComposerEventTemplateList.tsx:56` · `ConversationSidebar.tsx:105` · `ChannelMap.tsx:285` ·
`GitLabConnectionForm.tsx:51` · `monitoringCard.tsx:140` · `PresetGraphAdapter.tsx:157` ·
`personaInitials.ts:15`.

Executed against `personaInitials` over 11 names, `charAt(0)` **disagrees on 7 of 11** —
and not only on emoji: `"T: Growth Squad"` gives `"T"` from `PersonaAvatar` and `"GS"`
from `PersonaIcon`, because only the shared helper strips the team prefix. **The same
team renders as `T` in one place and `GS` in another.** There is also a *second* initials
helper, `initialsOf` (`fleetGridModel.ts:60`), which wraps `personaInitials` with a
`cleanName` that strips `T:` **again** plus an `SDLC` prefix — duplicated normalisation
in two layers.

`monitoringCard.tsx:140` is worth singling out: `{label.trim().charAt(0).toUpperCase() ||
'?'}` — the author *did* think about the empty case and wrote a `|| '?'` guard. It does
not help; `"".charAt(0)` is `""` so the guard fires correctly, but `"🤖".charAt(0)` is
truthy garbage and sails straight through. Thinking about the empty string is not the
same as thinking about the encoding.

### D8 — 65 of 68 `<img>` tags cannot fail. 5 have no `alt` at all.

68 `<img>` in `src/**/*.tsx`, across 56 files. **3 carry `onError`**
(`FocusedDecisionCard.tsx:83`, `ImageLane.tsx:112`, `NowPlayingCard.tsx:124`) — none is an
entity mark. 63 have `alt` (44 of them `alt=""`), **5 have none**:
`ComposerBrandIcon.tsx`, `DirectorCoachingTab.tsx`, `CompositionPreview.tsx`,
`DriveImageLightbox.tsx`, `connectorMeta.tsx`.

Concretely: `PersonaIcon.tsx:161-172` renders a remote `<img>` for `kind:'url'` with
`referrerPolicy` and `crossOrigin` set — real thought about privacy — and **no `onError`**.
Since production CSP `img-src` allows only 4 remote hosts (§8-G3), a persona icon URL
from anywhere else is *guaranteed* to fail in a packaged build, and the guaranteed
failure has no handler.

### D9 — An initials-only persona is invisible to a screen reader.

`PersonaIcon.tsx:194` puts `aria-hidden="true"` on the initials `<span>`; `:182-183` puts
`role="img" aria-label={t.shared.agent_icon_label}` on the emoji `<span>` — a *generic*
label ("Agent icon"), not the persona's name. `PersonaGlyph.tsx:31` is `aria-hidden`.
`CoverBody.tsx:108` favicon is `alt="" aria-hidden`. So across the persona surfaces there
is **no path by which an assistive technology learns which persona a mark belongs to**,
and 0 of 69 call sites compensate. `ThemedConnectorIcon` is the counter-example that
proves it is solvable at the primitive.

### D10 — Config-level identity gaps (measured from config; not device-verified).

- **dev/prod CSP skew.** `devCsp` allows `https://*.googleusercontent.com` (wildcard);
  production allows only `https://lh3.googleusercontent.com` (exact). An avatar served
  from `lh4.` works in `tauri dev` and breaks in the installer.
- **Android drops custom icons.** `tauri.android.conf.json:11` sets
  `img-src 'self' https://cdn.simpleicons.org data:` — no `asset:`, no
  `http(s)://asset.localhost`. `useCustomIconSrc` resolves `custom-icon:{sha}` through
  `convertFileSrc`, which produces exactly those schemes. Every user-uploaded persona
  icon should therefore fail closed on Android and fall through to `Bot`.
- **`autoAssignIcons` is latched in `localStorage`** (`ASSIGNMENT_KEY`,
  `autoAssignIcons.ts:16,64`), not in the database it mutates. Clearing site data re-runs
  a one-time migration; moving the DB to a machine that already ran it skips it forever.

---

## 8. Gaps — what the primitives genuinely cannot do

**G1 — `personaInitials` cannot produce a correct monogram, and no correct one exists.**
Not laziness: there are **zero** codepoint-safe leading-character cuts anywhere in
`src/`. `[...name][0]` fixes surrogate pairs but still splits ZWJ sequences and
combining marks (`"👨‍👩‍👧‍👦"` → `"👨"`, an *emoji family* reduced to a man). Fully correct
requires `Intl.Segmenter('…', {granularity:'grapheme'})`, which is not used anywhere in
the repo and is the honest ceiling: `[...name][0]` is a strict improvement and is where
to stop unless a grapheme bug is reported.

**G2 — `looksLikeEmoji` is wrong in both directions and cannot be fixed by tuning.**
`resolvePersonaIcon.ts:41-48`: `length <= 8 && !/^[a-zA-Z0-9_:.\-/]+$/`. Executed:

| input | classified | should be |
| --- | --- | --- |
| `"🤖"` | `emoji` ✓ | emoji |
| `"🏳️‍🌈"` (6 code units) | `emoji` ✓ | emoji |
| `"👨‍👩‍👧‍👦"` (11 code units) | **`fallback`** ✗ | emoji |
| `"Ægir"` | **`emoji`** ✗ | not an icon |
| `"日本語"` | **`emoji`** ✗ | not an icon |

"Short and non-ASCII" is not "is an emoji". A Nordic or CJK string pasted into the icon
field is rendered as text with `role="img" aria-label="Agent icon"`; a legitimate ZWJ
family emoji is rejected for being 11 code units. A length threshold cannot separate
these — the classes overlap. The real discriminator is Unicode property escapes
(`/^\p{Extended_Pictographic}/u`), which needs a deliberate change, not a bigger
constant.

**G3 — An entity icon from an arbitrary URL cannot work in a packaged build, and the
type says it can.** `sanitizeIconUrl` admits any HTTPS host (blocking only private
ranges), so `resolvePersonaIcon` returns `{kind:'url'}` for `https://anything/x.png`.
Production `img-src` permits exactly four remote hosts: `cdn.simpleicons.org`,
`lh3.googleusercontent.com`, `i.ytimg.com`, `yt3.ggpht.com`. So the `url` arm is a
**promise the runtime cannot keep for any host outside that list**, and the shortfall is
invisible: no `onError`, no CSP-violation surface, just a blank box.

*Does anything depend on it working?* **Measured: no.** Zero persona/template seeds carry
an `"icon": "https://…"` value. The only producer of a `url`-kind persona icon is
`IconSelector`, which offers connector `icon_url`s — 54 of which are `cdn.simpleicons.org`
and therefore inside the allowlist. So today the `url` arm is *reachable but not
depended on*, which makes it cheap to narrow: `sanitizeIconUrl` should take the CSP host
list as its allowlist so the type stops promising more than the runtime delivers, and the
rejection becomes visible at classification time instead of as a blank box.

**G4 — There is no theme-aware identity colour.** `ensureContrast` exists for connectors;
personas, teams and workspaces store a raw hex and paint it. A persona coloured
`#000000` is invisible on a dark theme and there is no primitive that would prevent it.
`ColorPicker` accepts any hex with no contrast check. This is a genuine missing
primitive, not a misuse of an existing one, and it is upstream of D4(c).

**G5 — Nothing routes an image load failure back into the classifier.** The union has a
`fallback` arm; `<img onError>` is a DOM event. Bridging them needs a stateful wrapper
(`const [failed, setFailed] = useState(false)`) inside `PersonaIcon`, which is the right
place — but it does not exist, so §4 step 8 currently has no primitive to name. This is
the one step in this path where the correct answer is "write it."

---

## 9. The missing gate

### What every deviation above has in common

`npm run check` is green. `npm run lint` reports 0 errors. 4,829 files linted, and not
one of the 18 custom rules looks at an identity mark. There are **no tests** on any
identity path. Every defect in §7 shipped under a fully green gate, and D2 — the
0-of-133 disagreement — is invisible to code review by construction, because the two
halves are in different files and each is individually correct.

### The condition this signal is a proxy for

> **An entity's display name is reduced to leading characters by a UTF-16 code-unit
> index.**

That is the condition. It is stack-independent — any language with UTF-16 strings
(JS, Java, C#, Dart) has it. The *proxy* below is JavaScript-shaped and does **not**
travel; an adopting repo re-derives its own from the same condition. (This is the
portability lesson from [`golden-path-contract.md`](../golden-path-contract.md) §"Section 9
is MANIFESTATION-layer": four wave-1 signals scored zero true positives in a sibling
because they keyed on the markup a deviation happened to wear.)

### Why this condition and not a more central one

I considered three and rejected two, with measurement:

- **`<PersonaIcon>` without `name=`** (63 hits) — rejected as the primary gate. The right
  fix is making the prop required, which deletes the condition rather than ratcheting it.
  A census rule here would be obsolete the day the type lands. It belongs as the
  *follow-up* ratchet, not the gate.
- **Positional palette indexing** (`PALETTE[i % PALETTE.length]`) — the clause with the
  strongest convergence evidence (reinvented four times in `brainiac`), and **refused as
  a gate on measured precision.** Two candidates were built and run:

  | candidate | signal | files / matches | positional-identity hits | precision |
  | --- | --- | --- | --- | --- |
  | A (broad) | any `arr[x % arr.length]` | 65 / **75** | 3 | **4%** |
  | B (narrow) | identifier contains `PALETTE`/`COLORS` | 11 / **14** | 3 | **21%** |

  Candidate A is 90%-plus loading-skeleton ghost widths (`GHOST_NAME_WIDTHS[i % …]`,
  `HEALTH_GHOST_WIDTHS`, `BACKLOG_GHOST_TITLE_WIDTHS` — the repo's own
  [`page-loading`](./page-loading.md) doctrine), chart series, tab cycling and gallery
  navigation. Candidate B is 5 chart-series picks, 2 decorative particle fields, 2
  confetti bursts — **and `eventModel.ts:126`, which is the hash-keyed form this very
  path prescribes as the fix.** A gate whose second-largest true-positive neighbour is
  the compliant construction is not a gate; it is a nag that teaches people to ignore
  the runner.

  The missing piece is honest: **the difference between "a palette of colours" and "a
  palette of skeleton widths" is not visible in the syntax.** Both are
  `IDENT[i % IDENT.length]`. Separating them requires matching on the *identifier's
  name*, which is matching text, not structure — the failure this brief explicitly warns
  about, and which candidate B commits (it is 79% wrong precisely because a name is not
  a type). **Refused, and the refusal is the finding:** positional identity is real,
  converged, and — in this stack — ungateable by counting. It is gateable by *typing*:
  a `IdentityColor` newtype that only `resolveIdentityColor(entityId)` can mint would
  make `PALETTE[i % …]` unassignable to a `color` prop, and no regex would be needed.
  That belongs in the same rollout as §9 fix #2.
- **The code-unit monogram** — accepted. It has a genuine structural discriminator (below)
  and I measured it at **10/10 precision** after one correction.

### Already-gated check

Searched all 68 existing rules in `scripts/census/rules.json`. The nearest neighbours are
`typo-token-overpainted` and `hand-rolled-disabled-state` (both
`design-token-usage.md`), `untranslatable-token-label` (`status-and-severity-badges.md`),
and `hand-assembled-currency` / `locale-blind-percent` (`number-and-cost-formatting.md`).
None of the 68 matches `charAt(0)`, `slice(0,`, an identity palette, or an `<img>` on an
entity. **Not already gated; no id collision with `code-unit-monogram`.**

### The signal, and the structure it discriminates on

The naive pattern `\.charAt\(0\)\.toUpperCase\(\)` fires on 43 sites, **most of which are
correct** — because `X.charAt(0).toUpperCase() + X.slice(1)` is the Title-Case idiom, not
a monogram. Matching the token is exactly the "gate that fires on correct content"
failure.

The structural discriminator is **what happens to the rest of the string**:

- Title Case **keeps** it — `.toUpperCase() + rest` or `` `${…toUpperCase()}${rest}` ``.
- A monogram **throws it away** — the expression ends.

So the signal is the cut *without* a continuation. Both continuation forms go in a
negative lookahead (a lookahead, never a variable-length lookbehind).

**This mattered.** The first version used only `(?!\s*\+)` and reported 11 files. One —
`GlyphCapabilityPreview.tsx:116`, `` `${triggerType.charAt(0).toUpperCase()}${triggerType.slice(1)}` ``
— was a **false positive**: a Title Case written with template-literal concatenation
instead of `+`. Adding `\}\s*\$\{` to the lookahead moved it to the control and took
precision from 90.9% to 100%.

### Validation

Run standalone against a private registry (never editing the shared `rules.json`):

```
$ node scripts/census/run-census.mjs --rules <scratch>/rules-entity-visual-identity-evi.json --verbose

  rule                                  files  base  matches  base  walked  floor
  DRIFT code-unit-monogram                 10     0       10     0    4829   4000
  OK    code-unit-monogram-positive-control 31     —       33     —    4829   4000

  census OK — 2 rule(s), 9658 file-visits, 43 surviving violation(s) across 41 file(s).
```

**Precision: 10/10.** Every hit inspected by hand:

| # | site | entity | verdict |
| --- | --- | --- | --- |
| 1 | `PersonaAvatar.tsx:105` | persona | true positive |
| 2 | `PersonaRunner.tsx:219` | persona | true positive |
| 3 | `ComposerEventPersonaList.tsx:71` | persona | true positive |
| 4 | `ComposerEventTemplateList.tsx:56` | persona | true positive |
| 5 | `ConversationSidebar.tsx:105` | team | true positive |
| 6 | `ChannelMap.tsx:285` | team member | true positive |
| 7 | `GitLabConnectionForm.tsx:51` | GitLab user | true positive |
| 8 | `monitoringCard.tsx:140` | monitoring target | true positive |
| 9 | `PresetGraphAdapter.tsx:157` | role | true positive |
| 10 | `personaInitials.ts:15` | **the shared helper** | true positive |

**Recall check:** the same anchors *with* a continuation match 31 files / 33 matches, and
the two sets do not overlap. The near-miss corpus is 3× the violation corpus, which is
what makes the discriminator worth having.

**`personaInitials.ts:15` is deliberately NOT excluded.** The reflex is to exempt "the
primitive itself" — the pattern used by `raw-web-storage` and `raw-select`. That reflex is
wrong here and exempting it would reproduce the exact failure the contract documents:
a gate that confirms you *arrived* at a destination that is itself broken. The helper is
a genuine violation. When D1 is fixed, the baseline ratchets 10 → 9 and the exemption was
never needed.

**How it fails loudly.** Inherited from the runner: `floor: 4000` fails the run if the
walk sees fewer than 4,000 files ("the matcher is broken, not the codebase clean" — the
tree currently holds 4,829); a rule matching zero files anywhere is a structural failure;
a count that **drops** without the baseline moving is a failure, not a celebration. The
positive control carries **no baseline** by design — it exists to be run and read, never
to ratchet, since a control counting compliant code would fail every time adoption
improved.

### Rule block — for the orchestrator to merge into `scripts/census/rules.json`

```json
{
  "id": "code-unit-monogram",
  "goldenPath": "docs/concepts/golden-paths/entity-visual-identity.md",
  "title": "An entity's monogram cut on a UTF-16 code unit",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.(?:charAt\\(0\\)|slice\\(0,\\s*[12]\\)|substring\\(0,\\s*[12]\\))\\.toUpperCase\\(\\)(?!\\s*(?:\\+|\\}\\s*\\$\\{))",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A leading-character cut taken with a UTF-16 code-unit index and NOT continued (neither `+ rest` nor `}${rest}`) — i.e. a monogram, not a capitalisation. charAt(0)/slice(0,1)/slice(0,2) split any astral-plane codepoint, so an emoji-initial entity name yields a lone surrogate and renders U+FFFD. Cut with [...name][0] instead."
  },
  "baseline": { "files": 10, "matches": 10 },
  "floor": 4000
}
```

```json
{
  "id": "code-unit-monogram-positive-control",
  "goldenPath": "docs/concepts/golden-paths/entity-visual-identity.md",
  "title": "POSITIVE CONTROL — the capitalise-a-word idiom the violation rule must NOT match",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "\\.(?:charAt\\(0\\)|slice\\(0,\\s*[12]\\)|substring\\(0,\\s*[12]\\))\\.toUpperCase\\(\\)\\s*(?:\\+|\\}\\s*\\$\\{)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "Same anchors, opposite structure: a leading-character cut that IS continued with `+ rest` or `}${rest}` — Title Case, never a monogram. It shares every token with the violation and differs only in the continuation, so it is the near-miss that proves the discriminator is structural rather than lexical. Expected ~31 files / ~33 matches; carries no baseline by design."
  },
  "floor": 4000
}
```

### Severity

**`warn`-equivalent is not on the table and neither is arguing from volume.** In this
repo `npm run check` runs `eslint src/` with no `--max-warnings`, and the pre-commit hook
runs `--quiet`, which suppresses warnings before they can be counted — **a warn-level
rule enforces nothing at either gate at any count.** The census runner has no severity
dial: `npm run census:check` is fatal on drift, full stop. That is the correct level
here, on the strength of the 10/10 precision and the empty overlap with the control —
not on the strength of how many violations there are.

### The three fixes this gate is the ratchet for, in order

1. **Fix `personaInitials` to `[...words[0]!][0]!`** (D1). One line. Until this lands,
   every other fix routes more callers at a broken destination.
2. **Make `PersonaIcon.name` required** (D3). One `?` deleted, 63 call sites to update,
   63 generic robots become distinguishable initials. The measurement in §4 step 4 —
   100% vs 8.7% on the same component — is the whole argument.
3. **Reconcile the two icon sanitizers** (D2). Either `normalizeIconUrl` admits the
   CSP-allowlisted remote hosts, or `CONNECTOR_META` stops declaring them. Both are one
   edit; shipping neither means the picker and the render disagree on every single value.

The census rule ratchets #1 and, once `name` is required, the type carries #2 without a
gate at all. #3 needs no gate: it is a data/predicate mismatch inside one file, and a
five-line unit test asserting `normalizeIconUrl` accepts every `CONNECTOR_META.iconUrl`
would have caught it on the day it was written — which is the smallest possible gate and
the one this repo most obviously lacks, since **zero tests touch identity today.**

---

## Convergence — what the sibling repos say

Both siblings were measured independently (`../personas-web`, a Next.js marketing site
with a public docs audience; `../brainiac/console`, an internal Next.js console).

### Reinvented independently — treat as physics

| Clause | personas | personas-web | brainiac/console |
| --- | --- | --- | --- |
| **Positional identity** — a palette indexed by list position | `agentColor(agent, index)`, `workspaceStore:110` | — (uses lookup tables) | **4 implementations**: `TEAM_HUES[findIndex(...)]`, two `TEAM_BANDS[i % …]` in sibling files, plus a hand-copied hue array. Same team, three colours. |
| **Identity palette collides with the semantic palette** | 4/10 hashed swatches = status tokens; Statband shares one box with a health dot | 3 of 5 shipped persona colours **are** `STATE_COLORS.{success,warning,error}`; a rose card shows identity and its failure ring in the same hue | `TEAM_BANDS` and `IMPACT_HUE` both draw `gamma`/`beta` from one 5-hue ring **and render in the same view** |
| **Duplicated hash implementations** | 6 (3 of them FNV-1a) | 1, non-visual | **3 byte-identical FNV-1a**, one of whose docstrings admits it knows about the fork |
| **`charAt(0)` on a name that may start with an emoji** | 9 sites + the shared helper | 2 sites (`DashboardNavbar:77`, `settings/page:74`) — and its *build-time* `makeMonogram` handles the same input correctly, so two code paths disagree | absent — the console renders no initials at all |
| **A required-fallback field is the fix** | `ConnectorMeta.Icon` — 142/142 | `Connector.monogram: string` — **126/126**; the auditing agent independently called it "the pattern the other seven renderers should be held to" | `Glyph { Icon, say }` — both required, and it is the one module that gets identity right |
| **An entity mark with no accessible name** | 0 of 69 `<PersonaIcon>` sites; initials arm `aria-hidden` | both user avatars `alt=""`; 0 of 6 `role="img"` on an avatar | ≥3 colour-only team marks with no `role`/`aria-label` |

**Six clauses reinvented in at least one sibling with no shared document. The
required-fallback field is reinvented in BOTH**, in two different languages of the same
stack, by two different authors — and in `personas-web` the auditor arrived at the
prescription unprompted. That is the strongest evidence in this document, and it is why
§4 step 4 and §9's fix #2 are stated as types rather than as gates.

### Where convergence contradicts this brief — reported honestly

- **The brief's headline hypothesis is a house convention, not physics.** "Two hash
  functions over the same name is the defect shape" — `personas-web` has **zero**
  hash-to-colour derivations (its single hash is a localStorage key), and `brainiac`'s
  three hashes never touch a colour either. **No sibling derives identity colour from a
  hash.** Personas is the only one of the three that does (`memberColor`), and it is
  therefore local calibration. The clause that *did* converge is the adjacent one:
  **identity assigned by position** — reinvented four times in brainiac and once here.
  So §5-B (positional identity) is doctrine; §5-C (duplicate hashes) is a
  house-keeping note about this repo, and I have written it as one.

- **The a11y refinement did not hold.** The brief predicted a11y clauses converge in the
  sibling with a public docs audience, not the internal console — "convergence measures
  who audits." Measured, the opposite: `brainiac/console` — the *internal* one — carries
  the only **written a11y doctrine** of the three, at `row-icons.tsx:69-72` ("`title` on a
  span is the tooltip a mouse gets, `role="img"` + `aria-label` is the word a screen
  reader gets, and the glyph itself goes aria-hidden so the two never double up"), and
  applies it at 18 sites. `personas-web` has 100% `alt` coverage but 71% of those are
  `alt=""` and **zero** avatars are labelled — coverage without meaning. The heuristic
  "public audience ⇒ a11y" predicted the wrong repo. What actually predicted it was
  whether *one author wrote the reasoning down in the file*; that is a property of a
  person, not of an audience.

- **`empty-and-demo-states.md` needed no boundary correction, but the brief's framing of
  it did.** The overlap the brief anticipated (missing avatar ≈ empty state) does not
  exist in the code: no identity renderer imports `ScenarioEmptyState`, in any of the
  three repos. The boundary in §1 is prose stating the distinction, not a fix for a
  measured confusion. A cleared claim.

### Not reinvented anywhere — local to this repo, flagged as such

- The `builtin` / `custom` / `url` / `emoji` / `fallback` five-arm classifier. No sibling
  has more than two arms. It is a good design that exists here because `persona.icon` is a
  free-form column with five historical formats — a local constraint. Marked as house
  convention.
- Theme-aware sprite selection (`resolveAgentIconSprite(value, isDark)`). Neither sibling
  themes an entity mark at all. House convention.

---

## Appendix — the measurement harness

Every figure in §7 came from executing the real modules, not from reading them. The
harness was a throwaway vitest config pointed at the repo root with four scratch specs,
run with `--disable-console-intercept`; all five files were deleted after the run and the
tree left clean. The four measurements that could not have been obtained by reading:

1. **`personaInitials("🤖")` → `"\ud83e"`** — reading the source suggests the shared
   helper is the fix; running it shows the helper has the bug. (D1)
2. **`agentColor(a, 0..8)` → 8 distinct colours** — reading `PALETTE[index % …]` suggests
   "stable palette pick"; running it shows a stripe. (D6)
3. **`normalizeIconUrl` × `resolvePersonaIcon` over all 133 connector icons → 0 agreements**
   — both functions are individually correct and each file reads fine. Only running both
   over the same corpus shows their acceptance sets are complements. (D2)
4. **`color` at 69/69 vs `name` at 6/69** — a structural scan of every `<PersonaIcon/>`
   JSX element, not a grep for the component name. The 100%-vs-8.7% split on one
   component is the empirical core of §4 step 4.

Two claims were **disproven** during composition and are recorded rather than dropped:
`var(--color-primary)` is a real alias of `--primary` (`globals.css:448`), not a dangling
token as it first appeared; and the first collision measurement read the *high-contrast
light* `--status-*-raw` block and reported 0 collisions — the correction to the base block
found 6, and the mistake itself became D4(c), the finding that the semantic ramp moves
with the contrast setting while identity hexes never do.
