# i18n Implementation Plan — Full App Coverage

## Current State

The app supports 14 languages: `en`, `zh`, `ar`, `hi`, `ru`, `id`, `es`, `fr`, `bn`, `ja`, `vi`, `de`, `ko`, `cs`.

Only the **Home page** (`src/features/home/i18n/`) has translations across all 14 languages. A shared English-only dictionary exists at `src/i18n/en.ts` (~176 lines) covering common, vault, deployment, overview, personas, and settings keys — but has no counterpart files for other languages.

Everything else — sidebar labels, agent management, error messages, templates, validation, toasts, dates, numbers — is hardcoded English.

### What does NOT need translation
- Already-created persona content (name, description, system prompt) retains its language of origin.
- Internal log lines, developer-facing debug output, and telemetry payloads.

---

## Architecture

### Translation file structure

```
src/i18n/
  index.ts              ← useTranslation() hook + lazy loader
  types.ts              ← generated Translations type from en.ts
  en.ts                 ← source of truth (all keys defined here)
  zh.ts                 ← Chinese overrides
  ar.ts                 ← Arabic overrides
  ... (one file per language)
  home/                 ← EXISTING — merge into root, then remove
```

Each non-English file only needs to export the same shape as `en.ts`. The hook falls back to English for any missing key, so partial translations ship safely.

### Key naming convention

Flat dot-path within nested objects, scoped by feature:

```
common.save             ← shared UI verbs
common.status.active    ← shared status labels
sidebar.home            ← navigation
agents.empty            ← agent-specific empty state
vault.health.healthy    ← vault health badge
errors.boundary.title   ← error boundary heading
validation.required     ← form validation
templates.meta.{slug}   ← template catalog metadata
```

### Hook API

```ts
// src/i18n/index.ts
import { useI18nStore } from '@/stores/i18nStore';

export function useTranslation() {
  const { language } = useI18nStore();
  const dict = useMemo(() => loadDictionary(language), [language]);
  // t('vault.health.healthy') → resolved string
  // t('overview.agent_count', { count: 5 }) → interpolation + plurals
  return { t, language };
}
```

The `t()` function handles:
- Dot-path key lookup with English fallback.
- `{variable}` interpolation: `t('summary', { count: 5 })` → replaces `{count}`.
- Pluralization via `_zero`, `_one`, `_few`, `_many`, `_other` suffixes (see Pluralization section).

### Lazy loading dictionaries

Only English is bundled. Other languages are loaded dynamically on first use:

```ts
const DICT_LOADERS: Record<Language, () => Promise<{ default: Translations }>> = {
  en: () => import('./en'),
  zh: () => import('./zh'),
  ar: () => import('./ar'),
  // ...
};

const cache = new Map<Language, Translations>();

async function loadDictionary(lang: Language): Promise<Translations> {
  if (cache.has(lang)) return cache.get(lang)!;
  const mod = await DICT_LOADERS[lang]();
  cache.set(lang, mod.default);
  return mod.default;
}
```

This keeps the main bundle small — non-English dictionaries are only fetched when the user switches language.

---

## Scope Breakdown

### Layer 1 — UI Strings (Frontend)

This is the largest surface area. Every user-visible string in `.tsx` components must go through `t()`.

#### 1.1 Navigation & Sidebar
**File**: `src/features/shared/components/Sidebar.tsx`

Hardcoded labels: Home, Overview, Agents, Events, Keys, Templates, Teams, Cloud, Settings, plus sub-nav items and version display.

```ts
// Before
{ id: 'home', label: 'Home', icon: Home }
// After
{ id: 'home', label: t('sidebar.home'), icon: Home }
```

#### 1.2 Agent Management
**Files**: `PersonaOverviewPage.tsx`, `GroupedAgentSidebar.tsx`, `CreationWizard`, `ComponentsPicker.tsx`, `IdentityStep.tsx`, `BuilderStep.tsx`, `HealthCheckPanel.tsx`, `PersonaHoverPreview.tsx`

Strings: status badges (Active, Inactive, Needs Attention, Idle), empty states, section headers, health grades (Healthy, Degraded, Unhealthy), button labels, placeholder text.

