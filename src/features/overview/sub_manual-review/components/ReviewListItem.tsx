import { Cloud } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { reviewStatusLabel, resolveReviewSeverity } from '../libs/reviewHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { AutoResolvedBadge } from './AutoResolvedBadge';
import type { ManualReviewItem } from '@/lib/types/types';

export function SeverityIndicator({ severity }: { severity: string }) {
  const { label: resolved, defaulted } = resolveReviewSeverity(severity);
  const label = defaulted ? `${resolved} (severity unreadable)` : resolved;
  if (severity === 'critical') {
    return (
      <Tooltip content={label}><span className="flex-shrink-0" aria-label={`${label} severity`}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,11 1,11" fill="rgba(239,68,68,0.15)" stroke="rgba(239,68,68,0.5)" strokeWidth="1" />
          <text x="6" y="9.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(239,68,68,0.9)">!</text>
        </svg>
      </span></Tooltip>
    );
  }
  if (severity === 'warning') {
    return (
      <Tooltip content={label}><span className="flex-shrink-0" aria-label={`${label} severity`}>
        <svg width="12" height="12" viewBox="0 0 12 12" className="block">
          <polygon points="6,1 11,6 6,11 1,6" fill="rgba(245,158,11,0.15)" stroke="rgba(245,158,11,0.5)" strokeWidth="1" />
          <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(245,158,11,0.9)">!</text>
        </svg>
      </span></Tooltip>
    );
  }
  return (
    <Tooltip content={label}><span className="flex-shrink-0" aria-label={`${label} severity`}>
      <svg width="12" height="12" viewBox="0 0 12 12" className="block">
        <circle cx="6" cy="6" r="5" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.5)" strokeWidth="1" />
        <text x="6" y="8.5" textAnchor="middle" fontSize="6" fontWeight="bold" fill="rgba(59,130,246,0.9)">i</text>
      </svg>
    </span></Tooltip>
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
        <div key={d.id} className="rounded-card border border-hair bg-surface-1 px-3 py-2.5">
          <div className="flex items-center gap-2">
            {d.category && (
              <span className="typo-eyebrow text-ink-3">{d.category}</span>
            )}
            <span className="typo-body text-ink-1">{d.label}</span>
          </div>
          {d.description && (
            <p className="typo-body text-ink-2 mt-1">{d.description}</p>
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
              <div className="typo-eyebrow mb-1">{key}</div>
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

// A review's status is a decision state: pending is a proposal, approved/rejected are decided,
// resolved is the stale-review sweep's verdict.
const REVIEW_STATE: Record<string, StateMarkState> = {
  pending: 'proposed',
  approved: 'decided',
  rejected: 'refused',
  resolved: 'done',
};

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
  const { t } = useTranslation();
  // `resolved` (the stale-review sweep's verdict) has no colour of its own in
  // the status palette; it reads as informational, never as pending.
  const statusState: StateMarkState = REVIEW_STATE[review.status] ?? 'proposed';
  const statusLabel = reviewStatusLabel(t, review.status);

  return (
    <DecisionRow
      record={{
        id: review.id,
        title: review.persona_name || t.overview.review.unknown_persona,
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
          <StateMark state={statusState} label={statusLabel} />
          {review.source === 'cloud' && (
            <span className="inline-flex items-center gap-1 typo-eyebrow text-role-external">
              <Cloud className="w-3 h-3" />
              {t.overview.review.cloud_badge}
            </span>
          )}
          <AutoResolvedBadge review={review} />
        </>
      }
    />
  );
}
