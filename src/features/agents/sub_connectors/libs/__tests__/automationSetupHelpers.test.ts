import { describe, it, expect } from 'vitest';
import {
  clampTimeoutSecs, deriveStageIndex,
  TIMEOUT_SECS_DEFAULT, TIMEOUT_SECS_MAX, TIMEOUT_SECS_MIN,
} from '../useAutomationSetup';
import { detectPlatformFromUrl } from '../automationTypes';

describe('clampTimeoutSecs', () => {
  it('keeps in-range integers and floors fractions', () => {
    expect(clampTimeoutSecs(45)).toBe(45);
    expect(clampTimeoutSecs(45.9)).toBe(45);
  });

  it('clamps to the shared bounds and falls back to the default for non-numbers', () => {
    expect(clampTimeoutSecs(0)).toBe(TIMEOUT_SECS_MIN);
    expect(clampTimeoutSecs(999_999_999)).toBe(TIMEOUT_SECS_MAX);
    expect(clampTimeoutSecs(Number.NaN)).toBe(TIMEOUT_SECS_DEFAULT);
    expect(clampTimeoutSecs(Number.POSITIVE_INFINITY)).toBe(TIMEOUT_SECS_DEFAULT);
  });
});

describe('deriveStageIndex', () => {
  it('reads the LAST recognised line, not the first', () => {
    expect(deriveStageIndex([])).toBe(0);
    expect(deriveStageIndex(['Connected to AI'])).toBe(1);
    expect(deriveStageIndex(['Connected', 'Analyzing requirements...'])).toBe(2);
    expect(deriveStageIndex(['Connected', 'Analyzing requirements', 'Designing automation'])).toBe(3);
    expect(deriveStageIndex(['Designing automation', 'Design complete'])).toBe(4);
    // An unrecognised trailing line does not reset the stage.
    expect(deriveStageIndex(['Design complete', 'some noise'])).toBe(4);
  });
});

describe('detectPlatformFromUrl', () => {
  it('recognises the three hosted platforms and nothing else', () => {
    expect(detectPlatformFromUrl('https://acme.app.n8n.cloud/webhook/abc')).toBe('n8n');
    expect(detectPlatformFromUrl('https://hooks.zapier.com/hooks/catch/1/2')).toBe('zapier');
    expect(detectPlatformFromUrl('https://api.github.com/repos/o/r/dispatches')).toBe('github_actions');
    expect(detectPlatformFromUrl('https://example.com/hook')).toBeNull();
  });
});
