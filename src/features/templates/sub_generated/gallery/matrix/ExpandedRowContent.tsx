import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Play, Download, Workflow, Server, Zap, UserCheck, Bell } from 'lucide-react';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { deriveArchCategories } from './architecturalCategories';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { AgentIR, ConnectorReadinessStatus, ProtocolCapability } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { LucideIcon } from 'lucide-react';

interface ExpandedRowContentProps {
  review: PersonaDesignReview;
  designResult: AgentIR | null;
  allConnectorsReady: boolean;
  readinessStatuses: ConnectorReadinessStatus[];
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
  const flows = useMemo(() => {
    const fromReview = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    if (fromReview.length > 0) return fromReview;
    const raw = designResult as unknown as Record<string, unknown> | null;
    return raw?.use_case_flows
      ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
      : [];
  }, [review.use_case_flows, designResult]);

  const connectors: string[] = useMemo(
    () => parseJsonSafe(review.connectors_used, []),
    [review.connectors_used],
  );

  const archCount = useMemo(() => deriveArchCategories(connectors).length, [connectors]);

  const protocols = useMemo(() => {
    return (designResult?.protocol_capabilities ?? []) as ProtocolCapability[];
  }, [designResult]);

  const eventCount = useMemo(() => {
    return (designResult?.suggested_event_subscriptions ?? []).length;
  }, [designResult]);

  const reviewCount = useMemo(() => {
    return protocols.filter((p) => p.type === 'manual_review').length;
  }, [protocols]);

  const notifCount = useMemo(() => {
    const channels = Array.isArray(designResult?.suggested_notification_channels) ? designResult.suggested_notification_channels.length : 0;
    const msgs = protocols.filter((p) => p.type === 'user_message').length;
    return channels + msgs;
  }, [designResult, protocols]);

  const stats: StatDef[] = useMemo(() => [
    { key: 'usecases',      label: t.templates.expanded.use_cases,     icon: Workflow,  color: '#a78bfa', count: flows.length },
    { key: 'architecture',  label: t.templates.expanded.architecture,  icon: Server,    color: '#06b6d4', count: archCount },
    { key: 'events',        label: t.templates.expanded.events,        icon: Zap,       color: '#f59e0b', count: eventCount },
    { key: 'reviews',       label: t.templates.expanded.reviews_label, icon: UserCheck, color: '#f97316', count: reviewCount },
    { key: 'notifications', label: t.templates.expanded.notifications, icon: Bell,      color: '#10b981', count: notifCount },
  ], [flows.length, archCount, eventCount, reviewCount, notifCount]);

  return (
    <div className="py-3 px-4 flex items-center gap-4">
      {/* Left: Action buttons */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onAdopt}
          className={`px-3 py-1.5 text-sm rounded-xl border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
        >
          <Download className="w-3.5 h-3.5" />
          {t.templates.expanded.adopt}
        </button>
        {allConnectorsReady && (
          <button
            onClick={onTryIt}
            className={`px-3 py-1.5 text-sm rounded-xl border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
          >
            <Play className="w-3.5 h-3.5" />
            {t.templates.expanded.try_it}
          </button>
        )}
        {flows.length > 0 && onViewFlows && (
          <button
            onClick={() => onViewFlows(review)}
            className="px-3 py-1.5 text-sm rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors inline-flex items-center gap-1.5"
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
              <span className="text-sm tabular-nums text-muted-foreground/70">{stat.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
