// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { deepScanCommand } from '../scanSweep';

describe('deepScanCommand', () => {
  it('scopes a context with --one (the only form scan-sweep accepts)', () => {
    expect(deepScanCommand('security-auditor', 'Vault')).toBe(
      '/scan-sweep --one Vault --lenses security-auditor',
    );
  });

  it('joins several lenses with commas', () => {
    expect(deepScanCommand(['error-handler', ' code-optimizer '], 'Fleet')).toBe(
      '/scan-sweep --one Fleet --lenses error-handler,code-optimizer',
    );
  });

  it('quotes a context name that carries spaces', () => {
    expect(deepScanCommand('ux-reviewer', 'Home Dashboard')).toBe(
      '/scan-sweep --one "Home Dashboard" --lenses ux-reviewer',
    );
  });

  it('omits --one for a whole-repo pass', () => {
    expect(deepScanCommand('ux-reviewer', null)).toBe('/scan-sweep --lenses ux-reviewer');
    expect(deepScanCommand('ux-reviewer', '  ')).toBe('/scan-sweep --lenses ux-reviewer');
  });
});
