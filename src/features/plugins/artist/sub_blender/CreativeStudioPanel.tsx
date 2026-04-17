import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Wand2, Download, RefreshCw, CheckCircle2, XCircle,
  Send, Square, Trash2, ExternalLink, Sparkles,
} from 'lucide-react';
import { useBlenderMcp } from '../hooks/useBlenderMcp';
import { useCreativeSession } from '../hooks/useCreativeSession';
import { useCreativeConnectors } from '../hooks/useCreativeConnectors';
import { useSystemStore } from '@/stores/systemStore';
import { getConnectorMeta, ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { useTranslation } from '@/i18n/useTranslation';
import CreativeSessionHistory from './CreativeSessionHistory';

export default function CreativeStudioPanel() {
  const { t } = useTranslation();
  const { status, checking, installing, check, installMcp } = useBlenderMcp();
  const connectors = useCreativeConnectors();
  const blenderMcpState = useSystemStore((s) => s.blenderMcpState);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="typo-section-title flex items-center gap-2">
          <Wand2 className="w-5 h-5 text-rose-400" />
          {t.plugins.artist.creative_studio_title}
        </h2>
        <p className="typo-body text-foreground">
          {t.plugins.artist.creative_studio_desc}
        </p>
      </div>

      {/* Environment Status — compact, cached */}
      <EnvironmentStatus
        status={status}
        checking={checking}
        installing={installing}
        onCheck={check}
        onInstall={installMcp}
        connectors={connectors}
      />

      {/* Past sessions */}
      <CreativeSessionHistory />

      {/* Creative Session Chat */}
      <CreativeSessionChat
        blenderReady={blenderMcpState === 'installed' || blenderMcpState === 'running'}
        connectors={connectors}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment Status — collapsible, with connector detection + MCP start
// ---------------------------------------------------------------------------

interface ConnectorInfoType {
  id: string;
  name: string;
  connected: boolean;
  healthy: boolean;
}

function EnvironmentStatus({
  status,
  checking,
  installing,
  onCheck,
  onInstall,
  connectors,
}: {
  status: import('@/api/artist').BlenderMcpStatus | null;
  checking: boolean;
  installing: boolean;
  onCheck: () => void;
  onInstall: () => void;
  connectors: ConnectorInfoType[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const navigateToVault = useCallback(() => {
    setSidebarSection('credentials');
  }, [setSidebarSection]);

  // Only trigger the (potentially slow) subprocess check when the user
  // actually expands the panel — keeps the Creative Studio tab from freezing
  // on load while pip / blender-mcp detection runs.
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !status && !checking) {
        onCheck();
      }
      return next;
    });
  }, [status, checking, onCheck]);

  const allReady = status?.installed && status?.mcpInstalled &&
    connectors.some((c) => c.connected);

  return (
    <div className="rounded-modal border border-primary/10 bg-card/50 overflow-hidden">
      {/* Header — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={toggleExpanded}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleExpanded(); }}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-secondary/20 transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <h3 className="typo-section-title">{t.plugins.artist.env_status}</h3>
          {!expanded && (
            <div className="flex items-center gap-1.5 ml-2">
              {checking && !status ? (
                <span className="flex items-center gap-1 text-md text-foreground">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  {t.plugins.artist.checking_env}
                </span>
              ) : status ? (
                <>
                  <StatusDot ok={!!status.installed} />
                  <StatusDot ok={!!status.mcpInstalled} />
                  {connectors.filter((c) => c.connected).map((c) => (
                    <StatusDot key={c.id} ok={c.healthy} />
                  ))}
                  {allReady ? (
                    <span className="text-md text-emerald-400 ml-1">{t.plugins.artist.ready}</span>
                  ) : (
                    <span className="text-md text-foreground ml-1">{t.plugins.artist.status_partial}</span>
                  )}
                </>
              ) : (
                <span className="text-md text-foreground">{t.plugins.artist.status_not_checked}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onCheck(); }}
            disabled={checking}
            className="flex items-center gap-1 px-2 py-1 rounded text-md bg-secondary/40 hover:bg-secondary/60 text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />
            {t.plugins.artist.refresh}
          </button>
          <span className="text-foreground text-md">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-4 space-y-4 border-t border-primary/5 pt-3">
          {/* Blender + MCP status */}
          {checking && !status ? (
            <div className="flex items-center gap-2 text-foreground typo-body">
              <RefreshCw className="w-4 h-4 animate-spin" />
              {t.plugins.artist.checking_env}
            </div>
          ) : status ? (
            <div className="space-y-2">
              <StatusRow
                label={t.plugins.artist.blender_label}
                ok={status.installed}
                detail={status.blenderVersion ?? t.plugins.artist.not_found}
                hint={!status.installed ? t.plugins.artist.install_from_blender : undefined}
              />
              <StatusRow
                label={t.plugins.artist.blender_mcp_label}
                ok={status.mcpInstalled}
                detail={status.mcpInstalled ? t.plugins.artist.installed : t.plugins.artist.not_installed}
                action={!status.mcpInstalled && status.installed ? (
                  <button
                    onClick={onInstall}
                    disabled={installing}
                    className="flex items-center gap-1 px-2 py-1 rounded text-md bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
                  >
                    <Download className={`w-3 h-3 ${installing ? 'animate-bounce' : ''}`} />
                    {installing ? t.plugins.artist.installing : t.plugins.artist.install}
                  </button>
                ) : undefined}
              />
              {status.blenderPath && (
                <div className="text-md text-foreground font-mono truncate ml-7">
                  {status.blenderPath}
                </div>
              )}
            </div>
          ) : null}

          {/* Divider */}
          <div className="border-t border-primary/5" />

          {/* Creative tool connectors */}
          <div className="space-y-2">
            <span className="typo-label text-foreground">
              {t.plugins.artist.image_gen_tools}
            </span>
            {connectors.map((c) => {
              const meta = getConnectorMeta(c.id);
              return (
                <div key={c.id} className="flex items-center gap-3">
                  {c.connected ? (
                    <CheckCircle2 className={`w-4 h-4 ${c.healthy ? 'text-emerald-400' : 'text-amber-400'}`} />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <div className="flex items-center gap-2 w-28">
                    {meta.iconUrl ? (
                      <ThemedConnectorIcon url={meta.iconUrl} label={meta.label} color={meta.color} size="w-3.5 h-3.5" />
                    ) : (
                      <meta.Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                    )}
                    <span className="text-md text-foreground">{c.name}</span>
                  </div>
                  <span className="typo-body text-foreground text-md flex-1">
                    {c.connected
                      ? c.healthy ? t.plugins.artist.connected_healthy : t.plugins.artist.connected_not_verified
                      : t.plugins.artist.not_connected}
                  </span>
                  {!c.connected && (
                    <button
                      onClick={navigateToVault}
                      className="flex items-center gap-1 px-2 py-1 rounded text-md bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {t.plugins.artist.connect}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creative Session Chat — CLI-backed with streaming
// ---------------------------------------------------------------------------

function CreativeSessionChat({
  blenderReady,
  connectors,
}: {
  blenderReady: boolean;
  connectors: ConnectorInfoType[];
}) {
  const { t } = useTranslation();
  const { running, output, sendPrompt, cancel, clear } = useCreativeSession();
  const [prompt, setPrompt] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new output
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output.length]);

  // Build available tools list
  const availableTools = useMemo(() => {
    const tools: string[] = [];
    if (blenderReady) tools.push('blender');
    for (const c of connectors) {
      if (c.connected) tools.push(c.id);
    }
    return tools;
  }, [blenderReady, connectors]);

  const handleSend = useCallback(() => {
    if (!prompt.trim() || running) return;
    sendPrompt(prompt.trim(), availableTools);
    setPrompt('');
  }, [prompt, running, sendPrompt, availableTools]);

  return (
    <div className="rounded-modal border border-primary/10 bg-card/50 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-primary/5">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-rose-400" />
          <h3 className="typo-section-title">{t.plugins.artist.creative_session}</h3>
          {running && (
            <span className="flex items-center gap-1 text-md text-emerald-400 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {t.plugins.artist.streaming}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Tool badges */}
          {availableTools.map((tool) => (
            <span
              key={tool}
              className="px-1.5 py-0.5 rounded text-md bg-rose-500/10 text-rose-400"
            >
              {tool === 'blender'
                ? t.plugins.artist.tool_blender
                : tool === 'leonardo_ai'
                  ? t.plugins.artist.tool_leonardo
                  : tool === 'gemini'
                    ? t.plugins.artist.tool_gemini
                    : tool}
            </span>
          ))}
          {availableTools.length === 0 && (
            <span className="text-md text-amber-400">{t.plugins.artist.no_tools_connected}</span>
          )}
          {output.length > 0 && (
            <button
              onClick={clear}
              disabled={running}
              className="p-1 rounded hover:bg-secondary/40 text-foreground disabled:opacity-30 ml-2"
              title={t.plugins.artist.clear_session}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Output area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-[200px] max-h-[400px] overflow-y-auto p-4 space-y-1.5"
      >
        {output.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-8 space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/5 border border-rose-500/10 flex items-center justify-center">
              <Wand2 className="w-6 h-6 text-rose-400/30" />
            </div>
            <p className="typo-body text-foreground max-w-sm text-center">
              {t.plugins.artist.empty_session_hint}
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {[
                t.plugins.artist.example_forest,
                t.plugins.artist.example_portrait,
                t.plugins.artist.example_mockup,
              ].map((example) => (
                <button
                  key={example}
                  onClick={() => setPrompt(example)}
                  className="px-3 py-1.5 rounded-card text-md bg-secondary/40 text-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : (
          output.map((line, i) => (
            <OutputLine key={i} line={line} />
          ))
        )}
        {running && <span className="inline-block w-1.5 h-3.5 bg-rose-400 animate-pulse" />}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-4 py-3 border-t border-primary/5 bg-background/30">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={
            availableTools.length > 0
              ? t.plugins.artist.describe_create
              : t.plugins.artist.connect_tools_first
          }
          disabled={running}
          className="flex-1 px-3 py-2 rounded-card bg-background/80 border border-primary/10 text-md text-foreground placeholder:text-foreground focus:outline-none focus:border-rose-500/30 disabled:opacity-50"
        />
        {running ? (
          <button
            onClick={cancel}
            className="px-3 py-2 rounded-card bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            title={t.plugins.artist.cancel}
          >
            <Square className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!prompt.trim()}
            className="px-3 py-2 rounded-card bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors disabled:opacity-30"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Output line renderer
// ---------------------------------------------------------------------------

function OutputLine({ line }: { line: string }) {
  const isUser = line.startsWith('[You]');
  const isTool = line.startsWith('[Tool]');
  const isMilestone = line.startsWith('[Creative]') || line.startsWith('[Complete]');
  const isError = line.startsWith('[Error]');
  const isSystem = line.startsWith('[System]');

  let className = 'text-md leading-relaxed ';
  if (isUser) className += 'text-rose-400 font-medium';
  else if (isTool) className += 'text-blue-400 font-mono';
  else if (isMilestone) className += 'text-emerald-400 font-medium';
  else if (isError) className += 'text-red-400';
  else if (isSystem) className += 'text-amber-400';
  else className += 'text-foreground';

  return (
    <div className={`${className} hover:bg-secondary/10 px-1 -mx-1 rounded`}>
      {line}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-amber-400'}`} />
  );
}

function StatusRow({
  label,
  ok,
  detail,
  hint,
  action,
}: {
  label: string;
  ok: boolean;
  detail: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400" />
      )}
      <span className="text-md text-foreground w-28 font-medium">{label}</span>
      <span className="typo-body text-foreground text-md flex-1">{detail}</span>
      {hint && <span className="text-md text-amber-400">{hint}</span>}
      {action}
    </div>
  );
}
