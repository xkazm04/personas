import { Plus, X } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { ENGINE_WATCH_EVENTS } from './buildTriggerConfig';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const eventLabels: Record<(typeof ENGINE_WATCH_EVENTS)[number], string> = {
    create: t.triggers.file_watcher.event_create,
    modify: t.triggers.file_watcher.event_modify,
    delete: t.triggers.file_watcher.event_delete,
  };
  return (
    <div className="space-y-3">
      <TriggerFieldGroup label={t.triggers.file_watcher.paths_label} error={validationError} errorId="watch-paths-error">
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
              placeholder={t.triggers.file_watcher_path_placeholder}
              aria-invalid={!!validationError}
              aria-describedby={validationError ? 'watch-paths-error' : undefined}
              className={`flex-1 px-3 py-2 bg-background/50 border rounded-modal text-ink-1 typo-code placeholder-ink-3 focus-ring transition-all ${
                validationError ? 'border-status-error/30' : 'border-hair'
              }`}
            />
            {watchPaths.length > 1 && (
              <button type="button" onClick={() => setWatchPaths(watchPaths.filter((_, j) => j !== i))} className="p-1.5 text-ink-1 hover:text-status-error transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setWatchPaths([...watchPaths, ''])} className="flex items-center gap-1 typo-body text-status-warning hover:text-status-warning transition-colors">
          <Plus className="w-3.5 h-3.5" /> {t.triggers.file_watcher.add_path}
        </button>
      </TriggerFieldGroup>
      <TriggerFieldGroup label={t.triggers.file_watcher.events_label}>
        <div className="flex flex-wrap gap-1.5">
          {ENGINE_WATCH_EVENTS.map((evt) => (
            <button
              key={evt}
              type="button"
              onClick={() => setWatchEvents(prev => prev.includes(evt) ? prev.filter(e => e !== evt) : [...prev, evt])}
              className={`px-2.5 py-1 rounded-modal typo-body transition-all border ${
                watchEvents.includes(evt)
                  ? 'bg-status-warning/15 text-status-warning border-status-warning/30'
                  : 'bg-surface-1 text-ink-1 border-hair hover:bg-surface-2'
              }`}
            >
              {eventLabels[evt]}
            </button>
          ))}
        </div>
      </TriggerFieldGroup>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={watchRecursive} onChange={(e) => setWatchRecursive(e.target.checked)} className="rounded-interactive border-primary/30" />
          <span className="typo-body text-ink-1">{t.triggers.watch_subdirs}</span>
        </label>
      </div>
      <TriggerFieldGroup label={t.triggers.file_watcher.glob_filter} optional>
        <input
          type="text"
          value={globFilter}
          onChange={(e) => setGlobFilter(e.target.value)}
          placeholder={t.triggers.file_watcher_pattern_placeholder}
          className="w-full px-3 py-2 bg-background/50 border border-hair rounded-modal text-ink-1 typo-code placeholder-ink-3 focus-ring transition-all"
        />
      </TriggerFieldGroup>
    </div>
  );
}
