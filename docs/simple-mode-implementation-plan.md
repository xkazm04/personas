# Simple Mode Implementation Plan

> Target audience: non-technical users who need a visually attractive, low-data-density experience.
> Strategy: feature flags + component duality (each technical component can have a simplified counterpart).

---

## 1. Architecture — The `viewMode` System

### 1.1 New Store Slice: `viewModeSlice`

Create `src/stores/slices/system/viewModeSlice.ts`.

```ts
export type ViewMode = 'full' | 'simple';

export interface ViewModeSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  toggleViewMode: () => void;
}
```

- Persisted in `personaStore.ts` → `partialize` (alongside `sidebarSection`, etc.)
- Default: `'full'` (existing behavior, zero regression)
- Toggle via Settings > Appearance, sidebar footer, or command palette

### 1.2 Hook: `useSimpleMode`

Create `src/hooks/utility/useSimpleMode.ts`.

```ts
export function useSimpleMode(): boolean {
  return usePersonaStore((s) => s.viewMode === 'simple');
}
```

Every component that has a dual rendering path imports this single hook.

### 1.3 Platform Module Extension

Extend `src/lib/utils/platform/platform.ts` to export a convenience:

```ts
export const SIMPLE_SECTIONS = new Set<SidebarSection>([
  'home', 'overview', 'personas', 'credentials', 'design-reviews', 'settings',
]);
```

This defines which sidebar sections are visible in simple mode (hide Events, Team, Cloud).

---

## 2. Navigation Changes

### 2.1 Sidebar Filtering (SidebarLevel1 + sidebarData)

In `SidebarLevel1.tsx`, the existing filter chain is:

```ts
sections.filter((s) => (!s.devOnly || isDev) && (!IS_MOBILE || MOBILE_SECTIONS.has(s.id)))
```

Add a new `simpleHidden` flag to `SectionDef`:

```ts
export interface SectionDef {
  id: SidebarSection;
  icon: LucideIcon;
  label: string;
  devOnly?: boolean;
  simpleHidden?: boolean;  // ← NEW
}
```

Mark sections hidden in simple mode:

| Section | `simpleHidden` | Reason |
|---------|---------------|--------|
| home | — | Keep |
| overview | — | Keep (with simplified dashboard) |
| personas | — | Keep (with simplified cards) |
| events | `true` | Raw event log — too technical |
| credentials | — | Keep (simplified list) |
| design-reviews | — | Keep (template gallery) |
| team | `true` (+ `devOnly`) | Already dev-only |
| cloud | `true` (+ `devOnly`) | Already dev-only |
| settings | — | Keep (reduced tabs) |

Filter chain becomes:

```ts
sections.filter((s) =>
  (!s.devOnly || isDev) &&
  (!IS_MOBILE || MOBILE_SECTIONS.has(s.id)) &&
  (!isSimple || !s.simpleHidden)
)
```

### 2.2 Sub-Navigation Reduction

In simple mode, reduce sub-nav tabs for each section:

| Section | Full Tabs | Simple Tabs |
|---------|-----------|-------------|
| **Overview** | Dashboard, Executions, Manual Review, Messages, Events, Knowledge, SLA, Cron Agents, Schedules | Dashboard, Messages |
| **Credentials** | Credentials, Databases, Catalog, Add new | Credentials, Add new |
| **Templates** | n8n Import, Generated | Generated |
| **Settings** | Account, Appearance, Notifications, Engine, BYOM, Data, Admin | Account, Appearance, Notifications |

Implementation: add `simpleHidden?: boolean` to `SubNavItem` interface in `SidebarSubNav.tsx`, then filter in `SidebarLevel2.tsx`.

### 2.3 Simple Mode Toggle Location

Add a toggle to three places:
1. **Settings > Appearance** — primary location, with descriptive label
2. **Sidebar footer** — small icon toggle for quick switching (tooltip: "Switch to Simple/Full mode")
3. **Command palette** — searchable action "Toggle Simple Mode"

---

## 3. Component Duality Strategy

### 3.1 Pattern: Conditional Rendering via `useSimpleMode`

For components where the simple version is small, use inline branching:

```tsx
function MyComponent() {
  const isSimple = useSimpleMode();
  if (isSimple) return <SimpleVersion />;
  return <FullVersion />;
}
```

### 3.2 Pattern: Separate `.simple.tsx` Files (Component Duality)

For components where the simplified version is substantially different (>50 lines), create a sibling file:

```
SLADashboard.tsx           ← full version (existing)
SLADashboard.simple.tsx    ← simplified version (new)
```

The parent lazy-loads the correct variant:

```tsx
const SLADashboard = isSimple
  ? lazy(() => import('./SLADashboard.simple'))
  : lazy(() => import('./SLADashboard'));
```

### 3.3 Pattern: Prop-Driven Simplification

