// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { healthCheckToastTone } from '../commandPaletteUtils';

describe('healthCheckToastTone', () => {
  it('is success only when every section passed', () => {
    expect(healthCheckToastTone({ sections: [], allOk: true })).toBe('success');
  });

  it('is warning when the report says a check failed', () => {
    expect(healthCheckToastTone({ sections: [], allOk: false })).toBe('warning');
  });
});
