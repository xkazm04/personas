import { ExternalLink } from 'lucide-react';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import { ScoreRadar } from './ScoreRadar';

interface DetailPanelProps {
  entry: LeaderboardEntry | null;
  onNavigateToAgent: (personaId: string) => void;
}

export function DetailPanel({ entry, onNavigateToAgent }: DetailPanelProps) {
  if (!entry) {
    return (
      <div className="p-4 rounded-modal border border-primary/[0.08] bg-secondary/[0.03]">
        <p className="typo-caption text-foreground/60 text-center">No agent selected</p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-modal border border-primary/[0.08] bg-secondary/[0.03]">
      <h4 className="typo-caption font-medium text-foreground mb-3 text-center">
        {entry.personaName}
      </h4>
      <div className="flex justify-center">
        <ScoreRadar entries={[entry]} size={200} />
      </div>
      <div className="mt-3 space-y-1.5">
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
        className="mt-3 w-full flex items-center justify-center gap-1.5 typo-caption text-primary/70 hover:text-primary transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
        Open Agent
      </button>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between typo-caption">
      <span className="text-foreground">{label}</span>
      <span className="text-foreground font-medium">{value}</span>
    </div>
  );
}
