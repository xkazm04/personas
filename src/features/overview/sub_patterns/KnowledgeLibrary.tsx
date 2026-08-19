// Knowledge library host — Topics won round B. Owns the item derivation from
// the workspace's real rows and renders the consolidated tree + paginated
// DataGrid. (A deterministic demo corpus used to be blended in so scale
// behavior was visible before the harvest engine existed; it was retired once
// harvesting shipped — a library that shows practices nobody harvested is
// worse than an empty one.)
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Share2 } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import {
  decideWorkspaceKnowledgeBulk,
  listWorkspaceAdoption,
  projectWorkspacePractices,
} from '@/api/devTools/workspaces';
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
import { PlaybooksRail } from './playbooks/PlaybooksRail';
import { isDirection, nextQueueIndex, viewFromRow, type KnowledgeItemView } from './libraryModel';
import { WorkspacePulse } from './WorkspacePulse';
import type { Workspace } from '@/features/plugins/dev-tools/sub_workspaces/workspaceStore';

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

  // Altitude scope — the INVERTED library: both views are built from
  // Directions (macro doctrines) by default; techniques are the evidence you
  // drill into (a direction's `governs` chips) or flip the scope to see. This
  // scopes the STRUCTURE — topic rail counts, graph clusters, rings, stats —
  // not just row order.
  const [altitude, setAltitude] = useState<'directions' | 'all' | 'techniques'>('directions');
  // Playbooks rail (fabric S3) — a live backend feature; the rail overlays the
  // tree so the curator can read playbooks against the library they index.
  const [showPlaybooks, setShowPlaybooks] = useState(false);
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

  const items = useMemo(() => rows.map(viewFromRow), [rows]);
  // A corpus with no distilled directions yet must not open on an empty view.
  const hasDirections = useMemo(() => items.some(isDirection), [items]);
  const effectiveAltitude = hasDirections ? altitude : 'all';
  const scopedItems = useMemo(() => {
    if (effectiveAltitude === 'all') return items;
    return items.filter((i) =>
      effectiveAltitude === 'directions' ? isDirection(i) : !isDirection(i),
    );
  }, [items, effectiveAltitude]);

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

  // Bulk review. A twelve-territory harvest lands a few hundred `observed`
  // items; one modal per item is hours of work, so the governance pillar never
  // moves and the rational response becomes "don't harvest". Same governance
  // gate, larger batch.
  const bulkDecide = async (ids: string[], decision: 'adopt' | 'reject') => {
    try {
      const res = await decideWorkspaceKnowledgeBulk(ids, decision);
      addToast(
        tx(decision === 'adopt' ? w.bulk_adopted : w.bulk_rejected, { count: res.decided }),
        res.decided > 0 ? 'success' : 'warning',
      );
      // Partial failure is reported, never swallowed — a reviewer who thinks
      // they cleared 50 items must not silently have cleared 47.
      if (res.failed.length > 0) {
        addToast(tx(w.bulk_failed, { count: res.failed.length }), 'warning');
      }
      onChanged();
    } catch (err) {
      toastCatch('workspaces:bulkDecide')(err);
    }
  };

  const closeDetail = () => { setQueue([]); setQueueIdx(0); };

  const openDetail = (item: KnowledgeItemView, ordered: readonly KnowledgeItemView[]) => {
    const ids = ordered.map((i) => i.id);
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
        <div className="flex items-center gap-3 min-w-0">
          <h2 className="typo-section-title text-foreground">{w.library_title}</h2>
          {hasDirections && (
            <div className="flex items-center rounded-interactive border border-border/60 bg-secondary/50 p-0.5">
              {(
                [
                  { id: 'directions', label: w.altitude_directions },
                  { id: 'all', label: w.altitude_all },
                  { id: 'techniques', label: w.altitude_techniques },
                ] as const
              ).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAltitude(id)}
                  aria-pressed={effectiveAltitude === id}
                  className={`typo-label rounded-interactive px-2.5 py-1 transition-colors ${
                    effectiveAltitude === id
                      ? 'bg-background text-foreground shadow-elevation-1'
                      : 'text-foreground/60 hover:text-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPlaybooks((v) => !v)}
            aria-pressed={showPlaybooks}
            className={`typo-label flex items-center gap-1.5 rounded-interactive border px-2.5 py-1 transition-colors ${
              showPlaybooks
                ? 'border-primary/25 bg-primary/10 text-foreground'
                : 'border-border/60 bg-secondary/50 text-foreground/70 hover:text-foreground'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" aria-hidden />
            {w.playbooks_title}
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
          {/* `icon`, not a child: as a child the glyph shares one inline span
              with the label and loses the flex gap that keeps them on one row. */}
          <Button
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => setCreating(true)}
            className="whitespace-nowrap"
          >
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

      <div className="relative flex-1 min-h-0">
        <KnowledgeTree
          items={scopedItems}
          projectById={projectById}
          // Review before distribute: a row opens its DETAIL, and rollout is
          // reached from inside that modal (adopted practices only). Wiring
          // this straight to the rollout surface skipped the review step
          // entirely and offered to distribute practices still sitting at
          // `observed`.
          onRowClick={openDetail}
          onBulkDecide={bulkDecide}
        />
        {showPlaybooks && (
          <PlaybooksRail
            workspaceId={workspace.id}
            items={items}
            // A playbook member is a single jump, not a review pass.
            onOpenItem={(item) => openDetail(item, [item])}
            onClose={() => setShowPlaybooks(false)}
          />
        )}
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
