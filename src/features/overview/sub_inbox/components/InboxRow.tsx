/**
 * InboxRow — a single triage row for the unified inbox.
 *
 * Anatomy (left → right):
 *   - Selection checkbox (visible on hover or when any item is selected)
 *   - Source-kind icon (ClipboardCheck / MessageSquare / FileText / Heart)
 *   - Severity dot (rose / gold / sky)
 *   - Title + persona name + relative timestamp + "why this is here" info icon
 *   - Quick-action chips (Approve / Reject / Resolve / Snooze / Open)
 *
 * Cursor highlight is driven by `focused` (set by parent's J/K keyboard nav).
 */
import { memo } from 'react';
import {
  ClipboardCheck,
  MessageSquare,
  FileText,
  Heart,
  Check,
  X,
  Clock,
  ExternalLink,
  Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { UnifiedInboxItem } from '@/features/simple-mode/types';
import { formatRelativeTime } from '@/features/simple-mode/utils/formatRelativeTime';
import type { InboxActions } from '../hooks/useInboxActions';
import { reasonForItem } from '../libs/inboxReasons';

interface Props {
  item: UnifiedInboxItem;
  focused: boolean;
  selected: boolean;
  snoozedUntil: string | null;
  onToggleSelect: (id: string) => void;
  onClick: (id: string) => void;
  actions: InboxActions;
}

const KIND_ICON: Record<UnifiedInboxItem['kind'], LucideIcon> = {
  approval: ClipboardCheck,
  message: MessageSquare,
  output: FileText,
  health: Heart,
};

function severityDotClass(severity: UnifiedInboxItem['severity']): string {
  if (severity === 'critical') return 'bg-red-400';
  if (severity === 'warning') return 'bg-amber-400';
  return 'bg-sky-400';
}

export const InboxRow = memo(function InboxRow({
  item,
  focused,
  selected,
  snoozedUntil,
  onToggleSelect,
  onClick,
  actions,
}: Props) {
  const { t } = useTranslation();
  const r = t.overview.inbox_triage;
  const Icon = KIND_ICON[item.kind];

  const baseCls =
    'group/row relative flex items-center gap-3 pl-3 pr-2 py-2.5 border-l-2 transition-colors cursor-pointer';
  const stateCls = focused
    ? 'border-l-primary bg-primary/[0.08]'
    : selected
    ? 'border-l-primary/50 bg-primary/[0.04]'
    : 'border-l-transparent hover:bg-secondary/30';

  return (
    <div
      data-inbox-row={item.id}
      className={`${baseCls} ${stateCls}`}
      onClick={() => onClick(item.id)}
    >
      {/* Checkbox — visible on hover or when row is selected */}
      <button
        type="button"
        aria-label={r.row_select_aria}
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(item.id);
        }}
        className={`shrink-0 w-4 h-4 rounded-sm border-2 transition-all flex items-center justify-center ${
          selected
            ? 'bg-primary/80 border-primary/60 opacity-100'
            : 'border-primary/30 hover:border-primary/60 opacity-0 group-hover/row:opacity-100'
        }`}
      >
        {selected && (
          <svg className="w-3 h-3 text-btn-primary-fg" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {/* Source-kind icon */}
      <div className="shrink-0 w-8 h-8 rounded-card bg-secondary/40 border border-primary/10 flex items-center justify-center">
        <Icon className="w-4 h-4 text-foreground/80" />
      </div>

      {/* Body — title + persona + age */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`shrink-0 w-1.5 h-1.5 rounded-full ${severityDotClass(item.severity)}`}
            aria-hidden
          />
          <span className="typo-body text-foreground truncate font-medium">{item.title}</span>
          <button
            type="button"
            tabIndex={-1}
            title={reasonForItem(t, item)}
            aria-label={r.row_reason_aria}
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-foreground/40 hover:text-foreground/80 transition-colors"
          >
            <Info className="w-3 h-3" />
          </button>
        </div>
        <div className="typo-caption text-foreground/60 flex items-center gap-1.5 mt-0.5 truncate">
          <span className="truncate">{item.personaName}</span>
          <span className="text-foreground/30">·</span>
          <span className="shrink-0">{formatRelativeTime(item.createdAt, t)}</span>
          {snoozedUntil && (
            <>
              <span className="text-foreground/30">·</span>
              <span className="shrink-0 inline-flex items-center gap-1 text-amber-400">
                <Clock className="w-3 h-3" />
                {r.row_snoozed_label}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Quick-action chips */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
        {item.kind === 'approval' && (
          <>
            <ChipButton
              label={r.action_approve}
              icon={Check}
              onClick={(e) => { e.stopPropagation(); void actions.approve(item); }}
              tone="success"
            />
            <ChipButton
              label={r.action_reject}
              icon={X}
              onClick={(e) => { e.stopPropagation(); void actions.reject(item); }}
              tone="danger"
            />
          </>
        )}
        {(item.kind === 'message' || item.kind === 'output') && (
          <ChipButton
            label={r.action_mark_read}
            icon={Check}
            onClick={(e) => { e.stopPropagation(); void actions.markRead(item); }}
            tone="success"
          />
        )}
        {item.kind === 'health' && (
          <ChipButton
            label={r.action_resolve}
            icon={Check}
            onClick={(e) => { e.stopPropagation(); void actions.resolveHealth(item); }}
            tone="success"
          />
        )}
        {snoozedUntil ? (
          <ChipButton
            label={r.action_unsnooze}
            icon={Clock}
            onClick={(e) => { e.stopPropagation(); actions.unsnooze(item); }}
            tone="default"
          />
        ) : (
          <ChipButton
            label={r.action_snooze}
            icon={Clock}
            onClick={(e) => { e.stopPropagation(); actions.snooze(item); }}
            tone="default"
          />
        )}
        <ChipButton
          label={r.action_open}
          icon={ExternalLink}
          onClick={(e) => { e.stopPropagation(); actions.open(item); }}
          tone="default"
        />
      </div>
    </div>
  );
});

function ChipButton({
  label,
  icon: Icon,
  onClick,
  tone,
}: {
  label: string;
  icon: LucideIcon;
  onClick: (e: React.MouseEvent) => void;
  tone: 'default' | 'success' | 'danger';
}) {
  const toneCls =
    tone === 'success'
      ? 'text-emerald-400 hover:bg-emerald-500/10 border-emerald-500/20'
      : tone === 'danger'
      ? 'text-red-400 hover:bg-red-500/10 border-red-500/20'
      : 'text-foreground/80 hover:bg-secondary/60 border-primary/15';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-card typo-label border ${toneCls} transition-colors`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
