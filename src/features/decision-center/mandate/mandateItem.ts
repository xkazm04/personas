/**
 * mandateItem — a draft mandate as a Sign card.
 *
 * `decision_lanes_snapshot` counts every draft charter in Sign as
 * `mandate:<charterId>`; this is the item that id joins to. The words come in
 * already translated (`MonitorCopy`), like every adapter here, so the model
 * stays a plain function in a test.
 *
 * Accept is Sign (`mandate_sign` with the card's draft envelope), reject is
 * Drop (the charter is retired), each with its own reason prompt. React-free.
 */
import type { MandateSummary } from '@/lib/bindings/MandateSummary';

import type { Interpolate, MonitorCopy } from '../deck/deckMeta';
import type { DecisionItem } from '../model/decisionModel';

/** A mandate waiting for its signature sits mid-tier: above an idea, under a held build. */
const MANDATE_WEIGHT = 55;

export const MANDATE_PREFIX = 'mandate:';

export function mandateItemId(charterId: string): string {
  return MANDATE_PREFIX + charterId;
}

export function mandateToDecision(s: MandateSummary, m: MonitorCopy, tx: Interpolate, skip: string): DecisionItem {
  const steward = s.stewardName ?? m.ml_steward_unknown;
  const project = s.projectName ?? m.ml_project_unknown;
  return {
    id: mandateItemId(s.charterId),
    sourceId: s.charterId,
    kind: 'mandate',
    title: s.title,
    body: tx(m.ml_sign_body, { steward, project }),
    tags: [],
    facts: [{ id: 'rung', label: m.ml_fact_rung, value: String(s.scopeRung) }],
    source: { label: steward, sublabel: project },
    createdAt: s.updatedAt,
    weight: MANDATE_WEIGHT,
    branches: [],
    reasonPrompts: [{
      on: 'reject',
      title: m.ml_sign_drop_title,
      options: [
        // `value` is what is written: machine-durable English, never localised.
        { id: 'not_mine', label: m.ml_sign_drop_not_mine, value: 'Not a goal I hold' },
        { id: 'fold', label: m.ml_sign_drop_fold, value: 'Fold it into an existing mandate' },
        { id: 'steward', label: m.ml_sign_drop_steward, value: 'Wrong steward for this project' },
      ],
      skipLabel: m.ml_sign_drop,
      freeText: true,
    }],
    verdictLabels: { accept: m.ml_sign_verb, reject: m.ml_sign_drop, skip },
    payload: {
      charterId: s.charterId,
      projectId: s.projectId,
      stewardPersonaId: s.stewardPersonaId,
    },
  };
}
