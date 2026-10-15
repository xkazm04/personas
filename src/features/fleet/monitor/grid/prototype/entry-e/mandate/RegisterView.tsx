// The register (M): every live mandate, one row each, the ones asking the
// operator first, read in one pass down aligned columns - the bay's colour
// edge and the project, the steward's face, the state as its lamp, spend as
// the Usage plate's bar, acts and asks as figures. The selected mandate's
// envelope stands in the rail beside it, and the latest acts across every
// mandate sit under it (`RegisterActs`). Enter (or a press) opens its page.

import { CornerDownLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { ListRow, Rows, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Engraved, Kbd, Lamp } from '../parts';
import { EnvelopePlate } from './EnvelopePlate';
import { RegisterActs } from './RegisterActs';
import { Figure, MandateState, ProjectName, SpendCell, StewardFace } from './rowParts';
import { useDrawerListKeys } from './useDrawerKeys';
import type { MandatesState } from './useMandates';

export function registerOrder(list: readonly MandateSummary[]): MandateSummary[] {
  return [...list].sort((a, b) =>
    (b.load.openAsks ?? 0) - (a.load.openAsks ?? 0)
    || (b.load.actsCount ?? 0) - (a.load.actsCount ?? 0)
    || (a.projectName ?? '').localeCompare(b.projectName ?? ''));
}

export function RegisterView({ state, selected, onSelect, onOpen, onOpenLog, heldOf }: {
  state: MandatesState;
  selected: number;
  onSelect: (i: number) => void;
  onOpen: (charterId: string) => void;
  onOpenLog: (focusActId?: string) => void;
  /** Items held on a charter, from the lanes snapshot; null when it is not read. */
  heldOf: (charterId: string) => number | null;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const rows = useMemo(() => registerOrder(state.mandates ?? []), [state.mandates]);
  const cur = rows[Math.min(selected, rows.length - 1)];
  useDrawerListKeys({ count: rows.length, selected, onSelect, onEnter: () => { if (cur) onOpen(cur.charterId); } });
  const asking = rows.reduce((n, x) => n + (x.load.openAsks ?? 0), 0);
  // The figure columns are fixed and narrow; the steward and spend share the
  // room with the project name, so at 1280 the name keeps its width.
  const columns: RowColumn[] = useMemo(() => [
    { head: m.ml_col_steward, width: 'minmax(0, 0.8fr)', collapse: true },
    { head: m.ml_fact_status, width: '6.5rem' },
    { head: m.ml_fact_rung, width: '3rem', align: 'end', collapse: true },
    { head: m.ml_col_spend, width: 'minmax(0, 0.9fr)' },
    { head: m.ml_fact_acts, width: '3rem', align: 'end' },
    { head: m.ml_col_asks, width: '3rem', align: 'end' },
  ], [m]);

  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="mandate-register">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto">
        <section className="ae-plate flex min-w-0 flex-col gap-2 rounded-card px-1 pb-2 pt-3" aria-label={m.ml_register}>
          <header className="flex items-center gap-2 px-3">
            <Lamp lamp={{ tone: 'warn', lit: asking > 0 }} />
            <Engraved>{m.ml_drawer_aria}</Engraved>
            <span className="typo-data tabular-nums text-foreground" data-testid="mandate-register-count">{state.mandates ? rows.length : null}</span>
            <span className="ml-auto typo-caption text-status-error" role="status">{state.failed ? m.ml_stewards_failed : null}</span>
          </header>
          <Rows
            loading={state.mandates === null && !state.failed}
            count={rows.length}
            label={m.ml_register}
            columns={columns}
            nameHead={m.ml_col_project}
            empty={{ title: m.ml_stewards_none, testId: 'mandate-register-empty' }}
          >
            {rows.map((x, i) => (
              <ListRow
                key={x.charterId}
                testId="mandate-register-row"
                size="l"
                nameClass="typo-heading text-foreground"
                name={<ProjectName projectId={x.projectId}>{x.projectName ?? m.ml_project_unknown}</ProjectName>}
                meta={<span className="truncate pl-3.5">{x.title}</span>}
                cells={[
                  <StewardFace key="s" personaId={x.stewardPersonaId} name={x.stewardName ?? m.ml_steward_unknown} />,
                  <MandateState key="st" mandate={x} />,
                  <Figure key="r" n={x.scopeRung} none={m.ml_unknown} />,
                  <SpendCell key="sp" used={x.load.spendUsedUsd} cap={x.load.budgetUsd} />,
                  <Figure key="a" n={x.load.actsCount} none={m.ml_unknown} />,
                  <Figure key="q" n={x.load.openAsks} warn none={m.ml_unknown} />,
                ]}
                state={i === selected ? 'selected' : undefined}
                onPress={() => onOpen(x.charterId)}
              />
            ))}
          </Rows>
        </section>
        {state.mandates && rows.length > 0 && <RegisterActs mandates={rows} onOpenLog={onOpenLog} />}
      </div>
      {cur && (
        // The envelope repeats what the mandate page shows, so a narrow Monitor gives
        // its width to the register's columns instead.
        <aside className="hidden w-[300px] flex-shrink-0 flex-col gap-3 overflow-y-auto 2xl:flex" data-testid="mandate-register-rail">
          <EnvelopePlate mandate={cur} held={heldOf(cur.charterId)} testId="mandate-register-envelope" />
          <Button
            variant="secondary"
            size="sm"
            block
            onClick={() => onOpen(cur.charterId)}
            iconRight={<span className="ml-1.5 inline-flex"><Kbd><CornerDownLeft className="h-3 w-3" aria-hidden /></Kbd></span>}
            data-testid="mandate-register-open"
          >
            {tx(m.ml_steward_row_aria, { project: cur.projectName ?? m.ml_project_unknown })}
          </Button>
        </aside>
      )}
    </div>
  );
}
