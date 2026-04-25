import { useMemo, useState } from 'react';
import { ReadinessGates, type QualityGate } from '../setup/ReadinessGates';
import { DevCloneAdoptionCard } from '../setup/DevCloneAdoptionCard';
import { buildFlowSteps, FlowStepsList, TriggerList } from '../setup/FlowSteps';
import { SetupMissionControl } from '../setup/variants/SetupMissionControl';
import { SetupLoop } from '../setup/variants/SetupLoop';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

interface SetupTabProps {
  devClone: Persona | null;
  triggers: PersonaTrigger[];
  activeProject: { name: string; root_path: string; github_url?: string | null } | null;
  goalCount: number;
  hasApprovedListener: boolean;
  hasRejectedListener: boolean;
  hasScheduleTrigger: boolean;
  loading: boolean;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Variant switcher (prototype scaffolding — removed once a winner is picked)
// ---------------------------------------------------------------------------

type VariantId = 'baseline' | 'mission' | 'loop';

const VARIANTS: { id: VariantId; label: string; subtitle: string }[] = [
  { id: 'baseline', label: 'Baseline', subtitle: 'Current cards' },
  { id: 'mission', label: 'Mission Control', subtitle: 'Linear chapters' },
  { id: 'loop', label: 'The Loop', subtitle: 'Cycle diagram' },
];

export function SetupTab(props: SetupTabProps) {
  const [variant, setVariant] = useState<VariantId>('baseline');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 p-1 rounded-card border border-primary/10 bg-card/30 w-fit">
        {VARIANTS.map((v) => {
          const active = v.id === variant;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              className={[
                'px-3 py-1.5 rounded-interactive transition-colors text-left',
                active
                  ? 'bg-violet-500/15 border border-violet-500/30 text-foreground'
                  : 'border border-transparent text-foreground/70 hover:bg-secondary/30',
              ].join(' ')}
            >
              <div className="text-sm font-semibold leading-tight">{v.label}</div>
              <div className="text-xs text-foreground/50 leading-tight">{v.subtitle}</div>
            </button>
          );
        })}
      </div>

      {variant === 'baseline' && <SetupTabBaseline {...props} />}
      {variant === 'mission' && <SetupMissionControl {...props} />}
      {variant === 'loop' && <SetupLoop {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SetupTabBaseline — the original implementation, preserved for A/B
// ---------------------------------------------------------------------------

function SetupTabBaseline({
  devClone, triggers, activeProject, goalCount,
  hasApprovedListener, hasRejectedListener, hasScheduleTrigger,
  loading, onRefresh,
}: SetupTabProps) {
  const hasGithub = Boolean(activeProject?.github_url);

  const gates: QualityGate[] = useMemo(() => [
    { id: 'project', label: 'Dev project selected', ok: Boolean(activeProject), weight: 15 },
    { id: 'github', label: 'GitHub repo linked', ok: hasGithub, weight: 15 },
    { id: 'persona', label: 'Dev Clone adopted', ok: Boolean(devClone), weight: 25 },
    { id: 'schedule', label: 'Hourly scan scheduled', ok: hasScheduleTrigger, weight: 15 },
    { id: 'approved', label: 'Approval listener wired', ok: hasApprovedListener, weight: 15 },
    { id: 'rejected', label: 'Rejection listener wired', ok: hasRejectedListener, weight: 15 },
  ], [activeProject, hasGithub, devClone, hasScheduleTrigger, hasApprovedListener, hasRejectedListener]);

  const qualityScore = useMemo(
    () => gates.reduce((acc, g) => acc + (g.ok ? g.weight : 0), 0),
    [gates],
  );

  const steps = buildFlowSteps(devClone, hasScheduleTrigger, hasApprovedListener, hasRejectedListener, goalCount);
  const missingPersona = !loading && !devClone;

  return (
    <div className="space-y-6 pb-6">
      <ReadinessGates gates={gates} qualityScore={qualityScore} />

      {missingPersona && (
        <DevCloneAdoptionCard
          onAdopted={onRefresh}
          activeProjectName={activeProject?.name ?? null}
          activeProjectHasGithub={hasGithub}
          activeProjectRootPath={activeProject?.root_path ?? null}
        />
      )}

      <FlowStepsList steps={steps} />
      <TriggerList triggers={triggers} />
    </div>
  );
}
