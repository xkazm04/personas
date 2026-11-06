import { getEventTypeOptionsGrouped, getSourceFilterHelp } from '@/lib/eventTypeTaxonomy';
import { useTranslation } from '@/i18n/useTranslation';

export interface EventListenerConfigProps {
  listenEventType: string;
  setListenEventType: (v: string) => void;
  sourceFilter: string;
  setSourceFilter: (v: string) => void;
  validationError: string | null;
  setValidationError: (v: string | null) => void;
}

export function EventListenerConfig({
  listenEventType, setListenEventType,
  sourceFilter, setSourceFilter,
  validationError, setValidationError,
}: EventListenerConfigProps) {
  const { t } = useTranslation();
  const groupedOptions = getEventTypeOptionsGrouped(t);
  const sourceFilterHelp = getSourceFilterHelp(t);
  return (
    <div className="space-y-3">
      <div>
        <label className="block typo-body text-ink-1 mb-1.5">
          {t.triggers.event_type_to_listen}
        </label>
        <input
          type="text"
          list="event-type-suggestions"
          value={listenEventType}
          onChange={(e) => { setListenEventType(e.target.value); if (validationError) setValidationError(null); }}
          placeholder={t.triggers.event_type_input_placeholder}
          aria-invalid={!!validationError}
          aria-describedby={validationError ? 'listen-event-error' : undefined}
          className={`w-full px-3 py-2 bg-background/50 border rounded-modal text-ink-1 placeholder-ink-3 focus-ring transition-all ${
            validationError
              ? 'border-status-error/30 ring-1 ring-status-error/30'
              : 'border-hair focus-visible:border-primary/40'
          }`}
        />
        <datalist id="event-type-suggestions">
          {groupedOptions.map((group) =>
            group.options.map((opt) => (
              <option key={opt.value} value={opt.value} label={`${opt.label} — ${opt.description}`} />
            ))
          )}
        </datalist>
        {validationError && (
          <p id="listen-event-error" className="typo-body text-status-error mt-1">{validationError}</p>
        )}
        <p className="typo-caption text-ink-2 mt-1">
          {t.triggers.event_type_helper}
        </p>
      </div>
      <div>
        <label className="block typo-body text-ink-1 mb-1.5">
          {t.triggers.event_listener.source_filter_label} <span className="text-ink-1">{t.triggers.source_filter_optional_label}</span>
        </label>
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder={t.triggers.source_filter_input_placeholder}
          className="w-full px-3 py-2 bg-background/50 border border-hair rounded-modal text-ink-1 placeholder-ink-3 focus-ring focus-visible:border-primary/40 transition-all"
        />
        <details className="mt-1 group">
          <summary className="typo-caption text-ink-1 cursor-pointer hover:text-ink-3 transition-colors">
            {sourceFilterHelp.title} {t.triggers.wildcard_hint}
          </summary>
          <div className="mt-1 p-2 rounded-card bg-background/40 border border-hair typo-caption text-ink-2 space-y-1">
            {sourceFilterHelp.rules.map((r) => (
              <div key={r.pattern} className="flex gap-2">
                <code className="text-primary/80 shrink-0">{r.pattern}</code>
                <span>{r.explanation}</span>
              </div>
            ))}
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {sourceFilterHelp.constraints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
