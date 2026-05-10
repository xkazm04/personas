import { useCallback, useEffect, useState } from 'react';
import {
  AppWindow,
  Bot,
  Brain,
  Clipboard,
  Eye,
  FileText,
  Terminal,
  Volume2,
  Wrench,
} from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  companionBetaFlags,
  companionGetSensoryState,
  companionSetSensorySourceEnabled,
  type SensorySource,
  type SensorySourceStateView,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { SensorySignalsModal } from './SensorySignalsModal';

/**
 * Variant A — "Compact list shelf".
 *
 * Single card containing the entire settings surface, partitioned by
 * thin section labels (uppercase typo-label) instead of separate
 * SectionCards. Toggles are right-aligned in a single column with
 * tight rhythm — designed to read as one continuous preferences
 * sheet, not four floating cards.
 *
 * Direction: dense, scannable, low-chrome. Trades visual hierarchy
 * for quicker top-to-bottom scanning. Inspired by the macOS System
 * Settings sub-pane density.
 */
export default function SetupPanelVariantA() {
  const { t } = useTranslation();

  // State plumbing mirrors the baseline 1:1.
  const footerEnabled = useSystemStore((s) => s.companionFooterEnabled);
  const setFooterEnabled = useSystemStore((s) => s.setCompanionFooterEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const setSoundEnabled = useSystemStore((s) => s.setCompanionSoundEnabled);
  const recallSynthesisEnabled = useSystemStore(
    (s) => s.companionRecallSynthesisEnabled,
  );
  const setRecallSynthesisEnabled = useSystemStore(
    (s) => s.setCompanionRecallSynthesisEnabled,
  );

  const [selfImprove, setSelfImprove] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    companionBetaFlags()
      .then((flags) => {
        if (!cancelled) setSelfImprove(flags.selfImproveEnabled);
      })
      .catch(silentCatch('companion_beta_flags'));
    return () => {
      cancelled = true;
    };
  }, []);

  const [sensory, setSensory] = useState<SensorySourceStateView | null>(null);
  const [sensoryLoadError, setSensoryLoadError] = useState<string | null>(null);
  const refreshSensory = useCallback(async () => {
    try {
      const state = await companionGetSensoryState();
      setSensory(state);
      setSensoryLoadError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSensoryLoadError(msg);
      silentCatch('companion_get_sensory_state')(err);
    }
  }, []);
  useEffect(() => {
    void refreshSensory();
  }, [refreshSensory]);
  const toggleSensory = useCallback(
    async (source: SensorySource, next: boolean) => {
      try {
        await companionSetSensorySourceEnabled(source, next);
      } catch (err) {
        silentCatch('companion_set_sensory_source_enabled')(err);
      }
      void refreshSensory();
    },
    [refreshSensory],
  );

  const [signalsModalOpen, setSignalsModalOpen] = useState(false);

  return (
    <div className="max-w-2xl">
      <div className="rounded-card border border-foreground/10 bg-card-bg shadow-elevation-1 overflow-hidden">
        <SectionLabel>{t.plugins.companion.setup_chrome_title}</SectionLabel>
        <DenseRow
          icon={<Bot className="w-3.5 h-3.5 text-cyan-400" />}
          label={t.plugins.companion.setup_footer_label}
          description={t.plugins.companion.setup_footer_desc}
          checked={footerEnabled}
          onChange={() => setFooterEnabled(!footerEnabled)}
        />
        <DenseRow
          icon={<Volume2 className="w-3.5 h-3.5 text-cyan-400" />}
          label={t.plugins.companion.setup_sound_label}
          description={t.plugins.companion.setup_sound_desc}
          checked={soundEnabled}
          onChange={() => setSoundEnabled(!soundEnabled)}
        />

        <SectionLabel>{t.plugins.companion.setup_memory_title}</SectionLabel>
        <DenseRow
          icon={<Brain className="w-3.5 h-3.5 text-cyan-400" />}
          label={t.plugins.companion.setup_recall_synthesis_label}
          description={t.plugins.companion.setup_recall_synthesis_desc}
          checked={recallSynthesisEnabled}
          onChange={() => setRecallSynthesisEnabled(!recallSynthesisEnabled)}
        />

        <SectionLabel>{t.plugins.companion.setup_desktop_title}</SectionLabel>
        {sensoryLoadError ? (
          <div className="px-4 py-3 typo-caption text-status-error">
            {t.plugins.companion.setup_desktop_load_failed}
          </div>
        ) : (
          <>
            <DenseRow
              icon={<Clipboard className="w-3.5 h-3.5 text-cyan-400" />}
              label={t.plugins.companion.setup_desktop_clipboard_label}
              description={t.plugins.companion.setup_desktop_clipboard_desc}
              countLabel={signalsCountLabel(t, sensory?.clipboardSignalsInWindow)}
              checked={sensory?.clipboardEnabled ?? false}
              disabled={sensory === null}
              onChange={() =>
                void toggleSensory(
                  'clipboard',
                  !(sensory?.clipboardEnabled ?? false),
                )
              }
            />
            <DenseRow
              icon={<FileText className="w-3.5 h-3.5 text-cyan-400" />}
              label={t.plugins.companion.setup_desktop_file_changes_label}
              description={t.plugins.companion.setup_desktop_file_changes_desc}
              countLabel={signalsCountLabel(t, sensory?.fileChangesSignalsInWindow)}
              checked={sensory?.fileChangesEnabled ?? false}
              disabled={sensory === null}
              onChange={() =>
                void toggleSensory(
                  'file_watcher',
                  !(sensory?.fileChangesEnabled ?? false),
                )
              }
            />
            <DenseRow
              icon={<AppWindow className="w-3.5 h-3.5 text-cyan-400" />}
              label={t.plugins.companion.setup_desktop_app_focus_label}
              description={t.plugins.companion.setup_desktop_app_focus_desc}
              countLabel={signalsCountLabel(t, sensory?.appFocusSignalsInWindow)}
              checked={sensory?.appFocusEnabled ?? false}
              disabled={sensory === null}
              onChange={() =>
                void toggleSensory(
                  'app_focus',
                  !(sensory?.appFocusEnabled ?? false),
                )
              }
            />
            <DenseRow
              icon={<Terminal className="w-3.5 h-3.5 text-cyan-400" />}
              label={t.plugins.companion.setup_desktop_cli_session_label}
              description={t.plugins.companion.setup_desktop_cli_session_desc}
              checked={sensory?.cliSessionEnabled ?? false}
              disabled={sensory === null}
              onChange={() =>
                void toggleSensory(
                  'cli_session',
                  !(sensory?.cliSessionEnabled ?? false),
                )
              }
            />
            <div className="border-t border-foreground/5 px-4 py-2.5 flex justify-end">
              <button
                onClick={() => setSignalsModalOpen(true)}
                className="inline-flex items-center gap-1.5 typo-caption font-medium text-primary hover:underline focus-ring rounded"
              >
                <Eye className="w-3.5 h-3.5" />
                {t.plugins.companion.setup_desktop_view_signals}
              </button>
            </div>
          </>
        )}

        <SectionLabel>{t.plugins.companion.setup_beta_title}</SectionLabel>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <Wrench
            className={`w-3.5 h-3.5 shrink-0 ${selfImprove ? 'text-status-success' : 'text-foreground/40'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body">{t.plugins.companion.setup_self_improve_label}</div>
            <div className="typo-caption text-foreground/55 mt-0.5">
              {selfImprove === null
                ? t.plugins.companion.loading
                : selfImprove
                  ? t.plugins.companion.setup_self_improve_on
                  : t.plugins.companion.setup_self_improve_off}
            </div>
          </div>
          <span
            className={`shrink-0 typo-caption font-medium px-2 py-0.5 rounded-full border ${
              selfImprove
                ? 'border-status-success/30 bg-status-success/10 text-status-success'
                : 'border-foreground/10 bg-foreground/5 text-foreground/60'
            }`}
          >
            {selfImprove === null
              ? '…'
              : selfImprove
                ? t.plugins.companion.setup_self_improve_active
                : t.plugins.companion.setup_self_improve_inactive}
          </span>
        </div>
      </div>

      <SensorySignalsModal
        open={signalsModalOpen}
        onClose={() => {
          setSignalsModalOpen(false);
          void refreshSensory();
        }}
      />
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 pt-3 pb-1 typo-label text-foreground/55 border-t border-foreground/5 first:border-t-0 first:pt-3 bg-foreground/[0.015]">
      {children}
    </div>
  );
}

function DenseRow({
  icon,
  label,
  description,
  countLabel,
  checked,
  disabled,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  countLabel?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-t border-foreground/5">
      <div className="shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="typo-body">{label}</div>
        <div className="typo-caption text-foreground/55 mt-0.5 leading-snug">
          {description}
          {countLabel ? (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/65 typo-caption">
              {countLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0">
        <AccessibleToggle
          checked={checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function signalsCountLabel(
  t: ReturnType<typeof useTranslation>['t'],
  count: number | undefined,
): string | null {
  if (count === undefined || count === 0) return null;
  const tmpl =
    count === 1
      ? t.plugins.companion.setup_desktop_signals_count_one
      : t.plugins.companion.setup_desktop_signals_count_other;
  return tmpl.replace('{count}', String(count));
}
