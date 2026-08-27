import { describe, it, expect } from 'vitest';
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import {
  isStackable,
  normalizeOptions,
  resolveStackableOptions,
  summarizeAnswer,
} from '../questionnaireHelpers';

function q(over: Partial<TransformQuestionResponse> = {}): TransformQuestionResponse {
  return { id: 'q1', question: 'Which one?', type: 'select', ...over };
}

describe('normalizeOptions', () => {
  it('flattens both authored shapes to one option record', () => {
    // Templates author plain strings OR {value,label,description}. Every
    // downstream widget reads `label`, so a string option must carry its own
    // value as the label rather than rendering blank.
    expect(normalizeOptions(['slack'])).toEqual([
      { value: 'slack', label: 'slack', sublabel: null },
    ]);
    expect(
      normalizeOptions([{ value: 'slack', label: 'Slack', description: 'Team chat' }]),
    ).toEqual([{ value: 'slack', label: 'Slack', sublabel: 'Team chat' }]);
  });

  it('falls back to the value when an object option omits its label', () => {
    expect(normalizeOptions([{ value: 'slack' }])).toEqual([
      { value: 'slack', label: 'slack', sublabel: null },
    ]);
  });

  it('returns an empty list for absent or empty option arrays', () => {
    expect(normalizeOptions(undefined)).toEqual([]);
    expect(normalizeOptions([])).toEqual([]);
  });
});

describe('resolveStackableOptions', () => {
  it('answers a boolean question with the yes/no VALUES the payload consumes', () => {
    // Labels are localized; the stored answer must stay the machine token,
    // because the payload mapping and any stored answer reference the value.
    const opts = resolveStackableOptions(q({ type: 'boolean' }));
    expect(opts.map((o) => o.value)).toEqual(['yes', 'no']);
  });

  it('prefers the vault-narrowed list over the template option list', () => {
    // When 2+ credentials match, the caller passes a filtered list; showing
    // the unfiltered template options would offer a credential-less pick.
    const opts = resolveStackableOptions(
      q({ options: ['a', 'b', 'c'] }),
      ['b', 'c'],
    );
    expect(opts.map((o) => o.value)).toEqual(['b', 'c']);
  });

  it('returns nothing for types the stacked picker does not render', () => {
    expect(resolveStackableOptions(q({ type: 'text' }))).toEqual([]);
    expect(resolveStackableOptions(q({ type: 'directory_picker' }))).toEqual([]);
  });
});

describe('isStackable', () => {
  it('accepts booleans and fixed-option selects', () => {
    expect(isStackable(q({ type: 'boolean' }), 2)).toBe(true);
    expect(isStackable(q({ type: 'select' }), 3)).toBe(true);
  });

  it('rejects dynamic, allow-custom and optionless selects', () => {
    // Each of these needs a richer widget than a numbered card stack:
    // dynamic_source fetches live, allow_custom needs a text escape hatch,
    // and a select with no options has nothing to stack.
    expect(
      isStackable(
        q({ dynamic_source: { service_type: 'slack', operation: 'list_channels' } }),
        3,
      ),
    ).toBe(false);
    expect(isStackable(q({ allow_custom: true }), 3)).toBe(false);
    expect(isStackable(q({ type: 'select' }), 0)).toBe(false);
  });

  it('rejects a boolean even with zero resolved options', () => {
    // Boolean options are synthesised, never read off the template, so an
    // optCount of 0 must not disqualify it.
    expect(isStackable(q({ type: 'boolean' }), 0)).toBe(true);
  });
});

describe('summarizeAnswer', () => {
  it('collapses a multi-value answer without losing the count', () => {
    expect(summarizeAnswer('a')).toBe('a');
    expect(summarizeAnswer('a, b')).toBe('a and b');
    expect(summarizeAnswer('a, b, c, d')).toBe('a, b +2 more');
  });

  it('returns an empty string for an empty answer', () => {
    expect(summarizeAnswer('')).toBe('');
  });

  it('drops blank segments rather than rendering a dangling separator', () => {
    expect(summarizeAnswer('a, , b')).toBe('a and b');
  });
});
