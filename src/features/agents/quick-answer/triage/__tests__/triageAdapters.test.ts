/**
 * What each adapter tells the reviewer, and what it refuses to invent.
 *
 * Two properties run through the whole file:
 *  • the build-question adapter's granularity — one card per SESSION, not per
 *    question, because `answer_build_question` resumes the halted CLI, so N
 *    cards for N questions meant N resumes of the same build;
 *  • the card must carry every fact that changes what the decision MEANS, and
 *    must never print the same fact twice under two labels.
 */
import { describe, it, expect } from 'vitest';

import {
  DEFAULT_TRIAGE_COPY,
  bodyWithoutTitle,
  ideaToTriage,
  isDeferredQuestion,
  practiceToTriage,
  questionGroupToTriage,
  reviewToTriage,
  type QuestionSession,
  type TriageReviewRow,
} from '../triageAdapters';
import type { KnowledgeItemView } from '@/features/overview/sub_patterns/libraryModel';
import type { BacklogIdea } from '@/features/overview/sub_manual-review/components/backlog/backlogModel';
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

function review(overrides: Partial<TriageReviewRow> = {}): TriageReviewRow {
  return {
    id: 'rev-1',
    persona_id: 'p1',
    execution_id: 'exec-1',
    review_type: '',
    content: 'The migration will drop two columns.',
    severity: 'high',
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    title: 'Approve the schema migration',
    created_at: '2026-02-01T00:00:00.000Z',
    resolved_at: null,
    source: 'local',
    persona_name: 'Migrator',
    persona_color: '#123456',
    assignment_id: null,
    step_id: null,
    use_case_id: null,
    ...overrides,
  };
}

