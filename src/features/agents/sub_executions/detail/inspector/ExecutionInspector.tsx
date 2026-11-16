import { useState } from 'react';
import { Wrench, Clock } from 'lucide-react';
import type { PersonaExecution } from '@/lib/types/types';
import { formatDuration } from '@/lib/utils/formatters';
import { parseToolSteps, durationColor } from './inspectorTypes';
import { InspectorStatStrip, StepIO } from './inspectorShared';
import { SubagentTree } from './SubagentTree';
import { useTranslation } from '@/i18n/useTranslation';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

interface ExecutionInspectorProps {
  execution: PersonaExecution;
}

/**
 * ExecutionInspector — the tool-call inspector for the execution detail
 * "Inspector" tab. A debugger-style master/detail: a compact, selectable list
 * of the run's tool calls on the left; the selected call's syntax-highlighted
 * input/output (via {@link StepIO} → `HighlightedJsonBlock`) fills the right
 * pane. Only one step's JSON is open at a time, so deep payloads get full
 * width instead of an endless scroll of stacked cards. A slim stat strip
 * (tokens · cost · cache · duration) sits on top.
 */
export function ExecutionInspector({ execution }: ExecutionInspectorProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const steps = parseToolSteps(execution.tool_steps ?? null);
  const [selected, setSelected] = useState(0);

  if (steps.length === 0) {
    return (
      <div className="space-y-4">
        <InspectorStatStrip execution={execution} />
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-surface-2 border border-hair flex items-center justify-center">
            <Wrench className="w-6 h-6 text-ink-1" />
          </div>
          <p className="typo-body text-ink-1">{e.no_tool_calls}</p>
          <p className="typo-body text-ink-2 mt-1">{e.tool_steps_appear}</p>
        </div>
      </div>
    );
  }

  const active = steps[Math.min(selected, steps.length - 1)]!;

  return (
    <div className="space-y-4">
      <InspectorStatStrip execution={execution} />

      <SubagentTree executionId={execution.id} />

      <div className="typo-eyebrow text-ink-1 flex items-center gap-1.5">
        <Wrench className="w-3 h-3" />
        {tx(e.tool_call_timeline_steps, { count: steps.length })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[210px_1fr] gap-3 rounded-modal border border-hair bg-surface-2 overflow-hidden">
        {/* Master — step list */}
        <div className="md:border-r border-hair bg-surface-1 max-h-[60vh] overflow-y-auto">
          {steps.map((step, i) => {
            const durMs = step.duration_ms != null ? Number(step.duration_ms) : null;
            const isActive = i === Math.min(selected, steps.length - 1);
            return (
              <PressSurface
                key={step.step_index}
                onPress={() => setSelected(i)}
                selected={isActive}
                className="w-full flex items-center gap-2 px-3 py-2 border-b border-hair last:border-b-0"
              >
                <span className="typo-code text-ink-1 w-4 text-right flex-shrink-0">{step.step_index}</span>
                <span className="typo-code text-ink-1 truncate flex-1">{step.tool_name}</span>
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-card typo-code border flex-shrink-0 ${durationColor(durMs)}`}>
                  <Clock className="w-2.5 h-2.5" />
                  {durMs != null ? formatDuration(durMs) : e.pending}
                </span>
              </PressSurface>
            );
          })}
        </div>

        {/* Detail — selected step's input/output */}
        <div className="min-w-0 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-card bg-surface-1 border border-hair flex items-center justify-center flex-shrink-0">
              <Wrench className="w-3 h-3 text-primary/70" />
            </div>
            <span className="typo-code text-ink-1 truncate">{active.tool_name}</span>
            <span className="ml-auto typo-code text-ink-1 tabular-nums">
              {active.duration_ms != null ? formatDuration(Number(active.duration_ms)) : e.pending}
            </span>
          </div>
          <StepIO step={active} />
        </div>
      </div>
    </div>
  );
}
