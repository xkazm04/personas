import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, GitBranch, FileText, Save, Zap, AlertTriangle, Radio } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  projectTrackingListSubscriptions,
  projectTrackingSetSubscription,
  projectTrackingIsMasterEnabled,
  projectTrackingGetObsidianVault,
  projectTrackingRunNow,
} from '@/api/companion/projectTracking';

const STALE_PULSE_MS = 4 * 60 * 60 * 1000;

function isStalePulse(lastPulseAt: string | null, enabled: boolean): boolean {
  if (!enabled) return false;
  if (!lastPulseAt) return true;
  const t = new Date(lastPulseAt).getTime();
  if (isNaN(t)) return true;
  return Date.now() - t > STALE_PULSE_MS;
}
import type { SubscriptionWithProject } from '@/lib/bindings/SubscriptionWithProject';

type Draft = {
  watchGit: boolean;
  watchActiveRuns: boolean;
  watchObsidian: boolean;
  obsidianVaultPath: string | null;
  enabled: boolean;
  dirty: boolean;
};

function rowToDraft(row: SubscriptionWithProject): Draft {
  return {
    watchGit: row.watchGit,
    watchActiveRuns: row.watchActiveRuns,
    watchObsidian: row.watchObsidian,
    obsidianVaultPath: row.obsidianVaultPath,
    enabled: row.enabled,
    dirty: false,
  };
}

