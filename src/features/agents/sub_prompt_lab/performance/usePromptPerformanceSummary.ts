import { useState, useEffect, useCallback, useMemo } from 'react';
import { getPromptPerformance, getPromptErrorRate, getPromptVersions } from '@/api/overview/observability';
import type { PromptPerformanceData } from '@/lib/bindings/PromptPerformanceData';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';

export type TrendDirection = 'improving' | 'stable' | 'degrading';

export interface WindowedErrorRate {
  window: string;
  rate: number;
}

export interface VersionComparison {
  current: PersonaPromptVersion;
  previous: PersonaPromptVersion;
  currentErrorRate: number;
  previousErrorRate: number;
  isWorse: boolean;
}

export interface PromptPerformanceSummary {
  errorRates: WindowedErrorRate[];
  trend: TrendDirection;
  versionComparison: VersionComparison | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function computeTrend(data: PromptPerformanceData): TrendDirection {
  const points = data.daily_points;
  if (points.length < 4) return 'stable';

  const mid = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);

  const avgFirst = firstHalf.reduce((s, p) => s + p.error_rate, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, p) => s + p.error_rate, 0) / secondHalf.length;

  const delta = avgSecond - avgFirst;
  // Threshold: 5 percentage points change
  if (delta > 0.05) return 'degrading';
  if (delta < -0.05) return 'improving';
  return 'stable';
}

export function usePromptPerformanceSummary(personaId: string): PromptPerformanceSummary {
  const [perfData, setPerfData] = useState<PromptPerformanceData | null>(null);
  const [versions, setVersions] = useState<PersonaPromptVersion[]>([]);
  const [errorRate24h, setErrorRate24h] = useState<number | null>(null);
  const [errorRate7d, setErrorRate7d] = useState<number | null>(null);
  const [errorRate30d, setErrorRate30d] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [perf, rate24h, rate7d, rate30d, vers] = await Promise.all([
        getPromptPerformance(personaId, 30),
        getPromptErrorRate(personaId, 5),     // ~24h worth of recent executions
        getPromptErrorRate(personaId, 20),    // ~7d worth
        getPromptErrorRate(personaId, 50),    // ~30d worth
        getPromptVersions(personaId, 5),
      ]);
      setPerfData(perf);
      setErrorRate24h(rate24h);
      setErrorRate7d(rate7d);
      setErrorRate30d(rate30d);
      setVersions(vers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performance summary');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const errorRates = useMemo<WindowedErrorRate[]>(() => {
    if (errorRate24h == null) return [];
    return [
      { window: '24h', rate: errorRate24h },
      { window: '7d', rate: errorRate7d ?? 0 },
      { window: '30d', rate: errorRate30d ?? 0 },
    ];
  }, [errorRate24h, errorRate7d, errorRate30d]);

  const trend = useMemo<TrendDirection>(() => {
    if (!perfData) return 'stable';
    return computeTrend(perfData);
  }, [perfData]);

  const versionComparison = useMemo<VersionComparison | null>(() => {
    if (versions.length < 2 || !perfData) return null;

    const sorted = [...versions].sort((a, b) => b.version_number - a.version_number);
    const current = sorted[0]!;
    const previous = sorted[1]!;

    // Find the deployment date of the current version
    const currentMarker = perfData.version_markers.find(
      (m) => m.version_number === current.version_number,
    );
    const previousMarker = perfData.version_markers.find(
      (m) => m.version_number === previous.version_number,
    );

    if (!currentMarker) return null;

    const currentDate = currentMarker.created_at.slice(0, 10);
    const previousDate = previousMarker?.created_at.slice(0, 10) ?? perfData.daily_points[0]?.date;

    if (!previousDate) return null;

    const currentPoints = perfData.daily_points.filter((p) => p.date >= currentDate);
    const previousPoints = perfData.daily_points.filter(
      (p) => p.date >= previousDate && p.date < currentDate,
    );

    const currentErrorRate =
      currentPoints.length > 0
        ? currentPoints.reduce((s, p) => s + p.error_rate, 0) / currentPoints.length
        : 0;
    const previousErrorRate =
      previousPoints.length > 0
        ? previousPoints.reduce((s, p) => s + p.error_rate, 0) / previousPoints.length
        : 0;

    return {
      current,
      previous,
      currentErrorRate,
      previousErrorRate,
      isWorse: currentErrorRate > previousErrorRate * 1.2, // 20% worse threshold
    };
  }, [versions, perfData]);

  return {
    errorRates,
    trend,
    versionComparison,
    loading,
    error,
    refresh: fetchAll,
  };
}
