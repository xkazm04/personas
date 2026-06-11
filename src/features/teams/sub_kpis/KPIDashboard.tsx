// KPI dashboard (P5 polish) — active KPIs in CONTEXT-GROUP sections (group
// color + name as the header, "Whole project" for project-level KPIs), each
// KPI a plain-language card: value vs target, a pace sentence instead of a
// status token, how it's measured in one sentence, and a quiet one-shot
// celebration when a target is met. Zero JSON / zero raw enum tokens.
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Cable, Gauge, PartyPopper } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { paceDescriptor, type KpiTrack } from './kpiMath';
import { categoryMeta } from './kpiMeta';
import { describeMeasurement } from './describeMeasurement';

const TRACK_TINT: Record<KpiTrack, string> = {
  met: 'border-success/40',
  'on-track': 'border-primary/15',
  'off-track': 'border-destructive/50',
  unmeasured: 'border-primary/10',
};

const CELEBRATED_KEY = 'personas.kpis.celebrated';

function celebratedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(CELEBRATED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function markCelebrated(id: string) {
  try {
    const s = celebratedSet();
    s.add(id);
    localStorage.setItem(CELEBRATED_KEY, JSON.stringify([...s].slice(-100)));
  } catch (err) {
    silentCatch('kpi.celebrate.persist')(err);
  }
}

export function KPIDashboard({
  loading,
  onOpen,
  onReviewProposals,
}: {
  loading: boolean;
  onOpen: (kpiId: string) => void;
  onReviewProposals: () => void;
}) {
  const { t, tx } = useTranslation();
  const kpis = useSystemStore((s) => s.kpis);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const contextGroups = useSystemStore((s) => s.contextGroups);
  const fetchContextGroups = useSystemStore((s) => s.fetchContextGroups);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  useEffect(() => {
    if (activeProjectId) void fetchContextGroups(activeProjectId);
  }, [activeProjectId, fetchContextGroups]);

  const visible = useMemo(
    () => kpis.filter((k) => k.status === 'active' || k.status === 'paused'),
    [kpis],
  );
  const hasProposals = useMemo(() => kpis.some((k) => k.status === 'proposed'), [kpis]);

  // Sections: each context group that has KPIs, then "Whole project".
  const sections = useMemo(() => {
    const byGroup = new Map<string | null, DevKpi[]>();
    for (const k of visible) {
      const key = k.context_group_id ?? null;
      byGroup.set(key, [...(byGroup.get(key) ?? []), k]);
    }
    const out: Array<{ id: string | null; name: string; color: string | null; kpis: DevKpi[] }> =
      [];
    for (const g of contextGroups) {
      const inGroup = byGroup.get(g.id);
      if (inGroup?.length) out.push({ id: g.id, name: g.name, color: g.color, kpis: inGroup });
    }
    const projectLevel = byGroup.get(null);
    if (projectLevel?.length) {
      out.push({ id: null, name: t.kpis.section_whole_project, color: null, kpis: projectLevel });
    }
    return out;
  }, [visible, contextGroups, t]);

  if (loading && kpis.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <LoadingSpinner />
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        icon={Gauge}
        title={t.kpis.empty_title}
        description={hasProposals ? t.kpis.empty_with_proposals_hint : t.kpis.empty_hint}
        action={
          hasProposals
            ? { label: t.kpis.review_proposals_cta, onClick: onReviewProposals }
            : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="kpi-dashboard">
      {sections.map((section) => {
        const onTrack = section.kpis.filter((k) => {
          const tr = paceDescriptor(k).track;
          return tr === 'on-track' || tr === 'met';
        }).length;
        return (
          <section key={section.id ?? '__project__'}>
            <div className="flex items-center gap-2 mb-2">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: section.color ?? 'var(--primary)' }}
              />
              <h3 className="typo-heading text-foreground">{section.name}</h3>
              <span className="typo-caption text-foreground">
                {tx(t.kpis.section_rollup, { onTrack, total: section.kpis.length })}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {section.kpis.map((kpi) => (
                <KpiCard
                  key={kpi.id}
                  kpi={kpi}
                  onOpen={onOpen}
                  onConnect={() => setSidebarSection('credentials')}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function paceSentence(
  kpi: DevKpi,
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
): string {
  const d = paceDescriptor(kpi);
  const unit = kpi.unit || '';
  switch (d.track) {
    case 'met':
      return tx(t.kpis.pace_met, { value: kpi.current_value ?? 0, unit });
    case 'unmeasured':
      return t.kpis.pace_unmeasured;
    case 'off-track':
      return d.daysLeft != null
        ? tx(t.kpis.pace_off_dated, {
            current: kpi.current_value ?? 0,
            target: kpi.target_value ?? 0,
            unit,
            days: Math.max(0, d.daysLeft),
          })
        : tx(t.kpis.pace_off, {
            current: kpi.current_value ?? 0,
            target: kpi.target_value ?? 0,
            unit,
          });
    default:
      return d.progressPct != null && d.daysLeft != null
        ? tx(t.kpis.pace_on_dated, {
            pct: d.progressPct,
            target: kpi.target_value ?? 0,
            unit,
            days: Math.max(0, d.daysLeft),
          })
        : tx(t.kpis.pace_on, { target: kpi.target_value ?? 0, unit });
  }
}

function KpiCard({
  kpi,
  onOpen,
  onConnect,
}: {
  kpi: DevKpi;
  onOpen: (id: string) => void;
  onConnect: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = paceDescriptor(kpi);
  const cat = categoryMeta(kpi.category);
  const CatIcon = cat.icon;
  const justMet = d.track === 'met' && !celebratedSet().has(kpi.id);

  useEffect(() => {
    if (justMet) markCelebrated(kpi.id);
  }, [justMet, kpi.id]);

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(kpi.id)}
      data-testid={`kpi-card-${kpi.id}`}
      initial={justMet ? { scale: 0.96 } : false}
      animate={justMet ? { scale: [0.96, 1.03, 1] } : {}}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`text-left rounded-card border bg-secondary/20 hover:bg-secondary/40 transition-colors p-4 space-y-2 ${TRACK_TINT[d.track]} ${kpi.status === 'paused' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typo-heading text-foreground">{kpi.name}</span>
        <Tooltip content={cat.label(t)}>
          <CatIcon className="w-4 h-4 text-foreground flex-shrink-0" aria-label={cat.label(t)} />
        </Tooltip>
      </div>

      <div className="flex items-baseline gap-2">
        {justMet && <PartyPopper className="w-4 h-4 text-success" aria-hidden />}
        <span className="typo-title text-foreground tabular-nums">
          {kpi.current_value != null ? <Numeric value={kpi.current_value} /> : '—'}
        </span>
        {kpi.target_value != null && (
          <span className="typo-body text-foreground tabular-nums">
            / <Numeric value={kpi.target_value} /> {kpi.unit}
          </span>
        )}
      </div>

      {d.progressPct != null && (
        <div className="h-1 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className={`h-full rounded-full ${d.track === 'off-track' ? 'bg-destructive/70' : d.track === 'met' ? 'bg-success/70' : 'bg-primary/70'}`}
            style={{ width: `${Math.max(d.progressPct, 2)}%` }}
          />
        </div>
      )}

      <p className="typo-caption text-foreground">{paceSentence(kpi, t, tx)}</p>
      <p className="typo-caption text-foreground opacity-80">{describeMeasurement(kpi, t, tx)}</p>

      <div className="flex items-center gap-2 flex-wrap">
        {kpi.last_measured_at && (
          <span className="typo-caption text-foreground">
            <RelativeTime timestamp={kpi.last_measured_at} />
          </span>
        )}
        {kpi.status === 'paused' && (
          <span className="typo-caption text-foreground">{t.kpis.paused_chip}</span>
        )}
        {kpi.needed_connector && (
          <Tooltip content={tx(t.kpis.connect_tooltip, { service: kpi.needed_connector })}>
            <span
              role="link"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onConnect();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onConnect();
                }
              }}
              className="inline-flex items-center gap-1 typo-caption text-primary hover:underline cursor-pointer"
              data-testid={`kpi-connect-${kpi.id}`}
            >
              <Cable className="w-3 h-3" />
              {tx(t.kpis.connect_cta, { service: kpi.needed_connector })}
            </span>
          </Tooltip>
        )}
      </div>
    </motion.button>
  );
}
