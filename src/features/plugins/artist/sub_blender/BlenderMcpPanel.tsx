import { useState } from 'react';
import {
  Box, Download, RefreshCw, CheckCircle2, XCircle,
  AlertTriangle, Terminal, Send,
} from 'lucide-react';
import { useBlenderMcp } from '../hooks/useBlenderMcp';

export default function BlenderMcpPanel() {
  const { status, checking, installing, check, installMcp } = useBlenderMcp();

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="space-y-1">
        <h2 className="typo-heading text-foreground/90 flex items-center gap-2">
          <Box className="w-5 h-5 text-rose-400" />
          Blender MCP Studio
        </h2>
        <p className="typo-body text-muted-foreground/60">
          Connect to Blender via MCP to generate and edit 3D models and scenes.
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-xl border border-primary/10 bg-card/50 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="typo-heading text-foreground/80">Environment Status</h3>
          <button
            onClick={check}
            disabled={checking}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-secondary/40 hover:bg-secondary/60 text-muted-foreground/70 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {checking && !status ? (
          <div className="flex items-center gap-2 text-muted-foreground/50 typo-body">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Checking environment...
          </div>
        ) : status ? (
          <div className="space-y-3">
            <StatusRow
              label="Blender"
              ok={status.installed}
              detail={status.blenderVersion ?? 'Not found'}
              hint={!status.installed ? 'Install Blender from blender.org' : undefined}
            />
            <StatusRow
              label="Blender MCP"
              ok={status.mcpInstalled}
              detail={status.mcpInstalled ? 'Installed' : 'Not installed'}
            />
            {status.blenderPath && (
              <div className="text-[11px] text-muted-foreground/40 font-mono truncate">
                Path: {status.blenderPath}
              </div>
            )}
          </div>
        ) : (
          <p className="typo-body text-muted-foreground/40">Click Refresh to check.</p>
        )}
      </div>

      {/* Install MCP */}
      {status && !status.mcpInstalled && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <span className="typo-heading text-foreground/80">Install Blender MCP</span>
          </div>
          <p className="typo-body text-muted-foreground/60">
            The <code className="text-xs bg-secondary/40 px-1.5 py-0.5 rounded">blender-mcp</code> package
            enables MCP communication with Blender. It will be installed via pip.
          </p>
          <button
            onClick={installMcp}
            disabled={installing || !status.installed}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors disabled:opacity-50 typo-heading"
          >
            <Download className={`w-4 h-4 ${installing ? 'animate-bounce' : ''}`} />
            {installing ? 'Installing...' : 'Install blender-mcp'}
          </button>
          {!status.installed && (
            <p className="text-[11px] text-amber-400/60">Blender must be installed first.</p>
          )}
        </div>
      )}

      {/* Session Panel — shown when MCP is installed */}
      {status?.mcpInstalled && <BlenderSessionSection />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session Section — prompt-based interaction
// ---------------------------------------------------------------------------

function BlenderSessionSection() {
  const [prompt, setPrompt] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);

  const sendPrompt = () => {
    if (!prompt.trim()) return;
    setHistory((h) => [...h, { role: 'user', text: prompt }]);
    // TODO: Route through Blender MCP session when backend supports start/send
    setHistory((h) => [
      ...h,
      { role: 'assistant', text: 'Blender MCP session commands will be available once the MCP server is running. Start Blender with the MCP addon enabled.' },
    ]);
    setPrompt('');
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-card/50 p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="w-4 h-4 text-rose-400" />
        <h3 className="typo-heading text-foreground/80">Blender Session</h3>
      </div>
      <p className="typo-body text-muted-foreground/60">
        Send prompts to Blender via MCP. Make sure Blender is open with the MCP addon enabled.
      </p>

      {/* Chat history */}
      {history.length > 0 && (
        <div className="max-h-64 overflow-y-auto space-y-2 rounded-lg bg-background/50 p-3 border border-primary/5">
          {history.map((msg, i) => (
            <div
              key={i}
              className={`text-xs ${
                msg.role === 'user'
                  ? 'text-rose-400/80 font-medium'
                  : 'text-muted-foreground/60'
              }`}
            >
              <span className="font-mono text-[10px] uppercase tracking-wide mr-2 opacity-50">
                {msg.role}
              </span>
              {msg.text}
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendPrompt()}
          placeholder="e.g. Create a low-poly tree with green leaves..."
          className="flex-1 px-3 py-2 rounded-lg bg-background/80 border border-primary/10 text-sm text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-rose-500/30"
        />
        <button
          onClick={sendPrompt}
          disabled={!prompt.trim()}
          className="px-3 py-2 rounded-lg bg-rose-500/15 text-rose-400 hover:bg-rose-500/25 transition-colors disabled:opacity-30"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status Row helper
// ---------------------------------------------------------------------------

function StatusRow({
  label,
  ok,
  detail,
  hint,
}: {
  label: string;
  ok: boolean;
  detail: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      {ok ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
      ) : (
        <XCircle className="w-4 h-4 text-red-400/60" />
      )}
      <span className="typo-heading text-foreground/70 w-28">{label}</span>
      <span className="typo-body text-muted-foreground/50 flex-1">{detail}</span>
      {hint && <span className="text-[11px] text-amber-400/50">{hint}</span>}
    </div>
  );
}
