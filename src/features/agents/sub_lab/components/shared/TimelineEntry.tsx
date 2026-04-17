import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Shield, Beaker, Archive, RotateCcw, Star } from 'lucide-react';
import type { PersonaPromptVersion } from '@/lib/bindings/PersonaPromptVersion';
import { TAG_STYLES, formatRelative } from '../../shared/labPrimitives';
import { InlineDiffPreview } from './InlineDiffPreview';
import { useTranslation } from '@/i18n/useTranslation';

interface TimelineEntryProps {
  version: PersonaPromptVersion;
  previousVersion: PersonaPromptVersion | null;
  isFirst: boolean;
  isLast: boolean;
  isBaseline: boolean;
  onTag: (versionId: string, tag: string) => void;
  onRollback: (versionId: string) => void;
}

const TAG_ICONS: Record<string, typeof Shield> = {
  production: Shield,
  experimental: Beaker,
  archived: Archive,
};

export function TimelineEntry({
  version,
  previousVersion,
  isFirst,
  isLast,
  isBaseline,
  onTag,
  onRollback,
}: TimelineEntryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const style = TAG_STYLES[version.tag] ?? TAG_STYLES.experimental!;
  const TagIcon = TAG_ICONS[version.tag] ?? Beaker;
  const isProduction = version.tag === 'production';

  return (
    <div className="flex gap-3" data-testid={`timeline-entry-v${version.version_number}`}>
      {/* Timeline rail */}
      <div className="flex flex-col items-center flex-shrink-0 w-6">
        {/* Connecting line (top) */}
        {!isFirst && <div className="w-px flex-1 bg-primary/10" />}

        {/* Node dot */}
        <div
          className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 transition-colors ${
            isProduction
              ? 'bg-emerald-400 border-emerald-400/50'
              : version.tag === 'archived'
                ? 'bg-zinc-500/40 border-zinc-500/30'
                : 'bg-primary/30 border-primary/20'
          }`}
        />

        {/* Connecting line (bottom) */}
        {!isLast && <div className="w-px flex-1 bg-primary/10" />}
      </div>

      {/* Content card */}
      <div className="flex-1 pb-4 min-w-0">
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-left group"
        >
          <div className="flex items-start gap-2">
            {/* Version number */}
            <span className="text-sm font-mono font-semibold text-foreground/70 flex-shrink-0">
              v{version.version_number}
            </span>

            {/* Tag badge */}
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input text-[10px] font-medium border ${style.bg} ${style.text}`}>
              <TagIcon className="w-2.5 h-2.5" />
              {version.tag}
            </span>

            {/* Baseline badge */}
            {isBaseline && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-input text-[10px] font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <Star className="w-2.5 h-2.5" />
                baseline
              </span>
            )}

            {/* Spacer + expand icon */}
            <span className="flex-1" />
            <span className="text-muted-foreground/30 group-hover:text-muted-foreground/50 transition-colors">
              {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </span>
          </div>

          {/* Change summary + date */}
          <div className="mt-1 flex items-center gap-2">
            <p className="text-xs text-foreground/50 truncate flex-1">
              {version.change_summary || t.agents.lab.no_change_summary}
            </p>
            <span className="text-[10px] text-muted-foreground/40 flex-shrink-0">
              {formatRelative(version.created_at)}
            </span>
          </div>
        </button>

        {/* Expanded content: diff + actions */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-2 p-3 rounded-card border border-primary/10 bg-secondary/[0.04] space-y-3">
                {/* Diff preview */}
                {previousVersion ? (
                  <InlineDiffPreview older={previousVersion} newer={version} />
                ) : (
                  <p className="text-[11px] text-muted-foreground/40 italic">Initial version — no previous version to compare</p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-primary/[0.06]">
                  {version.tag !== 'production' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onTag(version.id, 'production'); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-input bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Shield className="w-3 h-3" /> {t.agents.lab.promote_action}
                    </button>
                  )}
                  {version.tag !== 'archived' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onTag(version.id, 'archived'); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-input bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20 transition-colors"
                    >
                      <Archive className="w-3 h-3" /> {t.agents.lab.archive_action}
                    </button>
                  )}
                  {!isFirst && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onRollback(version.id); }}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-input bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> {t.agents.lab.rollback_action}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
