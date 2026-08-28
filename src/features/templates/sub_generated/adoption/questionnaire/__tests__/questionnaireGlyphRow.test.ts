import { describe, it, expect } from 'vitest';
import type { AgentIR } from '@/lib/types/designTypes';
import type { GlyphDimension, GlyphPresence } from '@/features/shared/glyph';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import {
  applyAnswerOverlay,
  buildQuestionnaireGlyphRow,
  countDimensionsByState,
  QUESTION_CATEGORY_TO_DIM,
} from '../questionnaireGlyphRow';

/**
 * CONTRACT TEST — this file exists to pin FIELD NAMES, not just behaviour.
 *
 * `buildQuestionnaireGlyphRow` reads `use_cases[]` and `persona.*` off the
 * template payload, and neither is declared on `AgentIR`. The three casts in
 * the module (`result as unknown as { use_cases?: unknown[] }` and friends)
 * keep compiling no matter what the real payload is called, so a rename on the
 * producing side would leave every petal at `none` — the sigil renders DIM,
 * which looks like an unconfigured template rather than an error. Nothing else
 * in the tree compares these names. These assertions do.
 */

/** Invariant: the fixture is the payload shape the sigil actually reads —
 *  the declared `AgentIR` fields plus the undeclared `use_cases` / `persona`
 *  the module casts past. The cast is confined to building fixtures. */
function payload(over: Record<string, unknown> = {}): AgentIR {
  return over as unknown as AgentIR;
}

function q(id: string, category: string): TransformQuestionResponse {
  return { id, question: `Q ${id}`, type: 'select', category };
}

const ALL_NONE: Record<GlyphDimension, GlyphPresence> = {
  trigger: 'none', task: 'none', connector: 'none', message: 'none',
  review: 'none', memory: 'none', event: 'none', error: 'none',
};

describe('buildQuestionnaireGlyphRow — payload contract', () => {
  it('renders an all-none disabled row when there is no payload at all', () => {
    // The sigil must never throw on a template that failed to parse; it goes
    // dim instead. `enabled: false` is what distinguishes "nothing loaded"
    // from "loaded and nothing configured".
    const row = buildQuestionnaireGlyphRow(null, 'Tpl');
    expect(row.presence).toEqual(ALL_NONE);
    expect(row.enabled).toBe(false);
    expect(row.title).toBe('Tpl');
  });

  it('gives every parsed template a baseline task presence and nothing else', () => {
    // Every template has prompt content, so `task` starts at `shared`. If this
    // ever reads `none`, the base layer stopped running at all.
    const row = buildQuestionnaireGlyphRow(payload(), 'Tpl');
    expect(row.enabled).toBe(true);
    expect(row.presence).toEqual({ ...ALL_NONE, task: 'shared' });
  });

  it('reads the persona-level arrays by their declared AgentIR names', () => {
    const row = buildQuestionnaireGlyphRow(
      payload({
        suggested_triggers: [{ trigger_type: 'schedule' }],
        suggested_connectors: [{ name: 'slack' }],
        suggested_notification_channels: [{ type: 'slack' }],
        suggested_event_subscriptions: [{ event_name: 'x' }],
        summary: 'A summary',
      }),
      'Tpl',
    );
    expect(row.presence.trigger).toBe('linked');
    expect(row.presence.connector).toBe('linked');
    expect(row.presence.message).toBe('linked');
    expect(row.presence.event).toBe('linked');
    expect(row.summary).toBe('A summary');
  });

  it('reads the UNDECLARED use_cases[] fields the AgentIR type does not carry', () => {
    // Every key asserted here is invisible to the compiler. A rename of
    // `use_cases`, `capability_summary`, `review_policy.mode`,
    // `memory_policy.enabled`, `notification_channels`, `event_subscriptions`
    // or `emit_events` fails HERE and nowhere else.
    const row = buildQuestionnaireGlyphRow(
      payload({
        use_cases: [
          {
            capability_summary: 'Does a thing',
            review_policy: { mode: 'always' },
            memory_policy: { enabled: true },
            notification_channels: ['slack'],
            event_subscriptions: ['evt.a'],
          },
        ],
      }),
      'Tpl',
    );
    expect(row.presence.task).toBe('linked');
    expect(row.presence.review).toBe('linked');
    expect(row.presence.memory).toBe('linked');
    expect(row.presence.message).toBe('linked');
    expect(row.presence.event).toBe('linked');
  });

  it('treats emit_events as event evidence on its own', () => {
    const row = buildQuestionnaireGlyphRow(
      payload({ use_cases: [{ emit_events: ['evt.b'] }] }),
      'Tpl',
    );
    expect(row.presence.event).toBe('linked');
  });

  it('separates declared-but-disabled memory from undeclared memory', () => {
    // `enabled: false` is still authored intent, so it earns `shared`; a
    // use_case with no memory_policy at all stays `none`. Collapsing the two
    // would make an explicit opt-out indistinguishable from an unwritten one.
    const declaredOff = buildQuestionnaireGlyphRow(
      payload({ use_cases: [{ memory_policy: { enabled: false } }] }),
      'Tpl',
    );
    expect(declaredOff.presence.memory).toBe('shared');
    const absent = buildQuestionnaireGlyphRow(payload({ use_cases: [{}] }), 'Tpl');
    expect(absent.presence.memory).toBe('none');
  });

  it('reads the UNDECLARED persona.* fields, and holds error to substantive content', () => {
    // `persona.error_handling` only counts past 20 trimmed characters — a stub
    // string must not light the petal. `persona.message_composition` is the
    // weaker signal that earns `shared` when no concrete channel exists.
    const stub = buildQuestionnaireGlyphRow(
      payload({ persona: { error_handling: '   short   ', message_composition: 'terse' } }),
      'Tpl',
    );
    expect(stub.presence.error).toBe('none');
    expect(stub.presence.message).toBe('shared');

    const substantive = buildQuestionnaireGlyphRow(
      payload({ persona: { error_handling: 'Retry twice, then escalate to the operator.' } }),
      'Tpl',
    );
    expect(substantive.presence.error).toBe('linked');
  });

  it('goes dim rather than throwing on a use_cases field of the wrong shape', () => {
    // The guard that makes the module safe to point at any payload: a
    // non-array, or an array of non-objects, must degrade to the baseline row.
    for (const useCases of [null, 'nope', 42, [null, 'x', 7]]) {
      const row = buildQuestionnaireGlyphRow(payload({ use_cases: useCases }), 'Tpl');
      expect(row.presence).toEqual({ ...ALL_NONE, task: 'shared' });
    }
  });
});

