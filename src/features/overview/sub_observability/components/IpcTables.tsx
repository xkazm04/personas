/**
 * Observability (composition kit): the two IPC tables. Per command, slowest p95 first, each
 * row's Mark in its p95 band's tone; the slowest calls, a failed call marked in the error tone.
 * Twelve rows show, the rest behind the pager's Show all. Every column sorts (a press on a head);
 * the sort runs over all rows before the twelve are cut, so Show all never reorders the page.
 */
import { useMemo, useState } from 'react';
import { latencyToHealth } from '@/lib/design/statusTokens';
import type { IpcCallRecord, IpcCommandStats } from '@/lib/ipcMetrics';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DataTable, KitButton, sortRows, type TableRow, type TableSort } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { latencyTone } from '../libs/latencyTone';

export type Band = 'all' | 'healthy' | 'info' | 'warning' | 'critical';
export type Outcome = 'all' | 'ok' | 'error';
const SHOWN = 12;
type CmdCol = 'cmd' | 'p50' | 'p95' | 'p99' | 'n';
type SlowCol = 'cmd' | 'dur' | 'when';

const shortName = (cmd: string) => cmd.replace(/^(get_|list_|fetch_|create_|update_|delete_)/, '');
const ms = (v: number) => <span className="typo-data k-regular"><Numeric value={v} unit="ms" /></span>;

function Pager({ shown, total, onAll }: { shown: number; total: number; onAll: () => void }) {
  const { t } = useTranslation();
  if (total <= shown) return null;
  return (
    <>
      <span className="typo-data k-regular k-quiet">{shown} / {total}</span>
      <KitButton onClick={onAll}>{t.overview.heartbeats.show_all}</KitButton>
    </>
  );
}

export function IpcCommandTable({ stats, band }: { stats: IpcCommandStats[]; band: Band }) {
  const { t } = useTranslation();
  const ip = t.overview.ipc_panel;
  const { language } = useTranslation();
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<TableSort<CmdCol>>({ key: 'p95', dir: 'desc' });
  const visible = useMemo(() => stats.filter((s) => band === 'all' || latencyToHealth(s.p95) === band), [stats, band]);
  const allRows: Array<TableRow<CmdCol>> = visible.map((s) => ({
    id: s.command,
    sort: { cmd: shortName(s.command), p50: s.p50, p95: s.p95, p99: s.p99, n: s.count },
    mark: { tone: latencyTone(s.p95), glyph: 'solid', label: `p95 ${Math.round(s.p95)} ms` },
    cells: {
      cmd: (
        <div className="k-cell2">
          <span className="k-row__name typo-code k-strong">{shortName(s.command)}</span>
          <span className="k-row__meta typo-caption">{s.command}</span>
        </div>
      ),
      p50: ms(s.p50), p95: ms(s.p95), p99: ms(s.p99),
      n: <span className="typo-data k-regular"><Numeric value={s.count} unit="count" /></span>,
    },
  }));
  const sorted = sortRows(allRows, sort, language);
  const rows = all ? sorted : sorted.slice(0, SHOWN);
  return (
    <DataTable<CmdCol>
      label={ip.commands_table_label}
      cols={[
        { key: 'cmd', label: ip.command, sortable: 'asc' },
        { key: 'p50', label: 'p50', num: true, sortable: 'desc' },
        { key: 'p95', label: 'p95', num: true, sortable: 'desc' },
        { key: 'p99', label: 'p99', num: true, sortable: 'desc' },
        { key: 'n', label: ip.calls_header, num: true, sortable: 'desc' },
      ]}
      rows={rows}
      sort={sort}
      onSortChange={setSort}
      locale={language}
      empty={{ title: t.overview.events.no_filter_match }}
      pager={<Pager shown={rows.length} total={sorted.length} onAll={() => setAll(true)} />}
    />
  );
}

export function IpcSlowestTable({ calls, outcome }: { calls: IpcCallRecord[]; outcome: Outcome }) {
  const { t, language } = useTranslation();
  const ip = t.overview.ipc_panel;
  const visible = useMemo(() => calls.filter((r) => outcome === 'all' || (outcome === 'ok' ? r.ok : !r.ok)), [calls, outcome]);
  const rows: Array<TableRow<SlowCol>> = visible.map((r) => ({
    id: `${r.command}-${r.timestamp}`,
    sort: { cmd: r.command, dur: r.durationMs, when: r.timestamp },
    mark: r.ok ? { tone: latencyTone(r.durationMs), glyph: 'soft', label: t.common.success } : { tone: 'error', glyph: 'solid', label: t.common.error },
    cells: {
      cmd: <span className="k-row__name typo-code k-strong">{r.command}</span>,
      dur: ms(r.durationMs),
      when: <span className="typo-data k-regular k-quiet"><RelativeTime timestamp={new Date(r.timestamp).toISOString()} format="elapsed" showTooltip={false} /></span>,
    },
  }));
  return (
    <DataTable<SlowCol>
      label={ip.slowest_table_label}
      cols={[
        { key: 'cmd', label: ip.command, sortable: 'asc' },
        { key: 'dur', label: ip.duration_header, num: true, sortable: 'desc' },
        { key: 'when', label: ip.when_header, num: true, sortable: 'desc' },
      ]}
      rows={rows}
      defaultSort={{ key: 'dur', dir: 'desc' }}
      locale={language}
      empty={{ title: t.overview.events.no_filter_match }}
    />
  );
}
