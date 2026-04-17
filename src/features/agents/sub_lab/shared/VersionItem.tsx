import { useState } from 'react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import {
  RotateCcw, ChevronDown, ChevronRight,
  Shield, Archive, Beaker, Clock, AlertTriangle, XCircle, Star, StarOff,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { TAG_STYLES, formatRelative } from './labPrimitives';
import { useTranslation } from '@/i18n/useTranslation';

export type VersionAction = 'promote' | 'archive' | 'unarchive' | 'rollback' | null;

interface VersionItemProps {
  version: PersonaPromptVersion;
  isSelected: boolean;
  isCompareA: boolean;
  isCompareB: boolean;
  isBaseline: boolean;
  onSelect: () => void;
  onTag: (tag: string) => void;
  onRollback: () => void;
  onSetCompareA: () => void;
  onSetCompareB: () => void;
  onPinBaseline: () => void;
  onUnpinBaseline: () => void;
  activeAction: VersionAction;
  actionError: string | null;
  onDismissError: () => void;
}

export function VersionItem({
  version,
  isSelected,
  isCompareA,
  isCompareB,
  isBaseline,
  onSelect,
  onTag,
  onRollback,
  onSetCompareA,
  onSetCompareB,
  onPinBaseline,
  onUnpinBaseline,
  activeAction,
  actionError,
  onDismissError,
}: VersionItemProps) {
  const { t } = useTranslation();
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
        className={`inline-flex items-center gap-1 px-2 py-1 text-sm rounded-card transition-colors disabled:opacity-70 ${colorClasses} ${isThis ? 'cursor-default' : 'cursor-pointer'}`}
      >
        {isThis ? <LoadingSpinner size="xs" /> : icon}
        {label}
      </button>
    );
  };

  return (
    <div
      className={`animate-fade-slide-in group relative rounded-modal border transition-all cursor-pointer ${
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
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card text-sm font-medium border ${style.bg} ${style.text}`}>
            <TagIcon className="w-2.5 h-2.5" />
            {version.tag}
          </span>
          {version.icon && (
            <span className="text-[10px] text-muted-foreground/50 font-mono">{version.icon}</span>
          )}
          {version.resolved_cells && (() => {
            const rc = parseJsonOrDefault<Record<string, unknown> | null>(version.resolved_cells, null);
            return rc ? <span className="text-[10px] text-muted-foreground/40">{Object.keys(rc).length} dims</span> : null;
          })()}
          {isBaseline && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card text-sm font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25">
              <Star className="w-2.5 h-2.5" />
              baseline
            </span>
          )}
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
          aria-expanded={showActions}
          aria-label={`${showActions ? 'Hide' : 'Show'} actions for version ${version.version_number}`}
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

      {showActions && (
          <div
            className="animate-fade-slide-in overflow-hidden"
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
              {!isBaseline ? (
                <button
                  onClick={(e) => { e.stopPropagation(); onPinBaseline(); }}
                  data-testid={`version-pin-baseline-${version.version_number}`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-card transition-colors bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 cursor-pointer"
                >
                  <Star className="w-3 h-3" />
                  Pin as Baseline
                </button>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnpinBaseline(); }}
                  data-testid={`version-unpin-baseline-${version.version_number}`}
                  className="inline-flex items-center gap-1 px-2 py-1 text-sm rounded-card transition-colors bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 cursor-pointer"
                >
                  <StarOff className="w-3 h-3" />
                  Unpin Baseline
                </button>
              )}
            </div>

            {/* Inline error panel */}
            {actionError && (
              <div className="mx-3 mb-3 flex items-start gap-3 p-3 rounded-modal bg-red-500/10 border border-red-500/20 shadow-elevation-1 animate-in fade-in slide-in-from-top-1 duration-200">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-0.5">
                  <p className="text-sm font-semibold text-red-400 uppercase tracking-tight">{t.agents.lab.operation_failed}</p>
                  <p className="text-sm text-red-300/90 leading-relaxed">{actionError}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); onDismissError(); }}
                  className="text-red-400/40 hover:text-red-400 transition-colors p-1 rounded-card hover:bg-red-500/10 flex-shrink-0"
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
