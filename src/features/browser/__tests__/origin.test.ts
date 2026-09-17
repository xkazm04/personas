import { describe, expect, it } from 'vitest';

import {
  browserOriginProblem,
  isBrowserOriginPattern,
  isValidBrowserOrigin,
  normalizeBrowserOrigin,
  originMatchesPattern,
} from '../types';

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

describe('wildcard patterns', () => {
  it('accepts the two forms the grammar allows', () => {
    expect(isValidBrowserOrigin('https://*.example.com')).toBe(true);
    expect(isValidBrowserOrigin('http://localhost:*')).toBe(true);
    expect(isValidBrowserOrigin('https://*.example.com:8443')).toBe(true);
    expect(isBrowserOriginPattern('https://*.example.com')).toBe(true);
    expect(isBrowserOriginPattern('http://localhost:*')).toBe(true);
    expect(isBrowserOriginPattern('http://localhost:3000')).toBe(false);
  });

  it('refuses a wildcard anywhere the server would refuse one', () => {
    expect(isValidBrowserOrigin('https://*')).toBe(false);
    expect(isValidBrowserOrigin('https://*.')).toBe(false);
    expect(isValidBrowserOrigin('https://ex*mple.com')).toBe(false);
    expect(isValidBrowserOrigin('https://*.*.example.com')).toBe(false);
    expect(isValidBrowserOrigin('https://*.example.com/*')).toBe(false);
    expect(isValidBrowserOrigin('http://localhost:*0')).toBe(false);
  });

  it('names WHICH mistake was made, so the form can say it', () => {
    expect(browserOriginProblem('https://example.com')).toBe(null);
    expect(browserOriginProblem('')).toBe('empty');
    expect(browserOriginProblem('https://example.com/login')).toBe('url_not_origin');
    expect(browserOriginProblem('https://example.com?q=1')).toBe('url_not_origin');
    expect(browserOriginProblem('https://ex*mple.com')).toBe('wildcard_misplaced');
    expect(browserOriginProblem('https://*')).toBe('wildcard_misplaced');
    expect(browserOriginProblem('ftp://example.com')).toBe('not_an_origin');
  });

  it('normalises a pattern without round-tripping through new URL', () => {
    // `new URL` rejects the `*`, so the old implementation would have handed
    // the capitalised string straight back.
    expect(normalizeBrowserOrigin('HTTPS://*.Example.COM/')).toBe('https://*.example.com');
    expect(normalizeBrowserOrigin('  http://LocalHost:*  ')).toBe('http://localhost:*');
  });
});

describe('originMatchesPattern', () => {
  it('covers the apex and any subdomain depth', () => {
    expect(originMatchesPattern('https://*.example.com', 'https://example.com')).toBe(true);
    expect(originMatchesPattern('https://*.example.com', 'https://app.example.com')).toBe(true);
    expect(originMatchesPattern('https://*.example.com', 'https://a.b.c.example.com')).toBe(true);
  });

  it('matches on a label boundary, never on a substring', () => {
    expect(originMatchesPattern('https://*.example.com', 'https://evil-example.com')).toBe(false);
    expect(originMatchesPattern('https://*.example.com', 'https://example.com.evil')).toBe(false);
    expect(originMatchesPattern('https://*.example.com', 'https://notexample.com')).toBe(false);
  });

  it('holds the scheme and the port to their word', () => {
    expect(originMatchesPattern('https://*.example.com', 'http://app.example.com')).toBe(false);
    expect(originMatchesPattern('http://localhost:*', 'http://localhost:3000')).toBe(true);
    expect(originMatchesPattern('http://localhost:*', 'http://localhost')).toBe(true);
    expect(originMatchesPattern('http://localhost:3000', 'http://localhost:3001')).toBe(false);
    // An omitted port means "no port", not "any port".
    expect(originMatchesPattern('http://localhost', 'http://localhost:3000')).toBe(false);
  });

  it('answers false when the concrete side is itself a pattern', () => {
    expect(originMatchesPattern('https://*.example.com', 'https://*.example.com')).toBe(false);
    expect(originMatchesPattern('http://localhost:*', 'http://localhost:*')).toBe(false);
  });
});
