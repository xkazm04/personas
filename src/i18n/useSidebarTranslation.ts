import { useMemo } from 'react';
import { useTranslation } from './useTranslation';

/**
 * Returns a lookup function that resolves a sidebar item ID to its translated label.
 * Falls back to the original English label if no translation key matches.
 *
 * Maps sidebarData IDs (e.g. 'live-stream', 'design-reviews') to
 * the flattened sidebar translation keys (e.g. 'live_stream', 'templates').
 */
export function useSidebarLabels() {
  const { t } = useTranslation();

  const labelMap = useMemo(() => {
    const sb = t.sidebar;
    // Map: sidebarData item ID -> translated label.
    // Keys here match the `id` values in sidebarData.ts arrays.
    return new Map<string, string>([
      // Level 1 sections
      ['home', sb.home],
      ['overview', sb.overview],
      ['personas', sb.agents],
      ['events', sb.events],
      ['credentials', sb.keys],
      ['design-reviews', sb.templates],
      ['plugins', sb.plugins],
      ['settings', sb.settings],
      ['teams', sb.teams],
      ['cloud', sb.cloud],

      // Home sub-items
      ['welcome', sb.welcome],
      ['roadmap', sb.roadmap],
      ['system-check', sb.system_check],

      // Overview sub-items
      ['home-overview', sb.dashboard], // disambiguate from top-level 'home'
      ['executions', sb.executions],
      ['manual-review', sb.manual_review],
      ['messages', sb.messages],
      ['knowledge', sb.knowledge],
      ['sla', sb.sla],
      ['schedules', sb.schedules],
      ['health', sb.health],

      // Credential sub-items
      ['databases', sb.databases],
      ['from-template', sb.catalog],
      ['graph', sb.graph],
      ['add-new', sb.add_new],

      // Event bus sub-items
      ['live-stream', sb.live_stream],
      ['rate-limits', sb.throttling],
      ['test', sb.test],
      ['smee-relay', sb.local_relay],
      ['cloud-webhooks', sb.cloud_events],

      // Template sub-items
      ['n8n', sb.n8n_import],
      ['generated', sb.generated],

      // Cloud sub-items
      ['unified', sb.all_deployments],
      ['gitlab', sb.gitlab],

      // Settings sub-items
      ['account', sb.account],
      ['appearance', sb.appearance],
      ['notifications', sb.notifications],
      ['engine', sb.engine],
      ['byom', sb.byom],
      ['portability', sb.data],
      ['quality-gates', sb.quality_gates],
      ['config', sb.config_resolution],
      ['network', sb.network],
      ['admin', sb.admin],

      // Agent sub-items
      ['create', sb.create],
      ['all-agents', sb.all_agents],
      ['favorites', sb.favorites],
      ['recent', sb.recent],

      // Plugin sub-items
      ['browse', sb.browse],
      ['dev-tools', sb.dev_tools],
      ['active-project', sb.active_project],

      // Dev tools sub-items
      ['projects', sb.projects],
      ['context-map', sb.context_map],
      ['idea-scanner', sb.idea_scanner],
      ['idea-triage', sb.idea_triage],
      ['task-runner', sb.task_runner],
    ]);
  }, [t.sidebar]);

  /** Resolve translated label for a sidebar item ID. Falls back to the given default. */
  return (id: string, fallback?: string) => labelMap.get(id) ?? fallback ?? id;
}
