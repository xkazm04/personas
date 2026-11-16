// PORTED from bp packages/core/src/model/compare.ts @ 93f30b0 (compareLines' `text`, endpointWord).
// EDIT (port): bp composes each comparison line in English inside compareLines; WP1's port returns structured
// CompareLine data, and this turns one into the words of t.decisionCenter.blueprint (`sync_cmp_*`), bp's wording
// quoted on CompareLine. A reading keeps its own date; a value is formatted by its lens field (ui/page/values fmtValue)
// when the lens declares it, else the number in the app's language with bp's unit rule ("%" glued, any other spaced).
import type { CompareLine, Endpoint } from '../model/compare';
import type { LensDef } from '../standard/load';
import type { Stage } from '../standard/types';
import { fmtDay } from '../ui/timeline/dates';
import { nfmt } from '../ui/page/values';
import { stepValue } from './readyWords';
import { type BlueprintText, stageWord, verdictWord } from './useBlueprintText';

type Lenses = Readonly<Record<string, Pick<LensDef, 'name' | 'F'>>>;

/** "now", or the date (bp endpointWord). */
export const endpointText = ({ B, language }: BlueprintText, e: Endpoint): string => (e.at === 'now' ? B.sync_endpoint_now : fmtDay(language, e.date));

const stageText = (text: BlueprintText, s: Stage | null) => (s ? stageWord(text.B, s) : text.B.sync_cmp_not_drawn);

/** One line of what changed on a feature between A and B, in bp's words. */
export function compareLineText(text: BlueprintText, L: Lenses, l: CompareLine): string {
  const { B, tx, language } = text;
  if (l.kind === 'stage') return tx(B.sync_cmp_stage, { a: stageText(text, l.a), dateA: endpointText(text, l.A), b: stageText(text, l.b), dateB: endpointText(text, l.B) });
  if (l.kind === 'health') {
    return tx(B.sync_cmp_health, { lens: L[l.lens]?.name ?? l.lens, a: verdictWord(B, l.a).toLowerCase(), dateA: endpointText(text, l.A), b: verdictWord(B, l.b).toLowerCase(), dateB: endpointText(text, l.B) });
  }
  const x = L[l.lens]?.F[l.key];
  const val = (v: number) => (x ? stepValue(text, x, v) : nfmt(language, v) + (l.unit ? (l.unit === '%' ? '' : ' ') + l.unit : ''));
  const lens = L[l.lens]?.name ?? l.lens;
  if (l.kind === 'move') {
    return tx(B.sync_cmp_move, { lens, label: l.label, a: val(l.a.value), ad: fmtDay(language, l.a.measured), b: val(l.b.value), bd: fmtDay(language, l.b.measured) });
  }
  return tx(B.sync_cmp_first, { lens, label: l.label, b: val(l.b.value), bd: fmtDay(language, l.b.measured), dateA: endpointText(text, l.A) });
}
