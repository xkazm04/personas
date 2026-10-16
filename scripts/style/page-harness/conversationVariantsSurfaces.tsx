/**
 * WP12 Phase A (spark mandate-lanes): the Conversations tab restructured, three
 * variants in the REAL Monitor (its header, tabs, fleet strip and dispatch
 * dock), on the tape in `conversationVariantsTape.mjs`:
 *
 *   monitor/conversations/before     today's tab on the same tape
 *   monitor/conversations/v1         three plates kept, re-anatomised: a
 *                                    NEEDS YOU rail in the deck's anatomy
 *   monitor/conversations/v2         thread + inline asks + the fixed verdict
 *                                    dock above the composer, no right rail
 *   monitor/conversations/v3         briefing first: needs you, what happened,
 *                                    then the thread
 *   .../v1/drive, v2/drive, v3/drive each variant with Drive pressed on the
 *                                    converging deliberation
 *
 * Each module drives the real Conversations tab open, then mounts the variant
 * in its place (`MountOver`); the variants draw from the fixture
 * (`conversationVariantsData.ts`), which mirrors the tape.
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, type Step } from './monitorActivitySurfaces';
import { CONVERSATION_PORT_MODULES } from './conversationPortSurfaces';

const OPEN: Step[] = [{ selector: '[data-testid="monitor-view-conversations"]' }];

function conversations(variant?: (drive: boolean) => Promise<ReactNode>, drive = false): HarnessModule {
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      const { MountOver } = await import('./conversationVariantsFrame');
      const body = variant ? await variant(drive) : null;
      return {
        default: function ConversationVariantHost() {
          return (
            <>
              <Drive steps={OPEN}><PersonaMonitor onClose={() => undefined} /></Drive>
              {body && <MountOver>{body}</MountOver>}
            </>
          );
        },
      };
    },
    prepare: prepareFleet,
  };
}

const v1 = async (drive: boolean) => { const { VariantOne } = await import('./conversationVariantsV1'); return <VariantOne drive={drive} />; };
const v2 = async (drive: boolean) => { const { VariantTwo } = await import('./conversationVariantsV2'); return <VariantTwo drive={drive} />; };
const v3 = async (drive: boolean) => { const { VariantThree } = await import('./conversationVariantsV3'); return <VariantThree drive={drive} />; };

export const CONVERSATION_VARIANTS_MODULES: Record<string, HarnessModule> = {
  'monitor/conversations/before': conversations(),
  'monitor/conversations/v1': conversations(v1),
  'monitor/conversations/v2': conversations(v2),
  'monitor/conversations/v3': conversations(v3),
  'monitor/conversations/v1/drive': conversations(v1, true),
  'monitor/conversations/v2/drive': conversations(v2, true),
  'monitor/conversations/v3/drive': conversations(v3, true),
  // Phase B: the tab as it ships (conversationPortSurfaces.tsx).
  ...CONVERSATION_PORT_MODULES,
};