export function ProjectTrackingTab() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [rows, setRows] = useState<SubscriptionWithProject[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [masterEnabled, setMasterEnabled] = useState<boolean>(false);
  const [obsidianVault, setObsidianVault] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, master, vault] = await Promise.all([
        projectTrackingListSubscriptions(),
        projectTrackingIsMasterEnabled(),
        projectTrackingGetObsidianVault(),
      ]);
      setRows(list);
      setDrafts(Object.fromEntries(list.map((r) => [r.projectId, rowToDraft(r)])));
      setMasterEnabled(master);
      setObsidianVault(vault);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(toastCatch('project-tracking-tab:load'));
  }, [refresh]);

  const updateDraft = useCallback(
    (projectId: string, patch: Partial<Omit<Draft, 'dirty'>>) => {
      setDrafts((prev) => {
        const current = prev[projectId];
        if (!current) return prev;
        const next = { ...current, ...patch, dirty: true };
        // When the user enables watch_obsidian and no vault path is set
        // yet, auto-fill from the detected Obsidian credential.
        if (
          patch.watchObsidian === true &&
          !current.watchObsidian &&
          !next.obsidianVaultPath &&
          obsidianVault
        ) {
          next.obsidianVaultPath = obsidianVault;
        }
        return { ...prev, [projectId]: next };
      });
    },
    [obsidianVault],
  );

  const save = useCallback(
    async (projectId: string) => {
      const draft = drafts[projectId];
      if (!draft) return;
      try {
        await projectTrackingSetSubscription({
          projectId,
          watchGit: draft.watchGit,
          watchActiveRuns: draft.watchActiveRuns,
          watchObsidian: draft.watchObsidian,
          obsidianVaultPath: draft.obsidianVaultPath,
          enabled: draft.enabled,
        });
        addToast(t.plugins.dev_lifecycle.tracking_saved, 'success');
        await refresh();
      } catch (err) {
        addToast(t.plugins.dev_lifecycle.tracking_save_failed, 'error');
        toastCatch('project-tracking-tab:save')(err);
      }
    },
    [drafts, addToast, refresh, t.plugins.dev_lifecycle.tracking_save_failed, t.plugins.dev_lifecycle.tracking_saved],
  );

  const [pulsing, setPulsing] = useState(false);
  const forcePulse = useCallback(async () => {
    if (pulsing) return;
    setPulsing(true);
    try {
      await projectTrackingRunNow();
      addToast(t.plugins.dev_lifecycle.tracking_pulse_fired, 'success');
      // Refresh after a short delay so the consolidator has a chance to write
      // a fresh lastPulseAt before the row redraws.
      window.setTimeout(() => { void refresh(); }, 1500);
    } catch (err) {
      addToast(t.plugins.dev_lifecycle.tracking_pulse_failed, 'error');
      toastCatch('project-tracking-tab:forcePulse')(err);
    } finally {
      setPulsing(false);
    }
  }, [pulsing, refresh, addToast, t.plugins.dev_lifecycle.tracking_pulse_fired, t.plugins.dev_lifecycle.tracking_pulse_failed]);

  const masterHint = useMemo(
    () =>
      masterEnabled
        ? t.plugins.dev_lifecycle.tracking_master_enabled_hint
        : t.plugins.dev_lifecycle.tracking_master_disabled_hint,
    [masterEnabled, t],
  );

  return (
    <div className="flex flex-col gap-3">
      <ProjectTrackingIntro
        subtitle={t.plugins.dev_lifecycle.tracking_subtitle}
        masterHint={masterHint}
      />

      <div>
        {loading && rows.length === 0 ? (
          <div className="typo-caption text-foreground/60">…</div>
        ) : rows.length === 0 ? (
          <div className="typo-caption text-foreground/60">
            {t.plugins.dev_lifecycle.tracking_no_projects}
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row) => {
              const draft = drafts[row.projectId];
              if (!draft) return null;
              const stale = isStalePulse(row.lastPulseAt, draft.enabled && masterEnabled);
              return (
                <div
                  key={row.projectId}
                  className={`rounded-card border p-4 transition-colors ${
                    stale
                      ? 'border-amber-500/30 bg-amber-500/[0.04]'
                      : 'border-primary/10 bg-secondary/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <div className="typo-body font-medium text-foreground/90 truncate">
                        {row.projectName}
                      </div>
                      <div className="typo-caption text-foreground/55 truncate" title={row.projectPath}>
                        {row.projectPath}
                      </div>
                    </div>
                    <ToggleButton
                      pressed={draft.enabled}
                      onChange={(next) => updateDraft(row.projectId, { enabled: next })}
                      ariaLabel={t.plugins.dev_lifecycle.tracking_column_enabled}
                    >
                      {t.plugins.dev_lifecycle.tracking_column_enabled}
                    </ToggleButton>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Checkbox
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <GitBranch className="w-3.5 h-3.5" />
                          {t.plugins.dev_lifecycle.tracking_column_watch_git}
                        </span>
                      }
                      checked={draft.watchGit}
                      onChange={(next) => updateDraft(row.projectId, { watchGit: next })}
                    />
                    <Checkbox
                      label={
                        <span className="inline-flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5" />
                          {t.plugins.dev_lifecycle.tracking_column_watch_active_runs}
                        </span>
                      }
                      checked={draft.watchActiveRuns}
                      onChange={(next) =>
                        updateDraft(row.projectId, { watchActiveRuns: next })
                      }
                    />
                    <Checkbox
                      label={t.plugins.dev_lifecycle.tracking_column_watch_obsidian}
                      checked={draft.watchObsidian}
                      onChange={(next) =>
                        updateDraft(row.projectId, { watchObsidian: next })
                      }
                      disabled={obsidianVault === null}
                    />
                  </div>
                  {obsidianVault === null ? (
                    <div className="typo-micro text-foreground/45 mt-2">
                      {t.plugins.dev_lifecycle.tracking_obsidian_no_credential}
                    </div>
                  ) : draft.watchObsidian ? (
                    <div className="typo-micro text-foreground/55 mt-2">
                      {t.plugins.dev_lifecycle.tracking_obsidian_vault_label}: <code>{draft.obsidianVaultPath ?? obsidianVault}</code>
                    </div>
                  ) : null}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-primary/10 gap-3 flex-wrap">
                    <div className={`typo-caption inline-flex items-center gap-1.5 ${
                      stale ? 'text-amber-400 font-medium' : 'text-foreground/55'
                    }`}>
                      {stale && <AlertTriangle className="w-3 h-3" />}
                      {t.plugins.dev_lifecycle.tracking_column_last_pulse}: {row.lastPulseAt ?? t.plugins.dev_lifecycle.tracking_never_pulsed}
                      {stale && (
                        <span className="text-amber-400/80 ml-1">{t.plugins.dev_lifecycle.tracking_stale_hint}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void forcePulse()}
                        disabled={pulsing || !masterEnabled || !draft.enabled}
                        title={!masterEnabled || !draft.enabled ? t.plugins.dev_lifecycle.tracking_force_pulse_disabled : t.plugins.dev_lifecycle.tracking_force_pulse_tooltip}
                      >
                        <Zap className={`w-3.5 h-3.5 mr-1 ${pulsing ? 'animate-pulse' : ''}`} />
                        {t.plugins.dev_lifecycle.tracking_force_pulse}
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void save(row.projectId)}
                        disabled={!draft.dirty}
                      >
                        <Save className="w-3.5 h-3.5 mr-1" />
                        {t.plugins.dev_lifecycle.tracking_save}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project-tracking intro — replaces the duplicated ContentHeader that used
// to sit inside the tab. Keeps the feature self-introducing without
// stealing visual weight from the parent Lifecycle header.
// ---------------------------------------------------------------------------

function ProjectTrackingIntro({
  subtitle,
  masterHint,
}: {
  subtitle: string;
  masterHint: string;
}) {
  return (
    <div className="rounded-card border border-indigo-500/20 bg-indigo-500/[0.04] px-4 py-3 flex items-start gap-3">
      <div className="w-8 h-8 rounded-modal bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center shrink-0">
        <Radio className="w-4 h-4 text-indigo-300" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="typo-body text-foreground/90">{subtitle}</p>
        <p className="typo-caption text-foreground/60">{masterHint}</p>
      </div>
    </div>
  );
}

interface CheckboxProps {
  label: React.ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

function Checkbox({ label, checked, onChange, disabled }: CheckboxProps) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-2 typo-caption rounded-input border ${
        checked
          ? 'border-primary/30 bg-primary/10 text-foreground/90'
          : 'border-primary/10 bg-secondary/10 text-foreground/65'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary/25'}`}
    >
      {checked ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
      ) : (
        <Circle className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
      )}
      {label}
    </button>
  );
}

interface ToggleButtonProps {
  pressed: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
  children: React.ReactNode;
}

function ToggleButton({ pressed, onChange, ariaLabel, children }: ToggleButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className={`px-3 py-1.5 typo-caption rounded-interactive border ${
        pressed
          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
          : 'border-primary/15 bg-secondary/10 text-foreground/60'
      }`}
    >
      {children}
    </button>
  );
}