For shared components like `SectionHeader`, `Button`, `DataGrid` — add awareness via a `compact` or `simplified` prop that the simple mode can activate:

```tsx
<DataGrid
  columns={isSimple ? essentialColumns : allColumns}
  showFilters={!isSimple}
  showPagination={!isSimple}
  pageSize={isSimple ? 5 : 25}
/>
```

---

## 4. Per-Feature Simplification Map

### 4.1 Home (`src/features/home/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `NavigationGrid.tsx` | Prop-driven | Hide technical cards (Events, Cloud). Show: Agents, Templates, Credentials, Settings. Larger cards, more visual. |

### 4.2 Overview Dashboard (`src/features/overview/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `OverviewPage.tsx` | Inline branch | Show only: agent status summary, last 5 executions, quick-action buttons. Hide: SLA, Knowledge, Analytics widgets. |
| `DashboardHeaderBadges.tsx` | Prop-driven | Show only success/fail counts. Hide: pending reviews, healing, cron badges. |
| `StatusIndicators.tsx` | Prop-driven | Replace numeric indicators with simple green/amber/red dots. |
| `DeployFirstAutomationCard.tsx` | Inline branch | Simplify to single "Get Started" CTA instead of multi-phase UI. |

### 4.3 Overview Sub-Features

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `EventLogList.tsx` / `EventLogItem.tsx` | **Hidden** | Entire Events tab hidden from sidebar in simple mode. |
| `SLADashboard.tsx` | **Hidden** | Tab hidden in simple mode. |
| `KnowledgeGraphDashboard.tsx` | **Hidden** | Tab hidden in simple mode. |
| `WorkflowsDashboard.tsx` | **Hidden** | Tab hidden in simple mode. |
| `ReplayEntryBar.tsx` | **Hidden** | Tab hidden in simple mode. |
| `MemoryActionCard.tsx` | `.simple.tsx` | Show as friendly "What I learned" card with plain English summaries instead of memory scores and conflict data. |
| `MemoryConflictReview.tsx` | **Hidden** | Too technical for simple mode. |
| `MessageList` (sub_messages) | Inline branch | Show last 10 messages in a chat-like view instead of table. |

### 4.4 Agents (`src/features/agents/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `PersonaOverviewPage.tsx` | Inline branch | Show agents as visual cards (icon, name, status dot) instead of data-dense grid with health rings. Hide relevance scores. |
| `ChatThread.tsx` | No change | Already user-friendly (chat UI). |
| `PreviewSection.tsx` | Prop-driven | Hide technical preview metadata. Show only the preview output. |
| `HealthCheckPanel.tsx` | `.simple.tsx` | Replace issue-card grid with simple pass/fail summary: "3 checks passed, 1 needs attention". |
| Editor tabs | Tab filtering | Simple mode shows only: Use Cases, Prompt, Settings. Hides: Lab, Connectors, Design, Health. |

### 4.5 Templates (`src/features/templates/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `ExploreView.tsx` | Inline branch | Larger cards, hide technical metadata (connector counts, feasibility scores). Show: name, description, "Use this" button. |
| `CompactRow.tsx` | `.simple.tsx` | Replace compact row with visual card layout. |
| `PersonaMatrix.tsx` | **Hidden** | 8-cell architecture matrix is too technical. Replace with plain description. |
| `MatrixCommandCenter.tsx` | **Hidden** | Hidden in simple mode. |
| `ConnectorEditCell.tsx` | **Hidden** | Hidden with matrix. |
| `TemplateDetailModal.tsx` | Inline branch | Show: description, preview, "Adopt" button. Hide: connector grid, technical specs, JSON. |
| `QuickAdoptConfirm.tsx` | Inline branch | Simplify to: "This will create an agent for [use case]. Continue?" |
| `ConnectStep.tsx` | Inline branch | Guided credential connection with friendlier labels, hide raw connector IDs. |
| `ConnectorReadiness.tsx` | Prop-driven | Replace technical readiness bars with simple checkmarks. |

