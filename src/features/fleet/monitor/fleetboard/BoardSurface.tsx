// BoardSurface — the Board's frame: the top strip, the field, the needs-you
// rail and the bottom strip. The field owns every pixel the strips do not;
// its size is measured, and the layout is a pure function of that size.

import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel, type ProcessEntry } from '../monitorModel';
import { useAttentionCursor } from '../grid/useAttentionCursor';
import { useUsageFeed } from '../grid/prototype/useUsageFeed';
import { attentionModel, buildBoard } from './boardModel';
import { useElementSize, type HourlyRuns } from './useBoardData';
import { TopStrip } from './TopStrip';
import { Field } from './Field';
import { NeedsRail } from './NeedsRail';
import { BottomStrip } from './BottomStrip';
import { BoardGhost } from './BoardGhost';
import './fleetboard.css';

export interface BoardSurfaceProps {
  cards: PersonaCardModel[];
  personas: Persona[];
  teams: PersonaTeam[];
  systemProcesses: ProcessEntry[];
  now: number;
  selectedPersonaId: string | null;
  onSelect: (personaId: string, section: DrawerSection) => void;
  isLoading: boolean;
  /** The test build's simulated fleet is on: usage reads its fixture plans. */
  simulating: boolean;
  hourly: HourlyRuns;
  /** A bay's nameplate was pressed (the team zoom, L1). */
  onZoomTeam: (teamId: string) => void;
}

export const BoardSurface = memo(function BoardSurface({
  cards, personas, teams, systemProcesses, now, selectedPersonaId, onSelect, isLoading, simulating, hourly, onZoomTeam,
}: BoardSurfaceProps) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const visible = useDocumentVisibility();
  const usage = useUsageFeed(simulating);
  const board = useMemo(() => buildBoard(cards, personas, teams), [cards, personas, teams]);

  const fieldRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(fieldRef);
  const [litId, setLitId] = useState<string | null>(null);
  const open = useCallback(
    (card: PersonaCardModel) => onSelect(card.personaId, primaryDrawerSection(card)),
    [onSelect],
  );

  // n / j / k walk the needs tiles in the field's reading order; Enter opens
  // the focused one on its primary section, exactly as on Activity.
  const cursorModel = useMemo(() => attentionModel(board.bays, cards), [board.bays, cards]);
  useAttentionCursor(cursorModel, cards, onSelect);

  const still = reduced || !visible;
  const fieldLabel = tx(t.monitor.board_field_aria, { count: cards.length, bays: board.bays.length });

  return (
    <div className={`fb-root${still ? ' is-still' : ''}`} data-testid="monitor-board">
      <TopStrip totals={board.totals} runsToday={board.runsToday} usage={usage} loading={isLoading} />
      <div ref={fieldRef} className="fb-field" role="group" aria-label={fieldLabel}>
        {isLoading ? (
          <BoardGhost width={size.w} height={size.h} />
        ) : cards.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={LayoutDashboard} title={t.monitor.board_empty_title} subtitle={t.monitor.board_empty_subtitle} />
          </div>
        ) : (
          <Field
            board={board}
            width={size.w}
            height={size.h}
            litId={litId}
            selectedPersonaId={selectedPersonaId}
            hourly={hourly}
            onOpen={open}
            onZoomTeam={onZoomTeam}
            onLight={setLitId}
          />
        )}
      </div>
      <NeedsRail queue={board.queue} litId={litId} loading={isLoading} onOpen={open} onLight={setLitId} />
      <BottomStrip processes={systemProcesses} now={now} working={board.totals.working} />
    </div>
  );
});
