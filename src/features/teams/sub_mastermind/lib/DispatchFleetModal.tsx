// Dispatch-Fleet modal — the context-menu counterpart to "Open terminal".
// Instead of an empty interactive terminal, this seeds a background Fleet
// session in the project root with a custom instruction: the user writes a
// task, we spawn `claude "<instruction>"` and stay on the canvas (the session
// docks as an island fleet badge for later inspection — no preview panel).
import { useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Rocket } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

export function DispatchFleetModal({ name, targetCount, onDispatch, onClose }: {
  /** Project (island) display name, or a group's label — shown in the header. */
  name: string;
  /** How many projects the instruction will reach. Omitted or 1 = a single
   *  island; more = a group dispatch, and the header says so, because "run this
   *  in 6 repos" is not a click you want to make by accident. */
  targetCount?: number;
  /** Spawn the background session with this instruction. Rejects on failure so
   *  the modal stays open and the button re-enables. */
  onDispatch: (instruction: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const [text, setText] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const instruction = text.trim();

  const dispatch = async () => {
    if (!instruction || dispatching) return;
    setDispatching(true);
    try {
      await onDispatch(instruction);
      onClose();
    } catch (err) {
      // The rejection is the "stay open" signal; onDispatch already toasted
      // it. Letting it escape had no awaiter - the click / Ctrl+Enter handler
      // drops the promise - so every failed dispatch was an unhandledrejection.
      silentCatch('mastermind dispatch modal')(err);
    } finally {
      setDispatching(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId="mm-dispatch-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="mm-dispatch-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-hair bg-surface-1">
          <Rocket className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="mm-dispatch-title" className="typo-title truncate">{t.mastermind.dispatch_modal_title}</span>
          <span className="ml-auto typo-caption text-ink-3 truncate max-w-[160px]">{name}</span>
          {(targetCount ?? 1) > 1 && (
            <span className="typo-data text-ink-2 shrink-0">
              {tx(t.mastermind.dispatch_target_count, { count: targetCount ?? 1 })}
            </span>
          )}
        </div>

        <div className="px-4 py-3 space-y-2.5">
          <p className="typo-caption text-ink-3" style={{ fontWeight: 400 }}>
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
            className="w-full resize-y min-h-[112px] px-3 py-2 typo-body rounded-input bg-background/70 border border-hair text-foreground outline-none focus:border-primary/40 placeholder:text-ink-3 disabled:is-disabled"
            data-testid="mm-dispatch-input"
          />
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-hair bg-surface-1">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="secondary" size="sm" onClick={dispatch} disabled={!instruction || dispatching} data-testid="mm-dispatch-submit" icon={<Rocket className="w-3 h-3" aria-hidden />}>
{dispatching ? t.mastermind.dispatch_submitting : t.mastermind.dispatch_submit}
</Button>
        </div>
      </div>
    </BaseModal>
  );
}
