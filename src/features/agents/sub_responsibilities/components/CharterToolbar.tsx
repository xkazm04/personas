import { Plus, Inbox } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { CHARTER_STATUSES, type CharterStatus } from './CharterStatusLadder';

interface CharterToolbarProps {
  /** One entry per rung, always — see the seed in ResponsibilitiesTab. */
  counts: Record<CharterStatus, number>;
  statusFilter: string | null;
  onStatusFilter: (status: string | null) => void;
  inboxOpen: boolean;
  onToggleInbox: () => void;
  onNew: () => void;
}

/**
 * The tab's `topSlot`: a status filter across the whole ladder, the draft-inbox
 * toggle, and the create door. The filter renders every rung — including the
 * ones with zero charters — because a rung that vanishes when empty is exactly
 * how `draft` and `suspended` came to look unreachable.
 */
export function CharterToolbar({
  counts,
  statusFilter,
  onStatusFilter,
  inboxOpen,
  onToggleInbox,
  onNew,
}: CharterToolbarProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const life = t.agents.life;
  const labels: Record<string, string> = {
    draft: life.resp_status_draft,
    active: t.common.active,
    suspended: life.resp_status_suspended,
    retired: life.resp_status_retired,
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="resp-toolbar">
      <button
        type="button"
        onClick={() => onStatusFilter(null)}
        aria-pressed={statusFilter === null}
        className={`px-2 py-1 rounded-pill border typo-code transition-colors ${
          statusFilter === null
            ? 'bg-primary/15 border-primary/40 text-primary'
            : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
        }`}
        data-testid="resp-filter-all"
      >
        {c.filter_all}
      </button>
      {CHARTER_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onStatusFilter(statusFilter === s ? null : s)}
          aria-pressed={statusFilter === s}
          className={`px-2 py-1 rounded-pill border typo-code transition-colors ${
            statusFilter === s
              ? 'bg-primary/15 border-primary/40 text-primary'
              : 'bg-secondary/30 border-primary/10 text-foreground/85 hover:border-primary/25'
          }`}
          data-testid={`resp-filter-${s}`}
        >
          {labels[s] ?? s}
          <span className="ml-1.5 tabular-nums opacity-70">{counts[s]}</span>
        </button>
      ))}

      <div className="flex-1" />

      <Button
        size="xs"
        variant={inboxOpen ? 'primary' : 'ghost'}
        icon={<Inbox className="w-3.5 h-3.5" />}
        onClick={onToggleInbox}
        data-testid="resp-toggle-inbox"
      >
        {c.draft_inbox_title}
      </Button>
      <Button
        size="xs"
        variant="primary"
        icon={<Plus className="w-3.5 h-3.5" />}
        onClick={onNew}
        data-testid="resp-new"
      >
        {life.resp_new}
      </Button>
      <StatusBadge size="sm" accent="slate">
        {String(Object.values(counts).reduce((a, b) => a + b, 0))}
      </StatusBadge>
    </div>
  );
}
