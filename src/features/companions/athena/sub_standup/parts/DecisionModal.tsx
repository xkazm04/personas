import { useEffect, useRef } from 'react';

import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { useTranslation } from '@/i18n/useTranslation';
import type { RowView } from '../model/types';
import { ChoiceList } from './ChoiceList';
import { Press } from './prims';
import type { RowActions } from './rowActions';
import { StateMark } from './StateMark';
import { Typer } from './Typer';

interface Props {
  row: RowView | undefined;
  open: boolean;
  /** 0-based position of the row and the row count, for the "03 / 14" stamp. */
  index: number;
  total: number;
  editable: boolean;
  typing: boolean;
  act: RowActions;
  onClose: () => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * BaseModal focuses its first control (the close button), where Enter would
 * close the card. One frame after it, focus the decision instead: the chosen
 * direction, else the first, else the body, so Enter picks and never closes.
 */
function useDecisionFocus(open: boolean, rowKey: string | undefined, typing: boolean) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || typing) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = body.current;
      if (!el) return;
      const target = el.querySelector<HTMLElement>('.sc-choice.is-chosen.is-live') ?? el.querySelector<HTMLElement>('.sc-choice.is-live') ?? el;
      target.focus({ preventScroll: true });
    }));
    return () => cancelAnimationFrame(raf);
  }, [open, rowKey, typing]);
  return body;
}

/**
 * The decision on one card, on its own layer (Enter or a click on the row):
 * Athena's read, her directions as a palette, the typed line, then the
 * key-hinted presses. The page keymap keeps running under it, so 1-4 / E / S /
 * T / Backspace decide here and j/k walk to the next card without closing.
 */
export function DecisionModal({ row, open, index, total, editable, typing, act, onClose }: Props) {
  const { t } = useTranslation();
  const d = t.athena.standup.console.detail;
  const body = useDecisionFocus(open, row?.key, typing);
  if (!row) return null;
  const isDirection = row.kind === 'direction';
  const decided = row.state !== 'proposed' && row.state !== 'blank';
  const footer = (
    <div className="sc-modal sc-modal__foot">
      <span className="sc-modal__pos sc-num">{`${pad(index + 1)} / ${pad(total)}`}</span>
      <span className="sc-acts">
        {editable && row.kind === 'agent' && <Press k="1" onClick={() => act.accept(row)}>{d.accept}</Press>}
        {editable && isDirection && <Press k="E" onClick={() => act.edit(row)}>{decided ? d.edit : d.type}</Press>}
        {editable && row.kind !== 'hold' && row.state !== 'refused' && <Press k="S" onClick={() => act.skip(row)}>{d.skip}</Press>}
        {row.itemId && row.state !== 'refused' && <Press k="T" onClick={() => act.talk(row)}>{row.kind === 'hold' ? d.answer : d.talk}</Press>}
        <Press k="→" onClick={act.dossier}>{d.dossier}</Press>
        {editable && decided && row.kind !== 'hold' && row.state !== 'refused' && <Press k="⌫" onClick={() => act.undo(row)}>{d.undo}</Press>}
      </span>
    </div>
  );
  return (
    <ModalShell
      isOpen={open}
      onClose={onClose}
      titleId="standup-decision"
      width="md"
      title={row.name}
      status={<span className="sc-modal"><StateMark row={row} /></span>}
      footer={footer}
      portal
    >
      <div ref={body} tabIndex={-1} className="sc-modal sc-modal__body" data-testid="standup-decision">
        {(row.refusal || row.evidence) && (
          <p className="sc-read"><span className="sc-micro">{d.read}</span>{row.refusal ?? row.evidence}</p>
        )}
        {isDirection && row.proposals.length > 0 && <ChoiceList row={row} editable={editable} onPick={(i) => act.pick(row, i)} />}
        {typing && <Typer row={row} onTyped={(text) => act.typed(row, text)} />}
        {!typing && row.chosenIndex < 0 && (row.state === 'decided' || row.state === 'running' || row.state === 'done') && row.headline && <p className="sc-read"><span className="sc-micro">{t.athena.standup.dossier.decided}</span>{row.headline}</p>}
      </div>
    </ModalShell>
  );
}
