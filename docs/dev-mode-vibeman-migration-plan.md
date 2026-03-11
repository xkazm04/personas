# Dev Mode -- Vibeman Migration Reference

Retroactive documentation of features migrated from Vibeman into Personas Desktop's Dev Mode. This serves as a baseline for future feature enrichment -- tracking what was ported, what was intentionally omitted, and where to find each piece.

---

## Overview

Dev Mode extends the `ViewMode` system from `'full' | 'simple'` to `'simple' | 'full' | 'dev'`. It inherits all Full mode features and adds five modules whose **concepts** originate from Vibeman but whose code is entirely new, built on the Personas desktop architecture (Tauri/Rust backend, Zustand store, ContentBox layout).

### Module Origin Map

| Personas Module | Vibeman Source | What Carried Over | What Was Redesigned |
|----------------|----------------|-------------------|---------------------|
| **Project Manager** | `Goals/GoalsLayout` | Project-scoped org, goal lifecycle with signals, progress tracking | Flat goals (no sub-goals), Tauri directory picker, SQLite storage |
| **Context Map** | `Context/` | Business-feature grouping, color-coded groups, codebase scanning concept | No markdown doc generation, no group health scans, rusqlite backend |
| **Idea Scanner** | `Ideas/` | 20 specialized agents across 4 categories, structured idea output | Frontend-only agent registry, no LLM execution wired yet |
| **Idea Triage** | `tinder/` | Swipe-to-evaluate, effort/impact/risk badges, category filtering | Framer Motion physics (not react-spring), keyboard shortcuts (A/Z/?) |
| **Task Runner** | `TaskRunner/` | Batch queue concept, concurrent execution, progress phases | Local SQLite tasks, no external CI integration |

### Data Flow (Conceptual)

```
[Project] -> [Context Map] -> [Idea Scanner] -> [Idea Triage] -> [Task Runner]
   |              |                  |                 |               |
   |         scans codebase     uses contexts     accept/reject    executes
   |         into features      as scan scope     with rules      in batches
   |              |                                    |
   +-- goals <---+-- lifecycle signals <--------------+-- task completion signals
```

---

## What Was Intentionally NOT Migrated

| Vibeman Feature | Reason |
|----------------|--------|
| Next.js API routes | All backend is Tauri/Rust commands |
| React Query | Zustand store pattern (matches rest of app) |
| Supabase/GitHub sync | Local SQLite only (desktop-first) |
| Prisma ORM | Raw SQLite via rusqlite (matches rest of app) |
| Sub-goal decomposition | Flat goals sufficient; complexity not justified |
| Standup/screen-catalog | Out of scope for Personas |
| `lifecycle_status` auto-tracking modes | Simplified to signal-based only |
| Context file generation (markdown docs) | Deferred to future version |
| Group health scans (refactor/beautify) | Deferred to future version |
| Scan agents as Persona templates | Ephemeral single-purpose agents shouldn't clutter agent list |

---

## File Inventory

### Infrastructure (Dev Mode Shell)

| File | Purpose | Vibeman Equivalent |
|------|---------|-------------------|
| `src/stores/slices/system/viewModeSlice.ts` | `ViewMode` type extended to include `'dev'`, 3-way toggle cycle | N/A (new concept) |
| `src/hooks/utility/interaction/useDevMode.ts` | `useDevMode()` hook -- `viewMode === 'dev'` | N/A |
| `src/hooks/utility/interaction/useSimpleMode.ts` | Unchanged, `viewMode === 'simple'` | N/A |
| `src/lib/types/types.ts` | `SidebarSection` union includes `'dev-tools'`, `DevToolsTab` type | N/A |
| `src/lib/utils/platform/platform.ts` | `DEV_MODE_SECTIONS` set for filtering | N/A |
| `src/features/shared/components/layout/sidebar/sidebarData.ts` | `devModeOnly` flag on `SectionDef`, `devToolsItems` sub-nav (5 tabs) | N/A |
| `src/features/shared/components/layout/sidebar/SidebarLevel1.tsx` | Filter chain: `devModeOnly` sections hidden unless dev mode, 3-state toggle button (violet/amber/default) | N/A |
| `src/features/shared/components/layout/sidebar/SidebarLevel2.tsx` | `dev-tools` case renders `devToolsItems` + active project context bar | N/A |
| `src/features/shared/components/layout/sidebar/Sidebar.tsx` | Redirect away from `DEV_MODE_SECTIONS` when not in dev mode | N/A |
| `src/features/settings/sub_appearance/AppearanceSettings.tsx` | 3-column grid: Simple (violet) / Full (primary) / Dev (amber) | N/A |
| `src/features/personas/PersonasPage.tsx` | Lazy import + routing for `DevToolsPage` | N/A |
| `src/features/dev-tools/DevToolsPage.tsx` | Tab router shell with lazy-loaded sub-pages, AnimatePresence transitions | N/A |
| `src/stores/slices/system/uiSlice.ts` | `devToolsTab` state + `setDevToolsTab` action | N/A |

