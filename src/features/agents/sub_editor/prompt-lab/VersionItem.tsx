import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  RotateCcw, ChevronDown, ChevronRight,
  Shield, Archive, Beaker, Clock,
} from 'lucide-react';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { TAG_STYLES, formatRelative } from './promptLabUtils';

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
  tagging: boolean;
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
  tagging,
}: VersionItemProps) {
  const [showActions, setShowActions] = useState(false);
  const style = TAG_STYLES[version.tag] ?? TAG_STYLES.experimental!;
  const TagIcon = style.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group relative rounded-xl border transition-all cursor-pointer ${
        isSelected
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 bg-secondary/20 hover:bg-secondary/30 hover:border-primary/15'
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
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium border ${style.bg} ${style.text}`}>
            <TagIcon className="w-2.5 h-2.5" />
            {version.tag}
          </span>
          {isCompareA && <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-blue-500/20 text-blue-400">A</span>}
          {isCompareB && <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-violet-500/20 text-violet-400">B</span>}
          <span className="ml-auto text-xs text-muted-foreground/60 flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            {formatRelative(version.created_at)}
          </span>
        </div>
        {version.change_summary && (
          <p className="mt-1 text-xs text-muted-foreground/70 truncate">{version.change_summary}</p>
        )}
      </button>

      {/* Action row */}
      <div className="flex items-center gap-1 px-3 pb-2">
        <button
          onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
          data-testid={`version-actions-toggle-${version.version_number}`}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground flex items-center gap-1 transition-colors"
        >
          {showActions ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          Actions
        </button>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareA(); }}
          data-testid={`version-compare-a-${version.version_number}`}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${isCompareA ? 'bg-blue-500/20 text-blue-400' : 'text-muted-foreground/50 hover:text-blue-400 hover:bg-blue-500/10'}`}
          title="Set as Compare A"
        >
          A
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onSetCompareB(); }}
          data-testid={`version-compare-b-${version.version_number}`}
          className={`px-1.5 py-0.5 rounded text-xs transition-colors ${isCompareB ? 'bg-violet-500/20 text-violet-400' : 'text-muted-foreground/50 hover:text-violet-400 hover:bg-violet-500/10'}`}
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
            <div className="flex flex-wrap gap-1.5 px-3 pb-3 border-t border-primary/5 pt-2">
              {version.tag !== 'production' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('production'); }}
                  disabled={tagging}
                  data-testid={`version-promote-${version.version_number}`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Shield className="w-3 h-3" /> Promote to Production
                </button>
              )}
              {version.tag !== 'archived' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('archived'); }}
                  disabled={tagging}
                  data-testid={`version-archive-${version.version_number}`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors disabled:opacity-50"
                >
                  <Archive className="w-3 h-3" /> Archive
                </button>
              )}
              {version.tag === 'archived' && (
                <button
                  onClick={(e) => { e.stopPropagation(); onTag('experimental'); }}
                  disabled={tagging}
                  data-testid={`version-unarchive-${version.version_number}`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                >
                  <Beaker className="w-3 h-3" /> Unarchive
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onRollback(); }}
                disabled={tagging}
                data-testid={`version-rollback-${version.version_number}`}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" /> Rollback to this
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
