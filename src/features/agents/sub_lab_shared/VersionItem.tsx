import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RotateCcw, ChevronDown, ChevronRight,
  Shield, Archive, Beaker, Clock, Loader2, AlertTriangle, XCircle,
} from 'lucide-react';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { TAG_STYLES, formatRelative } from './labPrimitives';

export type VersionAction = 'promote' | 'archive' | 'unarchive' | 'rollback' | null;

interface VersionItemProps {
  version: PersonaPromptVersion;
  isSelected: boolean;
  isCompareA: boolean;
  isCompareB: boolean;
  onSelect: () => void;
  onTag: (tag: string) => void;
  onRollback: () => void;
  onSetCompareA: () => void;
  onSetCompareB: () => void;
  activeAction: VersionAction;
  actionError: string | null;
  onDismissError: () => void;
}

export function VersionItem({
  version,
  isSelected,
  isCompareA,
  isCompareB,
  onSelect,
  onTag,
  onRollback,
  onSetCompareA,
  onSetCompareB,
  activeAction,
  actionError,
  onDismissError,
}: VersionItemProps) {
  const [showActions, setShowActions] = useState(false);
  const style = TAG_STYLES[version.tag] ?? TAG_STYLES.experimental!;
  const TagIcon = style.icon;

  const actionBtn = (
    action: VersionAction,
    onClick: () => void,
    icon: React.ReactNode,
    label: string,
    colorClasses: string,
    testId: string,
  ) => {
    const isThis = activeAction === action;
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        disabled={isThis}
        data-testid={testId}
        className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded-lg transition-colors disabled:opacity-70 ${colorClasses} ${isThis ? 'cursor-default' : 'cursor-pointer'}`}
      >
        {isThis ? <Loader2 className="w-3 h-3 animate-spin" /> : icon}
        {label}
      </button>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group relative rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/30 hover:border-primary/20'
      } ${isCompareA ? 'ring-2 ring-blue-500/40' : ''} ${isCompareB ? 'ring-2 ring-violet-500/40' : ''}`}
    >
      <button
        type="button"
        onClick={onSelect}
        data-testid={`version-item-${version.version_number}`}
        className="w-full text-left p-3"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono font-bold text-foreground/90">v{version.version_number}</span>
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium border ${style.bg} ${style.text}`}>
            <TagIcon className="w-2.5 h-2.5" />
            {version.tag}
          </span>
          {isCompareA && <span className="px-1.5 py-0.5 rounded text-sm font-mono bg-blue-500/20 text-blue-400">A</span>}
          {isCompareB && <span className="px-1.5 py-0.5 rounded text-sm font-mono bg-violet-500/20 text-violet-400">B</span>}
          <span className="ml-auto text-sm text-muted-foreground/60 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatRelative(version.created_at)}
          </span>
        </div>
        {version.change_summary && (
          <p className="mt-1 text-sm text-muted-foreground/70 truncate">{version.change_summary}</p>
        )}
      </button>

      {/* Action row */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
          data-testid={`version-actions-toggle-${version.version_number}`}
          className="text-sm text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 transition-colors"
        >
          {showActions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Actions
        </button>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareA(); }}
          data-testid={`version-compare-a-${version.version_number}`}
          className={`px-1.5 py-0.5 rounded text-sm transition-colors ${isCompareA ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground/50 hover:text-blue-400 hover:bg-blue-500/10'}`}
          title="Set as Compare A"
        >
          A
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareB(); }}
          data-testid={`version-compare-b-${version.version_number}`}
          className={`px-1.5 py-0.5 rounded text-sm transition-colors ${isCompareB ? 'bg-violet-500/20 text-violet-400' : 'text-muted-foreground/50 hover:text-violet-400 hover:bg-violet-500/10'}`}
          title="Set as Compare B"
        >
          B
        </button>
      </div>

      <AnimatePresence>
        {showActions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-1.5 px-3 pb-3 border-t border-primary/10 pt-2">
              {version.tag !== 'production' &&
                actionBtn(
                  'promote',
                  () => onTag('production'),
                  <Shield className="w-3 h-3" />,
                  'Promote to Production',
                  'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20',
                  `version-promote-${version.version_number}`,
                )
              }
              {version.tag !== 'archived' &&
                actionBtn(
                  'archive',
                  () => onTag('archived'),
                  <Archive className="w-3 h-3" />,
                  'Archive',
                  'bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20',
                  `version-archive-${version.version_number}`,
                )
              }
              {version.tag === 'archived' &&
                actionBtn(
                  'unarchive',
                  () => onTag('experimental'),
                  <Beaker className="w-3 h-3" />,
                  'Unarchive',
                  'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
                  `version-unarchive-${version.version_number}`,
                )
              }
              {actionBtn(
                'rollback',
                () => onRollback(),
                <RotateCcw className="w-3 h-3" />,
                'Rollback to this',
                'bg-blue-500/10 text-blue-400 hover:bg-blue-500/20',
                `version-rollback-${version.version_number}`,
              )}
            </div>

            {/* Inline error panel */}
            {actionError && (
              <div className="mx-3 mb-3 flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20 shadow-sm animate-in fade-in slide-in-from-top-1 duration-200">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-red-400 uppercase tracking-tight">Operation Failed</p>
                  <p className="text-sm text-red-300/90 leading-relaxed">{actionError}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDismissError(); }}
                  className="text-red-400/40 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-500/10 flex-shrink-0"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
