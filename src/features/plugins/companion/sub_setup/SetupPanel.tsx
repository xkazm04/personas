import { useCallback, useEffect, useState } from 'react';
import { Activity, AppWindow, Bot, Brain, Clipboard, Eye, FileText, Puzzle, Sparkles, Terminal, Volume2, Wrench } from 'lucide-react';
import { SettingsScaffold, type SettingsSection } from '@/features/shared/components/layout/settings/SettingsScaffold';
import { SettingRow } from '@/features/shared/components/forms/SettingRow';
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
import { BrowserBridgePanel } from './BrowserBridgePanel';
import { SensorySignalsModal } from './SensorySignalsModal';

/**
 * Companion plugin — Setup tab.
 *
 * Settings are grouped into SectionCards laid out by the shared
 * SettingsScaffold (left quick-nav rail + scroll-spy). Groups: chrome
 * (footer / orb / sound), memory, desktop awareness (sensory sources),
 * self-improve loop (read-only beta flag), project tracking, and the
 * browser-bridge pairing surface.
 */
export default function SetupPanel() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
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
  const handsFreeDecisions = useSystemStore(
    (s) => s.companionHandsFreeDecisions,
  );
  const setHandsFreeDecisions = useSystemStore(
    (s) => s.setCompanionHandsFreeDecisions,
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
        // These switches govern privacy-sensitive desktop watching; if the
        // backend can't enable a source (e.g. an OS permission it couldn't
        // acquire) the toggle bounces back on refreshSensory(). Surface the
        // reason via a toast instead of swallowing it, so the user isn't left
        // wondering whether the switch is broken or silently on.
        toastCatch('companion_set_sensory_source_enabled')(err);
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

  const sections: SettingsSection[] = [
    {
      id: 'chrome',
      label: c.setup_chrome_title,
      subtitle: c.setup_chrome_desc,
      icon: <AppWindow className="w-4 h-4 text-cyan-400" />,
      content: (
        <>
          <SettingRow
            icon={<Bot className="w-4 h-4 text-cyan-400" />}
            label={c.setup_footer_label}
            description={c.setup_footer_desc}
            checked={footerEnabled}
            onChange={() => setFooterEnabled(!footerEnabled)}
          />
          <SettingRow
            icon={<Sparkles className="w-4 h-4 text-cyan-400" />}
            label={c.setup_orb_label}
            description={c.setup_orb_desc}
            checked={orbEnabled}
            onChange={() => setOrbEnabled(!orbEnabled)}
          />
          <SettingRow
            icon={<Volume2 className="w-4 h-4 text-cyan-400" />}
            label={c.setup_sound_label}
            description={c.setup_sound_desc}
            checked={soundEnabled}
            onChange={() => setSoundEnabled(!soundEnabled)}
          />
        </>
      ),
    },
    {
      id: 'memory',
      label: c.setup_memory_title,
      subtitle: c.setup_memory_desc,
      icon: <Brain className="w-4 h-4 text-cyan-400" />,
      content: (
        <>
          <SettingRow
            icon={<Brain className="w-4 h-4 text-cyan-400" />}
            label={c.setup_recall_synthesis_label}
            description={c.setup_recall_synthesis_desc}
            checked={recallSynthesisEnabled}
            onChange={() => setRecallSynthesisEnabled(!recallSynthesisEnabled)}
          />
          <SettingRow
            icon={<Eye className="w-4 h-4 text-cyan-400" />}
            label={c.setup_hands_free_decisions_label}
            description={c.setup_hands_free_decisions_desc}
            checked={handsFreeDecisions}
            onChange={() => setHandsFreeDecisions(!handsFreeDecisions)}
          />
        </>
      ),
    },
    {
      id: 'desktop',
      label: c.setup_desktop_title,
      subtitle: c.setup_desktop_desc,
      icon: <Eye className="w-4 h-4 text-cyan-400" />,
      content: sensoryLoadError ? (
        <div className="px-1 py-2 typo-caption text-rose-400">
          {c.setup_desktop_load_failed}
        </div>
      ) : (
        <>
          <SettingRow
            icon={<Clipboard className="w-4 h-4 text-cyan-400" />}
            label={c.setup_desktop_clipboard_label}
            description={c.setup_desktop_clipboard_desc}
            countLabel={signalsCountLabel(t, sensory?.clipboardSignalsInWindow)}
            statusDot={sensoryDot(sensory?.clipboardEnabled, sensory?.clipboardSignalsInWindow)}
            checked={sensory?.clipboardEnabled ?? false}
            disabled={sensory === null}
            onChange={() => void toggleSensory('clipboard', !(sensory?.clipboardEnabled ?? false))}
          />
          <SettingRow
            icon={<FileText className="w-4 h-4 text-cyan-400" />}
            label={c.setup_desktop_file_changes_label}
            description={c.setup_desktop_file_changes_desc}
            countLabel={signalsCountLabel(t, sensory?.fileChangesSignalsInWindow)}
            statusDot={sensoryDot(sensory?.fileChangesEnabled, sensory?.fileChangesSignalsInWindow)}
            checked={sensory?.fileChangesEnabled ?? false}
            disabled={sensory === null}
            onChange={() => void toggleSensory('file_watcher', !(sensory?.fileChangesEnabled ?? false))}
          />
          <SettingRow
            icon={<AppWindow className="w-4 h-4 text-cyan-400" />}
            label={c.setup_desktop_app_focus_label}
            description={c.setup_desktop_app_focus_desc}
            countLabel={signalsCountLabel(t, sensory?.appFocusSignalsInWindow)}
            statusDot={sensoryDot(sensory?.appFocusEnabled, sensory?.appFocusSignalsInWindow)}
            checked={sensory?.appFocusEnabled ?? false}
            disabled={sensory === null}
            onChange={() => void toggleSensory('app_focus', !(sensory?.appFocusEnabled ?? false))}
          />
          <SettingRow
            icon={<Terminal className="w-4 h-4 text-cyan-400" />}
            label={c.setup_desktop_cli_session_label}
            description={c.setup_desktop_cli_session_desc}
            statusDot={sensoryDot(sensory?.cliSessionEnabled, undefined)}
            checked={sensory?.cliSessionEnabled ?? false}
            disabled={sensory === null}
            onChange={() => void toggleSensory('cli_session', !(sensory?.cliSessionEnabled ?? false))}
          />
          <div className="px-1 pt-3">
            <button
              onClick={() => setSignalsModalOpen(true)}
              className="inline-flex items-center gap-2 typo-caption font-medium text-primary hover:underline focus-ring rounded"
            >
              <Eye className="w-3.5 h-3.5" />
              {c.setup_desktop_view_signals}
            </button>
          </div>
        </>
      ),
    },
    {
      id: 'beta',
      label: c.setup_beta_title,
      subtitle: c.setup_beta_desc,
      icon: <Wrench className="w-4 h-4 text-cyan-400" />,
      content: (
        <div className="flex items-start gap-3 px-1 py-2">
          <Wrench className={`w-4 h-4 mt-0.5 ${selfImprove ? 'text-emerald-400' : 'text-foreground'}`} />
          <div className="flex-1 min-w-0">
            <div className="typo-title">{c.setup_self_improve_label}</div>
            <div className="typo-caption mt-1">
              {selfImprove === null
                ? c.loading
                : selfImprove
                  ? c.setup_self_improve_on
                  : c.setup_self_improve_off}
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
                ? c.setup_self_improve_active
                : c.setup_self_improve_inactive}
          </span>
        </div>
      ),
    },
    {
      id: 'tracking',
      label: c.tracking_title,
      subtitle: c.tracking_subtitle,
      icon: <Activity className="w-4 h-4 text-cyan-400" />,
      content: (
        <SettingRow
          icon={<Activity className={`w-4 h-4 ${trackingEnabled ? 'text-emerald-400' : 'text-foreground'}`} />}
          label={c.tracking_master_label}
          description={
            trackingEnabled === null
              ? c.loading
              : trackingEnabled
                ? c.tracking_master_on
                : c.tracking_master_off
          }
          checked={trackingEnabled === true}
          disabled={trackingBusy || trackingEnabled === null}
          onChange={() => void onToggleTracking(!(trackingEnabled === true))}
        />
      ),
    },
    {
      id: 'browser',
      label: c.browser_bridge_title,
      icon: <Puzzle className="w-4 h-4 text-cyan-400" />,
      card: false,
      content: <BrowserBridgePanel />,
    },
  ];

  return (
    <>
      <SettingsScaffold sections={sections} navAriaLabel={c.page_title} />
      <SensorySignalsModal
        open={signalsModalOpen}
        onClose={() => {
          setSignalsModalOpen(false);
          void refreshSensory();
        }}
      />
    </>
  );
}

/**
 * Map a sensory source's enabled flag + rolling-window count to a status
 * dot: `active` (enabled and capturing), `idle` (enabled but quiet), or
 * null (disabled — no dot). Sources without a count (e.g. CLI session) pass
 * `undefined` and read as `idle` while enabled.
 */
function sensoryDot(
  enabled: boolean | undefined,
  count: number | undefined,
): 'active' | 'idle' | null {
  if (!enabled) return null;
  return (count ?? 0) > 0 ? 'active' : 'idle';
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
