import { Rocket } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

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

/** Hardcoded roadmap items — fetched from Supabase 2026-03-26 and pinned to avoid runtime dependency. */
const ROADMAP_ITEMS: RoadmapItem[] = [
  { id: '1', name: 'Dev Mode', description: 'Development mode tooling, debugging, and hot-reload capabilities for rapid agent iteration.', status: 'in_progress', priority: 'now', sort_order: 1 },
  { id: '2', name: 'Cloud Integration', description: 'Connect desktop app to cloud orchestrator for 24/7 agent execution with WebSocket streaming.', status: 'in_progress', priority: 'now', sort_order: 2 },
  { id: '3', name: 'Web App', description: 'Marketing site, auth portal, subscription management, and cloud dashboard.', status: 'in_progress', priority: 'now', sort_order: 3 },
  { id: '4', name: 'Internationalization', description: 'Multi-language support with locale management, RTL layouts, and community translations.', status: 'in_progress', priority: 'now', sort_order: 4 },
  { id: '5', name: 'Distribution & Polish', description: 'Production-ready installers, auto-updates, code signing, and final QA across all platforms.', status: 'next', priority: 'next', sort_order: 5 },
  { id: '6', name: 'Team (Group Projects)', description: 'Shared workspaces, collaborative agent development, role-based access, and team dashboards.', status: 'next', priority: 'next', sort_order: 6 },
];

function RoadmapCard({ item, index, total }: { item: RoadmapItem; index: number; total: number }) {
  const status = statusConfig[item.status];
  const priority = priorityConfig[item.priority];

  return (
    <div
      className="animate-fade-slide-in relative flex gap-5"
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
    </div>
  );
}

export default function HomeRoadmap() {
  const items = ROADMAP_ITEMS;
  const inProgressCount = items.filter((i) => i.status === 'in_progress').length;
  const nextCount = items.filter((i) => i.status === 'next').length;

  return (
    <ContentBox>
      <ContentHeader
        icon={<Rocket className="w-5 h-5 text-cyan-400" />}
        iconColor="cyan"
        title="Product Roadmap"
        subtitle="What we're building now and what comes next."
      />
      <ContentBody centered>
      <div className="relative">
        {/* Background mesh */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[20%] w-[400px] h-[400px] bg-cyan-500/4 blur-[120px] rounded-full" />
          <div className="absolute bottom-[0%] right-[10%] w-[300px] h-[300px] bg-purple-500/3 blur-[100px] rounded-full" />
        </div>

        <div className="w-full max-w-2xl mx-auto space-y-6 relative z-10">
          {/* Summary pills */}
          {items.length > 0 && (
            <>
              <div
                className="animate-fade-slide-in flex flex-wrap gap-3"
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
              </div>

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
      </ContentBody>
    </ContentBox>
  );
}
