import { X, Zap, Rocket } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { useAutomationSetup } from '../../libs/useAutomationSetup';
import { AutomationTriggerStep } from './AutomationTriggerStep';
import { AutomationActionStep } from './AutomationActionStep';
import { AutomationConditionStep } from './AutomationConditionStep';
import { AutomationReviewStep } from './AutomationReviewStep';

interface AutomationSetupModalProps {
  open: boolean;
  personaId: string;
  onClose: () => void;
  onComplete: () => void;
  editAutomationId?: string | null;
}

export function AutomationSetupModal({
  open, personaId, onClose, onComplete, editAutomationId,
}: AutomationSetupModalProps) {
  const { t } = useTranslation();
  const s = useAutomationSetup(personaId, editAutomationId);

  const handleClose = () => { s.handleClose(); onClose(); };

  return (
    <BaseModal
      isOpen={open}
      onClose={handleClose}
      titleId="automation-setup-title"
      size="lg"
      panelClassName="bg-background border border-border/60 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          <h2 id="automation-setup-title" className="text-sm font-semibold text-foreground/90">
            {s.phase === 'idle' && (s.editAutomation ? t.agents.connectors.auto_modal_configure : t.agents.connectors.auto_modal_add)}
            {s.phase === 'analyzing' && t.agents.connectors.auto_modal_designing}
            {s.phase === 'preview' && t.agents.connectors.auto_modal_review}
            {s.phase === 'deploying' && t.agents.connectors.auto_modal_deploying}
            {s.phase === 'success' && t.agents.connectors.auto_modal_deployed}
            {s.phase === 'error' && t.agents.connectors.auto_modal_failed}
          </h2>
        </div>
        <button onClick={handleClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-6 max-h-[75vh] overflow-y-auto">
        {s.phase === 'idle' && (
            <AutomationTriggerStep
              description={s.description} setDescription={s.setDescription}
              platform={s.platform} setPlatform={s.setPlatform}
              editAutomation={s.editAutomation}
              needsCredential={s.needsCredential} hasPlatformCredential={s.hasPlatformCredential}
              platformCredentials={s.platformCredentials}
              platformCredentialId={s.platformCredentialId} setPlatformCredentialId={s.setPlatformCredentialId}
              platformConnector={s.platformConnector}
              githubRepos={s.githubRepos} githubPerms={s.githubPerms}
              githubRepo={s.githubRepo} setGithubRepo={s.setGithubRepo}
              loadingRepos={s.loadingRepos}
              zapierZaps={s.zapierZaps} loadingZaps={s.loadingZaps}
              canDesign={s.canDesign} onDesign={s.handleDesign}
            />
          )}
          {s.phase === 'analyzing' && (
            <AutomationActionStep
              elapsed={s.elapsed} stageIndex={s.stageIndex}
              tailLines={s.tailLines} outputLinesLength={s.design.outputLines.length}
              tailRef={s.tailRef as React.RefObject<HTMLDivElement>}
              onCancel={() => s.design.cancel()}
            />
          )}
          {s.phase === 'preview' && s.design.result && (
            <AutomationConditionStep
              designResult={{ ...s.design.result, workflow_definition: s.design.result.workflow_definition ?? undefined }} name={s.name} setName={s.setName}
              platform={s.platform} githubRepo={s.githubRepo}
              hasPlatformCredential={s.hasPlatformCredential}
              platformCredentials={s.platformCredentials}
              platformCredentialId={s.platformCredentialId}
              showAdvanced={s.showAdvanced} setShowAdvanced={s.setShowAdvanced}
              inputSchema={s.inputSchema} setInputSchema={s.setInputSchema}
              fallbackMode={s.fallbackMode} setFallbackMode={s.setFallbackMode}
              timeoutSecs={s.timeoutSecs} setTimeoutSecs={s.setTimeoutSecs}
              deployError={s.deployError}
            />
          )}
          {(s.phase === 'deploying' || s.phase === 'success' || (s.phase === 'error' && !s.deployError)) && (
            <AutomationReviewStep
              platform={s.platform}
              deployResult={s.deployResult}
              designError={s.design.error}
              onComplete={onComplete}
              onClose={handleClose}
              onReset={() => s.design.reset()}
              phase={s.phase as 'deploying' | 'success' | 'error'}
            />
          )}
      </div>

      {/* Footer -- only in preview phase */}
      {s.phase === 'preview' && (
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border/60">
          <button
            onClick={() => { s.design.reset(); s.setDescription(''); s.setLocalPhase(null); s.setDeployError(null); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >{t.agents.connectors.auto_start_over}</button>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="btn-md border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">{t.common.cancel}</button>
            <Tooltip
              content={
                !s.name.trim()
                  ? t.agents.connectors.auto_name_required
                  : !s.hasPlatformCredential && s.needsCredential
                    ? t.agents.connectors.auto_cred_required
                    : ''
              }
              placement="top"
              delay={200}
            >
              <button
                onClick={() => void s.handleDeploy()}
                disabled={!s.name.trim() || (!s.hasPlatformCredential && s.needsCredential)}
                className="btn-md flex items-center gap-1.5 font-medium bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Rocket className="w-3.5 h-3.5" />
                {t.agents.connectors.auto_deploy_save}
              </button>
            </Tooltip>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
