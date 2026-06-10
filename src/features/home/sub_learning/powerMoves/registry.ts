import {
  Activity, CalendarClock, Crown, FlaskConical, History, Inbox, Link, RotateCcw,
  Shield, Sparkles, Star, Zap,
} from 'lucide-react';
import type { SidebarSection, OverviewTab, PluginTab, EventBusTab } from '@/lib/types/types';
import type { Translations } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';

type LearningStrings = Translations['home']['learning'];
type LearningKey = keyof LearningStrings;

/** Where a power move's "Try it" lands the user. */
export type PowerMoveNav =
  | { overlay: 'monitor' }
  | {
      section: SidebarSection;
      overviewTab?: OverviewTab;
      eventBusTab?: EventBusTab;
      pluginTab?: PluginTab;
    };

export type PowerMoveGroupKey = 'save_time' | 'prevent_failures' | 'level_up' | 'orchestrate';

export interface PowerMove {
  id: string;
  icon: typeof Sparkles;
  color: string;
  group: PowerMoveGroupKey;
  titleKey: LearningKey;
  hookKey: LearningKey;
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
    icon: Activity,
    color: 'text-rose-400',
    group: 'save_time',
    titleKey: 'pm_monitor_triage_title',
    hookKey: 'pm_monitor_triage_hook',
    nav: { overlay: 'monitor' },
  },
  {
    id: 'schedule-delay',
    icon: CalendarClock,
    color: 'text-amber-400',
    group: 'save_time',
    titleKey: 'pm_schedule_delay_title',
    hookKey: 'pm_schedule_delay_hook',
    nav: { section: 'schedules' },
    spotlightTestId: 'schedules-page',
  },
  {
    id: 'bulk-rerun',
    icon: RotateCcw,
    color: 'text-cyan-400',
    group: 'save_time',
    titleKey: 'pm_bulk_rerun_title',
    hookKey: 'pm_bulk_rerun_hook',
    nav: { section: 'overview', overviewTab: 'executions' },
    spotlightTestId: 'overview-page',
  },
  // -- Prevent failures ----------------------------------------------------
  {
    id: 'dead-letter',
    icon: Inbox,
    color: 'text-orange-400',
    group: 'prevent_failures',
    titleKey: 'pm_dead_letter_title',
    hookKey: 'pm_dead_letter_hook',
    nav: { section: 'events', eventBusTab: 'dead-letter' },
    spotlightTestId: 'triggers-page',
  },
  {
    id: 'annotate-golden',
    icon: Star,
    color: 'text-yellow-400',
    group: 'prevent_failures',
    titleKey: 'pm_annotate_golden_title',
    hookKey: 'pm_annotate_golden_hook',
    nav: { section: 'overview', overviewTab: 'executions' },
    spotlightTestId: 'overview-page',
  },
  {
    id: 'credential-health',
    icon: Shield,
    color: 'text-emerald-400',
    group: 'prevent_failures',
    titleKey: 'pm_credential_health_title',
    hookKey: 'pm_credential_health_hook',
    nav: { section: 'credentials' },
    spotlightTestId: 'credential-manager',
  },
  // -- Level up agents -----------------------------------------------------
  {
    id: 'lab-measure',
    icon: FlaskConical,
    color: 'text-violet-400',
    group: 'level_up',
    titleKey: 'pm_lab_measure_title',
    hookKey: 'pm_lab_measure_hook',
    nav: { section: 'personas' },
  },
  {
    id: 'prompt-rollback',
    icon: History,
    color: 'text-blue-400',
    group: 'level_up',
    titleKey: 'pm_prompt_rollback_title',
    hookKey: 'pm_prompt_rollback_hook',
    nav: { section: 'personas' },
  },
  {
    id: 'director-coaching',
    icon: Crown,
    color: 'text-amber-400',
    group: 'level_up',
    titleKey: 'pm_director_coaching_title',
    hookKey: 'pm_director_coaching_hook',
    nav: { section: 'overview', overviewTab: 'director' },
    spotlightTestId: 'overview-page',
  },
  // -- Orchestrate ---------------------------------------------------------
  {
    id: 'event-chain',
    icon: Link,
    color: 'text-purple-400',
    group: 'orchestrate',
    titleKey: 'pm_event_chain_title',
    hookKey: 'pm_event_chain_hook',
    nav: { section: 'events', eventBusTab: 'builder' },
    spotlightTestId: 'triggers-page',
    detect: async () => {
      const triggers = await listAllTriggers();
      return triggers.some((t) => t.trigger_type === 'event_listener');
    },
  },
  {
    id: 'live-stream',
    icon: Zap,
    color: 'text-yellow-400',
    group: 'orchestrate',
    titleKey: 'pm_live_stream_title',
    hookKey: 'pm_live_stream_hook',
    nav: { section: 'events', eventBusTab: 'live-stream' },
    spotlightTestId: 'triggers-page',
  },
  {
    id: 'athena-fleet',
    icon: Sparkles,
    color: 'text-indigo-400',
    group: 'orchestrate',
    titleKey: 'pm_athena_fleet_title',
    hookKey: 'pm_athena_fleet_hook',
    nav: { section: 'plugins', pluginTab: 'companion' },
    spotlightTestId: 'companion-panel',
  },
];

export const POWER_MOVE_GROUPS: { key: PowerMoveGroupKey; labelKey: LearningKey; icon: typeof Sparkles; color: string }[] = [
  { key: 'save_time', labelKey: 'group_save_time', icon: Zap, color: 'text-amber-400' },
  { key: 'prevent_failures', labelKey: 'group_prevent_failures', icon: Shield, color: 'text-emerald-400' },
  { key: 'level_up', labelKey: 'group_level_up', icon: FlaskConical, color: 'text-violet-400' },
  { key: 'orchestrate', labelKey: 'group_orchestrate', icon: Link, color: 'text-blue-400' },
];
