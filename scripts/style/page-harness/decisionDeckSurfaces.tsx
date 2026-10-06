/**
 * The LIVE Decision Deck (decision-center wave 3, C1a) on the tape in
 * `decisionDeckTapes.mjs`: the global `DecisionDeckHost`, the real roster and
 * adapters, opened in `prepare` through the one door (`openDecisionDeck`).
 * Nothing here builds a card — every card is dealt from the tape.
 *
 *   decision-center/deck   --kit approval | backlog | incident | council |
 *                                report | html | chat   (default: approval)
 *
 * The page behind the deck is a quiet stand-in (the deck is a portal over
 * whatever surface opened it), kept so #main-content is not an empty mount.
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Kit = 'approval' | 'backlog' | 'incident' | 'council' | 'report' | 'html' | 'chat';

function kitOf(): Kit {
  const k = new URLSearchParams(window.location.search).get('kit');
  const all: Kit[] = ['approval', 'backlog', 'incident', 'council', 'report', 'html', 'chat'];
  return all.find((x) => x === k) ?? 'approval';
}

/**
 * New `monitor.dc_deck_*` English keys reach the catalog's split section files
 * only when the i18n pipeline re-splits (`split-locales`, run by the Director
 * with the translations). Until then the harness lays `en.json`'s monitor
 * section over the parsed core section, so a shot shows the words the next
 * split will ship rather than blanks. Harness-only; a no-op once split.
 */
async function overlayEnglishMonitor(): Promise<void> {
  const [{ getEnglishSection }, en] = await Promise.all([
    import('@/i18n/englishSections'),
    import('@/i18n/locales/en.json'),
  ]);
  const section = getEnglishSection('monitor');
  if (section && typeof section === 'object') Object.assign(section, (en.default as { monitor: object }).monitor);
}

async function prepareDeck(): Promise<void> {
  const [{ useAgentStore }, { usePipelineStore }, { openDecisionDeck }] = await Promise.all([
    import('@/stores/agentStore'),
    import('@/stores/pipelineStore'),
    import('@/features/decision-center/deck/deckStore'),
  ]);
  await overlayEnglishMonitor();
  try {
    await useAgentStore.getState().fetchPersonas();
    await usePipelineStore.getState().fetchTeams();
  } catch (err) {
    console.warn('[page-harness] decision-deck preload failed', err);
  }
  const kit = kitOf();
  switch (kit) {
    case 'approval': openDecisionDeck({ scope: { kind: 'chip', chip: 'gates' }, focusId: 'approval:ap-1' }); break;
    case 'backlog': openDecisionDeck({ scope: { kind: 'chip', chip: 'backlog' } }); break;
    case 'incident': openDecisionDeck({ scope: { kind: 'chip', chip: 'incidents' } }); break;
    case 'council': openDecisionDeck({ scope: { kind: 'chip', chip: 'council' } }); break;
    case 'report': openDecisionDeck({ scope: { kind: 'chip', chip: 'reports' }, focusId: 'report:rep-md' }); break;
    case 'html': openDecisionDeck({ scope: { kind: 'chip', chip: 'reports' }, focusId: 'report:rep-html' }); break;
    case 'chat': openDecisionDeck({ scope: { kind: 'chip', chip: 'chat' } }); break;
  }
}

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const DECISION_DECK_MODULES: Record<string, HarnessModule> = {
  'decision-center/deck': {
    load: async () => {
      const [{ default: DecisionDeckHost }, { useTranslation }] = await Promise.all([
        import('@/features/decision-center/deck/DecisionDeckHost'),
        import('@/i18n/useTranslation'),
      ]);
      function DeckPage() {
        const { t } = useTranslation();
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.monitor.title}</h1>
            <p className="typo-body text-foreground">{t.monitor.dc_hub_strip_aria}</p>
            <DecisionDeckHost />
          </div>
        );
      }
      return { default: DeckPage };
    },
    providers: keyboardProvider,
    prepare: prepareDeck,
  },
};
