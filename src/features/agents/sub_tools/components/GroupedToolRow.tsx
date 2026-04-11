import { useState } from 'react';
import { BarChart3, ChevronDown } from 'lucide-react';
import { ToolImpactPanel } from './ToolImpactPanel';
import { ToolCheckbox } from './ToolCheckbox';
import type { ToolDef } from './ToolCardItems';
import type { ToolImpactData } from '../libs/toolImpactTypes';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useTranslation } from '@/i18n/useTranslation';

export function GroupedToolRow({
  tool,
  isAssigned,
  missingCredential,
  justToggledId,
  usageByTool,
  impactData,
  onToggle,
}: {
  tool: ToolDef;
  isAssigned: boolean;
  missingCredential: boolean;
  justToggledId: string | null;
  usageByTool: Map<string, number>;
  impactData?: ToolImpactData;
  onToggle: (id: string, name: string, assigned: boolean) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const { isStarter: isSimple } = useTier();
  const usageCount = usageByTool.get(tool.name) ?? 0;
  const hasImpact = !isSimple && impactData && (
    impactData.useCaseRefs.length > 0 ||
    (impactData.usage && impactData.usage.total_invocations > 0) ||
    impactData.coUsedTools.length > 0
  );

  return (
    <div>
      <div
        onClick={() => !missingCredential && onToggle(tool.id, tool.name, isAssigned)}
        className={`flex items-center gap-3 px-4 py-2.5 transition-colors focus-ring ${
          missingCredential
            ? 'opacity-50 cursor-not-allowed'
            : isAssigned
              ? 'bg-primary/5 hover:bg-primary/10 cursor-pointer'
              : 'hover:bg-secondary/30 cursor-pointer'
        }`}
      >
        <ToolCheckbox
          toolName={tool.name}
          checked={isAssigned}
          disabled={missingCredential}
          justToggled={justToggledId === tool.id}
          size="sm"
          onToggle={() => onToggle(tool.id, tool.name, isAssigned)}
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground/80">{tool.name}</span>
          {tool.description && (
            <p className="text-sm text-muted-foreground/80 truncate">{tool.description}</p>
          )}
        </div>
        {usageCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm bg-primary/5 text-muted-foreground/80 border border-primary/10 flex-shrink-0">
            <BarChart3 className="w-2.5 h-2.5" />
            {usageCount.toLocaleString()}
          </span>
        )}
        {hasImpact && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-sm text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-primary/5 transition-all flex-shrink-0"
            title={expanded ? t.agents.lab.hide_impact : t.agents.lab.show_impact}
          >
            <span>
              <ChevronDown className="animate-fade-in w-3 h-3" />
            </span>
          </button>
        )}
      </div>
      {expanded && hasImpact && (
          <div className="px-4" onClick={(e) => e.stopPropagation()}>
            <ToolImpactPanel impact={impactData} isAssigned={isAssigned} />
          </div>
        )}
    </div>
  );
}
