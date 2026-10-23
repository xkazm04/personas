import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Play, Download, Workflow, Server, Zap, UserCheck, Bell } from 'lucide-react';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { deriveArchCategories } from '../../shared/architecturalCategories';
import { deriveExpandedRowStats } from './expandedRowStats';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR } from '@/lib/types/designTypes';
import type { ResolvedConnectorReadiness } from '../../shared/useConnectorReadiness';
import type { LucideIcon } from 'lucide-react';

interface ExpandedRowContentProps {
  review: PersonaDesignReview;
  designResult: AgentIR | null;
  allConnectorsReady: boolean;
  readinessStatuses: ResolvedConnectorReadiness[];
  credentialServiceTypes: Set<string>;
  onAdopt: () => void;
  onTryIt: () => void;
  onAddCredential: (connectorName: string) => void;
  onViewFlows?: (review: PersonaDesignReview) => void;
}

interface StatDef {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  count: number;
}

export function ExpandedRowContent({
  review,
  designResult,
  allConnectorsReady,
  onAdopt,
  onTryIt,
  onViewFlows,
}: ExpandedRowContentProps) {
  const { t } = useTranslation();
  const connectors: string[] = useMemo(
    () => parseJsonOrDefault(review.connectors_used, []),
    [review.connectors_used],
  );

  const archCount = useMemo(() => deriveArchCategories(connectors).length, [connectors]);
  const counts = useMemo(() => deriveExpandedRowStats(review, designResult), [review, designResult]);

  // A dimension the template does not declare is left out rather than shown
  // as a dimmed zero (seeded v3 templates carry no event or review arrays).
  const stats: StatDef[] = useMemo(() => {
    const all: Array<Omit<StatDef, 'count'> & { count: number | null }> = [
      { key: 'usecases',      label: t.templates.expanded.use_cases,     icon: Workflow,  color: '#a78bfa', count: counts.useCases },
      { key: 'architecture',  label: t.templates.expanded.architecture,  icon: Server,    color: '#06b6d4', count: archCount },
      { key: 'events',        label: t.templates.expanded.events,        icon: Zap,       color: '#f59e0b', count: counts.events },
      { key: 'reviews',       label: t.templates.expanded.reviews_label, icon: UserCheck, color: '#f97316', count: counts.reviews },
      { key: 'notifications', label: t.templates.expanded.notifications, icon: Bell,      color: '#10b981', count: counts.notifications },
    ];
    return all.filter((s): s is StatDef => s.count !== null);
  }, [t.templates.expanded.use_cases, t.templates.expanded.architecture, t.templates.expanded.events, t.templates.expanded.reviews_label, t.templates.expanded.notifications, counts, archCount]);

  return (
    <div className="py-3 px-4 flex items-center gap-4">
      {/* Left: Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          type="button"
          onClick={onAdopt}
          data-testid="template-adopt-button"
          className={`px-3 py-1.5 typo-body rounded-modal border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
        >
          <Download className="w-3.5 h-3.5" />
          {t.templates.expanded.adopt}
        </button>
        {allConnectorsReady && (
          <button
            type="button"
            onClick={onTryIt}
            className={`px-3 py-1.5 typo-body rounded-modal border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
          >
            <Play className="w-3.5 h-3.5" />
            {t.templates.expanded.try_it}
          </button>
        )}
        {counts.flowCount > 0 && onViewFlows && (
          <button
            type="button"
            onClick={() => onViewFlows(review)}
            className="px-3 py-1.5 typo-body rounded-modal border border-brand-purple/25 bg-brand-purple/10 text-brand-purple hover:bg-brand-purple/20 transition-colors inline-flex items-center gap-1.5"
          >
            <Workflow className="w-3.5 h-3.5" />
            {t.templates.expanded.flows}
          </button>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-6 bg-primary/10 flex-shrink-0" />

      {/* Right: Stats icons with counts (non-clickable) */}
      <div className="flex items-center gap-3">
        {stats.map((stat) => {
          const Icon = stat.icon;
          const hasItems = stat.count > 0;
          return (
            <div
              key={stat.key}
              className={`inline-flex items-center gap-1.5 ${hasItems ? '' : 'opacity-30'}`}
              title={`${stat.count} ${stat.label}`}
            >
              <Icon className="w-4 h-4" style={{ color: hasItems ? stat.color : undefined }} />
              <span className="typo-data text-foreground">{stat.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
