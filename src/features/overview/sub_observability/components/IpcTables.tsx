/**
 * Observability (composition kit): the two IPC tables. Per command, slowest p95 first, each
 * row's Mark in its p95 band's tone; the slowest calls, a failed call marked in the error tone.
 * Twelve rows show, the rest behind the pager's Show all.
 */
import { useMemo, useState } from 'react';
import { latencyToHealth } from '@/lib/design/statusTokens';
import type { IpcCallRecord, IpcCommandStats } from '@/lib/ipcMetrics';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { DataTable, KitButton, type TableRow } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { latencyTone } from '../libs/latencyTone';

export type Band = 'all' | 'healthy' | 'info' | 'warning' | 'critical';
export type Outcome = 'all' | 'ok' | 'error';
const SHOWN = 12;

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
  const [all, setAll] = useState(false);
  const visible = useMemo(
    () => [...stats].filter((s) => band === 'all' || latencyToHealth(s.p95) === band).sort((a, b) => b.p95 - a.p95),
    [stats, band],
  );
  const shown = all ? visible : visible.slice(0, SHOWN);
  const rows: Array<TableRow<'cmd' | 'p50' | 'p95' | 'p99' | 'n'>> = shown.map((s) => ({
    id: s.command,
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
  return (
    <DataTable
      label={ip.commands_table_label}
      cols={[
        { key: 'cmd', label: ip.command },
        { key: 'p50', label: 'p50', num: true },
        { key: 'p95', label: 'p95', num: true },
        { key: 'p99', label: 'p99', num: true },
        { key: 'n', label: ip.calls_header, num: true },
      ]}
      rows={rows}
      empty={{ title: t.overview.events.no_filter_match }}
      pager={<Pager shown={shown.length} total={visible.length} onAll={() => setAll(true)} />}
    />
  );
}

export function IpcSlowestTable({ calls, outcome }: { calls: IpcCallRecord[]; outcome: Outcome }) {
  const { t } = useTranslation();
  const ip = t.overview.ipc_panel;
  const visible = useMemo(
    () => calls.filter((r) => outcome === 'all' || (outcome === 'ok' ? r.ok : !r.ok)).sort((a, b) => b.durationMs - a.durationMs),
    [calls, outcome],
  );
  const rows: Array<TableRow<'cmd' | 'dur' | 'when'>> = visible.map((r) => ({
    id: `${r.command}-${r.timestamp}`,
    mark: r.ok ? { tone: latencyTone(r.durationMs), glyph: 'soft', label: t.common.success } : { tone: 'error', glyph: 'solid', label: t.common.error },
    cells: {
      cmd: <span className="k-row__name typo-code k-strong">{r.command}</span>,
      dur: ms(r.durationMs),
      when: <span className="typo-data k-regular k-quiet"><RelativeTime timestamp={new Date(r.timestamp).toISOString()} format="elapsed" showTooltip={false} /></span>,
    },
  }));
  return (
    <DataTable
      label={ip.slowest_table_label}
      cols={[
        { key: 'cmd', label: ip.command },
        { key: 'dur', label: ip.duration_header, num: true },
        { key: 'when', label: ip.when_header, num: true },
      ]}
      rows={rows}
      empty={{ title: t.overview.events.no_filter_match }}
    />
  );
}
