// Setup layer: loading a new roll is a slide-over from the right edge, so the
// light table stays visible behind it. The shared SetupForm does the work
// (seats, line-ups, the judge toggle OFF by default, the Athena draft); on
// create it focuses the new roll, and the drawer closes onto its lightbox.
// Extractable: a right-drawer host for SetupForm.
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';

import { SetupForm } from '../../components/SetupForm';
import { CONTACT_COPY as C } from './copy';

const TITLE_ID = 'contact-new-roll-title';

export interface NewRollSlideOverProps {
  open: boolean;
  onClose: () => void;
  defaultProjectId?: string | null;
}

export function NewRollSlideOver({ open, onClose, defaultProjectId }: NewRollSlideOverProps) {
  return (
    <BaseModal isOpen={open} onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal maxWidthClass="max-w-2xl">
      <div className="flex h-full flex-col" data-testid="contact-new-roll">
        <div className="flex items-start gap-3 border-b border-primary/10 px-5 py-4">
          <div className="flex-1 min-w-0 space-y-0.5">
            <h2 id={TITLE_ID} className="typo-section-title">
              {C.newRollTitle}
            </h2>
            <p className="typo-caption text-foreground">{C.newRollSubtitle}</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={C.close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <SetupForm defaultProjectId={defaultProjectId} onCreated={() => onClose()} />
        </div>
      </div>
    </BaseModal>
  );
}