#### 1.3 Vault / Credentials
**Files**: `CredentialManager.tsx`, `CredentialList.tsx`, `CredentialPicker.tsx`, `CredentialTemplateForm.tsx`, `CredentialTypePicker.tsx`, `ImportSourcePicker.tsx`, `NegotiatorPanel.tsx`, `AutoCredPanel.tsx`, `ScopeMismatchBanner.tsx`

Strings: health statuses, form labels, import source titles, negotiator phases, empty states, blast radius warnings.

#### 1.4 Overview / Executions
**Files**: `OverviewPage.tsx`, `DashboardHome.tsx`, `DashboardWithSubtabs.tsx`, `ExecutionsWithSubtabs.tsx`, `KnowledgeHub.tsx`, `SystemHealthPanel.tsx`, `ExecutionMiniPlayer.tsx`, `GlobalExecutionList.tsx`, `MessageList.tsx`

Strings: tab labels, filter labels, empty states, execution status labels (Queued, Running, Completed, Failed, Cancelled), column headers.

#### 1.5 Templates & Adoption
**Files**: `TemplateCard.tsx`, `TemplateDetailModal.tsx`, `TemplatePreviewModal.tsx`, `ExploreView.tsx`, `AdoptionWizardModal.tsx`, all wizard step components.

Strings: section headers (Use Cases, Connectors, Triggers), adoption wizard step labels, readiness tier labels, trust badge labels, button labels (Adopt, Try It).

#### 1.6 Pipeline / Teams
**Files**: `TeamCanvas.tsx`, `TeamList.tsx`, `TeamConfigPanel.tsx`, `TeamDragPanel.tsx`, `PipelineTemplateGallery.tsx`

Strings: team management labels, empty states, role labels, canvas toolbar labels.

#### 1.7 Triggers / Events
**Files**: `TriggerRow.tsx`, `TriggerDetailDrawer.tsx`, `TriggerAddForm.tsx`, `EventsPage.tsx`

Strings: trigger type labels, validation messages, form field labels, status badges.

#### 1.8 Settings
**Files**: `SettingsPage.tsx`, `DraftSettingsTab.tsx`, `DataPortabilitySettings.tsx`

Strings: section headers, toggle labels, import/export labels, passphrase validation messages.

#### 1.9 Deployment / Cloud
**Files**: `CloudDeployPanel.tsx`, `CloudHistoryPanel.tsx`, `CloudSchedulesPanel.tsx`, `CloudStatusPanel.tsx`, `UnifiedDeploymentDashboard.tsx`, `GitLabPanel.tsx`, `GitLabAgentList.tsx`

Strings: connection status, deployment steps, schedule labels, GitLab integration labels.

#### 1.10 Design System
**Files**: `DesignPhasePanel.tsx`, `DesignWizard.tsx`, `DesignTab.tsx` and all `DesignPhase*.tsx` components.

Strings: compilation stage labels (from `personaCompiler.ts`), phase descriptions, design conversation prompts.

#### 1.11 Shared Components
**Files**: `ErrorBoundary.tsx`, `EmptyState.tsx`, `ErrorBanner.tsx`, `CommandPalette.tsx`, `ContentLayout.tsx`, `CliOutputPanel.tsx`, `BaseModal.tsx`, `FirstUseConsentModal.tsx`

Strings: error boundary recovery UI, empty state messages, modal titles, consent text, search placeholders.

#### 1.12 Onboarding
**Files**: `OnboardingOverlay.tsx`, `TourLauncher.tsx`, `OnboardingTemplateStep.tsx`

Strings: onboarding step descriptions, tour button labels, template selection prompts.

---

### Layer 2 — Validation & Form Messages

Create a centralized validation dictionary instead of inline strings:

```ts
// src/i18n/en.ts
validation: {
  required: "{field} is required",
  min_length: "{field} must be at least {min} characters",
  min_value: "{field} must be at least {min}",
  invalid_cron: "Invalid cron expression",
  invalid_separator: "Source filter contains an invalid separator sequence",
  passphrase_min: "Passphrase must be at least 8 characters",
  passphrase_prompt: "Please enter the passphrase used during export",
  at_least_one: "At least one {field} is required",
}
```

Each form component replaces its inline string with `t('validation.required', { field: t('triggers.cron') })`.

---

### Layer 3 — Toast & Notification Messages

Collect all transient user feedback messages:

