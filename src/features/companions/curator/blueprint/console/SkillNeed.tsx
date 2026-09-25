/**
 * What the picked skill needs before it can be filed - drawn as three states,
 * because there are three.
 *
 * The third state wears the ledger's own UNKNOWN ink (`cb-unset`), the same
 * treatment the nine columns above use for "nobody looked". That is the point:
 * the operator has already learned on this page that see-through means unknown,
 * so the badge reads as unknown without having to be read.
 */
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

import { useWords } from '../words';

import { argumentNeed } from './skillInvocation';

export function SkillNeed({ skill }: { skill: CuratorSkill }) {
  const { w, tx } = useWords();
  const need = argumentNeed(skill);

  if (need === 'unknown') {
    return (
      <span
        className="cb-need cb-unset"
        data-role="cb-skill-need"
        data-need="unknown"
        data-cb-tip={w.console.need_unknown_tip}
      >
        {w.console.need_unknown}
      </span>
    );
  }

  if (need === 'optional') {
    return (
      <span
        className="cb-need"
        data-role="cb-skill-need"
        data-need="optional"
        data-cb-tip={w.console.need_optional_tip}
      >
        {w.console.need_optional}
      </span>
    );
  }

  return (
    <span
      className="cb-need"
      data-role="cb-skill-need"
      data-need="required"
      // The argument line VERBATIM as the file states it, when it states one.
      // Where it does not, the badge says only that one is needed rather than
      // inventing a shape for it.
      data-cb-tip={
        skill.argumentHint ? tx(w.console.need_required_tip, { hint: skill.argumentHint }) : undefined
      }
    >
      {w.console.need_required}
    </span>
  );
}
