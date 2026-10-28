// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { classifyUnknownErrorFull } from '../errorPipeline';

describe('classifyUnknownErrorFull with an IPC AppError', () => {
  it('classifies the AppError text rather than "[object Object]"', () => {
    const out = classifyUnknownErrorFull({ error: 'request timed out after 30s', kind: 'internal' });
    expect(out.raw).toBe('request timed out after 30s');
  });
});
