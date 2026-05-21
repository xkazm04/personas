import { describe, it, expect } from 'vitest';
import {
  buildAdoptionAnswers,
  placeholderFor,
  type TemplateMeta,
  type TemplateQuestion,
} from '../template-marathon-fixtures';

/**
 * CI-gated unit tests for the template-marathon harness's pure fixture
 * logic. The marathon RUN needs a live app and cannot be a per-PR gate;
 * these guard the harness's own correctness — chiefly the D4 fix that
 * vault-credential questions must NOT be seeded (a placeholder answer
 * poisons the persona's connector binding).
 */

function meta(questions: TemplateQuestion[]): TemplateMeta {
  // buildAdoptionAnswers only reads `questions`; cast a minimal object.
  return { questions } as TemplateMeta;
}

function q(partial: Partial<TemplateQuestion> & { id: string }): TemplateQuestion {
  return { default: '', kind: '', isVaultQuestion: false, ...partial };
}

describe('buildAdoptionAnswers', () => {
  it('omits vault-credential questions so real auto-detect binds them', () => {
    const answers = buildAdoptionAnswers(
      meta([
        q({ id: 'aq_crm', isVaultQuestion: true }),
        q({ id: 'aq_poll_interval', default: '3 minutes' }),
      ]),
    );
    expect(answers).not.toHaveProperty('aq_crm');
    expect(answers.aq_poll_interval).toBe('3 minutes');
  });

  it('seeds non-vault questions with their default when present', () => {
    const answers = buildAdoptionAnswers(meta([q({ id: 'aq_days', default: '90' })]));
    expect(answers.aq_days).toBe('90');
  });

  it('returns an empty map when every question is a vault question', () => {
    const answers = buildAdoptionAnswers(
      meta([
        q({ id: 'aq_crm', isVaultQuestion: true }),
        q({ id: 'aq_kb', isVaultQuestion: true }),
      ]),
    );
    expect(Object.keys(answers)).toHaveLength(0);
  });
});

describe('placeholderFor', () => {
  it('returns the template default when one exists', () => {
    expect(placeholderFor(q({ id: 'x', default: 'hello' }))).toBe('hello');
  });

  it('picks a typed placeholder for an empty-default question', () => {
    expect(placeholderFor(q({ id: 'output_dir' }))).toBe('./marathon-output');
    expect(placeholderFor(q({ id: 'app_url' }))).toBe('http://localhost:3000');
    expect(placeholderFor(q({ id: 'max_retries' }))).toBe('5');
    expect(placeholderFor(q({ id: 'something_else' }))).toBe('marathon-default');
  });
});
