/**
 * The mandate-lane card shapes (spark mandate-lanes, WP5) in the LIVE Decision
 * Deck, on the tape in `mandateCardsTapes.mjs`: the global `DecisionDeckHost`,
 * the real roster, adapters and lanes join, opened on one lane in `prepare`
 * through the one door (`openDecisionDeck`). Nothing here builds a card.
 *
 *   decision-center/mandate-cards   --kit sign | breach | stop | valve | claim |
 *                                         council | talk   (default: sign)
 *
 * Armed and edit states are shot with the shooter's own `--steps` (e.g.
 * `--steps "press=a"` on the valve, `click=[data-testid=sign-merge-gate-green];press=a`
 * on the Sign card), so the variant ids stay one per shape.
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Kit = 'sign' | 'breach' | 'stop' | 'valve' | 'claim' | 'council' | 'talk';

const KITS: Record<Kit, { lane: 'breach' | 'sign' | 'accept' | 'talk'; focusId?: string }> = {
  sign: { lane: 'sign', focusId: 'mandate:ch-research' },
  breach: { lane: 'breach', focusId: 'idea:idea-1' },
  stop: { lane: 'breach', focusId: 'incident:inc-1' },
  valve: { lane: 'breach', focusId: 'approval:ap-1' },
  claim: { lane: 'accept', focusId: 'goal:goal-1' },
  council: { lane: 'accept', focusId: 'council:cs-1' },
  talk: { lane: 'talk' },
};

function kitOf(): Kit {
  const k = new URLSearchParams(window.location.search).get('kit');
  return (Object.keys(KITS) as Kit[]).find((x) => x === k) ?? 'sign';
}

async function prepareCards(): Promise<void> {
  const [{ useAgentStore }, { usePipelineStore }, { openDecisionDeck }] = await Promise.all([
    import('@/stores/agentStore'),
    import('@/stores/pipelineStore'),
    import('@/features/decision-center/deck/deckStore'),
  ]);
  try {
    await useAgentStore.getState().fetchPersonas();
    await usePipelineStore.getState().fetchTeams();
  } catch (err) {
    console.warn('[page-harness] mandate-cards preload failed', err);
  }
  const { lane, focusId } = KITS[kitOf()];
  openDecisionDeck({ scope: { kind: 'lane', lane }, focusId });
}

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const MANDATE_CARDS_MODULES: Record<string, HarnessModule> = {
  'decision-center/mandate-cards': {
    load: async () => {
      const [{ default: DecisionDeckHost }, { useTranslation }] = await Promise.all([
        import('@/features/decision-center/deck/DecisionDeckHost'),
        import('@/i18n/useTranslation'),
      ]);
      function CardsPage() {
        const { t } = useTranslation();
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.monitor.title}</h1>
            <p className="typo-body text-foreground">{t.monitor.ml_setting_hint}</p>
            <DecisionDeckHost />
          </div>
        );
      }
      return { default: CardsPage };
    },
    providers: keyboardProvider,
    prepare: prepareCards,
  },
};
