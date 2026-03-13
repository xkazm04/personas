import { Plus, X } from 'lucide-react';

export interface FileWatcherConfigProps {
  watchPaths: string[];
  setWatchPaths: (v: string[]) => void;
  watchEvents: string[];
  setWatchEvents: React.Dispatch<React.SetStateAction<string[]>>;
  watchRecursive: boolean;
  setWatchRecursive: (v: boolean) => void;
  globFilter: string;
  setGlobFilter: (v: string) => void;
  validationError: string | null;
  setValidationError: (v: string | null) => void;
}

export function FileWatcherConfig({
  watchPaths, setWatchPaths, watchEvents, setWatchEvents,
  watchRecursive, setWatchRecursive, globFilter, setGlobFilter,
  validationError, setValidationError,
}: FileWatcherConfigProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Watch Paths
        </label>
        {watchPaths.map((path, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5">
            <input
              type="text"
              value={path}
              onChange={(e) => {
                const updated = [...watchPaths];
                updated[i] = e.target.value;
                setWatchPaths(updated);
                if (validationError) setValidationError(null);
              }}
              placeholder="C:\Users\me\projects or /home/me/src"
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'watch-paths-error' : undefined}
              className={`flex-1 px-3 py-2 bg-background/50 border rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 transition-all ${
                validationError ? 'border-red-500/30' : 'border-primary/15 focus:ring-orange-400/40'
              }`}
            />
            {watchPaths.length > 1 && (
              <button type="button" onClick={() => setWatchPaths(watchPaths.filter((_, j) => j !== i))} className="p-1.5 text-muted-foreground/60 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setWatchPaths([...watchPaths, ''])} className="flex items-center gap-1 text-sm text-orange-400/80 hover:text-orange-400 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Add path
        </button>
        {validationError && <p id="watch-paths-error" className="text-sm text-red-400/80 mt-1">{validationError}</p>}
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">File Events</label>
        <div className="flex flex-wrap gap-1.5">
          {(['create', 'modify', 'delete', 'rename'] as const).map((evt) => (
            <button
              key={evt}
              type="button"
              onClick={() => setWatchEvents(prev => prev.includes(evt) ? prev.filter(e => e !== evt) : [...prev, evt])}
              className={`px-2.5 py-1 rounded-xl text-sm font-medium transition-all border ${
                watchEvents.includes(evt)
                  ? 'bg-orange-500/15 text-orange-400 border-orange-500/30'
                  : 'bg-secondary/30 text-muted-foreground/80 border-border/30 hover:bg-secondary/50'
              }`}
            >
              {evt}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={watchRecursive} onChange={(e) => setWatchRecursive(e.target.checked)} className="rounded border-primary/30" />
          <span className="text-sm text-foreground/80">Watch subdirectories recursively</span>
        </label>
      </div>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Glob Filter <span className="text-muted-foreground/50">(optional)</span>
        </label>
        <input
          type="text"
          value={globFilter}
          onChange={(e) => setGlobFilter(e.target.value)}
          placeholder="e.g. *.py, *.{ts,tsx}, Dockerfile"
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground font-mono text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-orange-400/40 transition-all"
        />
      </div>
    </div>
  );
}