### Rust Backend

| File | Purpose | Tables/Commands |
|------|---------|-----------------|
| `src-tauri/src/db/migrations.rs` | 10 new `CREATE TABLE IF NOT EXISTS` statements | `dev_projects`, `dev_goals`, `dev_goal_signals`, `dev_context_groups`, `dev_contexts`, `dev_context_group_relationships`, `dev_ideas`, `dev_scans`, `dev_tasks`, `dev_triage_rules` |
| `src-tauri/src/db/models/dev_tools.rs` | 12 model structs with `#[derive(TS, Serialize, Deserialize)]` | `DevProject`, `DirectoryScanResult`, `DevGoal`, `DevGoalSignal`, `DevContextGroup`, `DevContext`, `DevContextGroupRelationship`, `DevIdea`, `DevScan`, `DevTask`, `ScanAgentMeta`, `TriageRule` |
| `src-tauri/src/db/repos/dev_tools.rs` | Full CRUD repos for all 10 tables (~1,466 lines) | Uses `rusqlite::params!`, `uuid::Uuid::new_v4()`, `push_field!` macro for dynamic updates |
| `src-tauri/src/commands/infrastructure/dev_tools.rs` | ~46 `#[tauri::command]` functions (~703 lines) | Registered in `lib.rs` invoke_handler |
| `src-tauri/src/db/models/mod.rs` | Added `mod dev_tools` + `pub use dev_tools::*` | |
| `src-tauri/src/db/repos/mod.rs` | Added `pub mod dev_tools` | |
| `src-tauri/src/commands/infrastructure/mod.rs` | Added `pub mod dev_tools` | |

### Frontend API + Store

| File | Purpose |
|------|---------|
| `src/api/devTools/devTools.ts` | ~46 invoke wrappers with `safeInvoke` fallback (returns empty arrays when backend commands not yet compiled) |
| `src/api/index.ts` | Registered dev tools API |
| `src/stores/slices/system/devToolsSlice.ts` | Comprehensive Zustand slice (~824 lines): projects, goals, context map, scanner, ideas, triage, rules, tasks |
| `src/stores/storeTypes.ts` | `DevToolsSlice` added to `PersonaStore` intersection |
| `src/stores/personaStore.ts` | `createDevToolsSlice` spread into store |

### TypeScript Bindings

All in `src/lib/bindings/`, generated from Rust models via ts-rs:

`DevProject.ts`, `DirectoryScanResult.ts`, `DevGoal.ts`, `DevGoalSignal.ts`, `DevContextGroup.ts`, `DevContext.ts`, `DevContextGroupRelationship.ts`, `DevIdea.ts`, `DevScan.ts`, `DevTask.ts`, `ScanAgentMeta.ts`, `TriageRule.ts`

### Module UI Pages

| File | Lines | Vibeman Origin | Key UI Elements |
|------|-------|---------------|-----------------|
| `src/features/dev-tools/sub_projects/ProjectManagerPage.tsx` | ~497 | `Goals/GoalsLayout` | Project list, active project header, goal board with status badges, progress bars, signal timeline, inline creation form, project modal with directory path |
| `src/features/dev-tools/sub_context/ContextMapPage.tsx` | ~467 | `Context/` | Expandable group sections with color dots, codebase scan overlay with progress animation, context detail side panel with file paths/keywords, 8-color palette picker |
| `src/features/dev-tools/sub_scanner/IdeaScannerPage.tsx` | ~443 | `Ideas/` | 4-column agent selection grid grouped by category, scan progress with animated bar, results grid with effort/impact/risk badges, category filter tabs |
| `src/features/dev-tools/sub_triage/IdeaTriagePage.tsx` | ~430 | `tinder/` | Framer Motion drag-to-swipe card stack (3 visible), drag threshold 150px, red/green border transform, accept/reject/delete buttons, keyboard shortcuts (Arrow keys, A/Z), `?` shortcut overlay |
| `src/features/dev-tools/sub_runner/TaskRunnerPage.tsx` | ~430 | `TaskRunner/` | Task queue with status badges, batch controls with concurrent selector, task output panel, phase-colored progress bars (Analyzing/Planning/Implementing/Validating/Complete) |

