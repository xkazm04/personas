import { useMemo } from 'react';
import { ReadinessGates, type QualityGate } from '../setup/ReadinessGates';
import { DevCloneAdoptionCard } from '../setup/DevCloneAdoptionCard';
import { buildFlowSteps, FlowStepsList, TriggerList } from '../setup/FlowSteps';
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

export function SetupTab({
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
