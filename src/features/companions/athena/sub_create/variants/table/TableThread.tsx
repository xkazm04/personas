import { useEffect, useRef } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaEngine } from '../../engine/createAthenaTypes';
import { TypedLine } from '../../shared/TypedLine';
import { useStepLabel } from '../stage/StageRail';
import { TableCardEngine, TableCardKeep, TableCardOrbPlace } from './TableCardChoice';
import { TableCardInstall, TableCardStt, TableCardVoice } from './TableCardListen';
import { receiptText, type TableFacts } from './useTableFacts';

/**
 * The conversation, which owns the page: every answered step is a one-line
 * receipt with "change", then her line for this step, then the one live card
 * once she has finished typing. Intro and handoff have no card; their single
 * action lives in the dock.
 */
function CardBody({ engine }: { engine: CreateAthenaEngine }) {
  const { card } = engine;
  switch (card.kind) {
    case 'keep_toggle': return <TableCardKeep engine={engine} card={card} />;
    case 'orb_place': return <TableCardOrbPlace engine={engine} card={card} />;
    case 'engine_pick': return <TableCardEngine engine={engine} card={card} />;
    case 'install': return <TableCardInstall engine={engine} card={card} />;
    case 'voice_pick': return <TableCardVoice engine={engine} card={card} />;
    case 'stt': return <TableCardStt engine={engine} card={card} />;
    default: return null;
  }
}

function Receipts({ engine, facts }: { engine: CreateAthenaEngine; facts: TableFacts }) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const stepLabel = useStepLabel();
  return (
    <>
      {engine.steps.map((s) => {
        if (s.status !== 'done' && s.status !== 'skipped') return null;
        const text = s.status === 'skipped' ? tx(c.table_receipt_skipped, { step: stepLabel(s.id) }) : receiptText(c, tx, s.id, facts);
        if (!text) return null;
        return (
          <div key={s.id} className={`tb-receipt typo-body ${s.status}`} data-testid={`create-athena-table-receipt-${s.id}`}>
            <span className="ok" aria-hidden="true">{s.status === 'done' ? '✓' : '–'}</span>
            <span>{text}</span>
            <Button variant="ghost" className="tb-receipt-change" onClick={() => engine.actions.goTo(s.id)} data-testid={`create-athena-table-change-${s.id}`}>
              <span className="typo-body">{c.table_change}</span>
            </Button>
          </div>
        );
      })}
    </>
  );
}

export function TableThread({ engine, facts, lineDone, onLineDone }: {
  engine: CreateAthenaEngine;
  facts: TableFacts;
  lineDone: boolean;
  onLineDone: () => void;
}) {
  const { t, tx } = useTranslation();
  const c = t.athena;
  const stepLabel = useStepLabel();
  const scroller = useRef<HTMLElement | null>(null);
  const { card, line } = engine;
  const hasCard = card.kind !== 'intro' && card.kind !== 'handoff';

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [line.id, lineDone, engine.steps]);

  return (
    <section ref={scroller} className="tb-thread" role="log" aria-live="polite" aria-label={c.create_tab_title} data-testid="create-athena-table-thread">
      <div className="tb-thread-inner">
        <Receipts engine={engine} facts={facts} />
        <div className={`tb-msg-her ${engine.speaking ? 'speaking' : ''}`} key={line.id}>
          <div className="tb-msg-who typo-body">{t.athena.name}</div>
          <TypedLine lineId={line.id} text={line.text} onDone={onLineDone} className="typo-body-lg" />
        </div>
        {card.kind === 'handoff' && !card.hasClaudeLogin && lineDone && (
          <p className="tb-card-hint typo-body" data-testid="create-athena-handoff-no-login">{c.create_handoff_no_login}</p>
        )}
        {hasCard && lineDone && (
          <div className="tb-card" data-testid={`create-athena-card-${card.kind}`} data-kind={card.kind}>
            <div className="tb-card-head typo-heading">
              {stepLabel(engine.stepId)}
              <span className="tb-card-step typo-body">{tx(c.create_progress, { current: engine.stepIndex + 1, total: engine.stepCount })}</span>
            </div>
            <CardBody engine={engine} />
          </div>
        )}
      </div>
    </section>
  );
}