### Constants

| File | Content | Vibeman Origin |
|------|---------|---------------|
| `src/features/dev-tools/constants/scanAgents.ts` | 20 scan agents across 4 categories (Technical, UX, Business, Mastermind) with `ScanAgentDef` interface | `AGENT_REGISTRY` in Vibeman's `Ideas/agents/` |
| `src/features/dev-tools/constants/ideaCategories.ts` | 6 idea categories (functionality, performance, maintenance, ui, code_quality, user_benefit) with Lucide icons and colors | Category constants from Vibeman's idea generation |

### Integration (Home, Navigation, i18n)

| File | Change |
|------|--------|
| `src/features/home/components/HomeWelcome.tsx` | Added dev-tools NavCard with amber gradient (visible only in dev mode) |
| `src/features/home/components/NavigationGrid.tsx` | Filters out `DEV_MODE_SECTIONS` when not in dev mode |
| `src/features/home/i18n/en.ts` | Added `dev-tools` translation entry |
| `src/features/home/i18n/{ar,bn,cs,de,es,fr,hi,id,ja,ko,ru,vi,zh}.ts` | Translated dev-tools label and description for all 13 languages |

---

## Scan Agent Registry

The 20 agents are a conceptual port from Vibeman's `AGENT_REGISTRY`. Only the metadata (key, label, emoji, category) was migrated -- the actual LLM prompt templates were not ported because the execution engine integration (connecting scan agents to the Personas execution pipeline) is deferred.

### Agent Categories

| Category | Agents | Color |
|----------|--------|-------|
| **Technical** | Architecture Critic, Performance Profiler, Security Auditor, Testing Strategist, Dependency Auditor | Blue |
| **UX** | UX Evaluator, Accessibility Champion, Mobile Inspector, Dark Mode Detective, i18n Scout | Pink |
| **Business** | Feature Gap Analyst, Monetization Advisor, Analytics Strategist, Growth Hacker, Compliance Checker | Amber |
| **Mastermind** | Code Philosopher, Refactoring Surgeon, Documentation Scholar, DevOps Optimizer, Tech Debt Collector | Violet |

---

## Database Schema

10 tables with the following relationships:

```
dev_projects (1)
  ├── dev_goals (N) ── dev_goal_signals (N)
  ├── dev_context_groups (N) ── dev_contexts (N)
  ├── dev_context_group_relationships (N)
  ├── dev_ideas (N) ── linked to dev_contexts
  ├── dev_scans (N)
  ├── dev_tasks (N) ── linked to dev_ideas, dev_goals
  └── dev_triage_rules (N)
```

Key design choices:
- All IDs are `TEXT PRIMARY KEY` (UUIDs generated in Rust)
- JSON fields stored as `TEXT` (file_paths, tech_stack, conditions, etc.)
- `ON DELETE CASCADE` from projects to all children
- `ON DELETE SET NULL` for optional cross-references (context_id on goals/ideas, source_idea_id on tasks)
- Timestamps as `TEXT` (RFC 3339 format)

---

## Tauri Commands (46 total)

### Projects (7)
`dev_tools_list_projects`, `dev_tools_get_project`, `dev_tools_create_project`, `dev_tools_update_project`, `dev_tools_delete_project`, `dev_tools_scan_directory`, `dev_tools_get_active_project`, `dev_tools_set_active_project`

### Goals (7)
`dev_tools_list_goals`, `dev_tools_get_goal`, `dev_tools_create_goal`, `dev_tools_update_goal`, `dev_tools_delete_goal`, `dev_tools_reorder_goals`, `dev_tools_record_goal_signal`, `dev_tools_list_goal_signals`

### Context Groups (5)
`dev_tools_list_context_groups`, `dev_tools_create_context_group`, `dev_tools_update_context_group`, `dev_tools_delete_context_group`, `dev_tools_reorder_context_groups`

### Contexts (7)
`dev_tools_list_contexts`, `dev_tools_get_context`, `dev_tools_create_context`, `dev_tools_update_context`, `dev_tools_delete_context`, `dev_tools_move_context`, `dev_tools_scan_codebase`, `dev_tools_generate_context_description`

