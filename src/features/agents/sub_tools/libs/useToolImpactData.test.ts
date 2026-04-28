import { describe, it, expect } from 'vitest';
import { recommendationFromCoUsedTools } from './useToolImpactData';
import type { ToolImpactData } from './toolImpactTypes';

function impact(coUsedTools: { toolName: string; coOccurrences: number }[]): ToolImpactData {
  return {
    useCaseRefs: [],
    usage: null,
    avgCostPerInvocation: null,
    totalCost: 0,
    credentialLinked: true,
    credentialRequired: false,
    credentialType: null,
    coUsedTools,
  };
}

describe('recommendationFromCoUsedTools', () => {
  it('returns null when the tool itself is already assigned', () => {
    const result = recommendationFromCoUsedTools(
      impact([{ toolName: 'web_search', coOccurrences: 10 }]),
      true,
      new Set(['web_search']),
    );
    expect(result).toBeNull();
  });

  it('returns null when impact data is missing', () => {
    expect(recommendationFromCoUsedTools(undefined, false, new Set(['web_search']))).toBeNull();
  });

  it('returns null when no co-used tool overlaps with assigned tools', () => {
    const result = recommendationFromCoUsedTools(
      impact([
        { toolName: 'web_search', coOccurrences: 10 },
        { toolName: 'pdf_parse', coOccurrences: 4 },
      ]),
      false,
      new Set(['file_read']),
    );
    expect(result).toBeNull();
  });

  it('returns the highest-co-occurrence overlapping tool', () => {
    const result = recommendationFromCoUsedTools(
      impact([
        { toolName: 'web_search', coOccurrences: 10 },
        { toolName: 'pdf_parse', coOccurrences: 4 },
        { toolName: 'image_gen', coOccurrences: 2 },
      ]),
      false,
      new Set(['pdf_parse', 'image_gen']),
    );
    // web_search has the highest count but is not assigned;
    // pdf_parse (count 4) is assigned and outranks image_gen (count 2).
    expect(result).toBe('pdf_parse');
  });

  it('is deterministic across renders given the same input', () => {
    const data = impact([
      { toolName: 'a', coOccurrences: 5 },
      { toolName: 'b', coOccurrences: 5 },
    ]);
    const assigned = new Set(['a', 'b']);
    const r1 = recommendationFromCoUsedTools(data, false, assigned);
    const r2 = recommendationFromCoUsedTools(data, false, assigned);
    expect(r1).toBe(r2);
    // First in the pre-sorted array wins; useToolImpactData sorts descending.
    expect(r1).toBe('a');
  });

  it('returns null when assignedToolNames is empty', () => {
    const result = recommendationFromCoUsedTools(
      impact([{ toolName: 'web_search', coOccurrences: 10 }]),
      false,
      new Set(),
    );
    expect(result).toBeNull();
  });
});
