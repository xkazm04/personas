/**
 * The Breach card's head lines and mandate states (spark mandate-lanes WP5P)
 * in the LIVE Decision Deck, on the tape in `breachStatesTapes.mjs`: the
 * global `DecisionDeckHost` opened on the Breach lane through its one door,
 * focused on the item that carries the state. Nothing here builds a card.
 *
 *   decision-center/breach-states   --kit signed | unsigned | none | stop
 *                                   (default: signed)
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Kit = 'signed' | 'unsigned' | 'none' | 'stop';

const FOCUS: Record<Kit, string> = {
  signed: 'idea:idea-1',
  unsigned: 'idea:idea-2',
  none: 'incident:inc-2',
  stop: 'incident:inc-1',
};

function kitOf(): Kit {
  const k = new URLSearchParams(window.location.search).get('kit');
  return (Object.keys(FOCUS) as Kit[]).find((x) => x === k) ?? 'signed';
}

async function prepareBreach(): Promise<void> {
  const [{ useAgentStore }, { usePipelineStore }, { useSystemStore }, { openDecisionDeck }] = await Promise.all([
    import('@/stores/agentStore'),
    import('@/stores/pipelineStore'),
    import('@/stores/systemStore'),
    import('@/features/decision-center/deck/deckStore'),
  ]);
  try {
    await useAgentStore.getState().fetchPersonas();
    await usePipelineStore.getState().fetchTeams();
    await useSystemStore.getState().fetchProjects();
  } catch (err) {
    console.warn('[page-harness] breach-states preload failed', err);
  }
  openDecisionDeck({ scope: { kind: 'lane', lane: 'breach' }, focusId: FOCUS[kitOf()] });
}

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const BREACH_STATES_MODULES: Record<string, HarnessModule> = {
  'decision-center/breach-states': {
    load: async () => {
      const [{ default: DecisionDeckHost }, { useTranslation }] = await Promise.all([
        import('@/features/decision-center/deck/DecisionDeckHost'),
        import('@/i18n/useTranslation'),
      ]);
      function BreachPage() {
        const { t } = useTranslation();
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.monitor.title}</h1>
            <p className="typo-body text-foreground">{t.monitor.ml_setting_hint}</p>
            <DecisionDeckHost />
          </div>
        );
      }
      return { default: BreachPage };
    },
    providers: keyboardProvider,
    prepare: prepareBreach,
  },
};
