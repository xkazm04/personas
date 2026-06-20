import { describe, expect, it } from 'vitest';
import { detectAutoResolution } from '../reviewHelpers';

// The note strings below are the EXACT machine markers the Rust backend writes:
//  - engine/dispatch.rs       → trust_llm: "auto-approved by trust_llm policy"
//  - engine/auto_triage.rs    → "auto_triage LLM verdict: {Approve|Reject} — {reasoning}"
//                             → fallback: "auto_triage evaluator failed — auto-resolved as fallback: {error}"
describe('detectAutoResolution', () => {
  it('detects trust_llm with no reasoning', () => {
    expect(detectAutoResolution({ reviewer_notes: 'auto-approved by trust_llm policy' })).toEqual({
      kind: 'trust_llm',
      reasoning: null,
    });
  });

  it('detects auto_triage approve and extracts the reasoning', () => {
    const r = detectAutoResolution({ reviewer_notes: 'auto_triage LLM verdict: Approve — output matches decision principles' });
    expect(r?.kind).toBe('auto_triage');
    expect(r?.reasoning).toBe('output matches decision principles');
  });

  it('detects auto_triage reject and extracts the reasoning', () => {
    const r = detectAutoResolution({ reviewer_notes: 'auto_triage LLM verdict: Reject — contradicts principle 3' });
    expect(r?.kind).toBe('auto_triage');
    expect(r?.reasoning).toBe('contradicts principle 3');
  });

  it('detects the auto_triage fallback note (no verdict line)', () => {
    const note = 'auto_triage evaluator failed — auto-resolved as fallback: request timed out';
    const r = detectAutoResolution({ reviewer_notes: note });
    expect(r?.kind).toBe('auto_triage');
    expect(r?.reasoning).toBe(note); // whole note when no "verdict:" segment
  });

  it('does NOT flag a human-written note', () => {
    expect(detectAutoResolution({ reviewer_notes: 'Approved by user after checking the output' })).toBeNull();
  });

  it('returns null for empty / missing notes', () => {
    expect(detectAutoResolution({ reviewer_notes: '' })).toBeNull();
    expect(detectAutoResolution({ reviewer_notes: null })).toBeNull();
  });
});
