import { useState, useCallback, useMemo } from 'react';
import { RefreshCw, Play, Loader2, Server, AlertCircle } from 'lucide-react';
import { listMcpTools, executeMcpTool } from '@/api/agents/mcpTools';
import type { McpTool, McpToolResult } from '@/api/agents/mcpTools';
import { ToolRow } from './McpToolRow';
import { ToolInputForm } from './McpToolInputForm';
import { ToolResultDisplay, EmptyState } from './McpToolResultDisplay';

// ── Component ────────────────────────────────────────────────────

interface McpToolsTabProps {
  credentialId: string;
}

export function McpToolsTab({ credentialId }: McpToolsTabProps) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Selected tool + execution state
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

  // ── Refresh tools ──────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listMcpTools(credentialId);
      setTools(list);
      setHasLoaded(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [credentialId]);

  // ── Execute tool ───────────────────────────────────────────────

  const handleExecute = useCallback(async (toolName: string) => {
    setExecuting(true);
    setExecError(null);
    setResult(null);
    try {
      const args: Record<string, unknown> = {};
      // Parse input values
      for (const [key, val] of Object.entries(inputValues)) {
        if (!val.trim()) continue;
        // Try to parse as JSON for complex types
        try {
          args[key] = JSON.parse(val);
        } catch {
          // intentional: non-critical — JSON parse fallback
          args[key] = val;
        }
      }
      const res = await executeMcpTool(credentialId, toolName, args);
      setResult(res);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, inputValues]);

  // ── Select tool + generate form ────────────────────────────────

  const handleSelectTool = useCallback((tool: McpTool) => {
    setSelectedTool(tool.name);
    setResult(null);
    setExecError(null);
    // Reset inputs based on schema
    const initial: Record<string, string> = {};
    if (tool.input_schema) {
      const props = (tool.input_schema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      if (props) {
        for (const key of Object.keys(props)) {
          initial[key] = '';
        }
      }
    }
    setInputValues(initial);
  }, []);

  const currentTool = useMemo(
    () => tools.find((t) => t.name === selectedTool),
    [tools, selectedTool],
  );

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <Server className="w-4 h-4 text-muted-foreground/40" />
        <span className="text-sm font-medium text-foreground/70">
          {hasLoaded ? `${tools.length} tool${tools.length !== 1 ? 's' : ''}` : 'MCP Tools'}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 disabled:opacity-40 transition-colors"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          {loading ? 'Discovering...' : hasLoaded ? 'Refresh' : 'Discover Tools'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Load error */}
        {loadError && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Initial state */}
        {!hasLoaded && !loading && !loadError && (
          <EmptyState onDiscover={handleRefresh} />
        )}

        {/* Tool list */}
        {hasLoaded && tools.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 space-y-2">
            <Server className="w-8 h-8 text-muted-foreground/15" />
            <p className="text-sm text-muted-foreground/50">No tools found on this MCP server</p>
            <p className="text-sm text-muted-foreground/60">
              The server responded but reported no available tools.
            </p>
          </div>
        )}

        {tools.length > 0 && (
          <div className="space-y-1">
            {tools.map((tool) => (
              <ToolRow
                key={tool.name}
                tool={tool}
                isExpanded={expandedTool === tool.name}
                isSelected={selectedTool === tool.name}
                onToggle={() => setExpandedTool(expandedTool === tool.name ? null : tool.name)}
                onRun={() => handleSelectTool(tool)}
              />
            ))}
          </div>
        )}

        {/* Tool tester */}
        {currentTool && (
          <div className="border-t border-primary/8 pt-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm uppercase tracking-wider text-muted-foreground/60 font-semibold">
                Test Tool
              </span>
              <span className="font-mono text-sm text-foreground/70">{currentTool.name}</span>
              <div className="flex-1" />
              <button
                onClick={() => { setSelectedTool(null); setResult(null); setExecError(null); }}
                className="text-sm text-muted-foreground/40 hover:text-muted-foreground/60"
              >
                Close
              </button>
            </div>

            {/* Input form from schema */}
            <ToolInputForm
              tool={currentTool}
              values={inputValues}
              onChange={setInputValues}
            />

            <button
              onClick={() => handleExecute(currentTool.name)}
              disabled={executing}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {executing ? 'Running...' : 'Execute Tool'}
            </button>

            {/* Error */}
            {execError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
                {execError}
              </div>
            )}

            {/* Result */}
            {result && <ToolResultDisplay result={result} />}
          </div>
        )}
      </div>
    </div>
  );
}
