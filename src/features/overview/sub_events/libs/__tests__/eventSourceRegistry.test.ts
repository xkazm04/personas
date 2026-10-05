import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import en from '@/i18n/locales/en.json';
import {
  SOURCE_REGISTRY, ORIGIN_TONE, resolveSourceKey, resolveEventSource, eventSourceLabel,
} from '../eventSourceRegistry';

// The i18n catalog is a data boundary: `en.json` is typed as a wide JSON shape
// by the resolver, and only the generated `Translations` tree knows the real
// one. Everything below reads two known leaves of it (`status_tokens.*`,
// `overview.events.source_unknown`) and nothing else, so one narrow local
// shape is enough — and it is asserted against, not asserted past.
const t = en as unknown as {
  status_tokens: { event_source: Record<string, string>; event_origin: Record<string, string> };
  overview: { events: { source_unknown: string } };
};

const REPO_ROOT = resolve(__dirname, '../../../../../..');
const RUST_ROOTS = ['src-tauri/src', 'src-tauri/engine/src', 'src-tauri/db/src', 'src-tauri/core/src'];

/** Every `.rs` file under the backend, so the sweep below cannot silently
 *  visit nothing — a matcher that looks at no files is the failure mode this
 *  repo treats as distinct from "found nothing". */
function rustFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.rs')) out.push(p);
    }
  };
  for (const r of RUST_ROOTS) walk(join(REPO_ROOT, r));
  return out;
}

/**
 * Every literal `source_type: "<token>"` the backend assigns, excluding test
 * modules — those legitimately publish fixture tokens (`ci`, `github`,
 * `pipeline`, `watcher`, `y`) that no user ever sees.
 */
function emittedSourceTokens(): { tokens: Set<string>; filesVisited: number } {
  const ASSIGN = /source_type:\s*(?:Some\()?"([^"]+)"/g;
  const tokens = new Set<string>();
  const files = rustFiles();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    // Drop everything from the first `#[cfg(test)]` onward: in this backend a
    // test module is always the tail of the file.
    const cut = src.search(/#\[cfg\(test\)\]/);
    const prod = cut === -1 ? src : src.slice(0, cut);
    if (/\/(?:cross_domain_)?tests?\.rs$/.test(f.replace(/\\/g, '/'))) continue;
    for (const m of prod.matchAll(ASSIGN)) tokens.add(m[1]!);
  }
  return { tokens, filesVisited: files.length };
}

describe('eventSourceRegistry', () => {
  it('visits the whole Rust tree — a sweep that reads nothing is a broken sweep', () => {
    const { filesVisited } = emittedSourceTokens();
    // Measured 2026-10-05: 963 `.rs` files repo-wide. A floor well under that
    // catches a moved crate or a broken walk without failing on normal growth.
    expect(filesVisited).toBeGreaterThan(400);
  });

  it('covers every source_type production Rust actually emits', () => {
    const { tokens } = emittedSourceTokens();
    expect(tokens.size).toBeGreaterThan(20);
    const uncovered = [...tokens].filter((tok) => resolveSourceKey(tok) === null);
    // `test` is registered; anything else uncovered would render the warning
    // glyph in the Source column, which is what this file exists to prevent.
    expect(uncovered).toEqual([]);
  });

  it('gives every registry entry a translated label and a known origin tone', () => {
    const labels = t.status_tokens.event_source;
    for (const [key, entry] of Object.entries(SOURCE_REGISTRY)) {
      expect(labels[key], `status_tokens.event_source.${key}`).toBeTruthy();
      expect(ORIGIN_TONE[entry.origin], `tone for ${key}`).toBeTruthy();
    }
    // No label without an entry either — a dead token is a label nothing can
    // ever render.
    for (const key of Object.keys(labels)) {
      expect(SOURCE_REGISTRY[key], `registry entry for ${key}`).toBeTruthy();
    }
  });

  it('translates all four origins', () => {
    for (const origin of Object.keys(ORIGIN_TONE)) {
      expect(t.status_tokens.event_origin[origin], origin).toBeTruthy();
    }
  });

  it('folds the two open-ended prefixed families onto their base entry', () => {
    expect(resolveSourceKey('persona:Web_Gig_Specialist')).toBe('persona');
    expect(resolveSourceKey('persona:')).toBe('persona');
    expect(resolveSourceKey('trigger:daily-digest')).toBe('trigger_engine');
    // The BARE `trigger` is a different token with its own entry — it was the
    // case the old prefix-only matcher missed.
    expect(resolveSourceKey('trigger')).toBe('trigger');
  });

  it('resolves the three sources that dominated the live table', () => {
    // Measured 2026-10-05 over 164 real rows: audit_incident 54, autopilot 45,
    // system_op 9 — all three rendered a HelpCircle question mark before this
    // registry existed.
    for (const tok of ['audit_incident', 'autopilot', 'system_op']) {
      const r = resolveEventSource(t as never, tok);
      expect(r.known, tok).toBe(true);
      expect(r.label, tok).not.toBe(tok);
      expect(r.tone, tok).not.toBe('text-status-warning');
    }
  });

  it('never renders an empty Source cell, and makes an unknown look like a defect', () => {
    const r = resolveEventSource(t as never, 'brand_new_source');
    expect(r.known).toBe(false);
    // The owner's rule: the cell is never empty. The raw token is shown so the
    // operator can see what arrived.
    expect(r.label).toBe('brand_new_source');
    expect(r.tone).toBe('text-status-warning');

    // An empty/whitespace source_type cannot occur (the repo validates it on
    // publish) but must still not render a blank cell.
    expect(resolveEventSource(t as never, '   ').label).toBe(t.overview.events.source_unknown);
    expect(eventSourceLabel(t as never, '')).toBe(t.overview.events.source_unknown);
  });

  it('labels only genuinely human-originated sources as the operator acting', () => {
    const you = Object.entries(SOURCE_REGISTRY)
      .filter(([, e]) => e.origin === 'you').map(([k]) => k).sort();
    expect(you).toEqual(['app_focus', 'clipboard', 'manual_review', 'user']);
    // The two the owner read as his own activity are machine-published and the
    // row carries no origin flag, so neither may claim to be his action.
    expect(SOURCE_REGISTRY.audit_incident!.origin).toBe('app');
    expect(SOURCE_REGISTRY.system_op!.origin).toBe('app');
    expect(SOURCE_REGISTRY.autopilot!.origin).toBe('agent');
  });
});
