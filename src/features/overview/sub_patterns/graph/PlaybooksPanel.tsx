// Playbooks rail — the fabric's situation layer as a curator surface
// (pattern-fabric S3). Lists the workspace's playbooks with their phased
// membership, drives the draft→active→retired lifecycle, hosts the "create
// from basket" entry point, and — since a playbook silently rots when its
// members are deprecated under it — surfaces and repairs stale memberships.
// Deliberately an overlay rail, not a tree level: playbooks cut across
// branches and must never pretend to be topics.
import { useMemo, useState } from 'react';
import { BookOpen, SearchX, X } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { ConsultStats } from '@/api/devTools/workspaces';
import type { WorkspacePlaybook } from '@/lib/bindings/WorkspacePlaybook';
import type { WorkspacePlaybookPattern } from '@/lib/bindings/WorkspacePlaybookPattern';
import { playbookStaleMembers, type PatternEdgeLike } from './graphModel';
import { PlaybookRow } from './PlaybookRow';
import type { KnowledgeItemView } from '../libraryModel';

/** How many unmatched intents the rail shows — enough to spot a pattern in what
 *  the fabric is missing, few enough not to become a second list. */
const UNMATCHED_SHOWN = 5;

export function PlaybooksPanel({
  playbooks,
  members,
  itemById,
  edges,
  consultStats,
  basketCount,
  onCreateFromBasket,
  onSetStatus,
  onDelete,
  onPrune,
  onOpenItem,
  onClose,
}: {
  playbooks: readonly WorkspacePlaybook[];
  members: readonly WorkspacePlaybookPattern[];
  itemById: ReadonlyMap<string, KnowledgeItemView>;
  /** Pattern connections — the source of replacement suggestions. */
  edges: readonly PatternEdgeLike[];
  /** Consult telemetry; `null` when the command is unavailable. */
  consultStats: ConsultStats | null;
  basketCount: number;
  onCreateFromBasket: () => void;
  onSetStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  /** Repair: persist the surviving members, phases and ordinals intact. */
  onPrune: (id: string, survivors: WorkspacePlaybookPattern[]) => void;
  onOpenItem?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkspacePlaybook | null>(null);

  const byPlaybook = useMemo(() => {
    const out = new Map<string, WorkspacePlaybookPattern[]>();
    for (const m of members) {
      const list = out.get(m.playbookId) ?? [];
      list.push(m);
      out.set(m.playbookId, list);
    }
    return out;
  }, [members]);

  const staleByPlaybook = useMemo(() => {
    const out = new Map<string, ReturnType<typeof playbookStaleMembers>>();
    for (const pb of playbooks) {
      out.set(pb.id, playbookStaleMembers(byPlaybook.get(pb.id) ?? [], itemById, edges));
    }
    return out;
  }, [playbooks, byPlaybook, itemById, edges]);

  const matchesBySlug = useMemo(() => {
    if (!consultStats) return null;
    return new Map(consultStats.perPlaybook.map((p) => [p.slug, p.matches]));
  }, [consultStats]);

  const unmatched = consultStats?.unmatched.slice(0, UNMATCHED_SHOWN) ?? [];

  return (
    <div className="absolute right-3 top-3 bottom-14 z-10 w-[340px] max-w-[calc(100%-5rem)] flex flex-col rounded-card border border-border/70 bg-background/95 backdrop-blur-sm shadow-elevation-3 animate-fade-in">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border/60 flex-shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-primary" aria-hidden />
          <h3 className="typo-label text-foreground">{w.playbooks_title}</h3>
          <span className="typo-caption text-foreground/50 tabular-nums">{playbooks.length}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.close}
          className="text-foreground/50 hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {basketCount > 0 && (
        <button
          type="button"
          onClick={onCreateFromBasket}
          className="mx-3 mt-2.5 flex-shrink-0 typo-label rounded-interactive border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-foreground hover:bg-primary/15 transition-colors"
        >
          {tx(w.playbooks_create_from_basket, { count: basketCount })}
        </button>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2.5 flex flex-col gap-2">
        {playbooks.length === 0 && (
          <p className="typo-caption text-foreground/50">{w.playbooks_empty}</p>
        )}
        {playbooks.map((pb) => {
          const mine = byPlaybook.get(pb.id) ?? [];
          const stale = staleByPlaybook.get(pb.id) ?? [];
          return (
            <PlaybookRow
              key={pb.id}
              playbook={pb}
              members={mine}
              stale={stale}
              itemById={itemById}
              matches={matchesBySlug?.get(pb.slug) ?? null}
              expanded={open === pb.id}
              onToggle={() => setOpen(open === pb.id ? null : pb.id)}
              onSetStatus={(status) => onSetStatus(pb.id, status)}
              onRequestDelete={() => setConfirmDelete(pb)}
              onPrune={() => {
                const dead = new Set(stale.map((s) => s.practiceId));
                onPrune(
                  pb.id,
                  mine.filter((m) => !dead.has(m.practiceId)),
                );
              }}
              onOpenItem={onOpenItem}
            />
          );
        })}
      </div>

      {/* What the consult layer asked for and could not answer — the fabric's
          own list of playbooks it is missing, sourced from real requests. */}
      {unmatched.length > 0 && (
        <div className="flex-shrink-0 border-t border-border/60 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <SearchX className="w-3 h-3 text-foreground/50" aria-hidden />
            <span className="typo-label text-foreground/70">{w.playbook_unmatched_title}</span>
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {unmatched.map((u) => (
              <li key={`${u.createdAt}-${u.intent}`} className="flex items-baseline gap-2 min-w-0">
                <span className="typo-caption text-foreground/85 truncate flex-1">{u.intent}</span>
                <RelativeTime
                  timestamp={u.createdAt}
                  className="typo-caption text-foreground/45 flex-shrink-0"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={w.playbook_delete}
          body={tx(w.playbook_delete_confirm, { title: confirmDelete.title })}
          confirmLabel={w.playbook_delete}
          danger
          onConfirm={() => {
            onDelete(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
