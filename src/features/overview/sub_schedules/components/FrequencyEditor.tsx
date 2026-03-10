import { useState, useEffect } from 'react';
import { X, Clock, Check } from 'lucide-react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { CronPreview } from '@/api/pipeline/triggers';
import { CRON_PRESETS } from '../libs/scheduleHelpers';

interface FrequencyEditorProps {
  agent: CronAgent;
  currentSchedule: string;
  onSave: (cron: string | null, intervalSeconds: number | null) => void;
  onCancel: () => void;
  onPreviewCron: (expression: string) => Promise<CronPreview | null>;
}

export default function FrequencyEditor({
  agent,
  currentSchedule,
  onSave,
  onCancel,
  onPreviewCron,
}: FrequencyEditorProps) {
  const [mode, setMode] = useState<'preset' | 'custom'>(
    agent.cron_expression ? 'custom' : 'preset',
  );
  const [cronInput, setCronInput] = useState(agent.cron_expression || '');
  const [intervalInput, setIntervalInput] = useState(
    agent.interval_seconds ? String(agent.interval_seconds) : '',
  );
  const [preview, setPreview] = useState<CronPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Live preview for custom cron
  useEffect(() => {
    if (mode !== 'custom' || !cronInput.trim()) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      const result = await onPreviewCron(cronInput.trim());
      setPreview(result);
      setPreviewLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, [cronInput, mode, onPreviewCron]);

  const handlePresetSelect = (cron: string) => {
    setCronInput(cron);
    setMode('custom');
  };

  const handleSave = () => {
    if (mode === 'custom' && cronInput.trim()) {
      onSave(cronInput.trim(), null);
    } else if (intervalInput) {
      onSave(null, parseInt(intervalInput, 10));
    }
  };

  const isValid = mode === 'custom'
    ? !!cronInput.trim() && (!preview || preview.valid)
    : !!intervalInput && !isNaN(parseInt(intervalInput, 10));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-500/15 border border-blue-500/25 flex items-center justify-center">
              <Clock className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground/90">Change Frequency</h3>
              <p className="text-xs text-muted-foreground/70">{agent.persona_name}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Current schedule */}
          <div className="text-xs text-muted-foreground/60">
            Current: <span className="font-mono text-muted-foreground/90">{currentSchedule}</span>
          </div>

          {/* Quick presets */}
          <div>
            <p className="text-xs font-medium text-muted-foreground/80 mb-2">Quick presets</p>
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map((preset) => (
                <button
                  key={preset.cron}
                  onClick={() => handlePresetSelect(preset.cron)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                    cronInput === preset.cron
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                      : 'bg-secondary/40 border-primary/10 text-muted-foreground/70 hover:bg-secondary/60 hover:text-foreground/80'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('custom')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                mode === 'custom'
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
              }`}
            >
              Cron expression
            </button>
            <button
              onClick={() => setMode('preset')}
              className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                mode === 'preset'
                  ? 'bg-primary/10 border-primary/25 text-foreground/90'
                  : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
              }`}
            >
              Interval (seconds)
            </button>
          </div>

          {/* Input */}
          {mode === 'custom' ? (
            <div className="space-y-2">
              <input
                type="text"
                value={cronInput}
                onChange={(e) => setCronInput(e.target.value)}
                placeholder="*/15 * * * *"
                className="w-full px-3 py-2 text-sm font-mono bg-secondary/40 border border-primary/15 rounded-lg text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
              />
              {/* Preview */}
              {previewLoading && (
                <p className="text-xs text-muted-foreground/50">Previewing...</p>
              )}
              {preview && !previewLoading && (
                <div className={`text-xs space-y-1 p-2.5 rounded-lg border ${
                  preview.valid
                    ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400/90'
                    : 'bg-red-500/5 border-red-500/15 text-red-400/90'
                }`}>
                  {preview.valid ? (
                    <>
                      <p className="font-medium">{preview.description}</p>
                      {preview.next_runs.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          <p className="text-muted-foreground/50 text-[10px] uppercase tracking-wider">Next runs</p>
                          {preview.next_runs.slice(0, 3).map((run, i) => (
                            <p key={i} className="font-mono text-[11px] text-muted-foreground/70">
                              {new Date(run).toLocaleString()}
                            </p>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <p>{preview.error || 'Invalid cron expression'}</p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <input
              type="number"
              value={intervalInput}
              onChange={(e) => setIntervalInput(e.target.value)}
              placeholder="300"
              min={10}
              className="w-full px-3 py-2 text-sm font-mono bg-secondary/40 border border-primary/15 rounded-lg text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20"
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10 bg-primary/[0.03]">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-lg border border-primary/10 bg-secondary/30 text-muted-foreground/70 hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-blue-500/30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-3 h-3" />
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
