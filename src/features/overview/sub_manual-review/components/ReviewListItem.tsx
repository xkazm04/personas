import { Cloud } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { STATUS_LABELS, SEVERITY_LABELS } from '../libs/reviewHelpers';
import { AutoResolvedBadge } from './AutoResolvedBadge';
import type { ManualReviewItem } from '@/lib/types/types';

export function SeverityIndicator({ severity }: { severity: string }) {
  const label = SEVERITY_LABELS[severity] ?? 'Info';
  if (severity === 'critical') {
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,11 1,11" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(239,68,68,0.9)">!</text>
        </svg>
      </span>
    );
  }
  if (severity === 'warning') {
    return (
      <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,6 6,11 1,6" fill="rgba(245,158,11,0.15)" stroke="rgba(245,158,11,0.5)" strokeWidth="1" />
          <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(245,158,11,0.9)">!</text>
        </svg>
      </span>
    );
  }
  return (
    <span className="flex-shrink-0" aria-label={`${label} severity`} title={label}>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <circle cx="6" cy="6" r="5" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
        <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(59,130,246,0.9)">i</text>
      </svg>
    </span>
  );
}

interface DecisionItem {
  id: string;
  label: string;
  description?: string;
  category?: string;
}

function DecisionCards({ decisions }: { decisions: DecisionItem[] }) {
  return (
    <div className="space-y-2">
      {decisions.map((d) => (
        <div key={d.id} className="rounded-card border border-primary/10 bg-secondary/20 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {d.category && (
              <span className="typo-caption font-medium text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded">{d.category}</span>
            )}
            <span className="typo-body font-medium text-foreground">{d.label}</span>
          </div>
          {d.description && (
            <p className="typo-body text-foreground mt-1 leading-relaxed">{d.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export function ContextDataPreview({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  let parsed: Record<string, unknown> | null;
  try { parsed = JSON.parse(raw); }
  catch { return <p className="typo-body text-foreground whitespace-pre-wrap">{raw}</p>; }
  if (!parsed || typeof parsed !== 'object') return null;

  // Detect decisions array and render as readable cards
  if (Array.isArray(parsed.decisions) && parsed.decisions.length > 0) {
    return <DecisionCards decisions={parsed.decisions as DecisionItem[]} />;
  }

  return (
    <div className="space-y-1.5">
      {Object.entries(parsed).map(([key, val]) => {
        // Render arrays of objects as mini-cards
        if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
          return (
            <div key={key}>
              <div className="typo-code font-mono text-foreground uppercase mb-1">{key}</div>
              <DecisionCards decisions={val as DecisionItem[]} />
            </div>
          );
        }
        return (
          <div key={key} className="flex gap-2 typo-body">
            <span className="text-foreground font-mono flex-shrink-0">{key}:</span>
            <span className="text-foreground break-all">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
          </div>
        );
      })}
    </div>
  );
}

interface InboxItemProps {
  review: ManualReviewItem;
  isActive: boolean;
  onClick: () => void;
}

/**
 * Renders through the SHARED `DecisionRow` — the same component the Dev Tools
 * backlog and the Workspace Knowledge library use. This row's hierarchy
 * (persona icon, heading-weight name, muted content line, subordinate meta) was
 * the reference the shared component was generalized FROM, so adopting it
 * changes nothing visually; it just means the three decision streams can no
 * longer drift apart. The review-specific signals — severity glyph, status
 * pill, cloud badge, auto-resolved badge — ride in the `meta` slot.
 */
export function InboxItem({ review, isActive, onClick }: InboxItemProps) {
  const status = STATUS_COLORS[review.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.pending;
  const statusLabel = STATUS_LABELS[review.status] ?? 'Pending';

  return (
    <DecisionRow
      record={{
        id: review.id,
        title: review.persona_name || 'Unknown',
        summary: review.content.slice(0, 80),
        timestamp: review.created_at,
      }}
      testId={`review-row-${review.id}`}
      active={isActive}
      onOpen={onClick}
      leading={
        <PersonaIcon
          icon={review.persona_icon ?? null}
          color={review.persona_color ?? null}
          display="framed"
          frameSize="lg"
        />
      }
      meta={
        <>
          <SeverityIndicator severity={review.severity} />
          <span className={`inline-block px-1.5 py-0.5 rounded typo-caption border ${status.bg} ${status.text} ${status.border}`}>
            {statusLabel}
          </span>
          {review.source === 'cloud' && (
            <StatusBadge accent="indigo" size="sm" className="rounded typo-caption" icon={<Cloud className="w-2.5 h-2.5" />}>
              Cloud
            </StatusBadge>
          )}
          <AutoResolvedBadge review={review} />
        </>
      }
    />
  );
}
