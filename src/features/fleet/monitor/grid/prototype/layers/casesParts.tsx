// The parts CASES is drawn from: the state strip, the project tile, and the
// tile grid that is layer 1's body.
//
// Split out of `ActivityCases` when ATLAS was cut and the surface became one
// variant rather than two — the shared-chrome file it used to sit beside stopped
// earning itself, and the shell was past the repo's component size directive.

import { memo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Button } from '@/features/shared/components/buttons';
import { Tiles, Tile, UnitStrip, type UnitSegment } from '@/features/shared/components/kit';
import { SQUARE_STATE_ORDER, SQUARE_VISUAL, type SquareState } from '../../fleetGridModel';
import type { ProjectUnit } from './useFleetLayers';

/** The board's four states on the kit's closed tone vocabulary. Idle is drawn
 *  hollow rather than tinted: a quiet agent is absence of work, not a state
 *  competing for the eye. */
const TONE_OF: Record<SquareState, UnitSegment['tone']> = {
  running: 'primary',
  attention: 'warning',
  failed: 'error',
  idle: 'neutral',
};

export function stateSegments(states: Record<SquareState, number>): UnitSegment[] {
  return SQUARE_STATE_ORDER
    .filter((s) => states[s] > 0)
    .map((s) => ({ n: states[s], tone: TONE_OF[s], glyph: s === 'idle' ? 'hollow' : 'solid' }));
}

/** The mark a project wears: the worst thing happening inside it. */
function markFor(unit: ProjectUnit, needs: string, clear: string) {
  return {
    tone: unit.states.failed > 0 ? 'error' as const
      : unit.needsYou > 0 ? 'warning' as const
      : unit.states.running > 0 ? 'primary' as const
      : 'neutral' as const,
    glyph: unit.states.running > 0 ? 'live' as const : 'solid' as const,
    label: unit.needsYou > 0 ? needs : clear,
  };
}

export const CaseTile = memo(function CaseTile({
  unit, onOpen, reducedMotion,
}: {
  unit: ProjectUnit;
  onOpen: (projectId: string) => void;
  reducedMotion: boolean;
}) {
  const { t, tx } = useTranslation();
  const press = useCallback(() => onOpen(unit.projectId), [onOpen, unit.projectId]);
  const segments = stateSegments(unit.states);

  return (
    <motion.div
      layoutId={reducedMotion ? undefined : `case:${unit.projectId}`}
      transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }}
      className="contents"
    >
      <Tile
        span={3}
        testId="cases-tile"
        onPress={press}
        title={unit.name}
        count={unit.needsYou > 0 ? <span className="text-status-warning"><Numeric value={unit.needsYou} /></span> : undefined}
        mark={markFor(unit, t.monitor.columns_needs_attention, t.monitor.columns_all_clear)}
        meta={
          <span className="flex items-center gap-2">
            <span>
              {tx(unit.personas === 1 ? t.monitor.layers_persona_count_one : t.monitor.layers_persona_count_other,
                { count: unit.personas })}
            </span>
            {unit.sessions > 0 && (
              <span>
                {tx(unit.sessions === 1 ? t.monitor.layers_session_count_one : t.monitor.layers_session_count_other,
                  { count: unit.sessions })}
              </span>
            )}
          </span>
        }
      >
        {segments.length > 0 && (
          <UnitStrip
            segments={segments}
            size="m"
            rows={2}
            label={tx(t.monitor.layers_open_aria, { project: unit.name })}
          />
        )}
      </Tile>
    </motion.div>
  );
});

/** Layer 1's body. The grid keeps a stable order (the model sorts once), so a
 *  project stays where the operator last found it. */
export function CaseGrid({
  units, onOpen, reducedMotion,
}: {
  units: readonly ProjectUnit[];
  onOpen: (projectId: string) => void;
  reducedMotion: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Tiles label={t.monitor.conv_projects}>
      {units.map((u) => (
        <CaseTile key={u.projectId} unit={u} onOpen={onOpen} reducedMotion={reducedMotion} />
      ))}
    </Tiles>
  );
}

/** The state key as count pills — the same four states, colours and filter
 *  behaviour the production header gives the board, so this surface never
 *  invents a second vocabulary for the same facts. */
export function FleetTally({
  totals, active, onPick,
}: {
  totals: Record<SquareState, number>;
  active: SquareState | null;
  onPick: (s: SquareState) => void;
}) {
  const { t, tx } = useTranslation();
  const labels: Record<SquareState, string> = {
    running: t.monitor.grid_state_running,
    attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed,
    idle: t.monitor.grid_state_idle,
  };
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5" data-testid="layers-tally">
      {SQUARE_STATE_ORDER.map((s) => (
        <Button
          key={s}
          variant="ghost"
          size="xs"
          onClick={() => onPick(s)}
          aria-pressed={active === s}
          aria-label={tx(t.monitor.grid_filter_state_aria, { state: labels[s] })}
          data-testid={`layers-tally-${s}`}
          className={`rounded-full border px-2 py-0.5 ${
            active === s ? 'border-primary/60 bg-primary/15' : 'border-border bg-secondary/20 hover:border-primary/30'
          }`}
        >
          <span className="flex items-center gap-1.5 typo-caption text-foreground">
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${SQUARE_VISUAL[s].accent} ${SQUARE_VISUAL[s].pulse ? 'animate-pulse' : ''}`} />
            <span>{labels[s]}</span>
            <span className="tabular-nums"><Numeric value={totals[s]} /></span>
          </span>
        </Button>
      ))}
    </div>
  );
}
