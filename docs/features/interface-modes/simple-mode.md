# Simple Mode

> Migrated from `docs/harness/simple-mode-roadmap.md` on 2026-05-10. All 4 roadmap phases (0–4) shipped 2026-04-11 → 2026-04. This is the shipping reference; the historical phase-by-phase plan is preserved as the "Implementation history" section.

Simple Mode is the reduced-complexity interface tier for non-technical users who want to create agents, connect services, and see results without exposure to developer-oriented features. It's a tier setting, not a separate UI — same components, with `{!isSimple && ...}` guards around advanced sections.

## How it's selected

- **Tier internal values:** `starter` (Simple) / `team` (Power) / `builder` (dev-only). UI labels in `TIER_LABELS` (`uiModes.ts`) map starter→Simple, team→Power.
- **Selector:** Settings → Appearance → Interface Mode (formerly in dev-only AccountSettings; Phase 0 moved it).
- **Cycle:** `TIER_CYCLE = [starter, team]` — no runtime path to builder; builder remains compile-time `devOnly`.
- **Default:** Power (`team`). Simple is opt-in.
- **Convention:** `useTier().isStarter` is read everywhere, often aliased as `isSimple` at the top of a file.

## Guiding principles

1. **Progressive disclosure, not separate UIs.** Same components with `{!isSimple && ...}` guards around advanced sections. No parallel component trees to maintain.
2. **Hide complexity, not capability.** A Simple-mode user can still do everything — advanced options live behind expandable "Advanced" drawers or are accessible by switching to Power mode.
3. **Four screens only.** Simple sidebar: Home, Agents, Connections, Settings. Everything else (Overview, Workflows, Events, Templates, Plugins) is Power-only.
4. **One-click-to-value.** Every screen gets the user to their goal in the fewest possible steps. "Create agent" → "Run agent" → "See result" should be 3 clicks.

## What's hidden in Simple mode

### Sidebar (L1)

`SIMPLE_SECTIONS` in `sidebarData.ts` narrows to: home, agents, connections, settings. The L1 entries for overview, workflows, events, templates, plugins gate to Power-only.

### Agents

| Element | Location | Behavior in Simple |
| --- | --- | --- |
| Editor tab bar (Matrix, Lab, Activity, Health) | `EditorTabBar.tsx` | Show only Prompt, Chat, Connectors |
| Prompt versioning / diff view | `PersonaPromptEditor.tsx` | Hide version history, single edit field |
| Use case conditions / script logic | `UseCaseBuilder.tsx` | Hide condition builder; simple cards |
| Tool configuration panel | `sub_tools/` | Hide entirely; tools auto-assigned from template |
| Advanced settings tab | `PersonaSettingsTab.tsx` | Hide model routing, concurrency, budget limits |
| Dry run panel | `DryRunPanel.tsx` | Hide; replace with simple "Test" button |
| Trigger configuration (advanced) | `TriggerPopover.tsx` | Show only Manual; hide cron, webhook, file watcher, clipboard |

What's kept: name + description, system prompt (single text area), role selection, connector assignment, "Run" button → execution mini-player, Chat tab, agent list with basic status.

### Connections (Vault)

| Element | Location | Behavior in Simple |
| --- | --- | --- |
| Credential Playground / API Explorer | `shared/playground/` | Hidden entirely |
| Vector / Knowledge Base management | `shared/vector/` | Hidden |
| Database connections | `sub_databases/` | Power-only via sidebar |
| Dependency graph | `sub_dependencies/` | Power-only via sidebar |
| Credential catalog | `sub_catalog/` | Power-only via sidebar |
| Health scoring / rotation settings | `HealthStatusBar.tsx` | Hidden |
| Bulk actions (rotate all, test all) | `CredentialManagerHeader.tsx` | Hidden — keep only "Add" |

What's kept: credential list (simplified columns), Add new credential, per-credential status (connected / error), Delete, one-click "Test" per credential.

### Execution

