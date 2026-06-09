import { useState } from "react";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, TestTube2 } from "lucide-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { useTranslation } from "@/i18n/useTranslation";
import { langfuseOpenAuthenticatedUI, langfuseSmokeTrace } from "@/api/langfuse";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import type { LangfuseSmokeTraceResult } from "@/lib/bindings/LangfuseSmokeTraceResult";

interface SmokeTraceButtonProps {
  config: LangfuseConfig;
  /// Called after a successful send so callers can refresh the trace list.
  onSent?: () => void;
}

type LastResult =
  | { kind: "success"; result: LangfuseSmokeTraceResult }
  | { kind: "error"; error: string };

export function SmokeTraceButton({ config, onSent }: SmokeTraceButtonProps) {
  const { t, tx } = useTranslation();
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<LastResult | null>(null);

  const onClick = async () => {
    setSending(true);
    setLast(null);
    try {
      const result = await langfuseSmokeTrace();
      setLast({ kind: "success", result });
      onSent?.();
    } catch (e) {
      setLast({
        kind: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSending(false);
    }
  };

  const openTrace = () => {
    if (last?.kind !== "success") return;
    const projectId = last.result.projectId ?? config.projectId ?? null;
    if (!projectId) {
      void langfuseOpenAuthenticatedUI().catch(() => {});
      return;
    }
    const tracePath = `/project/${projectId}/traces/${last.result.traceId}`;
    if (config.managed) {
      void langfuseOpenAuthenticatedUI(tracePath).catch(() => {});
      return;
    }
    const url = `${config.host.replace(/\/$/, "")}${tracePath}`;
    void openExternal(url).catch(() => {});
  };

  return (
    <section className="rounded-card border border-primary/10 bg-secondary/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="typo-caption uppercase tracking-widest text-foreground">
            {t.plugins.langfuse.smoke_trace_section}
          </div>
          <div className="typo-caption text-foreground mt-1">
            {t.plugins.langfuse.smoke_trace_intro}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onClick()}
          disabled={sending}
          className="inline-flex items-center gap-2 px-3 py-1.5 typo-body rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <TestTube2 className="w-4 h-4" />
          )}
          {sending
            ? t.plugins.langfuse.smoke_trace_sending
            : t.plugins.langfuse.smoke_trace_button}
        </button>
      </div>

      {last?.kind === "success" && (
        <div className="flex items-center justify-between gap-2 p-2 typo-caption rounded-card border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{t.plugins.langfuse.smoke_trace_success}</span>
          </div>
          <button
            type="button"
            onClick={openTrace}
            className="inline-flex items-center gap-1 px-2 py-1 typo-caption rounded-modal border border-emerald-500/30 bg-emerald-500/15 hover:bg-emerald-500/25 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            {t.plugins.langfuse.smoke_trace_view_link}
          </button>
        </div>
      )}

      {last?.kind === "error" && (
        <div className="flex items-start gap-2 p-2 typo-caption rounded-card border border-red-500/20 bg-red-500/5 text-red-300">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{tx(t.plugins.langfuse.smoke_trace_error, { error: last.error })}</span>
        </div>
      )}
    </section>
  );
}
