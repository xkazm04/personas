/**
 * Observability (composition kit): tool latency and reliability over the page's window, from
 * `get_tool_performance_summary` (the same command the shared ToolPerformancePanel reads; that
 * panel stays for its other surfaces). A row's Mark is its error rate, the tool type filters.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import { getToolPerformanceSummary } from '@/api/agents/tools';
import type { ToolPerformanceSummary } from '@/lib/bindings/ToolPerformanceSummary';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { DataTable, Section, Segmented, Toolbar, type Tone, type Glyph, type TableRow } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

type Col = 'tool' | 'runs' | 'avg' | 'max' | 'err';
const LIMIT = 8;

function errorMark(rate: number): { tone: Tone; glyph: Glyph } {
  if (rate === 0) return { tone: 'success', glyph: 'hollow' };
  if (rate < 0.05) return { tone: 'warning', glyph: 'soft' };
  return { tone: 'error', glyph: 'solid' };
}

export const ToolPerformanceSection = memo(function ToolPerformanceSection({ since, personaId, eyebrow }: {
  /** ISO 8601; rows older than this are excluded. */
  since: string;
  personaId?: string;
  eyebrow?: string;
}) {
  const { t } = useTranslation();
  const wd = t.overview.widgets;
  const [rows, setRows] = useState<ToolPerformanceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [type, setType] = useState('all');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const r = await getToolPerformanceSummary(since, personaId, LIMIT);
        if (!cancelled) setRows(r);
      } catch (err) {
        if (cancelled) return;
        silentCatch('ToolPerformanceSection:getToolPerformanceSummary')(err);
        setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [since, personaId]);

  const types = useMemo(() => [...new Set(rows.map((r) => r.tool_type))].sort((a, b) => a.localeCompare(b)), [rows]);
  const shown = useMemo(
    () => rows.filter((r) => type === 'all' || r.tool_type === type).sort((a, b) => Number(b.total_runs) - Number(a.total_runs)),
    [rows, type],
  );
  const table: Array<TableRow<Col>> = shown.map((r) => {
    const runs = Number(r.total_runs);
    const errors = Number(r.error_runs);
    const rate = runs ? errors / runs : 0;
    return {
      id: `${r.tool_type}:${r.tool_name}`,
      mark: { ...errorMark(rate), label: wd.tool_performance_col_errors },
      cells: {
        tool: (
          <div className="k-cell2">
            <span className="k-row__name typo-code k-strong">{r.tool_name}</span>
            <span className="k-row__meta typo-caption">{r.tool_type}</span>
          </div>
        ),
        runs: <span className="typo-data k-regular"><Numeric value={runs} unit="count" /></span>,
        avg: <span className="typo-data k-regular"><Numeric value={r.avg_duration_ms ?? null} unit="ms" /></span>,
        max: <span className="typo-data k-regular"><Numeric value={r.max_duration_ms == null ? null : Number(r.max_duration_ms)} unit="ms" /></span>,
        err: (
          <span className={`typo-data k-regular ${errors ? '' : 'k-quiet'}`}>
            <Numeric value={errors} unit="count" />{errors > 0 && <span className="k-quiet"> · <Numeric value={rate} unit="ratio" precision={1} /></span>}
          </span>
        ),
      },
    };
  });

  return (
    <Section id="s-obs-tools" eyebrow={eyebrow} title={wd.tool_performance} count={rows.length || undefined} meta={wd.tool_performance_subtitle}>
      {types.length > 1 && (
        <Toolbar label={wd.tool_performance}>
          <Segmented
            label={wd.tool_performance_col_tool}
            value={type}
            onChange={setType}
            options={[{ v: 'all', label: t.common.all, count: rows.length }, ...types.map((x) => ({ v: x, label: x, count: rows.filter((r) => r.tool_type === x).length }))]}
          />
        </Toolbar>
      )}
      <DataTable<Col>
        label={wd.tool_performance}
        loading={loading && rows.length === 0}
        cols={[
          { key: 'tool', label: wd.tool_performance_col_tool },
          { key: 'runs', label: wd.tool_performance_col_runs, num: true },
          { key: 'avg', label: wd.tool_performance_col_avg, num: true },
          { key: 'max', label: wd.tool_performance_col_max, num: true },
          { key: 'err', label: wd.tool_performance_col_errors, num: true },
        ]}
        rows={failed ? [] : table}
        empty={failed ? { title: t.overview.chart_error.chart_unavailable, tone: 'warning' } : { title: wd.tool_performance_empty }}
      />
    </Section>
  );
});
