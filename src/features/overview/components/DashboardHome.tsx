import { motion } from 'framer-motion';
import { 
  Activity, 
  Zap, 
  ClipboardCheck, 
  TrendingUp, 
  ShieldCheck, 
  LayoutDashboard,
  ArrowUpRight,
  Clock,
  AlertCircle,
  CheckCircle2,
  Brain,
  Cpu,
  ArrowRight
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';
import { useMemo, useEffect } from 'react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// ---------------------------------------------------------------------------
// Mini Components
// ---------------------------------------------------------------------------

function StatCard({ 
  title, 
  value, 
  subValue, 
  icon: Icon, 
  color, 
  onClick 
}: { 
  title: string; 
  value: string | number; 
  subValue?: string; 
  icon: any; 
  color: 'blue' | 'amber' | 'emerald' | 'violet' | 'rose';
  onClick?: () => void;
}) {
  const colors = {
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    emerald: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-500/20',
    rose: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  };

    const bgGradients = {
      blue: 'from-blue-500/5 to-transparent hover:from-blue-500/10',
      amber: 'from-amber-500/5 to-transparent hover:from-amber-500/10',
      emerald: 'from-emerald-500/5 to-transparent hover:from-emerald-500/10',
      violet: 'from-violet-500/5 to-transparent hover:from-violet-500/10',
      rose: 'from-rose-500/5 to-transparent hover:from-rose-500/10',
    };
  
    return (
      <motion.button
        whileHover={{ y: -4, scale: 1.01 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        onClick={onClick}
        className={`relative flex flex-col gap-4 p-5 rounded-2xl border border-primary/10 bg-gradient-to-br ${bgGradients[color]} bg-secondary/20 shadow-sm hover:shadow-md transition-all text-left group overflow-hidden`}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex items-center justify-between w-full relative z-10">
          <div className={`p-2.5 rounded-xl border shadow-inner ${colors[color]}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="w-8 h-8 rounded-full bg-background/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
            <ArrowUpRight className="w-4 h-4 text-foreground/70" />
          </div>
        </div>
        <div className="relative z-10 mt-1">
          <p className="text-[13px] font-semibold text-muted-foreground/80 uppercase tracking-widest">{title}</p>
          <div className="flex items-baseline gap-2 mt-1.5">
            <h3 className="text-3xl font-black tracking-tight text-foreground/90">{value}</h3>
            {subValue && <span className="text-xs font-medium text-muted-foreground/60">{subValue}</span>}
          </div>
        </div>
      </motion.button>
    );}

// ---------------------------------------------------------------------------
// DashboardHome
// ---------------------------------------------------------------------------

export default function DashboardHome() {
  const user = useAuthStore((s) => s.user);
  const personas = usePersonaStore((s) => s.personas);
  const globalExecutions = usePersonaStore((s) => s.globalExecutions);
  const globalExecutionsTotal = usePersonaStore((s) => s.globalExecutionsTotal);
  const pendingReviewCount = usePersonaStore((s) => s.pendingReviewCount);
  const toolUsageOverTime = usePersonaStore((s) => s.toolUsageOverTime);
  const fetchGlobalExecutions = usePersonaStore((s) => s.fetchGlobalExecutions);
  const fetchPendingReviewCount = usePersonaStore((s) => s.fetchPendingReviewCount);
  const fetchToolUsage = usePersonaStore((s) => s.fetchToolUsage);
  const setOverviewTab = usePersonaStore((s) => s.setOverviewTab);

  useEffect(() => {
    fetchGlobalExecutions(true);
    fetchPendingReviewCount();
    fetchToolUsage(14);
  }, [fetchGlobalExecutions, fetchPendingReviewCount, fetchToolUsage]);

  const stats = useMemo(() => {
    const successCount = globalExecutions.filter(e => e.status === 'completed').length;
    const successRate = globalExecutions.length > 0 
      ? Math.round((successCount / globalExecutions.length) * 100) 
      : 0;

    return {
      successRate,
      activeAgents: personas.length,
      recentExecs: globalExecutions.slice(0, 5)
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
      />

      <ContentBody centered>
        <div className="space-y-8 pb-12">
          
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

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard 
              title="Total Executions" 
              value={globalExecutionsTotal} 
              icon={Activity} 
              color="blue"
              onClick={() => setOverviewTab('executions')}
            />
            <StatCard 
              title="Success Rate" 
              value={`${stats.successRate}%`} 
              subValue="Last 50 runs"
              icon={ShieldCheck} 
              color="emerald"
              onClick={() => setOverviewTab('observability')}
            />
            <StatCard 
              title="Pending Reviews" 
              value={pendingReviewCount} 
              icon={ClipboardCheck} 
              color="amber"
              onClick={() => setOverviewTab('manual-review')}
            />
            <StatCard 
              title="Active Agents" 
              value={stats.activeAgents} 
              icon={Cpu} 
              color="violet"
              onClick={() => setOverviewTab('realtime')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
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
                    <div key={exec.id} className="p-4 sm:p-5 flex items-center gap-4 hover:bg-white/[0.03] transition-colors group cursor-pointer" onClick={() => setOverviewTab('executions')}>
                      <div className={`w-11 h-11 rounded-xl flex items-center justify-center border shadow-inner ${
                        exec.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                        exec.status === 'failed' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                        'bg-blue-500/10 border-blue-500/20 text-blue-400'
                      }`}>
                        {exec.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> :
                         exec.status === 'failed' ? <AlertCircle className="w-5 h-5" /> :
                         <Activity className="w-5 h-5 animate-pulse" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-foreground/90 truncate">{exec.persona_name || 'Agent'}</span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-black/20 text-muted-foreground border border-primary/5 font-mono tracking-wider">
                            {exec.id.slice(0, 8)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground/80 truncate">
                          {exec.input_data?.slice(0, 100) || 'No input data provided'}
                        </p>
                      </div>
                      <div className="text-right hidden sm:flex flex-col items-end justify-center">
                        <p className="text-xs font-semibold text-foreground/80">
                          {new Date(exec.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5 font-medium tracking-wide">
                          {new Date(exec.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transform -translate-x-2 group-hover:translate-x-0 transition-all sm:hidden" />
                    </div>
                  ))
                ) : (
                  <div className="p-16 text-center flex flex-col items-center justify-center">
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
                  <h3 className="text-[13px] font-bold uppercase tracking-widest text-foreground/80 flex items-center gap-2">
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

              {/* Quick Actions / Tips */}
              <div className="rounded-2xl bg-gradient-to-br from-indigo-500/15 via-violet-500/10 to-transparent border border-indigo-500/20 p-6 relative overflow-hidden group shadow-sm hover:shadow-md transition-shadow">
                <div className="absolute -right-10 -top-10 w-40 h-40 bg-indigo-500/20 blur-[50px] rounded-full group-hover:bg-indigo-500/30 transition-colors" />
                <div className="absolute -left-10 -bottom-10 w-40 h-40 bg-violet-500/10 blur-[50px] rounded-full" />
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 shadow-inner">
                      <Brain className="w-4 h-4 text-indigo-300" />
                    </div>
                    <h3 className="text-xs font-black uppercase tracking-widest text-indigo-300">Pro Tip</h3>
                  </div>
                  <p className="text-sm text-foreground/90 leading-relaxed font-medium">
                    Automate agent execution based on file changes or webhook payloads.
                  </p>
                  <button 
                    onClick={() => usePersonaStore.getState().setSidebarSection('events')}
                    className="mt-5 w-full py-2.5 bg-indigo-500/20 hover:bg-indigo-500/30 active:scale-[0.98] text-indigo-200 border border-indigo-500/30 rounded-xl text-xs font-bold transition-all shadow-sm flex justify-center items-center gap-2"
                  >
                    Configure Triggers <ArrowRight className="w-3.5 h-3.5 opacity-70" />
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>
      </ContentBody>
    </ContentBox>
  );
}
