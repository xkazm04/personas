import { describe, it, expect } from 'vitest';
import type { CellBuildStatus } from '@/lib/types/buildTypes';

/**
 * Completeness calculation logic (mirrors useMatrixBuild's derivation).
 *
 * Completeness = (resolved cells / total cells) * 100
 * Total cells = 8 (the 8 matrix dimensions)
 * A cell counts as resolved when its status is 'resolved'.
 */
const TOTAL_CELLS = 8;

function calculateCompleteness(cellStates: Record<string, CellBuildStatus>): number {
  const resolvedCount = Object.values(cellStates).filter((s) => s === 'resolved').length;
  return Math.round((resolvedCount / TOTAL_CELLS) * 100);
}

describe('completenessRing calculation', () => {
  it('returns 0 when no cells are resolved', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'hidden',
      connectors: 'hidden',
      triggers: 'hidden',
      'human-review': 'hidden',
      messages: 'hidden',
      memory: 'hidden',
      'error-handling': 'hidden',
      events: 'hidden',
    };
    expect(calculateCompleteness(states)).toBe(0);
  });

  it('returns 0 when cells are revealed but not resolved', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'revealed',
      connectors: 'revealed',
      triggers: 'pending',
      'human-review': 'filling',
      messages: 'hidden',
      memory: 'hidden',
      'error-handling': 'hidden',
      events: 'hidden',
    };
    expect(calculateCompleteness(states)).toBe(0);
  });

  it('returns 13 when 1 cell is resolved (1/8)', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'resolved',
      connectors: 'hidden',
      triggers: 'hidden',
      'human-review': 'hidden',
      messages: 'hidden',
      memory: 'hidden',
      'error-handling': 'hidden',
      events: 'hidden',
    };
    expect(calculateCompleteness(states)).toBe(13);
  });

  it('returns 50 when 4 cells are resolved', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'resolved',
      connectors: 'resolved',
      triggers: 'resolved',
      'human-review': 'resolved',
      messages: 'hidden',
      memory: 'hidden',
      'error-handling': 'hidden',
      events: 'hidden',
    };
    expect(calculateCompleteness(states)).toBe(50);
  });

  it('returns 100 when all 8 cells are resolved', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'resolved',
      connectors: 'resolved',
      triggers: 'resolved',
      'human-review': 'resolved',
      messages: 'resolved',
      memory: 'resolved',
      'error-handling': 'resolved',
      events: 'resolved',
    };
    expect(calculateCompleteness(states)).toBe(100);
  });

  it('returns 0 for empty cellStates', () => {
    expect(calculateCompleteness({})).toBe(0);
  });

  it('counts only resolved cells, not highlighted or error', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'resolved',
      connectors: 'highlighted',
      triggers: 'error',
      'human-review': 'filling',
      messages: 'pending',
      memory: 'resolved',
      'error-handling': 'revealed',
      events: 'hidden',
    };
    expect(calculateCompleteness(states)).toBe(25);
  });

  it('returns 75 when 6 cells are resolved', () => {
    const states: Record<string, CellBuildStatus> = {
      'use-cases': 'resolved',
      connectors: 'resolved',
      triggers: 'resolved',
      'human-review': 'resolved',
      messages: 'resolved',
      memory: 'resolved',
      'error-handling': 'filling',
      events: 'pending',
    };
    expect(calculateCompleteness(states)).toBe(75);
  });
});
