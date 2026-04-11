# Simple Mode Roadmap

> Architecture and implementation plan for the "Simple" interface mode — a reduced-complexity
> UI for non-technical office users who want to create agents, connect services, and see results
> without exposure to developer-oriented features.

**Created:** 2026-04-11
**Status:** Phase 0 (infrastructure) complete. Phases 1-4 are the roadmap.

---

## Guiding Principles

1. **Progressive disclosure, not separate UIs.** Same components with `{!isSimple && ...}` guards around advanced sections. No parallel component trees to maintain.
2. **Hide complexity, not capability.** A Simple-mode user can still do everything — advanced options live behind expandable "Advanced" drawers or are accessible by switching to Power mode.
3. **Four screens only.** Simple mode sidebar: Home, Agents, Connections, Settings. Everything else (Overview, Workflows, Events, Templates, Plugins) is Power-only.
4. **One-click-to-value.** Every screen should get the user to their goal in the fewest possible steps. "Create agent" → "Run agent" → "See result" should be 3 clicks.

---

## Phase 0: Infrastructure (DONE)

What was shipped:

- [x] Remove `builder` tier from runtime cycle (now compile-time `devOnly` only)
- [x] Rename tiers: starter → "Simple", team → "Power" in UI labels
- [x] Move Interface Mode selector from devOnly AccountSettings to Appearance settings
- [x] Gate sidebar L1: overview, workflows, events, templates, plugins → Power only
- [x] Narrow `SIMPLE_SECTIONS`: home, agents, connections, settings

Files changed: `uiModes.ts`, `AccountSettings.tsx`, `AppearanceSettings.tsx`, `sidebarData.ts`, `platform.ts`

---

## Phase 1: Agents — Simplified Creation & Viewing

**Priority: HIGH** — The agent editor is the app's core screen and currently has zero Simple mode guards. A non-technical user opening the agent editor sees: prompt versioning tabs, tool configuration panels, use case builders with boolean logic, dry-run diagnostics, lab experiments, matrix views, activity traces, and circuit breaker status.

### What to hide in Simple mode

| Element | Location | Action |
|---------|----------|--------|
| Editor tab bar (Matrix, Lab, Activity, Health) | `EditorTabBar.tsx` | Show only: Prompt, Chat, Connectors |
| Prompt versioning / diff view | `PersonaPromptEditor.tsx` | Hide version history, show single edit field |
| Use case conditions / script logic | `UseCaseBuilder.tsx` | Hide condition builder, show simple use case cards |
| Tool configuration panel | `sub_tools/` | Hide entirely in Simple — tools auto-assigned from template |
| Advanced settings tab | `PersonaSettingsTab.tsx` | Hide model routing, concurrency, budget limits |
| Dry run panel | `DryRunPanel.tsx` | Hide — replace with simple "Test" button |
| Health check panel | `HealthCheckPanel.tsx` | Already has `isSimple` guard — verify it hides enough |
| Trigger configuration (advanced) | `TriggerPopover.tsx` | Show only Manual trigger; hide cron, webhook, file watcher, clipboard |

### What to keep

- Agent name + description
- System prompt (single text area, no versioning)
- Role selection (from predefined list)
- Connector assignment (simple picker)
- "Run" button → execution mini-player
- Chat tab (conversational interaction)
- Agent list with basic status

### Estimated scope

~8-10 files, primarily adding `isSimple` guards around tab visibility and section rendering. No new components needed — just hiding existing ones.

---

## Phase 2: Connections — Simplified Credential Management

**Priority: MEDIUM** — The vault already has 6 files with `useTier()` checks, but the Credential Playground (API Explorer, MCP Tools, Recipes) is fully exposed in Simple mode.

### What to hide in Simple mode

| Element | Location | Action |
|---------|----------|--------|
| Credential Playground / API Explorer | `shared/playground/` | Hide entire playground modal in Simple |
| Vector/Knowledge Base management | `shared/vector/` | Hide — advanced feature |
| Database connections | `sub_databases/` | Already Power-only via sidebar |
| Dependency graph | `sub_dependencies/` | Already Power-only via sidebar |
| Credential catalog | `sub_catalog/` | Already Power-only via sidebar |
| Health scoring / rotation settings | `HealthStatusBar.tsx` | Already hidden (`isSimple` check) |
| Bulk actions (rotate all, test all) | `CredentialManagerHeader.tsx` | Hide in Simple — keep only "Add" |

### What to keep

