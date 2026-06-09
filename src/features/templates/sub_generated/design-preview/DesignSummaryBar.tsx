import { Plug, Wrench, Zap, MessageSquare, CheckCircle, AlertTriangle, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { FEASIBILITY_COLORS } from '@/lib/utils/designTokens';
import type { AgentIR, DesignTestResult } from '@/lib/types/designTypes';

export type DesignSection = 'connectors' | 'events' | 'messages';

interface DesignSummaryBarProps {
  result: AgentIR;
  channelCount: number;
  subscriptionCount: number;
  feasibility?: DesignTestResult | null;
  /** When provided, pills become buttons that scroll their section into view. */
  onJump?: (target: DesignSection) => void;
}

const FEAS_ICON: Record<string, LucideIcon> = {
  ready: CheckCircle,
  partial: AlertTriangle,
  blocked: XCircle,
};

/**
 * At-a-glance shape of a generated design: count pills for connectors / tools /
 * events / channels plus the feasibility verdict, so a reviewer grasps what the
 * design contains before scrolling the full section list. Hides any zero count
 * and renders nothing when there's nothing to summarise.
 */
export function DesignSummaryBar({ result, channelCount, subscriptionCount, feasibility, onJump }: DesignSummaryBarProps) {
  const { t } = useTranslation();
  const s = t.templates.design.summary;

  const allPills: { icon: LucideIcon; label: string; count: number; color: string; target: DesignSection }[] = [
    { icon: Plug, label: s.connectors, count: result.suggested_connectors?.length ?? 0, color: 'text-sky-400', target: 'connectors' },
    { icon: Wrench, label: s.tools, count: result.suggested_tools?.length ?? 0, color: 'text-violet-400', target: 'connectors' },
    { icon: Zap, label: s.events, count: (result.suggested_triggers?.length ?? 0) + subscriptionCount, color: 'text-amber-400', target: 'events' },
    { icon: MessageSquare, label: s.channels, count: channelCount, color: 'text-emerald-400', target: 'messages' },
  ];
  const pills = allPills.filter((p) => p.count > 0);

  if (pills.length === 0 && !feasibility) return null;

  const feasKey = feasibility?.overall_feasibility ?? 'partial';
  const FeasIcon = FEAS_ICON[feasKey] ?? AlertTriangle;
  const feasColors = FEASIBILITY_COLORS[feasKey] ?? FEASIBILITY_COLORS.partial!;
  const feasLabel = feasKey === 'ready' ? s.ready : feasKey === 'blocked' ? s.blocked : s.partial;

  const base = 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input bg-secondary/40 border border-primary/10';

  return (
    <div className="sticky top-0 z-10 bg-background flex flex-wrap items-center gap-2 pt-2 pb-3 border-b border-primary/10">
      {pills.map((p) => {
        const inner = (
          <>
            <p.icon className={`w-3.5 h-3.5 ${p.color}`} />
            <span className="typo-body font-medium text-foreground">{p.count}</span>
            <span className="typo-caption text-foreground">{p.label}</span>
          </>
        );
        return onJump ? (
          <button
            key={p.label}
            type="button"
            onClick={() => onJump(p.target)}
            className={`${base} hover:bg-secondary/70 hover:border-primary/20 transition-colors cursor-pointer`}
          >
            {inner}
          </button>
        ) : (
          <span key={p.label} className={base}>
            {inner}
          </span>
        );
      })}
      {feasibility && (
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-input ml-auto ${feasColors.bg} border ${feasColors.border}`}>
          <FeasIcon className={`w-3.5 h-3.5 ${feasColors.text}`} />
          <span className={`typo-caption font-medium ${feasColors.text}`}>{feasLabel}</span>
        </span>
      )}
    </div>
  );
}
