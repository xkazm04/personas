import { AlertTriangle, Bell, ChevronDown, ClipboardList, Sparkles, XOctagon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { ATTENTION_KINDS, type AttentionCounts, type AttentionKind } from './attentionKinds';
import { useAttentionCounts } from './useAttentionCounts';

/**
 * Level 1 of the chat panel's alert structure: one compact row of
 * counts, one chip per attention kind that currently has anything in it.
 *
 * Clicking a chip reveals that kind's cards below (level 2) and the
 * choice is persisted, so the panel keeps whatever shape the user
 * settled on across reopens and restarts. The bar itself disappears
 * entirely when nothing needs attention — a quiet Athena adds no chrome.
 */

const CHIP_META: Record<
  AttentionKind,
  { icon: typeof Bell; idle: string; active: string; dot: string }
> = {
  // Something is genuinely waiting on the user (a parked CLI session, a
  // decision Athena is holding) — the only kind loud enough to tint at rest.
  blocked: {
    icon: XOctagon,
    idle: 'border-status-error/30 bg-status-error/10 text-status-error hover:bg-status-error/20',
    active: 'border-status-error/40 bg-status-error/20 text-status-error',
    dot: 'bg-status-error/10',
  },
  errors: {
    icon: AlertTriangle,
    idle: 'border-status-error/25 bg-status-error/10/[0.07] text-status-error hover:bg-status-error/15',
    active: 'border-status-error/40 bg-status-error/20 text-status-error',
    dot: 'bg-status-error/10',
  },
  warnings: {
    icon: AlertTriangle,
    idle: 'border-status-warning/25 bg-status-warning/10/[0.07] text-status-warning hover:bg-status-warning/15',
    active: 'border-status-warning/40 bg-status-warning/20 text-status-warning',
    dot: 'bg-status-warning/10',
  },
  nudges: {
    icon: Bell,
    idle: 'border-primary/25 bg-primary/[0.07] text-primary hover:bg-primary/15',
    active: 'border-primary/40 bg-primary/20 text-primary',
    dot: 'bg-primary',
  },
  assignments: {
    icon: ClipboardList,
    idle: 'border-status-info/25 bg-status-info/10/[0.07] text-status-info hover:bg-status-info/15',
    active: 'border-status-info/40 bg-status-info/20 text-status-info',
    dot: 'bg-status-info/10',
  },
  activity: {
    icon: Sparkles,
    idle: 'border-foreground/15 bg-foreground/[0.04] text-ink-2 hover:bg-foreground/10',
    active: 'border-foreground/25 bg-foreground/10 text-foreground',
    dot: 'bg-foreground/50',
  },
};

export function AttentionBar() {
  const { t } = useTranslation();
  const c = t.athena;
  const counts = useAttentionCounts();
  const expanded = useSystemStore((s) => s.athenaAlertsExpanded);
  const toggle = useSystemStore((s) => s.toggleAthenaAlertKind);

  const label: Record<AttentionKind, string> = {
    blocked: c.attention_blocked,
    errors: c.attention_errors,
    warnings: c.attention_warnings,
    nudges: c.attention_nudges,
    assignments: c.attention_assignments,
    activity: c.attention_activity,
  };
  const hint: Record<AttentionKind, string> = {
    blocked: c.attention_blocked_hint,
    errors: c.attention_errors_hint,
    warnings: c.attention_warnings_hint,
    nudges: c.attention_nudges_hint,
    assignments: c.attention_assignments_hint,
    activity: c.attention_activity_hint,
  };

  const live = ATTENTION_KINDS.filter((k) => counts[k] > 0);
  if (live.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-foreground/10 bg-foreground/[0.02]"
      data-testid="companion-attention-bar"
      role="group"
      aria-label={c.attention_label}
    >
      <span className="typo-caption text-foreground mr-0.5">{c.attention_label}</span>
      {live.map((kind) => {
        const meta = CHIP_META[kind];
        const Icon = meta.icon;
        const isOpen = expanded.includes(kind);
        return (
          <Tooltip key={kind} content={hint[kind]}>
            <button
              type="button"
              onClick={() => toggle(kind)}
              aria-expanded={isOpen}
              aria-label={`${label[kind]} (${counts[kind]})`}
              data-testid={`companion-attention-${kind}`}
              className={`inline-flex items-center gap-1.5 rounded-interactive border px-2 py-0.5 typo-caption transition-colors focus-ring ${
                isOpen ? meta.active : meta.idle
              }`}
            >
              <Icon className="w-3 h-3 flex-shrink-0" aria-hidden />
              <span className="tabular-nums">{counts[kind]}</span>
              <span className="truncate max-w-28">{label[kind]}</span>
              <ChevronDown
                className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                aria-hidden
              />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/** Exported for tests + the panel's section gating. */
export function isKindExpanded(expanded: AttentionKind[], kind: AttentionKind): boolean {
  return expanded.includes(kind);
}

export type { AttentionCounts };
