import { Wrench, Zap, Link, Brain, Activity, ShieldCheck } from 'lucide-react';
import { ENTITY_CARD_COLORS } from '../colorTokens';
import type { ColorKey } from '../colorTokens';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Six-up count grid summarizing a draft persona's entities
 * (tools / triggers / connectors / reviews / memory / events).
 *
 * Shared between the n8n confirm step ({@link N8nConfirmStep}) and the
 * matrix preview ({@link PersonaPreviewCard}) so the two preview surfaces
 * stay visually and translationally in sync. All labels resolve through
 * `t.templates.n8n.*` keys.
 *
 * @catalog Persona entity-count summary grid for the n8n import preview.
 */
export interface PersonaEntityCounts {
  toolCount: number;
  triggerCount: number;
  connectorCount: number;
  reviewCount: number;
  memoryCount: number;
  eventCount: number;
}

export function PersonaEntitySummary({
  toolCount,
  triggerCount,
  connectorCount,
  reviewCount,
  memoryCount,
  eventCount,
  className,
}: PersonaEntityCounts & { className?: string }) {
  const { t } = useTranslation();
  const n8n = t.templates.n8n;

  const cards: { icon: React.ComponentType<{ className?: string }>; count: number; label: string; color: ColorKey }[] = [
    { icon: Wrench, count: toolCount, label: n8n.tools_label, color: 'blue' },
    { icon: Zap, count: triggerCount, label: n8n.triggers_label, color: 'amber' },
    { icon: Link, count: connectorCount, label: n8n.connectors_label, color: 'emerald' },
    { icon: ShieldCheck, count: reviewCount, label: n8n.reviews_label, color: 'rose' },
    { icon: Brain, count: memoryCount, label: n8n.memory_label, color: 'cyan' },
    { icon: Activity, count: eventCount, label: n8n.events_label, color: 'orange' },
  ];

  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6 md:gap-3 ${className ?? ''}`}>
      {cards.map((card) => (
        <EntityCard key={card.label} icon={card.icon} count={card.count} label={card.label} color={card.color} />
      ))}
    </div>
  );
}

function EntityCard({ icon: Icon, count, label, color }: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  label: string;
  color: ColorKey;
}) {
  return (
    <div className={`px-2 py-3 rounded-modal border text-center ${ENTITY_CARD_COLORS[color]}`}>
      <Icon className="w-3.5 h-3.5 mx-auto mb-1" />
      <p className="typo-body-lg font-semibold text-foreground tabular-nums">{count}</p>
      <p className="typo-body text-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
