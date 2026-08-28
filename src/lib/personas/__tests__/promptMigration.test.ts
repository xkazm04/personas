import { describe, it, expect } from 'vitest';
import {
  parseFromRecord,
  toEditableStructuredPrompt,
  fromEditableStructuredPrompt,
  getSectionSummary,
} from '../promptMigration';

describe('custom-section identity', () => {
  const withSection = {
    instructions: 'Do the thing',
    customSections: [{ id: 'sec-stable-1', title: 'Notes', content: 'Body' }],
  };

  it('parseFromRecord preserves an incoming section id', () => {
    const parsed = parseFromRecord(withSection);
    expect(parsed!.customSections[0]!.id).toBe('sec-stable-1');
  });

  it('parseFromRecord mints an id for a legacy section that has none', () => {
    const parsed = parseFromRecord({
      instructions: 'x',
      customSections: [{ title: 'Notes', content: 'Body' }],
    });
    expect(parsed!.customSections[0]!.id).toBeTruthy();
  });

  // n8nTypes.ts calls fromEditable(toEditable(x)) on both load and save. The
  // editable type used to have no `id` field at all, so the stable id the
  // section carries was dropped on every such pass and re-minted on the next
  // parse — defeating the React keying the id exists for.
  it('survives a fromEditable(toEditable(...)) round-trip', () => {
    const roundTripped = fromEditableStructuredPrompt(
      toEditableStructuredPrompt(withSection),
    );
    const sections = roundTripped.customSections as Array<Record<string, unknown>>;
    expect(sections[0]!.id).toBe('sec-stable-1');

    // ...and the id is still there after the value is parsed back in.
    const reparsed = parseFromRecord(roundTripped);
    expect(reparsed!.customSections[0]!.id).toBe('sec-stable-1');
  });

  it('does not invent an id for an editable section that never had one', () => {
    const out = fromEditableStructuredPrompt({
      identity: '',
      instructions: 'x',
      toolGuidance: '',
      examples: '',
      errorHandling: '',
      webSearch: '',
      customSections: [{ key: 'k', label: 'L', content: 'C' }],
    });
    const sections = out.customSections as Array<Record<string, unknown>>;
    expect(sections[0]).not.toHaveProperty('id');
  });
});

describe('getSectionSummary', () => {
  it('returns full section text keyed by display label', () => {
    const long = 'x'.repeat(300);
    const summary = getSectionSummary(
      JSON.stringify({ instructions: long, identity: 'Who' }),
    );
    expect(summary['Identity']).toBe('Who');
    // Documented as "first 80 chars" for a long time; it never truncated.
    expect(summary['Instructions']).toHaveLength(300);
  });

  it('returns an empty map for null or unparseable input', () => {
    expect(getSectionSummary(null)).toEqual({});
    expect(getSectionSummary('{ not json')).toEqual({});
  });
});
