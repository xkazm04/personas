/**
 * Builds a single composite `GlyphRow` from the template payload for the
 * questionnaire's centerpiece sigil. Aggregates dimension presence across
 * every use_case so a multi-UC template shows a unified state — the
 * questionnaire is about configuring the PERSONA, not a single capability.
 *
 * Two layers compose the final `presence` map:
 *
 * 1. **Template presets** — the static contract authored into the
 *    template. Reading `payload.persona.{trigger_composition,
 *    message_composition, error_handling}` and per-UC
 *    `{review_policy, memory_policy, notification_channels,
 *    event_subscriptions, emit_events}` produces the base presence per
 *    dimension. A dimension is `linked` when explicit data exists,
 *    `shared` when only persona-level data exists, `none` otherwise.
 *
 * 2. **Live answer overlay** — applied by the caller via
 *    `applyAnswerOverlay(row, answersByCategory)`. As the user answers
 *    questions in the questionnaire, each adoption-question category
 *    maps to one of the 8 glyph dimensions; any answer in that category
 *    bumps the petal up one presence rung
 *    (`none` → `shared`, `shared` → `linked`). This is what gives the
 *    sigil its "lights up as you fill it in" feel.
 */
import type { GlyphRow, GlyphDimension, GlyphPresence } from '@/features/shared/glyph';
import type { AgentIR } from '@/lib/types/designTypes';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

/** Adoption-question category → glyph dimension. Categories not in this
 *  map don't move the sigil (the question is generic config). */
export const QUESTION_CATEGORY_TO_DIM: Record<string, GlyphDimension> = {
  credentials: 'connector',
  configuration: 'task',
  human_in_the_loop: 'review',
  memory: 'memory',
  notifications: 'message',
  domain: 'task',
  quality: 'error',
};

const ALL_DIMS: GlyphDimension[] = [
  'trigger', 'task', 'connector', 'message',
  'review', 'memory', 'event', 'error',
];

function isLinkedFromUseCases(
  useCases: ReadonlyArray<Record<string, unknown>>,
  predicate: (uc: Record<string, unknown>) => boolean,
): boolean {
  return useCases.some(predicate);
}

/**
 * Build the centerpiece's composite row from a template's design payload.
 * Falls back to an all-`none` row when the payload is shaped unexpectedly
 * so the sigil never throws and just renders dim.
 */
