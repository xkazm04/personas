/**
 * Lifecycle: the active project's development practice (Lifecycle v2). The
 * header names the preset and version; the body is the interim journey
 * (journey/LifecycleJourney), which the lifecycle-nextgen contest winner
 * replaces. Actions: Install into repo (only while a repo binding is missing;
 * dispatches a Run Desk task) and Ask Athena (she reads and changes the
 * practice; the user never edits it here).
 *
 * Loading pattern v2: the header is permanent chrome; a cold first load ghosts
 * the lanes under it; a warm remount paints from the module cache in
 * useLifecycleSnapshot and revalidates; a failure shows an inline banner and
 * keeps any warm snapshot on screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, GitBranch, Sparkles } from 'lucide-react';

import { installLifecycle } from '@/api/devTools/lifecycle';
import { useAskAthena } from '@/features/plugins/companion/useAskAthena';
import { Button } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { JourneyGhost } from './journey/JourneyGhost';
import { LifecycleJourney } from './journey/LifecycleJourney';
import { authorLabel, bindingKindLabel, presetLabel, stepLabel } from './journey/journeyLabels';
import { installInFlight, missingBindings, weakest } from './journey/journeyModel';
import { useLifecycleSnapshot } from './journey/useLifecycleSnapshot';

export default function LifecyclePage() {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) => s.projects.find((p) => p.id === s.activeProjectId));
  const addToast = useToastStore((s) => s.addToast);
  const askAthena = useAskAthena();
  const { snapshot, loading, error, refetch } = useLifecycleSnapshot(activeProjectId);

  // The install task id this page just dispatched; missing bindings read as
  // pending until the refetched snapshot names that task (the backend then
  // reports pending itself, and stops when the task ends).
  const [dispatched, setDispatched] = useState<{ projectId: string; taskId: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const installRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (dispatched && snapshot?.projectId === dispatched.projectId && snapshot.installTaskId === dispatched.taskId) {
      setDispatched(null);
    }
  }, [dispatched, snapshot]);

  const current = snapshot && snapshot.projectId === activeProjectId ? snapshot : null;
  const forcePending = !!dispatched && dispatched.projectId === activeProjectId;
  const missing = useMemo(() => (current ? missingBindings(current) : []), [current]);
  const installing = forcePending || (current ? installInFlight(current) : false);

  const subtitle = current
    ? current.version === 0
      ? tx(dl.lc_subtitle_default, { preset: presetLabel(dl, current.preset) })
      : tx(dl.lc_subtitle_version, {
          preset: presetLabel(dl, current.preset),
          version: current.version,
          author: authorLabel(dl, current.author) ?? '',
        })
    : activeProject?.root_path ?? '';

  const missingText = missing
    .map((m) => `${stepLabel(dl, m.stepId, m.label)} (${bindingKindLabel(dl, m.kind)})`)
    .join(', ');

  const handleInstall = async () => {
    if (!activeProjectId) return;
    try {
      const taskId = await installLifecycle(activeProjectId);
      if (taskId) {
        setDispatched({ projectId: activeProjectId, taskId });
        addToast(tx(dl.lc_install_started, { id: taskId }), 'success');
      } else {
        addToast(dl.lc_install_nothing, 'warning');
      }
      setConfirmOpen(false);
      refetch();
    } catch (err) {
      toastCatch('lifecycle:install', dl.lc_install_failed)(err);
    }
  };

  const handleAskAthena = () => {
    if (!activeProject) return;
    const weak = current ? weakest(current) : null;
    const text = weak
      ? tx(dl.lc_ask_athena_prompt_weakest, {
          name: activeProject.name, id: activeProject.id, step: stepLabel(dl, weak.node.id, weak.node.label),
        })
      : tx(dl.lc_ask_athena_prompt, { name: activeProject.name, id: activeProject.id });
    askAthena('lifecycle', text);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_tools.lifecycle_title}
        subtitle={subtitle}
        actions={<LifecycleProjectPicker />}
      />

      <ContentBody centered>
        {!activeProjectId ? (
          <EmptyState icon={GitBranch} title={dl.lc_empty_title} subtitle={dl.lc_empty_subtitle} />
        ) : (
          <div className="space-y-6 pb-6">
            <ActionRow
              left={installing ? (
                <span className="flex items-center gap-1.5 typo-caption text-status-warning" data-testid="lc-install-running">
                  <span className="w-3 h-3 rounded-interactive border-2 border-dashed border-status-warning/80" aria-hidden />
                  {dl.lc_install_running}
                </span>
              ) : undefined}
            >
              {current && missing.length > 0 && !installing && (
                <Button
                  ref={installRef}
                  variant="secondary"
                  size="sm"
                  icon={<Download className="w-3.5 h-3.5" />}
                  onClick={() => setConfirmOpen(true)}
                  data-testid="lc-install"
                >
                  {dl.lc_install}
                </Button>
              )}
              <Button
                variant="accent"
                accentColor="violet"
                size="sm"
                icon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={handleAskAthena}
                disabled={!activeProject}
                data-testid="lc-ask-athena"
              >
                {dl.lc_ask_athena}
              </Button>
            </ActionRow>

            {error && (
              <Banner severity="error" compact message={dl.lc_load_failed} cause={error} onRetry={refetch} />
            )}

            {current ? (
              <LifecycleJourney snapshot={current} forcePending={forcePending} />
            ) : loading ? (
              <JourneyGhost />
            ) : null}
          </div>
        )}
      </ContentBody>

      <ConfirmPopover
        open={confirmOpen}
        anchorRef={installRef}
        title={dl.lc_install_title}
        detail={tx(dl.lc_install_body, { items: missingText })}
        confirmLabel={dl.lc_install_confirm}
        confirmIcon={<Download className="w-3.5 h-3.5" />}
        onConfirm={handleInstall}
        onCancel={() => setConfirmOpen(false)}
        width={380}
        testId="lc-install-confirm"
        confirmTestId="lc-install-confirm-go"
      />
    </ContentBox>
  );
}
