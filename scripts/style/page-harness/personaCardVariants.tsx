/**
 * Persona cards in the bays, three variants over the REAL board (spark
 * mandate-lanes, WP11 phase A), on `personaCardVariantsTape.mjs`:
 *
 *   monitor/persona-cards        the whole Classic board (rail, CommandBar,
 *                                dock, every local bay and the tray)
 *   monitor/persona-cards/peer   the board scoped to Studio Desktop: the peer
 *                                bay with its agents' on/off switches
 *
 * `--query "variant=before|v1|v2|v3"`. `before` (or no variant) is the
 * production `PersonaLine`, untouched: since WP11 phase B that IS V1 "Tail",
 * ported (`entry-e/PersonaLine.tsx` + `PersonaTail.tsx`), so the board renders
 * the shipped card and `v1` here is the phase-A sketch it was ported from.
 * `&narrow=1` pins every bay column to the masonry's 250px floor (`.ae-bays`),
 * the narrowest column the board can draw, to prove the tail degrades by
 * priority there. A variant leaves `PersonaLine` mounted (its tooltip, click,
 * menu, keys, testids and selection outline stay real) and portals the variant
 * card INTO each `fleet-grid-square`, reading the props the line was rendered
 * with off its fiber; a scoped stylesheet hides the line's own face and fill.
 */
import { useEffect, useState, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import type { HarnessModule } from './registry';
import { Drive, prepareFleet, steps, type Step } from './monitorActivitySurfaces';
import { CARD_VARIANTS, type CardVariant } from './personaCardVariantsCards';
import type { LineProps } from './personaCardVariantsFacts';

const SQUARE = '[data-testid="fleet-grid-square"]';
const STUDIO = 'fixture-studio-7c1e9a04';

const CSS = `
[data-wp11] ${SQUARE} { background: none !important; border-color: transparent !important; box-shadow: none !important;
  padding: 0 !important; min-height: 0 !important; flex-shrink: 0 !important; overflow: visible !important; color: var(--foreground) !important; margin: 0 !important; border-radius: 0 !important; z-index: auto !important; }
[data-wp11] ${SQUARE}::after { content: none !important; }
[data-wp11] ${SQUARE} > :not([data-wp11-card]) { display: none !important; }
[data-wp11] ${SQUARE}.is-selected { outline-offset: -2px; }
/* Critical outranks needs-you: the same edge and wash, stronger, and a hairline ring. */
[data-wp11-card][data-kind="critical"].ae-line.is-lit { background-image: linear-gradient(90deg, color-mix(in srgb, var(--ae-tone) 28%, transparent), transparent 80%); box-shadow: inset 3px 0 0 var(--ae-tone); }
[data-wp11-card][data-kind="critical"].ae-win.is-lit { border-color: color-mix(in srgb, var(--ae-tone) 70%, transparent); }
`;

/**
 * The props React rendered `PersonaLine` with, read off the DOM node's fiber.
 * Invariant: the square is `PersonaLine`'s root div, so walking `return` from
 * it reaches the memo whose props carry `card` and `onSelect`; any other shape
 * returns null and that square keeps today's card.
 */
function lineProps(el: HTMLElement): LineProps | null {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  type Fiber = { memoizedProps?: Record<string, unknown>; return: Fiber | null };
  let fiber = key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
  for (let i = 0; fiber && i < 12; i += 1, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (props && 'card' in props && 'onSelect' in props) return props as unknown as LineProps;
  }
  return null;
}

/** Re-finds the squares twice a second and re-renders every card from its line's current props. */
function CardSwap({ Card }: { Card: ComponentType<LineProps> }) {
  const [hosts, setHosts] = useState<HTMLElement[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const found = Array.from(document.querySelectorAll<HTMLElement>(SQUARE));
      setHosts((prev) => (prev.length === found.length && prev.every((el, i) => el === found[i]) ? prev : found));
      setTick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, []);
  return (
    <>
      {hosts.map((el, i) => {
        const props = lineProps(el);
        return props ? createPortal(<Card {...props} />, el, `${el.dataset.peerId ?? 'local'}:${el.dataset.personaId ?? i}`) : null;
      })}
    </>
  );
}

/** Five bay columns at exactly the masonry floor (250px each, 10px gaps). */
const NARROW_CSS = '.ae-bays { columns: 5 250px !important; width: 1290px !important; max-width: none !important; }';
const narrowOf = (): boolean => new URLSearchParams(window.location.search).get('narrow') === '1';

function variantOf(): CardVariant | null {
  const v = new URLSearchParams(window.location.search).get('variant');
  return v === 'v1' || v === 'v2' || v === 'v3' ? v : null;
}

async function prepareCards(mesh: boolean): Promise<void> {
  await prepareFleet();
  const [{ useOverviewStore }, { useAgentStore }] = await Promise.all([import('@/stores/overviewStore'), import('@/stores/agentStore')]);
  // Three live runs and one queued behind the first, as the PROCESS_ACTIVITY / QUEUE_STATUS events leave them.
  const now = Date.now();
  const proc = (personaId: string, minutes: number, status: 'running' | 'queued', n = 0) => ({
    domain: 'execution', runId: `run-${personaId}-${n}`, label: personaId, startedAt: now - minutes * 60_000,
    status, toolCallCount: 0, costUsd: 0, personaId,
  });
  // Under 25 min: `reapStaleRunning` reaps anything older (the engine caps a run at 20).
  const runs = [proc('p-board-10', 6, 'running'), proc('p-board-10', 0, 'queued', 1), proc('p-board-25', 13, 'running'), proc('p-board-15', 2, 'running')];
  useOverviewStore.setState({ activeProcesses: Object.fromEntries(runs.map((r) => [`execution:${r.runId}`, r])), activeProcessCount: runs.length });
  await Promise.all([
    useOverviewStore.getState().fetchCronAgents(),
    useAgentStore.getState().fetchPersonaSummaries(),
  ]).catch((err) => console.warn('[page-harness] persona-cards reads failed', err));
  if (mesh) {
    const { seedMeshFixture } = await import('@/stores/slices/network/meshFixture');
    seedMeshFixture({ sessionIds: ['s-run-1', 's-run-2', 's-run-3'], personaIds: ['p-board-10', 'p-board-25'] });
  }
}

function cards(extra: Step[], mesh: boolean): HarnessModule {
  const plan = [...steps('classic'), ...extra];
  return {
    load: async () => {
      const { PersonaMonitor } = await import('@/features/fleet/monitor/PersonaMonitor');
      return {
        default: function PersonaCardsHost() {
          const variant = variantOf();
          const Card = variant ? CARD_VARIANTS[variant] : null;
          return (
            <div data-wp11={variant ?? undefined} className="contents">
              {Card && <style>{CSS}</style>}
              {narrowOf() && <style>{NARROW_CSS}</style>}
              <Drive steps={plan}><PersonaMonitor onClose={() => undefined} /></Drive>
              {Card && <CardSwap Card={Card} />}
            </div>
          );
        },
      };
    },
    prepare: () => prepareCards(mesh),
  };
}

export const PERSONA_CARD_MODULES: Record<string, HarnessModule> = {
  'monitor/persona-cards': cards([], false),
  'monitor/persona-cards/peer': cards([{ selector: `[data-testid="mesh-plate"][data-peer-id="${STUDIO}"]` }], true),
};
