import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppWindow, Clipboard, FileText, Trash2, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import {
  companionDeleteSensorySignal,
  companionListSensorySignals,
  type SensorySignalEntry,
  type SensorySource,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

/**
 * "What did Athena see?" view. Lists ambient signals captured by the
 * companion's desktop-awareness watchers (clipboard / file changes /
 * app focus) in the rolling window, newest-first, with per-source
 * filter chips and per-event delete buttons.
 *
 * The view is the privacy promise made tangible — flipping on a
 * desktop-awareness toggle is only honest if the user can also SEE what
 * was captured and DELETE individual entries. Phase 2 v3 of the Athena
 * desktop-aware roadmap; pairs with the v1 capture-time gates.
 *
 * Out of scope for v3:
 *   - SQL persistence beyond the 10-minute rolling window
 *   - Surfacing redaction state per row (today every captured signal is
 *     already redacted at capture, so there's nothing un-redacted to flag)
 */
export function SensorySignalsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<SensorySource | 'all'>('all');
  const [signals, setSignals] = useState<SensorySignalEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await companionListSensorySignals(
        filter === 'all' ? undefined : filter,
        100,
      );
      setSignals(list);
      setLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      silentCatch('companion_list_sensory_signals')(err);
    }
  }, [filter]);

  // Refresh on open + whenever the filter changes. Closing the modal
  // releases the state on next open so we don't render stale entries.
  useEffect(() => {
    if (!open) {
      setSignals(null);
      return;
    }
    void refresh();
  }, [open, refresh]);

  const onDelete = useCallback(
    async (id: string) => {
      try {
        await companionDeleteSensorySignal(id);
      } catch (err) {
        silentCatch('companion_delete_sensory_signal')(err);
      }
      void refresh();
    },
    [refresh],
  );

  const filterChips: Array<{ id: SensorySource | 'all'; label: string }> = useMemo(
    () => [
      { id: 'all', label: t.plugins.companion.sensory_filter_all },
      { id: 'clipboard', label: t.plugins.companion.setup_desktop_clipboard_label },
      {
        id: 'file_watcher',
        label: t.plugins.companion.setup_desktop_file_changes_label,
      },
      {
        id: 'app_focus',
        label: t.plugins.companion.setup_desktop_app_focus_label,
      },
    ],
    [t],
  );

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="sensory-signals-modal-title"
      size="lg"
      portal
    >
      <div
        role="dialog"
        aria-labelledby="sensory-signals-modal-title"
        className="flex flex-col max-h-[80vh] rounded-modal bg-secondary border border-foreground/10 shadow-elevation-4 overflow-hidden"
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-foreground/10 shrink-0">
          <div>
            <h2
              id="sensory-signals-modal-title"
              className="typo-heading font-semibold"
            >
              {t.plugins.companion.sensory_signals_title}
            </h2>
            <p className="typo-caption text-foreground/60 mt-0.5">
              {t.plugins.companion.sensory_signals_subtitle}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
            aria-label={t.common.close}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex flex-wrap gap-1.5 px-5 py-2.5 border-b border-foreground/10 shrink-0">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              onClick={() => setFilter(chip.id)}
              className={`px-2.5 py-1 rounded-interactive typo-caption font-medium transition-colors focus-ring ${
                filter === chip.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/10'
              }`}
              aria-pressed={filter === chip.id}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loadError ? (
            <div className="px-3 py-6 typo-body text-rose-400">
              {t.plugins.companion.setup_desktop_load_failed}
            </div>
          ) : signals === null ? (
            <div className="flex items-center gap-3 px-3 py-6 typo-body text-foreground/60">
              <LoadingSpinner size="sm" />
              <span>{t.plugins.companion.loading}</span>
            </div>
          ) : signals.length === 0 ? (
            <div className="px-3 py-10 text-center">
              <div className="typo-body text-foreground/60">
                {t.plugins.companion.sensory_signals_empty}
              </div>
              <div className="typo-caption text-foreground/45 mt-1">
                {t.plugins.companion.sensory_signals_empty_hint}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-foreground/5">
              {signals.map((s) => (
                <SignalRow key={s.id} signal={s} onDelete={() => onDelete(s.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </BaseModal>
  );
}

function SignalRow({
  signal,
  onDelete,
}: {
  signal: SensorySignalEntry;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const Icon =
    signal.source === 'clipboard'
      ? Clipboard
      : signal.source === 'file_watcher'
        ? FileText
        : AppWindow;
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <Icon className="w-4 h-4 mt-0.5 text-cyan-400 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="typo-body text-foreground break-words">
          {signal.summary}
        </div>
        <div className="typo-caption text-foreground/50 mt-0.5">
          {formatAge(t, signal.ageSecs)}
        </div>
        {signal.redactedContent ? (
          <div className="mt-2 px-2.5 py-1.5 rounded-interactive bg-foreground/[0.04] border border-foreground/5">
            <div className="typo-caption font-medium text-foreground/55 mb-1">
              {t.plugins.companion.sensory_signals_redacted_label}
            </div>
            <div className="typo-caption font-mono text-foreground/75 break-all whitespace-pre-wrap">
              {signal.redactedContent}
            </div>
          </div>
        ) : null}
      </div>
      <button
        onClick={onDelete}
        className="shrink-0 p-1.5 rounded-interactive text-foreground/50 hover:text-rose-400 hover:bg-rose-500/10 transition-colors focus-ring"
        aria-label={t.plugins.companion.sensory_signals_delete_aria}
        title={t.plugins.companion.sensory_signals_delete_aria}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </li>
  );
}

function formatAge(
  t: ReturnType<typeof useTranslation>['t'],
  ageSecs: number,
): string {
  if (ageSecs < 60) {
    return t.plugins.companion.sensory_age_seconds.replace('{n}', String(ageSecs));
  }
  if (ageSecs < 3600) {
    return t.plugins.companion.sensory_age_minutes.replace(
      '{n}',
      String(Math.floor(ageSecs / 60)),
    );
  }
  return t.plugins.companion.sensory_age_hours.replace(
    '{n}',
    String(Math.floor(ageSecs / 3600)),
  );
}
