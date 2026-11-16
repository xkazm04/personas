/**
 * Read-only "what you'll point clients at" panel.
 *
 * The production HTTP server (engine/webhook.rs) auto-starts on 127.0.0.1,
 * port 9420 unless PERSONAS_WEBHOOK_PORT overrides it — no enable toggle
 * needed. The URL shown is the port the liveness probe actually reached.
 * Auth is enforced at the router middleware (require_api_key); revoking a
 * key is the kill switch. This panel just surfaces the URL + endpoint reference so
 * users know what to configure their MCP client with.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { Copy, Check, ExternalLink, Server } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { probeMcpServer, type McpServerLiveness } from '@/api/agents/mcpTools';
import { DEFAULT_MCP_PORT, mcpBaseUrl } from '../libs/mcpServer';
import Button from '@/features/shared/components/buttons/Button';

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
  { method: 'GET', path: '/api/build/:id/pending', descriptionKey: 'endpoint_build_pending' as const },
  { method: 'POST', path: '/api/build/:id/cancel', descriptionKey: 'endpoint_build_cancel' as const },
  { method: 'GET', path: '/api/personas', descriptionKey: 'endpoint_personas_list' as const },
  { method: 'GET', path: '/api/personas/:id', descriptionKey: 'endpoint_persona_get' as const },
  { method: 'POST', path: '/api/execute/:id', descriptionKey: 'endpoint_execute' as const },
  { method: 'GET', path: '/api/executions', descriptionKey: 'endpoint_executions_list' as const },
  { method: 'GET', path: '/api/executions/:id', descriptionKey: 'endpoint_execution_get' as const },
];

export function McpServerInfoPanel() {
  const { t } = useTranslation();
  const s = t.settings.api_keys;
  const [urlCopied, setUrlCopied] = useState(false);
  // null = probe in flight / not yet resolved (Checking…); otherwise the live result.
  const [liveness, setLiveness] = useState<McpServerLiveness | null>(null);
  const mounted = useRef(true);
  // The probe reports the port the server is really on; the default only
  // stands in until it answers.
  const baseUrl = mcpBaseUrl(liveness?.port ?? DEFAULT_MCP_PORT);

  const copyUrl = useCallback(async () => {
    try {
      await copyText(baseUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch (err) { silentCatch("features/settings/sub_api_keys/components/McpServerInfoPanel:catch1")(err); }
  }, [baseUrl]);

  useEffect(() => {
    mounted.current = true;
    const probe = async () => {
      try {
        const result = await probeMcpServer();
        if (mounted.current) setLiveness(result);
      } catch (err) {
        // A failed probe IS the down signal — render Down, not a crash.
        if (mounted.current) setLiveness({ live: false, port: DEFAULT_MCP_PORT });
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
      ? 'text-status-success bg-status-success/10'
      : statusKey === 'down'
        ? 'text-status-error bg-status-error/10'
        : 'text-status-warning bg-status-warning/10';

  return (
    <SectionCard
      title={s.server_panel_title}
      icon={<Server className="w-4 h-4 text-role-agent" />}
      titleClassName="text-ink-1"
      action={
        <span
          data-testid="mcp-server-status-chip"
          data-status={statusKey}
          className={`typo-caption px-1.5 py-0.5 rounded-interactive ${statusClass}`}
        >
          {statusLabel}
        </span>
      }
    >
      <div className="space-y-3" data-testid="mcp-server-info-panel">
      <p className="typo-caption text-foreground">{s.server_panel_description}</p>

      <div className="flex items-center gap-2">
        <code className="flex-1 typo-code text-foreground bg-background/60 border border-border/30 rounded-input px-2.5 py-1.5 truncate">
          {baseUrl}
        </code>
        <Button
          type="button"
          onClick={copyUrl}
          variant="ghost"
          size="sm"
        >
          {urlCopied ? (
            <>
              <Check size={12} className="text-status-success" />
              {s.copied}
            </>
          ) : (
            <>
              <Copy size={12} />
              {s.copy}
            </>
          )}
        </Button>
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
              className="flex items-center gap-2 typo-caption px-2 py-1 rounded-interactive hover:bg-surface-1"
            >
              <span
                className={`typo-label font-mono w-12 text-center px-1.5 py-0.5 rounded-interactive ${
                  ep.method === 'GET'
                    ? 'text-status-info bg-status-info/10'
                    : 'text-status-success bg-status-success/10'
                }`}
              >
                {ep.method}
              </span>
              <code className="typo-code text-ink-1">{ep.path}</code>
              <span className="text-foreground ml-auto truncate">
                {s[ep.descriptionKey]}
              </span>
            </div>
          ))}
        </div>
      </details>

      <p className="typo-caption text-foreground bg-background/40 rounded-interactive p-2">
        <span className="font-medium text-foreground">{s.server_auth_label}:</span>{' '}
        {s.server_auth_description}
      </p>
      </div>
    </SectionCard>
  );
}
