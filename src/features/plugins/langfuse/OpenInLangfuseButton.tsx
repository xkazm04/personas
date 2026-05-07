import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { langfuseGetConfig, langfuseOpenAuthenticatedUI, langfuseStackOpenUI } from "@/api/langfuse";
import { getExecutionTrace } from "@/api/agents/executions";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import type { LangfuseConfig } from "@/lib/bindings/LangfuseConfig";
import { silentCatch } from "@/lib/silentCatch";

interface OpenInLangfuseButtonProps {
  executionId: string;
  personaId: string;
}

/**
 * Renders a deep-link to the Langfuse UI for this execution. Visible only
 * when the user has the **managed self-host** connected (Phase 1b doesn't
 * support deep-linking into a manual instance because we don't know the
 * caller's project id) and a trace exists for the execution.
 */
export function OpenInLangfuseButton({ executionId, personaId }: OpenInLangfuseButtonProps) {
  const [config, setConfig] = useState<LangfuseConfig | null>(null);
  const [traceId, setTraceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([langfuseGetConfig(), getExecutionTrace(executionId, personaId)])
      .then(([cfg, tr]) => {
        if (cancelled) return;
        setConfig(cfg);
        setTraceId(tr?.trace_id ?? null);
      })
      .catch(silentCatch("OpenInLangfuseButton:load"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [executionId, personaId]);

  if (loading) return null;
  if (!config || !config.enabled || !traceId) return null;
  // Need a project id to deep-link. Managed stack always has one
  // (`personas-default`); manual connections only get the button if the user
  // supplied a project id in the connection form.
  if (!config.projectId) return null;

  const tracePath = `/project/${config.projectId}/traces/${traceId}`;
  const url = `${config.host.replace(/\/$/, "")}${tracePath}`;

  const onClick = async () => {
    // For the managed stack, take the authenticated shortcut: backend
    // signs the user in and redirects straight to the trace URL.
    if (config.managed) {
      try {
        await langfuseOpenAuthenticatedUI(tracePath);
        return;
      } catch {
        // Fall through to the plain open path on failure.
      }
    }
    try {
      await openExternal(url);
    } catch {
      try {
        await langfuseStackOpenUI();
      } catch {
        // openExternal isn't available on every platform; best effort.
      }
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      className="inline-flex items-center gap-2 px-3 py-1.5 typo-heading rounded-modal border border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 transition-colors"
      title={url}
    >
      <ExternalLink className="w-3.5 h-3.5" />
      Open in Langfuse
    </button>
  );
}
