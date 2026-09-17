import { describe, it, expect } from 'vitest';
import { isBlockedHostname, sanitizeExternalUrl, sanitizeIconUrl } from '../sanitizeUrl';

describe('sanitizeExternalUrl', () => {
  describe('allows safe http/https URLs', () => {
    it('accepts https URLs', () => {
      expect(sanitizeExternalUrl('https://example.com/path?q=1')).toBe(
        'https://example.com/path?q=1',
      );
    });

    it('accepts http URLs', () => {
      expect(sanitizeExternalUrl('http://example.com')).toBe('http://example.com/');
    });

    it('trims surrounding whitespace', () => {
      expect(sanitizeExternalUrl('  https://example.com  ')).toBe('https://example.com/');
    });
  });

  describe('blocks dangerous schemes', () => {
    it('blocks javascript: scheme', () => {
      expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    });

    it('blocks JavaScript: with mixed case', () => {
      expect(sanitizeExternalUrl('JavaScript:alert(1)')).toBeNull();
    });

    it('blocks data: scheme', () => {
      expect(
        sanitizeExternalUrl('data:text/html,<script>alert(1)</script>'),
      ).toBeNull();
    });

    it('blocks file: scheme', () => {
      expect(sanitizeExternalUrl('file:///etc/passwd')).toBeNull();
    });

    it('blocks vbscript: scheme', () => {
      expect(sanitizeExternalUrl('vbscript:msgbox(1)')).toBeNull();
    });

    it('blocks custom schemes', () => {
      expect(sanitizeExternalUrl('myapp://open?x=1')).toBeNull();
      expect(sanitizeExternalUrl('ms-settings:privacy')).toBeNull();
    });
  });

  describe('blocks unicode/obfuscation attack vectors', () => {
    it('blocks javascript: hidden with zero-width space', () => {
      // "java<U+200B>script:alert(1)" — literal ZWS in the string below
      expect(sanitizeExternalUrl('java​script:alert(1)')).toBeNull();
    });

    it('blocks URLs with right-to-left override', () => {
      // "‮https://evil.example/" — RLO flips display but URL is unsafe
      expect(sanitizeExternalUrl('‮https://evil.example/')).toBeNull();
    });

    it('blocks URLs with left-to-right override', () => {
      expect(sanitizeExternalUrl('‭https://example.com/')).toBeNull();
    });

    it('blocks URLs containing zero-width joiner', () => {
      expect(sanitizeExternalUrl('https://example.com/‍path')).toBeNull();
    });

    it('blocks URLs containing BOM', () => {
      expect(sanitizeExternalUrl('﻿https://example.com')).toBeNull();
    });

    it('blocks URLs with C0 control chars (newline)', () => {
      expect(sanitizeExternalUrl('https://example.com\n<script>')).toBeNull();
    });

    it('blocks URLs with DEL char', () => {
      expect(sanitizeExternalUrl('https://example.com/\x7F')).toBeNull();
    });

    it('blocks URLs with line separator', () => {
      expect(sanitizeExternalUrl('https://example.com x')).toBeNull();
    });

    it('blocks URLs with LRI bidi isolate', () => {
      expect(sanitizeExternalUrl('⁦https://example.com')).toBeNull();
    });
  });

  describe('blocks embedded credentials', () => {
    it('blocks URLs with username', () => {
      expect(sanitizeExternalUrl('https://user@example.com')).toBeNull();
    });

    it('blocks URLs with user:pass', () => {
      expect(sanitizeExternalUrl('https://user:pass@example.com')).toBeNull();
    });
  });

  describe('blocks malformed URLs', () => {
    it('returns null for empty string', () => {
      expect(sanitizeExternalUrl('')).toBeNull();
    });

    it('returns null for whitespace-only', () => {
      expect(sanitizeExternalUrl('   ')).toBeNull();
    });

    it('returns null for null/undefined', () => {
      expect(sanitizeExternalUrl(null)).toBeNull();
      expect(sanitizeExternalUrl(undefined)).toBeNull();
    });

    it('returns null for non-string input', () => {
      // @ts-expect-error — testing runtime defense
      expect(sanitizeExternalUrl(123)).toBeNull();
    });

    it('returns null for relative URLs', () => {
      expect(sanitizeExternalUrl('/path/only')).toBeNull();
    });

    it('returns null for plain text', () => {
      expect(sanitizeExternalUrl('not a url')).toBeNull();
    });
  });
});

