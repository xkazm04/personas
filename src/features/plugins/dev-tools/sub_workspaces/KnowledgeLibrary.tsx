// Knowledge library host — Topics won round B. Owns the item derivation
// (real rows blended with an optional deterministic demo corpus so scale
// behavior is visible before the harvest engine exists) and renders the
// consolidated tree + paginated DataGrid. Demo rows never touch the DB.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Share2 } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { listWorkspaceAdoption, projectWorkspacePractices } from '@/api/devTools/workspaces';
import type { WorkspacePracticeAdoption } from '@/lib/bindings/WorkspacePracticeAdoption';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { DevProject } from '@/lib/bindings/DevProject';
import type { WorkspaceKnowledge } from '@/lib/bindings/WorkspaceKnowledge';
import { useTranslation } from '@/i18n/useTranslation';

import { CreatePracticeModal } from './CreatePracticeModal';
import { PracticeDetailModal } from './PracticeDetailModal';
import { PracticeRolloutModal } from './PracticeRolloutModal';
import { ExtractionMenu } from './ExtractionMenu';
import KnowledgeTree from './KnowledgeTree';
import { generateMockLibrary } from './libraryMock';
import { nextQueueIndex, viewFromRow, type KnowledgeItemView } from './libraryModel';
import { WorkspacePulse } from './WorkspacePulse';
import type { Workspace } from './workspaceStore';

