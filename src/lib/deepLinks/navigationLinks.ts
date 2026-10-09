// Inbound navigation-only deep links: personas://persona/<id> and
// personas://execution/<id>. The desktop validates the id before emitting;
// any web page can open a personas:// link, so it is checked again here.
// These only navigate: nothing runs, cancels, creates or changes.

import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidDeepLinkId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

/** Open a persona in the builder. Returns false when nothing was opened. */
export async function openPersonaFromLink(personaId: unknown): Promise<boolean> {
  if (!isValidDeepLinkId(personaId)) return false;
  const has = () => useAgentStore.getState().personas.some((p) => p.id === personaId);
  if (!has()) {
    try {
      await useAgentStore.getState().fetchPersonas();
    } catch (err) {
      silentCatch('deepLinks:persona-refetch')(err);
    }
  }
  if (!has()) {
    useToastStore
      .getState()
      .addToast(getActiveTranslations().error_registry.not_found_message, 'error');
    return false;
  }
  useSystemStore.getState().setSidebarSection('personas');
  useAgentStore.getState().selectPersona(personaId);
  return true;
}

/** Hand an execution to the pending-focus latch; GlobalExecutionList resolves it. */
export function openExecutionFromLink(executionId: unknown): boolean {
  if (!isValidDeepLinkId(executionId)) return false;
  const overview = useOverviewStore.getState();
  overview.setPendingExecutionFocus(executionId);
  overview.setOverviewTab('executions');
  useSystemStore.getState().setSidebarSection('overview');
  return true;
}
