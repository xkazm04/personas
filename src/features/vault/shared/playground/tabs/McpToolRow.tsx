import { useTranslation } from '@/i18n/useTranslation';
import { ChevronDown, ChevronRight, Play } from 'lucide-react';
import type { McpTool } from '@/api/agents/mcpTools';
import { Button } from '@/features/shared/components/buttons';

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
  const { t } = useTranslation();
  const sh = t.vault.shared;
  return (
    <div className={`border rounded-card overflow-hidden transition-colors ${
      isSelected ? 'border-status-success/25 bg-status-success/5' : 'border-primary/8 hover:border-primary/15'
    }`}>
      {/* Two sibling controls, not a button inside a button: the nested form
          is invalid HTML, and its inner Run button was reached by neither a
          screen reader's button list nor a reliable keyboard path. */}
      <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/20 transition-colors">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="flex-1 min-w-0 flex items-center gap-2.5 text-left"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 text-foreground shrink-0" />
          )}

          <span className="typo-code text-foreground truncate flex-1">
            {tool.name}
          </span>

          {tool.description && (
            <span className="typo-body text-foreground truncate max-w-[300px] hidden sm:inline">
              {tool.description}
            </span>
          )}
        </button>

        <Button
          variant="accent"
          tone="success"
          size="xs"
          icon={<Play className="w-2.5 h-2.5" />}
          onClick={onRun}
          className="shrink-0"
        >
          {t.vault.playground.mcp_run}
        </Button>
      </div>

      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/5 bg-secondary/10 space-y-2">
          {tool.description && (
            <p className="typo-body text-foreground">{tool.description}</p>
          )}
          {tool.input_schema && (
            <div className="space-y-1">
              <span className="typo-heading uppercase text-foreground">
                {sh.input_schema}
              </span>
              <pre className="typo-code text-foreground bg-secondary/20 rounded p-2 overflow-x-auto max-h-[200px]">
                {JSON.stringify(tool.input_schema, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
