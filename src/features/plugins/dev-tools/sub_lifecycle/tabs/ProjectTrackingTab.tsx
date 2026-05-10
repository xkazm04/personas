import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, GitBranch, FileText, Save } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  projectTrackingListSubscriptions,
  projectTrackingSetSubscription,
  projectTrackingIsMasterEnabled,
  projectTrackingGetObsidianVault,
} from '@/api/companion/projectTracking';
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

  const masterHint = useMemo(
    () =>
      masterEnabled
        ? t.plugins.dev_lifecycle.tracking_master_enabled_hint
        : t.plugins.dev_lifecycle.tracking_master_disabled_hint,
    [masterEnabled, t],
  );

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title={t.plugins.dev_lifecycle.tracking_title}
        subtitle={t.plugins.dev_lifecycle.tracking_subtitle}
      />
      <ContentBody>
        <div className="px-3 py-2 typo-caption rounded-card border border-primary/15 bg-secondary/10 text-foreground/70 mb-4">
          {masterHint}
        </div>

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
              return (
                <div
                  key={row.projectId}
                  className="rounded-card border border-primary/10 bg-secondary/5 p-4"
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

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-primary/10">
                    <div className="typo-caption text-foreground/55">
                      {t.plugins.dev_lifecycle.tracking_column_last_pulse}: {row.lastPulseAt ?? t.plugins.dev_lifecycle.tracking_never_pulsed}
                    </div>
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
              );
            })}
          </div>
        )}
      </ContentBody>
    </ContentBox>
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
