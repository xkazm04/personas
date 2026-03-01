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
  Brain,
  Cpu,
  ArrowRight,
  Mail,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useMemo, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

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
  const toolUsageOverTime = usePersonaStore((s) => s.toolUsageOverTime);
  const fetchGlobalExecutions = usePersonaStore((s) => s.fetchGlobalExecutions);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchUnreadMessageCount = usePersonaStore((s) => s.fetchUnreadMessageCount);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);

  useEffect(() => {
    fetchGlobalExecutions(true);
    fetchPendingReviewCount();
    fetchUnreadMessageCount();
    fetchToolUsage(14);
  }, [fetchGlobalExecutions, fetchPendingReviewCount, fetchUnreadMessageCount, fetchToolUsage]);

  const stats = useMemo(() => {
    const successCount = globalExecutions.filter(e => e.status === 'completed').length;
    const successRate = globalExecutions.length > 0
      ? Math.round((successCount / globalExecutions.length) * 100)
      : 0;

    return {
      successRate,
      activeAgents: personas.length,
      recentExecs: globalExecutions.slice(0, 12)
    };
  }, [globalExecutions, personas]);

  // Pivot tool usage into simple sparkline data
  const activityData = useMemo(() => {
    if (!toolUsageOverTime.length) {
      return Array.from({ length: 14 }).map(() => ({
        val: 10 + Math.random() * 20
      }));
    }

    const dayMap = new Map<string, number>();
    for (const row of toolUsageOverTime) {
      dayMap.set(row.date, (dayMap.get(row.date) || 0) + row.invocations);
    }

    return Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([_, val]) => ({ val }));
  }, [toolUsageOverTime]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const displayName = user?.display_name || user?.email?.split('@')[0] || 'Operator';

  // Header-level stat badges
  const headerBadges = (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button
        onClick={() => setOverviewTab('messages')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors hover:bg-blue-500/15 bg-blue-500/10 border-blue-500/20 text-blue-300"
      >
        <Mail className="w-3 h-3" />
        {unreadMessageCount}
      </button>
      <button
        onClick={() => setOverviewTab('manual-review')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors hover:bg-amber-500/15 bg-amber-500/10 border-amber-500/20 text-amber-300"
      >
        <ClipboardCheck className="w-3 h-3" />
        {pendingReviewCount}
      </button>
      <button
        onClick={() => setOverviewTab('executions')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors hover:bg-emerald-500/15 bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
      >
        <Activity className="w-3 h-3" />
        {globalExecutionsTotal}
      </button>
      <button
        onClick={() => setOverviewTab('observability')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors hover:bg-violet-500/15 bg-violet-500/10 border-violet-500/20 text-violet-300"
      >
        <ShieldCheck className="w-3 h-3" />
        {stats.successRate}%
      </button>
      <button
        onClick={() => setOverviewTab('realtime')}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors hover:bg-rose-500/15 bg-rose-500/10 border-rose-500/20 text-rose-300"
      >
        <Cpu className="w-3 h-3" />
        {stats.activeAgents}
      </button>
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
        <div className="space-y-5 pb-6">

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

            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {personas.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="w-8 h-8 rounded-full border-2 border-background bg-secondary flex items-center justify-center text-xs overflow-hidden"
                    title={p.name}
                  >
                    {p.icon ? (
                      <span className="text-lg">{p.icon}</span>
                    ) : (
                      <Brain className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                ))}
                {personas.length > 5 && (
                  <div className="w-8 h-8 rounded-full border-2 border-background bg-secondary flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                    +{personas.length - 5}
                  </div>
                )}
              </div>
              <div className="h-8 w-px bg-primary/10 mx-1" />
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">System Load</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div key={i} className={`w-1 h-3 rounded-full ${i <= 2 ? 'bg-emerald-500/60' : 'bg-primary/10'}`} />
                    ))}
                  </div>
                  <span className="text-xs font-mono text-emerald-400">Normal</span>
                </div>
              </div>
            </div>
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
                  className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                >
                  View All <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="rounded-2xl border border-primary/10 bg-secondary/20 shadow-sm overflow-hidden divide-y divide-primary/5">
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
                      <span className={`text-[11px] px-1.5 py-0.5 rounded-md font-medium flex-shrink-0 ${
                        exec.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' :
                        exec.status === 'failed' ? 'bg-rose-500/10 text-rose-400' :
                        'bg-blue-500/10 text-blue-400'
                      }`}>
                        {exec.status}
                      </span>
                      <span className="flex-1" />
                      <span className="text-[11px] text-muted-foreground/60 flex-shrink-0 hidden sm:inline">
                        {new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-8 text-center flex flex-col items-center justify-center">
                    <div className="w-14 h-14 rounded-2xl bg-secondary/50 border border-primary/10 shadow-inner flex items-center justify-center mb-4 opacity-70">
                      <Zap className="w-6 h-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium text-foreground/70">No recent activity found.</p>
                    <p className="text-xs text-muted-foreground mt-1">Run an agent to see activity here.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Side Column */}
            <div className="space-y-6">

              {/* Activity Trend */}
              <div className="rounded-2xl border border-primary/10 bg-secondary/20 shadow-sm p-5 space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 blur-3xl rounded-full pointer-events-none" />
                <div className="flex items-center justify-between relative z-10">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-foreground/80 flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                      <TrendingUp className="w-3.5 h-3.5" />
                    </div>
                    Usage Trend
                  </h3>
                  <span className="text-[11px] font-black tracking-wide text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20 shadow-sm">
                    +12%
                  </span>
                </div>

                <div className="h-28 w-full relative z-10">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={activityData}>
                      <defs>
                        <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.4}/>
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area
                        type="monotone"
                        dataKey="val"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorVal)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                <div className="pt-3 border-t border-primary/5 relative z-10">
                  <div className="flex justify-between text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    <span>14 Days Ago</span>
                    <span>Today</span>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </ContentBody>
    </ContentBox>
  );
}