### 4.6 Vault / Credentials (`src/features/vault/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `CredentialManager.tsx` | Inline branch | Hide bulk actions, import/export. Show simple list with add button. |
| `CredentialManagerHeader.tsx` | Prop-driven | Hide health status bar, filter controls. Simple title + "Add" button. |
| `HealthStatusBar.tsx` | **Hidden** | Hidden in simple mode. |
| `CredentialList.tsx` | Inline branch | Show: name, type icon, status dot (green/red). Hide: auth method, rotation policy, last-used date. |
| `CredentialCardHeader.tsx` | Prop-driven | Show: name, icon, connected/disconnected badge. Hide: UUID, auth method label, overflow badges. |
| `VaultStatusBadge.tsx` | Prop-driven | Simplify to just "Connected" / "Issue" with color. |
| `BadgeOverflowPill.tsx` | **Hidden** | Hide badge overflow in simple mode. |
| `CredentialPicker.tsx` | Inline branch | Simple dropdown instead of filterable multi-panel picker. |
| `CredentialPickerFilters.tsx` | **Hidden** | Hidden in simple mode. |
| `CredentialPlaygroundModal.tsx` | **Hidden** | Too technical. Replace with simple "Test Connection" button that returns pass/fail. |
| `PlaygroundTabContent.tsx` | **Hidden** | Hidden with playground. |
| `SqlEditor.tsx` | **Hidden** | Hidden (Databases tab removed in simple mode). |
| `DatabaseListView.tsx` | **Hidden** | Hidden (Databases tab removed). |
| `AuditLogTable.tsx` | **Hidden** | Hidden in simple mode. |
| `HealthcheckResultDisplay.tsx` | Inline branch | Show: pass/fail icon. Hide: raw error messages, response details. |
| `WizardBatchPhase.tsx` | Inline branch | Simplify language, hide batch operation details. |
| `WizardDetectPhase.tsx` | Inline branch | Show friendly "Scanning..." with progress instead of technical detection log. |

### 4.7 Execution (`src/features/execution/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `ExecutionMiniPlayer.tsx` | `.simple.tsx` | Replace terminal output with friendly progress bar: "Running... Step 2 of 4". Hide ANSI output, pipeline dots. Show only: agent name, progress, stop button. |

### 4.8 Deployment (`src/features/deployment/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `CloudSchedulesPanel.tsx` | **Hidden** | Entire Cloud section hidden in simple mode. |

### 4.9 Onboarding (`src/features/onboarding/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `GuidedTour.tsx` | Inline branch | Fewer tour steps, skip technical ones (health checks, connectors, events). Focus on: create agent, pick template, run. |

### 4.10 Shared Components (`src/features/shared/`)

| Component | Change Type | Simple Mode Behavior |
|-----------|------------|---------------------|
| `Button.tsx` | No change | Already clean. |
| `SectionHeader.tsx` | Prop-driven | Accept `simplified` prop — hides badge, trailing actions. Just icon + label. |
| `ConnectorMeta.tsx` | Prop-driven | Show only icon + name. Hide: category, description, auth type. |
| `SidebarLevel1.tsx` | Filter | Apply `simpleHidden` filter. |
| `SidebarSubNav.tsx` | Filter | Apply `simpleHidden` filter on items. |
| `DataGrid.tsx` | Prop-driven | `simplified` prop: hide filters, reduce visible columns, smaller page size. |

### 4.11 Lib / Utils

| File | Change Type | Simple Mode Behavior |
|------|------------|---------------------|
| `designTokens.ts` | New tokens | Add `SIMPLE_MODE_TOKENS`: larger touch targets, more spacing, softer colors. |
| `formatters.ts` | New formatters | Add `formatSimpleStatus()`: maps granular statuses to 3 levels (good/warning/problem). |

---

## 5. Design Tokens for Simple Mode

Add to `designTokens.ts`:

```ts
export const SIMPLE_MODE = {
  /** Reduced set of status levels for simple mode */
  STATUS: {
    good:    { label: 'Good',    color: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-400' },
    warning: { label: 'Attention', color: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-400' },
    problem: { label: 'Problem', color: 'text-red-400',    bg: 'bg-red-500/10',    dot: 'bg-red-400' },
  },
  /** Card styles for simple mode (larger, more visual) */
  CARD: 'rounded-xl border border-primary/10 bg-background/60 p-5 shadow-sm',
  /** Minimum touch target for simple mode buttons */
  MIN_TARGET: 'min-h-[44px] min-w-[44px]',
};
```

---

## 6. Implementation Phases

### Phase 1 — Foundation (Infrastructure)
**Files to create/modify:**
1. `src/stores/slices/system/viewModeSlice.ts` — new slice
2. `src/stores/storeTypes.ts` — add `ViewModeSlice` to `PersonaStore` type
3. `src/stores/personaStore.ts` — compose slice, persist `viewMode`
4. `src/hooks/utility/useSimpleMode.ts` — convenience hook
5. `src/lib/utils/platform/platform.ts` — add `SIMPLE_SECTIONS`
6. `src/lib/utils/designTokens.ts` — add `SIMPLE_MODE` tokens
7. `src/lib/utils/formatters.ts` — add `formatSimpleStatus()`

**Verification:** Toggle works, persists, no existing behavior changes.

### Phase 2 — Navigation Shell
**Files to modify:**
1. `src/features/shared/components/layout/sidebar/sidebarData.ts` — add `simpleHidden` flags
2. `src/features/shared/components/layout/sidebar/SidebarLevel1.tsx` — filter chain
3. `src/features/shared/components/layout/sidebar/SidebarSubNav.tsx` — add `simpleHidden` to `SubNavItem`, filter
4. `src/features/shared/components/layout/sidebar/SidebarLevel2.tsx` — pass filtered items
5. `src/features/shared/components/layout/sidebar/Sidebar.tsx` — add toggle in footer

