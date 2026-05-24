/**
 * Goal-to-Plan — step → app destination mapping.
 *
 * Maps a plan step's category to the real in-app surface it would be carried
 * out on, so the "Opens in…" chip can navigate there (read-only — routing
 * only, no writes). Auto-navigating during the Watch walkthrough would
 * unmount the single-pane planner and kill the player, so navigation is
 * click-to-open and user-initiated.
 */
import type { SidebarSection } from '@/lib/types/types';
import type { PlanActionCategory } from './types';

export interface StepDestination {
  section: SidebarSection;
  /** Personas sub-tab to land on, when the destination is the agents area. */
  agentTab?: 'all' | 'planner';
}

/** The real surface a step's category would be configured on, or `null` for
 *  steps with no concrete destination (narrative / per-run action steps). */
export function stepDestination(category: PlanActionCategory): StepDestination | null {
  switch (category) {
    case 'persona':
      return { section: 'personas', agentTab: 'all' };
    case 'connector':
      return { section: 'credentials' };
    case 'trigger':
      return { section: 'events' };
    case 'schedule':
      return { section: 'schedules' };
    default:
      return null;
  }
}
