/**
 * Goal-to-Plan — intent signal detection.
 *
 * Shared keyword heuristics over a goal string. The rule planner composes
 * full plans from these; the live chip strip under the goal box uses the
 * lighter `inferIntentSignals()` to narrate what's been detected *as the
 * user types*, before they ever hit Preview. Pure, deterministic, no I/O.
 */

/** A detected output/input service, with the brand label to echo back. */
export interface ServiceMatch {
  label: string;
  re: RegExp;
}

export const NOTIFY_SERVICES: ServiceMatch[] = [
  { label: 'Email', re: /\b(e-?mail|gmail|inbox|mailbox)\b/i },
  { label: 'Slack', re: /\bslack\b/i },
  { label: 'Discord', re: /\bdiscord\b/i },
  { label: 'Microsoft Teams', re: /\b(ms ?teams|microsoft teams)\b/i },
  { label: 'Telegram', re: /\btelegram\b/i },
  { label: 'SMS', re: /\b(sms|text message)\b/i },
  { label: 'Notion', re: /\bnotion\b/i },
  { label: 'GitHub', re: /\bgithub\b/i },
];

export const SCHEDULE_PATTERNS: { cadence: string; re: RegExp }[] = [
  { cadence: 'every morning', re: /\bevery morning\b/i },
  { cadence: 'daily', re: /\b(daily|every day|each day)\b/i },
  { cadence: 'hourly', re: /\b(hourly|every hour)\b/i },
  { cadence: 'weekly', re: /\b(weekly|every week)\b/i },
  { cadence: 'monthly', re: /\b(monthly|every month)\b/i },
  { cadence: 'on a schedule', re: /\b(periodically|on a schedule|scheduled|recurring|cron)\b/i },
];

export const WEB_RE = /\b(watch|monitor|track|scrape|crawl|website|web ?page|url|https?:\/\/|price|pricing|stock|availability)\b/i;
export const CHANGE_RE = /\b(change|changes|diff|new|update|updated|drop|increase|decrease|alert me|notify me)\b/i;
// An *input* trigger: something arrives and should kick off the persona.
export const EVENT_RE = /\b(when|whenever|on (a )?new|incoming|receive|arrives?|webhook|is created|is posted|mentions?|replies?)\b/i;

/** Detect every distinct service named in the goal, in catalog order. */
export function detectServices(goal: string): ServiceMatch[] {
  return NOTIFY_SERVICES.filter((s) => s.re.test(goal));
}

export function detectCadence(goal: string): string | null {
  return SCHEDULE_PATTERNS.find((s) => s.re.test(goal))?.cadence ?? null;
}

/** Trim the goal to a compact phrase for step detail interpolation. */
export function summarize(goal: string): string {
  const trimmed = goal.trim().replace(/\s+/g, ' ');
  return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
}

/** The structured shape a raw goal narrows to, for live chip feedback. */
export interface IntentSignals {
  /** Any non-empty goal implies at least a persona to do the work. */
  hasPersona: boolean;
  services: string[];
  hasSchedule: boolean;
  hasTrigger: boolean;
  monitorsWeb: boolean;
}

/** A suggested persona identity previewed on the create_persona step. */
export interface PersonaGuess {
  /** Title-cased from the goal's own words — user content, not translated. */
  name: string;
  /** lucide-react icon name, chosen from the detected signals. */
  icon: string;
}

const NAME_STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'me', 'my', 'i', 'and', 'of', 'for', 'on', 'in',
  'when', 'whenever', 'every', 'each', 'with', 'that', 'this', 'get', 'gets',
]);

/** Guess a persona name + icon from a goal. Name is built from the user's own
 *  words (so it needs no translation); icon reflects the dominant signal. */
export function guessPersona(goal: string): PersonaGuess {
  const s = inferIntentSignals(goal);
  const icon = s.monitorsWeb
    ? 'Globe'
    : s.services.length > 0
      ? 'MessageCircle'
      : s.hasSchedule
        ? 'Clock'
        : s.hasTrigger
          ? 'Zap'
          : 'Bot';
  const words = goal
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w));
  const name = words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 28);
  return { name, icon };
}

/** Lightweight inference for the live chip strip. */
export function inferIntentSignals(text: string): IntentSignals {
  const clean = text.trim();
  if (!clean) {
    return { hasPersona: false, services: [], hasSchedule: false, hasTrigger: false, monitorsWeb: false };
  }
  return {
    hasPersona: true,
    services: detectServices(clean).map((s) => s.label),
    hasSchedule: detectCadence(clean) !== null,
    // A schedule already covers "how it starts"; only flag an event trigger
    // when no cadence was found, matching the planner's precedence.
    hasTrigger: detectCadence(clean) === null && EVENT_RE.test(clean),
    monitorsWeb: WEB_RE.test(clean),
  };
}
