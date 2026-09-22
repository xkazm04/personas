// The galaxy layer: rail, field, HUD, and the four states that are not a
// galaxy (unpaired, loading, read failure, an unpainted corpus).
//
// The bench is WP8's. It mounts in the `bench` slot and RISES OVER the bottom
// of the field rather than pushing it up: the sky keeps its full height, the
// docked rail stays fully visible beside it, and the engine is told the
// drawer's height so the camera frames the focused set in the band that is
// left. Laying it out as a flex sibling instead would subtract the drawer
// twice - once from the canvas element and once inside `viewport()` - and the
// field above would be framed for a viewport that does not exist.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link2, TriangleAlert } from 'lucide-react';

import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

import { useCouncilStore } from '../councilStore';
import { GalaxyCanvas } from './GalaxyCanvas';
import { GalaxyHud } from './GalaxyHud';
import { GalaxyRail } from './GalaxyRail';
import { GalaxyGhost } from './GalaxyGhost';
import { CountsPanel } from './hud/CountsPanel';
import { IS_DEV } from './fixture';
import type { GalaxyEngine } from './engine/GalaxyEngine';
import { useHudReservations } from './useHudReservations';
import { useRegistryRoot } from './useRegistryRoot';

const LIST_ID = 'council-galaxy-list';

export function GalaxyStage({ bench }: { bench?: ReactNode }) {
  const { t } = useTranslation();
  const g = t.council.galaxy;
  const registryRoot = useRegistryRoot();
  const [engine, setEngineLocal] = useState<GalaxyEngine | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const countsRef = useRef<HTMLDivElement | null>(null);
  const hudCards = useMemo(() => [countsRef], []);

  const layout = useCouncilStore((s) => s.layout);
  const status = useCouncilStore((s) => s.galaxyStatus);
  const error = useCouncilStore((s) => s.galaxyError);
  const focus = useCouncilStore((s) => s.focus);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const benchOpen = useCouncilStore((s) => s.benchOpen);
  const load = useCouncilStore((s) => s.load);
  const loadFixture = useCouncilStore((s) => s.loadFixture);
  const setLens = useCouncilStore((s) => s.setLens);
  const publishEngine = useCouncilStore((s) => s.setEngine);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  useEffect(() => {
    if (fixtureOn) return;
    void load(registryRoot);
  }, [fixtureOn, load, registryRoot]);

  /* This stage OWNS the engine, and it is the only thing that publishes it.
     The bench mounts in an opaque slot below and cannot be handed a prop, so
     it reads the handle from the store - which is how `Esc` out of the bench
     can restore the reader's exact camera. Cleared on unmount so nothing
     holds a destroyed engine. */
  const setEngine = useCallback(
    (next: GalaxyEngine | null) => {
      setEngineLocal(next);
      publishEngine(next);
    },
    [publishEngine],
  );

  /* The counts card stands DOWN while the bench is up. It is opaque and sits
     at the top of the stage, so with a drawer over the bottom two thirds it
     becomes a clipped sliver that carries no information - and its content is
     already on screen twice over, in the bench header. Hiding it also gives
     the drawer the height it was occupying. */
  const hudVisible = !benchOpen;
  useHudReservations(stageRef, hudCards, engine, hudVisible);

  useAppKeyboard(
    useCallback(
      (e: KeyboardEvent) => {
        // Escape leaves the filter first and climbs a layer second, so the
        // reader is never stuck inside the field with the caret in a box.
        if (isTypingTarget(e.target)) {
          if (e.key !== 'Escape') return false;
          (e.target as HTMLElement | null)?.blur();
          return true;
        }
        if (e.key === '/') {
          e.preventDefault();
          filterRef.current?.focus();
          return true;
        }
        if (e.key === 'l' || e.key === 'L') {
          setLens(!useCouncilStore.getState().lensOn);
          return true;
        }
        if (e.key === '0') {
          engine?.fit();
          return true;
        }
        if (e.key === '+' || e.key === '=') {
          engine?.zoomBy(1.35);
          return true;
        }
        if (e.key === '-' || e.key === '_') {
          engine?.zoomBy(1 / 1.35);
          return true;
        }
        if (e.key === 'Escape') return engine?.climb() ?? false;
        return false;
      },
      [engine, setLens],
    ),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  if (!registryRoot && !fixtureOn) {
    return (
      <div className="flex h-full items-center justify-center" data-testid="council-unpaired">
        <EmptyState
          icon={Link2}
          title={g.unpaired_title}
          description={g.unpaired_description}
          action={{
            label: g.unpaired_action,
            onClick: () => {
              setSidebarSection('plugins');
              setDevToolsTab('workspaces');
            },
          }}
          secondaryAction={IS_DEV ? { label: g.fixture_action, onClick: () => void loadFixture() } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="council-galaxy-stage">
      <GalaxyHud engine={engine} />
      <div className="flex min-h-0 flex-1">
        <GalaxyRail engine={engine} filterRef={filterRef} describedById={LIST_ID} />
        <div ref={stageRef} className="relative min-w-0 flex-1 bg-background">
          {/* Chrome always renders; the ghost sits UNDER it and never replaces it. */}
          <GalaxyCanvas describedBy={LIST_ID} onEngine={setEngine} />
          {hudVisible ? <CountsPanel cardRef={countsRef} /> : null}
          {status === 'loading' && !layout ? <GalaxyGhost /> : null}
          {status === 'failed' ? (
            <div
              className="absolute inset-x-0 top-24 z-20 mx-auto max-w-lg rounded-card border border-status-error/40 bg-secondary/95 p-4 shadow-elevation-3 backdrop-blur-sm"
              data-testid="council-galaxy-error"
            >
              <div className="flex items-start gap-3">
                <TriangleAlert className="mt-0.5 h-5 w-5 flex-none text-status-error" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="typo-heading text-foreground">{g.error_title}</p>
                  <p className="mt-1 typo-caption text-muted">
                    {resolveErrorTranslated(t, error instanceof Error ? error.message : String(error ?? '')).message}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={() => void load(registryRoot)}>
                      {g.error_retry}
                    </Button>
                    {IS_DEV ? (
                      <Button size="sm" variant="ghost" onClick={() => void loadFixture()}>
                        {g.fixture_action}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
          {status === 'loaded' && layout && focus.kind === 'none' && layout.subjects.length === 0 ? (
            <div className="absolute inset-x-0 bottom-6 text-center typo-caption text-muted-dark">{g.corpus_empty}</div>
          ) : null}
          {bench}
        </div>
      </div>
    </div>
  );
}

export default GalaxyStage;
