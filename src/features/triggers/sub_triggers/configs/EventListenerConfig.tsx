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
        <label className="block typo-body font-medium text-foreground mb-1.5">
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
          className={`w-full px-3 py-2 bg-background/50 border rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring transition-all ${
            validationError
              ? 'border-red-500/30 ring-1 ring-red-500/30'
              : 'border-primary/15 focus-visible:border-primary/40'
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
          <p id="listen-event-error" className="typo-body text-red-400/80 mt-1">{validationError}</p>
        )}
        <p className="typo-caption text-foreground mt-1">
          {t.triggers.event_type_helper}
        </p>
      </div>
      <div>
        <label className="block typo-body font-medium text-foreground mb-1.5">
          {t.triggers.event_listener.source_filter_label} <span className="text-foreground">{t.triggers.source_filter_optional_label}</span>
        </label>
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder={t.triggers.source_filter_input_placeholder}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
        />
        <details className="mt-1 group">
          <summary className="typo-caption text-foreground cursor-pointer hover:text-muted-foreground/80 transition-colors">
            {sourceFilterHelp.title} {t.triggers.wildcard_hint}
          </summary>
          <div className="mt-1 p-2 rounded-card bg-background/40 border border-primary/10 typo-caption text-foreground space-y-1">
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
