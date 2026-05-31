import { useEffect, useState } from 'react';
import { Gauge } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { readTranscript } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

interface Props {
  /** Bound Claude session id; null while Spawning. */
  claudeSessionId: string | null;
}

/**
 * Conversation-size efficiency indicator for the CLI header (F2). Reads the
 * session transcript and shows `last_context_tokens` — the size of the context
 * the session re-sends each turn — as a colored pill (green → amber → red as it
 * grows). A glanceable signal of how heavy / efficient a session has become.
 */
export function FleetContextPill({ claudeSessionId }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const [ctx, setCtx] = useState<number | null>(null);

  useEffect(() => {
    if (!claudeSessionId) {
      setCtx(null);
      return;
    }
    let cancelled = false;
    readTranscript(claudeSessionId)
      .then((s) => { if (!cancelled) setCtx(Number(s.lastContextTokens)); })
      .catch(silentCatch('FleetContextPill:readTranscript'));
    return () => { cancelled = true; };
  }, [claudeSessionId]);

  if (ctx === null || ctx <= 0) return null;

  // Lean → large → very large. Crude absolute buckets (a glance signal, not
  // a precise % of any one model's window).
  const tone = ctx > 150_000 ? 'text-red-400' : ctx > 50_000 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <span
      data-testid="fleet-context-pill"
      className={`inline-flex items-center gap-1 text-[11px] tabular-nums ${tone}`}
      title={f.context_size_hint}
    >
      <Gauge className="w-3 h-3" aria-hidden="true" />
      <span className="opacity-80">{f.context_size_label}</span>
      <Numeric value={ctx} unit="count" />
    </span>
  );
}
