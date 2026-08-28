/**
 * Which translation sections each route needs.
 *
 * This file is load-bearing for localization, not an optimization hint: a
 * section listed nowhere here is NEVER fetched in a non-English locale.
 * `getResolvedSection()` in useTranslation.ts returns the English section
 * synchronously when the locale chunk is not cached and deliberately does not
 * start a load from the getter (doing so caused a render storm), so an
 * undeclared section renders English forever, in every locale, with no signal.
 *
 * Enforced by `scripts/i18n/check-route-sections.mjs` and by
 * `__tests__/routeSectionCoverage.test.ts`: every section referenced from
 * source must appear below, and every section that appears nowhere in source
 * must be recorded as dead in the script's UNREFERENCED_SECTIONS registry.
 */
import type { Language } from '@/stores/i18nStore';
import { useSystemStore } from '@/stores/systemStore';
import type { SidebarSection } from '@/lib/types/types';
import type { TranslationSection } from './englishSections';

// Sections loaded on EVERY route. Reserved for app-shell chrome and for
// surfaces mounted at the App root — not a dumping ground for sections whose
// owning route is merely inconvenient to identify. Every entry costs one chunk
// fetch per locale on cold start, so justify additions inline.
const BASE_SECTIONS: readonly TranslationSection[] = [
  'common',
  'chrome',
  'sidebar',
  'errors',
  'error_registry',
  'empty_states',
  'status_tokens',
  'process_labels',
  'radio',
  // Persona Monitor is reachable from the always-mounted titlebar button.
  'monitor',
  // Rendered by App.tsx directly, before/above any route:
  //   consent          → FirstUseConsentModal (blocks first use, all routes)
  //   remote_approval  → RemoteApprovalPrompt (pairing prompt, all routes)
  'consent',
  'remote_approval',
  // `debt` is the auto-extracted hardcoded-string staging catalog read through
  // the debtText()/<DebtText/> channel (src/i18n/DebtText.tsx). 539 keys across
  // 113 files spanning agents, overview, plugins, templates, home, triggers,
  // vault, settings AND the always-mounted sidebar chrome
  // (shared/chrome/sidebar/sections/PluginsSidebarNav.tsx) — there is no route
  // it does not reach, so base is the honest mapping rather than a shortcut.
  // It is also the single most expensive entry here (~37KB per locale). The
  // right fix is to retire the section by folding its keys into the owning
  // feature sections; until then it must load, because before 2026-08-09 it
  // loaded on no route at all and rendered English everywhere.
  'debt',
];

const ROUTE_SECTIONS: Record<SidebarSection, readonly TranslationSection[]> = {
  // `releases` — the What's New / roadmap surface (home/sub_releases).
  // `cockpit` — inbox strings surfaced by home/sub_cockpit widgets.
  home: ['home', 'onboarding', 'system_health', 'releases', 'cockpit'],
  overview: ['overview', 'director', 'execution', 'execution_status', 'event_types', 'alerts', 'models'],
  // `ship` — the Factory L2 Ship tab (milestone convergence layer).
  // `mastermind` — the teams/sub_mastermind canvas.
  teams: ['plugins', 'pipeline', 'kpis', 'ship', 'mastermind'],
  // foundry: the Compose (Foundry) wizard was retired 2026-07-07; the section
  // is down to the composition x-ray badge on adopted templates, which renders
  // on this route. recipes_catalog: the recipe catalog's category labels,
  // reused by the persona surfaces.
  // deployment / deploy_errors — agents/sub_deployment (incl. the cloud panels
  //   and the deployTarget slice its health monitor reads).
  // agent_lab / eval_strategies — agents/sub_lab + sub_model_config compare.
  personas: [
    'agents', 'director', 'matrix_v3', 'design', 'execution', 'models', 'templates',
    'foundry', 'recipes_catalog', 'deployment', 'deploy_errors', 'agent_lab', 'eval_strategies',
  ],
  events: ['triggers', 'event_types', 'alerts', 'schedules', 'shared'],
  credentials: ['vault', 'connector_roles', 'connector_licensing', 'auth'],
  // `explore` — templates/sub_explore (the Atlas bento + domain drill-down),
  // mounted by templates/components/DesignReviewsPage.tsx.
  'design-reviews': ['design', 'feedback_labels', 'templates', 'recipes', 'recipe_shared', 'explore'],
  // `twin` — plugins/twin (629 keys; also feeds the plugins sidebar nav).
  // `project_overview` — plugins/dev-tools project overview + LLM monitoring.
  // `cockpit` — plugins/companion inbox helpers.
  plugins: ['plugins', 'media_studio', 'research_lab', 'gitlab', 'pipeline', 'twin', 'project_overview', 'cockpit'],
  // `studio` — the Athena web-build Studio surface. StudioAttention is mounted
  // app-wide (DEV-only) and reads this section too, but it only renders once a
  // Studio project is mid-build, i.e. after the Studio route has already
  // resolved the section — so base coverage would buy nothing and cost every
  // locale a cold-start chunk fetch for a surface production never mounts.
  studio: ['studio'],
  schedules: ['schedules', 'triggers', 'event_types'],
  settings: ['settings', 'models', 'tiers', 'auth', 'sharing'],
};

// Cache route-section results so every useTranslation() consumer sees a
// stable array reference per route. Without this, the fresh array literal
// invalidates downstream useMemo/useEffect dep arrays on every render,
// causing the same N sections to be re-evaluated by hundreds of components.
const ROUTE_SECTIONS_CACHE = new Map<SidebarSection, readonly TranslationSection[]>();

export function sectionsForRoute(section: SidebarSection): readonly TranslationSection[] {
  const cached = ROUTE_SECTIONS_CACHE.get(section);
  if (cached) return cached;
  const routeSections = ROUTE_SECTIONS[section];
  // Surface route-section drift instead of silently denying a route its
  // translations. The Record is exhaustive at compile time, but a stale/renamed
  // persisted `sidebarSection` value can miss the map at runtime — then only
  // BASE_SECTIONS load and the route renders untranslated. Warn loudly in dev.
  if (!routeSections && import.meta.env.DEV) {
    console.warn(
      `[i18n] No ROUTE_SECTIONS mapping for sidebar section "${section}" — only base translations will load. Add it to ROUTE_SECTIONS.`,
    );
  }
  const computed = Object.freeze([
    ...new Set([...BASE_SECTIONS, ...(routeSections ?? [])]),
  ]);
  ROUTE_SECTIONS_CACHE.set(section, computed);
  return computed;
}

export function useActiveI18nSections(): readonly TranslationSection[] {
  const sidebarSection = useSystemStore((s) => s.sidebarSection);
  return sectionsForRoute(sidebarSection);
}

export function preloadI18nForCurrentRoute(
  preload: (language: Language, sections: readonly TranslationSection[]) => void,
  language: Language,
): void {
  preload(language, sectionsForRoute(useSystemStore.getState().sidebarSection));
}
