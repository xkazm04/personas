/**
 * The mandate-lanes WP6 surfaces, live, on the tapes in `mandateWp6Tapes.mjs`:
 *
 *   decision-center/mandate-wp6   --kit reread | sign | claim
 *        the lane deck on a re-read Sign card, the draft's Sign card (armed
 *        with `--steps "click=[data-testid=sign-merge-gate-green];press=a"`),
 *        and the Accept card with its met-when
 *   monitor/mandate-wp6/scopes    the real Monitor: register, a mandate page,
 *        its Scopes view (`--steps "click=[data-scope=merge];press=w"` arms a
 *        merge widen)
 *   monitor/mandate-wp6/orphans   the real Monitor: the mandate drawer's
 *        Orphanage (`--steps "press=x"` arms the archive)
 *
 * Nothing here builds a surface: the deck opens through `openDecisionDeck`,
 * the Monitor variants drive its real controls.
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, steps, type Step } from './monitorActivitySurfaces';

type Kit = 'reread' | 'sign' | 'claim';
const KITS: Record<Kit, { lane: 'sign' | 'accept'; focusId: string }> = {
  reread: { lane: 'sign', focusId: 'mandate-reread:ch-personas' },
  sign: { lane: 'sign', focusId: 'mandate:ch-research' },
  claim: { lane: 'accept', focusId: 'goal:goal-1' },
};

function kitOf(): Kit {
  const k = new URLSearchParams(window.location.search).get('kit');
  return (Object.keys(KITS) as Kit[]).find((x) => x === k) ?? 'reread';
}

async function prepareDeck(): Promise<void> {
  const [{ useAgentStore }, { usePipelineStore }, { openDecisionDeck }] = await Promise.all([
    import('@/stores/agentStore'),
    import('@/stores/pipelineStore'),
    import('@/features/decision-center/deck/deckStore'),
  ]);
  try {
    await useAgentStore.getState().fetchPersonas();
    await usePipelineStore.getState().fetchTeams();
  } catch (err) {
    console.warn('[page-harness] mandate-wp6 preload failed', err);
  }
  const { lane, focusId } = KITS[kitOf()];
  openDecisionDeck({ scope: { kind: 'lane', lane }, focusId });
}

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}


function monitor(extra: Step[]): HarnessModule {
  const plan = [...steps('classic'), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return { default: () => <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive> };
    },
    prepare: prepareFleet,
  };
}

const REGISTER: Step = { selector: '[data-testid="fleet-stewards-register"]' };

export const MANDATE_WP6_MODULES: Record<string, HarnessModule> = {
  'decision-center/mandate-wp6': {
    load: async () => {
      const [{ default: DecisionDeckHost }, { useTranslation }] = await Promise.all([
        import('@/features/decision-center/deck/DecisionDeckHost'),
        import('@/i18n/useTranslation'),
      ]);
      function Wp6Page() {
        const { t } = useTranslation();
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.monitor.title}</h1>
            <p className="typo-body text-foreground">{t.monitor.ml_setting_hint}</p>
            <DecisionDeckHost />
          </div>
        );
      }
      return { default: Wp6Page };
    },
    providers: keyboardProvider,
    prepare: prepareDeck,
  },
  'monitor/mandate-wp6/scopes': monitor([
    REGISTER,
    { selector: '[data-testid="mandate-register-row"] button' },
    { selector: '[data-testid="mandate-view-scopes"]' },
  ]),
  'monitor/mandate-wp6/orphans': monitor([REGISTER, { selector: '[data-testid="mandate-drawer-orphans"]' }]),
};
