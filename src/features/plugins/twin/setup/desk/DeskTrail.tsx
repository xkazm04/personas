/**
 * DeskTrail — the compact thread above the question.
 *
 * It shows what led here and nothing more: the last two exchanges in full,
 * everything older folded behind one row the user can open. It is deliberately
 * NOT a transcript — no avatars, no bubbles, no scrollback — because the Desk's
 * whole proposition is that exactly one question is in front of you.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DeskExchange, DeskTrail as DeskTrailModel, DeskVerdict } from './trailModel';

interface DeskTrailProps {
  trail: DeskTrailModel;
}

function VerdictChip({ verdict }: { verdict: DeskVerdict }) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup;
  const field = verdict.channel
    ? `${ts.proposal.kind[verdict.kind]} ${verdict.channel}`
    : ts.proposal.kind[verdict.kind];
  const template =
    verdict.resolution === 'accepted'
      ? ts.desk.verdictAccepted
      : verdict.resolution === 'edited'
        ? ts.desk.verdictEdited
        : ts.desk.verdictDismissed;
  const tone =
    verdict.resolution === 'accepted'
      ? 'border-status-success/30 text-status-success'
      : verdict.resolution === 'edited'
        ? 'border-primary/30 text-foreground'
        : 'border-foreground/15';

  return (
    <span
      data-testid={`setup-desk-verdict-${verdict.resolution}`}
      className={`inline-flex items-center px-2 py-0.5 rounded-full border typo-caption ${tone}`}
    >
      {tx(template, { field })}
    </span>
  );
}

function ExchangeRow({ exchange }: { exchange: DeskExchange }) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  return (
    <li className="pl-3 border-l border-primary/15 space-y-0.5" data-testid="setup-desk-trail-exchange">
      {exchange.question && (
        <p className="typo-caption line-clamp-2">{exchange.question}</p>
      )}
      <p className="typo-caption text-foreground line-clamp-2">
        <span className="uppercase tracking-[0.18em] mr-1.5">
          {exchange.answer === null ? ts.desk.skipped : ts.desk.you}
        </span>
        {exchange.answer}
      </p>
      {exchange.verdicts.length > 0 && (
        <span className="flex flex-wrap gap-1 pt-0.5">
          {exchange.verdicts.map((v) => (
            <VerdictChip key={v.id} verdict={v} />
          ))}
        </span>
      )}
    </li>
  );
}

export function DeskTrail({ trail }: DeskTrailProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup;
  const [open, setOpen] = useState(false);

  if (trail.exchanges.length === 0) return null;

  return (
    <section
      className="mb-5 space-y-1.5"
      aria-label={ts.desk.trailLabel}
      data-testid="setup-desk-trail"
    >
      {trail.earlier.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid="setup-desk-trail-earlier"
          className="flex items-center gap-1.5 typo-caption hover:text-foreground transition-colors"
        >
          {open ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />}
          {open ? ts.desk.earlierHide : tx(ts.desk.earlier, { count: trail.earlier.length })}
        </button>
      )}

      <ul className="space-y-2">
        {open && trail.earlier.map((exchange) => <ExchangeRow key={exchange.id} exchange={exchange} />)}
        {trail.recent.map((exchange) => <ExchangeRow key={exchange.id} exchange={exchange} />)}
      </ul>
    </section>
  );
}

export default DeskTrail;
