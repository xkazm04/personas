import { HelpCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { classifyEventReason } from './eventReason';

interface ReasonEvent {
  status: string;
  error_message: string | null;
}

/** Resolve one machine token to its translated label. */
function useReasonLabel() {
  const { t } = useTranslation();
  return {
    t,
    label: (token: string) => tokenLabel(t, 'event_reason', token),
  };
}

/**
 * Compact inline reason — for dense table rows.
 *
 * Renders the resolved gate token(s) when the bus recorded why nothing ran, a
 * quiet "unknown" for pre-ledger rows that ended without delivering, and
 * nothing at all for events that dispatched cleanly. Free-form failure text is
 * deliberately NOT shown here (it belongs in the detail view); the row just
 * marks that an error message exists.
 */
export function EventReasonChip({ event }: { event: ReasonEvent }) {
  const { t, label } = useReasonLabel();
  const reason = classifyEventReason(event);

  if (reason.kind === 'none') return null;

  if (reason.kind === 'unknown') {
    return (
      <span
        className="inline-flex items-center gap-1 typo-caption text-foreground"
        title={t.triggers.event_reason_unknown_hint}
      >
        <HelpCircle className="w-3 h-3 shrink-0" />
        {t.triggers.event_reason_unknown}
      </span>
    );
  }

  if (reason.kind === 'text') {
    return (
      <span className="typo-caption text-red-400/90 truncate" title={reason.text}>
        {reason.text}
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-1 min-w-0">
      {reason.tokens.map((token) => (
        <span
          key={token}
          className="typo-caption px-1.5 py-0.5 rounded-card border border-primary/15 bg-secondary/40 text-foreground truncate"
        >
          {label(token)}
        </span>
      ))}
    </span>
  );
}

/**
 * Block reason — for detail cards (dead-letter rows, event detail modal).
 * Same classification, but free-form failure text is rendered in full.
 */
export function EventReasonNote({ event }: { event: ReasonEvent }) {
  const { t, label } = useReasonLabel();
  const reason = classifyEventReason(event);

  if (reason.kind === 'none') return null;

  if (reason.kind === 'text') {
    return (
      <div className="typo-code text-red-300/80 bg-red-500/10 rounded px-2.5 py-1.5 font-mono break-all">
        {reason.text}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="typo-caption text-foreground">{t.triggers.event_reason_label}</span>
      {reason.kind === 'unknown' ? (
        <span
          className="inline-flex items-center gap-1 typo-caption px-1.5 py-0.5 rounded-card border border-primary/15 bg-secondary/40 text-foreground"
          title={t.triggers.event_reason_unknown_hint}
        >
          <HelpCircle className="w-3 h-3 shrink-0" />
          {t.triggers.event_reason_unknown}
        </span>
      ) : (
        reason.tokens.map((token) => (
          <span
            key={token}
            className="typo-caption px-1.5 py-0.5 rounded-card border border-primary/15 bg-secondary/40 text-foreground"
          >
            {label(token)}
          </span>
        ))
      )}
    </div>
  );
}
