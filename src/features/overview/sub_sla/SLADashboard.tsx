import { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle, Clock, Loader2, Wrench } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { getSlaDashboard } from '@/api/overview/sla';
import type { SlaDashboardData } from '@/api/overview/sla';
import { formatPercent, formatDuration, slaColor } from './slaFormatters';
import { SlaCard, PersonaRow, DailyTrendChart } from './SlaSubComponents';

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

export default function SLADashboard() {
  const [data, setData] = useState<SlaDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<number>(30);
  const [expandedPersona, setExpandedPersona] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getSlaDashboard(days)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const togglePersona = (id: string) => {
    setExpandedPersona((prev) => (prev === id ? null : id));
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<Shield className="w-5 h-5 text-emerald-400" />}
        iconColor="emerald"
        title="Agent Reliability SLA"
        subtitle="Uptime, failure rates, and healing metrics across your agent fleet"
        actions={
          <div className="flex items-center gap-1.5">
            {DAY_OPTIONS.map((d) => (
              <Button
                key={d}
                variant={days === d ? 'secondary' : 'ghost'}
                size="xs"
                onClick={() => setDays(d)}
                className={days === d ? 'bg-primary/15 text-primary border border-primary/30' : ''}
              >
                {d}d
              </Button>
            ))}
          </div>
        }
      />

      <ContentBody centered>
        {loading && !data ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground/70">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading SLA data...
          </div>
        ) : !data ? (
          <div className="text-center py-20 text-muted-foreground/70">
            No execution data available.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Global SLA cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SlaCard
                label="Success Rate"
                value={formatPercent(data.global.success_rate)}
                sub={`${data.global.successful}/${data.global.total_executions} executions`}
                color={slaColor(data.global.success_rate)}
                icon={<Shield className="w-4 h-4" />}
              />
              <SlaCard
                label="Avg Latency"
                value={formatDuration(data.global.avg_duration_ms)}
                sub={`${data.global.active_persona_count} active agents`}
                color="blue"
                icon={<Clock className="w-4 h-4" />}
              />
              <SlaCard
                label="Open Issues"
                value={String(data.healing_summary.open_issues)}
                sub={`${data.healing_summary.circuit_breaker_count} circuit breakers`}
                color={data.healing_summary.open_issues > 0 ? 'amber' : 'emerald'}
                icon={<AlertTriangle className="w-4 h-4" />}
              />
              <SlaCard
                label="Auto-Healed"
                value={String(data.healing_summary.auto_fixed_count)}
                sub={`${data.healing_summary.knowledge_patterns} known patterns`}
                color="violet"
                icon={<Wrench className="w-4 h-4" />}
              />
            </div>

            {/* Daily trend */}
            {data.daily_trend.length > 0 && (
              <div className="rounded-xl border border-primary/10 bg-card-bg p-5 space-y-3">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Daily Success Rate — {days} Days
                </h2>
                <DailyTrendChart points={data.daily_trend} />
              </div>
            )}

            {/* Per-persona SLA table */}
            <div className="rounded-xl border border-primary/10 bg-card-bg overflow-hidden">
              <div className="px-5 py-3.5 border-b border-primary/10">
                <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
                  Per-Agent Reliability
                </h2>
              </div>

              {data.persona_stats.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground/80">
                  No agents have executed in this period.
                </div>
              ) : (
                <div className="divide-y divide-primary/5">
                  {data.persona_stats.map((ps) => (
                    <PersonaRow
                      key={ps.persona_id}
                      stats={ps}
                      expanded={expandedPersona === ps.persona_id}
                      onToggle={() => togglePersona(ps.persona_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
