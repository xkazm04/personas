// One roll on the light table: the edge print, then its frames in a row.
// `ContactStrip` fetches the roll's detail (frames, trays, marks); the wall
// only mounts it for the newest rolls, the rest sit in the sleeve as
// `SleeveStrip` (edge print only) so the detail cache stays bounded.
// Extractable: a contest as a horizontal gallery strip.
import { Aperture } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { ContestSummary } from '@/lib/bindings/ContestSummary';
import { extractMessage } from '@/lib/silentCatch';

import { useContest } from '../../hooks/useContests';
import { seatStateLabel, seatStateTone } from '../../model/labels';
import { variantReview } from '../../model/reviewModel';
import { CONTACT_COPY as C, fill } from './copy';
import { FrameCell } from './FrameCell';
import { SpecChips } from './SpecChips';
import { StripHeader } from './StripHeader';

const GHOST_FRAMES_MAX = 6;

export interface StripProps {
  summary: ContestSummary;
  depth: number;
  onOpen: (frameKey?: string) => void;
}

function StripShell({ depth, children, testId }: { depth: number; children: React.ReactNode; testId: string }) {
  return (
    <li
      className={`space-y-2 rounded-card border border-primary/12 border-y-4 border-y-primary/10 border-dotted bg-secondary/10 px-3 py-2.5 ${
        depth > 0 ? 'ml-8' : ''
      }`}
      data-testid={testId}
    >
      {children}
    </li>
  );
}

export function ContactStrip({ summary, depth, onOpen, developed, onDevelop }: StripProps & { developed: boolean; onDevelop: () => void }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { detail, isLoading, error } = useContest(summary.projectId, summary.contestId);
  const hasLive = !!detail?.variants.some((v) => v.previewUrl && v.screenshots.length === 0);

  const develop = hasLive ? (
    <Tooltip content={C.stripDevelopHint}>
      <span>
        <Button
          size="xs"
          variant={developed ? 'primary' : 'ghost'}
          aria-pressed={developed}
          icon={<Aperture className="w-3 h-3" />}
          onClick={onDevelop}
          data-testid={`contact-strip-develop-${summary.contestId}`}
        >
          {developed ? C.stripDeveloped : C.stripDevelop}
        </Button>
      </span>
    </Tooltip>
  ) : null;

  return (
    <StripShell depth={depth} testId={`contact-strip-${summary.contestId}`}>
      <StripHeader summary={summary} onOpen={() => onOpen()} actions={develop} />
      {detail && detail.variants.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {detail.variants.map((v) => {
            const vr = detail.review ? variantReview(detail.review, v.key) : null;
            return (
              <FrameCell
                key={v.key}
                variant={v}
                bucket={vr?.bucket ?? (summary.winner === v.key ? 'winner' : null)}
                pinCount={vr?.pins.length ?? 0}
                live={developed}
                onOpen={() => onOpen(v.key)}
                className="w-52 shrink-0"
              />
            );
          })}
        </div>
      ) : detail ? (
        <ul className="flex flex-wrap gap-2">
          {detail.seats
            .filter((seat) => seat.kind === 'participant')
            .map((seat) => (
              <li
                key={seat.seatId}
                className="flex items-center gap-2 rounded-card border border-dashed border-primary/15 px-2 py-1.5"
              >
                <SpecChips spec={seat.spec} />
                <StatusBadge variant={seatStateTone(seat.state)} size="sm" pill>
                  {seatStateLabel(s, seat.state)}
                </StatusBadge>
              </li>
            ))}
          {detail.seats.length === 0 && <li className="typo-caption text-foreground">{C.stripNoFrames}</li>}
        </ul>
      ) : error ? (
        <p className="typo-caption text-foreground">
          {fill(C.stripDetailFailed, { message: resolveErrorTranslated(t, extractMessage(error)).message })}
        </p>
      ) : isLoading ? (
        <GhostFrames count={Math.min(GHOST_FRAMES_MAX, Math.max(1, summary.seatCount * summary.variantsPerSeat))} />
      ) : null}
    </StripShell>
  );
}

/** Calm frame-shaped ghosts, invisible for the first 120 ms (loading v2). */
export function GhostFrames({ count }: { count: number }) {
  return (
    <div className="flex gap-2 overflow-hidden" aria-hidden data-testid="contact-ghost-frames">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="aspect-[16/10] w-52 shrink-0 rounded-card border border-primary/8 bg-secondary/25 animate-fade-in"
          style={{ animationDelay: `${120 + i * 40}ms` }}
        />
      ))}
    </div>
  );
}

export function SleeveStrip({ summary, depth, onOpen }: StripProps) {
  return (
    <StripShell depth={depth} testId={`contact-sleeve-${summary.contestId}`}>
      <StripHeader summary={summary} onOpen={() => onOpen()} />
    </StripShell>
  );
}