describe('applyAnswerOverlay', () => {
  const base = buildQuestionnaireGlyphRow(payload(), 'Tpl');

  it('bumps a mapped category one rung per answered category', () => {
    // `task` starts at `shared` and reaches `linked`; `memory` starts at
    // `none` and reaches `shared`. One rung, not a jump to linked.
    const next = applyAnswerOverlay(
      base,
      [q('a', 'configuration'), q('b', 'memory')],
      { a: 'yes', b: 'yes' },
    );
    expect(next.presence.task).toBe('linked');
    expect(next.presence.memory).toBe('shared');
  });

  it('ignores blank and missing answers', () => {
    const next = applyAnswerOverlay(base, [q('a', 'memory')], { a: '   ' });
    expect(next).toBe(base);
    expect(applyAnswerOverlay(base, [q('a', 'memory')], {})).toBe(base);
  });

  it('leaves the row untouched for a category with no dimension mapping', () => {
    // `boundaries` is a canonical question category that no glyph dimension
    // claims, so answering one moves nothing. Pinned deliberately: if a
    // mapping is added, this assertion is the place that says so.
    expect(QUESTION_CATEGORY_TO_DIM.boundaries).toBeUndefined();
    const next = applyAnswerOverlay(base, [q('a', 'boundaries')], { a: 'yes' });
    expect(next.presence).toEqual(base.presence);
  });

  it('never demotes an already-linked dimension', () => {
    const linked = buildQuestionnaireGlyphRow(
      payload({ suggested_connectors: [{ name: 'slack' }] }),
      'Tpl',
    );
    const next = applyAnswerOverlay(linked, [q('a', 'credentials')], { a: 'slack' });
    expect(next.presence.connector).toBe('linked');
  });
});

describe('countDimensionsByState', () => {
  it('counts all eight petals into exactly one bucket each', () => {
    const counts = countDimensionsByState(buildQuestionnaireGlyphRow(payload(), 'Tpl'));
    expect(counts).toEqual({ linked: 0, shared: 1, none: 7 });
    expect(counts.linked + counts.shared + counts.none).toBe(8);
  });
});
