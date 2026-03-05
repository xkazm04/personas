import { useState } from 'react';
import { Check, CheckCircle, AlertCircle, ArrowRight, BarChart3, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolImpactPanel } from './ToolImpactPanel';
import type { ToolImpactData } from './useToolImpactData';

export interface ToolDef {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  requires_credential_type?: string | null;
}

function ToolCheckbox({
  toolName,
  checked,
  disabled,
  justToggled,
  size,
  onToggle,
}: {
  toolName: string;
  checked: boolean;
  disabled: boolean;
  justToggled: boolean;
  size: 'sm' | 'md';
  onToggle: () => void;
}) {
  const classes = size === 'md'
    ? 'w-5 h-5 rounded-md'
    : 'w-4 h-4 rounded-md';
  const checkClass = size === 'md' ? 'w-3 h-3' : 'w-2.5 h-2.5';

  return (
    <motion.div
      role="checkbox"
      aria-checked={checked}
      aria-label={toolName}
      aria-disabled={disabled ? true : undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle();
      }}
      onKeyDown={(e) => {
        if ((e.key === ' ' || e.key === 'Enter') && !disabled) {
          e.preventDefault();
          onToggle();
        }
      }}
      animate={justToggled ? { scale: [1, 1.3, 1] } : undefined}
      transition={{ duration: 0.3 }}
      className={`flex-shrink-0 border flex items-center justify-center mt-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${classes} ${
        checked ? 'bg-primary border-primary' : 'bg-background/50 border-primary/15'
      }`}
    >
      {checked && <Check className={`${checkClass} text-foreground`} />}
    </motion.div>
  );
}

export function ToolCard({
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
      className={`p-3 rounded-2xl border backdrop-blur-sm transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        missingCredential
          ? 'bg-secondary/20 border-primary/10 opacity-60 cursor-not-allowed'
          : isAssigned
            ? 'bg-primary/10 border-primary/30 shadow-[0_0_15px_rgba(59,130,246,0.08)] cursor-pointer'
            : 'bg-secondary/40 border-primary/15 hover:border-primary/20 cursor-pointer'
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
          <p className="text-sm text-muted-foreground/90 mt-1.5 line-clamp-2">{tool.description}</p>
          {missingCredential && tool.requires_credential_type && (
            <div className="mt-1.5 space-y-1">
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
              <span className="inline-block px-2 py-0.5 rounded-md text-sm font-mono bg-background/50 text-muted-foreground/80 border border-primary/15">
                {tool.category}
              </span>
            )}
            {usageCount > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-sm bg-primary/5 text-muted-foreground/90 border border-primary/10">
                <BarChart3 className="w-3 h-3" />
                {usageCount.toLocaleString()} calls
              </span>
            )}
            {hasImpact && (
              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-sm text-muted-foreground/60 hover:text-muted-foreground/90 hover:bg-primary/5 border border-transparent hover:border-primary/10 transition-all"
                title={expanded ? 'Hide impact analysis' : 'Show impact analysis'}
              >
                Impact
                <motion.span
                  animate={{ rotate: expanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
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
            <ToolImpactPanel
              impact={impactData}
              isAssigned={isAssigned}
            />
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

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
  const [expanded, setExpanded] = useState(false);
  const usageCount = usageByTool.get(tool.name) ?? 0;
  const hasImpact = impactData && (
    impactData.useCaseRefs.length > 0 ||
    (impactData.usage && impactData.usage.total_invocations > 0) ||
    impactData.coUsedTools.length > 0
  );

  return (
    <div>
      <div
        onClick={() => !missingCredential && onToggle(tool.id, tool.name, isAssigned)}
        className={`flex items-center gap-3 px-4 py-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
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
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-sm bg-primary/5 text-muted-foreground/80 border border-primary/8 flex-shrink-0">
            <BarChart3 className="w-2.5 h-2.5" />
            {usageCount.toLocaleString()}
          </span>
        )}
        {hasImpact && (
          <button
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-sm text-muted-foreground/50 hover:text-muted-foreground/80 hover:bg-primary/5 transition-all flex-shrink-0"
            title={expanded ? 'Hide impact' : 'Show impact'}
          >
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="w-3 h-3" />
            </motion.span>
          </button>
        )}
      </div>
      <AnimatePresence>
        {expanded && hasImpact && (
          <div className="px-4" onClick={(e) => e.stopPropagation()}>
            <ToolImpactPanel
              impact={impactData}
              isAssigned={isAssigned}
            />
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
