import { X, Zap, Rocket } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { ModalPhase } from '../libs/automationSetupConstants';
import { useAutomationSetupState } from '../libs/useAutomationSetupState';
import { IdlePhase } from './IdlePhase';
import { AnalyzingPhase } from './AnalyzingPhase';
import { PreviewPhase } from './PreviewPhase';
import { DeployingPhase } from './DeployingPhase';
import { SuccessPhase } from './SuccessPhase';
import { ErrorPhase } from './ErrorPhase';

interface AutomationSetupModalProps {
  open: boolean;
  personaId: string;
  onClose: () => void;
  onComplete: () => void;
  editAutomationId?: string | null;
}

export function AutomationSetupModal({
  open,
  personaId,
  onClose,
  onComplete,
  editAutomationId,
}: AutomationSetupModalProps) {
  const state = useAutomationSetupState(personaId, editAutomationId);

  const handleModalClose = () => {
    state.handleClose();
    onClose();
  };

  const phase: ModalPhase = state.localPhase ?? (state.deployError ? 'error' : state.design.phase);

  return (
    <BaseModal
      isOpen={open}
      onClose={handleModalClose}
      titleId="automation-setup-title"
      size="lg"
      panelClassName="bg-background border border-border/60 rounded-2xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-accent" />
          <h2 id="automation-setup-title" className="text-sm font-semibold text-foreground/90">
            {phase === 'idle' && (state.editAutomation ? 'Configure Automation' : 'Add Automation')}
            {phase === 'analyzing' && 'Designing Automation...'}
            {phase === 'preview' && 'Review Automation'}
            {phase === 'deploying' && 'Deploying...'}
            {phase === 'success' && 'Automation Deployed'}
            {phase === 'error' && 'Deployment Failed'}
          </h2>
        </div>
        <button onClick={handleModalClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-6 max-h-[75vh] overflow-y-auto">
        <AnimatePresence mode="wait">
          {phase === 'idle' && (
            <IdlePhase
              description={state.description}
              setDescription={state.setDescription}
              platform={state.platform}
              setPlatform={state.setPlatform}
              editAutomation={state.editAutomation}
              needsCredential={state.needsCredential}
              hasPlatformCredential={state.hasPlatformCredential}
              platformCredentials={state.platformCredentials}
              platformCredentialId={state.platformCredentialId}
              setPlatformCredentialId={state.setPlatformCredentialId}
              platformConnector={state.platformConnector}
              githubRepos={state.githubRepos}
              githubPerms={state.githubPerms}
              githubRepo={state.githubRepo}
              setGithubRepo={state.setGithubRepo}
              loadingRepos={state.loadingRepos}
              zapierZaps={state.zapierZaps}
              loadingZaps={state.loadingZaps}
              canDesign={state.canDesign}
              handleDesign={state.handleDesign}
            />
          )}

          {phase === 'analyzing' && (
            <AnalyzingPhase
              elapsed={state.elapsed}
              outputLines={state.design.outputLines}
              onCancel={() => state.design.cancel()}
            />
          )}

          {phase === 'preview' && state.design.result && (
            <PreviewPhase
              designResult={state.design.result}
              name={state.name}
              setName={state.setName}
              platform={state.platform}
              inputSchema={state.inputSchema}
              setInputSchema={state.setInputSchema}
              timeoutSecs={state.timeoutSecs}
              setTimeoutSecs={state.setTimeoutSecs}
              fallbackMode={state.fallbackMode}
              setFallbackMode={state.setFallbackMode}
              showAdvanced={state.showAdvanced}
              setShowAdvanced={state.setShowAdvanced}
              hasPlatformCredential={state.hasPlatformCredential}
              platformCredentials={state.platformCredentials}
              platformCredentialId={state.platformCredentialId}
              githubRepo={state.githubRepo}
              deployError={state.deployError}
            />
          )}

          {phase === 'deploying' && (
            <DeployingPhase platform={state.platform} />
          )}

          {phase === 'success' && state.deployResult && (
            <SuccessPhase
              platform={state.platform}
              deployResult={state.deployResult}
              onDone={() => { onComplete(); handleModalClose(); }}
            />
          )}

          {phase === 'error' && !state.deployError && (
            <ErrorPhase
              errorMessage={state.design.error || 'Unknown error'}
              onClose={handleModalClose}
              onRetry={() => state.design.reset()}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Footer -- only in preview phase */}
      {phase === 'preview' && (
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border/60">
          <button
            onClick={() => { state.design.reset(); state.setDescription(''); state.setLocalPhase(null); state.setDeployError(null); }}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Start over
          </button>
          <div className="flex items-center gap-2">
            <button onClick={handleModalClose} className="btn-md border border-border text-muted-foreground hover:bg-secondary/50 transition-colors">
              Cancel
            </button>
            <button
              onClick={() => void state.handleDeploy()}
              disabled={!state.name.trim() || (!state.hasPlatformCredential && state.needsCredential)}
              className="btn-md flex items-center gap-1.5 font-medium bg-accent/20 border border-accent/30 text-foreground/90 hover:bg-accent/30 transition-colors disabled:opacity-40"
            >
              <Rocket className="w-3.5 h-3.5" />
              Deploy & Save
            </button>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
