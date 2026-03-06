import { motion } from 'framer-motion';
import {
  Activity,
  Zap,
  ClipboardCheck,
  TrendingUp,
  ShieldCheck,
  LayoutDashboard,
  Clock,
  AlertCircle,
  CheckCircle2,
  Cpu,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useMemo, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/charts/ChartErrorBoundary';
import { PersonaSelect } from '@/features/overview/sub_usage/DashboardFilters';
import { ChartTooltip } from '@/features/overview/sub_usage/charts/ChartTooltip';
import { GRID_STROKE, AXIS_TICK_FILL } from '@/features/overview/sub_usage/charts/chartConstants';
import { resolveMetricPercent, SUCCESS_RATE_IDENTITIES } from '@/features/overview/utils/metricIdentity';
import { useOverviewFilters } from '@/features/overview/components/OverviewFilterContext';
import DeployFirstAutomationCard from '@/features/overview/components/DeployFirstAutomationCard';
import { HealthDigestPanel } from '@/features/agents/health';

// ---------------------------------------------------------------------------
// DashboardHome
// ---------------------------------------------------------------------------

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);
  const personas = usePersonaStore((s) => s.personas);
  const globalExecutions = usePersonaStore((s) => s.globalExecutions);
  const globalExecutionsTotal = usePersonaStore((s) => s.globalExecutionsTotal);
  const pendingReviewCount = usePersonaStore((s) => s.pendingReviewCount);
  const unreadMessageCount = usePersonaStore((s) => s.unreadMessageCount);
  const fetchGlobalExecutions = usePersonaStore((s) => s.fetchGlobalExecutions);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);

  const { selectedPersonaId, setSelectedPersonaId } = useOverviewFilters();
  const executionDashboard = usePersonaStore((s) => s.executionDashboard);
  const fetchExecutionDashboard = usePersonaStore((s) => s.fetchExecutionDashboard);

  const dailyPoints = executionDashboard?.daily_points ?? [];

  useEffect(() => {
    fetchGlobalExecutions(true);
    fetchPendingReviewCount();
    fetchUnreadMessageCount();
    fetchExecutionDashboard(14);
  }, [fetchGlobalExecutions, fetchPendingReviewCount, fetchUnreadMessageCount, fetchExecutionDashboard]);

  const stats = useMemo(() => {
    let execs = globalExecutions;
    if (selectedPersonaId) {
      execs = execs.filter(e => e.persona_id === selectedPersonaId);
    }

    const successCount = execs.filter(e => e.status === 'completed').length;
    const successRate = Math.round(resolveMetricPercent(
      SUCCESS_RATE_IDENTITIES.dashboardRecentExecutions,
      { numerator: successCount, denominator: execs.length },
    ));

    return {
      successRate,
      activeAgents: personas.length,
      recentExecs: execs.slice(0, 12),
    };
  }, [globalExecutions, personas, selectedPersonaId]);

  // Build chart data from execution dashboard daily points
  const chartData = useMemo(() => {
    if (!dailyPoints.length) return [];
    return dailyPoints.map(p => ({
      date: p.date,
      traffic: p.total_executions,
      errors: p.failed,
    }));
  }, [dailyPoints]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Operator';

  // Chart totals for badges
  const chartTotals = useMemo(() => {
    const totalTraffic = chartData.reduce((s, d) => s + d.traffic, 0);
    const totalErrors = chartData.reduce((s, d) => s + d.errors, 0);
    return { totalTraffic, totalErrors };
  }, [chartData]);

  // Header-level stat badges
  const headerBadges = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => setOverviewTab('messages')}
        title={`${unreadMessageCount} unread messages`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-blue-500/15 bg-blue-500/10 border-blue-500/20 text-blue-300"
      >
        <Mail className="w-3 h-3" />
        {unreadMessageCount}
      </motion.button>
      <motion.button
        whileHover={{ scale: 1.05 }}
        onClick={() => setOverviewTab('manual-review')}
        title={`${pendingReviewCount} pending reviews`}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-amber-500/15 bg-amber-500/10 border-amber-500/20 text-amber-300"
      >
        <ClipboardCheck className="w-3 h-3" />
        {pendingReviewCount}
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
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          onClick={() => setOverviewTab('analytics')}
          title={`${stats.successRate}% success rate`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-violet-500/15 bg-violet-500/10 border-violet-500/20 text-violet-300"
        >
          <ShieldCheck className="w-3 h-3" />
          {stats.successRate}%
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.05 }}
          onClick={() => setOverviewTab('realtime')}
          title={`${stats.activeAgents} active agents`}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-sm font-semibold border transition-colors hover:bg-rose-500/15 bg-rose-500/10 border-rose-500/20 text-rose-300"
        >
          <Cpu className="w-3 h-3" />
          {stats.activeAgents}
        </motion.button>
      </div>
    </div>
  );

  return (
    <ContentBox>
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[40%] h-[40%] bg-indigo-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[5%] right-[-5%] w-[30%] h-[30%] bg-violet-500/5 blur-[100px] rounded-full" />
      </div>

      <ContentHeader
        icon={<LayoutDashboard className="w-5 h-5 text-indigo-400" />}
        iconColor="indigo"
        title="Dashboard"
        subtitle="Operational overview and system status"
        actions={headerBadges}
      />

      <ContentBody centered>
        <div className="space-y-6 pb-6">

          {/* Welcome Header */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pt-2">
            <div>
              <motion.h2
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent"
              >
                {greeting}, {displayName}
              </motion.h2>
              <p className="text-muted-foreground/80 mt-1">
                You have <span className="text-primary font-medium">{pendingReviewCount} pending reviews</span> requiring attention.
              </p>
            </div>

            <PersonaSelect
              value={selectedPersonaId}
              onChange={setSelectedPersonaId}
              personas={personas}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Recent Activity */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  Recent Activity
                </h3>
                <button
                  onClick={() => setOverviewTab('executions')}
                  className="text-sm font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                >
                  View All <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden divide-y divide-primary/5">
                {stats.recentExecs.length > 0 ? (
                  stats.recentExecs.map((exec) => (
                    <div key={exec.id} className="px-3 py-1.5 flex items-center gap-2.5 hover:bg-white/[0.03] transition-colors group cursor-pointer" onClick={() => setOverviewTab('executions')}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        exec.status === 'completed' ? 'text-emerald-400' :
                        exec.status === 'failed' ? 'text-rose-400' :
                        'text-blue-400'
                      }`}>
                        {exec.status === 'completed' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                         exec.status === 'failed' ? <AlertCircle className="w-3.5 h-3.5" /> :
                         <Activity className="w-3.5 h-3.5 animate-pulse" />}
                      </div>
                      <span className="text-sm font-medium text-foreground/90 truncate min-w-0">{exec.persona_name || 'Agent'}</span>
                      <span className={`text-sm px-1.5 py-0.5 rounded-lg font-medium flex-shrink-0 ${
                        exec.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        exec.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>
                        {exec.status}
                      </span>
                      <span className="flex-1" />
                      <span className="text-sm text-muted-foreground/60 flex-shrink-0 hidden sm:inline">
                        {new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-xl bg-secondary/50 border border-primary/10 shadow-inner flex items-center justify-center mb-4 opacity-70">
                      <Zap className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground/70">No recent activity found.</p>
                    <p className="text-sm text-muted-foreground mt-1">Run an agent to see activity here.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Side Column — Traffic & Errors Chart */}
            <div className="space-y-6">
              <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-sm p-4 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/5 blur-3xl rounded-full pointer-events-none" />
                <div className="flex items-center justify-between relative z-10">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-foreground/80 flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                    Traffic & Errors
                  </h3>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <span className="text-sm text-muted-foreground/60">{chartTotals.totalTraffic}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-400" />
                      <span className="text-sm text-muted-foreground/60">{chartTotals.totalErrors}</span>
                    </div>
                  </div>
                </div>

                <div className="h-32 w-full relative z-10">
                  {chartData.length > 0 ? (
                    <ChartErrorBoundary>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData}>
                          <defs>
                            <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="errorGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.25} />
                              <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                          <XAxis
                            dataKey="date"
                            tick={{ fill: AXIS_TICK_FILL, fontSize: 9 }}
                            tickFormatter={(v: string) => v.slice(5)}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: AXIS_TICK_FILL, fontSize: 9 }}
                            width={24}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip content={<ChartTooltip />} />
                          <Area
                            type="monotone"
                            dataKey="traffic"
                            name="Traffic"
                            stroke="#06b6d4"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#trafficGrad)"
                          />
                          <Area
                            type="monotone"
                            dataKey="errors"
                            name="Errors"
                            stroke="#f43f5e"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#errorGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </ChartErrorBoundary>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <p className="text-sm text-muted-foreground/50">No execution data yet</p>
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-primary/5 relative z-10">
                  <div className="flex justify-between text-sm font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    <span>14 Days Ago</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>

              {/* Agent Health Digest */}
              <HealthDigestPanel />

              {/* PLG Quick-Start: Deploy First Automation */}
              <DeployFirstAutomationCard />

            </div>
          </div>

        </div>
      </ContentBody>
    </ContentBox>
  );
}
