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
 * Tiny rollup chip rendered below an assistant bubble whenever Athena's
 * reply dispatched any side-effects this turn: pending approvals, direct
 * navigations, lab-tab opens, dashboard / cockpit auto-fires, inline
 * chat-cards, or a `continue_autonomously` request. Total-zero turns
 * render nothing — most chat turns are pure prose.
 *
 * Source: backend's `companion://turn-summary` event, emitted once per
 * turn after the dispatcher block.
 */
export function TurnSummaryChip({ summary }: { summary: StoredTurnSummary }) {
  const { t } = useTranslation();

  const total =
    summary.approvals +
    summary.navigations +
    summary.labOpens +
    summary.dashboards +
    summary.cockpits +
    summary.chatCards;

  if (total === 0 && !summary.continuation) return null;

  const parts: { icon: typeof Bot; label: string; key: string }[] = [];

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
    });
  }
  if (summary.chatCards > 0) {
    parts.push({
      icon: Sparkles,
      key: 'card',
      label: countLabel(t.plugins.companion.turn_summary_card, summary.chatCards),
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
        return (
          <span key={p.key} className="inline-flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="text-foreground">
                ·
              </span>
            )}
            <Icon className="w-3 h-3" />
            <span>{p.label}</span>
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