export default function KnowledgeLibrary({
  workspace,
  rows,
  projectById,
  onChanged,
}: {
  workspace: Workspace;
  rows: WorkspaceKnowledge[];
  projectById: Map<string, DevProject>;
  onChanged: () => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;

  // Default the demo corpus on for near-empty workspaces so the surface never
  // looks broken before harvesting exists; let the user toggle it off.
  const [demo, setDemo] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const [projecting, setProjecting] = useState(false);
  const [rollout, setRollout] = useState<WorkspaceKnowledge | null>(null);
  // Review queue, not a single row: adjudicating a library is a sequential
  // pass, so the modal walks the ordering the user is actually looking at.
  // The ids are SNAPSHOTTED on open — recomputing from the live table would
  // re-sort the queue under the cursor the moment a decision changes a row's
  // status, and "next" would stop meaning next.
  const [queue, setQueue] = useState<string[]>([]);
  const [queueIdx, setQueueIdx] = useState(0);
  const addToast = useToastStore((s) => s.addToast);
  const useDemo = demo ?? rows.length < 12;

  // Ambient distribution: write the workspace's adopted canon into every
  // member repo's Claude memory, so future sessions there carry it for free.
  const projectToRepos = async () => {
    setProjecting(true);
    try {
      const results = await projectWorkspacePractices(workspace.id);
      const ok = results.filter((r) => !r.skipped);
      const failed = results.filter((r) => r.skipped);
      const practices = ok.reduce((n, r) => Math.max(n, r.practices), 0);
      addToast(
        tx(w.projected, { projects: ok.length, practices }),
        ok.length > 0 ? 'success' : 'warning',
      );
      if (failed.length > 0) {
        addToast(tx(w.projected_skipped, { count: failed.length }), 'warning');
      }
    } catch (err) {
      toastCatch('workspaces:project')(err);
    } finally {
      setProjecting(false);
    }
  };

  const items = useMemo(() => {
    const real = rows.map(viewFromRow);
    if (!useDemo) return real;
    return [...real, ...generateMockLibrary(workspace.id, workspace.projectIds)];
  }, [rows, useDemo, workspace.id, workspace.projectIds]);

  // The adoption matrix is what makes the liquidity pillar measurable (is
  // adopted canon actually reaching the repos?). Re-read whenever the rows
  // change, so adopting a practice updates the pillar in the same beat.
  const [adoptions, setAdoptions] = useState<WorkspacePracticeAdoption[]>([]);
  useEffect(() => {
    let live = true;
    listWorkspaceAdoption(workspace.id)
      .then((a) => { if (live) setAdoptions(a); })
      // Pulse is ambient: a failed matrix read degrades liquidity to "—",
      // it never interrupts the review the user came here to do.
      .catch(silentCatch('workspaces:adoption-list'));
    return () => { live = false; };
  }, [workspace.id, rows]);

  const closeDetail = () => { setQueue([]); setQueueIdx(0); };

  const openDetail = (item: KnowledgeItemView, ordered: readonly KnowledgeItemView[]) => {
    const ids = ordered.filter((i) => !i.mock).map((i) => i.id);
    const at = ids.indexOf(item.id);
    setQueue(ids.length > 0 ? ids : [item.id]);
    setQueueIdx(Math.max(0, at));
  };

  const stepDetail = (delta: -1 | 1) => {
    const next = nextQueueIndex(queue, queueIdx, delta, (id) => rows.some((r) => r.id === id));
    if (next === null) closeDetail();
    else setQueueIdx(next);
  };

  const detailRow = queue.length > 0
    ? rows.find((r) => r.id === queue[queueIdx]) ?? null
    : null;

  const memberProjects = useMemo(
    () =>
      workspace.projectIds
        .map((id) => projectById.get(id))
        .filter((p): p is DevProject => Boolean(p)),
    [workspace.projectIds, projectById],
  );

  return (
    <div className="flex flex-col min-h-0 h-full gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="typo-section-title text-foreground">{w.library_title}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDemo(!useDemo)}
            className={`typo-label rounded-interactive border px-2 py-1 transition-colors ${
              useDemo
                ? 'border-status-warning/40 bg-status-warning/10 text-status-warning'
                : 'border-primary/10 text-foreground/70 hover:bg-secondary/40'
            }`}
          >
            {useDemo ? w.demo_on : w.demo_off}
          </button>
          <ExtractionMenu
            workspace={workspace}
            memberProjects={memberProjects}
            onChanged={onChanged}
          />
          <button
            type="button"
            onClick={projectToRepos}
            disabled={projecting}
            title={w.project_hint}
            className="typo-label flex items-center gap-1.5 rounded-interactive border border-primary/20 bg-primary/10 px-2.5 py-1 text-foreground hover:bg-primary/15 disabled:opacity-40 transition-colors"
          >
            <Share2 className="w-3.5 h-3.5" />
            {w.project_to_repos}
          </button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="w-4 h-4" />
            {w.new_practice}
          </Button>
        </div>
      </div>

      <WorkspacePulse
        items={items}
        adoptions={adoptions}
        // A digest entry is a single jump, not a review pass — open it alone.
        onOpenPractice={(item) => openDetail(item, [item])}
      />

      <div className="flex-1 min-h-0">
        <KnowledgeTree
          items={items}
          projectById={projectById}
          // Review before distribute: a row opens its DETAIL, and rollout is
          // reached from inside that modal (adopted practices only). Wiring
          // this straight to the rollout surface skipped the review step
          // entirely and offered to distribute practices still sitting at
          // `observed`.
          onRowClick={openDetail}
        />
      </div>

      {detailRow && (
        <PracticeDetailModal
          practice={detailRow}
          projectById={projectById}
          onClose={closeDetail}
          onChanged={onChanged}
          onRollout={(p) => setRollout(p)}
          nav={
            queue.length > 1
              ? { index: queueIdx, total: queue.length, onStep: stepDetail }
              : undefined
          }
        />
      )}

      {rollout && (
        <PracticeRolloutModal
          practice={rollout}
          workspaceName={workspace.name}
          workspaceId={workspace.id}
          memberProjects={memberProjects}
          onClose={() => setRollout(null)}
          onChanged={onChanged}
        />
      )}

      {creating && (
        <CreatePracticeModal
          workspaceId={workspace.id}
          memberProjects={memberProjects}
          onClose={() => setCreating(false)}
          onCreated={onChanged}
        />
      )}
    </div>
  );
}
