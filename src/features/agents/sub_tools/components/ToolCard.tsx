import { useState, memo } from 'react';
import { CheckCircle, AlertCircle, ArrowRight, BarChart3, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolImpactPanel } from './ToolImpactPanel';
import { ToolCheckbox } from './ToolCheckbox';
import type { ToolDef } from './ToolCardItems';
import type { ToolImpactData } from '../libs/toolImpactTypes';
import { TOOLS_BORDER, TOOLS_BTN_COMPACT } from '@/lib/utils/designTokens';

export const ToolCard = memo(function ToolCard({
  tool,
  isAssigned,
  missingCredential,
  justToggledId,
  credentialLabel,
  credentialTypeSet,
  usageByTool,
  impactData,
  onToggle,
  onAddCredential,
}: {
  tool: ToolDef;
  isAssigned: boolean;
  missingCredential: boolean;
  justToggledId: string | null;
  credentialLabel: (credType: string) => string;
  credentialTypeSet: Set<string>;
  usageByTool: Map<string, number>;
  impactData?: ToolImpactData;
  onToggle: (id: string, name: string, assigned: boolean) => void;
  onAddCredential: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const usageCount = usageByTool.get(tool.name) ?? 0;
  const hasImpact = impactData && (
    impactData.useCaseRefs.length > 0 ||
    (impactData.usage && impactData.usage.total_invocations > 0) ||
    impactData.coUsedTools.length > 0
  );

  return (
    <motion.div
      whileHover={missingCredential ? undefined : { scale: 1.02 }}
      whileTap={missingCredential ? undefined : { scale: 0.98 }}
      onClick={() => !missingCredential && onToggle(tool.id, tool.name, isAssigned)}
      className={`p-3 rounded-xl border backdrop-blur-sm transition-all focus-ring ${
        missingCredential
          ? `bg-secondary/20 ${TOOLS_BORDER} opacity-60 cursor-not-allowed`
          : isAssigned
            ? 'bg-primary/10 border-primary/30 shadow-[0_0_15px_rgba(59,130,246,0.08)] cursor-pointer'
            : `bg-secondary/40 ${TOOLS_BORDER} hover:border-primary/20 cursor-pointer`
      }`}
    >
      <div className="flex items-start gap-3">
        <ToolCheckbox
          toolName={tool.name}
          checked={isAssigned}
          disabled={missingCredential}
          justToggled={justToggledId === tool.id}
          size="md"
          onToggle={() => onToggle(tool.id, tool.name, isAssigned)}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-medium text-foreground text-sm truncate">{tool.name}</h4>
            {tool.requires_credential_type && (
              credentialTypeSet.has(tool.requires_credential_type) ? (
                <span title={`${credentialLabel(tool.requires_credential_type)} credential available`}>
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                </span>
              ) : (
                <span title={`Needs ${credentialLabel(tool.requires_credential_type)} credential`}>
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
                </span>
              )
            )}
          </div>
          <p className="text-sm text-muted-foreground/90 mt-2 line-clamp-2">{tool.description}</p>
          {missingCredential && tool.requires_credential_type && (
            <div className="mt-2 space-y-1">
              <p className="text-sm text-amber-400/80">
                Requires a <span className="font-medium">{credentialLabel(tool.requires_credential_type)}</span> credential to connect
              </p>
              <button
                onClick={(e) => { e.stopPropagation(); onAddCredential(); }}
                className="inline-flex items-center gap-1 text-sm text-primary/80 hover:text-primary transition-colors group"
              >
                Add credential
                <ArrowRight className="w-3 h-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {tool.category && (
              <span className={`inline-block px-2 py-0.5 rounded-lg text-sm font-mono bg-background/50 text-muted-foreground/80 border ${TOOLS_BORDER}`}>
                {tool.category}
              </span>
            )}
            {usageCount > 0 && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-sm bg-primary/5 text-muted-foreground/90 border ${TOOLS_BORDER}`}>
                <BarChart3 className="w-3 h-3" />
                {usageCount.toLocaleString()} calls
              </span>
            )}
            {hasImpact && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className={`ml-auto inline-flex items-center gap-1 ${TOOLS_BTN_COMPACT} rounded-lg text-sm text-muted-foreground/60 hover:text-muted-foreground/90 hover:bg-primary/5 border border-transparent hover:${TOOLS_BORDER} transition-all`}
                title={expanded ? 'Hide impact analysis' : 'Show impact analysis'}
              >
                Impact
                <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown className="w-3 h-3" />
                </motion.span>
              </button>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {expanded && hasImpact && (
          <div onClick={(e) => e.stopPropagation()}>
            <ToolImpactPanel impact={impactData} isAssigned={isAssigned} />
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
