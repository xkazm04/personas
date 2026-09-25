// Harness-only lanes beside the two dev lanes, so a shot shows four different processes:
// KP hiring (the contest's labelled projected cohort, read from a URL like the reading) and an
// Ascent loop-run lane, which is a SAMPLE generated here - no real Live Theater export exists yet.
// The app never imports this file.
import { buildSpine, type SpineInstance, type SpineStep } from '../engine/spine';
import type { LaneOutcome, ProcessLane } from '../lanes';

const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
const names = (keys: string[]) => keys.map(cap).join(' / ');

function lane(
  id: string,
  title: string,
  unit: string,
  provenance: ProcessLane['provenance'],
  list: SpineInstance[],
  isFailure: (o: string) => boolean,
  good: [string, string],
  tones: [string, string, string][],
): ProcessLane {
  const model = buildSpine(list, isFailure);
  const outcomes: LaneOutcome[] = tones.map(([key, label, tone]) => ({ key, label, tone, n: model.outcomes[key] ?? 0 }));
  return { id, title, unit, provenance, model, stationName: names, good: { label: good[1], n: model.outcomes[good[0]] ?? 0 }, outcomes };
}

const STAGE_OF: Record<string, string> = {
  matched: 'source', applied: 'source', added: 'source', outreach_sent: 'source', acknowledgement_sent: 'source', moved: 'source',
  advanced: 'screen', auto_advanced: 'screen', auto_rejected: 'screen', screening_hold: 'screen', reinstated: 'screen',
  rematched: 'screen', rematched_from: 'screen', group_eval: 'screen', human_round_queued: 'screen', intake_degraded: 'screen',
  interview_prep_generated: 'interview', schedule_invite_sent: 'interview', interview_scheduled: 'interview', scheduled: 'interview',
  interview_reminder_sent: 'interview', interview_started: 'interview', interview_completed: 'interview', interview_scorecard: 'interview',
  offer_drafted: 'offer', offer_sent: 'offer', offer_reminder_sent: 'offer', offer_expired: 'offer', offer_accepted: 'offer',
  onboarding_started: 'onboard', onboarding_intake_submitted: 'onboard',
};
const HOLD = new Set(['screening_hold', 'interview_reminder_sent', 'offer_reminder_sent', 'offer_expired', 'intake_degraded', 'reinstated', 'rematched_from', 'moved']);

interface KpJourneys { journeys: { id: string; origin: string; outcome: string; events: { k: string; at: string }[] }[] }

export function hiringLane(data: KpJourneys): ProcessLane {
  const list: SpineInstance[] = data.journeys
    .filter((j) => j.origin === 'projected')
    .map((j) => {
      const steps: SpineStep[] = [];
      let t0: number | null = null;
      for (const e of j.events) {
        const k = STAGE_OF[e.k];
        if (!k) continue;
        const at = Date.parse(e.at);
        t0 ??= at;
        steps.push({ k, t: (at - t0) / 1000, err: 0, friction: HOLD.has(e.k) });
      }
      return { id: j.id, group: 'kp', outcome: j.outcome, steps };
    });
  return lane('kp-hiring', 'KP hiring', 'journeys', 'projected', list, (o) => o === 'withdrawn' || o === 'stalled', ['hired', 'hired'], [
    ['hired', 'Hired', 'bg-primary'],
    ['open', 'Open', 'bg-status-info'],
    ['rematched', 'Rematched', 'bg-secondary'],
    ['rejected', 'Rejected', 'bg-muted-foreground/40'],
    ['withdrawn', 'Withdrawn', 'bg-status-warning'],
    ['stalled', 'Stalled', 'bg-status-error'],
  ]);
}

/** Deterministic Ascent loop lanes: plan -> run -> rescan -> land, with breakers and unverified claims. */
export function ascentSampleLane(n = 240): ProcessLane {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const list: SpineInstance[] = [];
  for (let i = 0; i < n; i++) {
    const steps: SpineStep[] = [{ k: 'plan', t: 0, err: 0, friction: false }];
    let outcome = 'landed';
    let t = 60 + rnd() * 600;
    const r = rnd();
    if (r < 0.05) outcome = 'parked';
    else {
      steps.push({ k: 'run', t, err: rnd() < 0.22 ? 1 : 0, friction: false });
      t += 600 + rnd() * 3000;
      if (r < 0.13) outcome = 'breaker';
      else {
        steps.push({ k: 'rescan', t, err: 0, friction: rnd() < 0.1 });
        t += 120 + rnd() * 600;
        if (r < 0.29) outcome = 'unverified';
        else if (r < 0.36) outcome = 'parked';
        else steps.push({ k: 'land', t, err: 0, friction: false });
      }
    }
    list.push({ id: `L${i}`, group: 'ascent', outcome, steps });
  }
  return lane('ascent-loop', 'Ascent loop runs', 'lanes', 'sample', list, (o) => o === 'breaker' || o === 'unverified', ['landed', 'landed on the runner'], [
    ['landed', 'Landed', 'bg-primary'],
    ['parked', 'Waiting on operator', 'bg-status-info'],
    ['unverified', 'Rescan refuted', 'bg-status-warning'],
    ['breaker', 'Breaker', 'bg-status-error'],
  ]);
}