function idea(overrides: Partial<BacklogIdea> = {}): BacklogIdea {
  return {
    id: 'idea-1',
    title: 'Cache the roster query',
    description: 'It runs on every render.',
    reasoning: '',
    category: 'performance',
    origin: null,
    scanType: 'code',
    projectId: 'proj-1',
    projectName: 'Personas',
    effort: 3,
    impact: 8,
    risk: 2,
    priority: null,
    status: 'pending',
    evidence: null,
    verifyState: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function practice(overrides: Partial<KnowledgeItemView> = {}): KnowledgeItemView {
  return {
    id: 'k-1',
    kind: 'pattern',
    status: 'observed',
    title: 'Own IPC behind a wrapper',
    statement: 'Every invoke goes through invokeWithTimeout.',
    topic: 'code/ipc',
    layers: ['api'],
    frameworks: ['Tauri'],
    originProjectId: null,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    decidedAt: null,
    confidence: 0.8,
    abstraction: 'meso',
    ftype: null,
    durability: 'durable',
    governingId: null,
    evidenceCount: 4,
    ...overrides,
  };
}

const factValue = (item: { facts: { id: string; value: string }[] }, id: string) =>
  item.facts.find((f) => f.id === id)?.value;

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

/* -------------------------------------------------------------------------- */
/* Reviews — the whole story                                                   */
/* -------------------------------------------------------------------------- */

describe('bodyWithoutTitle', () => {
  it('strips a headline the shaper prepended to the description', () => {
    expect(bodyWithoutTitle('Approve it\nbecause of X', 'Approve it')).toBe('because of X');
  });

  it('returns nothing when the body IS the headline', () => {
    expect(bodyWithoutTitle('Approve it', 'Approve it')).toBe('');
    expect(bodyWithoutTitle('  Approve it  ', 'Approve it')).toBe('');
  });

  it('leaves a body that merely mentions the title alone', () => {
    expect(bodyWithoutTitle('We should approve it today', 'Approve it')).toBe(
      'We should approve it today',
    );
  });

  it('survives an empty title or body', () => {
    expect(bodyWithoutTitle(null, 'Approve it')).toBe('');
    expect(bodyWithoutTitle('body', '')).toBe('body');
  });
});

describe('reviewToTriage — persona identity', () => {
  it('carries the enriched persona name and colour onto the card', () => {
    const item = reviewToTriage(review(), copy);
    expect(factValue(item, 'persona')).toBe('Migrator');
    expect(item.source.label).toBe('Migrator');
    expect(item.source.color).toBe('#123456');
  });

  it('falls back to a label rather than rendering undefined when identity is missing', () => {
    const item = reviewToTriage(review({ persona_name: undefined, persona_color: undefined }), copy);
    expect(factValue(item, 'persona')).toBe('—');
    expect(item.source.label).toBe(copy.persona);
  });
});

describe('reviewToTriage — never the same fact twice', () => {
  it('prints no type at all when the shaper filled it with the severity', () => {
    // The exact defect: `review_type: r.severity` made every card read
    // "Severity: high · Type: high".
    const item = reviewToTriage(review({ review_type: 'high', severity: 'high' }), copy);
    expect(item.facts.some((f) => f.id === 'type')).toBe(false);
    expect(item.tags.filter((tag) => tag.label === 'high')).toHaveLength(1);
  });

  it('does print a type that is actually a type', () => {
    const item = reviewToTriage(review({ review_type: 'build_output' }), copy);
    expect(factValue(item, 'type')).toBe('build output');
    expect(item.tags.map((tag) => tag.id)).toContain('type');
  });

  it('does not repeat the headline as the body first line', () => {
    const item = reviewToTriage(
      review({ title: 'Approve the migration', content: 'Approve the migration\nIt drops a column.' }),
      copy,
    );
    expect(item.body).toBe('It drops a column.');
  });

  it('falls back to the no-description copy when the body was only the headline', () => {
    const item = reviewToTriage(review({ title: 'Ship it', content: 'Ship it' }), copy);
    expect(item.body).toBe(copy.noDescription);
  });
});

describe('reviewToTriage — a held team step is not an advisory review', () => {
  it('raises an alert and outranks the same review standing alone', () => {
    const advisory = reviewToTriage(review(), copy);
    const blocking = reviewToTriage(review({ assignment_id: 'asg-1', step_id: 'step-1' }), copy);

    expect(advisory.alert).toBeUndefined();
    expect(blocking.alert).toMatchObject({ id: 'blocking', tone: 'danger' });
    expect(blocking.alert?.detail).toBeTruthy();
    expect(blocking.weight).toBeGreaterThan(advisory.weight);
  });

  it('treats a step link alone as blocking too', () => {
    expect(reviewToTriage(review({ step_id: 'step-1' }), copy).alert).toBeTruthy();
  });

  it('carries the resume-loop ids in the payload, not in a fact row', () => {
    const item = reviewToTriage(review({ assignment_id: 'asg-1', step_id: 'step-1' }), copy);
    expect(item.payload).toMatchObject({ assignmentId: 'asg-1', stepId: 'step-1' });
    expect(item.facts.map((f) => f.value)).not.toContain('asg-1');
  });
});

describe('reviewToTriage — seeing the run', () => {
  it('offers the run link and the execution id it needs', () => {
    const item = reviewToTriage(review(), copy);
    expect(item.links?.map((l) => l.id)).toEqual(['run']);
    expect(item.payload?.executionId).toBe('exec-1');
  });

  it('offers no link when there is no run behind the review', () => {
    expect(reviewToTriage(review({ execution_id: '' }), copy).links).toBeUndefined();
  });

  it('keeps the link OUT of branches — following it must not resolve the card', () => {
    const item = reviewToTriage(review(), copy);
    expect(item.branches.map((b) => b.id)).not.toContain('run');
  });
});

/* -------------------------------------------------------------------------- */
/* Ideas — the Strategist's rank                                               */
/* -------------------------------------------------------------------------- */

describe('ideaToTriage — priority', () => {
  it('shows the rank as a tag and a fact when the Strategist set one', () => {
    const item = ideaToTriage(idea({ priority: 2 }), copy);
    expect(item.tags.find((tag) => tag.id === 'priority')?.label).toBe('#2');
    expect(factValue(item, 'priority')).toBe('#2');
  });

  it('marks the top of the queue louder than the tail', () => {
    expect(ideaToTriage(idea({ priority: 1 }), copy).tags[0]!.tone).toBe('danger');
    expect(ideaToTriage(idea({ priority: 9 }), copy).tags[0]!.tone).toBe('accent');
  });

  it('says nothing at all when the idea is unranked', () => {
    const item = ideaToTriage(idea({ priority: null }), copy);
    expect(item.tags.some((tag) => tag.id === 'priority')).toBe(false);
    expect(item.facts.some((f) => f.id === 'priority')).toBe(false);
  });

  it('still ranks a prioritised idea above an identical unranked one', () => {
    expect(ideaToTriage(idea({ priority: 1 }), copy).weight).toBeGreaterThan(
      ideaToTriage(idea({ priority: null }), copy).weight,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Practices — what an adopt costs                                             */
/* -------------------------------------------------------------------------- */

describe('practiceToTriage — applicability and blast radius', () => {
  it('states which stacks the practice applies to', () => {
    const item = practiceToTriage(practice(), 'Platform', null, copy);
    expect(factValue(item, 'applies')).toBe('api, Tauri');
  });

  it('says "any stack" rather than an empty cell when it constrains nothing', () => {
    const item = practiceToTriage(practice({ layers: [], frameworks: [] }), 'Platform', null, copy);
    expect(factValue(item, 'applies')).toBe(copy.appliesToAny);
  });

  it('states how many member repos an adopt would touch', () => {
    const item = practiceToTriage(practice(), 'Platform', null, copy, {
      members: 9,
      applicable: 4,
    });
    expect(factValue(item, 'reach')).toBe('4 of 9 repos');
  });

  it('claims no blast radius at all when the caller could not resolve one', () => {
    const item = practiceToTriage(practice(), 'Platform', null, copy);
    expect(item.facts.some((f) => f.id === 'reach')).toBe(false);
  });
});
