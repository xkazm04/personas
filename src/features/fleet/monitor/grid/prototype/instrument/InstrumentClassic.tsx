// InstrumentClassic — the project board as a field of instrument stacks. One
// CSS grid that fills the width it has (no measured row ladder), the tray of
// unplaced work under a mono rule, a calm ghost on the first cold read, and a
// worded empty state.

import { useCallback, type ReactNode } from 'react';
import { Users } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../../../monitorModel';
import { REMOTE_TILE_H, type ColumnRow } from '../../gridGeometry';
import { RemoteSessionTile } from '../../remote/RemoteSessionTile';
import type { ActivitySurface } from '../useActivitySurface';
import { InstrumentColumn } from './InstrumentColumn';
import { InstrumentPersonaCell } from './InstrumentPersonaCell';
import { InstrumentSessionCell } from './InstrumentSessionCell';
import { GhostCells } from './parts';

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] items-start gap-x-6 gap-y-7';

export function InstrumentClassic({
  surface, now, selectedPersonaId, onOpenRemote,
}: {
  surface: ActivitySurface;
  now: number;
  selectedPersonaId: string | null;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const { model, focusKey, bubbles, unseen, select, setTerminal, setRecap } = surface;

  const persona = useCallback((c: PersonaCardModel) => (
    <InstrumentPersonaCell
      card={c}
      now={now}
      selected={c.personaId === selectedPersonaId}
      flash={focusKey === `p:${c.personaId}`}
      bubble={bubbles.get(c.personaId) ?? null}
      unseenChat={unseen.get(c.personaId) ?? 0}
      onSelect={select}
    />
  ), [now, selectedPersonaId, focusKey, bubbles, unseen, select]);

  const session = useCallback((s: FleetSession, showProject = false) => (
    <InstrumentSessionCell
      session={s}
      now={now}
      showProject={showProject}
      flash={focusKey === `s:${s.id}`}
      onOpen={setTerminal}
      onRecap={setRecap}
    />
  ), [now, focusKey, setTerminal, setRecap]);

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    if (row.kind === 'persona') return persona(row.card);
    if (row.kind === 'session') return session(row.session);
    if (row.kind === 'remote') return <RemoteSessionTile view={row.view} width={232} height={REMOTE_TILE_H} onOpen={onOpenRemote} />;
    return (
      <span className="mt-2 mb-0.5 flex items-center gap-2 pl-3 typo-code text-foreground opacity-50" role="separator">
        {t.monitor.grid_sessions}
        <span aria-hidden className="h-px flex-1 bg-primary/10" />
      </span>
    );
  }, [persona, session, onOpenRemote, t.monitor.grid_sessions]);

  if (surface.cold && model.empty) {
    return (
      <div className={`${GRID} p-5`} aria-hidden>
        {Array.from({ length: 4 }, (_, i) => <GhostCells key={i} count={3} />)}
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
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 pt-4" aria-label={t.monitor.grid_board_aria}>
      <div className={GRID}>
        {model.columns.map((column) => (
          <InstrumentColumn
            key={column.teamId}
            column={column}
            scoped={surface.scope?.teamId === column.teamId}
            onToggleScope={surface.toggleScope}
            renderRow={renderRow}
          />
        ))}
      </div>
      {trayCount > 0 && (
        <section className="mt-8">
          <span className="mb-2 flex items-center gap-2 typo-label uppercase tracking-wider text-foreground opacity-70">
            <Users className="h-3.5 w-3.5" aria-hidden />
            {t.monitor.grid_ungrouped}
            <span className="typo-code tabular-nums opacity-70">{String(trayCount).padStart(2, '0')}</span>
            <span aria-hidden className="h-px flex-1 bg-primary/10" />
          </span>
          <div className={GRID.replace('gap-y-7', 'gap-y-1')}>
            {model.ungrouped.map((c) => <div key={c.personaId}>{persona(c)}</div>)}
            {model.traySessions.map((s) => <div key={s.id}>{session(s, true)}</div>)}
          </div>
        </section>
      )}
    </div>
  );
}
