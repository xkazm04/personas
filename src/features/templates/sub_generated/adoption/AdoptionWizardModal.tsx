import { useState } from 'react';
import { X, Download, Sparkles, Grid3X3 } from 'lucide-react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { AdoptionWizardProvider } from './AdoptionWizardContext';
import { AdoptionWizardInner } from './AdoptionWizardInner';
import { MatrixAdoptionView } from './MatrixAdoptionView';
import { BaseModal } from '../shared/BaseModal';

export type AdoptionMode = 'wizard' | 'quick' | 'matrix';

const MODE_TABS: { key: AdoptionMode; label: string; icon: typeof Download }[] = [
  { key: 'wizard', label: 'Full Wizard', icon: Download },
  { key: 'quick', label: 'Legacy Matrix', icon: Sparkles },
  { key: 'matrix', label: 'New Matrix', icon: Grid3X3 },
];

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

export function AdoptionModeSwitcher({
  mode,
  setMode,
}: {
  mode: AdoptionMode;
  setMode: (m: AdoptionMode) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary/30 border border-primary/8">
      {MODE_TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = mode === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setMode(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors ${
              isActive
                ? 'bg-primary/15 text-primary shadow-sm'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70'
            }`}
          >
            <Icon className="w-3 h-3" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  const [mode, setMode] = useState<AdoptionMode>('quick');

  if (!isOpen) return null;

  // New Matrix mode — MatrixAdoptionView
  if (mode === 'matrix' && review) {
    return (
      <BaseModal
        isOpen
        onClose={onClose}
        titleId="adoption-matrix-title"
        maxWidthClass="max-w-[1400px]"
        panelClassName="h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="relative h-full overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Grid3X3 className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <div>
                <h2 id="adoption-matrix-title" className="text-sm font-semibold text-foreground/90">
                  Adopt Template
                </h2>
                <p className="text-[11px] text-muted-foreground/60">{review.test_case_name}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <AdoptionModeSwitcher mode={mode} setMode={setMode} />
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <MatrixAdoptionView
            review={review}
            onClose={onClose}
            onPersonaCreated={onPersonaCreated}
          />
        </div>
      </BaseModal>
    );
  }

  // Full Wizard and Legacy Matrix (quick-adopt) both use the wizard provider
  // The mode is passed through so AdoptionWizardInner can decide which view to show
  return (
    <AdoptionWizardProvider
      isOpen={isOpen}
      review={review}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      onPersonaCreated={onPersonaCreated}
    >
      <AdoptionWizardInner
        onClose={onClose}
        adoptionMode={mode}
        setAdoptionMode={setMode}
      />
    </AdoptionWizardProvider>
  );
}
