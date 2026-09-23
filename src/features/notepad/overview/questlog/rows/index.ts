/** The row designs on offer, and the current one as the control.
 *
 * THROWAWAY SCAFFOLDING. One design wins and this file, the switcher and the
 * three losers go in the same commit — the same contract the desk A/B ran
 * under, for the same reason: a switcher that outlives its decision is how a
 * codebase ends up with four half-chosen designs.
 */
import { QuestRow } from '../QuestRow';
import { RowCircuit } from './RowCircuit';
import { RowLedger } from './RowLedger';
import { RowOrbit } from './RowOrbit';
import type { RowDesign, RowView } from './types';
import './rows.css';

export const ROW_VIEWS: Record<RowDesign, RowView> = {
  current: QuestRow,
  ledger: RowLedger,
  circuit: RowCircuit,
  orbit: RowOrbit,
};

export { ROW_DESIGNS, ROW_DESIGN_KEY, type RowDesign, type RowView } from './types';
