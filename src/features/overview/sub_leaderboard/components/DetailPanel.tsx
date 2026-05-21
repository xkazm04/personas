import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ExternalLink } from 'lucide-react';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import { ScoreRadar } from './ScoreRadar';
import { DebtText } from '@/i18n/DebtText';


interface DetailPanelProps {
  entry: LeaderboardEntry | null;
  onNavigateToAgent: (personaId: string) => void;
}

export function DetailPanel({ entry, onNavigateToAgent }: DetailPanelProps) {
  const reduce = useReducedMotion();

  if (!entry) {
    return (
      <div className="p-4 rounded-modal border border-primary/[0.08] bg-secondary/[0.03]">
        <p className="typo-body text-foreground text-center"><DebtText k="auto_no_agent_selected_fa58d163" /></p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-modal border border-primary/[0.08] bg-secondary/[0.03] overflow-hidden">
      <AnimatePresence mode="wait">
        <motion.div
          key={entry.personaId}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <h4 className="typo-heading font-semibold text-foreground mb-3 text-center truncate">
            {entry.personaName}
          </h4>
          <div className="flex justify-center">
            <ScoreRadar entries={[entry]} size={200} />
          </div>
          <div className="mt-4 space-y-2">
            <StatRow label="Total runs" value={String(entry.totalExecutions)} />
            <StatRow label="Recent (7d)" value={String(entry.recentExecutions)} />
            <StatRow label="Success" value={`${entry.successRate.toFixed(1)}%`} />
            <StatRow
              label="Avg latency"
              value={entry.avgLatencyMs > 0 ? `${(entry.avgLatencyMs / 1000).toFixed(1)}s` : '—'}
            />
            <StatRow
              label="Daily burn"
              value={entry.dailyBurnRate > 0 ? `$${entry.dailyBurnRate.toFixed(3)}` : '—'}
            />
          </div>
          <button
            onClick={() => onNavigateToAgent(entry.personaId)}
            className="mt-4 w-full flex items-center justify-center gap-1.5 typo-caption font-medium text-primary/70 hover:text-primary hover:bg-primary/5 py-1.5 rounded-card transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            <DebtText k="auto_open_agent_e247e3d5" />
          </button>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between typo-body">
      <span className="text-foreground">{label}</span>
      <span className="text-foreground font-semibold tabular-nums">{value}</span>
    </div>
  );
}
