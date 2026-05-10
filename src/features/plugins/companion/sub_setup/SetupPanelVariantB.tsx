import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Bot,
  Brain,
  Clipboard,
  Eye,
  FileText,
  FlaskConical,
  Layout,
  Sparkles,
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
 * Variant B — "Sectioned blueprint".
 *
 * Two-pane layout: a left rail of section titles (Chrome / Memory /
 * Desktop awareness / Beta) with status pips, and a right pane that
 * renders the active section's controls. Inspired by macOS System
 * Settings and the agent editor's tabbed shell — gives each settings
 * group its own focused stage instead of stacking everything in one
 * scroll.
 *
 * Direction: navigable, focused, lets each section breathe. Trades
 * "see everything at once" for "concentrate on one thing".
 */
type SectionId = 'chrome' | 'memory' | 'desktop' | 'beta';

export default function SetupPanelVariantB() {
  const { t } = useTranslation();

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
  const [section, setSection] = useState<SectionId>('chrome');

  // Quick on-count per section so the rail can show a small pip.
  const counts = useMemo(
    () => ({
      chrome: (footerEnabled ? 1 : 0) + (soundEnabled ? 1 : 0),
      chromeTotal: 2,
      memory: recallSynthesisEnabled ? 1 : 0,
      memoryTotal: 1,
      desktop:
        (sensory?.clipboardEnabled ? 1 : 0) +
        (sensory?.fileChangesEnabled ? 1 : 0) +
        (sensory?.appFocusEnabled ? 1 : 0) +
        (sensory?.cliSessionEnabled ? 1 : 0),
      desktopTotal: 4,
      beta: selfImprove === true ? 1 : 0,
      betaTotal: 1,
    }),
    [
      footerEnabled,
      soundEnabled,
      recallSynthesisEnabled,
      sensory,
      selfImprove,
    ],
  );

  const sections: {
    id: SectionId;
    icon: typeof Layout;
    title: string;
    subtitle: string;
    on: number;
    of: number;
  }[] = [
    {
      id: 'chrome',
      icon: Layout,
      title: t.plugins.companion.setup_chrome_title,
      subtitle: t.plugins.companion.setup_chrome_desc,
      on: counts.chrome,
      of: counts.chromeTotal,
    },
    {
      id: 'memory',
      icon: Brain,
      title: t.plugins.companion.setup_memory_title,
      subtitle: t.plugins.companion.setup_memory_desc,
      on: counts.memory,
      of: counts.memoryTotal,
    },
    {
      id: 'desktop',
      icon: Sparkles,
      title: t.plugins.companion.setup_desktop_title,
      subtitle: t.plugins.companion.setup_desktop_desc,
      on: counts.desktop,
      of: counts.desktopTotal,
    },
    {
      id: 'beta',
      icon: FlaskConical,
      title: t.plugins.companion.setup_beta_title,
      subtitle: t.plugins.companion.setup_beta_desc,
      on: counts.beta,
      of: counts.betaTotal,
    },
  ];

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 max-w-3xl">
      {/* Left rail */}
      <nav className="space-y-1" aria-label={t.plugins.companion.setup_chrome_title}>
        {sections.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={`w-full text-left rounded-card border px-3 py-2.5 transition-colors focus-ring ${
                active
                  ? 'border-cyan-500/40 bg-cyan-500/10'
                  : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    active ? 'text-cyan-300' : 'text-foreground/65'
                  }`}
                />
                <span
                  className={`typo-body font-medium truncate ${
                    active ? 'text-cyan-200' : 'text-foreground'
                  }`}
                >
                  {s.title}
                </span>
                <span
                  className={`ml-auto shrink-0 typo-caption tabular-nums ${
                    active ? 'text-cyan-300/80' : 'text-foreground/45'
                  }`}
                >
                  {s.on}/{s.of}
                </span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Right pane */}
      <div className="rounded-card border border-foreground/10 bg-card-bg shadow-elevation-1 p-5 min-h-[260px]">
        {section === 'chrome' && (
          <SectionStage
            title={t.plugins.companion.setup_chrome_title}
            subtitle={t.plugins.companion.setup_chrome_desc}
          >
            <ToggleRow
              icon={<Bot className="w-4 h-4 text-cyan-400" />}
              label={t.plugins.companion.setup_footer_label}
              description={t.plugins.companion.setup_footer_desc}
              checked={footerEnabled}
              onChange={() => setFooterEnabled(!footerEnabled)}
            />
            <ToggleRow
              icon={<Volume2 className="w-4 h-4 text-cyan-400" />}
              label={t.plugins.companion.setup_sound_label}
              description={t.plugins.companion.setup_sound_desc}
              checked={soundEnabled}
              onChange={() => setSoundEnabled(!soundEnabled)}
            />
          </SectionStage>
        )}

        {section === 'memory' && (
          <SectionStage
            title={t.plugins.companion.setup_memory_title}
            subtitle={t.plugins.companion.setup_memory_desc}
          >
            <ToggleRow
              icon={<Brain className="w-4 h-4 text-cyan-400" />}
              label={t.plugins.companion.setup_recall_synthesis_label}
              description={t.plugins.companion.setup_recall_synthesis_desc}
              checked={recallSynthesisEnabled}
              onChange={() => setRecallSynthesisEnabled(!recallSynthesisEnabled)}
            />
          </SectionStage>
        )}

        {section === 'desktop' && (
          <SectionStage
            title={t.plugins.companion.setup_desktop_title}
            subtitle={t.plugins.companion.setup_desktop_desc}
          >
            {sensoryLoadError ? (
              <div className="px-1 py-2 typo-caption text-status-error">
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
                <div className="pt-2">
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
          </SectionStage>
        )}

        {section === 'beta' && (
          <SectionStage
            title={t.plugins.companion.setup_beta_title}
            subtitle={t.plugins.companion.setup_beta_desc}
          >
            <div className="flex items-start gap-3 px-1 py-2">
              <Wrench
                className={`w-4 h-4 mt-0.5 ${selfImprove ? 'text-status-success' : 'text-foreground/40'}`}
              />
              <div className="flex-1 min-w-0">
                <div className="typo-body font-medium">
                  {t.plugins.companion.setup_self_improve_label}
                </div>
                <div className="typo-caption text-foreground/60 mt-0.5">
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
          </SectionStage>
        )}
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

function SectionStage({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="border-b border-foreground/5 pb-3 mb-3">
        <h3 className="typo-section-title">{title}</h3>
        <p className="typo-caption text-foreground/60 mt-1">{subtitle}</p>
      </div>
      <div className="space-y-1">{children}</div>
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
        <div className="typo-caption text-foreground/60 mt-0.5">{description}</div>
        {countLabel ? (
          <div className="typo-caption text-foreground/45 mt-1">{countLabel}</div>
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
