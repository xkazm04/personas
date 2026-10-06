import { describe, it, expect, vi } from 'vitest';
import {
  classifyDocumentUrl,
  prependDocumentStyle,
  resolveDocumentMedia,
  sanitizeDocumentCss,
  sanitizeHtmlDocument,
} from '../sanitizeHtml';

function parse(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('sanitizeHtmlDocument', () => {
  it('strips <script>, inline and in the head', () => {
    const out = sanitizeHtmlDocument(
      '<html><head><script>alert(1)</script></head><body><p>hi</p><script src="x.js"></script></body></html>',
    );
    expect(out).not.toMatch(/<script/i);
    expect(parse(out).body.textContent).toContain('hi');
  });

  it('strips on* event handlers', () => {
    const out = sanitizeHtmlDocument('<img src="data:image/png;base64,AA" onerror="alert(1)"><p onclick="x()">p</p>');
    expect(out).not.toMatch(/onerror|onclick/i);
    expect(parse(out).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA');
  });

  it('strips javascript: hrefs, including obfuscated ones', () => {
    const out = sanitizeHtmlDocument(
      '<a href="javascript:alert(1)">a</a><a href=" java&#x0A;script:alert(1)">b</a><a href="#sec">c</a>',
    );
    const links = Array.from(parse(out).querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([null, null, '#sec']);
  });

  it('REMOVES remote URLs rather than leaving them for the CSP', () => {
    const out = sanitizeHtmlDocument(
      '<img src="https://evil.example/x.png"><img src="//evil.example/y.png"><a href="https://example.com">ext</a>' +
        '<video poster="http://evil.example/p.jpg" src="clip.mp4"></video>',
    );
    expect(out).not.toMatch(/evil\.example|example\.com/);
  });

  it('removes frames, forms, base, meta and link', () => {
    const out = sanitizeHtmlDocument(
      '<html><head><meta http-equiv="refresh" content="0;url=https://x"><base href="https://x/"><link rel="stylesheet" href="https://x/a.css"></head>' +
        '<body><iframe src="a.html"></iframe><object data="a.swf"></object><embed src="a.swf"><form action="/x"><input></form></body></html>',
    );
    expect(out).not.toMatch(/<(iframe|object|embed|form|base|meta|link)\b/i);
  });

  it('keeps <style> and document tags, and rewrites remote CSS references', () => {
    const out = sanitizeHtmlDocument(
      '<html><head><style>@import url(https://x/a.css); h1 { color: rebeccapurple; background: url(https://x/bg.png); }</style></head>' +
        '<body><figure><table><tr><td>1</td></tr></table><figcaption>c</figcaption></figure><svg viewBox="0 0 2 2"><circle r="1"/></svg></body></html>',
    );
    const doc = parse(out);
    const css = doc.querySelector('style')?.textContent ?? '';
    expect(css).toContain('color: rebeccapurple');
    expect(css).not.toMatch(/@import|https:/);
    expect(doc.querySelector('table td')?.textContent).toBe('1');
    expect(doc.querySelector('figcaption')).not.toBeNull();
    expect(doc.querySelector('svg circle')).not.toBeNull();
    expect(out.startsWith('<!doctype html>')).toBe(true);
  });

  it('keeps relative media for the resolver, but never a relative link', () => {
    const out = sanitizeHtmlDocument('<img src="shots/a.png"><a href="other.html">x</a>');
    const doc = parse(out);
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('shots/a.png');
    expect(doc.querySelector('a')?.hasAttribute('href')).toBe(false);
  });
});

describe('classifyDocumentUrl', () => {
  it.each([
    ['#x', 'keep'],
    ['blob:tauri://localhost/abc', 'keep'],
    ['data:image/png;base64,AA', 'keep'],
    ['data:text/html,<script>', 'drop'],
    ['asset://localhost/x.png', 'keep'],
    ['http://asset.localhost/x.png', 'keep'],
    ['http://asset.localhost.evil.com/x.png', 'drop'],
    ['https://example.com/a.png', 'drop'],
    ['//example.com/a.png', 'drop'],
    ['/abs/a.png', 'drop'],
    ['javascript:alert(1)', 'drop'],
    ['shots/a.png', 'local'],
    ['./a.png', 'local'],
  ] as const)('%s -> %s', (url, kind) => {
    expect(classifyDocumentUrl(url)).toBe(kind);
  });
});

describe('sanitizeDocumentCss', () => {
  it('keeps inline urls and drops remote ones', () => {
    expect(sanitizeDocumentCss('a{background:url("data:image/png;base64,AA")}')).toContain('data:image/png');
    expect(sanitizeDocumentCss('a{background:url(https://x/y.png) no-repeat}')).toBe('a{background:none no-repeat}');
  });
});

describe('resolveDocumentMedia', () => {
  it('resolves relative src through the resolver', async () => {
    const resolve = vi.fn(async (src: string) => (src === 'shots/a.png' ? 'blob:app/1' : null));
    const out = await resolveDocumentMedia(
      sanitizeHtmlDocument('<img src="shots/a.png" alt="a"><img src="missing.png" alt="m">'),
      resolve,
    );
    const imgs = Array.from(parse(out).querySelectorAll('img'));
    expect(resolve).toHaveBeenCalledWith('shots/a.png');
    // The resolved one carries its blob URL; the unresolved one is gone, not broken.
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['blob:app/1']);
  });

  it('drops every local ref when there is no resolver', async () => {
    const out = await resolveDocumentMedia(sanitizeHtmlDocument('<p>t</p><img src="a.png"><video src="v.mp4"></video>'));
    expect(parse(out).querySelector('img,video')).toBeNull();
  });

  it('refuses a resolver answer that is a remote URL', async () => {
    const out = await resolveDocumentMedia(sanitizeHtmlDocument('<img src="a.png">'), async () => 'https://evil.example/a.png');
    expect(out).not.toContain('evil.example');
  });

  it('treats a throwing resolver as unresolved', async () => {
    const out = await resolveDocumentMedia(sanitizeHtmlDocument('<img src="a.png">'), async () => {
      throw new Error('nope');
    });
    expect(parse(out).querySelector('img')).toBeNull();
  });
});

describe('prependDocumentStyle', () => {
  it('puts the bridge FIRST so the document styles win', () => {
    const out = prependDocumentStyle(sanitizeHtmlDocument('<html><head><style>p{color:red}</style></head><body></body></html>'), ':root{--pa-x:1}');
    const styles = Array.from(parse(out).querySelectorAll('style'));
    expect(styles[0]?.hasAttribute('data-pa-theme')).toBe(true);
    expect(styles[1]?.textContent).toContain('color:red');
  });
});
