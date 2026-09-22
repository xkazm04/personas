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
    idle: 'border-rose-500/30 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20',
    active: 'border-rose-500/40 bg-rose-500/20 text-rose-300',
    dot: 'bg-rose-400',
  },
  errors: {
    icon: AlertTriangle,
    idle: 'border-rose-500/25 bg-rose-500/[0.07] text-rose-400 hover:bg-rose-500/15',
    active: 'border-rose-500/40 bg-rose-500/20 text-rose-300',
    dot: 'bg-rose-400',
  },
  warnings: {
    icon: AlertTriangle,
    idle: 'border-amber-500/25 bg-amber-500/[0.07] text-amber-400 hover:bg-amber-500/15',
    active: 'border-amber-500/40 bg-amber-500/20 text-amber-300',
    dot: 'bg-amber-400',
  },
  nudges: {
    icon: Bell,
    idle: 'border-primary/25 bg-primary/[0.07] text-primary hover:bg-primary/15',
    active: 'border-primary/40 bg-primary/20 text-primary',
    dot: 'bg-primary',
  },
  assignments: {
    icon: ClipboardList,
    idle: 'border-sky-500/25 bg-sky-500/[0.07] text-sky-400 hover:bg-sky-500/15',
    active: 'border-sky-500/40 bg-sky-500/20 text-sky-300',
    dot: 'bg-sky-400',
  },
  activity: {
    icon: Sparkles,
    idle: 'border-foreground/15 bg-foreground/[0.04] text-foreground/70 hover:bg-foreground/10',
    active: 'border-foreground/25 bg-foreground/10 text-foreground',
    dot: 'bg-foreground/50',
  },
};

export function AttentionBar() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const counts = useAttentionCounts();
  const expanded = useSystemStore((s) => s.companionAlertsExpanded);
  const toggle = useSystemStore((s) => s.toggleCompanionAlertKind);

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
              className={`inline-flex items-center gap-1.5 rounded-interactive border px-2 py-0.5 typo-caption font-medium transition-colors focus-ring ${
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
