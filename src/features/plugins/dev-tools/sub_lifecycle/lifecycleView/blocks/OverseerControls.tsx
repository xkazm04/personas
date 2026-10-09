/**
 * The Lifecycle page's hand-off to the Overseer: ONE control group in the
 * header's action cluster, in his role colour.
 *
 * - The WATCH toggle: his mark on a filled chip and "Watched" while the
 *   project is on his watch list, the bare mark and "Watch" while it is not.
 *   The word shows from 1600px wide; narrower the toggle is the mark alone,
 *   and its tooltip says what watching does. `aria-pressed` carries the state.
 * - SEND: opens a confirm anchored to it that reads out exactly what the send
 *   will do (`overseer/SendPreview`, the backend's dry run): what it will
 *   file, reopen, find already with him, and leave alone. Confirming sends.
 *
 * Renders a FRAGMENT: the group sits in the cluster's row; what it says (a
 * send's result, a failure, the Overseer being off) are lines that drop below
 * the row (`NOTE_LINE`), so a message never moves a control. Both controls
 * hold their footprint from first paint, `disabled` while the snapshot loads;
 * the send label reserves the width of every label it can show.
 */
import { useRef } from 'react';
import { Send } from 'lucide-react';

import { useCompanionsStatus } from '@/features/companions/status/useCompanionsStatus';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
import type { LifecycleGoalView } from '@/lib/bindings/LifecycleGoalView';

import { useLifecycleViewModel } from '../context';
import { OverseerGlyph } from '../overseer/OverseerMark';
import { OverseerOffChip } from '../overseer/OverseerOffChip';
import { SendPreview } from '../overseer/SendPreview';
import { useOverseerHandoff } from '../overseer/useOverseerHandoff';
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

/** A note line under the cluster's row: full width, after every control. */
export const NOTE_LINE = 'order-last basis-full';

/** The confirm is as wide as a step row needs: name, verdict, a reason under them. */
const CONFIRM_WIDTH = 480;

export function OverseerControls({ projectId, watched, goal, disabled = false }: OverseerControlsProps) {
  const { dl, tx } = useLifecycleViewModel();
  const overseer = useCompanionsStatus().byId('overseer');
  // Unknown (first read in flight) is not "off": the chip never guesses.
  const overseerOff = overseer != null && !overseer.enabled;
  const h = useOverseerHandoff(projectId, watched);
  const sendRef = useRef<HTMLButtonElement>(null);

  const sendLabel = goal ? dl.lc_ov_resend : dl.lc_ov_send;
  const inert = disabled || !projectId;

  return (
    <>
      <span role="group" aria-label={dl.lcx9_group} className="flex items-center gap-1" data-testid="lc-overseer-controls">
        <Tooltip content={h.watched ? dl.lcx9_watched_tip : dl.lcx9_watch_tip}>
          <Button
            variant={h.watched ? 'accent' : 'secondary'}
            tone={h.watched ? 'agent' : undefined}
            size="sm"
            aria-pressed={h.watched}
            aria-label={h.watched ? dl.lc_ov_unwatch : dl.lc_ov_watch}
            loading={h.starBusy}
            disabled={inert}
            onClick={h.toggleWatch}
            data-testid="lc-overseer-star"
            data-watched={h.watched ? 'true' : 'false'}
          >
            {/* One label line tall (`1lh` of the button's own type), so the mark-only toggle is
                exactly as tall as its labelled neighbours at every text scale. */}
            <span className="flex h-[1lh] items-center gap-1.5">
              <OverseerGlyph className={GLYPH.sm} />
              <span className="hidden min-[1600px]:inline" data-testid="lc9-watch-word">
                {h.watched ? dl.lcx9_watched : dl.lcx9_watch}
              </span>
            </span>
          </Button>
        </Tooltip>
        <Button
          ref={sendRef}
          variant="accent"
          tone="agent"
          size="sm"
          icon={<Send className={GLYPH.sm} />}
          disabled={inert}
          onClick={h.openConfirm}
          aria-haspopup="dialog"
          aria-expanded={h.confirming}
          data-testid="lc-overseer-send"
        >
          <ReservedLabel shown={sendLabel} others={[dl.lc_ov_send, dl.lc_ov_resend].filter((l) => l !== sendLabel)} />
        </Button>
      </span>
      <ConfirmPopover
        open={h.confirming}
        anchorRef={sendRef}
        title={dl.lcx9_preview_title}
        detail={<SendPreview state={h.preview} />}
        confirmLabel={sendLabel}
        confirmIcon={<Send className={GLYPH.sm} />}
        onConfirm={h.send}
        onCancel={h.closeConfirm}
        align="start"
        width={CONFIRM_WIDTH}
        testId="lc9-send-confirm"
        confirmTestId="lc9-send-confirm-go"
      />
      {/* Always mounted, so the result is a CHANGE inside an existing live
          region and is announced; sr-only (still in the a11y tree) while empty. */}
      <p role="status" className={h.result ? `${NOTE_LINE} ${LT.row}` : 'sr-only'} data-testid="lc-overseer-result">
        {h.result ? tx(dl.lc_ov_sent, { filed: h.result.filed, open: h.result.alreadyOpen }) : ''}
      </p>
      {overseerOff && <OverseerOffChip className={NOTE_LINE} />}
      {h.error && (
        <div className={NOTE_LINE}>
          <Banner severity="error" compact message={h.error} onDismiss={h.dismissError} />
        </div>
      )}
    </>
  );
}