- Credential list (simplified columns — already done)
- Add new credential (name → service type → paste API key → save)
- Per-credential status (connected / error)
- Delete credential
- Simple one-click "Test" per credential

### Estimated scope

~4-5 files. Most gating already exists — primary gap is hiding the Playground modal trigger and simplifying the credential card actions.

---

## Phase 3: Execution — Simplified Output

**Priority: MEDIUM** — The execution mini-player already has `isSimple` checks, but the output is still raw terminal text with ANSI color codes.

### What to change in Simple mode

| Element | Location | Action |
|---------|----------|--------|
| Terminal output (raw ANSI logs) | `ExecutionMiniPlayer.tsx` | Replace with progress bar + "Running..." → "Done" |
| Token count / cost display | Already hidden | Verify |
| Circuit breaker indicator | Already hidden | Verify |
| Streaming NDJSON lines | Mini-player | Show only final output, not streaming tokens |
| Pipeline dots | `PipelineDots.tsx` | Simplify to: Preparing → Running → Done |

### Simple mode execution UX

```
┌─────────────────────────────────────────┐
│  Running: My Sales Agent               │
│  ████████████░░░░░░░░  65%             │
│                                         │
│  Status: Generating response...         │
│                                 1m 23s  │
└─────────────────────────────────────────┘

             ↓ completes ↓

┌─────────────────────────────────────────┐
│  ✓ My Sales Agent — Complete            │
│                                         │
│  [Result text shown here, formatted     │
│   as readable paragraphs, not raw       │
│   terminal output]                      │
│                                         │
│  Duration: 2m 45s                       │
│  [Run Again]  [Copy Result]             │
└─────────────────────────────────────────┘
```

### Estimated scope

~2-3 files. The mini-player already branches on `isSimple` — needs a more complete alternative render path rather than just hiding individual elements.

---

## Phase 4: Home & Onboarding — Simple Mode Aware

**Priority: LOW** — Home page already filters nav cards. Onboarding is accessible to all tiers. Small adjustments only.

### What to change

| Element | Location | Action |
|---------|----------|--------|
| Navigation grid cards | `NavigationGrid.tsx` | Already filtered — verify 4 cards show |
| Welcome message | `HomeWelcome.tsx` | Add Simple-specific welcome copy |
| Learning resources | `HomeLearning.tsx` | Filter to beginner-friendly content |
| Setup cards | `SetupCards.tsx` | Simplify to: "Add agent" + "Add connection" |
| Template picker (onboarding) | `TemplatePickerStep.tsx` | Filter to beginner templates only |

### Estimated scope

~3-4 files. Mostly copy changes and card filtering.

---

## Implementation Order

```
Phase 0 (DONE) ─→ Phase 1 (Agents) ─→ Phase 2 (Connections) ─→ Phase 3 (Execution) ─→ Phase 4 (Home)
                   ↑ highest impact     ↑ partial coverage      ↑ UX polish            ↑ final polish
                   ~8-10 files          ~4-5 files              ~2-3 files             ~3-4 files
```

Total estimated: ~18-22 files across 4 phases, all using the same `useTier().isStarter` pattern.

---

## Files with existing `isSimple` checks (reference)

These files already branch on tier and need verification/extension:

| File | What it gates |
|------|---------------|
| `NavigationGrid.tsx` | Home page card visibility |
| `HealthCheckPanel.tsx` | Hides dry-run capabilities list |
| `ExecutionMiniPlayer.tsx` | Hides token count, streaming indicators |
| `CredentialManagerHeader.tsx` | Hides search/filter bar |
| `CredentialList.tsx` | Passes `isSimple` to column renderer |
| `CredentialListColumns.tsx` | Simplified columns (fewer fields) |
| `CredentialCardHeader.tsx` | Hides some action buttons |
| `HealthStatusBar.tsx` | Hidden entirely in Simple |
| `VaultStatusBadge.tsx` | Simplified badge display |
| `DashboardHeaderBadges.tsx` | Simplified badge display |
| `TemplateDetailModal.tsx` | Hides adoption count, references |
| `ExploreView.tsx` | Hides technical details |

---

## Technical Notes

- Internal tier values stay `starter` / `team` / `builder` — only UI labels changed
- `TIER_LABELS` in `uiModes.ts` maps internal values to display names
- Builder tier still exists for compile-time `devOnly` gating in dev builds
- `TIER_CYCLE` now only contains `[starter, team]` — no runtime path to builder
- Default tier remains `team` (Power mode) — Simple mode is opt-in
- All `isSimple` checks use `useTier().isStarter` (aliased as `isSimple` by convention)
