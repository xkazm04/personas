// VARIANT "Blueprint" — an engineering drawing. Mental model: the library is
// a BUS at the top of a schematic and every project is a labelled module
// wired to it; drift is a stamped verdict word with a coloured edge, counts
// are tabular figures. A technical-record read (scan columns, compare
// stamps) vs the baseline's organic fan: it answers "audit each connection"
// rather than "feel the flow".
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpenText, Wand2 } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { DRIFT_BORDER, DRIFT_TEXT } from './driftTokens';
import { LessonsPanel } from './LessonsPanel';
import type { SkillTreeViewProps } from './SkillTreeView';
import { VersionTimelinePanel } from './VersionTimelinePanel';

export function SkillTreeBlueprint({ model, onBack, onOpenInfo }: SkillTreeViewProps) {
  const { t, tx } = useTranslation();
  const Icon = model.visual?.icon ?? Wand2;
  const accent = model.visual?.color ?? undefined;

  return (
    <div className="flex flex-col min-h-0 h-full overflow-auto">
      <div className="flex items-center gap-3 pb-2">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 typo-caption text-foreground hover:text-primary transition-colors">
          <ArrowLeft size={13} />
          {t.plugins.dev_tools.trace_back}
        </button>
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_tree_stats, { projects: model.branches.length, invokes: model.totalInvokes })}
        </span>
      </div>

      {/* the bus — library rail the modules hang from */}
      <button
        type="button"
        onClick={() => onOpenInfo(model.skillName)}
        className="flex items-center gap-3 rounded-card border-2 px-4 py-2.5 bg-secondary/40 hover:bg-secondary/60 transition-colors text-left"
        style={accent ? { borderColor: accent } : undefined}
      >
        <Icon size={18} style={accent ? { color: accent } : undefined} />
        <span className="typo-title">{model.skillName}</span>
        <span className="typo-data tabular-nums">v{model.libraryVersion ?? '1.0'}</span>
        <span className="typo-caption text-foreground ml-auto">{t.plugins.dev_tools.trace_core_library}</span>
      </button>

      {/* drop rail */}
      <div className="ml-6 h-4 border-l-2 border-border" aria-hidden />

      {/* module grid — one wired card per adopted project */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 pl-3 border-l-2 border-border ml-6 pb-3">
        {model.branches.map((b, i) => (
          <motion.div
            key={b.project.id}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={`rounded-card border border-border/60 border-l-4 ${DRIFT_BORDER[b.drift]} bg-secondary/30 px-3 py-2 flex flex-col gap-1`}
          >
            <div className="flex items-baseline gap-2">
              <span className="typo-body font-medium truncate">{b.project.name}</span>
              <span className="typo-data tabular-nums ml-auto">v{b.installedVersion ?? '1.0'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`typo-caption ${DRIFT_TEXT[b.drift]}`}>
                {t.plugins.dev_tools[`trace_drift_${b.drift}` as const]}
              </span>
              <span className="typo-caption text-foreground tabular-nums ml-auto">
                {tx(t.plugins.dev_tools.trace_cell_invokes, { count: b.invokes30d })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {b.lessons.length > 0 && (
                <span className={`inline-flex items-center gap-1 typo-caption ${b.lessons.some((l) => l.is_redesign) ? 'text-status-warning' : 'text-status-success'}`}>
                  <BookOpenText size={11} aria-hidden />
                  <span className="tabular-nums">{b.lessons.length}</span>
                </span>
              )}
              {b.lastInvokedAt != null && (
                <span className="typo-caption text-foreground ml-auto">
                  <RelativeTime timestamp={b.lastInvokedAt} showTooltip={false} />
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <VersionTimelinePanel timeline={model.timeline} loading={model.loading} />
        <LessonsPanel branches={model.branches} workspaceLessons={model.workspaceLessons} loading={model.loading} />
      </div>
    </div>
  );
}
