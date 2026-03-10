import { motion } from 'framer-motion';
import { Activity, ClipboardCheck, ShieldCheck, Cpu, Mail } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import type { OverviewTab } from '@/lib/types/types';

interface DashboardHeaderBadgesProps {
  unreadMessageCount: number;
  pendingReviewCount: number;
  globalExecutionsTotal: number;
  successRate: number;
  activeAgents: number;
  setOverviewTab: (tab: OverviewTab) => void;
}

export function DashboardHeaderBadges({
  unreadMessageCount,
  pendingReviewCount,
  globalExecutionsTotal,
  successRate,
  activeAgents,
  setOverviewTab,
}: DashboardHeaderBadgesProps) {
  return (
    <div className={`flex items-center gap-2 flex-shrink-0 ${IS_MOBILE ? 'flex-wrap' : ''}`}>
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => setOverviewTab('messages')}
        title={`${unreadMessageCount} unread messages`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-blue-500/15 bg-blue-500/10 border-blue-500/20 text-blue-300"
      >
        <Mail className="w-3 h-3" />
        {unreadMessageCount}
        <span className="text-blue-300/60 font-medium">Msgs</span>
      </motion.button>
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => setOverviewTab('manual-review')}
        title={`${pendingReviewCount} pending reviews`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-amber-500/15 bg-amber-500/10 border-amber-500/20 text-amber-300"
      >
        <ClipboardCheck className="w-3 h-3" />
        {pendingReviewCount}
        <span className="text-amber-300/60 font-medium">Reviews</span>
      </motion.button>
      <div className="border-l border-primary/10 pl-2 ml-1 flex items-center gap-2">
        <motion.button
          whileHover={{ scale: 1.05 }}
          onClick={() => setOverviewTab('executions')}
          title={`${globalExecutionsTotal} total executions`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-emerald-500/15 bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
        >
          <Activity className="w-3 h-3" />
          {globalExecutionsTotal}
          <span className="text-emerald-300/60 font-medium">Runs</span>
        </motion.button>
        <span
          title={`${successRate}% success rate`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-violet-500/10 border-violet-500/20 text-violet-300"
        >
          <ShieldCheck className="w-3 h-3" />
          {successRate}%
          <span className="text-violet-300/60 font-medium">Success</span>
        </span>
        <span
          title={`${activeAgents} active agents`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border bg-rose-500/10 border-rose-500/20 text-rose-300"
        >
          <Cpu className="w-3 h-3" />
          {activeAgents}
          <span className="text-rose-300/60 font-medium">Agents</span>
        </span>
      </div>
    </div>
  );
}
