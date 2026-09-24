// Atelier classic board — projects as soft cards on a responsive grid. The
// teamless personas and unplaceable sessions are one more card at the end of
// the grid ("Unassigned") rather than a strip docked under the board.

import { useCallback, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { REMOTE_TILE_H, type ColumnRow } from '../../gridGeometry';
import { RemoteSessionTile } from '../../remote/RemoteSessionTile';
import type { ActivitySurface } from '../useActivitySurface';
import { AtelierProjectCard } from './AtelierProjectCard';
import { PersonaRow } from './PersonaRow';
import { SessionChip } from './SessionChip';
import { GhostBlock, SURFACE } from './parts';

const GRID = 'grid items-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]';

export function AtelierClassic({
  surface, selectedPersonaId, now, onOpenRemote,
}: {
  surface: ActivitySurface;
  selectedPersonaId: string | null;
  now: number;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const { model, focusKey, bubbles, unseen, select, setTerminal, setRecap, reducedMotion } = surface;

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    switch (row.kind) {
      case 'persona':
        return (
          <PersonaRow
            card={row.card}
            selected={row.card.personaId === selectedPersonaId}
            flash={focusKey === `p:${row.card.personaId}`}
            bubble={bubbles.get(row.card.personaId) ?? null}
            unseenChat={unseen.get(row.card.personaId) ?? 0}
            now={now}
            onSelect={select}
          />
        );
      case 'session':
        return (
          <SessionChip
            session={row.session}
            now={now}
            flash={focusKey === `s:${row.session.id}`}
            reducedMotion={reducedMotion}
            onOpen={setTerminal}
            onRecap={setRecap}
          />
        );
      case 'remote':
        return <RemoteSessionTile view={row.view} width={236} height={REMOTE_TILE_H} onOpen={onOpenRemote} />;
      default:
        return null;
    }
  }, [selectedPersonaId, focusKey, bubbles, unseen, now, select, reducedMotion, setTerminal, setRecap, onOpenRemote]);

  if (surface.cold && model.empty) {
    return (
      <div className={`${GRID} p-4`} aria-hidden>
        {[180, 240, 150, 210, 170, 200].map((h, i) => <GhostBlock key={i} height={h} />)}
      </div>
    );
  }

  if (model.empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ScenarioEmptyState
          icon={Users}
          title={model.filtered ? t.monitor.grid_filter_empty : t.monitor.channels_combined_quiet}
          description=""
        />
      </div>
    );
  }

  const trayCount = model.ungrouped.length + model.traySessions.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-label={t.monitor.grid_board_aria}>
      <div className={GRID}>
        {model.columns.map((column) => (
          <AtelierProjectCard
            key={column.teamId}
            column={column}
            scoped={surface.scope?.teamId === column.teamId}
            onToggleScope={surface.toggleScope}
            renderRow={renderRow}
            reducedMotion={reducedMotion}
          />
        ))}
        {trayCount > 0 && (
          <section className={`flex min-w-0 flex-col gap-1 p-2 ${SURFACE} bg-foreground/[0.02]`} data-testid="fleet-grid-tray">
            <div className="flex items-center gap-2 px-2 py-1">
              <Users className="h-4 w-4 flex-shrink-0 text-foreground opacity-60" aria-hidden />
              <span className="min-w-0 flex-1 truncate typo-title text-foreground">{t.monitor.grid_ungrouped}</span>
              <span className="typo-caption tabular-nums text-foreground opacity-60">{trayCount}</span>
            </div>
            {model.ungrouped.map((card) => (
              <div key={card.personaId}>{renderRow({ kind: 'persona', key: card.personaId, height: 0, card, teamName: null })}</div>
            ))}
            {model.traySessions.map((s) => (
              <div key={s.id}>{renderRow({ kind: 'session', key: s.id, height: 0, session: s })}</div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
