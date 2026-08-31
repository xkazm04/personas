import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { getAttentionLoopStatus } from '@/api/agents/personaBrain';
import { setAppSetting } from '@/api/system/settings';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { PaneHeader } from '../PaneHeader';
import type { AttentionLoopStatus } from '@/lib/bindings/AttentionLoopStatus';

/** `settings_keys::AUTONOMOUS_ATTENTION_LOOP` — boolean-validated, default off.
 *  The toggle lives HERE because no global-autonomy settings panel exists:
 *  none of the sibling `autonomous_*` flags surface anywhere in settings UI. */
const ATTENTION_LOOP_KEY = 'autonomous_attention_loop';

// Same verdict tone map the attention-ledger strip uses (sub_life), extended
// with the loop's two dispatch verdicts; unknown verdicts render neutral.
const VERDICT_VARIANT: Record<string, StatusVariant> = {
  started: 'processing',
  acted: 'success',
  dispatched: 'success',
  enqueued: 'processing',
  noop: 'neutral',
  refused: 'warning',
  failed: 'error',
};

/**
 * Mission Control status card for the living-agent attention loop: the global
 * on/off switch, the newest ledger pass, and today's dispatched / refused /
 * consolidation counts. Null-honesty: an unfetched or failed read shows a
 * ghost / an unavailable line — never fabricated zeros; "no activity yet" is
 * only shown once a real read returned an empty ledger.
 */
export default function AttentionLoopCard() {
  const { t } = useTranslation();
  const loop = t.overview.attention_loop;
  const life = t.agents.life;
  const [status, setStatus] = useState<AttentionLoopStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const fetchingRef = useRef(false);

  // Mount + 30s/visibility refetch, mirroring UpcomingRoutinesCard: the loop
  // ticks in the background, so a session-long card must roll its readout.
  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      getAttentionLoopStatus()
        .then((s) => {
          if (!cancelled) {
            setStatus(s);
            setFailed(false);
          }
        })
        .catch((err: unknown) => {
          // A failed read is NOT an empty ledger: keep whatever was loaded and
          // flag the failure so the cold path says "unavailable", not "off/0".
          if (!cancelled) setFailed(true);
          silentCatch('dashboard/AttentionLoopCard')(err);
        })
        .finally(() => {
          fetchingRef.current = false;
        });
    };
    refetch();
    const tick = () => {
      if (!document.hidden) refetch();
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const toggle = async () => {
    if (!status || saving) return;
    const next = !status.enabled;
    setSaving(true);
    try {
      await setAppSetting(ATTENTION_LOOP_KEY, next ? 'true' : 'false');
      setStatus((s) => (s ? { ...s, enabled: next } : s));
    } catch (err) {
      toastCatch('dashboard/AttentionLoopCard:toggle', loop.toggle_failed)(err);
    } finally {
      setSaving(false);
    }
  };

  const kindLabels: Record<string, string> = {
    attention: life.ledger_kind_attention,
    consolidation: life.ledger_kind_consolidation,
  };
  const verdictLabels: Record<string, string> = {
    started: life.ledger_verdict_started,
    acted: life.ledger_verdict_acted,
    noop: life.ledger_verdict_noop,
    refused: life.ledger_verdict_refused,
    failed: life.ledger_verdict_failed,
  };

  const latest = status?.summary.latest ?? null;

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden" data-testid="attention-loop-card">
      <PaneHeader label={loop.title} subtitle={loop.subtitle}>
        {status && (
          <div className="flex items-center gap-2">
            <span className={`typo-caption font-mono uppercase tracking-widest ${status.enabled ? 'text-emerald-400' : 'text-foreground'}`}>
              {status.enabled ? loop.on : loop.off}
            </span>
            <AccessibleToggle
              checked={status.enabled}
              onChange={() => void toggle()}
              label={loop.toggle_label}
              size="sm"
              disabled={saving}
              data-testid="attention-loop-toggle"
            />
          </div>
        )}
      </PaneHeader>
      {status === null ? (
        failed ? (
          <p className="typo-caption px-3 py-4 text-foreground">{loop.unavailable}</p>
        ) : (
          <LoopGhost />
        )
      ) : (
        <div className="px-3 py-3 space-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="typo-caption font-mono uppercase tracking-widest text-foreground flex-shrink-0">
              {loop.last_activity}
            </span>
            {latest ? (
              <>
                <StatusBadge size="sm" accent={latest.kind === 'consolidation' ? 'violet' : 'cyan'}>
                  {kindLabels[latest.kind] ?? latest.kind}
                </StatusBadge>
                {latest.lane && <span className="typo-code text-foreground/85 truncate">{latest.lane}</span>}
                <StatusBadge size="sm" variant={VERDICT_VARIANT[latest.verdict] ?? 'neutral'}>
                  {verdictLabels[latest.verdict] ?? latest.verdict}
                </StatusBadge>
                <RelativeTime timestamp={latest.startedAt} className="typo-caption ml-auto flex-shrink-0" />
              </>
            ) : (
              <span className="typo-caption text-foreground">{loop.none_yet}</span>
            )}
          </div>
          <div className="flex items-center gap-4 pt-2 border-t border-primary/5">
            <span className="typo-caption font-mono uppercase tracking-widest text-foreground">{loop.today_label}</span>
            <TodayStat value={Number(status.summary.dispatchedToday)} label={loop.today_dispatched} tone="text-emerald-400" />
            <TodayStat value={Number(status.summary.refusedToday)} label={loop.today_refused} tone="text-amber-400" />
            <TodayStat value={Number(status.summary.consolidationsToday)} label={loop.today_consolidations} tone="text-violet-400" />
          </div>
        </div>
      )}
    </div>
  );
}

function TodayStat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-mono tabular-nums typo-body ${value > 0 ? tone : 'text-foreground'}`}>{value}</span>
      <span className="typo-caption text-foreground">{label}</span>
    </span>
  );
}

// Calm geometry-matched ghost for the only moment the body has nothing yet
// (first fetch in flight). Delayed fade-in so a fast fetch never paints it.
function LoopGhost() {
  return (
    <div className="px-3 py-3 space-y-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="h-5 rounded bg-primary/[0.06] animate-fade-in"
          style={{ animationDelay: `${120 + i * 35}ms` }}
        />
      ))}
    </div>
  );
}
