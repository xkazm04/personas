// Trace tab host — owns the level switch (matrix ⇄ skill tree) and the
// workspace summary band. Mirrors RegistryTab's guard shape; visuals are the
// fresh /prototype-ready baselines in TraceOverview / SkillTreeView.
import { useState } from 'react';

import { motion } from 'framer-motion';

import { IllustratedEmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';

import { SkillTreeView } from './SkillTreeView';
import { TraceOverview } from './TraceOverview';
import { useSkillTraceModel } from './useSkillTraceModel';
import { useSkillTreeModel } from './useSkillTreeModel';
import type { TraceModel } from './traceTypes';

export interface TraceTabProps {
  activeProjectId: string | null;
  onOpenInfo: (skill: string) => void;
}

export function TraceTab({ activeProjectId, onOpenInfo }: TraceTabProps) {
  const { t, tx } = useTranslation();
  const reduced = useReducedMotion();
  const model = useSkillTraceModel(activeProjectId);
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  if (!model.header) {
    return (
      <div className="py-10">
        <IllustratedEmptyState
          variant="heatmap"
          heading={t.plugins.dev_tools.trace_no_workspace_title}
          description={t.plugins.dev_tools.trace_no_workspace_hint}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="skills-trace-tab">
      <div className="flex items-center gap-2 pb-2">
        <span
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={model.header.color ? { backgroundColor: model.header.color } : undefined}
        />
        <span className="typo-body font-medium">{model.header.name}</span>
        <span className="typo-caption text-foreground">
          {tx(t.plugins.dev_tools.trace_summary, { projects: model.projects.length })}
        </span>
      </div>
      {/* one-shot crossfade on level change (matrix ⇄ tree); CircuitWires
          precedent — reduced motion skips the entrance entirely */}
      <motion.div
        key={selectedSkill ?? 'overview'}
        initial={reduced ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex-1 min-h-0 flex flex-col"
      >
        {selectedSkill ? (
          <TreeHost
            skillName={selectedSkill}
            trace={model}
            onBack={() => setSelectedSkill(null)}
            onOpenInfo={onOpenInfo}
          />
        ) : (
          <TraceOverview model={model} onSelectSkill={setSelectedSkill} onOpenInfo={onOpenInfo} />
        )}
      </motion.div>
    </div>
  );
}

function TreeHost({ skillName, trace, onBack, onOpenInfo }: {
  skillName: string;
  trace: TraceModel;
  onBack: () => void;
  onOpenInfo: (skill: string) => void;
}) {
  const tree = useSkillTreeModel(skillName, trace);
  return <SkillTreeView model={tree} onBack={onBack} onOpenInfo={onOpenInfo} />;
}
