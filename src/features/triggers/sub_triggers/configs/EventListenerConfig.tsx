import { EVENT_TYPE_OPTIONS_GROUPED, SOURCE_FILTER_HELP } from '@/lib/eventTypeTaxonomy';

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
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Event Type to Listen For
        </label>
        <input
          type="text"
          list="event-type-suggestions"
          value={listenEventType}
          onChange={(e) => { setListenEventType(e.target.value); if (validationError) setValidationError(null); }}
          placeholder="e.g. file_changed, execution_completed"
          aria-invalid={!!validationError}
          aria-describedby={validationError ? 'listen-event-error' : undefined}
          className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring transition-all ${
            validationError
              ? 'border-red-500/30 ring-1 ring-red-500/30'
              : 'border-primary/15 focus-visible:border-primary/40'
          }`}
        />
        <datalist id="event-type-suggestions">
          {EVENT_TYPE_OPTIONS_GROUPED.map((group) =>
            group.options.map((opt) => (
              <option key={opt.value} value={opt.value} label={`${opt.label} — ${opt.description}`} />
            ))
          )}
        </datalist>
        {validationError && (
          <p id="listen-event-error" className="text-sm text-red-400/80 mt-1">{validationError}</p>
        )}
        <p className="text-xs text-muted-foreground/50 mt-1">
          Type to search registered event types, or enter a custom type.
        </p>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Source Filter <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          type="text"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          placeholder="e.g. watcher-* or exact-source-id"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
        />
        <details className="mt-1 group">
          <summary className="text-xs text-muted-foreground/60 cursor-pointer hover:text-muted-foreground/80 transition-colors">
            {SOURCE_FILTER_HELP.title} — trailing * prefix wildcard supported
          </summary>
          <div className="mt-1 p-2 rounded-lg bg-background/40 border border-primary/10 text-xs text-muted-foreground/70 space-y-1">
            {SOURCE_FILTER_HELP.rules.map((r) => (
              <div key={r.pattern} className="flex gap-2">
                <code className="text-primary/80 shrink-0">{r.pattern}</code>
                <span>{r.explanation}</span>
              </div>
            ))}
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {SOURCE_FILTER_HELP.constraints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
