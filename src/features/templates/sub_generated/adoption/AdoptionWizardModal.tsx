import { useState } from 'react';
import { X, Download, Sparkles } from 'lucide-react';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { AdoptionWizardProvider } from './AdoptionWizardContext';
import { AdoptionWizardInner } from './AdoptionWizardInner';
import { MatrixAdoptionView } from './MatrixAdoptionView';
import { BaseModal } from '../shared/BaseModal';

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
}

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  const [mode, setMode] = useState<'wizard' | 'matrix'>('wizard');

  if (!isOpen) return null;

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
          {/* Header with tab switcher */}
          <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                <Sparkles className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <div>
                <h2 id="adoption-matrix-title" className="text-sm font-semibold text-foreground/90">
                  Adopt Template
                </h2>
                <p className="text-[11px] text-muted-foreground/60">{review.test_case_name}</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Tab switcher */}
              <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary/30">
                <button
                  type="button"
                  onClick={() => setMode('wizard')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors text-muted-foreground/50 hover:text-muted-foreground/70"
                >
                  <Download className="w-3 h-3" />
                  Wizard
                </button>
                <button
                  type="button"
                  onClick={() => setMode('matrix')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors bg-primary/15 text-primary shadow-sm"
                >
                  <Sparkles className="w-3 h-3" />
                  Matrix
                </button>
              </div>

              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Matrix adoption body */}
          <MatrixAdoptionView
            review={review}
            onClose={onClose}
            onPersonaCreated={onPersonaCreated}
          />
        </div>
      </BaseModal>
    );
  }

  // Legacy wizard mode
  return (
    <AdoptionWizardProvider
      isOpen={isOpen}
      review={review}
      credentials={credentials}
      connectorDefinitions={connectorDefinitions}
      onPersonaCreated={onPersonaCreated}
    >
      <AdoptionWizardInnerWithTabs
        onClose={onClose}
        onSwitchToMatrix={() => setMode('matrix')}
      />
    </AdoptionWizardProvider>
  );
}

/** Wraps AdoptionWizardInner with a tab switcher injected into the header. */
function AdoptionWizardInnerWithTabs({ onClose, onSwitchToMatrix }: { onClose: () => void; onSwitchToMatrix: () => void }) {
  return (
    <div className="relative">
      {/* Tab switcher overlay — positioned in the header area */}
      <div className="absolute top-3 right-14 z-50">
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-secondary/30">
          <button
            type="button"
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors bg-primary/15 text-primary shadow-sm"
          >
            <Download className="w-3 h-3" />
            Wizard
          </button>
          <button
            type="button"
            onClick={onSwitchToMatrix}
            className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-medium transition-colors text-muted-foreground/50 hover:text-muted-foreground/70"
          >
            <Sparkles className="w-3 h-3" />
            Matrix
          </button>
        </div>
      </div>
      <AdoptionWizardInner onClose={onClose} />
    </div>
  );
}
