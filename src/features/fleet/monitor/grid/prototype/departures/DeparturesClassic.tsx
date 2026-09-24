// Departures · DeparturesClassic — the fleet as a board of ruled sections.
// PROTOTYPE (variant C).
//
// Projects flow into as many ≥280px columns as the width allows (a responsive
// grid, rows aligned to the top), each one a DeparturesSection. The baseline's
// separate "Ungrouped" tray becomes the board's last section, in the same
// grammar, so nothing on the board is shaped differently from anything else.

import { useCallback, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../monitorModel';
import type { ColumnRow } from '../../gridGeometry';
import { REMOTE_TILE_H } from '../../gridGeometry';
import { RemoteSessionTile } from '../../remote/RemoteSessionTile';
import type { ActivitySurface } from '../useActivitySurface';
import { DeparturesSection, SessionsCaption } from './DeparturesSection';
import { PersonaLine } from './PersonaLine';
import { SessionLine } from './SessionLine';
import { GhostLines, RuledHeader } from './parts';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-x-6 gap-y-6';

export function DeparturesClassic({
  surface, selectedPersonaId, now, onOpenRemote,
}: {
  surface: ActivitySurface;
  selectedPersonaId: string | null;
  now: number;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const { model, focusKey, select, unseen, bubbles, setTerminal, setRecap } = surface;

  const persona = useCallback((c: PersonaCardModel): ReactNode => (
    <PersonaLine
      card={c}
      now={now}
      selected={c.personaId === selectedPersonaId}
      flash={focusKey === `p:${c.personaId}`}
      unseen={unseen.get(c.personaId) ?? 0}
      bubble={bubbles.get(c.personaId) ?? null}
      onSelect={select}
    />
  ), [now, selectedPersonaId, focusKey, unseen, bubbles, select]);

  const session = useCallback((s: FleetSession): ReactNode => (
    <SessionLine session={s} now={now} flash={focusKey === `s:${s.id}`} onOpen={setTerminal} onRecap={setRecap} />
  ), [now, focusKey, setTerminal, setRecap]);

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    if (row.kind === 'persona') return persona(row.card);
    if (row.kind === 'session') return session(row.session);
    if (row.kind === 'remote') {
      return <div className="px-2 py-1"><RemoteSessionTile view={row.view} width={260} height={REMOTE_TILE_H} onOpen={onOpenRemote} /></div>;
    }
    return <SessionsCaption />;
  }, [persona, session, onOpenRemote]);

  if (surface.cold && model.empty) {
    return (
      <div className={`${GRID} p-4`}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col">
            <div className="mb-1 h-6 border-b border-border/60" />
            <GhostLines rows={3 + (i % 3)} />
          </div>
        ))}
      </div>
    );
  }

  if (model.empty) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <EmptyIllustration
          icon={Users}
          heading={model.filtered ? t.monitor.grid_filter_empty : t.monitor.channels_combined_quiet}
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
          <DeparturesSection
            key={column.teamId}
            column={column}
            scoped={surface.scope?.teamId === column.teamId}
            onToggleScope={surface.toggleScope}
            renderRow={renderRow}
          />
        ))}
        {trayCount > 0 && (
          <section className="flex min-w-0 flex-col" data-testid="fleet-grid-tray">
            <RuledHeader label={t.monitor.grid_ungrouped} count={model.ungrouped.length} className="px-2 pt-1" />
            {model.ungrouped.map((c) => <div key={c.personaId}>{persona(c)}</div>)}
            {model.traySessions.length > 0 && <SessionsCaption />}
            {model.traySessions.map((s) => <div key={s.id}>{session(s)}</div>)}
          </section>
        )}
      </div>
    </div>
  );
}
