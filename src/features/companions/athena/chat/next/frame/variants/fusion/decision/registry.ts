/**
 * Fusion · the decision surfaces the stage can render, by style (`style.ts`).
 * Every style meets the same two prop contracts: `Question` = QuestionBlock's
 * ({ model: CardModel | null, item, nav }), `Answers` = AnswerCards's
 * ({ model: CardModel, herOwn }).
 */

import type { ComponentType } from 'react';
import { AnswerCards } from '../AnswerCards';
import { QuestionBlock } from '../QuestionBlock';
import * as V1 from './v1';
import * as V2 from './v2';
import * as V3 from './v3';
import type { DecisionStyle } from './style';

type QuestionProps = Parameters<typeof QuestionBlock>[0];
type AnswersProps = Parameters<typeof AnswerCards>[0];

export const DECISION_SURFACES: Record<DecisionStyle, { Question: ComponentType<QuestionProps>; Answers: ComponentType<AnswersProps> }> = {
  now: { Question: QuestionBlock, Answers: AnswerCards },
  v1: V1,
  v2: V2,
  v3: V3,
};