**Verification:** Sidebar correctly shows/hides sections and tabs per mode.

### Phase 3 — Shared Component Awareness
**Files to modify:**
1. `src/features/shared/components/layout/SectionHeader.tsx` — `simplified` prop
2. `src/features/shared/components/display/ConnectorMeta.tsx` — `simplified` prop
3. `src/features/shared/components/display/DataGrid.tsx` — `simplified` prop
4. Settings > Appearance — add toggle UI

**Verification:** Shared components respond to simple mode flag correctly.

### Phase 4 — Overview Dashboard Simplification
**Files to modify/create:**
1. `src/features/overview/components/dashboard/OverviewPage.tsx` — conditional widget set
2. `src/features/overview/components/dashboard/widgets/DashboardHeaderBadges.tsx` — reduce badges
3. `src/features/overview/components/health/StatusIndicators.tsx` — dot-based indicators
4. `src/features/overview/components/dashboard/cards/DeployFirstAutomationCard.tsx` — single CTA
5. `src/features/overview/sub_memories/MemoryActionCard.tsx` — friendly wording

**Verification:** Dashboard in simple mode shows clean, visual summary.

### Phase 5 — Agent & Template Simplification
**Files to modify/create:**
1. `src/features/agents/components/persona/PersonaOverviewPage.tsx` — visual cards
2. `src/features/agents/health/HealthCheckPanel.simple.tsx` — new simplified version
3. `src/features/templates/sub_generated/gallery/explore/ExploreView.tsx` — card layout
4. `src/features/templates/sub_generated/gallery/cards/CompactRow.tsx` — visual card variant
5. `src/features/templates/sub_generated/gallery/modals/TemplateDetailModal.tsx` — reduced detail
6. `src/features/templates/sub_generated/adoption/steps/build/QuickAdoptConfirm.tsx` — simplified confirm
7. `src/features/templates/sub_generated/shared/ConnectorReadiness.tsx` — checkmarks

**Verification:** Agent list and template gallery feel approachable in simple mode.

### Phase 6 — Vault & Execution Simplification
**Files to modify/create:**
1. `src/features/vault/sub_manager/CredentialManager.tsx` — streamlined list
2. `src/features/vault/sub_manager/CredentialManagerHeader.tsx` — reduced header
3. `src/features/vault/sub_list/CredentialList.tsx` — name + status only
4. `src/features/vault/sub_card/CredentialCardHeader.tsx` — icon + name + badge
5. `src/features/vault/sub_card/badges/VaultStatusBadge.tsx` — binary status
6. `src/features/execution/components/ExecutionMiniPlayer.simple.tsx` — progress bar variant

**Verification:** Credential management and execution feel simple and safe.

### Phase 7 — Onboarding & Polish
**Files to modify:**
1. `src/features/onboarding/components/GuidedTour.tsx` — shortened tour for simple mode
2. `src/features/home/components/NavigationGrid.tsx` — filtered cards
3. All `.simple.tsx` files — visual polish pass
4. First-launch detection: if new user, default to `simple` mode with a prompt to switch

**Verification:** End-to-end flow in simple mode feels cohesive and non-intimidating.

---

## 7. Migration Safety Rules

1. **Zero regression**: `viewMode: 'full'` must produce byte-identical rendering to current behavior. All changes are additive.
2. **No component deletion**: Full-mode components stay untouched. Simple variants are separate files or guarded branches.
3. **Incremental rollout**: Each phase is independently deployable. Phase 1 alone changes nothing visible.
4. **Feature flag discipline**: Every simple-mode branch uses `useSimpleMode()` — no ad-hoc checks.
5. **Shared component props are optional**: `simplified?: boolean` defaults to `false`. Existing call sites are unaffected.

---

## 8. File Inventory Summary

| Category | New Files | Modified Files |
|----------|-----------|----------------|
| Store / Hook | 2 | 2 |
| Platform / Tokens | 0 | 2 |
| Sidebar / Nav | 0 | 5 |
| Shared Components | 0 | 3 |
| Feature Components | 3 (`.simple.tsx`) | ~25 |
| Settings UI | 0 | 1 |
| **Total** | **~5** | **~38** |

---

## 9. Future Extensions (Out of Scope)

- **Per-section mode override**: Allow users to use simple mode globally but full mode for a specific section.
- **Role-based defaults**: Auto-set mode based on user role (admin → full, operator → simple).
- **Simple mode onboarding wizard**: A dedicated onboarding flow that only shows simple-mode features.
- **Analytics**: Track mode usage to inform which features need simplification most.
