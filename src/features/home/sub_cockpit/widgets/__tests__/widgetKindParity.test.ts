import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { cockpitWidgetRegistry } from '../../widgetRegistry';

/**
 * The widget kinds the backend will EMIT are written down in five places that
 * nothing compared with the registry that RENDERS them: the dispatcher's chat
 * cards and its `explain_in_cockpit` allowlist, the briefing allowlist, the op
 * catalog's `compose_cockpit` vocabulary, and Athena's constitution. A kind
 * renamed or retired on this side kept being emitted on that one and rendered as
 * the "unknown widget" error tile, which is exactly what `EXPLAIN_KINDS` was
 * written to prevent ("an explanation with a hallucinated kind renders as an
 * error box at the worst possible moment").
 *
 * Every emitted kind must be either a registry key or one of the chat-only
 * kinds InlineChatCard special-cases before it reaches the registry.
 */
const ROOT = resolve(__dirname, '../../../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Rust / TS line comments out, so a kind named only in prose never counts. */
const code = (src: string) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, '')).join('\n');

const all = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]!);
const bars = (list: string) => list.split('|').map((s) => s.trim()).filter(Boolean);
const block = (src: string, name: string) => {
  const at = src.indexOf(name);
  expect(at, `${name} not found`).toBeGreaterThan(-1);
  return src.slice(at, src.indexOf('];', at));
};

const dispatch = code(read('src-tauri/src/companion/dispatcher/dispatch.rs'));
const briefing = code(read('src-tauri/src/companion/brain/briefing.rs'));
const catalog = code(read('src-tauri/src/companion/dispatcher/catalog.rs'));
const constitution = read('src-tauri/src/companion/templates/constitution.md');
const inlineCard = code(read('src/features/companions/athena/InlineChatCard.tsx'));

const SOURCES: Record<string, string[]> = {
  'dispatch.rs chat cards': [
    ...all(dispatch, /\bkind:\s*"([a-z_]+)"/g),
    ...all(dispatch, /"show_[a-z_]+"\s*=>\s*"([a-z_]+)"/g),
  ],
  'dispatch.rs EXPLAIN_KINDS': all(block(dispatch, 'EXPLAIN_KINDS'), /"([a-z_]+)"/g),
  'briefing.rs BRIEFING_WIDGET_KINDS': all(block(briefing, 'BRIEFING_WIDGET_KINDS'), /"([a-z_]+)"/g),
  'catalog.rs compose_cockpit': all(catalog, /op!\("compose_cockpit"[^\n]*?kind:([a-z_|]+)/g).flatMap(bars),
  'constitution.md compose/explain': all(
    constitution,
    /"action": "(?:compose_cockpit|explain_in_cockpit)"[^\n]*?"kind": "([a-z_|]+)"/g,
  ).flatMap(bars),
};

const CHAT_ONLY = new Set(all(inlineCard, /card\.kind === '([a-z_]+)'/g));
const RENDERABLE = new Set([...Object.keys(cockpitWidgetRegistry), ...CHAT_ONLY]);

describe('widget kinds the backend emits are kinds the frontend renders', () => {
  it('every source list was actually read (a matcher that finds nothing is broken)', () => {
    expect(CHAT_ONLY.size).toBeGreaterThan(0);
    for (const [name, kinds] of Object.entries(SOURCES)) {
      expect(kinds.length, name).toBeGreaterThan(0);
    }
  });

  for (const [name, kinds] of Object.entries(SOURCES)) {
    it(`${name}: no kind is missing from the registry`, () => {
      expect([...new Set(kinds)].filter((k) => !RENDERABLE.has(k))).toEqual([]);
    });
  }
});
