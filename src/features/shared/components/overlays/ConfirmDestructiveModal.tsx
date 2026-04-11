import { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { BlastRadiusPanel, useBlastRadius } from '@/features/shared/components/display/BlastRadiusPanel';
import type { BlastRadiusItem } from '@/api/agents/personas';
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
  /** Pre-fetched blast-radius items */
  blastRadiusItems?: BlastRadiusItem[];
  /** Whether blast-radius data is still loading (use with blastRadiusItems) */
  blastRadiusLoading?: boolean;
  /** Fetcher for blast-radius items (fetched when modal opens) */
  blastRadiusFetcher?: () => Promise<BlastRadiusItem[]>;
  /**
   * When set, the user must type this exact string to enable the confirm button.
   * Use for high-impact deletions (e.g. persona name, credential name).
   */
  requireTypedConfirmation?: string;
  /** Optional warning banner shown below the detail card (yellow) */
  warningMessage?: string;
  /** Fires when the user confirms the action */
  onConfirm: () => void;
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

function ModalContent({ config, onClose, onConfirm }: {
  config: ConfirmDestructiveConfig;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const [typedValue, setTypedValue] = useState('');

  // Fetch blast radius dynamically if a fetcher is provided
  const noop = useCallback(async () => [] as BlastRadiusItem[], []);
  const { items: fetchedItems, loading: fetchLoading } = useBlastRadius(
    config.blastRadiusFetcher ?? noop,
    !!config.blastRadiusFetcher,
  );

  // Prefer pre-supplied items, fall back to fetched
  const hasFetcher = !!config.blastRadiusFetcher;
  const hasPreSupplied = config.blastRadiusItems !== undefined || config.blastRadiusLoading !== undefined;
  const showBlastRadius = hasFetcher || hasPreSupplied;
  const blastItems = hasPreSupplied ? (config.blastRadiusItems ?? []) : fetchedItems;
  const blastLoading = hasPreSupplied ? config.blastRadiusLoading : fetchLoading;

  const confirmLabel = config.confirmLabel ?? t.common.delete;
  const needsTyping = !!config.requireTypedConfirmation;
  const typingMatches = !needsTyping || typedValue === config.requireTypedConfirmation;

  const handleConfirm = () => {
    setTypedValue('');
    onConfirm();
  };

  const handleClose = () => {
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
          <h3 id="confirm-destructive-title" className="text-sm font-semibold text-foreground/90">
            {config.title}
          </h3>
          <p className="text-sm text-foreground mt-1">{config.message}</p>
        </div>
      </div>

      {/* Detail card */}
      {config.details && config.details.length > 0 && (
        <div className="bg-secondary/40 border border-primary/10 rounded-xl p-3 space-y-2">
          {config.details.map((d) => (
            <div key={d.label} className="flex items-center justify-between">
              <span className="text-sm font-mono uppercase text-foreground">{d.label}</span>
              <span className="text-sm text-foreground truncate ml-3 max-w-[200px]">{d.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warning banner */}
      {config.warningMessage && (
        <div className="flex items-start gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-yellow-300/90">{config.warningMessage}</p>
        </div>
      )}

      {/* Blast radius */}
      {showBlastRadius && (
        <BlastRadiusPanel items={blastItems} loading={blastLoading} />
      )}

      {/* Type-to-confirm */}
      {needsTyping && (
        <div className="space-y-1.5">
          <p className="text-xs text-foreground">
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
            className="w-full px-3 py-2 text-sm rounded-lg bg-secondary/50 border border-primary/15 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-red-500/40 transition-colors"
            autoFocus
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={handleClose}
          className="px-4 py-2 text-sm text-foreground hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={handleConfirm}
          disabled={!typingMatches}
          className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ConfirmDestructiveModal({ open, config }: ConfirmDestructiveModalProps) {
  const handleClose = useCallback(() => {
    config?.onCancel();
  }, [config]);

  return (
    <BaseModal
      isOpen={open}
      onClose={handleClose}
      titleId="confirm-destructive-title"
      maxWidthClass="max-w-sm"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      {config && (
        <ModalContent
          config={config}
          onClose={handleClose}
          onConfirm={config.onConfirm}
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
        onConfirm: () => {
          config.onConfirm();
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
