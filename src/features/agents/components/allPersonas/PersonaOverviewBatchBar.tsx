import { useRef, useState } from 'react';
import { Archive, ArchiveRestore, Copy, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { PersonaBatchTeamMenu } from './PersonaBatchTeamMenu';

interface PersonaOverviewBatchBarProps {
  count: number;
  onDelete: () => void;
  onClear: () => void;
  /**
   * Bulk home-team handler — called with the target team id (or `null` to
   * clear the home team). When omitted, the set-home-team button is hidden
   * so the bar gracefully degrades for any other batch-bar consumers.
   */
  onMoveToGroup?: (homeTeamId: string | null) => Promise<void> | void;
  /** Bulk-archive the selection. Hidden when omitted (e.g. Archived view). */
  onArchive?: () => Promise<void> | void;
  /** Bulk-restore the selection. Shown only in the Archived view. */
  onRestore?: () => Promise<void> | void;
  /** Bulk-duplicate the selection. Hidden when omitted (e.g. Archived view). */
  onDuplicate?: () => Promise<void> | void;
}

/**
 * Bulk actions over the roster selection. Every control is the shared Button
 * family with a semantic tone (danger for Delete), never a hand-painted hue.
 */
export function PersonaOverviewBatchBar({
  count,
  onDelete,
  onClear,
  onMoveToGroup,
  onArchive,
  onRestore,
  onDuplicate,
}: PersonaOverviewBatchBarProps) {
  const { t, tx } = useTranslation();
  // One busy flag for every async bulk action (move / archive / restore): a
  // second click while the first is in flight used to fire the handler
  // again - only the move had a guard. Delete opens a confirm modal and
  // needs none. Shared ACROSS the three, which a per-button AsyncButton
  // would not give, so the bar keeps its own gate.
  const [busy, setBusy] = useState(false);
  /** Synchronous double-submit gate; `busy` above is only the paint. */
  const inFlight = useRef(false);

  if (count === 0) return null;

  const guarded = async (run: () => Promise<void> | void) => {
    // The gate is the REF, not the state: React commits `busy` a render
    // later, so two clicks dispatched before that render would both close
    // over `busy === false`. The ref is written synchronously at click time.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await run();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-2 rounded-modal border border-primary/15 bg-secondary/40 backdrop-blur-sm">
      <span className="typo-body text-foreground">{tx(t.agents.persona_list.batch_selected, { count })}</span>
      <div className="w-px h-4 bg-primary/15" />
      {onMoveToGroup && (
        <PersonaBatchTeamMenu busy={busy} onPick={(id) => void guarded(() => onMoveToGroup(id))} />
      )}
      {onDuplicate && (
        <AsyncButton
          variant="secondary"
          size="sm"
          icon={<Copy className="w-3.5 h-3.5" />}
          data-testid="persona-batch-duplicate"
          onClick={async () => { await onDuplicate(); }}
        >
          {t.common.duplicate}
        </AsyncButton>
      )}
      {onArchive && (
        <Button
          variant="accent"
          tone="warning"
          size="sm"
          icon={<Archive className="w-3.5 h-3.5" />}
          onClick={() => void guarded(onArchive)}
          disabled={busy}
          aria-busy={busy}
        >
          {t.agents.persona_list.batch_archive}
        </Button>
      )}
      {onRestore && (
        <Button
          variant="accent"
          tone="success"
          size="sm"
          icon={<ArchiveRestore className="w-3.5 h-3.5" />}
          onClick={() => void guarded(onRestore)}
          disabled={busy}
          aria-busy={busy}
        >
          {t.agents.persona_list.batch_restore}
        </Button>
      )}
      <Button variant="danger" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={onDelete}>
        {t.agents.persona_list.batch_delete}
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t.agents.persona_list.batch_clear}
      </Button>
    </div>
  );
}
