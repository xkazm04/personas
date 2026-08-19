// One playbook in the rail. Split out of PlaybooksPanel when the row grew an
// integrity readout: a playbook whose members have been deprecated out from
// under it silently teaches abandoned doctrine, so staleness is surfaced ON the
// collapsed row (a badge you cannot miss) and repaired from the expanded one.
import { AlertTriangle, ChevronDown, Play, Plus, Trash2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { WorkspacePlaybook } from '@/lib/bindings/WorkspacePlaybook';
import type { WorkspacePlaybookPattern } from '@/lib/bindings/WorkspacePlaybookPattern';
import type { StaleMember, SuggestedAddition } from './playbookModel';
import type { KnowledgeItemView } from '../libraryModel';

const PHASES = ['before', 'during', 'verify'] as const;

const STATUS_CHIP: Record<string, string> = {
  draft: 'bg-secondary/60 text-foreground/70',
  active: 'bg-status-success/10 text-status-success',
  retired: 'bg-secondary/40 text-foreground/45',
};

export function PlaybookRow({
  playbook: pb,
  members,
  stale,
  itemById,
  matches,
  expanded,
  onToggle,
  onSetStatus,
  onRequestDelete,
  onPrune,
  suggestions,
  onAddSuggestion,
  onOpenItem,
}: {
  playbook: WorkspacePlaybook;
  members: readonly WorkspacePlaybookPattern[];
  stale: readonly StaleMember[];
  itemById: ReadonlyMap<string, KnowledgeItemView>;
  /** Consult matches, `null` when the backend has no telemetry to give. */
  matches: number | null;
  expanded: boolean;
  onToggle: () => void;
  onSetStatus: (status: string) => void;
  onRequestDelete: () => void;
  onPrune: () => void;
  /** F4: adopted extensions of members, offered as one-click additions. */
  suggestions: readonly SuggestedAddition[];
  onAddSuggestion: (s: SuggestedAddition) => void;
  onOpenItem?: (item: KnowledgeItemView) => void;
}) {
  const { t, tx } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const staleById = new Map(stale.map((s) => [s.practiceId, s]));

  return (
    <div className="rounded-card border border-border/60 bg-secondary/20">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <ChevronDown
          className={`w-3.5 h-3.5 text-foreground/50 flex-shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`}
          aria-hidden
        />
        <span className="typo-body text-foreground truncate flex-1">{pb.title}</span>
        {stale.length > 0 && (
          <span className="typo-caption flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-status-warning/10 text-status-warning flex-shrink-0 tabular-nums">
            <AlertTriangle className="w-3 h-3" aria-hidden />
            {tx(w.playbook_stale_count, { count: stale.length })}
          </span>
        )}
        <span className={`typo-caption px-1.5 py-0.5 rounded-interactive flex-shrink-0 ${STATUS_CHIP[pb.status] ?? STATUS_CHIP.draft}`}>
          {pb.status === 'active' ? w.playbook_status_active : pb.status === 'retired' ? w.playbook_status_retired : w.playbook_status_draft}
        </span>
        {matches !== null && (
          <span
            title={w.playbook_consults_label}
            className="typo-caption text-primary/80 tabular-nums flex-shrink-0"
          >
            {tx(w.playbook_consults, { count: matches })}
          </span>
        )}
        <span className="typo-caption text-foreground/50 tabular-nums flex-shrink-0">{members.length}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2.5 border-t border-border/50">
          <p className="typo-caption text-foreground/70 mt-2">{pb.summary}</p>
          {PHASES.map((phase) => {
            const inPhase = members.filter((m) => m.phase === phase);
            if (inPhase.length === 0) return null;
            return (
              <div key={phase} className="mt-2">
                <span className="typo-label text-primary">
                  {phase === 'before' ? w.playbook_phase_before : phase === 'during' ? w.playbook_phase_during : w.playbook_phase_verify}
                </span>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {inPhase.map((m) => {
                    const item = itemById.get(m.practiceId);
                    const s = staleById.get(m.practiceId);
                    return (
                      <li key={m.practiceId} className="flex items-center gap-1.5 min-w-0">
                        {s && <AlertTriangle className="w-3 h-3 text-status-warning flex-shrink-0" aria-hidden />}
                        <button
                          type="button"
                          disabled={!item}
                          onClick={() => item && onOpenItem?.(item)}
                          title={m.note ?? undefined}
                          className={`text-left typo-caption truncate transition-colors disabled:text-foreground/40 ${
                            s
                              ? 'text-status-warning/90 line-through hover:text-status-warning'
                              : 'text-foreground/85 hover:text-foreground'
                          }`}
                        >
                          {item?.title ?? s?.title ?? m.practiceId}
                        </button>
                        {s?.replacementTitle && (
                          <span className="typo-caption px-1.5 rounded-pill bg-primary/10 text-primary truncate flex-shrink min-w-0">
                            {tx(w.playbook_replacement_hint, { title: s.replacementTitle })}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {suggestions.length > 0 && (
            <div className="mt-2">
              <span className="typo-label text-primary">{w.playbook_suggested_title}</span>
              <ul className="mt-1 flex flex-col gap-1">
                {suggestions.map((sug) => (
                  <li key={sug.item.id} className="flex items-center gap-1.5 min-w-0">
                    <Plus className="w-3 h-3 text-primary/70 flex-shrink-0" aria-hidden />
                    <button
                      type="button"
                      onClick={() => onOpenItem?.(sug.item)}
                      title={tx(w.playbook_suggested_reason, { title: sug.extendsTitle })}
                      className="text-left typo-caption text-foreground/85 hover:text-foreground truncate transition-colors"
                    >
                      {sug.item.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAddSuggestion(sug)}
                      className="typo-caption px-1.5 rounded-pill border border-primary/25 bg-primary/10 text-primary hover:bg-primary/15 flex-shrink-0 transition-colors"
                    >
                      {w.playbook_add}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {stale.length > 0 && (
            <button
              type="button"
              onClick={onPrune}
              className="mt-2.5 typo-caption flex items-center gap-1 rounded-interactive border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-status-warning hover:bg-status-warning/15 transition-colors"
            >
              <AlertTriangle className="w-3 h-3" aria-hidden />
              {tx(w.playbook_prune, { count: stale.length })}
            </button>
          )}

          <div className="mt-2.5 flex items-center gap-2">
            {pb.status !== 'active' ? (
              <button
                type="button"
                onClick={() => onSetStatus('active')}
                className="typo-caption flex items-center gap-1 rounded-interactive border border-status-success/30 bg-status-success/10 px-2 py-1 text-status-success hover:bg-status-success/15 transition-colors"
              >
                <Play className="w-3 h-3" aria-hidden />
                {w.playbook_activate}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onSetStatus('retired')}
                className="typo-caption rounded-interactive border border-border/60 bg-secondary/50 px-2 py-1 text-foreground/70 hover:text-foreground transition-colors"
              >
                {w.playbook_retire}
              </button>
            )}
            <button
              type="button"
              onClick={onRequestDelete}
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
}
