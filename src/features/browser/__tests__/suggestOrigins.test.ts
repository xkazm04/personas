/**
 * The address bar's ranking, which is the whole of the suggestion feature that
 * can be wrong without anyone noticing: a popup that lists the right rows in
 * the wrong order still looks like it works.
 */
import { describe, expect, it } from 'vitest';

import type { BrowserSite } from '../types';
import {
  expandOriginPattern,
  portFromQuery,
  suggestOrigins,
  MAX_ORIGIN_SUGGESTIONS,
} from '../webview/suggestOrigins';

function site(origin: string, label = '', enabled = true): BrowserSite {
  return {
    origin,
    label,
    enabled,
    overrides: {},
    budget: 50,
    credential_id: null,
    scan_status: 'none',
    scan_tier: null,
    scan_report: null,
    scan_at: null,
    first_seen: 0,
    last_seen: 0,
    created_by: 'operator',
  };
}

describe('suggestOrigins ranking', () => {
  const sites = [
    site('https://app.example.com'),
    site('https://docs.other.com', 'Example handbook'),
    site('https://ex-am-pl.io'),
    site('https://mail.example.com'),
  ];

  it('offers nothing until something is typed', () => {
    expect(suggestOrigins('', sites)).toEqual([]);
    expect(suggestOrigins('   ', sites)).toEqual([]);
  });

  it('puts an origin prefix above a host substring, a label, then a subsequence', () => {
    const kinds = suggestOrigins('exampl', sites).map((s) => [s.target, s.kind]);
    expect(kinds).toEqual([
      ['https://app.example.com', 'host'],
      ['https://mail.example.com', 'host'],
      ['https://docs.other.com', 'label'],
      ['https://ex-am-pl.io', 'fuzzy'],
    ]);
  });

  it('calls a real prefix a prefix, with or without the scheme typed', () => {
    expect(suggestOrigins('https://app.ex', sites)[0].kind).toBe('prefix');
    expect(suggestOrigins('app.ex', sites)[0].kind).toBe('prefix');
  });

  it('never returns more than the cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => site(`https://site${i}.example.com`));
    expect(suggestOrigins('example', many)).toHaveLength(MAX_ORIGIN_SUGGESTIONS);
    expect(suggestOrigins('example', many, 3)).toHaveLength(3);
  });
});

describe('paused rows', () => {
  const sites = [site('https://paused.example.com', '', false), site('https://live.example.com')];

  it('shows a paused row but never lets it be selected', () => {
    const out = suggestOrigins('example', sites);
    expect(out.map((s) => s.selectable)).toEqual([true, false]);
    expect(out[1].target).toBe('https://paused.example.com');
  });

  it('ranks every enabled row above every paused one, whatever the match quality', () => {
    // The paused row is an exact prefix; the enabled one is only a subsequence.
    const out = suggestOrigins('pau', [
      site('https://paused.example.com', '', false),
      site('https://p-a-u.example.com'),
    ]);
    expect(out[0].target).toBe('https://p-a-u.example.com');
    expect(out[0].selectable).toBe(true);
  });
});

describe('pattern expansion', () => {
  it('expands a wildcard host to its apex', () => {
    expect(expandOriginPattern('https://*.example.com')).toBe('https://example.com');
  });

  it('takes the port the operator typed, and invents none when they typed none', () => {
    expect(expandOriginPattern('http://localhost:*')).toBe('http://localhost');
    expect(expandOriginPattern('http://localhost:*', '3000')).toBe('http://localhost:3000');
  });

  it('leaves a concrete origin alone', () => {
    expect(expandOriginPattern('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('reads a port out of the query only when one was really typed', () => {
    expect(portFromQuery('localhost:3000')).toBe('3000');
    expect(portFromQuery('http://localhost:8080')).toBe('8080');
    expect(portFromQuery('localhost')).toBe(null);
    expect(portFromQuery('http://localhost:*')).toBe(null);
  });

  it('suggests a pattern row through its expansion and marks it as one', () => {
    const sites = [site('https://*.example.com'), site('http://localhost:*')];
    const [first] = suggestOrigins('example.com', sites);
    expect(first.pattern).toBe(true);
    expect(first.site.origin).toBe('https://*.example.com');
    expect(first.target).toBe('https://example.com');

    const [local] = suggestOrigins('localhost:3000', sites);
    expect(local.target).toBe('http://localhost:3000');
  });
});
