/**
 * Goal-to-Plan — deterministic rule-based planner (Stage 1, enhanced in
 * Stage 2).
 *
 * Maps a natural-language goal onto an ordered, reviewable sequence of plan
 * steps using keyword heuristics over the action catalog. No LLM, no
 * network, no execution — fully deterministic so the preview is instant and
 * testable. The LLM provider (see `planProvider.ts`) layers over this with
 * the same Plan shape and falls back here when unavailable.
 */
import type { Plan, PlanStep } from './types';

let stepSeq = 0;
function nextId(): string {
  stepSeq += 1;
  return `step-${Date.now().toString(36)}-${stepSeq}`;
}

/** A detected output/input service, with the brand label to echo back. */
interface ServiceMatch {
  label: string;
  re: RegExp;
}

const NOTIFY_SERVICES: ServiceMatch[] = [
  { label: 'Email', re: /\b(e-?mail|gmail|inbox|mailbox)\b/i },
  { label: 'Slack', re: /\bslack\b/i },
  { label: 'Discord', re: /\bdiscord\b/i },
  { label: 'Microsoft Teams', re: /\b(ms ?teams|microsoft teams)\b/i },
  { label: 'Telegram', re: /\btelegram\b/i },
  { label: 'SMS', re: /\b(sms|text message)\b/i },
  { label: 'Notion', re: /\bnotion\b/i },
  { label: 'GitHub', re: /\bgithub\b/i },
];

const SCHEDULE_PATTERNS: { cadence: string; re: RegExp }[] = [
  { cadence: 'every morning', re: /\bevery morning\b/i },
  { cadence: 'daily', re: /\b(daily|every day|each day)\b/i },
  { cadence: 'hourly', re: /\b(hourly|every hour)\b/i },
  { cadence: 'weekly', re: /\b(weekly|every week)\b/i },
  { cadence: 'monthly', re: /\b(monthly|every month)\b/i },
  { cadence: 'on a schedule', re: /\b(periodically|on a schedule|scheduled|recurring|cron)\b/i },
];

const WEB_RE = /\b(watch|monitor|track|scrape|crawl|website|web ?page|url|https?:\/\/|price|pricing|stock|availability)\b/i;
const CHANGE_RE = /\b(change|changes|diff|new|update|updated|drop|increase|decrease|alert me|notify me)\b/i;
// An *input* trigger: something arrives and should kick off the persona.
const EVENT_RE = /\b(when|whenever|on (a )?new|incoming|receive|arrives?|webhook|is created|is posted|mentions?|replies?)\b/i;

/** Detect every distinct service named in the goal, in catalog order. */
function detectServices(goal: string): ServiceMatch[] {
  return NOTIFY_SERVICES.filter((s) => s.re.test(goal));
}

function detectCadence(goal: string): string | null {
  return SCHEDULE_PATTERNS.find((s) => s.re.test(goal))?.cadence ?? null;
}

/** Trim the goal to a compact phrase for step detail interpolation. */
function summarize(goal: string): string {
  const trimmed = goal.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

/**
 * Build a deterministic preview plan from a goal string. Returns `null` for
 * an empty/whitespace goal so the caller can keep the empty state.
 */
export function planFromGoal(goal: string): Plan | null {
  const clean = goal.trim();
  if (!clean) return null;

  const summary = summarize(clean);
  const steps: PlanStep[] = [];

  // 1 — Always lead with framing the goal. High confidence; it's free.
  steps.push({ id: nextId(), actionId: 'understand_goal', confidence: 0.95, params: { goal: summary } });

  // 2 — A persona is the unit that does the work. Always present.
  steps.push({ id: nextId(), actionId: 'create_persona', confidence: 0.9, params: { goal: summary } });

  // 3 — Web monitoring shape: read the page, then diff it.
  const monitorsWeb = WEB_RE.test(clean);
  if (monitorsWeb) {
    steps.push({ id: nextId(), actionId: 'fetch_web', confidence: 0.75, params: {} });
    if (CHANGE_RE.test(clean)) {
      steps.push({ id: nextId(), actionId: 'detect_changes', confidence: 0.7, params: {} });
    }
  }

  // 4 — Output channels. Every named service gets a connect + a send step,
  //     in catalog order, deduped by the detector. Confidence tapers for
  //     additional channels since multi-channel intent is less certain.
  const services = detectServices(clean);
  services.forEach((service, i) => {
    const taper = i === 0 ? 0 : 0.1;
    steps.push({
      id: nextId(),
      actionId: 'connect_service',
      confidence: 0.8 - taper,
      params: { service: service.label },
    });
    steps.push({
      id: nextId(),
      actionId: 'send_notification',
      confidence: 0.75 - taper,
      params: { service: service.label },
    });
  });

  // 5 — How it starts: a cadence wins over an event trigger when both read.
  const cadence = detectCadence(clean);
  if (cadence) {
    steps.push({
      id: nextId(),
      actionId: 'configure_schedule',
      confidence: 0.8,
      params: { cadence },
    });
  } else if (EVENT_RE.test(clean)) {
    steps.push({
      id: nextId(),
      actionId: 'configure_trigger',
      confidence: 0.65,
      params: { event: summary },
    });
  }

  // 6 — The confirm gate. The whole point of a read-only preview.
  steps.push({ id: nextId(), actionId: 'review_confirm', confidence: 1, params: {} });

  return {
    id: `plan-${Date.now().toString(36)}`,
    goal: clean,
    steps,
    source: 'rule',
    createdAt: Date.now(),
  };
}
