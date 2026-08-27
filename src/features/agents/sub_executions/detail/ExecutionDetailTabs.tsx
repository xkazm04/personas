import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { ListTree, Search, Activity, Zap, Play, Compass, Link2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { isTerminalState } from '@/lib/execution/executionState';

export type DetailTab = 'detail' | 'director' | 'inspector' | 'trace' | 'pipeline' | 'replay' | 'chain';

/**
 * DOM ids wiring the tablist to its panel. Both are scoped by execution id
 * because `ExecutionDetail` renders a NESTED copy of itself inside the chain
 * drill-down modal -- an unscoped id would put two elements with the same id in
 * the document and point every `aria-controls` at whichever one won.
 */
export const tabButtonId = (scope: string, tab: DetailTab) => `execution-detail-tab-${scope}-${tab}`;
export const tabPanelId = (scope: string) => `execution-detail-panel-${scope}`;

interface ExecutionDetailTabsProps {
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  hasToolSteps: boolean;
  hasDirectorReview: boolean;
  /** Pipeline waterfall only has data once the run has started (timeline / live trace). */
  hasPipeline: boolean;
  /** This run belongs to a multi-step chain — show the chain-trace tab. */
  hasChain: boolean;
  executionStatus: string;
  /** Execution id -- scopes the tab/panel DOM ids (see `tabButtonId`). */
  idScope: string;
}

interface TabDescriptor {
  id: DetailTab;
  label: string;
  icon: ReactNode;
  /** Violet treatment for the "extra" tabs (director review, replay sandbox). */
  special?: boolean;
}

export function ExecutionDetailTabs({ activeTab, setActiveTab, hasToolSteps, hasDirectorReview, hasPipeline, hasChain, executionStatus, idScope }: ExecutionDetailTabsProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  const tabClass = (tab: DetailTab, special?: boolean) =>
    `flex items-center gap-2 px-3 py-1.5 rounded-modal typo-heading transition-all ${
      activeTab === tab
        ? special
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
          : 'bg-primary/15 text-foreground/90 border border-primary/30'
        : 'text-foreground hover:text-foreground/95 border border-transparent'
    }`;

  // Only the tabs that are actually rendered take part in arrow-key navigation.
  const tabs: TabDescriptor[] = [
    { id: 'detail', label: t.agents.executions.tab_detail, icon: <ListTree className="w-3.5 h-3.5" /> },
    ...(hasDirectorReview
      ? [{ id: 'director' as const, label: t.agents.executions.tab_director, icon: <Compass className="w-3.5 h-3.5" />, special: true }]
      : []),
    ...(hasToolSteps
      ? [{ id: 'inspector' as const, label: t.agents.executions.tab_inspector, icon: <Search className="w-3.5 h-3.5" /> }]
      : []),
    { id: 'trace', label: t.agents.executions.tab_trace, icon: <Activity className="w-3.5 h-3.5" /> },
    ...(hasPipeline
      ? [{ id: 'pipeline' as const, label: t.agents.executions.tab_pipeline, icon: <Zap className="w-3.5 h-3.5" /> }]
      : []),
    ...(hasChain
      ? [{ id: 'chain' as const, label: t.agents.executions.tab_chain, icon: <Link2 className="w-3.5 h-3.5" /> }]
      : []),
    ...(isTerminalState(executionStatus)
      ? [{ id: 'replay' as const, label: t.agents.executions.tab_replay, icon: <Play className="w-3.5 h-3.5" />, special: true }]
      : []),
  ];

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const index = tabs.findIndex((tab) => tab.id === activeTab);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + delta + tabs.length) % tabs.length];
    if (!next) return;
    setActiveTab(next.id);
    listRef.current?.querySelector<HTMLButtonElement>(`[data-tab-id="${next.id}"]`)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={handleKeyDown}
      className="flex gap-1 p-1 rounded-modal bg-secondary/40 border border-primary/10 w-fit"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabButtonId(idScope, tab.id)}
          // A tablist whose tabs control nothing is an incomplete widget: a
          // screen reader announces "tab 3 of 6" with no way to reach what it
          // selected. The panel carries the matching id + aria-labelledby.
          aria-controls={tabPanelId(idScope)}
          data-tab-id={tab.id}
          aria-selected={activeTab === tab.id}
          // Roving tabindex: the tab strip is a single tab stop, arrows move within it.
          tabIndex={activeTab === tab.id ? 0 : -1}
          onClick={() => setActiveTab(tab.id)}
          className={tabClass(tab.id, tab.special)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
