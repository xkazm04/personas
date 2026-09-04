import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { CompanionCockpitSpecBody } from '@/api/companion';
import type { PersonaReport } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import { buildSummariseChatPrompt } from './chatSeed';

/**
 * "Play in chat": hand a report to the companion with a contextual cockpit
 * beside it, then get out of the way.
 *
 * Four steps, in order, because each depends on the last: compose the cockpit
 * spec, move the app to Home > Cockpit so the contextual view fills the page,
 * seed the companion with an auto-sending prompt, and finally close the modal
 * so chat + cockpit own the screen.
 */
export function openReportInChat(
  message: PersonaReport,
  linkedReviews: PersonaManualReview[],
  reportLabel: string,
): void {
  // 1. Compose the contextual cockpit spec that supplements the chat.
  const spec: CompanionCockpitSpecBody = {
    title: `Context: ${message.title || reportLabel}`,
    widgets: [
      {
        id: 'w-msg',
        kind: 'message_summary',
        span: 12,
        config: { messageId: message.id, snapshot: message },
      },
      {
        id: 'w-facts',
        kind: 'execution_facts',
        span: 6,
        config: { executionId: message.execution_id, personaId: message.persona_id },
      },
      {
        id: 'w-decisions',
        kind: 'linked_decisions',
        span: 6,
        config: { executionId: message.execution_id, personaId: message.persona_id },
      },
      {
        id: 'w-mem',
        kind: 'linked_memories',
        span: 12,
        config: { executionId: message.execution_id },
      },
    ],
  };
  useSystemStore.getState().setContextualCockpit({
    source: {
      kind: 'message',
      messageId: message.id,
      messageTitle: message.title ?? '',
    },
    spec,
  });

  // 2. Navigate to Home > Cockpit so the contextual view fills the page.
  useSystemStore.getState().setSidebarSection('home');
  useSystemStore.getState().setHomeTab('cockpit');

  // 3. Seed companion + auto-send + open the chat panel.
  useCompanionStore.getState().setPendingPrompt({
    text: buildSummariseChatPrompt(message, linkedReviews),
    autoSend: true,
  });
  useCompanionStore.getState().setState('open');
}
