import { Activity, Bell, ClipboardCheck, ChevronRight, Clock, X, type LucideIcon } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { OverviewTab } from '@/lib/types/types';
import { useSinceLeftBriefing, type BriefingLine } from './lib/sinceLeftBriefing';

/**
 * "Since you left" briefing — a compact, dismissible debrief of what happened
 * while the user was away (runs, alerts, waiting approvals). Every line is a
 * one-click jump to the right Overview surface. Renders nothing when the delta
 * is trivial or on first run (see useSinceLeftBriefing).
 */
export default function SinceYouLeftBriefing() {
  const { visible, lines, dismiss } = useSinceLeftBriefing();
  const { t, tx } = useTranslation();
  const sl = t.home.since_left;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  if (!visible) return null;

  const goTo = (tab: OverviewTab) => () => {
    setOverviewTab(tab);
    setSidebarSection('overview');
  };

  const rowFor = (line: BriefingLine): { icon: LucideIcon; label: string; onClick: () => void; accent: string } => {
    if (line.kind === 'runs') {
      const base = tx(line.count === 1 ? sl.runs : sl.runs_other, { count: line.count });
      const failed = line.failed && line.failed > 0
        ? ` · ${tx(line.failed === 1 ? sl.failed : sl.failed_other, { count: line.failed })}`
        : '';
      return {
        icon: Activity,
        label: `${base}${failed}`,
        onClick: goTo('executions'),
        accent: line.failed && line.failed > 0 ? 'text-red-400' : 'text-cyan-400',
      };
    }
    if (line.kind === 'alerts') {
      return {
        icon: Bell,
        label: tx(line.count === 1 ? sl.alerts : sl.alerts_other, { count: line.count }),
        // Alerts live on the Health tab ('observability' was removed from the
        // OverviewTab union — it never had a router case).
        onClick: goTo('health'),
        accent: 'text-amber-400',
      };
    }
    return {
      icon: ClipboardCheck,
      label: tx(line.count === 1 ? sl.approvals : sl.approvals_other, { count: line.count }),
      onClick: goTo('manual-review'),
      accent: 'text-violet-300',
    };
  };

  return (
    <div className="animate-fade-slide-in motion-reduce:animate-none w-full rounded-modal border border-primary/15 bg-secondary/30 backdrop-blur-sm px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-3.5 h-3.5 text-primary/70 flex-shrink-0" />
        <span className="typo-section-title flex-1">{sl.title}</span>
        <button
          type="button"
          onClick={dismiss}
          aria-label={sl.dismiss}
          className="flex-shrink-0 p-1 rounded-input text-foreground opacity-50 outline-none hover:opacity-100 hover:bg-secondary/40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-opacity"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {lines.map((line) => {
          const { icon: Icon, label, onClick, accent } = rowFor(line);
          return (
            <button
              key={line.kind}
              type="button"
              onClick={onClick}
              data-testid={`since-left-${line.kind}`}
              className="group flex items-center gap-3 rounded-input px-2 py-1.5 outline-none hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-colors"
            >
              <Icon className={`w-4 h-4 flex-shrink-0 ${accent}`} />
              <span className="flex-1 text-left typo-body text-foreground truncate">{label}</span>
              <ChevronRight className="w-4 h-4 text-foreground opacity-50 group-hover:translate-x-0.5 transition-transform" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
