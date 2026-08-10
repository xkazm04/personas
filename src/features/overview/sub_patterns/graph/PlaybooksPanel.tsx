// Playbooks rail — the fabric's situation layer as a curator surface
// (pattern-fabric S3). Lists the workspace's playbooks with their phased
// membership, drives the draft→active→retired lifecycle, and hosts the
// "create from basket" entry point. Deliberately an overlay rail, not a tree
// level: playbooks cut across branches and must never pretend to be topics.
import { useState } from 'react';
import { BookOpen, ChevronDown, Play, Trash2, X } from 'lucide-react';

import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { useTranslation } from '@/i18n/useTranslation';
import type { WorkspacePlaybook } from '@/lib/bindings/WorkspacePlaybook';
import type { WorkspacePlaybookPattern } from '@/lib/bindings/WorkspacePlaybookPattern';
import type { KnowledgeItemView } from '../libraryModel';

const PHASES = ['before', 'during', 'verify'] as const;

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-secondary/60 text-foreground/70',
  active: 'bg-status-success/10 text-status-success',
  retired: 'bg-secondary/40 text-foreground/45',
};

export function PlaybooksPanel({
  playbooks,
  members,
  itemById,
  basketCount,
  onCreateFromBasket,
  onSetStatus,
  onDelete,
  onOpenItem,
  onClose,
}: {
  playbooks: readonly WorkspacePlaybook[];
  members: readonly WorkspacePlaybookPattern[];
  itemById: ReadonlyMap<string, KnowledgeItemView>;
  basketCount: number;
  onCreateFromBasket: () => void;
  onSetStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onOpenItem?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [open, setOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WorkspacePlaybook | null>(null);

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
          const mine = members.filter((m) => m.playbookId === pb.id);
          const expanded = open === pb.id;
          return (
            <div key={pb.id} className="rounded-card border border-border/60 bg-secondary/20">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : pb.id)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 text-foreground/50 flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
                  aria-hidden
                />
                <span className="typo-body text-foreground truncate flex-1">{pb.title}</span>
                <span className={`typo-caption px-1.5 py-0.5 rounded-interactive flex-shrink-0 ${STATUS_CHIP[pb.status] ?? STATUS_CHIP.draft}`}>
                  {pb.status === 'active' ? w.playbook_status_active : pb.status === 'retired' ? w.playbook_status_retired : w.playbook_status_draft}
                </span>
                <span className="typo-caption text-foreground/50 tabular-nums flex-shrink-0">{mine.length}</span>
              </button>

              {expanded && (
                <div className="px-3 pb-2.5 border-t border-border/50">
                  <p className="typo-caption text-foreground/70 mt-2">{pb.summary}</p>
                  {PHASES.map((phase) => {
                    const inPhase = mine.filter((m) => m.phase === phase);
                    if (inPhase.length === 0) return null;
                    return (
                      <div key={phase} className="mt-2">
                        <span className="typo-label text-primary">
                          {phase === 'before' ? w.playbook_phase_before : phase === 'during' ? w.playbook_phase_during : w.playbook_phase_verify}
                        </span>
                        <ul className="mt-1 flex flex-col gap-0.5">
                          {inPhase.map((m) => {
                            const item = itemById.get(m.practiceId);
                            return (
                              <li key={m.practiceId}>
                                <button
                                  type="button"
                                  disabled={!item}
                                  onClick={() => item && onOpenItem?.(item)}
                                  title={m.note ?? undefined}
                                  className="w-full text-left typo-caption text-foreground/85 hover:text-foreground truncate transition-colors disabled:text-foreground/40"
                                >
                                  {item?.title ?? m.practiceId}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                  <div className="mt-2.5 flex items-center gap-2">
                    {pb.status !== 'active' ? (
                      <button
                        type="button"
                        onClick={() => onSetStatus(pb.id, 'active')}
                        className="typo-caption flex items-center gap-1 rounded-interactive border border-status-success/30 bg-status-success/10 px-2 py-1 text-status-success hover:bg-status-success/15 transition-colors"
                      >
                        <Play className="w-3 h-3" aria-hidden />
                        {w.playbook_activate}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSetStatus(pb.id, 'retired')}
                        className="typo-caption rounded-interactive border border-border/60 bg-secondary/50 px-2 py-1 text-foreground/70 hover:text-foreground transition-colors"
                      >
                        {w.playbook_retire}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(pb)}
                      aria-label={w.playbook_delete}
                      className="typo-caption flex items-center gap-1 text-foreground/50 hover:text-status-error transition-colors"
                    >
                      <Trash2 className="w-3 h-3" aria-hidden />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
