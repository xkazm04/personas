// Classic: the room floor. Every project is a chassis, flowed as masonry so
// forty projects of uneven size pack without holes; the teamless modules and
// unplaceable sessions sit in one wide chassis at the end. While the first
// read is in flight the floor shows calm chassis outlines of the same shape.

import { useCallback, type ReactNode } from 'react';
import { Users, X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { SquareState } from '../../fleetGridModel';
import { useTranslation } from '@/i18n/useTranslation';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import type { ColumnRow } from '../../gridGeometry';
import { RemoteSessionTile } from '../../remote/RemoteSessionTile';
import type { ActivitySurface } from '../useActivitySurface';
import { Chassis, ShareBar } from './Chassis';
import { ModuleRow, MODULE_H } from './ModuleRow';
import { UnitRow, UNIT_H } from './UnitRow';
import { useRoom } from './rackModel';

const GHOST_ROWS = [3, 2, 4, 1, 3, 2, 2, 3];

export function ChassisGhosts() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-4" aria-hidden>
      <div className="ed-board">
        {GHOST_ROWS.map((n, i) => (
          <div key={i} className="ed-chassis rounded-card">
            <div className="flex items-center gap-2 px-3 pb-2 pt-3">
              <span className="ed-ghost h-3 w-28 rounded-full" />
            </div>
            <div className="ed-share" />
            {Array.from({ length: n }, (_, r) => (
              <div key={r} className="ed-row flex items-center gap-2.5 px-3" style={{ height: MODULE_H }}>
                <span className="ed-lamp" data-lamp="idle" />
                <span className="ed-ghost h-2.5 rounded-full" style={{ width: `${45 + ((i + r) % 3) * 15}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function FilterStrip({ state, onClear }: { state: SquareState; onClear: () => void }) {
  const { t, tx } = useTranslation();
  const label = { running: t.monitor.grid_state_running, attention: t.monitor.grid_state_attention,
    failed: t.monitor.grid_state_failed, idle: t.monitor.grid_state_idle }[state];
  return (
    <div className="ed-chassis mb-3.5 flex h-10 items-center gap-2.5 rounded-card px-3" style={{ marginBottom: 14 }} data-testid="entry-d-filter">
      <span aria-hidden data-lamp={state} className="ed-lamp" />
      <span className="flex-1 typo-body text-foreground">{tx(t.monitor.grid_filter_state_aria, { state: label })}</span>
      <Button variant="ghost" size="sm" onClick={onClear} icon={<X className="h-3.5 w-3.5" aria-hidden />}>
        {t.common.close}
      </Button>
    </div>
  );
}

export function ClassicBoard({ surface, selectedPersonaId, now, onOpenRemote }: {
  surface: ActivitySurface;
  selectedPersonaId: string | null;
  now: number;
  onOpenRemote?: (jobId: string) => void;
}) {
  const { t } = useTranslation();
  const { model, select, bubbles, unseen, scope, toggleScope, reducedMotion, stage } = surface;
  const { slotOf } = useRoom();
  const staged = stage >= 1;
  const motion = !reducedMotion;

  const renderRow = useCallback((row: ColumnRow): ReactNode => {
    switch (row.kind) {
      case 'persona':
        return (
          <ModuleRow
            key={row.key}
            card={row.card}
            selected={row.card.personaId === selectedPersonaId}
            onSelect={select}
            bubble={bubbles.get(row.card.personaId) ?? null}
            unseen={unseen.get(row.card.personaId) ?? 0}
            now={now}
          />
        );
      case 'session':
        return <UnitRow key={row.key} session={row.session} now={now} />;
      case 'remote':
        return (
          <div key={row.key} className="ed-row px-2 py-1">
            <RemoteSessionTile view={row.view} width={230} height={row.height - 4} onOpen={onOpenRemote} />
          </div>
        );
      default:
        return (
          <div key={row.key} className="flex items-center gap-2 px-3 pt-2" role="separator" aria-label={t.monitor.grid_sessions}>
            <span className="h-px flex-1 bg-primary/25" aria-hidden />
          </div>
        );
    }
  }, [selectedPersonaId, select, bubbles, unseen, now, onOpenRemote, t.monitor.grid_sessions]);

  if (surface.cold) return <ChassisGhosts />;

  if (model.empty) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <EmptyIllustration
          icon={Users}
          heading={model.filtered ? t.monitor.grid_filter_empty : t.monitor.channels_combined_quiet}
          description=""
        />
      </div>
    );
  }

  const trayCards = model.ungrouped;
  // Seated units first, in seat order, so the tray reads like the rack does.
  const seatOf = (id: string) => slotOf.get(id) ?? Number.MAX_SAFE_INTEGER;
  const traySessions = [...model.traySessions].sort((a, b) => seatOf(a.id) - seatOf(b.id));
  const trayLive = model.traySessions.filter((x) => slotOf.has(x.id)).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-label={t.monitor.grid_board_aria}>
      {surface.filter.state && <FilterStrip state={surface.filter.state} onClear={surface.clearFilter} />}
      <div className="ed-board">
        {model.columns.map((column, i) => (
          <Chassis
            key={column.teamId}
            column={column}
            scoped={scope?.teamId === column.teamId}
            onToggleScope={toggleScope}
            index={i}
            motion={motion && staged}
          >
            {staged ? column.rows.map(renderRow) : column.rows.map((r) => (
              <div key={r.key} className="ed-row" style={{ height: r.kind === 'session' ? UNIT_H : MODULE_H }} />
            ))}
          </Chassis>
        ))}
      </div>
      {(trayCards.length > 0 || traySessions.length > 0) && (
        <section className="ed-chassis rounded-card" data-testid="entry-d-tray">
          <div className="flex items-center gap-2 px-3 pb-2 pt-2.5">
            <Users className="h-3.5 w-3.5 text-foreground" aria-hidden />
            <span className="flex-1 typo-label text-foreground">{t.monitor.grid_ungrouped}</span>
            {trayLive > 0 && (
              <span className="inline-flex items-center gap-1 typo-caption tabular-nums text-primary">
                <span aria-hidden className="ed-lamp" data-lamp="live" />
                {trayLive}
              </span>
            )}
            <span className="typo-caption tabular-nums">{trayCards.length}</span>
          </div>
          <ShareBar cards={trayCards} />
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', columnGap: 12 }}>
            {trayCards.map((card) => renderRow({ kind: 'persona', key: card.personaId, height: MODULE_H, card, teamName: null }))}
            {traySessions.map((s) => <UnitRow key={s.id} session={s} now={now} />)}
          </div>
        </section>
      )}
    </div>
  );
}
