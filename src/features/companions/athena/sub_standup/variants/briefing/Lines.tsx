import type { ReactNode } from 'react';

import { KitButton } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { BRIEFING } from './copy';
import { Item, Tag } from './Item';
import type { ItemProps } from './itemTypes';
import { Typer } from './Typer';

const I = BRIEFING.item;

/** The one-line shape every folded item shares: name in the margin, tag, the text, quiet actions. */
function Line({ entry, ctx, text, sub, actions, tag = true }: ItemProps & { text: ReactNode; sub?: ReactNode; actions?: ReactNode; tag?: boolean }) {
  const { row, index } = entry;
  const selected = index === ctx.c.ui.sel;
  return (
    <Item row={row} index={index} selected={selected} onSelect={ctx.c.select} className="sb-item--line">
      <div className="sb-margin">
        <h3 className="typo-title sb-name">{row.name}</h3>
      </div>
      <div className="sb-text sb-text--line">
        <div className="sb-line__body">
          <p className="typo-body text-foreground">{text}</p>
          {sub && <p className="typo-caption">{sub}</p>}
        </div>
        {actions ? <div className="sb-line__acts">{actions}</div> : <span />}
        {tag ? <Tag state={row.state} verb={row.agentVerb} /> : <span />}
      </div>
    </Item>
  );
}

/** A decided (or running, done, skipped) direction folded to one line, with undo while it is a draft. */
export function DecidedLine(p: ItemProps) {
  const { row } = p.entry;
  const { ctx } = p;
  const typing = ctx.c.ui.typing === row.key;
  const typed = row.state !== 'skipped' && row.chosenIndex < 0 && row.headline;
  const text = row.state === 'skipped' ? I.skipped : row.state === 'proposed' ? I.stays_off : row.state === 'blank' ? I.blank_off : row.headline || row.name;
  const undo = ctx.editable && row.state !== 'proposed' && row.state !== 'blank' && (
    <KitButton tone="quiet" hint="⌫" stopPropagation onClick={() => ctx.api.setState(row, 'proposed')}>{I.undo}</KitButton>
  );
  return (
    <Line
      {...p}
      text={typed ? <>{text} <span className="typo-caption">({I.yours})</span></> : text}
      sub={typing ? <Typer row={row} onTyped={ctx.c.typed} /> : undefined}
      actions={undo || undefined}
    />
  );
}

/** A proposed agent change: what and why, accept or skip. */
export function AgentLine(p: ItemProps) {
  const { row } = p.entry;
  const { ctx } = p;
  const open = ctx.editable && row.state === 'proposed';
  const decided = ctx.editable && row.state !== 'proposed';
  const actions = open ? (
    <>
      <KitButton tone="quiet" hint="1" stopPropagation onClick={() => ctx.api.setState(row, 'accepted')}>{I.accept}</KitButton>
      <KitButton tone="quiet" hint="S" stopPropagation onClick={() => ctx.api.setState(row, 'skipped')}>{I.skip}</KitButton>
    </>
  ) : decided ? <KitButton tone="quiet" hint="⌫" stopPropagation onClick={() => ctx.api.setState(row, 'proposed')}>{I.undo}</KitButton> : undefined;
  return <Line {...p} text={row.evidence} actions={actions} />;
}

/** A parked ask only the operator can answer: what is needed, the options, and the one action. */
export function WaitLine(p: ItemProps) {
  const { tx } = useTranslation();
  const { row } = p.entry;
  const options = row.ask?.options ?? [];
  return (
    <Line
      {...p}
      tag={false}
      text={row.headline}
      sub={options.length > 0 ? tx(I.options, { list: options.join(I.or) }) : row.evidence || undefined}
      actions={row.itemId ? <KitButton tone="quiet" hint="T" stopPropagation onClick={() => p.ctx.api.talk(row)}>{I.answer}</KitButton> : undefined}
    />
  );
}

/** Filler (report-only dead-spot work) and directions a headless master holds elsewhere. */
export function HeldLine(p: ItemProps) {
  const { row } = p.entry;
  return <Line {...p} text={row.refusal ?? row.evidence} />;
}
