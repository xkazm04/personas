# Sidebar navigation — levels, groups, and the registry

The sidebar is the app's primary navigation surface and has two levels:

- **Level 1** — the icon rail (`SidebarLevel1.tsx`). One button per
  rail-reachable section, derived from `NAV_SECTIONS` in
  `src/lib/navigation/registry.ts`.
- **Level 2** — the 240px panel (`SidebarLevel2.tsx`). Every section's list
  renders through one shared primitive, `SidebarGroupNav.tsx`.

There is **no Level 3**. The plugins push-pane (`SidebarLevel3.tsx`) was retired
on 2026-07-27 — plugin sub-tabs are groups inside Level 2 now.

## The Level-2 grouped layout

`SidebarGroupNav` encodes the pattern the Projects section established:

```
[lead row]                     ← optional; full-size, no divider above
─────────────────────────────  ← mt-3 pt-3 border-t border-primary/10
GROUP LABEL                    ← caption, uppercase, muted (or a navigable row)
│ ○ child                      ← nested behind border-l, typo-body
│ ○ child
─────────────────────────────
GROUP LABEL
│ ○ child
```

Two row sizes, exported as `leadRowClass()` / `childRowClass()` so bespoke
bodies match exactly: full-size rows (`typo-heading`, `w-4` icon,
`rounded-lg`) for the lead entry and navigable group headers; nested rows
(`typo-body`, `w-3.5` icon, `rounded-md`) for everything inside a rail.

A group can be:

- **label-only** — a caption heading; the items below are the destinations.
- **navigable** (`groupItem`) — the heading is itself a destination and the
  nested rows are its sub-views (Goals / KPIs in Projects; each plugin).
- **collapsible** — adds a chevron; used by the dynamic Agents sections.
- **custom-bodied** (`render`) — arbitrary JSX inside the rail, for rows this
  primitive shouldn't model (draft builds, persona rows).

Group membership for the static sections is declared by id in
`sidebarData.ts` (`overviewGroups`, `eventGroups`, `settingsGroups`, …) and
resolved by `groupItems()`. Items are sorted alphabetically **within** a group.
An item that no group claims is appended to the last group rather than
disappearing — a visible failure, not a silent one.

## Section groups

| Section | Groups |
| --- | --- |
| Home | Home (Welcome · Cockpit · Learning · What's New · System Check) |
| Overview | **Monitoring** (Activity · Events · Health · Leaderboard · Mission Control · Reliability) · **Operations** (Approvals · Certification · Director · Incidents · Messages) · **Memory** (Knowledge) |
| Projects | Teams · Goals · KPIs · Development |
| Agents | dynamic — Draft builds · active project · Favorites · Recent · Progress · Cloud (dev) |
| Events | **Build** (Studio · Local Relay · Marketplace · Test) · **Maintain** (Cloud Events · Dead Letter Queue · Live Stream · Speed Limits) |
| Connections | **Credentials** · **Templates** |
| Plugins | one group per plugin; the active plugin's rail holds its sub-tabs |
| Settings | **General** (Account · Appearance · Data · Radio · Notifications) · **Connect** (API Keys) · **LLM** (Engine · Custom Models · Limits) · **Advanced** (dev-only) |

Group headings are `t.sidebar.group_*` keys.

## Reachability — where a section can be reached from

`NAV_SECTIONS` is the single source of truth. Each entry declares a
`reachability`:

| Value | Meaning | Example |
| --- | --- | --- |
| `sidebar` | rendered in the Level-1 rail, mounted by the content router | Overview |
| `nested` | **not** in the rail; reached from another section's Level-2 nav. Still a full router destination. Declares a `parent`. | Templates → Connections |
| `overlay-only` | not in the rail; summoned as a title-bar overlay | Schedules |
| `hidden` | has a type member / persisted value but no live surface | — |

`railSection(id)` resolves a section to the rail entry that should read as
active — itself for rail sections, `parent` for nested ones. Both the rail
highlight (`SidebarLevel1`) and the Level-2 panel title (`Sidebar`) go through
it, so a nested section never leaves the rail looking unselected.

`registry.test.ts` enforces all of this: every `SidebarSection` is registered
exactly once, every non-overlay section routes, every nested section names a
parent that is itself in the rail, and the rail, the command palette, and the
analytics catalog are all derived — none can silently omit or invent a section.

## Adding a section or a tab

- **New Level-1 section** — add an entry to `NAV_SECTIONS` (the rail, router,
  palette, and analytics all derive from it) and a route in `sectionRouter`.
- **New Level-2 tab** — add it to its section's item array in `sidebarData.ts`
  **and** to the matching group's `itemIds`. Skipping the second step still
  renders (it lands in the last group), which is the signal to fix it.
- **New group heading** — add a `sidebar.group_*` key to `en.json` and run the
  translation pipeline (see CLAUDE.md → i18n).
