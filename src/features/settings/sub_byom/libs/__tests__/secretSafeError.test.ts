import { describe, it, expect } from 'vitest';
import { secretSafeErrorCode } from '../secretSafeError';

describe('secretSafeErrorCode', () => {
  it('names the AppError kind of an IPC rejection instead of "object"', () => {
    // The shape invokeWithTimeout rejects with: an object, not an Error.
    expect(secretSafeErrorCode({ error: 'rejected sk-live-123', kind: 'Validation' })).toBe('Validation');
  });

  it('never returns any part of the message, which may hold the secret', () => {
    const code = secretSafeErrorCode({ error: 'sk-live-123 was refused', kind: 'Internal' });
    expect(code).not.toContain('sk-live');
  });

  it('refuses a kind that is free text rather than an identifier', () => {
    expect(secretSafeErrorCode({ kind: 'sk-live-123 leaked here' })).toBe('object');
  });

  it('keeps the Error name for thrown errors', () => {
    expect(secretSafeErrorCode(new TypeError('sk-live-123'))).toBe('TypeError');
  });

  it('falls back to the value type when nothing safe is present', () => {
    expect(secretSafeErrorCode({ error: 'sk-live-123' })).toBe('object');
    expect(secretSafeErrorCode('sk-live-123')).toBe('string');
    expect(secretSafeErrorCode(null)).toBe('object');
  });
});
