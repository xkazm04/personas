import { describe, expect, it } from 'vitest';

import { isValidBrowserOrigin, normalizeBrowserOrigin } from '../types';

describe('isValidBrowserOrigin', () => {
  it('accepts scheme + host, with and without a port', () => {
    expect(isValidBrowserOrigin('https://app.example.com')).toBe(true);
    expect(isValidBrowserOrigin('http://localhost:3000')).toBe(true);
    expect(isValidBrowserOrigin('https://example.com/')).toBe(true);
    expect(isValidBrowserOrigin('  https://example.com  ')).toBe(true);
  });

  it('rejects a URL the user pasted instead of an origin', () => {
    expect(isValidBrowserOrigin('https://example.com/login')).toBe(false);
    expect(isValidBrowserOrigin('https://example.com?q=1')).toBe(false);
    expect(isValidBrowserOrigin('https://example.com#top')).toBe(false);
    expect(isValidBrowserOrigin('https://user:pw@example.com')).toBe(false);
  });

  it('rejects anything that is not http(s)', () => {
    expect(isValidBrowserOrigin('example.com')).toBe(false);
    expect(isValidBrowserOrigin('ftp://example.com')).toBe(false);
    expect(isValidBrowserOrigin('file:///c:/tmp')).toBe(false);
    expect(isValidBrowserOrigin('javascript:alert(1)')).toBe(false);
    expect(isValidBrowserOrigin('')).toBe(false);
    expect(isValidBrowserOrigin('   ')).toBe(false);
  });
});

describe('normalizeBrowserOrigin', () => {
  it('lowercases the host and drops a trailing slash, the way Rust stores it', () => {
    expect(normalizeBrowserOrigin('https://App.Example.COM/')).toBe('https://app.example.com');
  });

  it('keeps an explicit non-default port', () => {
    expect(normalizeBrowserOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('hands back the trimmed input unchanged when it cannot parse', () => {
    expect(normalizeBrowserOrigin('  nonsense  ')).toBe('nonsense');
  });
});
