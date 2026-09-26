/**
 * ONE THING IN THE WAY, in the ledger's own row rhythm.
 *
 * The row's whole argument is that **holds and frees are different numbers**,
 * and it draws them as two separate figures rather than one total. Measured
 * 2026-09-26: `conform` holds 99 of her plan items and frees none of them,
 * because documenting its invocation still leaves an item that cannot carry the
 * project that invocation needs. A row that showed only 99 would make it look
 * like the most valuable fix on the board.
 *
 * The second reading is whose it is. An impediment she may close herself wears
 * her mark; one whose fix is a change to Personas carries the refusal the
 * backend wrote, verbatim, in its tip - because "not hers" without the reason is
 * the kind of half-fact this page exists to refuse.
 */
import type { CuratorImpediment } from '@/lib/bindings/CuratorImpediment';

import { useWords } from '../words';

export function ImpedimentRow({ item }: { item: CuratorImpediment }) {
  const { w, tx } = useWords();
  const g = w.gaps;
  return (
    <li
      className="cb-gap-row"
      data-role="cb-gaps-impediment"
      data-kind={item.kind}
      data-mine={item.selfFixable ? 'yes' : 'no'}
      data-cb-id={item.id}
    >
      <span className="cb-gap-owner typo-label" data-role="cb-gaps-owner" data-cb-tip={item.refusal ?? g.hers_tip}>
        {item.selfFixable ? g.hers : g.yours}
      </span>
      <span className="cb-gap-what">
        <b>{item.skill}</b>
        <i className="cb-dim typo-caption">{g.kind[item.kind]}</i>
      </span>
      <span className="cb-sp" />
      {/* Two figures, never summed. `frees` leads because it is the rank. */}
      <span className="cb-gap-n typo-label" data-role="cb-gaps-frees" data-zero={item.frees === 0 ? 'yes' : 'no'}>
        {tx(g.frees, { n: item.frees })}
      </span>
      <span className="cb-gap-n cb-dim typo-label" data-role="cb-gaps-holds">
        {tx(g.holds, { n: item.blocks })}
      </span>
      {/* The file, when there is one. `SkillMissing` has none, and an empty
          path would read as a file at the repository root. */}
      {item.file && (
        <code className="cb-gap-file typo-caption" data-cb-tip={item.summary}>
          {item.file}
        </code>
      )}
    </li>
  );
}
