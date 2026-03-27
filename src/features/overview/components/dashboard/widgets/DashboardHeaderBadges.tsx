import { motion } from 'framer-motion';
import { Activity, ClipboardCheck, ShieldCheck, Cpu, Mail, Bell } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AnimatedCounter } from '@/features/shared/components/display/AnimatedCounter';
import { MetricHelpPopover } from './MetricHelpPopover';
import type { OverviewTab } from '@/lib/types/types';

interface DashboardHeaderBadgesProps {
  unreadMessageCount: number;
  pendingReviewCount: number;
  globalExecutionsTotal: number;
  successRate: number;
  activeAgents: number;
  activeAlertCount: number;
  setOverviewTab: (tab: OverviewTab) => void;
}

export function DashboardHeaderBadges({
  unreadMessageCount,
  pendingReviewCount,
  globalExecutionsTotal,
  successRate,
  activeAgents,
  activeAlertCount,
  setOverviewTab,
}: DashboardHeaderBadgesProps) {
  const { isStarter: isSimple } = useTier();
  const { shouldAnimate } = useMotion();
  const hoverScale = shouldAnimate ? { scale: 1.05 } : {};

  if (isSimple) {
    return (
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          title={`${successRate}% success rate`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading border bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <AnimatedCounter value={successRate} formatFn={(v) => `${Math.round(v)}%`} /> Success
          <MetricHelpPopover metricKey="success" />
        </span>
        <span
          title={`${activeAgents} active agents`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading border bg-violet-500/10 border-violet-500/20 text-violet-400"
        >
          <Cpu className="w-3.5 h-3.5" />
          <AnimatedCounter value={activeAgents} /> Agents
          <MetricHelpPopover metricKey="agents" />
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-2 flex-shrink-0 ${IS_MOBILE ? 'flex-wrap' : ''}`}>
      <motion.button
        whileHover={hoverScale}
        onClick={() => setOverviewTab('messages')}
        title={`${unreadMessageCount} unread messages`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border transition-colors hover:bg-blue-500/15 bg-blue-500/10 border-blue-500/20 text-blue-400"
      >
        <Mail className="w-3 h-3" />
        <AnimatedCounter value={unreadMessageCount} />
        <span className="text-blue-400/70 font-medium">Msgs</span>
        <MetricHelpPopover metricKey="messages" />
      </motion.button>
      <motion.button
        whileHover={hoverScale}
        onClick={() => setOverviewTab('manual-review')}
        title={`${pendingReviewCount} pending reviews`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border transition-colors hover:bg-amber-500/15 bg-amber-500/10 border-amber-500/20 text-amber-400"
      >
        <ClipboardCheck className="w-3 h-3" />
        <AnimatedCounter value={pendingReviewCount} />
        <span className="text-amber-400/70 font-medium">Reviews</span>
        <MetricHelpPopover metricKey="reviews" />
      </motion.button>
      {activeAlertCount > 0 && (
        <motion.button
          whileHover={hoverScale}
          onClick={() => setOverviewTab('health')}
          title={`${activeAlertCount} active alerts`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border transition-colors hover:bg-red-500/15 bg-red-500/10 border-red-500/20 text-red-400"
        >
          <Bell className="w-3 h-3" />
          <AnimatedCounter value={activeAlertCount} />
          <span className="text-red-400/70 font-medium">Alerts</span>
          <MetricHelpPopover metricKey="alerts" />
        </motion.button>
      )}
      <div className="border-l border-primary/10 pl-2 ml-1 flex items-center gap-2">
        <motion.button
          whileHover={hoverScale}
          onClick={() => setOverviewTab('executions')}
          title={`${globalExecutionsTotal} total executions`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border transition-colors hover:bg-emerald-500/15 bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
        >
          <Activity className="w-3 h-3" />
          <AnimatedCounter value={globalExecutionsTotal} formatFn={(v) => Math.round(v).toLocaleString()} />
          <span className="text-emerald-400/70 font-medium">Runs</span>
          <MetricHelpPopover metricKey="runs" />
        </motion.button>
        <span
          title={`${successRate}% success rate`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border bg-violet-500/10 border-violet-500/20 text-violet-400"
        >
          <ShieldCheck className="w-3 h-3" />
          <AnimatedCounter value={successRate} formatFn={(v) => `${Math.round(v)}%`} />
          <span className="text-violet-400/70 font-medium">Success</span>
          <MetricHelpPopover metricKey="success" />
        </span>
        <span
          title={`${activeAgents} active agents`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border bg-rose-500/10 border-rose-500/20 text-rose-400"
        >
          <Cpu className="w-3 h-3" />
          <AnimatedCounter value={activeAgents} />
          <span className="text-rose-400/70 font-medium">Agents</span>
          <MetricHelpPopover metricKey="agents" />
        </span>
      </div>
    </div>
  );
}
