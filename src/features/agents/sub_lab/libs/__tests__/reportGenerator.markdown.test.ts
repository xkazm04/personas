// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabArenaRun } from '@/lib/bindings/LabArenaRun';
import { generateMarkdownReport } from '../reportGenerator';

function arenaRow(modelId: string): LabArenaResult {
  return {
    id: `${modelId}-s1`,
    runId: 'run-1',
    versionId: null,
    versionNumber: null,
    scenarioName: 's1',
    modelId,
    provider: 'anthropic',
    status: 'passed',
    outputPreview: null,
    toolAccuracyScore: 80,
    outputQualityScore: 70,
    protocolCompliance: 60,
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: 0.01,
    durationMs: 2500,
    rationale: null,
    suggestions: null,
    errorMessage: null,
    evalMethod: null,
    createdAt: '2026-05-01T00:00:00Z',
  };
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|');

describe('generateMarkdownReport summary table', () => {
  it('has a header cell for every row cell, so duration is not dropped under the wrong heading', () => {
    const md = generateMarkdownReport('arena', {} as LabArenaRun, [arenaRow('haiku')], 'Agent');
    const table = md.split('\n').filter((l) => l.startsWith('|'));
    const [header, separator, row] = table;
    expect(cells(header!).length).toBe(cells(row!).length);
    expect(cells(separator!).length).toBe(cells(row!).length);
    const durationAt = cells(header!).findIndex((c) => c.trim() === 'Avg Duration');
    expect(cells(row!)[durationAt]!.trim()).toBe('2.5s');
  });
});
