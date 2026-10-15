// Under the register, the latest acts across every mandate: what the stewards
// (and you) decided most recently, in the act log's own row grammar. The
// register says who holds what; this says what they did with it. A row opens
// the act log (L) at that act.

import { ScrollText } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { ListRow, Rows, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Engraved, Kbd } from '../parts';
import { Actor, Undo } from './ActLog';
import { actHeadline } from './actWords';
import { ProjectName } from './rowParts';
import { useActLog } from './useActLog';

const LATEST = 8;

export function RegisterActs({ mandates, onOpenLog }: {
  mandates: readonly MandateSummary[];
  /** Open the act log, at an act when one is pressed. */
  onOpenLog: (focusActId?: string) => void;
}) {
  const { t } = useTranslation();
  const m = t.monitor;
  const log = useActLog(null);
  const rows = useMemo(() => (log.acts ?? []).slice(0, LATEST), [log.acts]);
  const byId = useMemo(() => new Map(mandates.map((x) => [x.charterId, x])), [mandates]);
  const columns: RowColumn[] = useMemo(() => [
    { head: m.ml_col_project, width: '11rem' },
    { head: m.ml_col_by, width: '7rem' },
    { head: m.ml_col_undo, width: '7.5rem', collapse: true },
    { width: '6.5rem', align: 'end' },
  ], [m]);

  return (
    <section className="ae-plate flex min-w-0 flex-col gap-2 rounded-card px-1 pb-2 pt-2" aria-label={m.ml_act_log} data-testid="mandate-register-acts">
      <header className="flex items-center gap-2 px-3">
        <Engraved>{m.ml_act_log}</Engraved>
        {log.acts && <span className="typo-data tabular-nums text-foreground">{log.counts.all}</span>}
        <Button variant="ghost" size="xs" className="ml-auto" onClick={() => onOpenLog()} icon={<ScrollText className="h-3.5 w-3.5" aria-hidden />} aria-keyshortcuts="L">
          {m.ml_act_log} <Kbd>L</Kbd>
        </Button>
      </header>
      <Rows loading={log.acts === null && !log.failed} count={rows.length} label={m.ml_act_log} columns={columns} nameHead={m.ml_col_act} empty={{ title: log.failed ? m.ml_acts_failed : m.ml_acts_empty }}>
        {rows.map((a) => {
          const x = byId.get(a.charterId);
          const head = actHeadline(m, a, x?.title ?? null);
          return (
            <ListRow
              key={a.id}
              testId="mandate-register-act"
              size="line"
              name={`${head.verb} · ${head.what}`}
              cells={[
                <ProjectName key="p" projectId={x?.projectId ?? null} mirror={x?.mirror}>{x?.projectName ?? m.ml_project_unknown}</ProjectName>,
                <Actor key="b" actor={a.actor} />,
                <Undo key="u" act={a} />,
                <RelativeTime key="t" timestamp={a.createdAt} className="typo-data k-regular k-quiet tabular-nums" />,
              ]}
              onPress={() => onOpenLog(a.id)}
            />
          );
        })}
      </Rows>
    </section>
  );
}
