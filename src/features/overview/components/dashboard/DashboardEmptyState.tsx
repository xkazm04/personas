import { Rocket, Plus, BookOpen, ArrowRight } from 'lucide-react';
import { useOverviewStore } from '@/stores/overviewStore';
import { CARD_CONTAINER } from '@/features/overview/utils/dashboardGrid';

/**
 * Shown to new users when there are no agents and no executions,
 * replacing the data-heavy dashboard grid that would otherwise
 * display blank charts and misleading zero metrics.
 */
export function DashboardEmptyState() {
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  return (
    <div className="space-y-6 py-2">
      {/* Hero */}
      <div className={`${CARD_CONTAINER} p-6 text-center space-y-3 relative overflow-hidden`}>
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/5 via-transparent to-violet-500/5 pointer-events-none" />
        <div className="relative z-10 space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Rocket className="w-6 h-6 text-indigo-400" />
          </div>
          <h3 className="text-lg font-semibold text-foreground/90">Welcome to Personas</h3>
          <p className="typo-body text-muted-foreground/70 max-w-md mx-auto">
            Create your first agent to start seeing execution metrics, traffic charts, and activity here.
          </p>
        </div>
      </div>

      {/* Quick-start actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <QuickStartCard
          icon={<Plus className="w-4 h-4" />}
          title="Create an Agent"
          description="Set up your first AI persona with custom instructions and tools."
          actionLabel="Get Started"
          onClick={() => setOverviewTab('agents' as never)}
          accent="violet"
        />
        <QuickStartCard
          icon={<BookOpen className="w-4 h-4" />}
          title="Browse Templates"
          description="Start from a pre-built template and customize it to your needs."
          actionLabel="Explore"
          onClick={() => setOverviewTab('templates' as never)}
          accent="cyan"
        />
      </div>
    </div>
  );
}

function QuickStartCard({
  icon, title, description, actionLabel, onClick, accent,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onClick: () => void;
  accent: 'violet' | 'cyan';
}) {
  const accentCls = accent === 'violet'
    ? 'bg-violet-500/10 border-violet-500/20 text-violet-400'
    : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400';
  const btnCls = accent === 'violet'
    ? 'text-violet-400 hover:text-violet-300'
    : 'text-cyan-400 hover:text-cyan-300';

  return (
    <button
      onClick={onClick}
      className={`${CARD_CONTAINER} p-5 text-left space-y-3 hover:bg-white/[0.02] transition-colors group`}
    >
      <div className={`w-9 h-9 rounded-lg border flex items-center justify-center ${accentCls}`}>
        {icon}
      </div>
      <div>
        <h4 className="typo-heading text-foreground/90">{title}</h4>
        <p className="typo-body text-muted-foreground/60 mt-1">{description}</p>
      </div>
      <span className={`inline-flex items-center gap-1 typo-heading transition-colors ${btnCls}`}>
        {actionLabel} <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
      </span>
    </button>
  );
}
