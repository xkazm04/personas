/**
 * Observability (composition kit): IPC performance. The headline latencies are a StatStrip,
 * always on screen; the per-command and slowest-call tables open under it (a disclosure, as
 * before), each with its filter as a Segmented in a Toolbar. Latency bands are the kit's status
 * tones (latencyToHealth), the same ones a Mark uses.
 */
import { useMemo, useState, useSyncExternalStore } from 'react';
import { computeCommandStats, getSlowestCalls, getGlobalSummary, getIpcTotalCount, subscribeIpcMetrics } from '@/lib/ipcMetrics';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Dot, KitButton, Section, Segmented, StatStrip, Toolbar } from '@/features/shared/components/kit';
import { latencyTone } from '../libs/latencyTone';
import { useTranslation } from '@/i18n/useTranslation';
import { IpcCommandTable, IpcSlowestTable, type Band, type Outcome } from './IpcTables';


function useIpcSnapshot() {
  const generation = useSyncExternalStore(subscribeIpcMetrics, getIpcTotalCount);
  return useMemo(() => {
    void generation;
    return { stats: computeCommandStats(), slowest: getSlowestCalls(10), summary: getGlobalSummary() };
  }, [generation]);
}

const Ms = ({ ms }: { ms: number }) => (
  <span className="inline-flex items-center gap-2"><Dot tone={latencyTone(ms)} /><Numeric value={ms} unit="ms" /></span>
);

export default function IpcPerformancePanel() {
  const { t } = useTranslation();
  const ip = t.overview.ipc_panel;
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'commands' | 'slowest'>('commands');
  const [band, setBand] = useState<Band>('all');
  const [outcome, setOutcome] = useState<Outcome>('all');
  const { stats, slowest, summary } = useIpcSnapshot();
  if (summary.totalCalls === 0) return null;

  return (
    <Section
      id="s-obs-ipc"
      title={ip.title}
      count={<Numeric value={summary.totalCalls} unit="count" />}
      actions={
        <KitButton quiet expanded={expanded} onClick={() => setExpanded((v) => !v)} testId="obs-ipc-toggle">
          {expanded ? t.overview.review.backlog_collapse : t.overview.review.backlog_expand}
        </KitButton>
      }
    >
      <StatStrip
        tiles={[
          { label: ip.calls_header, value: <Numeric value={summary.totalCalls} unit="count" /> },
          { label: 'p50', value: <Ms ms={summary.p50} /> },
          { label: 'p95', value: <Ms ms={summary.p95} /> },
          { label: 'p99', value: <Ms ms={summary.p99} /> },
          { label: ip.error_rate.replace(/:$/, ''), value: <Numeric value={summary.errorRate} unit="ratio" precision={1} />, state: summary.errorRate > 0 ? 'default' : 'muted' },
          { label: ip.timeout_rate.replace(/:$/, ''), value: <Numeric value={summary.timeoutRate} unit="ratio" precision={1} />, state: summary.timeoutRate > 0 ? 'default' : 'muted' },
        ]}
      />
      {expanded && (
        <>
          <Toolbar label={ip.title}>
            <Segmented
              label={ip.title}
              value={tab}
              onChange={setTab}
              options={[{ v: 'commands', label: ip.by_command, count: stats.length }, { v: 'slowest', label: ip.slowest_calls, count: slowest.length }]}
            />
            {tab === 'commands' ? (
              <Segmented<Band>
                label="p95"
                value={band}
                onChange={setBand}
                options={[
                  { v: 'all', label: t.common.all },
                  { v: 'healthy', label: '< 50 ms', tone: 'success', glyph: 'solid' },
                  { v: 'info', label: '50-200 ms', tone: 'info', glyph: 'solid' },
                  { v: 'warning', label: '200 ms - 1 s', tone: 'warning', glyph: 'solid' },
                  { v: 'critical', label: '≥ 1 s', tone: 'error', glyph: 'solid' },
                ]}
              />
            ) : (
              <Segmented<Outcome>
                label={ip.slowest_calls}
                value={outcome}
                onChange={setOutcome}
                options={[
                  { v: 'all', label: t.common.all },
                  { v: 'ok', label: t.common.success, tone: 'success', glyph: 'solid' },
                  { v: 'error', label: t.common.error, tone: 'error', glyph: 'solid' },
                ]}
              />
            )}
          </Toolbar>
          {tab === 'commands'
            ? <IpcCommandTable stats={stats} band={band} />
            : <IpcSlowestTable calls={slowest} outcome={outcome} />}
        </>
      )}
    </Section>
  );
}
