/**
 * WP12 Phase B: the PORTED Conversations tab (the owner's V1) in the real
 * Monitor, on the variants tape plus what the port reads that the old tab
 * did not: ONE fleet-wide pending-review read (`conversationPortTape.mjs`)
 * and a held build question, seeded into the agent store here, so the Needs
 * you rail carries the four-ask queue the variants showed (three reviews and
 * one question).
 *
 *   monitor/conversations/port         the tab as it ships, Needs you in hand
 *   monitor/conversations/port/drive   Drive pressed on the converging deliberation
 */
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, type Step } from './monitorActivitySurfaces';

const OPEN: Step[] = [{ selector: '[data-testid="monitor-view-conversations"]' }];
const DRIVE: Step[] = [...OPEN, { selector: '[data-testid="conv-drive"]' }];

async function prepare(): Promise<void> {
  await prepareFleet();
  const { useAgentStore } = await import('@/stores/agentStore');
  const question = {
    cellKey: 'audience',
    question: 'Which readers is the 1.1 launch post for?',
    options: ['Operators', 'Developers', 'Both, operators first'],
  };
  useAgentStore.setState((s) => ({
    buildSessions: {
      ...s.buildSessions,
      // A harness fixture: only the fields usePendingInteractions reads are set, so the
      // session is asserted past the rest of BuildSessionState.
      'bs-wp12': { sessionId: 'bs-wp12', personaId: 'p-board-3', phase: 'awaiting_input', pendingQuestions: [question] } as unknown as (typeof s.buildSessions)[string],
    },
  }));
}

function port(steps: Step[]): HarnessModule {
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return { default: () => <Drive steps={steps}><PersonaMonitor onClose={() => undefined} /></Drive> };
    },
    prepare,
  };
}

export const CONVERSATION_PORT_MODULES: Record<string, HarnessModule> = {
  'monitor/conversations/port': port(OPEN),
  'monitor/conversations/port/drive': port(DRIVE),
};