describe('sanitizeIconUrl', () => {
  it('accepts https URLs', () => {
    expect(sanitizeIconUrl('https://cdn.example.com/icon.png')).toBe(
      'https://cdn.example.com/icon.png',
    );
  });

  it('blocks http (non-https) URLs', () => {
    expect(sanitizeIconUrl('http://example.com/icon.png')).toBeNull();
  });

  it('blocks javascript: scheme', () => {
    expect(sanitizeIconUrl('javascript:alert(1)')).toBeNull();
  });

  it('blocks data: URLs', () => {
    expect(sanitizeIconUrl('data:image/svg+xml,<svg/onload=alert(1)>')).toBeNull();
  });

  it('blocks private/local hostnames', () => {
    expect(sanitizeIconUrl('https://localhost/a.png')).toBeNull();
    expect(sanitizeIconUrl('https://127.0.0.1/a.png')).toBeNull();
    expect(sanitizeIconUrl('https://192.168.1.1/a.png')).toBeNull();
    expect(sanitizeIconUrl('https://10.0.0.1/a.png')).toBeNull();
    expect(sanitizeIconUrl('https://foo.local/a.png')).toBeNull();
  });

  it('blocks embedded credentials', () => {
    expect(sanitizeIconUrl('https://user:pass@example.com/a.png')).toBeNull();
  });

  it('blocks the cloud metadata address and IPv6 private literals', () => {
    expect(sanitizeIconUrl('https://169.254.169.254/latest/meta-data')).toBeNull();
    expect(sanitizeIconUrl('https://[fe80::1]/a.png')).toBeNull();
    expect(sanitizeIconUrl('https://[fc00::1]/a.png')).toBeNull();
  });
});

// `isBlockedHostname` is the shared blocklist: `sanitizeIconUrl` uses it for
// image sources and `variableSanitizer` for URL-type template variables. It
// covered RFC1918 and named loopback but not 169.254.0.0/16 - IPv4 link-local,
// and the range the cloud metadata services answer on - nor any IPv6 private
// range beyond a literal `[::1]`.
describe('isBlockedHostname', () => {
  it('blocks 169.254.0.0/16, including the metadata address', () => {
    expect(isBlockedHostname('169.254.169.254')).toBe(true);
    expect(isBlockedHostname('169.254.0.1')).toBe(true);
  });

  it('blocks IPv6 unique-local fc00::/7', () => {
    expect(isBlockedHostname('[fc00::1]')).toBe(true);
    expect(isBlockedHostname('[fd12:3456:789a::1]')).toBe(true);
  });

  it('blocks IPv6 link-local fe80::/10, with or without a zone id', () => {
    expect(isBlockedHostname('[fe80::1]')).toBe(true);
    expect(isBlockedHostname('[febf::1]')).toBe(true);
    expect(isBlockedHostname('[fe80::1%eth0]')).toBe(true);
  });

  it('still blocks the IPv6 loopback and unspecified addresses', () => {
    expect(isBlockedHostname('[::1]')).toBe(true);
    expect(isBlockedHostname('[::]')).toBe(true);
  });

  it('blocks a blocked IPv4 address smuggled in as an IPv4-mapped literal', () => {
    expect(isBlockedHostname('[::ffff:169.254.169.254]')).toBe(true);
    expect(isBlockedHostname('[::ffff:a9fe:a9fe]')).toBe(true);
    expect(isBlockedHostname('[::ffff:127.0.0.1]')).toBe(true);
  });

  it('leaves public hosts and public IPv6 alone', () => {
    expect(isBlockedHostname('example.com')).toBe(false);
    expect(isBlockedHostname('169.255.0.1')).toBe(false);
    expect(isBlockedHostname('168.254.169.254')).toBe(false);
    expect(isBlockedHostname('[2001:4860:4860::8888]')).toBe(false);
    expect(isBlockedHostname('[fec0::1]')).toBe(false);
    expect(isBlockedHostname('[::ffff:8.8.8.8]')).toBe(false);
  });
});
