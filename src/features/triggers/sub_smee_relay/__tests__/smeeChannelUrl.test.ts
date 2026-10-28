// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isValidSmeeChannelUrl } from '../smeeChannelUrl';

describe('isValidSmeeChannelUrl', () => {
  it.each([
    'https://smee.io/abc123',
    '  https://smee.io/abc123  ',
    'https://smee.io/AbC_123-x',
  ])('accepts %j', (u) => expect(isValidSmeeChannelUrl(u)).toBe(true));

  it.each([
    '',
    'https://smee.io',
    'https://smee.io/',
    'https://smee.io//',
    '  https://smee.io/  ',
    'http://smee.io/abc123',
    'https://evil.example/https://smee.io/abc',
    'smee.io/abc123',
  ])('rejects %j', (u) => expect(isValidSmeeChannelUrl(u)).toBe(false));
});
