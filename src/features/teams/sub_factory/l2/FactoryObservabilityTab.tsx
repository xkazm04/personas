// Factory L2 — Observability, composed from the kit: the project's technical
// dimension in two Sections on the spine. LLM spend by feature (30 days of
// pinpoints via the shared tracing adapters) and unresolved production errors
// (Sentry), each a DataTable whose rows carry a Mark for how heavy they are and
// a pip strip drawn at a stated quantum. The four honest states survive the
// port: not wired (an invitation, waiting on you), unreachable (a retry, never
// the empty-success copy), loading (the kit ghost) and a real empty.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { DataTable, KitButton, Section, UnitStrip, quantumFor, type TableRow } from '@/features/shared/components/kit';
import type { EmptySpec } from '@/features/shared/components/kit';

import { useFactoryWords, type FactoryWords } from '../useFactoryWords';
import type { FactoryL2Data } from './factoryL2Data';
import { useObservabilityFeeds } from './useObservabilityFeeds';

const SHOWN = 12;
type FeatureCol = 'feature' | 'calls' | 'cost';
type IssueCol = 'issue' | 'events';

/** The empty band for a feed that cannot show rows: not wired, unreachable or empty. */
function feedEmpty(w: FactoryWords, what: string, wired: boolean, failed: boolean, onRetry: () => void, clear: EmptySpec): EmptySpec {
  if (!wired) return { title: `${what}: ${w.L.notWired}`, hint: w.L.wireAsk(what), tone: 'info' };
  if (failed) {
    return {
      title: w.t.common.source_unreachable, tone: 'warning',
      action: <KitButton onClick={onRetry} testId="observability-retry">{w.t.common.retry}</KitButton>,
    };
  }
  return clear;
}

export function FactoryObservabilityTab({ data }: { data: FactoryL2Data }) {
  const w = useFactoryWords();
  const f = useObservabilityFeeds(data);

  const byFeature = useMemo(() => {
    const m = new Map<string, { cost: number; calls: number; models: Set<string>; untagged: boolean }>();
    for (const r of f.pinpoints ?? []) {
      const key = r.useCaseName ?? w.L.untagged(r.model);
      const e = m.get(key) ?? { cost: 0, calls: 0, models: new Set<string>(), untagged: r.useCaseName == null };
      e.cost += r.totalCostUsd;
      e.calls += r.calls;
      e.models.add(r.model);
      m.set(key, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [f.pinpoints, w.L]);
  const totalCost = byFeature.reduce((s, [, e]) => s + e.cost, 0);
  const issues = f.issues ?? [];
  const totalEvents = issues.reduce((s, i) => s + i.count, 0);
  const costQ = quantumFor(byFeature[0]?.[1].cost ?? 0, 24, 0.5);
  const eventQ = quantumFor(issues.reduce((m, i) => Math.max(m, i.count), 0), 24, 1);

  const featureRows: Array<TableRow<FeatureCol>> = byFeature.slice(0, SHOWN).map(([name, e]) => ({
    id: name,
    mark: e.cost >= 18 ? { tone: 'error', glyph: 'solid', label: w.cost } : e.cost >= 6 ? { tone: 'warning', glyph: 'solid', label: w.cost } : { tone: 'neutral', glyph: 'soft', label: w.cost },
    cells: {
      feature: (
        <div className="k-cell2">
          <span className="k-row__name typo-body k-strong">{name}</span>
          {!e.untagged && <span className="k-row__meta typo-caption">{[...e.models][0]}{e.models.size > 1 ? ` +${e.models.size - 1}` : ''}</span>}
        </div>
      ),
      calls: <span className="typo-data k-regular"><Numeric value={e.calls} unit="count" /></span>,
      cost: (
        <span className="k-fig">
          <UnitStrip size="pip" label={w.cost} segments={[{ n: e.cost / costQ, tone: 'primary', glyph: 'soft' }]} />
          <span className="typo-data k-regular"><Numeric value={e.cost} unit="usd" precision={2} /></span>
        </span>
      ),
    },
  }));
  const issueRows: Array<TableRow<IssueCol>> = issues.slice(0, SHOWN).map((i, idx) => ({
    id: `${i.culprit ?? i.title}-${idx}`,
    mark: { tone: i.count >= 25 ? 'error' : 'warning', glyph: 'solid', label: w.errors },
    cells: {
      issue: (
        <div className="k-cell2">
          <span className="k-row__name typo-body k-strong">{i.title}</span>
          {i.culprit && <span className="k-row__meta typo-code k-quiet">{i.culprit}</span>}
        </div>
      ),
      events: (
        <span className="k-fig">
          <UnitStrip size="pip" label={w.L.events} segments={[{ n: i.count / eventQ, tone: 'error', glyph: 'soft' }]} />
          <span className="typo-data k-regular">{i.count}</span>
        </span>
      ),
    },
  }));

  const llmReady = f.llmWired && !f.llmFailed;
  const issuesReady = data.monitoringWired && !f.issuesFailed;
  return (
    <div data-testid="factory-observability-tab">
      <Section
        id="s-fac-llm"
        eyebrow={`${w.observability} · ${w.L.window30d}`}
        title={w.L.llmSpend}
        count={llmReady && f.pinpoints ? byFeature.length : undefined}
        meta={llmReady && byFeature.length > 0 ? <span className="k-legend-row"><span><Numeric value={totalCost} unit="usd" precision={2} /></span><span><UnitStrip size="pip" label={w.cost} segments={[{ n: 1, tone: 'primary', glyph: 'soft' }]} /> = <Numeric value={costQ} unit="usd" precision={costQ < 1 ? 2 : 0} /></span></span> : undefined}
      >
        <DataTable<FeatureCol>
          label={w.L.llmSpend}
          loading={llmReady && f.pinpoints === null}
          cols={[
            { key: 'feature', label: w.features },
            { key: 'calls', label: w.t.overview.llm_spend.calls, num: true },
            { key: 'cost', label: w.cost, num: true },
          ]}
          rows={llmReady ? featureRows : []}
          empty={feedEmpty(w, w.L.llmTracking, f.llmWired, f.llmFailed, f.retryLlm, { title: w.L.noLlm })}
          pager={byFeature.length > SHOWN ? <span className="typo-caption">{w.L.moreFeatures(byFeature.length - SHOWN)}</span> : undefined}
        />
      </Section>
      <Section
        id="s-fac-errors"
        eyebrow={w.observability}
        title={w.L.errorsTitle}
        count={issuesReady && f.issues ? issues.length : undefined}
        meta={issuesReady && issues.length > 0 ? <span className="k-legend-row"><span>{totalEvents} {w.L.events}</span><span><UnitStrip size="pip" label={w.L.events} segments={[{ n: 1, tone: 'error', glyph: 'soft' }]} /> = {eventQ} {w.L.events}</span></span> : undefined}
      >
        <DataTable<IssueCol>
          label={w.L.errorsTitle}
          loading={issuesReady && f.issues === null}
          cols={[
            { key: 'issue', label: w.errors },
            { key: 'events', label: w.t.sidebar.events, num: true },
          ]}
          rows={issuesReady ? issueRows : []}
          empty={feedEmpty(w, w.monitoring, data.monitoringWired, f.issuesFailed, f.retryIssues, { title: w.L.noIssues, tone: 'success' })}
          pager={issues.length > SHOWN ? <span className="typo-caption">{w.L.moreIssues(issues.length - SHOWN)}</span> : undefined}
        />
      </Section>
    </div>
  );
}