| Element | Location | Behavior in Simple |
| --- | --- | --- |
| Terminal output (raw ANSI logs) | `ExecutionMiniPlayer.tsx` | Replace with progress bar + "Running…" → "Done" |
| Token count / cost display | Mini-player | Hidden |
| Circuit breaker indicator | Mini-player | Hidden |
| Streaming NDJSON lines | Mini-player | Show only final output, not streaming tokens |
| Pipeline dots | `PipelineDots.tsx` | Simplify to: Preparing → Running → Done |

Simple-mode execution UX:

```
┌─────────────────────────────────────────┐
│  Running: My Sales Agent               │
│  ████████████░░░░░░░░  65%             │
│  Status: Generating response...         │
│                                 1m 23s  │
└─────────────────────────────────────────┘

             ↓ completes ↓

┌─────────────────────────────────────────┐
│  ✓ My Sales Agent — Complete            │
│  [Result text formatted as readable     │
│   paragraphs, not raw terminal output]  │
│  Duration: 2m 45s                       │
│  [Run Again]  [Copy Result]             │
└─────────────────────────────────────────┘
```

### Home & onboarding

| Element | Location | Behavior in Simple |
| --- | --- | --- |
| Navigation grid cards | `NavigationGrid.tsx` | Filtered to 4 cards |
| Welcome message | `HomeWelcome.tsx` | Simple-specific copy |
| Learning resources | `HomeLearning.tsx` | Filtered to beginner-friendly content |
| Setup cards | `SetupCards.tsx` | "Add agent" + "Add connection" |
| Template picker (onboarding) | `TemplatePickerStep.tsx` | Beginner templates only |

## Files with existing `isSimple` checks (reference)

| File | What it gates |
| --- | --- |
| `NavigationGrid.tsx` | Home page card visibility |
| `HealthCheckPanel.tsx` | Hides dry-run capabilities list |
| `ExecutionMiniPlayer.tsx` | Hides token count, streaming indicators |
| `CredentialManagerHeader.tsx` | Hides search/filter bar |
| `CredentialList.tsx` | Passes `isSimple` to column renderer |
| `CredentialListColumns.tsx` | Simplified columns (fewer fields) |
| `CredentialCardHeader.tsx` | Hides some action buttons |
| `HealthStatusBar.tsx` | Hidden entirely |
| `VaultStatusBadge.tsx` | Simplified badge |
| `DashboardHeaderBadges.tsx` | Simplified badge |
| `TemplateDetailModal.tsx` | Hides adoption count, references |
| `ExploreView.tsx` | Hides technical details |

## Implementation history

The roadmap shipped in 4 phases:

| Phase | Scope | Files |
| --- | --- | --- |
| 0 — Infrastructure | Tier rename (starter→Simple, team→Power), move Interface Mode selector to Appearance, narrow `SIMPLE_SECTIONS`, gate sidebar L1 | `uiModes.ts`, `AccountSettings.tsx`, `AppearanceSettings.tsx`, `sidebarData.ts`, `platform.ts` |
| 1 — Agents | Hide editor tabs (Matrix/Lab/Activity/Health), prompt versioning, condition builder, tool config, advanced settings, dry-run, advanced triggers | ~8-10 files in `agents/sub_editor/` |
| 2 — Connections | Hide playground, vector KB, bulk actions, health scoring | ~4-5 files in `vault/` |
| 3 — Execution | Replace ANSI terminal output with progress bar; simplify pipeline dots; hide circuit breaker | ~2-3 files in execution mini-player |
| 4 — Home & onboarding | Filter nav cards (4), Simple welcome copy, beginner learning, beginner templates | ~3-4 files in `home/`, `onboarding/` |

Total ~18-22 files across all phases, all using the same `useTier().isStarter` pattern.

## Related docs

- [home.md](../home.md) — Home and Simple-Mode interactions; ambient mode (full-screen variant)
- [onboarding.md](../onboarding.md) — Onboarding flow; not Simple-mode-gated but adapts copy
- [overview/README.md](../overview/README.md) — Power-only dashboard; hidden in Simple
- [../recipes/README.md](../recipes/README.md) — Power-only feature surface
