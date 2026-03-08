import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';
import { getPromptPerformance } from '@/api/observability';
import { sendAppNotification } from '@/api/system';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import type { PromptPerformanceData } from '@/lib/bindings/PromptPerformanceData';
import { AgentTrendRow, type AgentTrend } from './AgentTrendRow';

const REPORT_DISMISS_KEY = 'weekly-perf-report-dismissed';
const REPORT_NOTIFIED_KEY = 'weekly-perf-report-notified';

function shouldShowReport(): boolean {
  const dismissed = localStorage.getItem(REPORT_DISMISS_KEY);
  if (!dismissed) return true;
  const dismissedAt = parseInt(dismissed, 10);
  // Show again after 7 days
  return Date.now() - dismissedAt > 7 * 24 * 60 * 60 * 1000;
}

function dismissReport() {
  localStorage.setItem(REPORT_DISMISS_KEY, Date.now().toString());
}

function computeDelta(data: PromptPerformanceData): number {
  const points = data.daily_points;
  if (points.length < 4) return 0;
  const mid = Math.floor(points.length / 2);
  const firstHalf = points.slice(0, mid);
  const secondHalf = points.slice(mid);
  const avgFirst = firstHalf.reduce((s, p) => s + p.error_rate, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, p) => s + p.error_rate, 0) / secondHalf.length;
  return avgSecond - avgFirst;
}

interface WeeklyPerformanceReportProps {
  onNavigateToAgent?: (personaId: string) => void;
}

export function WeeklyPerformanceReport({ onNavigateToAgent }: WeeklyPerformanceReportProps) {
  const personas = usePersonaStore((s) => s.personas);
  const [visible, setVisible] = useState(shouldShowReport);
  const [trends, setTrends] = useState<AgentTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTrends = useCallback(async () => {
    if (personas.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await Promise.allSettled(
        personas.map(async (p): Promise<AgentTrend> => {
          const data = await getPromptPerformance(p.id, 14);
          const delta = computeDelta(data);
          const recent = data.daily_points.slice(-7);
          const currentRate =
            recent.length > 0
              ? recent.reduce((s, pt) => s + pt.error_rate, 0) / recent.length
              : 0;
          return { persona: p, errorRateDelta: delta, currentRate };
        }),
      );

      const successfulTrends = results
        .filter((r): r is PromiseFulfilledResult<AgentTrend> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((t) => Math.abs(t.errorRateDelta) > 0.01 || t.currentRate > 0);

      setTrends(successfulTrends);
    } catch {
      useToastStore.getState().addToast('Failed to load weekly performance data', 'error');
    } finally {
      setLoading(false);
    }
  }, [personas]);

  useEffect(() => {
    if (visible) void fetchTrends();
  }, [visible, fetchTrends]);

  const { improving, degrading } = useMemo(() => {
    const sorted = [...trends].sort((a, b) => a.errorRateDelta - b.errorRateDelta);
    return {
      improving: sorted.filter((t) => t.errorRateDelta < -0.01).slice(0, 3),
      degrading: sorted.filter((t) => t.errorRateDelta > 0.01).slice(-3).reverse(),
    };
  }, [trends]);

  // Send a native OS notification once per weekly cycle
  const notifiedRef = useRef(false);
  useEffect(() => {
    if (notifiedRef.current || loading) return;
    if (improving.length === 0 && degrading.length === 0) return;

    // Check if we already sent the native notification this cycle
    const lastNotified = localStorage.getItem(REPORT_NOTIFIED_KEY);
    if (lastNotified) {
      const notifiedAt = parseInt(lastNotified, 10);
      if (Date.now() - notifiedAt < 7 * 24 * 60 * 60 * 1000) return;
    }

    notifiedRef.current = true;
    localStorage.setItem(REPORT_NOTIFIED_KEY, Date.now().toString());

    const parts: string[] = [];
    if (degrading.length > 0) {
      parts.push(`${degrading.length} degrading: ${degrading.map((t) => t.persona.name).join(', ')}`);
    }
    if (improving.length > 0) {
      parts.push(`${improving.length} improving: ${improving.map((t) => t.persona.name).join(', ')}`);
    }

    sendAppNotification(
      'Weekly Performance Report',
      parts.join(' | '),
    ).catch(() => {});
  }, [improving, degrading, loading]);

  const handleDismiss = () => {
    dismissReport();
    setVisible(false);
  };

  if (!visible || loading || (improving.length === 0 && degrading.length === 0)) {
    return null;
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary/70" />
          <h4 className="text-sm font-medium text-foreground/80">Weekly Performance Report</h4>
        </div>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
          title="Dismiss for a week"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Improving agents */}
      {improving.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400/80 uppercase tracking-wider font-medium">
            <TrendingDown className="w-3 h-3" />
            Improving
          </div>
          {improving.map((t) => (
            <AgentTrendRow
              key={t.persona.id}
              trend={t}
              variant="improving"
              onNavigate={onNavigateToAgent}
            />
          ))}
        </div>
      )}

      {/* Degrading agents */}
      {degrading.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-red-400/80 uppercase tracking-wider font-medium">
            <TrendingUp className="w-3 h-3" />
            Degrading
          </div>
          {degrading.map((t) => (
            <AgentTrendRow
              key={t.persona.id}
              trend={t}
              variant="degrading"
              onNavigate={onNavigateToAgent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
