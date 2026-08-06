// Mastermind → the deeper dev-tools layers. The canvas is the primary channel
// into per-project work; these helpers are its doors. Factory rides the
// pendingFactoryFocus deep link (FactoryShell consumes + clears it); Skills
// rides the app-wide active project + the plugins/dev-tools tab setters (the
// same route ContextMapPage's handoffs use).
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { FactoryL2Tab } from '@/stores/slices/system/uiSlice';

/** Open Factory focused on this project's L2 (Overview / Ship / Matrix /
 *  Observability) instead of the L1 wall. */
export function openFactory(projectId: string, l2Tab: FactoryL2Tab = 'overview'): void {
  const s = useSystemStore.getState();
  s.setPendingFactoryFocus({ projectId, l2Tab });
  s.setSidebarSection('teams');
  s.setTeamsTab('factory');
}

/** Open the Skills manager with this project as the app-wide active project. */
export function openSkillsManager(projectId: string): void {
  const s = useSystemStore.getState();
  // Fire-and-forget: the Skills page keys on activeProjectId and remounts when
  // the switch lands; navigating first would only flash the previous project.
  s.setActiveProject(projectId)
    .catch(silentCatch('mastermind openSkillsManager'))
    .finally(() => {
      const n = useSystemStore.getState();
      n.setSidebarSection('plugins');
      n.setPluginTab('dev-tools');
      n.setDevToolsTab('skills');
    });
}

/** Open the Run Desk (dev-runner queue) with this project active — the runner
 *  popover's row destination. Same fire-and-forget active-project switch as
 *  the Skills door: the Run Desk keys on activeProjectId. */
export function openRunDesk(projectId: string): void {
  const s = useSystemStore.getState();
  s.setActiveProject(projectId)
    .catch(silentCatch('mastermind openRunDesk'))
    .finally(() => {
      const n = useSystemStore.getState();
      n.setSidebarSection('plugins');
      n.setPluginTab('dev-tools');
      n.setDevToolsTab('task-runner');
    });
}
