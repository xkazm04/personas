/**
 * The lens-scan cards (spark one-control, WP3) in the LIVE Decision Deck, on the tape in
 * `lensCardsTapes.mjs`: the global `DecisionDeckHost`, the real lens source and adapters, opened on a
 * lane in `prepare` through the one door (`openDecisionDeck`). Nothing here builds a card.
 *
 *   decision-center/lens-cards   --kit build | evidence | release | release-sheet | bp-down | picker
 *                                (default: build)
 *
 * `picker` renders the Monitor's Blueprint destination (`BlueprintPicker`) instead of opening the deck.
 *
 * `release-sheet` and `bp-down` open the Release card's read-only composition over the deck
 * (`openLensSheet`). bp's base URL comes from the tape (`http://bp.harness.test`); this page answers
 * that host itself so the reachability probe is deterministic: up, or refused for `bp-down`.
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';

type Kit = 'build' | 'evidence' | 'release' | 'release-sheet' | 'bp-down' | 'picker';

const KITS: Record<Kit, { lane: 'breach' | 'accept'; focusId: string; sheet?: boolean; picker?: boolean }> = {
  build: { lane: 'breach', focusId: 'build:fixture-kettle' },
  evidence: { lane: 'accept', focusId: 'evidence:fixture-kettle' },
  release: { lane: 'accept', focusId: 'release:fixture-kettle' },
  'release-sheet': { lane: 'accept', focusId: 'release:fixture-kettle', sheet: true },
  'bp-down': { lane: 'accept', focusId: 'release:fixture-kettle', sheet: true },
  picker: { lane: 'breach', focusId: 'build:fixture-kettle', picker: true },
};

function kitOf(): Kit {
  const k = new URLSearchParams(window.location.search).get('kit');
  return (Object.keys(KITS) as Kit[]).find((x) => x === k) ?? 'build';
}

/** The harness answers bp's host itself: an opaque answer (up), or a refused connection (bp-down). */
function stubBp(kit: Kit): void {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('http://bp.harness.test')) {
      return kit === 'bp-down' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response(null));
    }
    return real(input, init);
  };
}

async function prepareLensCards(): Promise<void> {
  const [{ openDecisionDeck }, { openLensSheet }, { refreshLensScanProducts }] = await Promise.all([
    import('@/features/decision-center/deck/deckStore'),
    import('@/features/decision-center/lens/lensSheetStore'),
    import('@/features/decision-center/roster/lensScanSource'),
  ]);
  const kit = kitOf();
  stubBp(kit);
  await refreshLensScanProducts();
  const { lane, focusId, sheet, picker } = KITS[kit];
  if (picker) return;
  openDecisionDeck({ scope: { kind: 'lane', lane }, focusId });
  if (sheet) setTimeout(() => openLensSheet({ kind: 'release', projectId: 'fixture-kettle' }), 600);
}

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const LENS_CARDS_MODULES: Record<string, HarnessModule> = {
  'decision-center/lens-cards': {
    load: async () => {
      const [{ default: DecisionDeckHost }, { useTranslation }, { BlueprintPicker }] = await Promise.all([
        import('@/features/decision-center/deck/DecisionDeckHost'),
        import('@/i18n/useTranslation'),
        import('@/features/decision-center/lens/BlueprintPicker'),
      ]);
      function LensCardsPage() {
        const { t } = useTranslation();
        if (kitOf() === 'picker') {
          // The Monitor's geometry (fleet/monitor/shell/MonitorBody.tsx): a scroller, the list filling it.
          return (
            <div className="relative flex flex-1 min-h-0 flex-col">
              <div className="relative z-10 flex-1 min-h-0 overflow-y-auto">
                <div className="h-full">
                  <BlueprintPicker />
                </div>
              </div>
              <DecisionDeckHost />
            </div>
          );
        }
        return (
          <div className="flex flex-1 flex-col gap-3 p-8">
            <h1 className="typo-heading-lg text-foreground">{t.monitor.title}</h1>
            <p className="typo-body text-foreground">{t.decisionCenter.lens.open_effect}</p>
            <DecisionDeckHost />
          </div>
        );
      }
      return { default: LensCardsPage };
    },
    providers: keyboardProvider,
    prepare: prepareLensCards,
  },
};
