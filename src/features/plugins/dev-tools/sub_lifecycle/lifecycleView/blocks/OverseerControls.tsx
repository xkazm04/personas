/**
 * The Lifecycle page's hand-off to the Overseer, sized for the ContentHeader
 * `actions` slot: a star that puts the project on his watch list, and "Send to
 * Overseer", which files the "All steps green" goal plus one item per
 * non-green step.
 *
 * Not optimistic: the star shows what `setLifecycleWatch` RETURNED, seeded from
 * the snapshot and re-synced whenever the snapshot changes. The companion
 * speaks inline only - a result line after a send, a Banner on a failure,
 * never a toast. With the Overseer switched off the star still saves, and a
 * hint on a watched project says auto-measure waits for him.
 */
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import { setLifecycleWatch, sendLifecycleToOverseer } from '@/api/devTools/lifecycle';
import { useCompanionsStatus } from '@/features/companions/status/useCompanionsStatus';
import { CompanionMark } from '@/features/fleet/monitor/grid/prototype/entry-e/CompanionMark';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';
import type { LifecycleSendResult } from '@/lib/bindings/LifecycleSendResult';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

export interface OverseerControlsProps {
  projectId: string;
  /** The snapshot's star; the control re-syncs to it whenever it changes. */
  watched: boolean;
  /** The Overseer goal already filed for this project, or null when none is. */
  goal: LifecycleGoalView | null;
}

export function OverseerControls({ projectId, watched, goal }: OverseerControlsProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const overseer = useCompanionsStatus().byId('overseer');
  // Unknown (first read in flight) is not "off": the hint never guesses.
  const overseerOff = overseer != null && !overseer.enabled;

  const [isWatched, setIsWatched] = useState(watched);
  const [starBusy, setStarBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<LifecycleSendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A reply that lands after the picker moved on belongs to the old project.
  const current = useRef(projectId);
  useEffect(() => {
    current.current = projectId;
    setResult(null);
    setError(null);
  }, [projectId]);
  useEffect(() => setIsWatched(watched), [watched, projectId]);

  const fail = (context: string, forProject: string) => (err: unknown) => {
    silentCatch(context)(err);
    if (current.current === forProject) setError(resolveError(extractMessage(err)).message);
  };

  const toggleStar = async () => {
    const forProject = projectId;
    setStarBusy(true);
    setError(null);
    try {
      const next = await setLifecycleWatch(forProject, !isWatched);
      if (current.current === forProject) setIsWatched(next);
    } catch (err) {
      fail('lifecycle:set_watch', forProject)(err);
    } finally {
      setStarBusy(false);
    }
  };

  const send = async () => {
    const forProject = projectId;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const sent = await sendLifecycleToOverseer(forProject);
      if (current.current === forProject) setResult(sent);
    } catch (err) {
      fail('lifecycle:send_to_overseer', forProject)(err);
    } finally {
      setSending(false);
    }
  };

  const starLabel = isWatched ? dl.lc_ov_unwatch : dl.lc_ov_watch;

  return (
    <div className="flex flex-col items-end gap-1 min-w-0" data-testid="lc-overseer-controls">
      <div className="flex items-center gap-2">
        <Tooltip content={starLabel}>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={isWatched}
            aria-label={starLabel}
            loading={starBusy}
            onClick={toggleStar}
            data-testid="lc-overseer-star"
          >
            <CompanionMark companion="overseer" active={isWatched} />
          </Button>
        </Tooltip>
        <Button
          variant="accent"
          tone="agent"
          size="sm"
          icon={<Send className="w-3.5 h-3.5" />}
          loading={sending}
          loadingLabel={dl.lc_ov_sending}
          onClick={send}
          data-testid="lc-overseer-send"
        >
          {goal ? dl.lc_ov_resend : dl.lc_ov_send}
        </Button>
      </div>
      {/* Always mounted, so the result is a CHANGE inside an existing live
          region and is announced; sr-only (still in the a11y tree) while empty. */}
      <p role="status" className={result ? 'typo-caption text-foreground' : 'sr-only'} data-testid="lc-overseer-result">
        {result ? tx(dl.lc_ov_sent, { filed: result.filed, open: result.alreadyOpen }) : ''}
      </p>
      {overseerOff && isWatched && (
        <p className="typo-caption text-status-warning" data-testid="lc-overseer-off-hint">
          {dl.lc_ov_off_hint}
        </p>
      )}
      {error && <Banner severity="error" compact message={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
