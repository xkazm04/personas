/**
 * Split a persona's unfulfilled credential demands into the ones a machine may
 * settle and the ones a human must.
 *
 * `useUnfulfilledCredentials` already computes `reusableCount` and nothing ever
 * consumed it as an action: a persona needing five connector types was five
 * Create/Reuse clicks with no batch path, even when the vault already held a
 * verified credential for four of them.
 *
 * THE DISCRIMINATOR IS "EXACTLY ONE VERIFIED MATCH", and the two exclusions are
 * the point of the split rather than edge cases:
 *
 *  - TWO OR MORE verified matches is not a batch case. Picking one would be the
 *    machine guessing which account the persona should act as, and a wrong
 *    guess here is silent - the persona runs, against the wrong workspace.
 *  - An UNVERIFIED match is not a match. `isCredentialVerified` is the app's
 *    own readiness predicate, and auto-linking a credential that has never
 *    proven it can authenticate turns a visible "needs setup" into an
 *    invisible runtime failure.
 *
 * Both land in `ambiguous`, which keeps the per-row Reuse picker as the place
 * they are settled - the bulk path adds a door, it never closes one.
 */
import { isCredentialVerified } from '@/lib/credentials/healthState';
import type { CredentialMetadata } from '@/lib/types/types';
import type { UnfulfilledCredential } from './useUnfulfilledCredentials';

export interface AutoLink {
  demand: UnfulfilledCredential;
  /** The single verified credential that settles this demand. */
  credentialId: string;
}

export interface DemandPartition {
  /** Settleable without asking: exactly one verified matching credential. */
  autoLinkable: AutoLink[];
  /** A human must choose: several verified matches, or only unverified ones. */
  ambiguous: UnfulfilledCredential[];
  /** Nothing in the vault matches — these need a credential created. */
  missing: UnfulfilledCredential[];
}

export function partitionDemands(
  demands: readonly UnfulfilledCredential[],
  isVerified: (c: CredentialMetadata) => boolean = isCredentialVerified,
): DemandPartition {
  const autoLinkable: AutoLink[] = [];
  const ambiguous: UnfulfilledCredential[] = [];
  const missing: UnfulfilledCredential[] = [];

  for (const demand of demands) {
    if (demand.matchingCredentials.length === 0) {
      missing.push(demand);
      continue;
    }
    const verified = demand.matchingCredentials.filter(isVerified);
    const only = verified.length === 1 ? verified[0] : undefined;
    if (only) autoLinkable.push({ demand, credentialId: only.id });
    else ambiguous.push(demand);
  }

  return { autoLinkable, ambiguous, missing };
}
