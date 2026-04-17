import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Play,
  X,
  CheckCircle,
  AlertCircle,
  Wrench,
  Clock,
  DollarSign,
  Shield,
  Zap,
} from 'lucide-react';
import type { PreRunCheck, ToolReadiness } from '@/hooks/execution/usePreRunCheck';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

interface PreRunPreviewProps {
  check: PreRunCheck;
  personaName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ToolRow({ tool }: { tool: ToolReadiness }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {tool.requiresCredential ? (
        tool.credentialPresent ? (
          <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
        ) : (
          <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
        )
      ) : (
        <CheckCircle className="w-3 h-3 text-emerald-400/50 shrink-0" />
      )}
      <span className="typo-caption text-foreground truncate">{tool.name}</span>
      {tool.requiresCredential && !tool.credentialPresent && (
        <span className="typo-caption text-amber-400/70 ml-auto shrink-0">needs credential</span>
      )}
    </div>
  );
}

export function PreRunPreview({ check, personaName, onConfirm, onCancel }: PreRunPreviewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  useClickOutside(panelRef, true, onCancel);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onCancel, onConfirm]);

  return (
    <motion.div
      ref={panelRef}
      role="dialog"
      aria-label={`Pre-run preview for ${personaName}`}
      initial={{ opacity: 0, y: 4, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 4, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className="absolute top-full right-0 mt-2 w-72 bg-background border border-primary/20 rounded-modal shadow-elevation-3 z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-secondary/20">
        <span className="typo-body font-medium text-foreground/90">Run Preview</span>
        <button
          type="button"
          onClick={onCancel}
          className="p-0.5 rounded hover:bg-muted/50 text-foreground hover:text-muted-foreground transition-colors"
          aria-label="Close preview"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5 space-y-3">
        {/* Model */}
        {check.model && (
          <div className="flex items-center gap-2">
            <Zap className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="typo-caption text-foreground">Model</span>
            <span className="typo-caption font-medium text-foreground ml-auto">{check.model}</span>
          </div>
        )}

        {/* Trust level */}
        <div className="flex items-center gap-2">
          <Shield className="w-3 h-3 text-blue-400 shrink-0" />
          <span className="typo-caption text-foreground">Trust</span>
          <span className="typo-caption font-medium text-foreground ml-auto capitalize">{check.trustLevel}</span>
        </div>

        {/* Budget */}
        {check.maxBudgetUsd != null && (
          <div className="flex items-center gap-2">
            <DollarSign className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="typo-caption text-foreground">Budget limit</span>
            <span className="typo-caption font-medium text-foreground ml-auto">${check.maxBudgetUsd.toFixed(2)}</span>
          </div>
        )}

        {/* Timeout */}
        {check.timeoutMs > 0 && (
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-blue-400 shrink-0" />
            <span className="typo-caption text-foreground">Timeout</span>
            <span className="typo-caption font-medium text-foreground ml-auto">{Math.round(check.timeoutMs / 1000)}s</span>
          </div>
        )}

        {/* Tools section */}
        {check.toolCount > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Wrench className="w-3 h-3 text-foreground" />
              <span className="typo-caption text-foreground">
                {check.toolCount} tool{check.toolCount !== 1 ? 's' : ''}
              </span>
              {check.missingCredentials.length > 0 && (
                <span className="typo-caption text-amber-400/80 ml-auto">
                  {check.missingCredentials.length} missing
                </span>
              )}
            </div>
            <div className="ml-1 max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15">
              {check.tools.map((tool, i) => (
                <ToolRow key={i} tool={tool} />
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {check.reasons.length > 0 && (
          <div className="rounded-card bg-amber-500/5 border border-amber-500/15 px-2.5 py-2">
            {check.reasons.map((r, i) => (
              <p key={i} className="typo-caption text-amber-400/80 flex items-start gap-1.5">
                <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
                {r}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-primary/10 bg-secondary/10">
        <button
          type="button"
          onClick={onCancel}
          className="typo-caption text-foreground hover:text-foreground px-2 py-1 rounded transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-body font-medium bg-primary/15 text-primary border border-primary/20 hover:bg-primary/25 transition-colors"
        >
          <Play className="w-3 h-3" />
          Run Agent
        </button>
      </div>
    </motion.div>
  );
}
