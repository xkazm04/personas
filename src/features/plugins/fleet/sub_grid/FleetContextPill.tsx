import { useEffect, useState } from 'react';
import { Gauge, Minimize2 } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { readTranscript } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Context size (tokens) above which a session is "bloated" — re-sending a heavy
 * conversation on every turn. Mirrors the Rust `CONTEXT_BLOAT_TOKENS` constant
 * (`src-tauri/src/commands/fleet/transcript_read.rs`); keep the two in sync.
 */
const BLOAT_TOKENS = 150_000;

interface Props {
  /** Bound Claude session id; null while Spawning. */
  claudeSessionId: string | null;
  /** Internal fleet session id — required to enable the inline Compact action. */
  sessionId?: string;
  /** Session is between turns (idle/awaiting/stale) so `/compact` will take.
   *  When false the action still renders but is disabled with a hint. */
  canCompact?: boolean;
  /** Invoked with the internal `sessionId` when the user clicks Compact. */
  onCompact?: (sessionId: string) => void;
}

/**
 * Conversation-size efficiency indicator for the CLI header (F2). Reads the
 * session transcript and shows `last_context_tokens` — the size of the context
 * the session re-sends each turn — as a colored pill (green → amber → red as it
 * grows). When the session is red (bloated) and an `onCompact` handler is wired,
 * it also offers an inline **Compact** action: the remedy sits exactly where the
 * problem is surfaced, since `/compact` collapses the conversation to a summary
 * and cuts per-turn cost for the rest of the run.
 */
export function FleetContextPill({ claudeSessionId, sessionId, canCompact = false, onCompact }: Props) {
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
  const tone = ctx > BLOAT_TOKENS ? 'text-red-400' : ctx > 50_000 ? 'text-amber-400' : 'text-emerald-400';
  // Offer the remedy only where the problem is real: a red (bloated) session
  // re-sends its whole conversation every turn, so compacting it cuts per-turn
  // cost for the rest of the run.
  const showCompact = ctx > BLOAT_TOKENS && !!onCompact && !!sessionId;

  return (
    <span className="inline-flex items-center gap-2">
      <span
        data-testid="fleet-context-pill"
        className={`inline-flex items-center gap-1 text-[13px] tabular-nums ${tone}`}
        title={f.context_size_hint}
      >
        <Gauge className="w-3 h-3" aria-hidden="true" />
        <span className="opacity-80">{f.context_size_label}</span>
        <Numeric value={ctx} unit="count" />
      </span>
      {showCompact && (
        <button
          type="button"
          data-testid="fleet-context-compact"
          disabled={!canCompact}
          onClick={() => onCompact!(sessionId!)}
          title={canCompact ? f.compact_hint : f.compact_unavailable_hint}
          className="inline-flex items-center gap-1 rounded-card border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[12px] text-amber-300 transition-colors hover:bg-amber-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Minimize2 className="w-3 h-3" aria-hidden="true" />
          {f.compact_button}
        </button>
      )}
    </span>
  );
}
