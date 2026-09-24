import { useEffect, useState } from 'react';
import { Gauge, Minimize2 } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { readTranscript, sessionMetadata } from '@/api/fleet/fleet';
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
    // Prefer the incremental per-session rollup (folds only newly-appended
    // transcript bytes) — a 40-tile grid mounting 40 pills must not trigger 40
    // full multi-MB JSONL parses. Whole-file read only on a rollup miss.
    sessionMetadata(claudeSessionId)
      .then((s) => (s ? s : readTranscript(claudeSessionId)))
      .then((s) => { if (!cancelled) setCtx(Number(s.lastContextTokens)); })
      .catch(silentCatch('FleetContextPill:sessionMetadata'));
    return () => { cancelled = true; };
  }, [claudeSessionId]);

  if (ctx === null || ctx <= 0) return null;

  // Lean → large → very large. Crude absolute buckets (a glance signal, not
  // a precise % of any one model's window).
  // A size verdict, so a status: lean is success, large a warning, bloated an error.
  const tone = ctx > BLOAT_TOKENS ? 'text-status-error' : ctx > 50_000 ? 'text-status-warning' : 'text-status-success';
  // Offer the remedy only where the problem is real: a red (bloated) session
  // re-sends its whole conversation every turn, so compacting it cuts per-turn
  // cost for the rest of the run.
  const showCompact = ctx > BLOAT_TOKENS && !!onCompact && !!sessionId;

  // Disabled while the session is mid-turn; the Button's own disabledReason explains why.
  const compact = (
    <Button
      variant="accent"
      tone="warning"
      size="xs"
      data-testid="fleet-context-compact"
      icon={<Minimize2 className="w-3 h-3" aria-hidden="true" />}
      disabled={!canCompact}
      disabledReason={f.compact_unavailable_hint}
      onClick={() => onCompact!(sessionId!)}
    >
      {f.compact_button}
    </Button>
  );

  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip content={f.context_size_hint}>
        <span data-testid="fleet-context-pill" className={`inline-flex items-center gap-1 typo-body tabular-nums ${tone}`}>
          <Gauge className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{f.context_size_label}</span>
          <Numeric value={ctx} unit="count" />
        </span>
      </Tooltip>
      {showCompact && (canCompact ? <Tooltip content={f.compact_hint}>{compact}</Tooltip> : compact)}
    </span>
  );
}
