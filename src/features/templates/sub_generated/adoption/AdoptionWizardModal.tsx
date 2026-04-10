import { X, Grid3X3 } from 'lucide-react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { MatrixAdoptionView } from './MatrixAdoptionView';
import { BaseModal } from '../shared/BaseModal';

interface AdoptionWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  onPersonaCreated: () => void;
}

export default function AdoptionWizardModal({
  isOpen,
  onClose,
  review,
  onPersonaCreated,
}: AdoptionWizardModalProps) {
  if (!isOpen || !review) return null;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="adoption-matrix-title"
      maxWidthClass="max-w-[1750px]"
      panelClassName="h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden flex flex-col"
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
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95"
          >
            <X className="w-4 h-4" />
          </button>
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