```ts
toasts: {
  copied: "Copied to clipboard",
  duplicated: "Duplicated as \"{name}\"",
  memory_created: "Memory created successfully",
  fix_applied: "Applied fix: {label}",
  fix_failed: "Failed to apply fix: {error}",
  credential_saved: "Credential saved",
  persona_deleted: "Agent deleted",
}
```

---

### Layer 4 — Backend Error Messages (Rust)

The Rust backend (`src-tauri/src/error.rs`) returns error categories to the frontend. Two approaches:

**Approach A — Translate on the frontend (recommended)**

Backend returns structured error codes. Frontend maps them to localized strings.

```rust
// error.rs — return a machine-readable kind
#[derive(Serialize)]
pub struct AppError {
    pub kind: &'static str,   // "not_found", "validation", "auth", "rate_limited"
    pub detail: String,       // English detail for logs/Sentry only
}
```

```ts
// src/i18n/en.ts
errors: {
  not_found: "The requested resource was not found",
  validation: "Invalid input: {detail}",
  auth: "Authentication failed — check your credentials",
  rate_limited: "Too many requests — try again in a moment",
  network_offline: "No internet connection",
  database: "Database error — please restart the app",
  internal: "An unexpected error occurred",
  cloud: "Cloud service error: {detail}",
  gitlab: "GitLab error: {detail}",
}
```

The frontend error display layer (`ErrorBanner`, `ErrorBoundary`, toast handlers) calls `t('errors.' + error.kind, { detail: error.detail })` and shows the localized message. The raw English detail is sent to Sentry only.

**Approach B — Backend returns pre-localized strings**

Not recommended. It would require the Rust backend to know the user's language and carry translation dictionaries, adding complexity with no benefit since all error rendering happens in the frontend.

---

### Layer 5 — LLM / AI Interaction Language

Three sub-areas:

#### 5.1 System Prompts & Persona Compilation

The assembled prompt in `src-tauri/src/engine/prompt.rs` uses structural labels:

```
# Persona: {name}
## Description
## Identity
## Instructions
## Available Tools
```

These are **LLM-facing, not user-facing**. They should remain in English because:
- LLMs perform best with English structural markers.
- Persona-authored content (identity, instructions) is in the user's language of origin.
- Changing structural labels per locale would degrade LLM output quality.

**Decision**: Keep prompt scaffolding in English. No translation needed.

#### 5.2 Design Wizard Conversations

The design wizard (`DesignWizard.tsx`, `useDesignConversation.ts`) sends natural language questions to the user during persona creation. These are generated by the LLM, not hardcoded — so they automatically adapt to the conversation language.

Static UI labels around the wizard (step names, buttons, progress indicators) do need translation as part of Layer 1.

#### 5.3 Compilation Stage Labels

`src/lib/compiler/personaCompiler.ts` defines stages shown during design compilation:

```ts
{ label: 'Assembling prompt', description: 'Building the LLM prompt...' }
{ label: 'Generating with AI', description: 'Running Claude...' }
{ label: 'Parsing output', description: 'Extracting structured JSON...' }
{ label: 'Checking feasibility', description: 'Validating suggested tools...' }
{ label: 'Saving result', description: 'Writing the compiled design...' }
```

Move these to the translation dictionary under `design.stages.*`.

---

### Layer 6 — Template Catalog Metadata

70+ template JSON files in `scripts/templates/` contain English-only metadata: `name`, `description`, `category`, and `instruction`.

#### Approach: Sidecar translation files

Template payloads (structured_prompt, connectors, triggers) stay in English — they are LLM-facing operational content and would degrade if translated.

Only the **catalog-facing metadata** (what users see when browsing templates) gets translated:

```
scripts/templates/i18n/
  zh.json
  ar.json
  ...
```

Each file maps template slug to translated display fields:

```json
{
  "build-intelligence-use-case": {
    "name": "构建智能监控",
    "description": "监控 CircleCI 管道事件，分析失败的构建日志...",
    "instruction": "监控CI/CD管道并分析构建失败..."
  }
}
```

At build time (`scripts/generate-template-checksums.mjs`), inject a `translations` field into each template's compiled output. The gallery components read `template.translations[language]?.name ?? template.name`.

Templates without a translation for the current language fall back to English.

