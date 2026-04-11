import { Check, FileEdit, Sparkles, Play, BarChart3 } from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from '@/i18n/useTranslation';

const LAB_PHASES = [
  { key: 'drafting', icon: FileEdit },
  { key: 'generating', icon: Sparkles },
  { key: 'executing', icon: Play },
  { key: 'summarizing', icon: BarChart3 },
] as const;

const PHASE_LABELS: Record<string, string> = {
  drafting: 'phase_drafting',
  generating: 'phase_generating',
  executing: 'phase_executing',
  summarizing: 'phase_summarizing',
};

function phaseIndex(phase: string): number {
  const idx = LAB_PHASES.findIndex((p) => p.key === phase);
  return idx === -1 ? 0 : idx;
}

export function LabProgress() {
  const { t } = useTranslation();
  const isLabRunning = useAgentStore((s) => s.isLabRunning);
  const labProgress = useAgentStore((s) => s.labProgress);

  if (!isLabRunning || !labProgress) return null;

  const currentIdx = phaseIndex(labProgress.phase);

  return (
    <div className="animate-fade-slide-in overflow-hidden">
      <div className="p-4 rounded-xl bg-secondary/30 border border-primary/10 space-y-3" role="status" aria-live="polite">
        {/* Phase stepper */}
        <div className="flex items-center justify-between">
          {LAB_PHASES.map((phase, i) => {
            const isCompleted = i < currentIdx;
            const isActive = i === currentIdx;
            const Icon = phase.icon;

            return (
              <div key={phase.key} className="flex items-center flex-1 last:flex-none">
                {/* Step node */}
                <div className="flex flex-col items-center gap-1 min-w-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                      isCompleted
                        ? 'bg-emerald-500/40 text-emerald-200'
                        : isActive
                          ? 'bg-primary/50 text-primary-foreground shadow-[0_0_8px_rgba(139,92,246,0.3)]'
                          : 'bg-primary/10 text-muted-foreground/40'
                    } ${isActive ? 'animate-pulse' : ''}`}
                  >
                    {isCompleted ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span
                    className={`text-[10px] leading-tight transition-colors ${
                      isCompleted
                        ? 'text-emerald-400/70'
                        : isActive
                          ? 'text-foreground/80 font-medium'
                          : 'text-muted-foreground/40'
                    }`}
                  >
                    {(t.agents.lab as Record<string, string>)[PHASE_LABELS[phase.key] ?? ''] ?? phase.key}
                  </span>
                </div>

                {/* Connecting line */}
                {i < LAB_PHASES.length - 1 && (
                  <div className="flex-1 mx-1.5 h-0.5 rounded-full relative overflow-hidden bg-primary/10 self-start mt-3.5">
                    <div
                      className="absolute inset-y-0 left-0 bg-emerald-500/50 rounded-full transition-all duration-500"
                      style={{ width: i < currentIdx ? '100%' : '0%' }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail row: status text + counters */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-foreground/70">
            {labProgress.phase === 'drafting'
              ? t.agents.lab.generating_draft
              : labProgress.phase === 'generating'
                ? t.agents.lab.generating_scenarios
                : labProgress.phase === 'summarizing'
                  ? t.agents.lab.generating_summary
                  : labProgress.phase === 'executing'
                    ? `Testing ${labProgress.modelId ?? ''} \u2014 ${labProgress.scenarioName ?? ''}`
                    : labProgress.phase}
          </span>

          {labProgress.total != null && (
            <div className="flex items-center gap-3">
              {labProgress.elapsedMs != null && (
                <span className="text-xs text-muted-foreground/50 tabular-nums">
                  {labProgress.elapsedMs >= 60000
                    ? `${Math.floor(labProgress.elapsedMs / 60000)}m ${Math.round((labProgress.elapsedMs % 60000) / 1000)}s`
                    : `${(labProgress.elapsedMs / 1000).toFixed(1)}s`}
                </span>
              )}
              <span className="text-sm text-muted-foreground/90 tabular-nums">
                {labProgress.current ?? 0} / {labProgress.total}
              </span>
            </div>
          )}
        </div>

        {/* Scores */}
        {labProgress.scores && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground/90">
            <span>Tool: {labProgress.scores.tool_accuracy ?? '--'}</span>
            <span>Output: {labProgress.scores.output_quality ?? '--'}</span>
            <span>Protocol: {labProgress.scores.protocol_compliance ?? '--'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
