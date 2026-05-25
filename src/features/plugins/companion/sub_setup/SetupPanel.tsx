import { useCallback, useEffect, useState } from 'react';
import { Activity, AppWindow, Bot, Brain, Clipboard, Eye, FileText, Sparkles, Terminal, Volume2, Wrench } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
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
import {
  projectTrackingIsMasterEnabled,
  projectTrackingSetMasterEnabled,
  projectTrackingRunNow,
} from '@/api/companion/projectTracking';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { SensorySignalsModal } from './SensorySignalsModal';

/**
 * Companion plugin — Setup tab.
 *
 * Three settings:
 *   1. Footer icon — show/hide the bot button in DesktopFooter
 *   2. Sound chime — play subtle Web Audio chime when a reply finishes
 *   3. Self-improve loop — read-only display of the backend beta flag
 *      (toggle would require a build flip; surfacing it here lets the user
 *      know whether the feature is currently active without them having
 *      to dig through dev logs).
 */
export default function SetupPanel() {
  const { t } = useTranslation();
  const footerEnabled = useSystemStore((s) => s.companionFooterEnabled);
  const setFooterEnabled = useSystemStore((s) => s.setCompanionFooterEnabled);
  const soundEnabled = useSystemStore((s) => s.companionSoundEnabled);
  const setSoundEnabled = useSystemStore((s) => s.setCompanionSoundEnabled);
  const orbEnabled = useSystemStore((s) => s.companionOrbEnabled);
  const setOrbEnabled = useSystemStore((s) => s.setCompanionOrbEnabled);
  const recallSynthesisEnabled = useSystemStore(
    (s) => s.companionRecallSynthesisEnabled,
  );
  const setRecallSynthesisEnabled = useSystemStore(
    (s) => s.setCompanionRecallSynthesisEnabled,
  );

  const [trackingEnabled, setTrackingEnabled] = useState<boolean | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    projectTrackingIsMasterEnabled()
      .then((v) => {
        if (!cancelled) setTrackingEnabled(v);
      })
      .catch(silentCatch('project_tracking_is_master_enabled'));
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggleTracking = useCallback(
    async (next: boolean) => {
      setTrackingBusy(true);
      try {
        await projectTrackingSetMasterEnabled(next);
        setTrackingEnabled(next);
        if (next) {
          // First-run backfill: fire one tick out-of-cadence so the
          // user sees a pulse immediately instead of waiting an hour.
          projectTrackingRunNow().catch(silentCatch('project_tracking_run_now'));
        }
      } catch (err) {
        toastCatch('project_tracking_set_master_enabled')(err);
      } finally {
        setTrackingBusy(false);
      }
    },
    [],
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

  // Desktop-awareness toggles read server-side state (the per-source
  // capture gates live in the Rust ambient_context fusion, not in
  // localStorage — the backend is the source of truth so daemon-mode and
  // window-mode share the same view). Refetch on mount + after every
  // toggle so the captured-signals count badge stays current.
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

  // "What did Athena see?" modal — lists the captured-signal rolling
  // window with per-event delete. Refreshes the count badges via
  // refreshSensory after close so a delete immediately reflects in
  // the Setup card.
  const [signalsModalOpen, setSignalsModalOpen] = useState(false);

  return (
    <div className="space-y-4 max-w-2xl">
      <SectionCard
        title={t.plugins.companion.setup_chrome_title}
        subtitle={t.plugins.companion.setup_chrome_desc}
        titleClassName="text-primary"
      >
        <ToggleRow
          icon={<Bot className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_footer_label}
          description={t.plugins.companion.setup_footer_desc}
          checked={footerEnabled}
          onChange={() => setFooterEnabled(!footerEnabled)}
        />
        <ToggleRow
          icon={<Sparkles className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_orb_label}
          description={t.plugins.companion.setup_orb_desc}
          checked={orbEnabled}
          onChange={() => setOrbEnabled(!orbEnabled)}
        />
        <ToggleRow
          icon={<Volume2 className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_sound_label}
          description={t.plugins.companion.setup_sound_desc}
          checked={soundEnabled}
          onChange={() => setSoundEnabled(!soundEnabled)}
        />
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.setup_memory_title}
        subtitle={t.plugins.companion.setup_memory_desc}
        titleClassName="text-primary"
      >
        <ToggleRow
          icon={<Brain className="w-4 h-4 text-cyan-400" />}
          label={t.plugins.companion.setup_recall_synthesis_label}
          description={t.plugins.companion.setup_recall_synthesis_desc}
          checked={recallSynthesisEnabled}
          onChange={() => setRecallSynthesisEnabled(!recallSynthesisEnabled)}
        />
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.setup_desktop_title}
        subtitle={t.plugins.companion.setup_desktop_desc}
        titleClassName="text-primary"
      >
        {sensoryLoadError ? (
          <div className="px-1 py-2 typo-caption text-rose-400">
            {t.plugins.companion.setup_desktop_load_failed}
          </div>
        ) : (
          <>
            <ToggleRow
              icon={<Clipboard className="w-4 h-4 text-cyan-400" />}
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
            <ToggleRow
              icon={<FileText className="w-4 h-4 text-cyan-400" />}
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
            <ToggleRow
              icon={<AppWindow className="w-4 h-4 text-cyan-400" />}
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
            <ToggleRow
              icon={<Terminal className="w-4 h-4 text-cyan-400" />}
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
            <div className="px-1 pt-3">
              <button
                onClick={() => setSignalsModalOpen(true)}
                className="inline-flex items-center gap-2 typo-caption font-medium text-primary hover:underline focus-ring rounded"
              >
                <Eye className="w-3.5 h-3.5" />
                {t.plugins.companion.setup_desktop_view_signals}
              </button>
            </div>
          </>
        )}
      </SectionCard>

      <SensorySignalsModal
        open={signalsModalOpen}
        onClose={() => {
          setSignalsModalOpen(false);
          void refreshSensory();
        }}
      />

      <SectionCard
        title={t.plugins.companion.setup_beta_title}
        subtitle={t.plugins.companion.setup_beta_desc}
        titleClassName="text-primary"
      >
        <div className="flex items-start gap-3 px-1 py-2">
          <Wrench
            className={`w-4 h-4 mt-0.5 ${selfImprove ? 'text-emerald-400' : 'text-foreground'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.setup_self_improve_label}
            </div>
            <div className="typo-caption text-foreground/60 mt-1.5">
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
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-foreground/10 bg-foreground/5 text-foreground'
            }`}
          >
            {selfImprove === null
              ? '…'
              : selfImprove
                ? t.plugins.companion.setup_self_improve_active
                : t.plugins.companion.setup_self_improve_inactive}
          </span>
        </div>
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.tracking_title}
        subtitle={t.plugins.companion.tracking_subtitle}
        titleClassName="text-primary"
      >
        <div className="flex items-start gap-3 px-1 py-2">
          <Activity
            className={`w-4 h-4 mt-0.5 ${trackingEnabled ? 'text-emerald-400' : 'text-foreground'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.tracking_master_label}
            </div>
            <div className="typo-caption text-foreground/60 mt-1.5">
              {trackingEnabled === null
                ? t.plugins.companion.loading
                : trackingEnabled
                  ? t.plugins.companion.tracking_master_on
                  : t.plugins.companion.tracking_master_off}
            </div>
          </div>
          <AccessibleToggle
            checked={trackingEnabled === true}
            onChange={() => void onToggleTracking(!(trackingEnabled === true))}
            disabled={trackingBusy || trackingEnabled === null}
            label={t.plugins.companion.tracking_master_label}
          />
        </div>
      </SectionCard>
    </div>
  );
}

function ToggleRow({
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
  /** Optional badge text below the description (e.g. "3 signals in the rolling window"). */
  countLabel?: string | null;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-1 py-2 border-b border-foreground/5 last:border-b-0">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="typo-body font-medium">{label}</div>
        <div className="typo-caption text-foreground/60 mt-1.5">
          {description}
        </div>
        {countLabel ? (
          <div className="typo-caption text-foreground/50 mt-1">
            {countLabel}
          </div>
        ) : null}
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

/**
 * Render the rolling-window count for a sensory source. Returns null when
 * the source has zero signals in the window (no badge needed) or when
 * the count is undefined (state hasn't loaded yet).
 */
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