### Context Group Relationships (3)
`dev_tools_list_context_group_relationships`, `dev_tools_create_context_group_relationship`, `dev_tools_delete_context_group_relationship`

### Ideas (5)
`dev_tools_list_ideas`, `dev_tools_get_idea`, `dev_tools_update_idea`, `dev_tools_delete_idea`, `dev_tools_bulk_delete_ideas`

### Scans (4)
`dev_tools_list_scan_agents`, `dev_tools_run_scan`, `dev_tools_get_scan`, `dev_tools_list_scans`

### Triage (4)
`dev_tools_triage_ideas`, `dev_tools_accept_idea`, `dev_tools_reject_idea`, `dev_tools_delete_triage_idea`

### Triage Rules (5)
`dev_tools_list_triage_rules`, `dev_tools_create_triage_rule`, `dev_tools_update_triage_rule`, `dev_tools_delete_triage_rule`, `dev_tools_run_triage_rules`

### Tasks (7)
`dev_tools_list_tasks`, `dev_tools_create_task`, `dev_tools_batch_create_tasks`, `dev_tools_start_task`, `dev_tools_cancel_task`, `dev_tools_start_batch`, `dev_tools_get_batch_status`

---

## Frontend Resilience

The API layer (`src/api/devTools/devTools.ts`) uses a `safeInvoke` wrapper that catches "command not found" errors and returns sensible fallbacks (empty arrays, null). This allows the frontend to operate gracefully even when the Rust backend hasn't been recompiled with the new commands.

```typescript
async function safeInvoke<T>(fallback: T, ...args): Promise<T> {
  try { return await invoke<T>(...args); }
  catch (err) { if (isCommandNotFound(err)) return fallback; throw err; }
}
```

All list/read operations use `safeInvoke` with empty-array or null fallbacks. Write operations (create, update, delete) use direct `invoke` and propagate errors normally.

---

## Future Enrichment Opportunities

These items were identified during migration but intentionally deferred:

### From Vibeman (Not Yet Ported)

| Feature | Vibeman Location | Priority | Notes |
|---------|-----------------|----------|-------|
| LLM scan execution | `Ideas/agents/*.ts` prompt builders | High | Wire scan agents to Personas execution engine via Codebase Connector |
| Codebase Connector | N/A (new architecture) | High | `codebase_list_files`, `codebase_read_file`, `codebase_grep`, `codebase_scan`, `codebase_tree` -- native Rust tools |
| Auto-provisioning | N/A | Medium | Creating a dev project auto-creates a codebase credential in the Vault |
| Context file generation | `Context/generateContextFiles` | Medium | Export context as markdown documentation |
| Group health scans | `Context/healthScans` | Medium | Refactor/beautify analysis per context group |
| Triage rules engine | `tinder/rules` | Medium | Backend `dev_tools_run_triage_rules` exists but UI rule builder not implemented |
| Rejection reason picker | `tinder/RejectionReasonPicker` | Low | Modal for categorized rejection reasons |
| Keyset cursor pagination | `tinder/pagination` | Low | Backend supports it, frontend uses simple array |
| Context relationship graph | `Context/RelationshipGraph` | Low | Mini SVG visualization of group dependencies |

### Architecture Improvements

| Item | Description |
|------|-------------|
| Proper store wiring | Pages currently use `(store as any).method` casting; should use typed `usePersonaStore(s => s.method)` selectors |
| Component extraction | Single-file pages (~450 lines each) should extract reusable sub-components |
| Tauri event streaming | Scan progress should use Tauri events instead of simulated progress bars |
| Cross-module signals | Goal progress updates from task completion (store wiring exists, backend needs testing) |

### Codebase Connector (Recommended Next Phase)

The second-pass analysis recommended a hybrid approach for LLM-powered scanning:

1. **Codebase Connector** -- new `ConnectorDefinition` (`builtin-codebase`) with 5 native Rust tools for filesystem access
2. **Scan orchestration stays standalone** -- batch scanning of multiple agents in parallel needs dedicated orchestration
3. **Post-execution parsing** -- extract structured idea JSON from execution output into `dev_ideas` table
4. **Auto-provision** -- creating a dev project auto-creates a codebase credential

This enables any Persona (not just dev-mode scan agents) to access local codebases, unlocking use cases like code review agents, documentation agents, and implementation agents.
