// "New race": the shared setup form (seats, line-ups, judges toggle — off by
// default — and the optional Athena draft) in a right-hand drawer, so the
// track stays visible behind it. A created race is focused by the form and
// lands on the track when the drawer closes.
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';

import { SetupForm } from '../../components/SetupForm';
import { ARENA } from './copy';

const TITLE_ID = 'arena-setup-title';

export function SetupDrawer({ defaultProjectId, onClose }: { defaultProjectId: string | null; onClose: () => void }) {
  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal maxWidthClass="max-w-3xl">
      <div className="flex h-full min-h-0 flex-col" data-testid="arena-setup">
        <header className="flex items-start gap-3 border-b border-primary/10 px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 id={TITLE_ID} className="typo-section-title">
              {ARENA.setupTitle}
            </h2>
            <p className="typo-caption text-foreground">{ARENA.setupHint}</p>
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={ARENA.close} onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <SetupForm defaultProjectId={defaultProjectId} onCreated={onClose} />
        </div>
      </div>
    </BaseModal>
  );
}
