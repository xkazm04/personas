import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Rocket, RefreshCw, WifiOff } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://pvfwxilvzjzzjhdcpucu.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2Znd4aWx2emp6empoZGNwdWN1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg1NTg5ODQsImV4cCI6MjA2NDEzNDk4NH0.2gk82sDq9vDaTqM3Tprxohzw_ZDSwyRcHdBO6_AFwk8';

interface RoadmapItem {
  id: string;
  name: string;
  description: string;
  status: 'in_progress' | 'next' | 'planned' | 'completed';
  priority: 'now' | 'next' | 'later';
  sort_order: number;
}

const statusConfig: Record<RoadmapItem['status'], { label: string; dotColor: string; badgeBg: string; badgeText: string }> = {
  in_progress: {
    label: 'In Progress',
    dotColor: 'bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.6)]',
    badgeBg: 'bg-cyan-500/10 border-cyan-500/20',
    badgeText: 'text-cyan-400',
  },
  next: {
    label: 'Next',
    dotColor: 'bg-purple-400/60',
    badgeBg: 'bg-purple-500/10 border-purple-500/20',
    badgeText: 'text-purple-400',
  },
  planned: {
    label: 'Planned',
    dotColor: 'bg-muted-foreground/30',
    badgeBg: 'bg-secondary/50 border-primary/10',
    badgeText: 'text-muted-foreground/70',
  },
  completed: {
    label: 'Completed',
    dotColor: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
    badgeBg: 'bg-emerald-500/10 border-emerald-500/20',
    badgeText: 'text-emerald-400',
  },
};

const priorityConfig: Record<RoadmapItem['priority'], { label: string; className: string }> = {
  now: { label: 'Now', className: 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400' },
  next: { label: 'Next', className: 'bg-purple-500/10 border-purple-500/20 text-purple-400' },
  later: { label: 'Later', className: 'bg-secondary/50 border-primary/10 text-muted-foreground/70' },
};

async function fetchRoadmap(): Promise<RoadmapItem[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/roadmap_items?select=id,name,description,status,priority,sort_order&order=sort_order.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function EmptyState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6 py-12">
      <img
        src="/illustrations/roadmap-empty-state-nobg.png"
        alt="Roadmap"
        className="w-40 h-40 object-contain opacity-60"
      />
      <div className="text-center space-y-2 max-w-sm">
        <div className="flex items-center justify-center gap-2 text-muted-foreground/60">
          <WifiOff className="w-4 h-4" />
          <h3 className="typo-heading text-foreground/70">Roadmap unavailable</h3>
        </div>
        <p className="typo-body text-muted-foreground/50">
          Could not load the product roadmap. Check your connection and try again.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    </div>
  );
}

function RoadmapCard({ item, index, total }: { item: RoadmapItem; index: number; total: number }) {
  const status = statusConfig[item.status];
  const priority = priorityConfig[item.priority];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex gap-5"
    >
      {/* Timeline spine */}
      <div className="relative flex flex-col items-center pt-1.5">
        <div className={`relative z-10 h-3 w-3 rounded-full ${status.dotColor} ring-[3px] ring-[var(--background)]`}>
          {item.status === 'in_progress' && (
            <div className="absolute inset-0 rounded-full bg-cyan-400/30 animate-ping" />
          )}
        </div>
        {index < total - 1 && (
          <div className={`mt-1 w-px flex-1 ${item.status === 'in_progress' ? 'bg-cyan-500/25' : 'bg-primary/8'}`} />
        )}
      </div>

      {/* Card */}
      <div className="flex-1 pb-6">
        <div className="rounded-xl border border-primary/6 bg-gradient-to-br from-primary/[0.02] to-transparent p-4 transition-all duration-200 hover:border-primary/12 hover:bg-primary/[0.03]">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/8 ring-1 ring-primary/10 font-mono text-xs font-bold text-muted-foreground/60 shrink-0">
              {item.sort_order}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="typo-heading text-foreground/90 text-[14px]">{item.name}</h3>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${status.badgeBg} ${status.badgeText}`}>
                  {status.label}
                </span>
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium tracking-wider uppercase ${priority.className}`}>
                  {priority.label}
                </span>
              </div>
              <p className="typo-body text-muted-foreground/60 mt-1 text-[12px] leading-relaxed">{item.description}</p>
            </div>
          </div>
        </div>
        {item.status === 'in_progress' && (
          <div className="pointer-events-none absolute inset-y-0 right-0 left-8 z-10 rounded-xl overflow-hidden">
            <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
              <rect
                x="0.5" y="0.5"
                width="calc(100% - 1px)" height="calc(100% - 25px)"
                rx="12" ry="12"
                fill="none"
                stroke="rgba(6,182,212,0.15)"
                strokeWidth="1"
                strokeDasharray="6 6"
                style={{ animation: 'dash-flow 2s linear infinite' }}
              />
            </svg>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default function HomeRoadmap() {
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () => {
    setLoading(true);
    setError(false);
    fetchRoadmap()
      .then(setItems)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
  const nextCount = items.filter((i) => i.status === 'next').length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
      {/* Background mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[400px] h-[400px] bg-cyan-500/4 blur-[120px] rounded-full" />
        <div className="absolute bottom-[0%] right-[10%] w-[300px] h-[300px] bg-purple-500/3 blur-[100px] rounded-full" />
      </div>

      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="w-full max-w-2xl mx-auto px-6 py-6 space-y-6">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center gap-3 mb-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/15 ring-1 ring-cyan-500/20">
                <Rocket className="w-4 h-4 text-cyan-400" />
              </div>
              <h1 className="text-lg font-semibold text-foreground/90">Product Roadmap</h1>
            </div>
            <p className="typo-body text-muted-foreground/50 ml-11">
              What we're building now and what comes next.
            </p>
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          )}

          {/* Error / empty state */}
          {!loading && error && <EmptyState onRetry={load} />}

          {/* Content */}
          {!loading && !error && items.length > 0 && (
            <>
              {/* Summary pills */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="flex flex-wrap gap-3"
              >
                <div className="flex items-center gap-2 rounded-full border border-cyan-500/15 bg-cyan-500/5 px-3 py-1.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.6)]" />
                  <span className="text-[11px] font-mono font-medium text-cyan-400/80">{inProgressCount} In Progress</span>
                </div>
                {nextCount > 0 && (
                  <div className="flex items-center gap-2 rounded-full border border-purple-500/15 bg-purple-500/5 px-3 py-1.5">
                    <div className="h-1.5 w-1.5 rounded-full bg-purple-400/60" />
                    <span className="text-[11px] font-mono font-medium text-purple-400/70">{nextCount} Next</span>
                  </div>
                )}
              </motion.div>

              {/* Timeline */}
              <div className="pt-2">
                {items.map((item, i) => (
                  <RoadmapCard key={item.id} item={item} index={i} total={items.length} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* CSS keyframe for dashed border animation */}
      <style>{`
        @keyframes dash-flow {
          to { stroke-dashoffset: -24; }
        }
      `}</style>
    </div>
  );
}
