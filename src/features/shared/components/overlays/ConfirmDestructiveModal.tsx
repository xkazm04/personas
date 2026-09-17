import { useState, useCallback, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ConfirmDestructiveConfig {
  /** Modal title, e.g. "Delete Credential" */
  title: string;
  /** Warning copy shown below the title */
  message: string;
  /** Label for the confirm button (default: "Delete") */
  confirmLabel?: string;
  /** Optional key-value detail rows shown in the info card */
  details?: { label: string; value: string }[];
  /** Optional blast-radius (impact) UI rendered above the confirm actions. The
   *  host owns fetching + rendering so this modal stays a domain-free primitive
   *  (e.g. `<BlastRadiusPanelLazy fetcher={…} />` from features/overview). */
  blastRadius?: ReactNode;
  /**
   * When set, the user must type this exact string to enable the confirm button.
   * Use for high-impact deletions (e.g. persona name, credential name).
   */
  requireTypedConfirmation?: string;
  /** Optional warning banner shown below the detail card (yellow) */
  warningMessage?: string;
  /**
   * Fires when the user confirms the action. May return a promise: while it is
   * pending the modal stays open, both buttons are disabled, the confirm button
   * shows a spinner and Escape/backdrop dismissal is ignored, so a slow delete
   * cannot be fired twice. A rejection leaves the modal open with the typed
   * confirmation intact so the user can retry without retyping the name.
   */
  onConfirm: () => void | Promise<void>;
  /** Fires when the user cancels / closes the modal */
  onCancel: () => void;
}

export interface ConfirmDestructiveModalProps {
  open: boolean;
  config: ConfirmDestructiveConfig | null;
}

/* ------------------------------------------------------------------ */
/*  Inner content (rendered only when open to satisfy hook rules)       */
/* ------------------------------------------------------------------ */

function ModalContent({ config, busy, onClose, onConfirm }: {
  config: ConfirmDestructiveConfig;
  /** True while the host's `onConfirm` promise is in flight. */
  busy: boolean;
  onClose: () => void;
  /** Resolves true when the action succeeded, false when it threw. */
  onConfirm: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [typedValue, setTypedValue] = useState('');


  const confirmLabel = config.confirmLabel ?? t.common.delete;
  const needsTyping = !!config.requireTypedConfirmation;
  const typingMatches = !needsTyping || typedValue === config.requireTypedConfirmation;

  const handleConfirm = async () => {
    // The typed confirmation is cleared only AFTER the action settles. Clearing
    // it up front (the previous behaviour) meant a delete that failed left the
    // user staring at a disabled button and an empty box, having to retype the
    // name they had just typed.
    const ok = await onConfirm();
    if (ok) setTypedValue('');
  };

  const handleClose = () => {
    if (busy) return;
    setTypedValue('');
    onClose();
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <h3 id="confirm-destructive-title" className="typo-heading font-semibold text-foreground/90">
            {config.title}
          </h3>
          <p className="typo-body text-foreground mt-1">{config.message}</p>
        </div>
      </div>

      {/* Detail card */}
      {config.details && config.details.length > 0 && (
        <div className="bg-secondary/40 border border-primary/10 rounded-xl p-3 space-y-2">
          {config.details.map((d) => (
            <div key={d.label} className="flex items-center justify-between">
              <span className="text-sm font-mono uppercase text-foreground">{d.label}</span>
              <span className="typo-body text-foreground truncate ml-3 max-w-[200px]">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warning banner */}
      {config.warningMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="typo-body text-yellow-300/90">{config.warningMessage}</p>
        </div>
      )}

      {/* Blast radius (host-provided) */}
      {config.blastRadius}

      {/* Type-to-confirm */}
      {needsTyping && (
        <div className="space-y-1.5">
          <p className="typo-caption text-foreground">
            {(() => {
              const parts = t.common.type_to_confirm.split('{name}');
              return <>{parts[0]}<span className="font-semibold text-foreground">{config.requireTypedConfirmation}</span>{parts[1]}</>;
            })()}
          </p>
          <input
            type="text"
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            placeholder={config.requireTypedConfirmation}
            className="w-full px-3 py-2 typo-body rounded-lg bg-secondary/50 border border-primary/15 text-foreground placeholder:text-foreground focus:outline-none focus:border-red-500/40 transition-colors"
            autoFocus
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {/* Both controls are shared Buttons now: they own their own disabled
            treatment, so the hand-painted `disabled:*` classes are gone. */}
        <Button
          variant="ghost"
          onClick={handleClose}
          disabled={busy}
          className="px-4 py-2 typo-body text-foreground rounded-xl hover:bg-secondary/40"
        >
          {t.common.cancel}
        </Button>
        <Button
          onClick={() => void handleConfirm()}
          disabled={!typingMatches || busy}
          loading={busy}
          aria-busy={busy}
          className="px-4 py-2 typo-body font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ConfirmDestructiveModal({ open, config }: ConfirmDestructiveModalProps) {
  // One in-flight confirm per open modal. Lives here rather than in
  // `ModalContent` because the same flag has to disarm BaseModal's Escape and
  // backdrop dismissal, not just the two buttons.
  const [busy, setBusy] = useState(false);

  const handleClose = useCallback(() => {
    if (busy) return;
    config?.onCancel();
  }, [busy, config]);

  const handleConfirm = useCallback(async () => {
    if (busy || !config) return false;
    setBusy(true);
    try {
      await Promise.resolve(config.onConfirm());
      return true;
    } catch (err) {
      // Reported, not swallowed: the host owns the user-facing error message,
      // and the modal's only job is to stay open so the action can be retried.
      silentCatch('confirm-destructive')(err);
      return false;
    } finally {
      // React 19 makes a post-unmount state update a no-op, so this is safe
      // whether or not the host closed the modal on success.
      setBusy(false);
    }
  }, [busy, config]);

  return (
    <BaseModal
      isOpen={open}
      onClose={handleClose}
      titleId="confirm-destructive-title"
      maxWidthClass="max-w-sm"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
      portal
    >
      {config && (
        <ModalContent
          config={config}
          busy={busy}
          onClose={handleClose}
          onConfirm={handleConfirm}
        />
      )}
    </BaseModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

/**
 * Convenience hook that manages the open/config state for ConfirmDestructiveModal.
 *
 * Usage:
 *   const { modal, confirm } = useConfirmDestructive();
 *   confirm({ title: '...', message: '...', onConfirm: () => {} });
 *   <ConfirmDestructiveModal {...modal} />
 */
export function useConfirmDestructive() {
  const [state, setState] = useState<{ open: boolean; config: ConfirmDestructiveConfig | null }>({
    open: false,
    config: null,
  });

  const confirm = useCallback((config: Omit<ConfirmDestructiveConfig, 'onCancel'> & { onCancel?: () => void }) => {
    setState({
      open: true,
      config: {
        ...config,
        onCancel: () => {
          config.onCancel?.();
          setState({ open: false, config: null });
        },
        // Await, so a promise-returning action keeps the modal open (and busy)
        // until it settles, and a rejection never reaches the close.
        onConfirm: async () => {
          await Promise.resolve(config.onConfirm());
          setState({ open: false, config: null });
        },
      },
    });
  }, []);

  const dismiss = useCallback(() => {
    setState({ open: false, config: null });
  }, []);

  return { modal: state, confirm, dismiss };
}
