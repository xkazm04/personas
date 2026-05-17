import { useTranslation } from '@/i18n/useTranslation';
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
  const { t, tx } = useTranslation();
  const hasGithub = Boolean(activeProject?.github_url);

  const steps = buildFlowSteps(devClone, hasScheduleTrigger, hasApprovedListener, hasRejectedListener, goalCount, t, tx);
  const missingPersona = !loading && !devClone;

  return (
    <div className="space-y-6 pb-6">
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