export function buildQuestionnaireGlyphRow(
  result: AgentIR | null,
  templateName: string,
): GlyphRow {
  const presence: Record<GlyphDimension, GlyphPresence> = {
    trigger: 'none', task: 'none', connector: 'none', message: 'none',
    review: 'none', memory: 'none', event: 'none', error: 'none',
  };

  if (!result) {
    return emptyRow(templateName, presence);
  }

  // Triggers — `linked` when at least one trigger spec exists.
  if ((result.suggested_triggers?.length ?? 0) > 0) {
    presence.trigger = 'linked';
  }

  // Task — always at least `shared` when the persona has any prompt content
  // (every template does); `linked` when a use_case explicitly declares
  // sample_input or capability_summary (signs of authored task content).
  presence.task = 'shared';
  const useCasesRaw = ((result as unknown) as { use_cases?: unknown[] }).use_cases;
  const useCases: Array<Record<string, unknown>> = Array.isArray(useCasesRaw)
    ? (useCasesRaw.filter((u): u is Record<string, unknown> => typeof u === 'object' && u !== null))
    : [];
  if (
    useCases.length > 0 &&
    isLinkedFromUseCases(useCases, (uc) =>
      typeof uc.capability_summary === 'string' || !!uc.sample_input,
    )
  ) {
    presence.task = 'linked';
  }

  // Connector — `linked` when the template declares ≥1 connector slot.
  if ((result.suggested_connectors?.length ?? 0) > 0) {
    presence.connector = 'linked';
  }

  // Message — `linked` when notification channels exist either persona-wide
  // or on at least one use_case. `shared` when message_composition is set
  // but no concrete channel.
  const hasPersonaChannels = (result.suggested_notification_channels?.length ?? 0) > 0;
  const hasUseCaseChannels = isLinkedFromUseCases(useCases, (uc) => {
    const ch = uc.notification_channels;
    return Array.isArray(ch) && ch.length > 0;
  });
  if (hasPersonaChannels || hasUseCaseChannels) {
    presence.message = 'linked';
  } else if (((result as unknown) as { persona?: { message_composition?: unknown } })
    .persona?.message_composition !== undefined) {
    presence.message = 'shared';
  }

  // Review — `linked` when at least one use_case declares an explicit
  // review_policy (typically `always` or `on_uncertainty`). Templates that
  // explicitly opt out (`mode: never`) still count as authored intent.
  if (
    isLinkedFromUseCases(useCases, (uc) => {
      const rp = uc.review_policy as Record<string, unknown> | undefined;
      return !!rp && typeof rp.mode === 'string';
    })
  ) {
    presence.review = 'linked';
  }

  // Memory — `linked` when at least one use_case declares memory_policy
  // with `enabled: true`. `shared` when any UC declares it but disabled.
  let anyMemDeclared = false;
  let anyMemEnabled = false;
  for (const uc of useCases) {
    const mp = uc.memory_policy as Record<string, unknown> | undefined;
    if (mp && typeof mp.enabled === 'boolean') {
      anyMemDeclared = true;
      if (mp.enabled) anyMemEnabled = true;
    }
  }
  if (anyMemEnabled) presence.memory = 'linked';
  else if (anyMemDeclared) presence.memory = 'shared';

  // Event — `linked` when subscriptions OR emit_events exist on any UC,
  // or `result.suggested_event_subscriptions` is non-empty.
  const hasPersonaSubs = (result.suggested_event_subscriptions?.length ?? 0) > 0;
  const hasUseCaseEvents = isLinkedFromUseCases(useCases, (uc) => {
    const sub = uc.event_subscriptions;
    const emit = uc.emit_events;
    return (Array.isArray(sub) && sub.length > 0) || (Array.isArray(emit) && emit.length > 0);
  });
  if (hasPersonaSubs || hasUseCaseEvents) presence.event = 'linked';

  // Error — `linked` when persona.error_handling has substantive content.
  const errH = ((result as unknown) as { persona?: { error_handling?: unknown } })
    .persona?.error_handling;
  if (typeof errH === 'string' && errH.trim().length > 20) {
    presence.error = 'linked';
  }

  return {
    id: 'questionnaire-preview',
    title: templateName,
    summary: typeof result.summary === 'string' ? result.summary : undefined,
    enabled: true,
    triggers: [],
    connectors: [],
    steps: [],
    events: [],
    presence,
    shared: false,
  };
}

/**
 * Apply the live answer overlay. Each adoption-question category that has
 * at least one answered question bumps its mapped dimension up one rung
 * (`none` → `shared`, `shared` → `linked`). Already-`linked` stays linked.
 */
export function applyAnswerOverlay(
  base: GlyphRow,
  questions: ReadonlyArray<TransformQuestionResponse>,
  answers: Readonly<Record<string, string>>,
): GlyphRow {
  // Bucket answered questions by category.
  const answeredCats = new Set<string>();
  for (const q of questions) {
    const ans = answers[q.id];
    if (!ans || !ans.trim()) continue;
    const cat = q.category;
    if (cat) answeredCats.add(cat);
  }
  if (answeredCats.size === 0) return base;

  const next = { ...base.presence };
  for (const cat of answeredCats) {
    const dim = QUESTION_CATEGORY_TO_DIM[cat];
    if (!dim) continue;
    if (next[dim] === 'none') next[dim] = 'shared';
    else if (next[dim] === 'shared') next[dim] = 'linked';
  }
  return { ...base, presence: next };
}

/** Subtract from a presence map — used by progress chips to show how
 *  many dimensions remain pending (`none`) vs already configured. */
export function countDimensionsByState(row: GlyphRow): Record<GlyphPresence, number> {
  const counts: Record<GlyphPresence, number> = { linked: 0, shared: 0, none: 0 };
  for (const dim of ALL_DIMS) {
    counts[row.presence[dim]]++;
  }
  return counts;
}

function emptyRow(
  templateName: string,
  presence: Record<GlyphDimension, GlyphPresence>,
): GlyphRow {
  return {
    id: 'questionnaire-preview',
    title: templateName,
    enabled: false,
    triggers: [],
    connectors: [],
    steps: [],
    events: [],
    presence,
    shared: false,
  };
}
