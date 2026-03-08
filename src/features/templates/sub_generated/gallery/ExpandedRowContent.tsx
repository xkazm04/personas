import { useState, useMemo } from 'react';
import { Play, Download, Workflow, Server, Zap, UserCheck, Bell } from 'lucide-react';
import { parseJsonOrDefault as parseJsonSafe } from '@/lib/utils/parseJson';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { deriveArchCategories, userHasCategoryCredential } from './architecturalCategories';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, ConnectorReadinessStatus, ProtocolCapability } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { LucideIcon } from 'lucide-react';

interface ExpandedRowContentProps {
  review: PersonaDesignReview;
  designResult: DesignAnalysisResult | null;
  allConnectorsReady: boolean;
  readinessStatuses: ConnectorReadinessStatus[];
  credentialServiceTypes: Set<string>;
  onAdopt: () => void;
  onTryIt: () => void;
  onAddCredential: (connectorName: string) => void;
}

interface SectionDef {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
  items: string[];
}

// ── Main Component ──────────────────────────────────────────────

export function ExpandedRowContent({
  review,
  designResult,
  allConnectorsReady,
  credentialServiceTypes,
  onAdopt,
  onTryIt,
}: ExpandedRowContentProps) {
  const [activeTab, setActiveTab] = useState<string | null>(null);

  // Use cases
  const flows = useMemo(() => {
    const fromReview = parseJsonSafe<UseCaseFlow[]>(review.use_case_flows, []);
    if (fromReview.length > 0) return fromReview;
    const raw = designResult as unknown as Record<string, unknown> | null;
    return raw?.use_case_flows
      ? parseJsonSafe<UseCaseFlow[]>(JSON.stringify(raw.use_case_flows), [])
      : [];
  }, [review.use_case_flows, designResult]);

  // Architecture components
  const connectors: string[] = useMemo(
    () => parseJsonSafe(review.connectors_used, []),
    [review.connectors_used],
  );

  const archComponents = useMemo(() => {
    const cats = deriveArchCategories(connectors);
    return cats.map((cat) => {
      const hasIt = userHasCategoryCredential(cat.key, credentialServiceTypes);
      return hasIt ? `${cat.label}  \u2713` : cat.label;
    });
  }, [connectors, credentialServiceTypes]);

  // Protocol capabilities
  const protocols = useMemo(() => {
    return (designResult?.protocol_capabilities ?? []) as ProtocolCapability[];
  }, [designResult]);

  // Events
  const events = useMemo(() => {
    const subs = designResult?.suggested_event_subscriptions ?? [];
    return subs.map((s) => s.description || s.event_type);
  }, [designResult]);

  // Human review events
  const humanReviewItems = useMemo(() => {
    return protocols
      .filter((p) => p.type === 'manual_review')
      .map((p) => p.context || p.label);
  }, [protocols]);

  // Messages / notifications
  const messageItems = useMemo(() => {
    const channels = designResult?.suggested_notification_channels ?? [];
    const msgs = protocols
      .filter((p) => p.type === 'user_message')
      .map((p) => p.context || p.label);
    const channelDescs = channels.map((ch) => `${ch.type}: ${ch.description}`);
    return [...new Set([...msgs, ...channelDescs])];
  }, [designResult, protocols]);

  const sections: SectionDef[] = useMemo(() => [
    { key: 'usecases',      label: 'Use Cases',      icon: Workflow,  color: '#a78bfa', items: flows.map((f) => f.name) },
    { key: 'architecture',  label: 'Architecture',   icon: Server,    color: '#06b6d4', items: archComponents },
    { key: 'events',        label: 'Events',         icon: Zap,       color: '#f59e0b', items: events },
    { key: 'humanreview',   label: 'Human Review',   icon: UserCheck, color: '#f97316', items: humanReviewItems },
    { key: 'notifications', label: 'Notifications',  icon: Bell,      color: '#10b981', items: messageItems },
  ], [flows, archComponents, events, humanReviewItems, messageItems]);

  const activeSection = sections.find((s) => s.key === activeTab) ?? null;

  return (
    <div className="py-3 px-4 space-y-2">
      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeTab === sec.key;
          const hasItems = sec.items.length > 0;
          return (
            <button
              key={sec.key}
              onClick={() => setActiveTab(isActive ? null : sec.key)}
              disabled={!hasItems}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-all ${
                isActive
                  ? 'border-opacity-30 bg-opacity-15'
                  : hasItems
                    ? 'border-primary/10 hover:bg-secondary/40'
                    : 'border-primary/5 opacity-30 cursor-default'
              }`}
              style={isActive ? {
                borderColor: `${sec.color}50`,
                backgroundColor: `${sec.color}15`,
                color: sec.color,
              } : undefined}
            >
              <Icon className="w-3.5 h-3.5" style={{ color: hasItems ? sec.color : undefined }} />
              <span className={isActive ? 'font-medium' : 'text-muted-foreground/70'}>
                {sec.label}
              </span>
              <span
                className={`text-sm tabular-nums px-1.5 py-0.5 rounded-full ${
                  isActive
                    ? 'bg-white/10'
                    : hasItems
                      ? 'bg-secondary/60 text-muted-foreground/50'
                      : 'text-muted-foreground/30'
                }`}
                style={isActive ? { color: sec.color } : undefined}
              >
                {sec.items.length}
              </span>
            </button>
          );
        })}

        {/* Action buttons — right-aligned */}
        <div className="ml-auto flex items-center gap-2">
          {allConnectorsReady && (
            <button
              onClick={onTryIt}
              className={`px-3 py-1.5 text-sm rounded-xl border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.tryIt.bg} ${BUTTON_VARIANTS.tryIt.text} ${BUTTON_VARIANTS.tryIt.border} ${BUTTON_VARIANTS.tryIt.hover}`}
            >
              <Play className="w-3.5 h-3.5" />
              Try It
            </button>
          )}
          <button
            onClick={onAdopt}
            className={`px-3 py-1.5 text-sm rounded-xl border transition-colors inline-flex items-center gap-1.5 ${BUTTON_VARIANTS.adopt.bg} ${BUTTON_VARIANTS.adopt.text} ${BUTTON_VARIANTS.adopt.border} ${BUTTON_VARIANTS.adopt.hover}`}
          >
            <Download className="w-3.5 h-3.5" />
            Adopt
          </button>
        </div>
      </div>

      {/* Tab content */}
      {activeSection && activeSection.items.length > 0 && (
        <div className="pt-1 pb-1">
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
            {activeSection.items.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-foreground/70">
                <span
                  className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: activeSection.color }}
                />
                <span className="leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
