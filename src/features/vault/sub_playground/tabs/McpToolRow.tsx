import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import type { McpTool } from '@/api/agents/mcpTools';

// -- Tool row -----------------------------------------------------

interface ToolRowProps {
  tool: McpTool;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onRun: () => void;
}

export function ToolRow({
  tool,
  isExpanded,
  isSelected,
  onToggle,
  onRun,
}: ToolRowProps) {
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
