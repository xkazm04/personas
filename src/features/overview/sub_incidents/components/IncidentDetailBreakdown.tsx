import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { HighlightedJson } from '@/features/overview/sub_events/HighlightedJson';
import { normalizeIncidentDetail } from '../libs/incidentDetail';

/**
 * Visually structured breakdown of an incident's `detail` payload. Prose shows
 * as-is; `key=value` / JSON payloads become a labelled fact grid — the reading
 * path for non-technical users — with the original JSON kept behind a collapsed
 * "raw" toggle for power users who want the exact payload.
 */
export function IncidentDetailBreakdown({ detail }: { detail: string | null }) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const normalized = normalizeIncidentDetail(detail);

  if (normalized.kind === 'empty') {
    return <p className="typo-body text-foreground">{t.overview.incidents.detail_no_detail}</p>;
  }

  if (normalized.kind === 'prose') {
    return (
      <p className="typo-body text-foreground whitespace-pre-wrap break-words">
        {normalized.prose}
      </p>
    );
  }

  const { facts, rawJson } = normalized;

  // JSON array / scalar with no flat key-value facts — show the colourised
  // payload directly rather than an empty grid.
  if (facts.length === 0) {
    return rawJson ? (
      <div className="rounded-modal border border-primary/10 bg-secondary/20 p-2">
        <HighlightedJson raw={rawJson} />
      </div>
    ) : (
      <p className="typo-body text-foreground">{t.overview.incidents.detail_no_detail}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {facts.map((fact) => (
          <div
            key={fact.label}
            className="min-w-0 rounded-card border border-primary/10 bg-secondary/20 px-3 py-2"
          >
            <dt className="typo-overline text-foreground mb-0.5">{fact.label}</dt>
            <dd className="typo-body text-foreground break-words">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {rawJson && (
        <div>
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            aria-expanded={showRaw}
            className="inline-flex items-center gap-1 typo-caption text-foreground rounded-card px-1.5 py-1 hover:bg-secondary/40 transition-colors focus-ring"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${showRaw ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            {t.overview.incidents.detail_raw_toggle}
          </button>
          {showRaw && (
            <div className="mt-2 rounded-modal border border-primary/10 bg-secondary/20 p-2">
              <HighlightedJson raw={rawJson} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