---

### Layer 7 — Date, Time & Number Formatting

#### 7.1 Dates and Times

Replace all raw `toLocaleDateString()` / `toLocaleTimeString()` calls with a locale-aware formatter:

```ts
// src/lib/utils/formatters.ts
import { useI18nStore } from '@/stores/i18nStore';

const LANG_TO_LOCALE: Record<Language, string> = {
  en: 'en-US', zh: 'zh-CN', ar: 'ar-SA', hi: 'hi-IN',
  ru: 'ru-RU', id: 'id-ID', es: 'es-ES', fr: 'fr-FR',
  bn: 'bn-BD', ja: 'ja-JP', vi: 'vi-VN', de: 'de-DE',
  ko: 'ko-KR', cs: 'cs-CZ',
};

export function formatDate(date: Date | string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const lang = useI18nStore.getState().language;
  const locale = LANG_TO_LOCALE[lang];
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
  }).format(d);
}

export function formatRelativeTime(date: Date | string): string {
  const lang = useI18nStore.getState().language;
  const locale = LANG_TO_LOCALE[lang];
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  if (diff < 60_000) return rtf.format(-Math.round(diff / 1000), 'second');
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), 'hour');
  return rtf.format(-Math.round(diff / 86_400_000), 'day');
}
```

#### 7.2 Numbers

Wrap numeric displays (execution counts, percentages, budgets) with `Intl.NumberFormat`:

```ts
export function formatNumber(n: number, style: 'decimal' | 'percent' | 'currency' = 'decimal'): string {
  const lang = useI18nStore.getState().language;
  const locale = LANG_TO_LOCALE[lang];
  return new Intl.NumberFormat(locale, { style }).format(n);
}
```

---

### Layer 8 — Pluralization

Languages have vastly different plural rules (English: 1/other, Russian: 1/few/many, Arabic: 0/1/2/few/many/other).

Use the `Intl.PluralRules` API:

```ts
function pluralize(lang: Language, count: number, forms: Record<string, string>): string {
  const rule = new Intl.PluralRules(LANG_TO_LOCALE[lang]).select(count);
  return (forms[rule] ?? forms.other ?? '').replace('{count}', String(count));
}
```

Translation keys use suffixes:

```ts
// en.ts
agents: {
  count_one: "{count} agent",
  count_other: "{count} agents",
}

// ru.ts
agents: {
  count_one: "{count} агент",
  count_few: "{count} агента",
  count_many: "{count} агентов",
  count_other: "{count} агентов",
}

// ar.ts
agents: {
  count_zero: "لا يوجد وكلاء",
  count_one: "وكيل واحد",
  count_two: "وكيلان",
  count_few: "{count} وكلاء",
  count_many: "{count} وكيلاً",
  count_other: "{count} وكيل",
}
```

The `t()` function detects `_one`/`_other`/etc. suffixes and auto-selects using `Intl.PluralRules`.

---

### Layer 9 — RTL Support

Arabic (`ar`) requires right-to-left layout. The existing `typography.css` has a `.typo-rtl` class but it is not applied automatically.

#### Implementation

In `applyLangAttributes()` (already in `i18nStore.ts`), set the `dir` attribute:

```ts
function applyLangAttributes(lang: Language) {
  const html = document.documentElement;
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);
  html.dir = lang === 'ar' ? 'rtl' : 'ltr';
  loadFontForLanguage(lang);
}
```

#### CSS adjustments

Add logical properties where physical direction is used:

```css
/* Replace margin-left/padding-left with logical equivalents */
.sidebar { padding-inline-start: 1rem; }

/* Flip icons that have directional meaning (arrows, chevrons) */
[dir="rtl"] .icon-directional { transform: scaleX(-1); }
```

Most Tailwind utilities already map to logical properties in v4. The main work is auditing components that use `left`, `right`, `ml-*`, `mr-*`, `pl-*`, `pr-*` for layout-structural purposes (not decorative) and replacing them with `ms-*`, `me-*`, `ps-*`, `pe-*`.

---

## Implementation Order

