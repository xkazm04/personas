// Dispatch-Fleet modal — the context-menu counterpart to "Open terminal".
// Instead of an empty interactive terminal, this seeds a background Fleet
// session in the project root with a custom instruction: the user writes a
// task, we spawn `claude "<instruction>"` and stay on the canvas (the session
// docks as an island fleet badge for later inspection — no preview panel).
import { useState } from 'react';
import { Rocket } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';

export function DispatchFleetModal({ name, onDispatch, onClose }: {
  /** Project (island) display name — shown in the header. */
  name: string;
  /** Spawn the background session with this instruction. Rejects on failure so
   *  the modal stays open and the button re-enables. */
  onDispatch: (instruction: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const instruction = text.trim();

  const dispatch = async () => {
    if (!instruction || dispatching) return;
    setDispatching(true);
    try {
      await onDispatch(instruction);
      onClose();
    } finally {
      setDispatching(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="mm-dispatch-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="mm-dispatch-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Rocket className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="mm-dispatch-title" className="typo-title truncate">{t.mastermind.dispatch_modal_title}</span>
          <span className="ml-auto typo-caption text-foreground/50 truncate max-w-[160px]">{name}</span>
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <p className="typo-caption text-foreground/55 leading-snug" style={{ fontWeight: 400 }}>
            {t.mastermind.dispatch_modal_desc}
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.mastermind.dispatch_placeholder}
            rows={5}
            autoFocus
            disabled={dispatching}
            // ⌘/Ctrl+Enter submits — the terminal-native shortcut for "send".
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void dispatch(); }}
            className="w-full resize-y min-h-[112px] px-3 py-2 typo-body rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35 disabled:opacity-60"
            data-testid="mm-dispatch-input"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-primary/10 bg-secondary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 rounded-interactive typo-caption text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={dispatch}
            disabled={!instruction || dispatching}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            data-testid="mm-dispatch-submit"
          >
            <Rocket className="w-3 h-3" aria-hidden />
            {dispatching ? t.mastermind.dispatch_submitting : t.mastermind.dispatch_submit}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
