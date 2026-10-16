/**
 * The Activity board's mandate lanes (spark mandate-lanes, WP4; the only
 * decision surface since the WP10 cutover), in the REAL Monitor shell, on the tapes in `mandateLanesTapes.mjs`:
 *
 *   monitor/mandate-lanes            Bays, with the lane buttons in the
 *                                    command bar, the Stewards plate in the
 *                                    supply column and the nameplate lamps
 *   monitor/mandate-lanes/register   the mandate register (M), opened from
 *                                    the Stewards plate
 *   monitor/mandate-lanes/page       a mandate page: act log first, envelope rail
 *   monitor/mandate-lanes/ticker     the dock's act ticker (WP7) after three
 *                                    router filings arrive on the act stream
 *   monitor/mandate-lanes/ticker/log the ticker pressed: the act log opened
 *                                    at the line's newest act
 *   monitor/mandate-lanes/deck       the Decision Deck over the real board,
 *                                    as the app mounts it (the global host),
 *                                    opened on a lane: `--query
 *                                    "lane=accept&focus=goal:g1&lang=de"`
 *                                    (lane, the card in hand, the reader's
 *                                    language; residue round, 2026-10-15)
 *   monitor/mandate-lanes/titlebar   the real title-bar dock in the frame's
 *                                    title-bar gutter, the Monitor opened from
 *                                    it as the app opens it, and the decision
 *                                    badge focused so its tooltip (the lanes
 *                                    it sums) shows over the board
 *   monitor/mandate-lanes/rail       the board with the act stream, in the
 *                                    language `--query "lang=de"` names
 *                                    (polish P2: the rail's plates and the
 *                                    resting dock; tape `railPolishTape.mjs`)
 *   monitor/mandate-lanes/dock       the same, the dispatch dock expanded
 *   monitor/mandate-lanes/usage-hover the same, the first plan row focused so
 *                                    its numbers last measured show
 *
 * Each variant drives the real controls (the Activity tab, the layout switch,
 * the plate's register button, a register row).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, steps, type Step } from './monitorActivitySurfaces';
import { TICKER_ACTS } from './mandateLanesTapes.mjs';

/**
 * Pushes the ticker's acts on `charter-act-recorded` once the board is up,
 * through the tape player's mocked event bus (the way the backend announces
 * an act). Harness-only: the app has no such clock.
 */
function ActStream({ children }: { children: ReactNode }) {
  useEffect(() => {
    let live = true;
    const at = window.setTimeout(() => {
      void import('@tauri-apps/api/event').then(async ({ emit }) => {
        for (const act of TICKER_ACTS) if (live) await emit('charter-act-recorded', act);
      });
    }, 2500);
    return () => { live = false; window.clearTimeout(at); };
  }, []);
  return <>{children}</>;
}

function lanes(extra: Step[] = [], stream = false): HarnessModule {
  const plan = [...steps('classic'), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function MandateLanesHost() {
          const monitor = <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>;
          return stream ? <ActStream>{monitor}</ActStream> : monitor;
        },
      };
    },
    prepare: prepareFleet,
  };
}

const REGISTER: Step = { selector: '[data-testid="fleet-stewards-register"]' };

type DeckLane = 'breach' | 'sign' | 'accept' | 'talk';
const DECK_LANES: readonly DeckLane[] = ['breach', 'sign', 'accept', 'talk'];

/** The board under the deck, then the reader's language and the lane deck the query names. */
async function prepareDeck(): Promise<void> {
  await prepareFleet();
  const q = new URLSearchParams(window.location.search);
  const lang = q.get('lang');
  if (lang) {
    const { switchLanguage } = await import('@/i18n/useTranslation');
    // The query is the shooter's own: an unknown code falls back to English inside the store.
    await switchLanguage(lang as Parameters<typeof switchLanguage>[0]);
  }
  const lane = DECK_LANES.find((l) => l === q.get('lane')) ?? 'sign';
  const { openDecisionDeck } = await import('@/features/decision-center/deck/deckStore');
  openDecisionDeck({ scope: { kind: 'lane', lane }, focusId: q.get('focus') ?? undefined });
}

