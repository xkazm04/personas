/**
 * The model BEFORE the instrument has ever run - the same shape as
 * `buildModel`'s, with every quantity absent instead of zero.
 *
 * ## Why this file exists rather than an empty state
 *
 * `curator_plan_current` honestly returns null until someone runs the
 * instrument, and the page used to answer that by drawing a single empty-state
 * card and nothing else: no verdict, no channel heads, no bands, no foot. The
 * operator asked for the opposite - the real page, drawn empty, so the first
 * pass can be started from a surface that already looks like itself.
 *
 * ## Why every field here is null and not 0
 *
 * This page's whole subject is that an unknown is not a zero, and it spends
 * four distinct inks keeping them apart. A skeleton of zeros would be the page
 * telling its own central lie on first contact, so there is no `0` anywhere
 * below: every quantity is `null`, which each surface renders with the UNKNOWN
 * ink it already owns for exactly this.
 *
 * Two fields are deliberately NOT null. `maxPoints` and `maxCeiling` are
 * drawing scales - the denominators a track is drawn against - and with no
 * rows nothing is drawn against them, so a 1 there is arithmetic, not a claim.
 * `bundleMark` is a lookup table, and an empty one says nothing.
 */
import { CHANNEL_ORDER, type ChannelId } from './channels';
import { policyOf, type BlueprintSources } from './policy';
import type { BlueprintModel, ChannelTotal } from './types';

/**
 * A model with nothing measured in it.
 *
 * The one thing that CAN be read before a projection exists is the operator's
 * live policy, because `curator_policy_get` answers on its own door. Where it
 * did, the foot draws the real caps; where it did not, the gauges read unknown
 * rather than "no cap declared", which would be a claim about settings nobody
 * has looked at.
 *
 * `policy` (the plan's own copy) stays the live read as well, so the foot has
 * one value and `policyDrift` is empty: there is no agreed-to policy to
 * disagree with until a plan carries one.
 */
export function unmeasuredModel(sources: BlueprintSources = {}): BlueprintModel {
  const live = sources.policy ? policyOf(sources.policy) : null;
  const totals = {} as Record<ChannelId, ChannelTotal>;
  for (const id of CHANNEL_ORDER) {
    // `emptiness` explains why a column reads ZERO. This one does not read
    // zero, so there is nothing to explain: the head branches on the null
    // points before it ever reaches this field.
    totals[id] = { channel: id, points: null, subjects: null, emptiness: null };
  }

  return {
    planRunId: null,
    createdAt: null,
    scanGeneratedAt: null,
    registryHeadSha: null,
    subjects: null,
    techniques: null,
    applications: null,
    domains: null,
    noClockApplications: null,
    expiredApplications: null,
    atRiskApplications: null,
    driftUnknown: null,
    drift: null,
    demandKnownDomains: null,
    unknownDemandBundles: null,
    bundleMark: {},
    rows: null,
    planPoints: null,
    maxPoints: 1,
    maxCeiling: 1,
    totals,
    quiet: null,
    quietSubjects: null,
    unlisted: null,
    consumers: {
      projects: null,
      pairs: null,
      evaluated: null,
      staleVerdicts: null,
      weak: null,
      staleProjects: null,
      mapsStale: null,
      problems: [],
    },
    policy: live,
    livePolicy: live,
    policyDrift: [],
  };
}
