import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useTranslation } from "@/i18n/useTranslation";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { langfuseOpenAuthenticatedUI, langfuseRecentTraces } from "@/api/langfuse";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import type { LangfuseTraceSummary } from "@/lib/bindings/LangfuseTraceSummary";
import { toastCatch } from "@/lib/silentCatch";

interface TraceListPanelProps {
  config: LangfuseConfig;
  limit?: number;
}

const DEFAULT_LIMIT = 10;

function formatRelative(timestamp: string | null): string {
  if (!timestamp) return "—";
  const t = Date.parse(timestamp);
  if (Number.isNaN(t)) return timestamp;
  const diff = Date.now() - t;
  if (diff < 0) return new Date(t).toLocaleString();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatLatency(seconds: number | null): string | null {
  if (seconds == null) return null;
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`;
  return `${seconds.toFixed(2)}s`;
}

function formatCost(cost: number | null): string | null {
  if (cost == null || cost === 0) return null;
  if (cost < 0.01) return `<$0.01`;
  return `$${cost.toFixed(4)}`;
}

export function TraceListPanel({ config, limit = DEFAULT_LIMIT }: TraceListPanelProps) {
  const { t, tx } = useTranslation();
  const [traces, setTraces] = useState<LangfuseTraceSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const next = await langfuseRecentTraces(limit);
      setTraces(next);
    } catch (e) {
      // Don't surface as a toast — the inline error in the panel is enough,
      // and a toast every poll on a stopped stack would be noisy.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const onOpenTrace = (trace: LangfuseTraceSummary) => {
    const projectId = trace.projectId ?? config.projectId ?? null;
    if (!projectId) {
      // Without a project id we can't build a deep-link. Fall back to the
      // host root so the user at least lands inside Langfuse.
      void langfuseOpenAuthenticatedUI().catch(
        toastCatch("Langfuse:trace:openHost", "Failed to open Langfuse"),
      );
      return;
    }
    const tracePath = `/project/${projectId}/traces/${trace.id}`;
    if (config.managed) {
      void langfuseOpenAuthenticatedUI(tracePath).catch(
        toastCatch("Langfuse:trace:openAuth", "Failed to open Langfuse"),
      );
      return;
    }
    const url = `${config.host.replace(/\/$/, "")}${tracePath}`;
    void openExternal(url).catch(
      toastCatch("Langfuse:trace:openExternal", "Failed to open Langfuse"),
    );
  };

  return (
    <section className="rounded-card border border-primary/10 bg-secondary/10 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="typo-heading text-foreground">
            {t.plugins.langfuse.recent_traces_section}
          </h2>
          <p className="typo-caption text-foreground/80 mt-1">
            {tx(t.plugins.langfuse.recent_traces_intro, { count: limit })}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading || refreshing}
          className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground/80 hover:bg-secondary/60 disabled:opacity-40 transition-colors"
          aria-label={t.plugins.langfuse.recent_traces_refresh}
        >
          {refreshing || loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          <span>{t.plugins.langfuse.recent_traces_refresh}</span>
        </button>
      </div>

      {loading && traces === null && (
        <div className="flex items-center justify-center py-6">
          <LoadingSpinner size="md" label={t.plugins.langfuse.recent_traces_loading} />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 typo-caption rounded-card border border-red-500/20 bg-red-500/5 text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{tx(t.plugins.langfuse.recent_traces_error, { error })}</span>
        </div>
      )}

      {!loading && !error && traces !== null && traces.length === 0 && (
        <div className="px-3 py-4 typo-caption text-foreground/80 text-center rounded-card border border-primary/10 bg-secondary/5">
          {t.plugins.langfuse.recent_traces_empty}
        </div>
      )}

      {traces !== null && traces.length > 0 && (
        <ul className="divide-y divide-primary/10 rounded-card border border-primary/10 overflow-hidden">
          {traces.map((trace) => {
            const latency = formatLatency(trace.latencySeconds);
            const cost = formatCost(trace.totalCost);
            const subline = [
              formatRelative(trace.timestamp),
              latency,
              cost,
              trace.sessionId
                ? tx(t.plugins.langfuse.recent_traces_session, { id: trace.sessionId.slice(0, 8) })
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={trace.id}
                className="flex items-center gap-3 px-3 py-2 bg-secondary/5 hover:bg-secondary/15 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="typo-body text-foreground truncate">
                    {trace.name ?? t.plugins.langfuse.recent_traces_no_name}
                  </div>
                  <div className="typo-caption text-foreground/80 truncate">{subline}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenTrace(trace)}
                  className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 transition-colors flex-shrink-0"
                  title={t.plugins.langfuse.recent_traces_open_label}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="sr-only">{t.plugins.langfuse.recent_traces_open_label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
