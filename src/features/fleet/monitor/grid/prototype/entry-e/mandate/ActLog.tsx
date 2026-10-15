// The act log: counted filters (all / by steward / by you / revertible /
// reverted) over one page of acts, newest first, one row each in aligned
// columns. The name says what was decided in words (the verb and the item's
// title, `actWords`); BY is the actor as a glyph in its role colour (the
// router, the steward, you); UNDO says whether the act can still be taken
// back. On a mandate page the envelope version is said once, as a divider
// where it changes, never on every row; the fleet-wide log names each row's
// project instead. The raw item id is data for a tooltip, never the headline.
// The selected row is what V (revert) and N (narrow) act on; ↑/↓ (or j/k)
// move it.

import { Bot, Laptop, Lock, Route, Undo2, User, type LucideIcon } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { ChipRow, ListRow, Rows, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { CharterActor } from '@/lib/bindings/CharterActor';
import type { MandateMirror } from '@/lib/bindings/MandateMirror';
import { Engraved } from '../parts';
import { actHeadline } from './actWords';
import { actorLabel } from './mandateCopy';
import { ProjectName } from './rowParts';
import { ACT_FILTERS, actMatches, type ActFilter, type ActLogState } from './useActLog';

const SHOWN = 200;

const ACTOR: Record<CharterActor, { icon: LucideIcon; color: string }> = {
  router: { icon: Route, color: 'text-foreground' },
  steward: { icon: Bot, color: 'text-role-agent' },
  operator: { icon: User, color: 'text-role-human' },
};

export function filterLabel(m: ReturnType<typeof useTranslation>['t']['monitor'], f: ActFilter): string {
  switch (f) {
    case 'all': return m.ml_filter_all;
    case 'steward': return m.ml_filter_steward;
    case 'you': return m.ml_filter_you;
    case 'revertible': return m.ml_filter_revertible;
    case 'reverted': return m.ml_filter_reverted;
  }
}

export function visibleActs(log: ActLogState, filter: ActFilter): CharterAct[] {
  return (log.acts ?? []).filter((a) => actMatches(filter, a)).slice(0, SHOWN);
}

/** Who took the act; an act decided on another device (and applied at its
 *  mandate's home, WP9) also wears that device's mark. */
export function Actor({ actor, device = null }: { actor: CharterActor; device?: string | null }) {
  const { t, tx } = useTranslation();
  const { icon: Icon, color } = ACTOR[actor];
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 typo-caption ${color}`} data-actor={actor}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
      <span className="truncate">{actorLabel(t.monitor, actor)}</span>
      {device && (
        <Tooltip content={tx(t.monitor.remote_from_device, { device })} placement="top">
          <span role="img" aria-label={tx(t.monitor.remote_from_device, { device })} className="inline-flex flex-shrink-0 text-foreground" data-testid="mandate-act-device">
            <Laptop className="h-3.5 w-3.5" aria-hidden />
          </span>
        </Tooltip>
      )}
    </span>
  );
}

export function Undo({ act }: { act: CharterAct }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const [Icon, word, cls] = act.revertedAt
    ? [Undo2, m.ml_act_reverted, 'text-status-warning']
    : act.reversible ? [Undo2, m.ml_act_revertible, '']
      : [Lock, m.ml_act_final, ''];
  return (
    <span className={`inline-flex items-center gap-1.5 typo-caption ${cls}`}>
      <Icon className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />{word}
    </span>
  );
}

export function ActLog({ log, filter, onFilter, rows, selected, onSelect, mandateName, mandateTitle, projectOf, mirrorOf }: {
  log: ActLogState;
  filter: ActFilter;
  onFilter: (f: ActFilter) => void;
  /** `visibleActs(log, filter)`, computed once by the caller (its keys walk it). */
  rows: readonly CharterAct[];
  selected: number;
  onSelect: (i: number) => void;
  /** Names the mandate on each row (the fleet-wide log); omitted on a mandate page. */
  mandateName?: (charterId: string) => string;
  /** The mandate's own title, which names an envelope act's subject. */
  mandateTitle?: (charterId: string) => string | null;
  /** The project a charter belongs to, for its colour edge (the fleet-wide log). */
  projectOf?: (charterId: string) => string | null;
  /** Where a mirrored charter lives (the fleet-wide log); null for one that lives here. */
  mirrorOf?: (charterId: string) => MandateMirror | null;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const chips = ACT_FILTERS.map((f) => ({
    id: f,
    label: filterLabel(m, f),
    count: log.acts ? log.counts[f] : undefined,
    state: f === filter ? ('selected' as const) : undefined,
    onPress: () => onFilter(f),
  }));
  const fleet = !!mandateName;
  const columns: RowColumn[] = useMemo(() => [
    ...(fleet ? [{ head: m.ml_col_project, width: '11rem' }] : []),
    { head: m.ml_col_by, width: '7rem' },
    { head: m.ml_col_undo, width: '7.5rem', collapse: true },
    // The time as a column, not the row's trail: a trail is sized per row, so
    // "2 min. ago" and "18 min. ago" would shift every column left of it.
    { width: '6.5rem', align: 'end' },
  ], [m, fleet]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="mandate-act-log">
      <ChipRow chips={chips} label={m.ml_act_filters_aria} emptyLabel={null} />
      <p className="typo-caption text-status-error empty:hidden" role="status">{log.failed ? m.ml_acts_failed : null}</p>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Rows
          loading={log.acts === null && !log.failed}
          count={rows.length}
          label={m.ml_act_log}
          columns={columns}
          nameHead={m.ml_col_act}
          empty={{ title: filter === 'all' ? m.ml_acts_empty : m.ml_acts_empty_filter, testId: 'mandate-act-log-empty' }}
        >
          {rows.map((a, i) => {
            const head = actHeadline(m, a, mandateTitle?.(a.charterId));
            const version = !fleet && (i === 0 || rows[i - 1]!.envelopeVersion !== a.envelopeVersion);
            return (
              <Fragment key={a.id}>
                {version && (
                  <div className="flex items-center gap-2 pb-1 pl-3 pr-3 pt-2.5" data-testid="mandate-act-version">
                    <Engraved>{tx(m.ml_act_version, { version: a.envelopeVersion })}</Engraved>
                    <span className="h-px flex-1 bg-foreground/10" aria-hidden />
                  </div>
                )}
                <ListRow
                  testId="mandate-act-row"
                  size="line"
                  name={(
                    <Tooltip content={`${a.itemKind} ${a.itemId} · ${tx(m.ml_act_version, { version: a.envelopeVersion })}`} placement="top">
                      <span data-testid="mandate-act-headline">{head.verb} · {head.what}</span>
                    </Tooltip>
                  )}
                  cells={[
                    ...(fleet ? [<ProjectName key="p" projectId={projectOf?.(a.charterId) ?? null} mirror={mirrorOf?.(a.charterId)}>{mandateName!(a.charterId)}</ProjectName>] : []),
                    <Actor key="b" actor={a.actor} device={a.originDevice} />,
                    <Undo key="u" act={a} />,
                    <RelativeTime key="t" timestamp={a.createdAt} className="typo-data k-regular k-quiet tabular-nums" />,
                  ]}
                  state={i === selected ? 'selected' : undefined}
                  onPress={() => onSelect(i)}
                />
              </Fragment>
            );
          })}
        </Rows>
      </div>
    </div>
  );
}
