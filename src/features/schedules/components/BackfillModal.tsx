import { useMemo, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { X, History, Check, AlertTriangle } from 'lucide-react';
import type { CronAgent } from '@/lib/bindings/CronAgent';
import type { BackfillResult } from '@/api/pipeline/scheduler';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

interface BackfillModalProps {
  agent: CronAgent;
  currentSchedule: string;
  isRunning: boolean;
  lastResult: BackfillResult | null;
  onBackfill: (startIso: string, endIso: string) => Promise<void>;
  onCancel: () => void;
}

const QUICK_RANGES = [
  { id: 'last_hour', hours: 1 },
  { id: 'last_24h', hours: 24 },
  { id: 'last_7d', hours: 24 * 7 },
] as const;

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export default function BackfillModal({
  agent,
  currentSchedule,
  isRunning,
  lastResult,
  onBackfill,
  onCancel,
}: BackfillModalProps) {
  const { t, tx } = useTranslation();
  const now = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => new Date(now.getTime() - 24 * 3_600_000), [now]);

  const [start, setStart] = useState(() => toLocalInput(defaultStart));
  const [end, setEnd] = useState(() => toLocalInput(now));

  const startDate = new Date(start);
  const endDate = new Date(end);
  const validRange =
    !isNaN(startDate.getTime()) &&
    !isNaN(endDate.getTime()) &&
    endDate.getTime() > startDate.getTime();
  const windowInFuture = endDate.getTime() > Date.now();

  const handleQuickRange = (hours: number) => {
    const e = new Date();
    const s = new Date(e.getTime() - hours * 3_600_000);
    setStart(toLocalInput(s));
    setEnd(toLocalInput(e));
  };

  const handleSubmit = async () => {
    if (!validRange) return;
    await onBackfill(startDate.toISOString(), endDate.toISOString());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 surface-blur-modal">
      <div className="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 w-[520px] max-w-[calc(100%-2rem)] mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 bg-primary/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-card bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
              <History className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="typo-heading text-foreground/90">{t.schedules.backfill_title}</h3>
              <p className="typo-caption text-foreground">{agent.persona_name}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={isRunning}
            className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="typo-caption text-foreground">
            {t.schedules.backfill_intro}{' '}
            <span className="font-mono text-foreground">{currentSchedule}</span>
          </div>

          <div>
            <p className="typo-caption text-foreground mb-2">{t.schedules.backfill_quick_ranges}</p>
            <div className="flex gap-1.5">
              {QUICK_RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => handleQuickRange(r.hours)}
                  disabled={isRunning}
                  className="flex-1 px-2.5 py-2 typo-caption rounded-card border bg-secondary/40 border-primary/10 text-foreground hover:bg-secondary/60 hover:border-primary/20 transition-all disabled:opacity-40"
                >
                  {t.schedules[`backfill_range_${r.id}` as const]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="typo-caption text-foreground block mb-1">
                {t.schedules.backfill_start}
              </label>
              <input
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={isRunning}
                className="w-full px-3 py-2 typo-code font-mono bg-secondary/40 border border-primary/15 rounded-card text-foreground/90 focus-visible:outline-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20 disabled:opacity-40"
              />
            </div>
            <div>
              <label className="typo-caption text-foreground block mb-1">
                {t.schedules.backfill_end}
              </label>
              <input
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={isRunning}
                className="w-full px-3 py-2 typo-code font-mono bg-secondary/40 border border-primary/15 rounded-card text-foreground/90 focus-visible:outline-none focus-visible:border-primary/30 focus-visible:ring-1 focus-visible:ring-primary/20 disabled:opacity-40"
              />
            </div>
          </div>

          {!validRange && (
            <div className="flex items-start gap-2 p-2.5 rounded-card border bg-red-500/5 border-red-500/15 text-red-400/90 typo-caption">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{t.schedules.backfill_invalid_range}</span>
            </div>
          )}
          {validRange && windowInFuture && (
            <div className="flex items-start gap-2 p-2.5 rounded-card border bg-amber-500/5 border-amber-500/15 text-amber-400/90 typo-caption">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
              <span>{t.schedules.backfill_future_clipped}</span>
            </div>
          )}

          {lastResult && (
            <div
              className={`p-3 rounded-card border ${
                lastResult.capped
                  ? 'bg-amber-500/5 border-amber-500/15 text-amber-400/90'
                  : 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400/90'
              }`}
            >
              <div className="flex items-center gap-2 typo-caption font-medium mb-1">
                <Check className="w-4 h-4" />
                {tx(t.schedules.backfill_result_enqueued, { count: lastResult.slotsEnqueued })}
                {lastResult.failures > 0 && (
                  <span className="text-red-400/90 ml-1">
                    {tx(t.schedules.backfill_result_failed, { count: lastResult.failures })}
                  </span>
                )}
              </div>
              {lastResult.capped && (
                <p className="typo-caption">{t.schedules.backfill_result_capped}</p>
              )}
              {lastResult.slotTimes.length > 0 && (
                <details className="mt-2">
                  <summary className="typo-caption cursor-pointer text-foreground hover:text-foreground">
                    {t.schedules.backfill_result_show_slots}
                  </summary>
                  <div className="mt-2 max-h-32 overflow-y-auto space-y-0.5">
                    {lastResult.slotTimes.slice(0, 50).map((iso) => (
                      <p key={iso} className="font-mono text-[11px] text-foreground">
                        {<AbsoluteTime timestamp={iso} />}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-primary/10 bg-primary/[0.02]">
          <button
            onClick={onCancel}
            disabled={isRunning}
            className="px-3 py-1.5 typo-caption rounded-card border border-primary/15 text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-40"
          >
            {t.common.close}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!validRange || isRunning}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card border border-amber-500/30 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 transition-colors disabled:opacity-40"
          >
            {isRunning ? (
              <>
                <LoadingSpinner size="sm" />
                {t.schedules.backfill_running}
              </>
            ) : (
              <>
                <History className="w-3.5 h-3.5" />
                {t.schedules.backfill_run}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