### Phase 1 — Infrastructure & Shared Strings
1. Create `src/i18n/index.ts` with `useTranslation()` hook, `t()` function, lazy loader, pluralization.
2. Expand `src/i18n/en.ts` with all `common.*`, `sidebar.*`, `errors.*`, `validation.*`, `toasts.*` keys.
3. Generate `src/i18n/types.ts` from the English file shape.
4. Migrate `src/features/home/i18n/` keys into the root dictionary under `home.*`.
5. Wire `applyLangAttributes()` to set `dir` for RTL.

### Phase 2 — High-Traffic Pages
6. Sidebar (`Sidebar.tsx`) — navigation labels, section badges.
7. Agent overview (`PersonaOverviewPage.tsx`) — status badges, empty states, section headers.
8. Error boundary (`ErrorBoundary.tsx`) — recovery UI strings.
9. Empty states (`EmptyState.tsx`) — all empty state messages.

### Phase 3 — Feature Pages
10. Vault / Credentials — all credential management UI.
11. Overview / Executions — dashboard, execution list, messages, memories.
12. Templates & Adoption — gallery, detail modal, wizard steps.
13. Triggers / Events — trigger forms, validation messages, status labels.
14. Settings — all settings sections.
15. Pipeline / Teams — team management, canvas labels.
16. Deployment / Cloud / GitLab — connection status, deployment labels.

### Phase 4 — Design & Compilation
17. Design wizard UI labels and compilation stage names.
18. Onboarding tour text.

### Phase 5 — Formatting & Polish
19. Replace all date/time formatting with `Intl.DateTimeFormat`.
20. Replace number formatting with `Intl.NumberFormat`.
21. Audit and fix RTL layout issues for Arabic.

### Phase 6 — Backend Errors
22. Refactor `AppError` to return structured `kind` codes.
23. Map error kinds to translation keys in frontend error display components.

### Phase 7 — Template Metadata
24. Create `scripts/templates/i18n/` sidecar translation files.
25. Update template build script to embed translations.
26. Update gallery components to read translated metadata.

### Phase 8 — Translation Production
27. Extract complete English dictionary as reference.
28. Commission translations for all 13 non-English languages.
29. Review translations with native speakers.
30. Ship incremental — each language can ship independently since English fallback is built in.

---

## Testing Strategy

- **Pseudo-locale**: Create a `pseudo` locale that wraps every string in `[[ ]]` markers. Run the app in pseudo mode — any unwrapped text is a missed hardcoded string.
- **Long string testing**: German and Russian produce ~30% longer text. Use a stretched pseudo-locale (`[[ Xxxxxxxxx ]]`) to catch layout overflow.
- **RTL snapshot tests**: Render key pages with `lang=ar` and compare layout snapshots.
- **Pluralization tests**: Unit test `t()` with count values 0, 1, 2, 5, 21 for each language to verify plural rule selection.
- **Fallback tests**: Confirm that a partially-translated language file renders English for missing keys without errors.

---

## File Inventory — Estimated String Counts

| Area | Files | Estimated Keys |
|------|-------|----------------|
| Common (buttons, status) | shared | ~40 |
| Sidebar | 1 | ~25 |
| Agents | ~12 | ~120 |
| Vault | ~14 | ~90 |
| Overview | ~10 | ~70 |
| Templates | ~15 | ~80 |
| Triggers | ~4 | ~40 |
| Settings | ~3 | ~30 |
| Pipeline / Teams | ~5 | ~35 |
| Deployment / Cloud | ~7 | ~50 |
| Design | ~10 | ~45 |
| Onboarding | ~3 | ~20 |
| Errors & Validation | shared | ~40 |
| Toasts | shared | ~25 |
| Template Metadata | 70+ templates | ~210 (3 fields each) |
| **Total** | | **~920 keys** |

---

## Constraints & Decisions

| Decision | Rationale |
|----------|-----------|
| English fallback for missing keys | Ship partial translations safely; no broken UI |
| Lazy-load non-English dictionaries | Keep main bundle small (~920 keys * 14 langs = large) |
| Translate on frontend, not backend | Backend is language-agnostic; all rendering is in React |
| Keep LLM prompt scaffolding in English | LLM performance degrades with translated structural markers |
| Template payloads stay in English | Operational LLM content; only catalog metadata is translated |
| Use `Intl` APIs for dates/numbers/plurals | Browser-native, no library dependency, correct per-locale rules |
| Persona content is NOT translated | User-created content retains its language of origin |
