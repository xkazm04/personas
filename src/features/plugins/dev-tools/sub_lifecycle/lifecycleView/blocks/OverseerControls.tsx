/**
 * The Lifecycle page's hand-off to the Overseer, as two controls of the header's
 * action cluster: a star that puts the project on his watch list (an icon
 * button as tall as its neighbours, tinted while the project is watched), and
 * "Send to Overseer", which files the "All steps green" goal plus one item per
 * non-green step.
 *
 * Renders a FRAGMENT: the two buttons sit in the cluster's row, and what they
 * say (a send's result, a failure, the off hint) are lines that drop below the
 * row (`order-last basis-full`), so a message never moves a control. Both
 * buttons hold their footprint from first paint: `disabled` while the
 * snapshot loads, and the send label reserves the width of every label it can
 * show (send / send again / sending).
 *
 * Not optimistic: the star shows what `setLifecycleWatch` RETURNED, seeded from
 * the snapshot and re-synced whenever the snapshot changes. With the Overseer
 * switched off the star still saves, and a hint on a watched project says
 * auto-measure waits for him.
 */
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';

import { setLifecycleWatch, sendLifecycleToOverseer } from '@/api/devTools/lifecycle';
import { useCompanionsStatus } from '@/features/companions/status/useCompanionsStatus';
import { COMPANION_GLYPH } from '@/features/companions/companionGlyphs';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';
import type { LifecycleSendResult } from '@/lib/bindings/LifecycleSendResult';
import { resolveError } from '@/lib/errors/errorRegistry';
import { extractMessage, silentCatch } from '@/lib/silentCatch';

import { LT } from '../system/lcType';
import { ReservedLabel } from '../system/ReservedLabel';
import { GLYPH } from '../system/scales';

export interface OverseerControlsProps {
  projectId: string | null;
  /** The snapshot's star; the control re-syncs to it whenever it changes. */
  watched: boolean;
  /** The Overseer goal already filed for this project, or null when none is. */
  goal: LifecycleGoalView | null;
  /** The snapshot is not in yet: hold the footprint, take no input. */
  disabled?: boolean;
}

const OverseerGlyph = COMPANION_GLYPH.overseer;

/** A note line under the cluster's row: full width, after every control. */
export const NOTE_LINE = 'order-last basis-full';

export function OverseerControls({ projectId, watched, goal, disabled = false }: OverseerControlsProps) {
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
    if (!projectId) return;
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
    if (!projectId) return;
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
  const sendLabel = goal ? dl.lc_ov_resend : dl.lc_ov_send;
  const otherLabels = [dl.lc_ov_send, dl.lc_ov_resend, dl.lc_ov_sending].filter((l) => l !== sendLabel);
  const inert = disabled || !projectId;

  return (
    <>
      <span className="flex items-center gap-1" data-testid="lc-overseer-controls">
        <Tooltip content={starLabel}>
          <Button
            variant={isWatched ? 'accent' : 'secondary'}
            tone={isWatched ? 'agent' : undefined}
            size="sm"
            aria-pressed={isWatched}
            aria-label={starLabel}
            loading={starBusy}
            disabled={inert}
            onClick={toggleStar}
            data-testid="lc-overseer-star"
            data-watched={isWatched ? 'true' : 'false'}
          >
            {/* One label line tall (`1lh` of the button's own type), so this icon-only
                control is exactly as tall as its labelled neighbours at every text scale. */}
            <span className="flex h-[1lh] items-center"><OverseerGlyph className={GLYPH.sm} /></span>
          </Button>
        </Tooltip>
        <Button
          variant="accent"
          tone="agent"
          size="sm"
          icon={<Send className={GLYPH.sm} />}
          loading={sending}
          loadingLabel={<ReservedLabel shown={dl.lc_ov_sending} others={[dl.lc_ov_send, dl.lc_ov_resend]} />}
          disabled={inert}
          onClick={send}
          data-testid="lc-overseer-send"
        >
          <ReservedLabel shown={sendLabel} others={otherLabels} />
        </Button>
      </span>
      {/* Always mounted, so the result is a CHANGE inside an existing live
          region and is announced; sr-only (still in the a11y tree) while empty. */}
      <p role="status" className={result ? `${NOTE_LINE} ${LT.row}` : 'sr-only'} data-testid="lc-overseer-result">
        {result ? tx(dl.lc_ov_sent, { filed: result.filed, open: result.alreadyOpen }) : ''}
      </p>
      {overseerOff && isWatched && (
        <p className={`${NOTE_LINE} ${LT.row} text-status-warning`} data-testid="lc-overseer-off-hint">
          {dl.lc_ov_off_hint}
        </p>
      )}
      {error && (
        <div className={NOTE_LINE}>
          <Banner severity="error" compact message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </>
  );
}
