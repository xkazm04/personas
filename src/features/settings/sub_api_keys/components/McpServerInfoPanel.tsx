/**
 * Read-only "what you'll point clients at" panel.
 *
 * The production HTTP server (engine/webhook.rs:118) auto-starts on
 * 127.0.0.1:9420 — no enable toggle needed. Auth is enforced at the
 * router middleware (require_api_key); revoking a key is the kill
 * switch. This panel just surfaces the URL + endpoint reference so
 * users know what to configure their MCP client with.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Copy, Check, ExternalLink, Server } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { probeMcpServer, type McpServerLiveness } from '@/api/agents/mcpTools';
import { MCP_BASE_URL } from '../libs/mcpServer';

/** How often the panel re-probes the local server's live state. */
const PROBE_INTERVAL_MS = 30_000;

const ENDPOINTS = [
  { method: 'GET', path: '/health', descriptionKey: 'endpoint_health' as const },
  { method: 'POST', path: '/api/build', descriptionKey: 'endpoint_build_start' as const },
  { method: 'GET', path: '/api/build/:id', descriptionKey: 'endpoint_build_status' as const },
  {
    method: 'POST',
    path: '/api/build/:id/answer',
    descriptionKey: 'endpoint_build_answer' as const,
  },
  {
    method: 'POST',
    path: '/api/build/:id/test',
    descriptionKey: 'endpoint_build_test' as const,
  },
  {
    method: 'POST',
    path: '/api/build/:id/promote',
    descriptionKey: 'endpoint_build_promote' as const,
  },
];

export function McpServerInfoPanel() {
  const { t } = useTranslation();
  const s = t.settings.api_keys;
  const [urlCopied, setUrlCopied] = useState(false);
  // null = probe in flight / not yet resolved (Checking…); otherwise the live result.
  const [liveness, setLiveness] = useState<McpServerLiveness | null>(null);
  const mounted = useRef(true);

  const copyUrl = useCallback(async () => {
    try {
      await copyText(MCP_BASE_URL);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) { silentCatch("features/settings/sub_api_keys/components/McpServerInfoPanel:catch1")(err); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const probe = async () => {
      try {
        const result = await probeMcpServer();
        if (mounted.current) setLiveness(result);
      } catch (err) {
        // A failed probe IS the down signal — render Down, not a crash.
        if (mounted.current) setLiveness({ live: false, port: 9420 });
        silentCatch('features/settings/sub_api_keys/components/McpServerInfoPanel:probe')(err);
      }
    };
    probe();
    const timer = setInterval(probe, PROBE_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);

  // Three honest states: checking (probe in flight), running (live), down.
  const statusKey = liveness === null ? 'checking' : liveness.live ? 'running' : 'down';
  const statusLabel =
    statusKey === 'checking'
      ? s.server_status_checking
      : statusKey === 'running'
        ? s.server_status_running
        : s.server_status_down;
  const statusClass =
    statusKey === 'running'
      ? 'text-emerald-400 bg-emerald-400/10'
      : statusKey === 'down'
        ? 'text-red-400 bg-red-400/10'
        : 'text-amber-400 bg-amber-400/10';

  return (
    <SectionCard
      title={s.server_panel_title}
      icon={<Server className="w-4 h-4 text-fuchsia-400" />}
      titleClassName="text-primary"
      action={
        <span
          data-testid="mcp-server-status-chip"
          data-status={statusKey}
          className={`typo-caption px-1.5 py-0.5 rounded ${statusClass}`}
        >
          {statusLabel}
        </span>
      }
    >
      <div className="space-y-3" data-testid="mcp-server-info-panel">
      <p className="typo-caption text-foreground leading-relaxed">{s.server_panel_description}</p>

      <div className="flex items-center gap-2">
        <code className="flex-1 typo-code text-foreground bg-background/60 border border-border/30 rounded-input px-2.5 py-1.5 truncate">
          {MCP_BASE_URL}
        </code>
        <button
          type="button"
          onClick={copyUrl}
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-interactive typo-caption text-foreground hover:bg-secondary/50 transition-colors"
        >
          {urlCopied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              {s.copied}
            </>
          ) : (
            <>
              <Copy size={12} />
              {s.copy}
            </>
          )}
        </button>
      </div>

      <details className="group">
        <summary className="cursor-pointer typo-caption text-foreground hover:text-foreground transition-colors inline-flex items-center gap-1">
          <ExternalLink size={11} />
          {s.endpoints_disclosure}
        </summary>
        <div className="mt-2 space-y-1">
          {ENDPOINTS.map((ep) => (
            <div
              key={`${ep.method}-${ep.path}`}
              className="flex items-center gap-2 typo-caption px-2 py-1 rounded hover:bg-secondary/30"
            >
              <span
                className={`text-[10px] font-mono font-bold w-12 text-center px-1.5 py-0.5 rounded ${
                  ep.method === 'GET'
                    ? 'text-sky-400 bg-sky-400/10'
                    : 'text-emerald-400 bg-emerald-400/10'
                }`}
              >
                {ep.method}
              </span>
              <code className="typo-code text-foreground/90">{ep.path}</code>
              <span className="text-foreground ml-auto truncate">
                {s[ep.descriptionKey]}
              </span>
            </div>
          ))}
        </div>
      </details>

      <p className="typo-caption text-foreground leading-relaxed bg-background/40 rounded p-2">
        <span className="font-medium text-foreground">{s.server_auth_label}:</span>{' '}
        {s.server_auth_description}
      </p>
      </div>
    </SectionCard>
  );
}
