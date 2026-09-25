/**
 * How a registry skill is invoked - and the three answers, not two.
 *
 * `CuratorSkill.runsBare` is `boolean | null`, and the null is the whole
 * reason this module exists. Measured 2026-09-24 while the wire contract was
 * frozen: `deepen` and `forge` document NO invocation at all, so whether they
 * can run with no argument is UNKNOWN. A picker that defaulted that to `false`
 * would demand an argument nobody has written down; one that defaulted it to
 * `true` would dispatch a bare command the file never promised. Both are the
 * UI inventing a fact, which is the one thing this page exists not to do.
 *
 * So there are three needs, and each one is a DIFFERENT affordance:
 *
 * | `runsBare` | need       | the field                                   |
 * |------------|------------|---------------------------------------------|
 * | `true`     | `optional` | offered, and filing with it empty is fine   |
 * | `false`    | `required` | demanded, with the file's own argument line |
 * | `null`     | `unknown`  | demanded, and it says WHY it is demanded    |
 *
 * `unknown` demands an argument on purpose. It is not "required" wearing a
 * different label: the reason is different and the surface says so. Nobody
 * wrote down how to invoke this skill, so the operator states the invocation
 * instead of the composer guessing it.
 */
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

/** What the composer must ask for before it may file a request. */
export type ArgumentNeed = 'optional' | 'required' | 'unknown';

/**
 * The need, read from the skill as the instrument reported it.
 *
 * Deliberately NOT `skill.runsBare ? 'optional' : 'required'`: that expression
 * is exactly the collapse this whole feature is built to prevent, and it type
 * checks.
 */
export function argumentNeed(skill: Pick<CuratorSkill, 'runsBare'>): ArgumentNeed {
  if (skill.runsBare === null) return 'unknown';
  return skill.runsBare ? 'optional' : 'required';
}

/**
 * Whether the composer may file this request.
 *
 * `optional` is the only need that admits an empty argument, because it is the
 * only one where a file on disk says running bare works.
 */
export function canFile(
  skill: Pick<CuratorSkill, 'runsBare'> | null,
  argument: string,
): boolean {
  if (!skill) return false;
  if (argumentNeed(skill) === 'optional') return true;
  return argument.trim().length > 0;
}

/**
 * The argument actually sent. An empty field is `null` on the wire - a real
 * absence rather than an empty string the Rust would have to guess about.
 */
export function argumentOf(argument: string): string | null {
  const trimmed = argument.trim();
  return trimmed.length > 0 ? trimmed : null;
}
