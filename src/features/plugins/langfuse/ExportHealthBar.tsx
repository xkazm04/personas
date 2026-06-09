import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  EyeOff,
  FlaskConical,
  Power,
  RefreshCw,
} from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { langfuseGetExportStats } from "@/api/langfuse";
import type { LangfuseExportStats } from "@/lib/bindings/LangfuseExportStats";
import { silentCatch } from "@/lib/silentCatch";

/// Refresh the health snapshot once every 30s while the panel is mounted.
/// Counters live in process memory and update on the exporter worker tick —
/// 30s is a comfortable balance between liveness and IPC chatter.
const POLL_INTERVAL_MS = 30_000;

function formatRelative(unixSecs: bigint | null | undefined): string | null {
  if (unixSecs == null) return null;
  const ms = Number(unixSecs) * 1000;
  const diff = Date.now() - ms;
  if (diff < 0) return new Date(ms).toLocaleString();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function ExportHealthBar() {
  const { t, tx } = useTranslation();
  const [stats, setStats] = useState<LangfuseExportStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await langfuseGetExportStats();
      setStats(next);
    } catch (e) {
      silentCatch("Langfuse:health:load")(e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!stats) return null;

  const onRefresh = () => {
    setRefreshing(true);
    void load();
  };

  const lastExport = formatRelative(stats.lastExportAt);
  const lastError = formatRelative(stats.lastErrorAt);
  const hasErrors = stats.failureTotal > 0n;
  const showDisabledHint = !stats.enabled;
  const showInstallHint = stats.enabled && !stats.exporterInstalled;

  return (
    <section className="rounded-card border border-primary/10 bg-secondary/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="typo-caption uppercase tracking-widest text-foreground">
          {t.plugins.langfuse.health_section}
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-1 px-2 py-0.5 typo-caption rounded-modal border border-primary/15 bg-secondary/40 text-foreground hover:bg-secondary/60 disabled:opacity-40 transition-colors"
        >
          <RefreshCw
            className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      {/* Three-stat tile row. Errors tile is clickable when failures exist. */}
      <div className="grid grid-cols-3 gap-2">
        <StatTile
          label={t.plugins.langfuse.health_total_label}
          value={stats.successTotal.toString()}
          tone="neutral"
        />
        <StatTile
          label={t.plugins.langfuse.health_last_hour_label}
          value={stats.successLastHour.toString()}
          tone="success"
        />
        <StatTile
          label={t.plugins.langfuse.health_errors_label}
          value={stats.failureTotal.toString()}
          tone={hasErrors ? "error" : "muted"}
          onClick={hasErrors ? () => setErrorsOpen((v) => !v) : undefined}
          expanded={errorsOpen}
        />
      </div>

      {/* Last-export line */}
      <div className="typo-caption text-foreground">
        {lastExport
          ? tx(t.plugins.langfuse.health_last_export, { when: lastExport })
          : t.plugins.langfuse.health_last_export_never}
      </div>

      {/* Last error (only when present and drill-down is closed) */}
      {hasErrors && stats.lastError && !errorsOpen && (
        <div className="flex items-start gap-2 px-2 py-1.5 typo-caption rounded-card border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span className="truncate" title={stats.lastError}>
            {tx(t.plugins.langfuse.health_last_error, {
              when: lastError ?? "—",
              message: stats.lastError,
            })}
          </span>
        </div>
      )}

      {/* Drill-down: recent failures list */}
      {errorsOpen && (
        <div className="rounded-card border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          {stats.recentFailures.length === 0 ? (
            <div className="px-3 py-2 typo-caption text-foreground">
              {t.plugins.langfuse.health_recent_failures_empty}
            </div>
          ) : (
            <ul className="divide-y divide-amber-500/10">
              {stats.recentFailures.slice(0, 5).map((f) => (
                <li
                  key={`${f.at.toString()}-${f.message.slice(0, 16)}`}
                  className="px-3 py-2 typo-caption text-amber-200/90"
                >
                  <div className="text-foreground typo-caption">
                    {formatRelative(f.at) ?? "—"}
                  </div>
                  <div className="break-words">{f.message}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* State badges */}
      <div className="flex items-center gap-2 flex-wrap typo-caption">
        <Badge
          icon={Power}
          on={stats.enabled}
          onLabel={t.plugins.langfuse.health_export_on}
          offLabel={t.plugins.langfuse.health_export_off}
        />
        <Badge
          icon={EyeOff}
          on={stats.redactContent}
          onLabel={t.plugins.langfuse.health_redaction_on}
          offLabel={t.plugins.langfuse.health_redaction_off}
        />
        <Badge
          icon={FlaskConical}
          on={stats.pushLabScores}
          onLabel={t.plugins.langfuse.health_lab_scores_on}
          offLabel={t.plugins.langfuse.health_lab_scores_off}
        />
      </div>

      {showDisabledHint && (
        <div className="px-2 py-1.5 typo-caption rounded-card border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
          {t.plugins.langfuse.health_disabled_hint}
        </div>
      )}
      {showInstallHint && (
        <div className="px-2 py-1.5 typo-caption rounded-card border border-amber-500/20 bg-amber-500/5 text-amber-200/90">
          {t.plugins.langfuse.health_exporter_not_installed}
        </div>
      )}
    </section>
  );
}

type StatTone = "neutral" | "success" | "error" | "muted";

function StatTile({
  label,
  value,
  tone,
  onClick,
  expanded,
}: {
  label: string;
  value: string;
  tone: StatTone;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-emerald-300"
      : tone === "error"
        ? "text-red-300"
        : tone === "muted"
          ? "text-foreground/60"
          : "text-foreground";
  const baseClass =
    "rounded-card border border-primary/10 bg-secondary/20 px-3 py-2 text-center";
  const interactiveClass = onClick
    ? "cursor-pointer hover:bg-secondary/40 transition-colors w-full"
    : "";
  const body = (
    <>
      <div className={`typo-heading ${toneClass}`}>{value}</div>
      <div className="typo-caption text-foreground mt-0.5 flex items-center justify-center gap-1">
        {label}
        {onClick &&
          (expanded ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          ))}
      </div>
    </>
  );
  if (!onClick) {
    return <div className={baseClass}>{body}</div>;
  }
  return (
    <button type="button" onClick={onClick} className={`${baseClass} ${interactiveClass}`}>
      {body}
    </button>
  );
}

function Badge({
  icon: Icon,
  on,
  onLabel,
  offLabel,
}: {
  icon: typeof Power;
  on: boolean;
  onLabel: string;
  offLabel: string;
}) {
  const tone = on
    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
    : "bg-secondary/40 text-foreground/70 border-primary/15";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${tone}`}
    >
      <Icon className="w-3 h-3" />
      {on ? onLabel : offLabel}
    </span>
  );
}
