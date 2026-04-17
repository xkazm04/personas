import { Play, Server } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { ToolInputForm } from './McpToolInputForm';
import { ToolResultDisplay } from './McpToolResultDisplay';
import type { McpTool, McpToolResult } from '@/api/agents/mcpTools';

interface ToolDetailProps {
  currentTool: McpTool;
  inputValues: Record<string, string>;
  onInputChange: (values: Record<string, string>) => void;
  executing: boolean;
  execError: string | null;
  result: McpToolResult | null;
  onExecute: (toolName: string) => void;
  onClose: () => void;
}

export function ToolDetail({
  currentTool,
  inputValues,
  onInputChange,
  executing,
  execError,
  result,
  onExecute,
  onClose,
}: ToolDetailProps) {
  return (
    <div className="border-t border-primary/8 pt-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm uppercase tracking-wider text-muted-foreground/60 font-semibold">
          Test Tool
        </span>
        <span className="font-mono text-sm text-foreground/70">{currentTool.name}</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="text-muted-foreground/40 hover:text-muted-foreground/60"
        >
          Close
        </Button>
      </div>

      {/* Input form from schema */}
      <ToolInputForm
        tool={currentTool}
        values={inputValues}
        onChange={onInputChange}
      />

      <Button
        variant="accent"
        size="sm"
        icon={executing ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
        onClick={() => onExecute(currentTool.name)}
        disabled={executing}
        loading={executing}
        className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
      >
        {executing ? 'Running...' : 'Execute Tool'}
      </Button>

      {/* Error */}
      {execError && (
        <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
          {execError}
        </div>
      )}

      {/* Result */}
      {result && <ToolResultDisplay result={result} />}
    </div>
  );
}

interface ToolEmptyListProps {
  hasLoaded: boolean;
  toolCount: number;
  loading: boolean;
}

export function ToolEmptyList({ hasLoaded, toolCount, loading }: ToolEmptyListProps) {
  if (!hasLoaded || loading || toolCount > 0) return null;

  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-2">
      <Server className="w-8 h-8 text-muted-foreground/15" />
      <p className="text-sm text-muted-foreground/50">No tools found on this MCP server</p>
      <p className="text-sm text-muted-foreground/60">
        The server responded but reported no available tools.
      </p>
    </div>
  );
}
