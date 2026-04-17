import { GOOGLE_WORKSPACE } from './workspaceProviders';
import { ProviderSection } from './ProviderSection';

interface WorkspaceConnectPanelProps {
  onBack: () => void;
  onComplete: () => void;
}

export function WorkspaceConnectPanel({ onBack, onComplete }: WorkspaceConnectPanelProps) {
  return (
    <div
      className="animate-fade-slide-in bg-secondary/35 border border-primary/15 rounded-modal p-4"
      data-testid="vault-workspace-container"
    >
      <ProviderSection
        provider={GOOGLE_WORKSPACE}
        onBack={onBack}
        onComplete={onComplete}
      />
    </div>
  );
}
