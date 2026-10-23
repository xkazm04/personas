/**
 * LensSheetFrame - the frame a lens-scan card opens over the deck while the
 * blueprint loads or cannot open, and around a release's read-only
 * composition (spark one-control, WP3).
 *
 * It sits in the blueprint's escape stack: its keys register at the
 * blueprint's own rung (`BLUEPRINT_PRIORITY`, above the deck's Esc) and are
 * exclusive, so no key reaches the deck behind it. Esc closes the frame,
 * never the deck in the same press; Enter fires the frame's primary action
 * when it has one.
 */
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { BaseModal } from '@/lib/ui/BaseModal';

import { BLUEPRINT_PRIORITY } from '../blueprint/controller/useSheetKeys';

const TITLE_ID = 'lens-sheet-title';

export function LensSheetFrame({ eyebrow, title, onClose, onEnter, footer, children, testId }: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  /** Enter: the frame's one primary action, when it has one. */
  onEnter?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  const { t } = useTranslation();
  useAppKeyboard((e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
      return true;
    }
    if (e.key === 'Enter' && onEnter && !e.repeat) {
      e.preventDefault();
      onEnter();
      return true;
    }
    // Exclusive: every other key stays here, off the deck behind the frame.
    return true;
  }, { priority: BLUEPRINT_PRIORITY, exclusive: true });

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} portal size="lg" staggerChildren={false}>
      <div className="flex max-h-[80vh] flex-col gap-4 p-6" data-testid={testId}>
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="typo-eyebrow text-foreground">{eyebrow}</span>
            <h2 id={TITLE_ID} className="typo-heading-lg text-foreground">{title}</h2>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.decisionCenter.lens.close} icon={<X className="h-4 w-4" aria-hidden />} />
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2">{footer}</footer>}
      </div>
    </BaseModal>
  );
}
