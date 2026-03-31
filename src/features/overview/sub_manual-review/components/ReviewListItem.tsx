import { ChevronRight, Cloud } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { STATUS_LABELS, SEVERITY_LABELS } from '../libs/reviewHelpers';
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

export function ContextDataPreview({ raw }: { raw: string | null | undefined }) {
  if (!raw) return null;
  let parsed: Record<string, unknown> | null;
  try { parsed = JSON.parse(raw); }
  catch { return <p className="text-sm text-foreground/70 whitespace-pre-wrap">{raw}</p>; }
  if (!parsed || typeof parsed !== 'object') return null;
  return (
    <div className="space-y-1">
      {Object.entries(parsed).map(([key, val]) => (
        <div key={key} className="flex gap-2 text-sm">
          <span className="text-muted-foreground/60 font-mono flex-shrink-0">{key}:</span>
          <span className="text-foreground/80 break-all">{typeof val === 'string' ? val : JSON.stringify(val)}</span>
        </div>
      ))}
    </div>
  );
}

interface InboxItemProps {
  review: ManualReviewItem;
  isActive: boolean;
  onClick: () => void;
}

export function InboxItem({ review, isActive, onClick }: InboxItemProps) {
  const status = STATUS_COLORS[review.status] ?? STATUS_COLORS.pending!;
  const statusLabel = STATUS_LABELS[review.status] ?? 'Pending';

  return (
    <button
      onClick={onClick}
      data-testid={`review-row-${review.id}`}
      className={`w-full text-left px-3 py-2.5 border-b border-primary/[0.06] transition-colors group ${
        isActive ? 'bg-primary/[0.08] border-l-2 border-l-primary' : 'border-l-2 border-l-transparent hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex-shrink-0 mt-0.5">
          <PersonaIcon icon={review.persona_icon ?? null} color={review.persona_color ?? null} display="framed" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="typo-heading text-foreground/90 truncate">{review.persona_name || 'Unknown'}</span>
            <span className="text-sm text-muted-foreground/60 flex-shrink-0">{formatRelativeTime(review.created_at)}</span>
          </div>
          <p className="text-sm text-muted-foreground/70 truncate mt-0.5">{review.content.slice(0, 80)}</p>
          <div className="flex items-center gap-2 mt-1">
            <SeverityIndicator severity={review.severity} />
            <span className={`inline-block px-1.5 py-0.5 rounded typo-caption border ${status.bg} ${status.text} ${status.border}`}>
              {statusLabel}
            </span>
            {review.source === 'cloud' && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded typo-caption bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Cloud className="w-2.5 h-2.5" /> Cloud
              </span>
            )}
          </div>
        </div>
        <ChevronRight className={`w-3.5 h-3.5 mt-1 flex-shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground/30 group-hover:text-muted-foreground/50'}`} />
      </div>
    </button>
  );
}
