import { useState, useCallback, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { Button } from '@/features/shared/components/buttons';
import { listMcpTools, executeMcpTool } from '@/api/agents/mcpTools';
import type { McpTool, McpToolResult } from '@/api/agents/mcpTools';
import { ToolRow } from './McpToolRow';
import { EmptyState } from './McpToolResultDisplay';
import { ToolDetail, ToolEmptyList } from './ToolDetail';
import { buildToolArgs } from './mcpToolArgs';
import { inlineErrorCopy } from '@/features/triggers/lib/inlineErrorCopy';
import { createLatestWins } from '@/stores/util/latestWins';

interface McpToolsTabProps {
  credentialId: string;
}

export function McpToolsTab({ credentialId }: McpToolsTabProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  // The rejection itself, resolved at render: an IPC rejection is an AppError
  // object, and `err instanceof Error ? err.message : String(err)` painted
  // "[object Object]" in both banners for every backend failure.
  const [loadError, setLoadError] = useState<{ raw: unknown } | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [execError, setExecError] = useState<{ raw: unknown } | null>(null);
  // A run still in flight when the operator picks another tool (or closes the
  // panel) must not paint its result under the next tool's name.
  const [runLatest] = useState(createLatestWins);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const list = await listMcpTools(credentialId);
      setTools(list);
      setHasLoaded(true);
    } catch (err) {
      setLoadError({ raw: err });
    } finally {
      setLoading(false);
    }
  }, [credentialId]);

  const handleExecute = useCallback(async (toolName: string) => {
    const token = runLatest.next();
    setExecuting(true);
    setExecError(null);
    setResult(null);
    try {
      const schema = tools.find((tool) => tool.name === toolName)?.input_schema;
      const res = await executeMcpTool(credentialId, toolName, buildToolArgs(schema, inputValues));
      if (runLatest.isCurrent(token)) setResult(res);
    } catch (err) {
      if (runLatest.isCurrent(token)) setExecError({ raw: err });
    } finally {
      if (runLatest.isCurrent(token)) setExecuting(false);
    }
  }, [credentialId, inputValues, tools, runLatest]);

  const handleSelectTool = useCallback((tool: McpTool) => {
    runLatest.next();
    setExecuting(false);
    setSelectedTool(tool.name);
    setResult(null);
    setExecError(null);
    const initial: Record<string, string> = {};
    if (tool.input_schema) {
      const props = (tool.input_schema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      if (props) { for (const key of Object.keys(props)) initial[key] = ''; }
    }
    setInputValues(initial);
  }, [runLatest]);

  const currentTool = useMemo(
    () => tools.find((t) => t.name === selectedTool),
    [tools, selectedTool],
  );

  return (
    <div className="flex flex-col h-full" data-testid="mcp-tools-tab">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <span
          className="typo-body text-foreground"
          data-testid="mcp-tools-count"
          data-count={hasLoaded ? tools.length : undefined}
        >
          {hasLoaded
            ? tx(tools.length === 1 ? sh.tool_count_one : sh.tool_count_other, { count: tools.length })
            : sh.mcp_tools_label}
        </span>
        <div className="flex-1" />
        <Button
          variant="secondary" size="sm"
          icon={loading ? <LoadingSpinner size="xs" /> : <RefreshCw className="w-3 h-3" />}
          onClick={handleRefresh} disabled={loading} loading={loading}
        >
          {loading ? sh.discovering : hasLoaded ? sh.refresh : sh.discover_tools}
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {loadError && <InlineErrorBanner message={inlineErrorCopy(t, loadError.raw)} />}

        {!hasLoaded && !loading && !loadError && <EmptyState onDiscover={handleRefresh} />}

        <ToolEmptyList hasLoaded={hasLoaded} toolCount={tools.length} loading={loading} />

        {tools.length > 0 && (
          <div className="space-y-1" data-testid="mcp-tools-list">
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

        {currentTool && (
          <ToolDetail
            currentTool={currentTool}
            inputValues={inputValues}
            onInputChange={setInputValues}
            executing={executing}
            execError={execError && inlineErrorCopy(t, execError.raw)}
            result={result}
            onExecute={handleExecute}
            onClose={() => { runLatest.next(); setExecuting(false); setSelectedTool(null); setResult(null); setExecError(null); }}
          />
        )}
      </div>
    </div>
  );
}
