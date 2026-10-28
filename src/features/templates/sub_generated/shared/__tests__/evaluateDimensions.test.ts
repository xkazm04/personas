// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { AgentIR } from '@/lib/types/designTypes';
import { evaluateDimensions } from '../DimensionRadial';

// The backend scores the same thresholds over UTF-8 byte lengths.
const design = (over: Record<string, unknown>) => over as AgentIR;

describe('evaluateDimensions parity with score_design_result', () => {
  it('counts a non-Latin summary in UTF-8 bytes, as the backend does', () => {
    const summary = '毎朝受信箱を要約して重要なメールだけを知らせます'; // 24 chars, 72 bytes
    expect(summary.length).toBeLessThanOrEqual(50);
    expect(evaluateDimensions(design({ summary })).summary).toBe(true);
  });

  it('counts a Czech prompt identity and instructions in bytes', () => {
    const structured_prompt = {
      identity: 'Účetní čtečka faktur', // 20 chars, 25 bytes
      instructions: 'Přečti každou příchozí fakturu, ověř částku, ulož.', // 50 chars, 61 bytes
      toolGuidance: 'x',
    };
    expect(structured_prompt.identity.length).toBeLessThanOrEqual(20);
    expect(structured_prompt.instructions.length).toBeLessThanOrEqual(50);
    expect(evaluateDimensions(design({ structured_prompt })).prompt).toBe(true);
  });

  it('needs a string trigger_type, not just the key', () => {
    expect(evaluateDimensions(design({ suggested_triggers: [{ trigger_type: null }] })).triggers).toBe(false);
    expect(evaluateDimensions(design({ suggested_triggers: [{ trigger_type: 'schedule' }] })).triggers).toBe(true);
  });

  it('keeps an ASCII summary at the same threshold', () => {
    expect(evaluateDimensions(design({ summary: 'a'.repeat(50) })).summary).toBe(false);
    expect(evaluateDimensions(design({ summary: 'a'.repeat(51) })).summary).toBe(true);
  });
});
