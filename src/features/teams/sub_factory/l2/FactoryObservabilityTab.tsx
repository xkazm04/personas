// Factory L2 — tab (c) Observability. A /prototype MIX of the Dev Tools LLM
// and Monitoring submodules in one surface: the project's technical dimension.
// Left: LLM spend by feature (30d pinpoints via the shared tracing adapters).
// Right: unresolved production errors (Sentry). Unwired sensors render the blue
// invitation, never a fake number — measurement before opinion.
import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, CircleDollarSign } from 'lucide-react';

import { useVaultStore } from '@/stores/vaultStore';
import { Numeric } from '@/features/shared/components/display/Numeric';
import {
  fetchLlmPinpoints,
  hasLiveAdapter,
  type LlmPinpoint,
} from '@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters';
import {
  fetchSentryUnresolvedIssues,
  splitSentrySlug,
  type SentryUnresolvedIssue,
} from '@/features/plugins/dev-tools/sub_overview/adapters';
import { silentCatch } from '@/lib/silentCatch';

import { INK } from '../passport/passportInk';
import type { FactoryL2Data } from './factoryL2Data';

function Panel({ title, icon, hue, children }: {
  title: string;
  icon: React.ReactNode;
  hue: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-modal p-3.5 min-w-0" style={{ border: '1px solid rgba(148,163,184,.14)', background: 'rgba(148,163,184,.025)' }}>
      <h3 className="flex items-center gap-2 mb-2.5">
        <span style={{ color: hue }}>{icon}</span>
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/55">{title}</span>
      </h3>
      {children}
    </section>
  );
}

function WireAsk({ what }: { what: string }) {
  return (
    <p className="typo-caption rounded-card border border-dashed px-3 py-4 text-center" style={{ color: INK.blue, borderColor: `${INK.blue}55`, background: `${INK.blue}0a` }}>
      {what} is not wired — bind a connector on the project (Passport wall → Tooling rows) to light this panel.
    </p>
  );
}

