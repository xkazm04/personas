import type { Language } from '@/stores/i18nStore';
import { useSystemStore } from '@/stores/systemStore';
import type { SidebarSection } from '@/lib/types/types';
import type { TranslationSection } from './englishSections';

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
];

const ROUTE_SECTIONS: Record<SidebarSection, readonly TranslationSection[]> = {
  home: ['home', 'onboarding', 'system_health'],
  overview: ['overview', 'execution', 'execution_status', 'event_types', 'alerts', 'models'],
  personas: ['agents', 'matrix_v3', 'design', 'execution', 'models', 'templates'],
  events: ['triggers', 'event_types', 'alerts', 'schedules', 'shared'],
  credentials: ['vault', 'connector_roles', 'connector_licensing', 'auth'],
  'design-reviews': ['design', 'feedback_labels', 'templates', 'recipes', 'recipe_shared'],
  plugins: ['plugins', 'media_studio', 'research_lab', 'gitlab', 'pipeline'],
  schedules: ['schedules', 'triggers', 'event_types'],
  settings: ['settings', 'models', 'tiers', 'auth'],
};

export function sectionsForRoute(section: SidebarSection): readonly TranslationSection[] {
  return [...new Set([...BASE_SECTIONS, ...(ROUTE_SECTIONS[section] ?? [])])];
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
