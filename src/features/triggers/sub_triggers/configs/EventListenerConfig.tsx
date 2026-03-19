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
          value={listenEventType}
          onChange={(e) => { setListenEventType(e.target.value); if (validationError) setValidationError(null); }}
          placeholder="e.g. file_changed, deploy, build_complete"
          aria-invalid={!!validationError}
          aria-describedby={validationError ? 'listen-event-error' : undefined}
          className={`w-full px-3 py-2 bg-background/50 border rounded-xl text-foreground placeholder-muted-foreground/30 focus-ring transition-all ${
            validationError
              ? 'border-red-500/30 ring-1 ring-red-500/30'
              : 'border-primary/15 focus-visible:border-primary/40'
          }`}
        />
        {validationError && (
          <p id="listen-event-error" className="text-sm text-red-400/80 mt-1">{validationError}</p>
        )}
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
        <p className="text-sm text-muted-foreground/80 mt-1">Wildcard suffix supported (e.g. prod-*)</p>
      </div>
    </div>
  );
}
