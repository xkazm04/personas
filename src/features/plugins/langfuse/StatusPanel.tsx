import { CheckCircle2, Circle, Power, RotateCw } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";

interface StatusPanelProps {
  config: LangfuseConfig | null;
  onDisconnect: () => void;
  disconnecting: boolean;
}

function formatRelative(timestamp: bigint | number | null): string | null {
  if (timestamp == null) return null;
  const seconds = typeof timestamp === "bigint" ? Number(timestamp) : timestamp;
  const ms = seconds * 1000;
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

export function StatusPanel({ config, onDisconnect, disconnecting }: StatusPanelProps) {
  const { t, tx } = useTranslation();
  if (!config) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 typo-body rounded-card border border-primary/10 bg-secondary/20 text-foreground/80">
        <Circle className="w-4 h-4" />
        {t.plugins.langfuse.not_connected}
      </div>
    );
  }

  const relative = formatRelative(config.lastTestedAt);
  const isOn = config.enabled;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 px-3 py-2 rounded-card border border-emerald-500/20 bg-emerald-500/5">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <div className="flex-1 min-w-0">
          <div className="typo-body text-foreground/90 truncate">
            {t.plugins.langfuse.connected} — {config.host.replace(/^https?:\/\//, "")}
          </div>
          {relative && (
            <div className="typo-caption text-foreground/80">
              {tx(t.plugins.langfuse.last_tested, { when: relative })}
            </div>
          )}
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full typo-caption ${isOn ? "bg-emerald-500/15 text-emerald-300" : "bg-secondary/40 text-foreground/80"}`}>
          <Power className="w-3 h-3" />
          {isOn ? "ON" : "OFF"}
        </span>
      </div>

      {!isOn && (
        <div className="px-3 py-2 typo-caption text-foreground/80 rounded-card border border-amber-500/20 bg-amber-500/5">
          {t.plugins.langfuse.export_off}
        </div>
      )}

      <div className="px-3 py-2 typo-caption text-foreground/80 rounded-card border border-primary/10 bg-secondary/10">
        {t.plugins.langfuse.no_export_yet}
      </div>

      <button
        type="button"
        onClick={onDisconnect}
        disabled={disconnecting}
        className="inline-flex items-center gap-2 px-4 py-2 typo-body rounded-modal border border-red-500/20 bg-red-500/5 text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-colors"
      >
        {disconnecting ? <RotateCw className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
        {t.plugins.langfuse.disconnect}
      </button>
    </div>
  );
}
