import type { CompanionsPage } from '@/features/companions/types';
import type { OverviewTab, PluginTab, EventBusTab } from '@/lib/types/types';
import type { RoutableSection } from '@/features/personas/sectionRouter';
import type { Translations } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';

type LearningStrings = Translations['home']['learning'];
type LearningKey = keyof LearningStrings;

/**
 * Where a power move's "Try it" lands the user.
 *
 * `section` is deliberately `RoutableSection`, NOT `SidebarSection`: the wider
 * type admits `'schedules'`, which is overlay-only and has no entry in
 * `SECTION_ROUTES`. Routing there set the sidebar to a section the content
 * router cannot render, so the user landed on the All Agents fallback while the
 * spotlight polled 4s for an anchor that never mounted. Overlay-summoned
 * surfaces belong in the `overlay` arm.
 */
export type PowerMoveNav =
  | { overlay: 'monitor' | 'schedules' }
  | {
      section: RoutableSection;
      overviewTab?: OverviewTab;
      eventBusTab?: EventBusTab;
      pluginTab?: PluginTab;
      /** A destination inside the Companions section (landing, or `<companion>:<page>`). */
      companionsPage?: CompanionsPage;
    };

export type PowerMoveGroupKey = 'save_time' | 'prevent_failures' | 'level_up' | 'orchestrate';

export interface PowerMove {
  id: string;
  group: PowerMoveGroupKey;
  titleKey: LearningKey;
  nav: PowerMoveNav;
  /** data-testid to flash after landing — must be a stable route-level anchor. */
  spotlightTestId?: string;
  /**
   * Optional honest-completion probe: returns true when the user's real data
   * shows they've actually used the feature (e.g. an event_listener trigger
   * exists). Moves without one fall back to "tried" (clicked Try it).
   * Keep probes to a single cheap IPC call — they run on Learning-hub mount.
   */
  detect?: () => Promise<boolean>;
}

export const POWER_MOVES: PowerMove[] = [
  // -- Save time ---------------------------------------------------------
  {
    id: 'monitor-triage',
    group: 'save_time',
    titleKey: 'pm_monitor_triage_title',
    nav: { overlay: 'monitor' },
  },
  {
    id: 'schedule-delay',
    group: 'save_time',
    titleKey: 'pm_schedule_delay_title',
    // Schedules is a title-bar overlay, not a rail section — see PowerMoveNav.
    nav: { overlay: 'schedules' },
    spotlightTestId: 'schedules-page',
  },
  {
    id: 'bulk-rerun',
    group: 'save_time',
    titleKey: 'pm_bulk_rerun_title',
    nav: { section: 'overview', overviewTab: 'executions' },
    spotlightTestId: 'overview-page',
  },
  // -- Prevent failures ----------------------------------------------------
  {
    id: 'dead-letter',
    group: 'prevent_failures',
    titleKey: 'pm_dead_letter_title',
    nav: { section: 'events', eventBusTab: 'dead-letter' },
    spotlightTestId: 'triggers-page',
  },
  {
    id: 'annotate-golden',
    group: 'prevent_failures',
    titleKey: 'pm_annotate_golden_title',
    nav: { section: 'overview', overviewTab: 'executions' },
    spotlightTestId: 'overview-page',
  },
  {
    id: 'credential-health',
    group: 'prevent_failures',
    titleKey: 'pm_credential_health_title',
    nav: { section: 'credentials' },
    spotlightTestId: 'credential-manager',
  },
  // -- Level up agents -----------------------------------------------------
  {
    id: 'lab-measure',
    group: 'level_up',
    titleKey: 'pm_lab_measure_title',
    nav: { section: 'personas' },
  },
  {
    id: 'prompt-rollback',
    group: 'level_up',
    titleKey: 'pm_prompt_rollback_title',
    nav: { section: 'personas' },
  },
  {
    id: 'director-coaching',
    group: 'level_up',
    titleKey: 'pm_director_coaching_title',
    // Overseer's reviews page left Overview on 2026-09-22. The spotlight now
    // rings the rail row the move lands on, which is the anchor that is always
    // mounted once the section is open.
    nav: { section: 'companions', companionsPage: 'overseer:reviews' },
    spotlightTestId: 'companions-nav-overseer-reviews',
  },
  // -- Orchestrate ---------------------------------------------------------
  {
    id: 'event-chain',
    group: 'orchestrate',
    titleKey: 'pm_event_chain_title',
    nav: { section: 'events', eventBusTab: 'studio' },
    spotlightTestId: 'triggers-page',
    detect: async () => {
      const triggers = await listAllTriggers();
      return triggers.some((t) => t.trigger_type === 'event_listener');
    },
  },
  {
    id: 'live-stream',
    group: 'orchestrate',
    titleKey: 'pm_live_stream_title',
    nav: { section: 'events', eventBusTab: 'live-stream' },
    spotlightTestId: 'triggers-page',
  },
  {
    id: 'athena-fleet',
    group: 'orchestrate',
    titleKey: 'pm_athena_fleet_title',
    nav: { section: 'companions', companionsPage: 'athena:setup' },
    spotlightTestId: 'companion-panel',
  },
];

export const POWER_MOVE_GROUPS: { key: PowerMoveGroupKey; labelKey: LearningKey }[] = [
  { key: 'save_time', labelKey: 'group_save_time' },
  { key: 'prevent_failures', labelKey: 'group_prevent_failures' },
  { key: 'level_up', labelKey: 'group_level_up' },
  { key: 'orchestrate', labelKey: 'group_orchestrate' },
];
