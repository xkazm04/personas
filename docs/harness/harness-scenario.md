# Harness Scenario: Codebase-Wide Quality Goals

> 3-goal scenario targeting typography tokens, i18n coverage, and background LLM notifications.
> Estimated: ~45 areas, 4-6 hours, $20-40 API cost.

---

## Goals

### Goal 1: Typography Token Coverage
**All typography in the app must come from semantic tokens (`typo-*` classes) with dynamic size scaling via `data-text-scale`.**

Users can adjust between four tiers in Settings > Appearance:
- `compact` (13px base)
- `default` (14px base)
- `large` (15px base)
- `larger` (16.5px base)

**Current state:** Only 20% of files use `typo-*` classes. 756 files (63%) use raw Tailwind `text-*` size classes that bypass the scale system.

**Success criteria:**
- 0 raw `text-{size}` classes (text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, text-4xl) used for font sizing in `.tsx` files
- 0 raw `font-{weight}` classes — weight is part of the semantic class
- All text renders correctly at all 4 scale tiers
- Exception: Recharts/SVG components may keep inline `fontSize` (CSS classes don't apply to SVG text)
- Exception: `text-{color}` classes (text-foreground, text-muted-foreground, etc.) are NOT typography size classes — leave them

### Goal 2: Full i18n Coverage
**All user-facing text must use the `useTranslation()` hook and translation keys.**

**Current state:** Only 11/1192 files (0.9%) import `useTranslation`. ~1,298 hardcoded English strings across 797 files.

**Success criteria:**
- Every `.tsx` component with user-facing text imports `useTranslation` and uses `t.*` keys
- Translation keys added to `src/i18n/en.ts` (English source of truth)
- All `placeholder`, `title`, `aria-label` attributes use translation keys
- All JSX text content uses translation keys
- Do NOT translate: brand names, technical identifiers (see en.ts translator guide)
- Partial translations for non-English locales are acceptable — English fallback covers gaps

### Goal 3: Background LLM Process Notifications
**All background LLM processes must have: sidebar indicator, OS notification on completion, in-app notification with redirect button.**

**Current state (10 processes identified):**

| Process | Sidebar | OS Notify | App Notify | Redirect |
|---------|---------|-----------|------------|----------|
| n8nTransform | YES | NO | NO | NO |
| templateAdopt | YES | YES | YES | NO |
| rebuild | YES | NO | YES | NO |
| templateTest | YES | NO | YES | NO |
| contextScan | YES | YES | NO | YES |
| execution | YES | NO | NO | NO |
| matrixBuild | YES | NO | partial | NO |
| labRunning | YES | NO | NO | NO |
| connectorTest | YES | NO | NO | NO |
| creativeSession | YES | NO | NO | NO |

**Success criteria:**
- All 10 processes show pulsing sidebar indicator while running (already done)
- All 10 trigger OS notification on completion via `@tauri-apps/plugin-notification`
- All 10 add entry to notification center (bell icon in header) with:
  - Process type, persona name, timestamp, read/unread status
  - "View" button that navigates to the relevant section of the app
- Notification center entries persist until read or until the user opens the module where it happened
- Notification center accessible from app header (bell icon with unread count badge)

---

## Area Definitions

### Tier 0: Foundation (must complete first)

#### Area 0.1: Typography Mapping Reference
- **ID:** `typo-mapping`
- **Goal:** Create a definitive mapping from raw Tailwind classes to semantic `typo-*` classes
- **Features:**
  - [ ] Document mapping: `text-4xl` → `typo-hero`, `text-xl` → `typo-heading-lg`, `text-sm font-bold` → `typo-heading`, `text-sm` → `typo-body`, `text-base` → `typo-body-lg`, `text-xs` → `typo-caption`, `text-xs font-bold uppercase` → `typo-label`, `text-sm tabular-nums` → `typo-data`, `text-2xl font-bold tabular-nums` → `typo-data-lg`, `font-mono text-xs` → `typo-code`
  - [ ] Handle ambiguous cases: `text-sm font-medium` → `typo-body` (weight handled by class)
  - [ ] Create migration lint rule or grep pattern
- **Dependencies:** none
- **Verification:** Mapping document exists, grep patterns validated

#### Area 0.2: i18n Key Structure Expansion
- **ID:** `i18n-key-structure`
- **Goal:** Expand `en.ts` key structure to cover all feature areas
- **Features:**
  - [ ] Add key namespaces for: agents, overview, triggers, credentials, templates, plugins, deployment
  - [ ] Add keys for common patterns: table headers, empty states, tooltips, placeholders
  - [ ] Maintain translator guide comments for each new section
- **Dependencies:** none
- **Verification:** en.ts parses without errors, key structure covers all feature directories

#### Area 0.3: Notification Infrastructure
- **ID:** `notification-infra`
- **Goal:** Extend notification center to support background process notifications with redirect
- **Features:**
  - [ ] Extend `PipelineNotification` type or create `ProcessNotification` type with: processType, personaName, status, redirectPath, timestamp, read
  - [ ] Add `addProcessNotification()` to notification center store
  - [ ] Add `markAsReadByRedirect(path)` — auto-mark when user navigates to the target
  - [ ] Add redirect button component for notification items
  - [ ] Ensure bell icon shows combined unread count (pipelines + processes)
- **Dependencies:** none
- **Verification:** typecheck, notification store has new methods

---

### Tier 1: Typography Migration (by feature area)

#### Area 1.1: shared/components Typography
- **ID:** `typo-shared`
- **Goal:** Migrate all shared components to `typo-*` classes
- **Scope:** `src/features/shared/components/` (buttons, forms, display, feedback, layout, overlays, editors)
- **Features:**
  - [ ] buttons/ — Button, CopyButton, etc.
  - [ ] forms/ — inputs, selectors, toggles
  - [ ] display/ — ConnectorMeta, badges, status indicators
  - [ ] feedback/ — ErrorBoundary, loading states, toasts
  - [ ] layout/ — TitleBar, Footer, AuthButton, sidebar components
  - [ ] overlays/ — modals, panels, command palette
  - [ ] editors/ — MarkdownRenderer, code editors
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, lint, `grep -r "text-xs\|text-sm\|text-base\|text-lg\|text-xl" src/features/shared/` returns 0 size matches

#### Area 1.2: home/ Typography
- **ID:** `typo-home`
- **Goal:** Migrate home feature to `typo-*` classes
- **Scope:** `src/features/home/`
- **Features:**
  - [ ] HomeWelcome.tsx (hero greeting)
  - [ ] LanguageSwitcher.tsx
  - [ ] All home sub-components
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.3: settings/ Typography
- **ID:** `typo-settings`
- **Goal:** Migrate settings feature to `typo-*` classes
- **Scope:** `src/features/settings/`
- **Features:**
  - [ ] SettingsPage tabs
  - [ ] AccountSettings
  - [ ] AppearanceSettings (theme, text scale, brightness)
  - [ ] NotificationSettings
  - [ ] All sub-settings panels
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.4: overview/ Typography
- **ID:** `typo-overview`
- **Goal:** Migrate overview feature to `typo-*` classes
- **Scope:** `src/features/overview/`
- **Features:**
  - [ ] OverviewPage dashboard
  - [ ] sub_executions/ (ExecutionRow, GlobalExecutionList)
  - [ ] sub_events/ (EventLogItem, EventLogList)
  - [ ] sub_health/ (HeartbeatIndicator, SectionCard)
  - [ ] sub_memories/ (MemoryCard, ConflictCard, MemoryDetailModal)
  - [ ] sub_messages/ (MessageList)
  - [ ] sub_manual-review/ (ReviewListItem, ReviewDetailPanel)
  - [ ] sub_knowledge/ (KnowledgeRow)
  - [ ] sub_timeline/ (UnifiedActivityTimeline)
  - [ ] sub_cron_agents/ (CronAgentsPage)
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.5: agents/ Typography (Part 1 — core components)
- **ID:** `typo-agents-core`
- **Goal:** Migrate agents core components to `typo-*` classes
- **Scope:** `src/features/agents/components/` (creation, matrix, onboarding, persona, chat)
- **Features:**
  - [ ] creation/ steps (IdentityPreviewCard, builder actions, pickers)
  - [ ] matrix/ (UnifiedMatrixEntry, DimensionEditPanel, ConnectorsCellContent)
  - [ ] onboarding/ (OnboardingTemplateStep, OnboardingChecklist)
  - [ ] persona/ (PersonaOverviewPage, PersonaCard)
  - [ ] ChatThread.tsx
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.6: agents/ Typography (Part 2 — sub-features)
- **ID:** `typo-agents-sub`
- **Goal:** Migrate agents sub-features to `typo-*` classes
- **Scope:** `src/features/agents/sub_*/`
- **Features:**
  - [ ] sub_activity/
  - [ ] sub_connectors/
  - [ ] sub_design/
  - [ ] sub_lab/
  - [ ] sub_prompt/
  - [ ] sub_tests/
  - [ ] sub_tools/
  - [ ] sub_versions/
- **Dependencies:** `typo-agents-core`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.7: triggers/ Typography
- **ID:** `typo-triggers`
- **Goal:** Migrate triggers feature to `typo-*` classes
- **Scope:** `src/features/triggers/`
- **Features:**
  - [ ] sub_canvas/ (AddPersonaModal, UnifiedRoutingView, PersonaConsumerNode, PersonaPalette)
  - [ ] sub_eventbus/ (EventsPage)
  - [ ] sub_live_stream/ (LiveStreamTab)
  - [ ] sub_studio/ (PersonaStepNode, TriggerStudioPalette)
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.8: templates/ Typography
- **ID:** `typo-templates`
- **Goal:** Migrate templates feature to `typo-*` classes
- **Scope:** `src/features/templates/`
- **Features:**
  - [ ] sub_generated/ (MatrixAdoptionView, QuestionnaireFormGrid, BuildStep, BuildQuestionnaireModal)
  - [ ] sub_n8n/ (import flow)
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.9: plugins/ Typography
- **ID:** `typo-plugins`
- **Goal:** Migrate plugins feature to `typo-*` classes
- **Scope:** `src/features/plugins/`
- **Features:**
  - [ ] artist/ (GalleryPage)
  - [ ] dev-tools/ (GitHubRepoSelector, context scan UI)
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, 0 raw text-size classes in scope

#### Area 1.10: remaining features Typography
- **ID:** `typo-remaining`
- **Goal:** Migrate any remaining features (credentials, deployment, personas page, schedules)
- **Scope:** `src/features/personas/`, `src/features/schedules/`, `src/features/deployment/`, `src/features/credentials/`
- **Features:**
  - [ ] PersonasPage.tsx
  - [ ] schedules/ components
  - [ ] deployment/ components
  - [ ] credentials/ (vault) components
- **Dependencies:** `typo-mapping`
- **Verification:** typecheck, full codebase grep shows 0 raw text-size classes in .tsx files

---

### Tier 2: i18n Migration (by feature area)

#### Area 2.1: shared/components i18n
- **ID:** `i18n-shared`
- **Goal:** Add translation keys to all shared components
- **Scope:** `src/features/shared/`
- **Features:**
  - [ ] All button labels, form placeholders, error messages
  - [ ] All modal titles, panel headers
  - [ ] All tooltip text, aria-labels
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, `grep -rn 'placeholder="[A-Z]' src/features/shared/` returns 0

#### Area 2.2: home/ i18n
- **ID:** `i18n-home`
- **Goal:** i18n for home feature (already partially done)
- **Scope:** `src/features/home/`
- **Features:**
  - [ ] Verify all strings use t.* keys
  - [ ] Add any missing keys
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.3: settings/ i18n
- **ID:** `i18n-settings`
- **Goal:** i18n for settings feature
- **Scope:** `src/features/settings/`
- **Features:**
  - [ ] Tab labels, section headers
  - [ ] Form labels, descriptions
  - [ ] Toggle labels, help text
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.4: overview/ i18n
- **ID:** `i18n-overview`
- **Goal:** i18n for overview feature
- **Scope:** `src/features/overview/`
- **Features:**
  - [ ] Dashboard labels, widget titles
  - [ ] Execution table headers, status labels
  - [ ] Event log labels, memory cards
  - [ ] Review panel text, health indicators
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.5: agents/ i18n (Part 1)
- **ID:** `i18n-agents-core`
- **Goal:** i18n for agents core components
- **Scope:** `src/features/agents/components/`
- **Features:**
  - [ ] Creation wizard labels, step descriptions
  - [ ] Matrix table headers, cell content
  - [ ] Onboarding text, chat messages
  - [ ] Persona overview labels
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.6: agents/ i18n (Part 2)
- **ID:** `i18n-agents-sub`
- **Goal:** i18n for agents sub-features
- **Scope:** `src/features/agents/sub_*/`
- **Features:**
  - [ ] Activity labels, connector UI text
  - [ ] Design conversation labels
  - [ ] Lab/test result labels
  - [ ] Prompt editor labels
  - [ ] Tool configuration text
- **Dependencies:** `i18n-agents-core`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.7: triggers/ i18n
- **ID:** `i18n-triggers`
- **Goal:** i18n for triggers feature
- **Scope:** `src/features/triggers/`
- **Features:**
  - [ ] Canvas labels, modal text
  - [ ] Event bus labels
  - [ ] Live stream labels
  - [ ] Studio palette labels
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.8: templates/ i18n
- **ID:** `i18n-templates`
- **Goal:** i18n for templates feature
- **Scope:** `src/features/templates/`
- **Features:**
  - [ ] Adoption view labels, questionnaire text
  - [ ] Gallery labels, build modal text
  - [ ] n8n import labels
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.9: plugins/ i18n
- **ID:** `i18n-plugins`
- **Goal:** i18n for plugins feature
- **Scope:** `src/features/plugins/`
- **Features:**
  - [ ] Artist gallery labels
  - [ ] Dev tools labels
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, 0 hardcoded strings in scope

#### Area 2.10: remaining features i18n
- **ID:** `i18n-remaining`
- **Goal:** i18n for remaining features
- **Scope:** `src/features/personas/`, `src/features/schedules/`, `src/features/deployment/`, `src/features/credentials/`
- **Features:**
  - [ ] All remaining hardcoded strings
- **Dependencies:** `i18n-key-structure`
- **Verification:** typecheck, full codebase shows 0 hardcoded user-facing strings

---

### Tier 3: Background LLM Notifications

#### Area 3.1: Notification Center Extension
- **ID:** `notify-center`
- **Goal:** Extend notification center store with process notification support
- **Features:**
  - [ ] `ProcessNotification` type: id, processType, personaId, personaName, status, summary, redirectSection, redirectTab, timestamp, read
  - [ ] `addProcessNotification(notification)` action
  - [ ] `markProcessRead(id)` action
  - [ ] `markProcessReadByNavigation(section, tab)` — auto-read when user navigates there
  - [ ] Combined unread count (pipeline + process notifications)
  - [ ] Persist to localStorage (max 100 items, auto-prune)
- **Dependencies:** `notification-infra`
- **Verification:** typecheck, store methods exist

#### Area 3.2: Notification Bell UI
- **ID:** `notify-bell-ui`
- **Goal:** Update header bell icon to show process notifications with redirect buttons
- **Features:**
  - [ ] Bell icon shows combined unread count badge
  - [ ] Notification panel lists process notifications alongside pipeline notifications
  - [ ] Each process notification shows: icon, persona name, process type, time, summary
  - [ ] "View" button navigates to relevant section (e.g., agents > persona > executions tab)
  - [ ] Mark as read on "View" click
  - [ ] Mark all as read button
  - [ ] Empty state when no notifications
- **Dependencies:** `notify-center`
- **Verification:** typecheck, build

#### Area 3.3: OS Notification Utility
- **ID:** `notify-os-util`
- **Goal:** Create reusable OS notification helper for background processes
- **Features:**
  - [ ] `notifyProcessComplete(processType, personaName, success, summary)` helper
  - [ ] Checks permission via `isPermissionGranted()`, requests if needed
  - [ ] Sends OS notification with title, body
  - [ ] Also adds to notification center store (dual delivery)
- **Dependencies:** `notify-center`
- **Verification:** typecheck

#### Area 3.4: n8nTransform Notifications
- **ID:** `notify-n8n`
- **Goal:** Add OS + app notifications to n8nTransform process
- **Scope:** `src/features/templates/sub_n8n/`, relevant hooks
- **Features:**
  - [ ] Call `notifyProcessComplete()` on transform completion
  - [ ] Redirect path: templates > n8n tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.5: execution Notifications
- **ID:** `notify-execution`
- **Goal:** Add OS + app notifications to agent execution completion
- **Scope:** `src/stores/slices/agents/executionSlice.ts`, execution hooks
- **Features:**
  - [ ] Call `notifyProcessComplete()` when execution finishes
  - [ ] Redirect path: agents > persona > executions tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.6: labRunning Notifications
- **ID:** `notify-lab`
- **Goal:** Add OS + app notifications to lab runs (arena, AB, matrix tests)
- **Scope:** `src/stores/slices/agents/labSlice.ts`, lab hooks
- **Features:**
  - [ ] Call `notifyProcessComplete()` on lab run completion
  - [ ] Redirect path: agents > persona > lab tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.7: matrixBuild Notifications
- **ID:** `notify-matrix`
- **Goal:** Add OS + app notifications to matrix build
- **Scope:** `src/stores/slices/agents/matrixBuildSlice.ts`
- **Features:**
  - [ ] Call `notifyProcessComplete()` on build completion
  - [ ] Redirect path: agents > persona > matrix tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.8: connectorTest Notifications
- **ID:** `notify-connector`
- **Goal:** Add OS + app notifications to connector test
- **Scope:** Connector test hooks
- **Features:**
  - [ ] Call `notifyProcessComplete()` on test completion
  - [ ] Redirect path: agents > persona > connectors tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.9: creativeSession Notifications
- **ID:** `notify-creative`
- **Goal:** Add OS + app notifications to creative session (artist/blender)
- **Scope:** `src/stores/slices/system/artistSlice.ts`, artist hooks
- **Features:**
  - [ ] Call `notifyProcessComplete()` on session completion
  - [ ] Redirect path: plugins > artist > gallery tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.10: contextScan App Notification
- **ID:** `notify-context-scan`
- **Goal:** Add app notification to context scan (already has OS notification)
- **Scope:** `src/features/plugins/dev-tools/hooks/useContextScanBackground.ts`
- **Features:**
  - [ ] Also call notification center store when scan completes
  - [ ] Redirect path: plugins > dev-tools > context-map tab
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.11: rebuild + templateTest Notifications
- **ID:** `notify-rebuild-test`
- **Goal:** Add OS notifications to rebuild and templateTest (already have app notifications)
- **Scope:** `src/hooks/design/core/useBackgroundRebuild.ts`, `useBackgroundPreview.ts`
- **Features:**
  - [ ] Add OS notification on rebuild completion
  - [ ] Add OS notification on template test completion
  - [ ] Add redirect buttons to existing app notifications
  - [ ] Redirect: agents > persona > overview for rebuild, agents > persona > tests for templateTest
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

#### Area 3.12: templateAdopt Redirect
- **ID:** `notify-adopt-redirect`
- **Goal:** Add redirect button to templateAdopt notification (already has OS + app)
- **Scope:** `src/features/templates/sub_generated/adoption/`
- **Features:**
  - [ ] Add redirect path: agents > adopted persona
- **Dependencies:** `notify-os-util`
- **Verification:** typecheck

---

## Verification Gates

### Standard Gates (all areas)
```
typecheck:  npx tsc --noEmit
lint:       npm run lint
```

### Scenario-Specific Gates

#### Typography Audit Gate
```bash
# Count raw text-size classes in .tsx files (should be 0 in completed areas)
grep -rn "text-xs\b\|text-sm\b\|text-base\b\|text-lg\b\|text-xl\b\|text-2xl\b\|text-3xl\b\|text-4xl\b" \
  --include="*.tsx" <area-scope> \
  | grep -v "text-foreground\|text-muted\|text-background\|text-primary\|text-secondary\|text-accent\|text-status\|text-brand\|text-card\|text-destructive\|text-white\|text-black\|text-inherit\|text-current\|text-transparent\|text-center\|text-left\|text-right\|text-ellipsis\|text-wrap\|text-nowrap\|text-balance\|text-clip\|text-start\|text-end" \
  | wc -l
```

#### i18n Audit Gate
```bash
# Count hardcoded English strings in JSX (should be 0 in completed areas)
grep -rn 'placeholder="[A-Z]\|title="[A-Z]\|aria-label="[A-Z]' \
  --include="*.tsx" <area-scope> \
  | grep -v "node_modules\|\.test\." \
  | wc -l
```

#### Notification Coverage Gate
```bash
# Verify all process types have notifyProcessComplete call
grep -rn "notifyProcessComplete" src/ --include="*.ts" --include="*.tsx" | wc -l
# Should be >= 10 (one per background process)
```

---

## Build Order Summary

```
Tier 0 (Foundation):
  0.1 typo-mapping
  0.2 i18n-key-structure
  0.3 notification-infra

Tier 1 (Typography — parallel within tier):
  1.1  typo-shared         → depends on 0.1
  1.2  typo-home           → depends on 0.1
  1.3  typo-settings       → depends on 0.1
  1.4  typo-overview       → depends on 0.1
  1.5  typo-agents-core    → depends on 0.1
  1.6  typo-agents-sub     → depends on 1.5
  1.7  typo-triggers       → depends on 0.1
  1.8  typo-templates      → depends on 0.1
  1.9  typo-plugins        → depends on 0.1
  1.10 typo-remaining      → depends on 0.1

Tier 2 (i18n — parallel within tier):
  2.1  i18n-shared         → depends on 0.2
  2.2  i18n-home           → depends on 0.2
  2.3  i18n-settings       → depends on 0.2
  2.4  i18n-overview       → depends on 0.2
  2.5  i18n-agents-core    → depends on 0.2
  2.6  i18n-agents-sub     → depends on 2.5
  2.7  i18n-triggers       → depends on 0.2
  2.8  i18n-templates      → depends on 0.2
  2.9  i18n-plugins        → depends on 0.2
  2.10 i18n-remaining      → depends on 0.2

Tier 3 (Notifications — sequential within tier):
  3.1  notify-center       → depends on 0.3
  3.2  notify-bell-ui      → depends on 3.1
  3.3  notify-os-util      → depends on 3.1
  3.4  notify-n8n          → depends on 3.3
  3.5  notify-execution    → depends on 3.3
  3.6  notify-lab          → depends on 3.3
  3.7  notify-matrix       → depends on 3.3
  3.8  notify-connector    → depends on 3.3
  3.9  notify-creative     → depends on 3.3
  3.10 notify-context-scan → depends on 3.3
  3.11 notify-rebuild-test → depends on 3.3
  3.12 notify-adopt-redirect → depends on 3.3
```

Total: **3 foundation + 10 typography + 10 i18n + 12 notification = 35 areas**

---

## Running This Scenario

```bash
# Dry run — preview the plan
npx tsx src/lib/harness/run-harness.ts \
  --scenario docs/harness/harness-scenario.md \
  --project "C:/Users/kazda/kiro/personas" \
  --name "personas" \
  --dry-run

# Full run
npx tsx src/lib/harness/run-harness.ts \
  --scenario docs/harness/harness-scenario.md \
  --project "C:/Users/kazda/kiro/personas" \
  --name "personas" \
  --max-iterations 50 \
  --target-pass-rate 90 \
  --timeout 600000

# Monitor progress
cat .harness/progress.json | npx tsx -e "
  const p = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const done = p.filter(e => e.outcome === 'completed').length;
  const total = 35;
  console.log(\`\${done}/\${total} areas completed (\${Math.round(done/total*100)}%)\`);
"
```

---

## Expected Timeline

| Phase | Areas | Est. Duration |
|-------|-------|---------------|
| Tier 0 Foundation | 3 | 15-30 min |
| Tier 1 Typography | 10 | 60-90 min |
| Tier 2 i18n | 10 | 90-120 min |
| Tier 3 Notifications | 12 | 60-90 min |
| **Total** | **35** | **4-6 hours** |

Estimated API cost: $20-40 (depending on retry rate).
