import { useState, useEffect, useCallback, useMemo } from 'react';
import { BarChart3, Loader2, AlertTriangle } from 'lucide-react';
import { getPromptPerformance } from '@/api/observability';
import type { PromptPerformanceData } from '@/lib/bindings/PromptPerformanceData';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { AnomalyDot, SummaryCards, VersionTimeline, DashboardToolbar } from './PerformanceWidgets';
import { PerformanceCharts, type ComparedPoint } from './PerformanceCharts';

interface PromptPerformanceDashboardProps {
  personaId: string;
  onNavigateExecution?: (executionId: string) => void;
}

export function PromptPerformanceDashboard({
  personaId,
  onNavigateExecution,
}: PromptPerformanceDashboardProps) {
  const [data, setData] = useState<PromptPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(30);
  const [compareMode, setCompareMode] = useState(false);
  const [compareDeltaMode, setCompareDeltaMode] = useState(false);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getPromptPerformance(personaId, days);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance data');
    } finally {
      setLoading(false);
    }
  }, [personaId, days]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const productionVersion = useMemo(
    () => data?.version_markers.find((v) => v.tag === 'production') ?? null,
    [data],
  );

  const { comparedData, compALabel, compBLabel } = useMemo<{
    comparedData: ComparedPoint[] | null;
    compALabel: string;
    compBLabel: string;
  }>(() => {
    if (!compareMode || compareA == null || compareB == null || !data) {
      return { comparedData: null, compALabel: '', compBLabel: '' };
    }
    const markers = data.version_markers;
    const mA = markers.find(m => m.version_number === compareA);
    const mB = markers.find(m => m.version_number === compareB);
    if (!mA || !mB) return { comparedData: null, compALabel: '', compBLabel: '' };

    const dateA = mA.created_at.slice(0, 10);
    const dateB = mB.created_at.slice(0, 10);
    const pointsA = dateA < dateB
      ? data.daily_points.filter(p => p.date >= dateA && p.date < dateB)
      : data.daily_points.filter(p => p.date >= dateA);

    const pointsB = dateB < dateA
      ? data.daily_points.filter(p => p.date >= dateB && p.date < dateA)
      : data.daily_points.filter(p => p.date >= dateB);

    return {
      comparedData: data.daily_points.map(p => ({
        ...p,
        costA: pointsA.find(pa => pa.date === p.date)?.avg_cost_usd ?? null,
        costB: pointsB.find(pb => pb.date === p.date)?.avg_cost_usd ?? null,
        latencyA: pointsA.find(pa => pa.date === p.date)?.p50_duration_ms ?? null,
        latencyB: pointsB.find(pb => pb.date === p.date)?.p50_duration_ms ?? null,
        errorA: pointsA.find(pa => pa.date === p.date)?.error_rate ?? null,
        errorB: pointsB.find(pb => pb.date === p.date)?.error_rate ?? null,
      })),
      compALabel: `v${compareA}`,
      compBLabel: `v${compareB}`,
    };
  }, [compareMode, compareA, compareB, data]);

  const productionBaseline = useMemo(() => {
    if (!productionVersion || !data?.daily_points.length) return null;
    const prodDate = productionVersion.created_at.slice(0, 10);
    const prodPoints = data.daily_points.filter(p => p.date >= prodDate);
    if (prodPoints.length === 0) return null;
    return prodPoints.reduce((s, p) => s + p.avg_cost_usd, 0) / prodPoints.length;
  }, [productionVersion, data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-muted-foreground/60 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 space-y-2">
        <AlertTriangle className="w-6 h-6 text-red-400 mx-auto" />
        <p className="text-sm text-red-300">{error}</p>
        <button onClick={fetchData} className="text-sm text-primary/70 hover:text-primary">Retry</button>
      </div>
    );
  }

  if (!data || data.daily_points.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <BarChart3 className="w-8 h-8 text-muted-foreground/20 mx-auto" />
        <p className="text-sm text-muted-foreground/60">No execution data yet</p>
        <p className="text-sm text-muted-foreground/60">Run some executions to see performance trends</p>
      </div>
    );
  }

  const versionNumbers = data.version_markers.map(v => v.version_number);

  return (
    <div className="space-y-4">
      <DashboardToolbar
        anomalyCount={data.anomalies.length}
        days={days}
        setDays={setDays}
        compareMode={compareMode}
        toggleCompare={() => setCompareMode(!compareMode)}
        onRefresh={fetchData}
      />

      {compareMode && (
        <div className="flex items-center gap-3 px-3 py-2 bg-secondary/20 border border-primary/10 rounded-xl">
          <span className="text-sm text-muted-foreground/60">Compare versions:</span>
          <ThemedSelect value={String(compareA ?? '')} onChange={(e) => setCompareA(e.target.value ? Number(e.target.value) : null)} className="px-2 py-1 w-auto" wrapperClassName="inline-block">
            <option value="">Version A</option>
            {versionNumbers.map(n => <option key={n} value={n}>v{n}</option>)}
          </ThemedSelect>
          <span className="text-sm text-muted-foreground/40">vs</span>
          <ThemedSelect value={String(compareB ?? '')} onChange={(e) => setCompareB(e.target.value ? Number(e.target.value) : null)} className="px-2 py-1 w-auto" wrapperClassName="inline-block">
            <option value="">Version B</option>
            {versionNumbers.map(n => <option key={n} value={n}>v{n}</option>)}
          </ThemedSelect>
          <button
            type="button"
            onClick={() => setCompareDeltaMode((prev) => !prev)}
            className={`ml-auto px-2 py-1 rounded-lg border text-sm font-medium transition-colors ${
              compareDeltaMode
                ? 'bg-primary/15 border-primary/30 text-primary'
                : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/45'
            }`}
          >
            Delta view
          </button>
        </div>
      )}

      <SummaryCards points={data.daily_points} />

      {data.anomalies.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {data.anomalies.map((a, i) => (
            <AnomalyDot key={i} anomaly={a} onNavigate={onNavigateExecution} />
          ))}
        </div>
      )}

      <PerformanceCharts
        data={data}
        compareMode={compareMode}
        compareDeltaMode={compareDeltaMode}
        comparedData={comparedData}
        compALabel={compALabel}
        compBLabel={compBLabel}
        productionBaseline={productionBaseline}
      />

      <VersionTimeline markers={data.version_markers} />
    </div>
  );
}