/** The real board with the global deck host above it, as `App.tsx` mounts the two. */
const deck: HarnessModule = {
  load: async () => {
    const [{ PersonaMonitor }, { default: DecisionDeckHost }] = await Promise.all([
      import('@/features/fleet/monitor/PersonaMonitor'),
      import('@/features/decision-center/deck/DecisionDeckHost'),
    ]);
    const plan = steps('classic');
    return {
      default: function MandateDeckHost() {
        return (
          <>
            <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>
            <DecisionDeckHost />
          </>
        );
      },
    };
  },
  providers: async () => {
    const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
    return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
  },
  prepare: prepareDeck,
};

/** Focuses one control once the board settled (a tooltip shows on focus as on hover). */
function FocusLater({ selector, after }: { selector: string; after: number }) {
  useEffect(() => {
    const at = window.setTimeout(() => document.querySelector<HTMLElement>(selector)?.focus(), after);
    return () => window.clearTimeout(at);
  }, [selector, after]);
  return null;
}

/** The real title-bar dock, rendered where the frame draws the title bar; it mounts the Monitor itself. */
function TitleBarSlot({ children }: { children: ReactNode }) {
  const [gutter, setGutter] = useState<HTMLElement | null>(null);
  useEffect(() => { setGutter(document.querySelector<HTMLElement>('[data-harness="titlebar-gutter"]')); }, []);
  if (!gutter) return null;
  return createPortal(<div className="flex h-full w-full items-center justify-end pr-3">{children}</div>, gutter);
}

const titlebar: HarnessModule = {
  load: async () => {
    const { default: TitleBarDock } = await import('@/features/shared/chrome/TitleBarDock');
    const plan = steps('classic');
    return {
      default: function TitleBarHost() {
        return (
          <Drive steps={plan}>
            <TitleBarSlot><TitleBarDock /></TitleBarSlot>
            <FocusLater selector='[data-testid="titlebar-human-review"]' after={6000} />
          </Drive>
        );
      },
    };
  },
  providers: async () => {
    const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
    return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
  },
  prepare: async () => {
    await prepareFleet();
    // The badge's own door opens the Monitor (`TrayOverlays`): open it as the app does.
    const { useSystemStore } = await import('@/stores/systemStore');
    useSystemStore.getState().setHeaderOverlay('monitor');
  },
};

/**
 * The board with the act stream, and one control focused once it settled, so
 * its hover view shows as a keyboard user opens it (polish P2: a usage row's
 * numbers). Shot on `railPolishTape.mjs`.
 */
function focused(selector: string): HarnessModule {
  const base = lanes([], true);
  return {
    ...base,
    load: async () => {
      const { default: Host } = await base.load();
      return { default: function FocusedHost() { return <><Host /><FocusLater selector={selector} after={7000} /></>; } };
    },
  };
}

/** The module in the reader's language the query names (`--query "lang=de"`), as the deck's `prepareDeck` reads it. */
function inLang(base: HarnessModule): HarnessModule {
  return {
    ...base,
    prepare: async () => {
      await base.prepare?.();
      const lang = new URLSearchParams(window.location.search).get('lang');
      if (!lang) return;
      const { switchLanguage } = await import('@/i18n/useTranslation');
      await switchLanguage(lang as Parameters<typeof switchLanguage>[0]);
    },
  };
}

export const MANDATE_LANES_MODULES: Record<string, HarnessModule> = {
  'monitor/mandate-lanes/rail': inLang(lanes([], true)),
  'monitor/mandate-lanes/dock': inLang(lanes([{ selector: '[data-testid="quick-dispatch-dock-expand"]' }], true)),
  'monitor/mandate-lanes/usage-hover': inLang(focused('[data-testid="entry-e-plan"]')),
  'monitor/mandate-lanes': lanes(),
  'monitor/mandate-lanes/register': lanes([REGISTER]),
  'monitor/mandate-lanes/page': lanes([REGISTER, { selector: '[data-testid="mandate-register-row"] button' }]),
  'monitor/mandate-lanes/ticker': lanes([], true),
  'monitor/mandate-lanes/ticker/log': lanes([{ selector: '[data-testid="dock-act-ticker-open"]' }], true),
  'monitor/mandate-lanes/deck': deck,
  'monitor/mandate-lanes/titlebar': titlebar,
};
