/**
 * The body and the dock a lane shape puts on a card, or null for a card that
 * keeps its modal type's own (DeckCard falls back). One switch per slot, so
 * DeckCard stays the same three parts for every shape.
 */
import type { ReactNode } from 'react';
import type { DecisionItem } from '../../model/decisionModel';
import { ProseBody } from '../ProseBody';
import { QuestionFields } from '../QuestionFields';
import type { CardState } from '../DeckCard';
import type { DeckActions } from '../useDeckActions';
import type { DeckController } from '../useDeck';
import { BreachBody } from './BreachBody';
import { BreachDock } from './BreachDock';
import { ClaimBody, ClaimRail } from './ClaimBody';
import { ValveStep } from './ShapeNotes';
import { SignBody, SignRail } from './SignBody';
import { SignDock } from './SignDock';
import { LensDock } from './LensDock';
import type { ShapeController } from './useShapeController';

export function shapeBody(item: DecisionItem, ctl: ShapeController | undefined, act: DeckActions, state: CardState): ReactNode | null {
  switch (ctl?.shape) {
    case 'sign': return <SignBody item={item} sign={ctl.sign} />;
    case 'breach': return ctl.breach.plan ? <BreachBody item={item} ctl={ctl} /> : null;
    case 'claim': return <ClaimBody item={item} ctl={ctl} />;
    case 'valve':
      return (
        <ProseBody item={item} lead={ctl.valve ? <ValveStep index={ctl.valve.index} total={ctl.valve.total} /> : undefined}>
          {item.input && !act.readOnly && <QuestionFields input={item.input} answers={state.answers} onAnswer={state.setAnswer} missing={state.missing} />}
        </ProseBody>
      );
    default: return null;
  }
}

export function shapeDock(item: DecisionItem, ctl: ShapeController | undefined, deck: DeckController, act: DeckActions): ReactNode | null {
  if (act.readOnly) return null;
  if (ctl?.shape === 'sign') return <SignDock item={item} deck={deck} act={act} sign={ctl.sign} />;
  if (ctl?.shape === 'breach' && ctl.breach.plan) return <BreachDock item={item} deck={deck} act={act} breach={ctl.breach} />;
  if (ctl?.shape === 'lens' && ctl.openLens) return <LensDock item={item} act={act} onOpen={ctl.openLens} />;
  return null;
}

/** What a shape adds to the ledger rail, or null. */
export function shapeRail(item: DecisionItem, ctl: ShapeController | undefined): ReactNode | null {
  if (ctl?.shape === 'sign') return <SignRail item={item} sign={ctl.sign} />;
  if (ctl?.shape === 'claim') return <ClaimRail item={item} />;
  return null;
}
