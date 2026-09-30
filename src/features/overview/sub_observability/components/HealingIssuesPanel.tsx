/**
 * Observability (composition kit): the Health Issues section. Toolbar (state filter, list or
 * timeline, Run analysis), then a Split: the issues (or the healing chains) on the left, the
 * picked one's detail in the side pane when the surface has room and in the drawer when it has
 * not (as Fleet Activity). The audit log closes the section as a collapsed level-2 Section.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { Dot, Drawer, KitButton, Section, Segmented, Split, Toolbar } from '@/features/shared/components/kit';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import type { HealingViewMode as ViewMode } from '@/lib/constants/uiModes';
import type { ObservabilityWords } from '../libs/useObservabilityWords';
import { HealingIssueSummary } from './HealingIssueSummary';
import { IssuesList } from './IssuesList';
import { HealingIssueDetail } from './HealingIssueDetail';
import { HealingTimeline, useChains } from './HealingTimeline';
import { HealingChainDetail } from './HealingChainDetail';
import { HealingAuditLog } from './HealingAuditLog';

type Filter = 'all' | 'open' | 'auto-fixed';

export interface HealingIssuesPanelProps {
  healingIssues: PersonaHealingIssue[];
  healingRunning: boolean;
  handleRunAnalysis: () => void;
  resolveHealingIssue: (id: string) => void;
  /** Opens the full issue (HealingIssueModal). */
  setSelectedIssue: (issue: PersonaHealingIssue) => void;
  issueFilter: Filter;
  setIssueFilter: (f: Filter) => void;
  issueCounts: { all: number; open: number; autoFixed: number };
  sortedFilteredIssues: PersonaHealingIssue[];
  analysisResult: { failures_analyzed: number; issues_created: number; auto_fixed: number } | null;
  setAnalysisResult: (r: null) => void;
  analysisError: string | null;
  setAnalysisError: (e: null) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  timelineEvents: HealingTimelineEvent[];
  timelineLoading: boolean;
  selectedPersonaId?: string | null;
  personas: ReadonlyArray<{ id: string; name: string }>;
  w: ObservabilityWords;
}

export function HealingIssuesPanel(p: HealingIssuesPanelProps) {
  const { w } = p;
  const { o, ad } = w;
  const [pickedIssue, setPickedIssue] = useState<string | null>(null);
  const [pickedChain, setPickedChain] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const { chains, knowledge } = useChains(p.timelineEvents);
  const names = useMemo(() => new Map(p.personas.map((x) => [x.id, x.name])), [p.personas]);
  const personaName = useCallback((id: string) => names.get(id) ?? null, [names]);

  const timeline = p.viewMode === 'timeline';
  // The first row is picked on arrival, so the detail pane is never blank (as Fleet Activity).
  const issue = p.sortedFilteredIssues.find((i) => i.id === pickedIssue) ?? p.sortedFilteredIssues[0] ?? null;
  const chain = chains.find((c) => c.chainId === pickedChain) ?? chains[0] ?? null;
  const pick = useCallback((set: (id: string) => void) => (id: string) => {
    set(id);
    // No room for the side pane: the detail opens in the drawer.
    if (paneRef.current && paneRef.current.offsetWidth === 0) setDrawer(true);
  }, []);
  const openIssueById = (id: string) => {
    const found = p.healingIssues.find((i) => i.id === id);
    if (found) p.setSelectedIssue(found);
  };

  useAppKeyboard((e) => {
    if (e.key !== 'Escape') return false;
    setDrawer(false);
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY, enabled: drawer });

  const detail = timeline
    ? <HealingChainDetail chain={chain} onOpenIssue={openIssueById} w={w} />
    : <HealingIssueDetail issue={issue} personaName={personaName} onOpen={p.setSelectedIssue} onResolve={p.resolveHealingIssue} w={w} />;
  const r = p.analysisResult;
  return (
    <Section
      id="s-obs-health"
      eyebrow={w.eyebrow}
      title={o.healing_issues_panel.title}
      count={p.healingIssues.length}
      meta={p.healingIssues.length > 0 ? <HealingIssueSummary issues={p.healingIssues} w={w} /> : undefined}
      actions={
        <KitButton onClick={p.handleRunAnalysis} loading={p.healingRunning} testId="obs-run-analysis">
          {p.healingRunning ? o.healing_issues_panel.analyzing : o.healing_issues_panel.run_analysis}
        </KitButton>
      }
    >
      <Toolbar label={o.healing_issues_panel.title}>
        <Segmented<Filter>
          label={o.healing_issues_panel.title}
          value={p.issueFilter}
          onChange={p.setIssueFilter}
          options={[
            { v: 'all', label: ad.filter_all, count: p.issueCounts.all },
            { v: 'open', label: ad.filter_open, count: p.issueCounts.open, tone: 'warning', glyph: 'soft' },
            { v: 'auto-fixed', label: ad.filter_auto_fixed, count: p.issueCounts.autoFixed, tone: 'success', glyph: 'hollow' },
          ]}
        />
        <span data-testid="obs-view" className="contents">
          <Segmented<ViewMode>
            label={o.observability_extra.healing_view_timeline}
            value={p.viewMode}
            onChange={p.setViewMode}
            options={[
              { v: 'list', label: o.observability_extra.healing_view_list },
              { v: 'timeline', label: o.observability_extra.healing_view_timeline },
            ]}
          />
        </span>
      </Toolbar>
      {r && !p.healingRunning && (
        <p className="k-in typo-caption flex items-center gap-2" style={{ margin: '0 0 12px' }}>
          <Dot tone="success" />
          {o.healing_issues_panel.analysis_complete_prefix}{' '}
          {w.tx(r.issues_created !== 1 ? ad.issues_found : ad.issues_found_one, { count: r.issues_created })}
          {r.auto_fixed > 0 && ` (${r.auto_fixed} ${ad.auto_fixed})`}
          {', '}{w.tx(r.failures_analyzed !== 1 ? ad.executions_scanned : ad.executions_scanned_one, { count: r.failures_analyzed })}
          <KitButton quiet onClick={() => p.setAnalysisResult(null)}>{w.t.common.dismiss}</KitButton>
        </p>
      )}
      {p.analysisError && !p.healingRunning && (
        <p className="k-in typo-caption flex items-center gap-2" style={{ margin: '0 0 12px' }}>
          <Dot tone="error" />{p.analysisError}
          <KitButton quiet onClick={() => p.setAnalysisError(null)}>{w.t.common.dismiss}</KitButton>
        </p>
      )}
      <Split
        paneRef={paneRef}
        paneLabel={o.observability_extra.issue_details}
        pane={detail}
        main={timeline
          ? <HealingTimeline chains={chains} knowledge={knowledge} loading={p.timelineLoading} selectedId={chain?.chainId ?? null} onSelect={pick(setPickedChain)} w={w} />
          : (
            <IssuesList
              issues={p.sortedFilteredIssues}
              selectedId={issue?.id ?? null}
              onSelect={pick(setPickedIssue)}
              onOpen={p.setSelectedIssue}
              onResolve={p.resolveHealingIssue}
              personaName={personaName}
              empty={{ title: o.healing_issues_panel.no_open_issues, hint: o.healing_issues_panel.run_analysis_hint, tone: 'success' }}
              w={w}
            />
          )}
      />
      <HealingAuditLog personaId={p.selectedPersonaId ?? null} w={w} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} closeLabel={w.t.common.close} label={o.observability_extra.issue_details}>
        {detail}
      </Drawer>
    </Section>
  );
}
