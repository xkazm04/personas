import {
  ArrowRight,
  Bot,
  CheckCircle2,
  LayoutDashboard,
  LayoutGrid,
  RefreshCcw,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { StoredTurnSummary } from './companionStore';

/**
 * Targets a turn-summary chip part can jump to. Anything in this union
 * has an in-panel scroll-into-view target (approvals / chatCards) or an
 * app-level navigation target (dashboard / cockpit). Parts without a
 * target (nav, lab, continuation) render as static labels.
 */
export type TurnSummaryJumpTarget =
  | 'approvals'
  | 'chatCards'
  | 'dashboard'
  | 'cockpit';

/**
 * Tiny rollup chip rendered below an assistant bubble whenever Athena's
 * reply dispatched any side-effects this turn: pending approvals, direct
 * navigations, lab-tab opens, dashboard / cockpit auto-fires, inline
 * chat-cards, or a `continue_autonomously` request. Total-zero turns
 * render nothing — most chat turns are pure prose.
 *
 * Source: backend's `companion://turn-summary` event, emitted once per
 * turn after the dispatcher block.
 *
 * Click-through: when `onJump` is provided, the parts that have a
 * meaningful destination become buttons:
 *   - approvals → scroll the panel to the ApprovalCard list
 *   - chatCards → scroll the panel to the InlineChatCard list
 *   - dashboard → navigate to the companion-plugin dashboard tab
 *   - cockpit   → navigate to home → cockpit
 * The remaining parts (nav already happened, lab opens carry no agent
 * id, continuation is informational) stay as captions.
 */
export function TurnSummaryChip({
  summary,
  onJump,
}: {
  summary: StoredTurnSummary;
  onJump?: (target: TurnSummaryJumpTarget) => void;
}) {
  const { t } = useTranslation();

  const total =
    summary.approvals +
    summary.navigations +
    summary.labOpens +
    summary.dashboards +
    summary.cockpits +
    summary.chatCards;

  if (total === 0 && !summary.continuation) return null;

  type Part = {
    icon: typeof Bot;
    label: string;
    key: string;
    target?: TurnSummaryJumpTarget;
  };
  const parts: Part[] = [];

  if (summary.navigations > 0) {
    parts.push({
      icon: ArrowRight,
      key: 'nav',
      label: countLabel(t.plugins.companion.turn_summary_nav, summary.navigations),
    });
  }
  if (summary.approvals > 0) {
    parts.push({
      icon: CheckCircle2,
      key: 'approval',
      label: countLabel(
        t.plugins.companion.turn_summary_approval,
        summary.approvals,
      ),
      target: 'approvals',
    });
  }
  if (summary.labOpens > 0) {
    parts.push({
      icon: Bot,
      key: 'lab',
      label: countLabel(t.plugins.companion.turn_summary_lab, summary.labOpens),
    });
  }
  if (summary.dashboards > 0) {
    parts.push({
      icon: LayoutDashboard,
      key: 'dashboard',
      label: countLabel(
        t.plugins.companion.turn_summary_dashboard,
        summary.dashboards,
      ),
      target: 'dashboard',
    });
  }
  if (summary.cockpits > 0) {
    parts.push({
      icon: LayoutGrid,
      key: 'cockpit',
      label: countLabel(
        t.plugins.companion.turn_summary_cockpit,
        summary.cockpits,
      ),
      target: 'cockpit',
    });
  }
  if (summary.chatCards > 0) {
    parts.push({
      icon: Sparkles,
      key: 'card',
      label: countLabel(t.plugins.companion.turn_summary_card, summary.chatCards),
      target: 'chatCards',
    });
  }
  if (summary.continuation) {
    parts.push({
      icon: RefreshCcw,
      key: 'continuation',
      label: t.plugins.companion.turn_summary_continuation,
    });
  }

  if (parts.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 typo-caption text-foreground pl-2"
      data-testid="companion-turn-summary-chip"
      aria-label={t.plugins.companion.turn_summary_label}
    >
      {parts.map((p, i) => {
        const Icon = p.icon;
        const clickable = !!onJump && !!p.target;
        const content = (
          <>
            <Icon className="w-3 h-3" />
            <span>{p.label}</span>
          </>
        );
        const sep = i > 0 && (
          <span aria-hidden className="text-foreground">
            ·
          </span>
        );
        if (clickable) {
          const tooltip = t.plugins.companion.turn_summary_jump_to.replace(
            '{label}',
            p.label,
          );
          return (
            <span key={p.key} className="inline-flex items-center gap-1">
              {sep}
              <button
                type="button"
                onClick={() => onJump!(p.target!)}
                className="inline-flex items-center gap-1 rounded-interactive hover:bg-foreground/[0.06] hover:text-foreground/90 transition-colors focus-ring px-1 -mx-1 cursor-pointer"
                title={tooltip}
                aria-label={tooltip}
                data-testid={`companion-turn-summary-jump-${p.target}`}
              >
                {content}
              </button>
            </span>
          );
        }
        return (
          <span key={p.key} className="inline-flex items-center gap-1">
            {sep}
            {content}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Reuse the same label for count=1 and count>1 — the existing i18n
 * scheme uses placeholder strings ("nav", "approval × 2") rather than
 * full pluralization. Keeps the chip terse.
 */
function countLabel(base: string, count: number): string {
  return count > 1 ? `${base} × ${count}` : base;
}
