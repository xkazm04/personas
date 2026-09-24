// Run layer: while a roll develops, one tray per seat — its spec, its state,
// wall time, cost, turns, errors, and the latent frames it owes. The chain
// rail sits above; every action (launch, cancel, rerun a seat, retry a step,
// open in Monitor) lives one layer down in the darkroom log (the shared
// RunBoard), so the centre stays a picture of progress.
// Extractable: `SeatTray` (one seat's run as a card).
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import type { ContestSeat } from '@/lib/bindings/ContestSeat';

import { RunBoard } from '../../components/RunBoard';
import { isRerunnable, seatKindLabel, seatStateLabel, seatStateTone } from '../../model/labels';
import { ChainRail } from './ChainRail';
import { CONTACT_COPY as C, fill } from './copy';
import { SpecChips } from './SpecChips';

export function SeatTray({ seat, latent }: { seat: ContestSeat; latent: number }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const settled = seat.state !== 'idle' && seat.state !== 'queued' && seat.state !== 'running';
  return (
    <li
      className="space-y-2 rounded-card border border-primary/12 bg-secondary/15 p-3"
      data-testid={`contact-tray-${seat.seatId}`}
      data-state={seat.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SpecChips spec={seat.spec} />
        <StatusBadge variant={seatStateTone(seat.state)} size="sm" pill>
          {seatStateLabel(s, seat.state)}
        </StatusBadge>
        {seat.kind === 'judge' && <span className="typo-caption text-foreground">{seatKindLabel(s, seat.kind)}</span>}
      </div>
      <dl className="grid grid-cols-3 gap-2">
        <div>
          <dt className="typo-label text-foreground">{C.trayWall}</dt>
          <dd className="typo-data">
            <Numeric value={seat.wallS} unit="s" />
          </dd>
        </div>
        <div>
          <dt className="typo-label text-foreground">{C.trayCost}</dt>
          <dd className="typo-data">
            <Numeric value={seat.costUsd} unit="usd" />
          </dd>
        </div>
        <div>
          <dt className="typo-label text-foreground">{C.trayTurns}</dt>
          <dd className="typo-data">
            <Numeric value={seat.turns} unit="count" />
          </dd>
        </div>
      </dl>
      {seat.kind === 'participant' && !settled && latent > 0 && (
        <div className="flex gap-1.5" aria-label={fill(C.latentFrames, { count: latent })}>
          {Array.from({ length: latent }, (_, i) => (
            <span key={i} className="aspect-[16/10] w-12 rounded-interactive border border-dashed border-primary/20 bg-secondary/20" />
          ))}
        </div>
      )}
      {(seat.errors.length > 0 || isRerunnable(seat.state)) && (
        <p className="typo-caption text-status-warning">
          {seat.errors.length > 0 ? fill(C.trayErrors, { count: seat.errors.length }) : seatStateLabel(s, seat.state)}
        </p>
      )}
    </li>
  );
}

export function DevelopingTrays({ detail }: { detail: ContestDetail }) {
  const needsHands =
    detail.summary.phase === 'draft' ||
    detail.chain.step === 'failed' ||
    detail.seats.some((seat) => isRerunnable(seat.state));
  const [logOpen, setLogOpen] = useState<boolean | null>(null);
  const open = logOpen ?? needsHands;

  return (
    <section className="space-y-4" aria-label={C.developingTitle} data-testid="contact-developing">
      <div className="space-y-0.5">
        <h3 className="typo-heading">{C.developingTitle}</h3>
        <p className="typo-caption text-foreground">{C.developingHint}</p>
      </div>
      <ChainRail chain={detail.chain} judgesEnabled={detail.judgesEnabled} />
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {detail.seats.map((seat) => (
          <SeatTray key={`${seat.kind}-${seat.seatId}`} seat={seat} latent={detail.summary.variantsPerSeat} />
        ))}
      </ul>
      <div className="space-y-2">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          icon={open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          onClick={() => setLogOpen(!open)}
          data-testid="contact-darkroom-log-toggle"
        >
          {open ? C.hideLog : C.showLog}
        </Button>
        {open && (
          <div className="space-y-1 rounded-card border border-primary/10 p-3">
            <p className="typo-caption text-foreground">{C.darkroomLogHint}</p>
            <RunBoard detail={detail} />
          </div>
        )}
      </div>
    </section>
  );
}
