import { useState, useCallback, useMemo } from 'react';
import { RefreshCw, Play, Loader2, Server, ChevronDown, ChevronRight, AlertCircle, Clock, Check } from 'lucide-react';
import { listMcpTools, executeMcpTool } from '@/api/agents/mcpTools';
import type { McpTool, McpToolResult } from '@/api/agents/mcpTools';

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

// ── Tool row ─────────────────────────────────────────────────────

function ToolRow({
  tool,
  isExpanded,
  isSelected,
  onToggle,
  onRun,
}: {
  tool: McpTool;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onRun: () => void;
}) {
  return (
    <div className={`border rounded-lg overflow-hidden transition-colors ${
      isSelected ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-primary/8 hover:border-primary/15'
    }`}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/20 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        )}

        <span className="font-mono text-sm text-foreground/80 truncate flex-1">
          {tool.name}
        </span>

        {tool.description && (
          <span className="text-sm text-muted-foreground/60 truncate max-w-[300px] hidden sm:inline">
            {tool.description}
          </span>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onRun(); }}
          className="flex items-center gap-1 px-2 py-1 rounded text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors shrink-0"
        >
          <Play className="w-2.5 h-2.5" />
          Run
        </button>
      </button>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/5 bg-secondary/10 space-y-2">
          {tool.description && (
            <p className="text-sm text-muted-foreground/60 leading-relaxed">{tool.description}</p>
          )}
          {tool.input_schema && (
            <div className="space-y-1">
              <span className="text-sm uppercase tracking-wider text-muted-foreground/60 font-semibold">
                Input Schema
              </span>
              <pre className="text-sm text-muted-foreground/60 font-mono bg-secondary/20 rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify(tool.input_schema, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tool input form ──────────────────────────────────────────────

function ToolInputForm({
  tool,
  values,
  onChange,
}: {
  tool: McpTool;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
}) {
  const schema = tool.input_schema as Record<string, unknown> | null;
  if (!schema) {
    return (
      <p className="text-sm text-muted-foreground/60">This tool takes no input parameters.</p>
    );
  }

  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = ((schema.required || []) as string[]);
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/60">This tool takes no input parameters.</p>
    );
  }

  return (
    <div className="space-y-2">
      {keys.map((key) => {
        const prop = properties[key]!;
        const isRequired = required.includes(key);
        const propType = (prop.type as string) || 'string';
        const description = prop.description as string | undefined;
        const isComplex = ['object', 'array'].includes(propType);

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-sm font-mono text-foreground/70">{key}</label>
              {isRequired && <span className="text-sm text-amber-400/60">required</span>}
              <span className="text-sm text-violet-400/50">{propType}</span>
            </div>
            {description && (
              <p className="text-sm text-muted-foreground/60">{description}</p>
            )}
            {isComplex ? (
              <textarea
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                placeholder={`Enter JSON ${propType}...`}
                rows={3}
                className="w-full px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 resize-none focus:outline-none focus:border-primary/25"
              />
            ) : propType === 'boolean' ? (
              <select
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                className="px-2 py-1.5 rounded text-sm bg-secondary/20 border border-primary/10 text-foreground/70 focus:outline-none focus:border-primary/25"
              >
                <option value="">— select —</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : (
              <input
                type={propType === 'number' || propType === 'integer' ? 'number' : 'text'}
                value={values[key] || ''}
                onChange={(e) => onChange({ ...values, [key]: e.target.value })}
                placeholder={`Enter ${propType}...`}
                className="w-full px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary/25"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tool result display ──────────────────────────────────────────

function ToolResultDisplay({ result }: { result: McpToolResult }) {
  return (
    <div className="space-y-2">
      {/* Status line */}
      <div className="flex items-center gap-3">
        {result.is_error ? (
          <span className="flex items-center gap-1 px-2 py-1 rounded text-sm font-medium bg-red-500/15 text-red-400 border border-red-500/25">
            <AlertCircle className="w-3 h-3" />
            Error
          </span>
        ) : (
          <span className="flex items-center gap-1 px-2 py-1 rounded text-sm font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            <Check className="w-3 h-3" />
            Success
          </span>
        )}
        <span className="flex items-center gap-1 text-sm text-muted-foreground/60">
          <Clock className="w-3 h-3" />
          {result.duration_ms}ms
        </span>
      </div>

      {/* Content blocks */}
      {result.content.map((block, i) => (
        <div key={i} className="rounded-lg border border-primary/8 overflow-hidden">
          {block.content_type !== 'text' && (
            <div className="px-3 py-1 text-sm text-muted-foreground/60 bg-secondary/20 border-b border-primary/5">
              {block.content_type}
            </div>
          )}
          <pre className="p-3 text-sm font-mono text-foreground/75 whitespace-pre-wrap break-words overflow-auto max-h-[400px]">
            {formatContent(block.text)}
          </pre>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────

function EmptyState({ onDiscover }: { onDiscover: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Server className="w-10 h-10 text-muted-foreground/15" />
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground/50">Discover MCP server tools</p>
        <p className="text-sm text-muted-foreground/60">
          Connect to the MCP server to discover available tools and test them.
        </p>
      </div>
      <button
        onClick={onDiscover}
        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Discover Tools
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function formatContent(text: string | null): string {
  if (!text) return '(empty)';
  // Try to pretty-print JSON
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // intentional: non-critical — JSON parse fallback
    return text;
  }
}
