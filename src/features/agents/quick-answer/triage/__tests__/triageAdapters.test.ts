/**
 * The build-question adapter's granularity.
 *
 * One card per SESSION, not per question — because `answer_build_question`
 * resumes the halted CLI, so N cards for N questions meant N resumes of the
 * same build and a one-line `_batch` payload each time.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TRIAGE_COPY,
  isDeferredQuestion,
  questionGroupToTriage,
  type QuestionSession,
} from '../triageAdapters';
import { makeBuildQuestion } from './triageFixtures';

function session(overrides: Partial<QuestionSession> = {}): QuestionSession {
  return {
    sessionId: 'sess-1',
    personaId: 'persona-1',
    personaName: 'Scribe',
    personaColor: '#abcdef',
    questions: [makeBuildQuestion()],
    ...overrides,
  };
}

const copy = DEFAULT_TRIAGE_COPY;

describe('questionGroupToTriage — one card per session', () => {
  it('folds every pending question of a session into a single card', () => {
    const item = questionGroupToTriage(
      session({
        questions: [
          makeBuildQuestion({ cellKey: 'tools', question: 'Which tools?' }),
          makeBuildQuestion({ cellKey: 'tone', question: 'What tone?' }),
          makeBuildQuestion({ cellKey: 'schedule', question: 'How often?' }),
        ],
      }),
      copy,
    );

    expect(item).not.toBeNull();
    expect(item!.input?.fields.map((f) => f.key)).toEqual(['tools', 'tone', 'schedule']);
    // The session is the write target — one call, not one per question.
    expect(item!.sourceId).toBe('sess-1');
    expect(item!.payload).toEqual({ sessionId: 'sess-1', personaId: 'persona-1' });
  });

  it('returns null for a session with nothing pending', () => {
    expect(questionGroupToTriage(session({ questions: [] }), copy)).toBeNull();
  });

  it('uses the question itself as the title when there is only one', () => {
    const item = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ question: 'Which inbox?' })] }),
      copy,
    );
    expect(item!.title).toBe('Which inbox?');
  });

  it('summarises the count when there is more than one', () => {
    const item = questionGroupToTriage(
      session({
        questions: [makeBuildQuestion({ cellKey: 'a' }), makeBuildQuestion({ cellKey: 'b' })],
      }),
      copy,
    );
    expect(item!.title).toContain('2');
    expect(item!.title).not.toContain('{count}');
  });

  it('gives a session a NEW id when its pending set changes', () => {
    // Otherwise a session that still has questions after a partial answer would
    // reuse the id the queue already marked resolved, and vanish forever.
    const two = questionGroupToTriage(
      session({
        questions: [makeBuildQuestion({ cellKey: 'tools' }), makeBuildQuestion({ cellKey: 'tone' })],
      }),
      copy,
    )!;
    const one = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ cellKey: 'tone' })] }),
      copy,
    )!;

    expect(two.id).not.toBe(one.id);
  });

  it('is stable against the order questions arrive in', () => {
    const a = questionGroupToTriage(
      session({
        questions: [makeBuildQuestion({ cellKey: 'tools' }), makeBuildQuestion({ cellKey: 'tone' })],
      }),
      copy,
    )!;
    const b = questionGroupToTriage(
      session({
        questions: [makeBuildQuestion({ cellKey: 'tone' }), makeBuildQuestion({ cellKey: 'tools' })],
      }),
      copy,
    )!;

    expect(a.id).toBe(b.id);
  });
});

describe('questionGroupToTriage — field shapes', () => {
  it('marks an options question as a choice and carries its options', () => {
    const item = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ options: ['daily', 'weekly'] })] }),
      copy,
    )!;
    const [field] = item.input!.fields;

    expect(field.kind).toBe('choice');
    expect(field.options).toEqual(['daily', 'weekly']);
  });

  it('carries model suggestions onto a free-text field', () => {
    const item = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ suggested: ['gmail'] })] }),
      copy,
    )!;
    expect(item.input!.fields[0].suggestions).toEqual(['gmail']);
  });
});

describe('questionGroupToTriage — deferred questions', () => {
  const connector = makeBuildQuestion({ cellKey: 'creds', connectorCategory: 'email' });
  const attach = makeBuildQuestion({ cellKey: 'ref', acceptsReference: true });

  it('agrees with isDeferredQuestion about what needs the builder', () => {
    expect(isDeferredQuestion(connector)).toBe(true);
    expect(isDeferredQuestion(attach)).toBe(true);
    expect(isDeferredQuestion(makeBuildQuestion())).toBe(false);
  });

  it('marks a wholly deferred session as deferred and offers the deep-link', () => {
    const item = questionGroupToTriage(session({ questions: [connector, attach] }), copy)!;

    expect(item.input!.deferred).toBe(true);
    expect(item.input!.fields.every((f) => f.deferred)).toBe(true);
    expect(item.branches.map((b) => b.id)).toEqual(['builder']);
  });

  it('keeps a MIXED session answerable while still offering the builder', () => {
    // The chosen semantics: answer what this surface can, and let the picker-
    // only questions come back as their own card once the rest are submitted.
    const item = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ cellKey: 'tools' }), connector] }),
      copy,
    )!;

    expect(item.input!.deferred).toBe(false);
    expect(item.input!.fields.map((f) => !!f.deferred)).toEqual([false, true]);
    expect(item.branches.map((b) => b.id)).toEqual(['builder']);
  });

  it('offers no inline input for a deferred field', () => {
    const item = questionGroupToTriage(
      session({ questions: [makeBuildQuestion({ cellKey: 'creds', connectorCategory: 'email', options: ['a'] })] }),
      copy,
    )!;
    const [field] = item.input!.fields;

    expect(field.deferred).toBe(true);
    expect(field.kind).toBe('text');
    expect(field.options).toBeUndefined();
  });
});
