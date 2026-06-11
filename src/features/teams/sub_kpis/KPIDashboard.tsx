// KPI dashboard (P5 polish) — active KPIs in CONTEXT-GROUP sections (group
// color + name as the header, "Whole project" for project-level KPIs).
// Card rendering is delegated to the /prototype variants behind a small
// card-style switcher (Baseline / Gauge / Bullet) while the directional
// A/B round runs; the winner consolidates back to a single card.
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { Gauge } from 'lucide-react';

import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { paceDescriptor } from './kpiMath';
import { KpiCardBaseline, type KpiCardProps } from './KpiCardBaseline';
import { KpiCardGauge } from './KpiCardGauge';
import { KpiCardBullet } from './KpiCardBullet';

type CardVariant = 'baseline' | 'gauge' | 'bullet';
const VARIANT_KEY = 'personas.kpis.cardVariant';

const CARD_RENDERERS: Record<CardVariant, ComponentType<KpiCardProps>> = {
  baseline: KpiCardBaseline,
  gauge: KpiCardGauge,
  bullet: KpiCardBullet,
};

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

  const [variant, setVariant] = useState<CardVariant>(() => {
    try {
      const v = localStorage.getItem(VARIANT_KEY);
      return v === 'gauge' || v === 'bullet' ? v : 'baseline';
    } catch (err) {
      silentCatch('kpi.cardVariant.read')(err);
      return 'baseline';
    }
  });
  const pickVariant = (v: CardVariant) => {
    setVariant(v);
    try {
      localStorage.setItem(VARIANT_KEY, v);
    } catch (err) {
      silentCatch('kpi.cardVariant.persist')(err);
    }
  };

  useEffect(() => {
    if (activeProjectId) void fetchContextGroups(activeProjectId);
  }, [activeProjectId, fetchContextGroups]);

  const visible = useMemo(
    () => kpis.filter((k) => k.status === 'active' || k.status === 'paused'),
    [kpis],
  );
  const hasProposals = useMemo(() => kpis.some((k) => k.status === 'proposed'), [kpis]);

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

  const Card = CARD_RENDERERS[variant];

  return (
    <div className="space-y-6" data-testid="kpi-dashboard">
      {/* Card-style A/B switcher (prototype round — consolidates to the winner). */}
      <div className="flex items-center gap-2">
        <span className="typo-caption text-foreground">{t.kpis.proto_label}</span>
        <SegmentedTabs<CardVariant>
          tabs={[
            { id: 'baseline', label: t.kpis.proto_baseline },
            { id: 'gauge', label: t.kpis.proto_gauge },
            { id: 'bullet', label: t.kpis.proto_bullet },
          ]}
          activeTab={variant}
          onTabChange={pickVariant}
          ariaLabel={t.kpis.proto_label}
        />
      </div>

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
                <Card
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
