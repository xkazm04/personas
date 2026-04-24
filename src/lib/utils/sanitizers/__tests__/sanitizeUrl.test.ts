import { describe, it, expect } from 'vitest';
import { sanitizeExternalUrl, sanitizeIconUrl } from '../sanitizeUrl';

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
      // "java​script:alert(1)"
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
});