export function FactoryObservabilityTab({ data }: { data: FactoryL2Data }) {
  const credentials = useVaultStore((s) => s.credentials);
  const [pinpoints, setPinpoints] = useState<LlmPinpoint[] | null>(null);
  const [issues, setIssues] = useState<SentryUnresolvedIssue[] | null>(null);

  const project = data.project;
  const llmCredId = project?.llm_tracking_credential_id ?? null;
  const llmServiceType = useMemo(
    () => (llmCredId ? credentials.find((c) => c.id === llmCredId)?.serviceType ?? null : null),
    [llmCredId, credentials],
  );
  const monCredId = project?.monitoring_credential_id ?? null;
  const monSlug = project?.monitoring_project_slug ?? null;

  useEffect(() => {
    if (!llmCredId || !llmServiceType || !hasLiveAdapter(llmServiceType)) { setPinpoints(null); return; }
    let alive = true;
    void fetchLlmPinpoints(llmServiceType, llmCredId, '30d')
      .then((rows) => { if (alive) setPinpoints(rows); })
      .catch((e) => { silentCatch('factoryL2:obs-llm')(e); if (alive) setPinpoints([]); });
    return () => { alive = false; };
  }, [llmCredId, llmServiceType]);

  useEffect(() => {
    const [orgSlug, projSlug] = splitSentrySlug(monSlug);
    if (!monCredId || !orgSlug || !projSlug) { setIssues(null); return; }
    let alive = true;
    void fetchSentryUnresolvedIssues(monCredId, orgSlug, projSlug)
      .then((rows) => { if (alive) setIssues(rows); })
      .catch((e) => { silentCatch('factoryL2:obs-sentry')(e); if (alive) setIssues([]); });
    return () => { alive = false; };
  }, [monCredId, monSlug]);

  // Fold pinpoints per feature (use-case name), spend-descending.
  const byFeature = useMemo(() => {
    if (!pinpoints) return [];
    const m = new Map<string, { cost: number; calls: number; models: Set<string> }>();
    for (const r of pinpoints) {
      const key = r.useCaseName ?? `(untagged · ${r.model})`;
      const e = m.get(key) ?? { cost: 0, calls: 0, models: new Set<string>() };
      e.cost += r.totalCostUsd;
      e.calls += r.calls;
      e.models.add(r.model);
      m.set(key, e);
    }
    return [...m.entries()].sort((a, b) => b[1].cost - a[1].cost);
  }, [pinpoints]);

  const totalCost = useMemo(() => byFeature.reduce((s, [, e]) => s + e.cost, 0), [byFeature]);
  const totalEvents = useMemo(() => (issues ?? []).reduce((s, i) => s + i.count, 0), [issues]);
  const maxCost = byFeature[0]?.[1].cost ?? 0;
  const maxEvents = issues?.[0] ? Math.max(...issues.map((i) => i.count)) : 0;

  return (
    <div className="grid gap-3 items-start" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))' }} data-testid="factory-observability-tab">
      <Panel title="LLM — spend by feature · 30d" icon={<CircleDollarSign className="w-4 h-4" aria-hidden />} hue={INK.teal}>
        {!data.llmWired || !llmServiceType ? (
          <WireAsk what="LLM tracking" />
        ) : pinpoints === null ? (
          <p className="typo-caption text-foreground/40 py-3 text-center">loading…</p>
        ) : byFeature.length === 0 ? (
          <p className="typo-caption text-foreground/45 py-3 text-center">No traced LLM calls in the last 30 days.</p>
        ) : (
          <>
            <p className="typo-caption text-foreground/55 mb-2 tabular-nums">
              <Numeric value={totalCost} unit="usd" precision={2} /> across {byFeature.length} features
            </p>
            <ul className="space-y-1.5">
              {byFeature.slice(0, 12).map(([name, e]) => {
                const heavy = e.cost >= 18 ? INK.red : e.cost >= 6 ? INK.amber : INK.emerald;
                return (
                  <li key={name} className="min-w-0">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="typo-caption text-foreground/85 truncate">{name}</span>
                      <span className="text-[10px] text-foreground/40 shrink-0">{e.calls} calls · {[...e.models][0]}{e.models.size > 1 ? ` +${e.models.size - 1}` : ''}</span>
                      <span className="typo-caption tabular-nums font-medium ml-auto shrink-0" style={{ color: heavy }}>
                        <Numeric value={e.cost} unit="usd" precision={2} />
                      </span>
                    </span>
                    <span className="block h-[2px] rounded-full mt-1" style={{ background: 'rgba(148,163,184,.10)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${maxCost > 0 ? (e.cost / maxCost) * 100 : 0}%`, background: heavy }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            {byFeature.length > 12 && <p className="text-[10px] text-foreground/35 mt-2">+{byFeature.length - 12} more features</p>}
          </>
        )}
      </Panel>

      <Panel title="Monitoring — unresolved errors" icon={<Activity className="w-4 h-4" aria-hidden />} hue={INK.red}>
        {!data.monitoringWired ? (
          <WireAsk what="Monitoring" />
        ) : issues === null ? (
          <p className="typo-caption text-foreground/40 py-3 text-center">loading…</p>
        ) : issues.length === 0 ? (
          <p className="typo-caption py-3 text-center" style={{ color: INK.emerald }}>No unresolved issues — clear.</p>
        ) : (
          <>
            <p className="typo-caption text-foreground/55 mb-2 tabular-nums">{totalEvents} events across {issues.length} unresolved issues</p>
            <ul className="space-y-1.5">
              {issues.slice(0, 12).map((i, idx) => {
                const heavy = i.count >= 25 ? INK.red : INK.amber;
                return (
                  <li key={`${i.culprit ?? i.title}-${idx}`} className="min-w-0">
                    <span className="flex items-baseline gap-2 min-w-0">
                      <AlertTriangle className="w-3 h-3 shrink-0 self-center" style={{ color: heavy }} aria-hidden />
                      <span className="typo-caption text-foreground/85 truncate" title={i.title}>{i.title}</span>
                      <span className="typo-caption tabular-nums font-medium ml-auto shrink-0" style={{ color: heavy }}>{i.count}</span>
                    </span>
                    {i.culprit && <span className="block text-[10px] text-foreground/40 truncate pl-5">{i.culprit}</span>}
                    <span className="block h-[2px] rounded-full mt-1" style={{ background: 'rgba(148,163,184,.10)' }}>
                      <span className="block h-full rounded-full" style={{ width: `${maxEvents > 0 ? (i.count / maxEvents) * 100 : 0}%`, background: heavy }} />
                    </span>
                  </li>
                );
              })}
            </ul>
            {issues.length > 12 && <p className="text-[10px] text-foreground/35 mt-2">+{issues.length - 12} more issues</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
