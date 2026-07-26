// Navigate to the surface an ActiveProcess points at.
//
// Extracted from MonitorDrawer so the Monitor is not the only place that can
// act on a process's `navigateTo`: Mastermind's island persona list routes
// through the SAME switch, which keeps "click a running persona" landing on one
// destination no matter which surface the click came from. Kept out of
// monitorModel.ts because that module is deliberately store-free.
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import type { DevToolsTab, PluginTab, SidebarSection, TeamsTab } from '@/lib/types/types';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';

/** Navigate to the surface a process points at, then run `dismiss` (close the
 *  Monitor drawer, the island popover, …). No-op when the process declares no
 *  destination — callers should gate their affordance on `navigateTo` too. */
export function navigateToProcess(proc: ActiveProcess, dismiss: () => void) {
  if (!proc.navigateTo) return;
  const { section, tab, personaId, chatSessionId } = proc.navigateTo;
  const system = useSystemStore.getState();
  system.setSidebarSection(section as SidebarSection);
  if (tab) {
    if (section === 'personas') {
      system.setEditorTab(tab as Parameters<typeof system.setEditorTab>[0]);
    } else if (section === 'plugins') {
      system.setPluginTab('dev-tools' as PluginTab);
      system.setDevToolsTab(tab as DevToolsTab);
    } else if (section === 'teams') {
      system.setTeamsTab(tab as TeamsTab);
    } else {
      system.setTemplateTab(tab as 'n8n' | 'generated');
    }
  }
  if (personaId) {
    useAgentStore.getState().selectPersona(personaId);
    if (chatSessionId && tab === 'chat') {
      void useAgentStore.getState().restoreChatSession(personaId, chatSessionId);
    }
  }
  dismiss();
}
