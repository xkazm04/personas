// Setup as a command palette: `n` summons it over the ledger, Esc dismisses
// it, and a created contest lands in the ledger already open. The form is
// the shared SetupForm (click-to-build seats, line-ups, judges off by
// default, the optional Athena draft) — the palette is only its frame.
import { useId } from 'react';
import { Terminal } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

import { SetupForm } from '../../components/SetupForm';
import { LEDGER_COPY as C } from './copy';

export interface CommandSetupProps {
  open: boolean;
  onClose: () => void;
  onCreated: (summary: ContestSummary) => void;
}

export function CommandSetup({ open, onClose, onCreated }: CommandSetupProps) {
  const titleId = useId();
  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId={titleId}
      maxWidthClass="max-w-3xl"
      portal
      staggerChildren={false}
    >
      <div className="flex max-h-[85vh] flex-col" data-testid="ledger-command-setup">
        <header className="flex items-center gap-2 border-b border-primary/12 px-4 py-3">
          <Terminal aria-hidden className="h-4 w-4 text-primary" />
          <h2 id={titleId} className="typo-heading">
            {C.setupTitle}
          </h2>
          <kbd className="ml-auto rounded-interactive border border-primary/20 bg-secondary/50 px-1.5 py-0.5 typo-code text-foreground">
            Esc
          </kbd>
        </header>
        <p className="px-4 pt-2 typo-caption text-foreground">{C.setupHint}</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
          <SetupForm onCreated={(summary) => onCreated(summary)} />
        </div>
      </div>
    </BaseModal>
  );
}
