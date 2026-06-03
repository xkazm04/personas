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

interface McpToolsTabProps {
  credentialId: string;
}

export function McpToolsTab({ credentialId }: McpToolsTabProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [execError, setExecError] = useState<string | null>(null);

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

  const handleExecute = useCallback(async (toolName: string) => {
    setExecuting(true);
    setExecError(null);
    setResult(null);
    try {
      const args: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(inputValues)) {
        if (!val.trim()) continue;
        try { args[key] = JSON.parse(val); } catch { args[key] = val; }
      }
      const res = await executeMcpTool(credentialId, toolName, args);
      setResult(res);
    } catch (err) {
      setExecError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, inputValues]);

  const handleSelectTool = useCallback((tool: McpTool) => {
    setSelectedTool(tool.name);
    setResult(null);
    setExecError(null);
    const initial: Record<string, string> = {};
    if (tool.input_schema) {
      const props = (tool.input_schema as Record<string, unknown>).properties as Record<string, unknown> | undefined;
      if (props) { for (const key of Object.keys(props)) initial[key] = ''; }
    }
    setInputValues(initial);
  }, []);

  const currentTool = useMemo(
    () => tools.find((t) => t.name === selectedTool),
    [tools, selectedTool],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <span className="typo-body font-medium text-foreground">
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
        {loadError && <InlineErrorBanner message={loadError} />}

        {!hasLoaded && !loading && !loadError && <EmptyState onDiscover={handleRefresh} />}

        <ToolEmptyList hasLoaded={hasLoaded} toolCount={tools.length} loading={loading} />

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

        {currentTool && (
          <ToolDetail
            currentTool={currentTool}
            inputValues={inputValues}
            onInputChange={setInputValues}
            executing={executing}
            execError={execError}
            result={result}
            onExecute={handleExecute}
            onClose={() => { setSelectedTool(null); setResult(null); setExecError(null); }}
          />
        )}
      </div>
    </div>
  );
}
