import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_WIDGET_ACTIONS, actionAllowedOn, type CockpitWidgetActionKind } from '../actionTypes';

/**
 * The tether for actionTypes.ts: the render-side action rules are read here
 * against the briefing sanitizer in src-tauri/src/companion/brain/briefing.rs
 * at run time (the webhookPatternParity precedent), so the per-kind gate that
 * CockpitGrid applies to a composed board cannot drift from the one Rust
 * applies to a morning briefing (DW-95).
 */

const RUST = readFileSync(
  resolve(__dirname, '../../../../../../src-tauri/src/companion/brain/briefing.rs'),
  'utf8',
);

function quoted(s: string): string[] {
  return [...s.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]!);
}

function rustList(name: string): string[] {
  const m = RUST.match(new RegExp(`const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`briefing.rs: ${name} not found`);
  return quoted(m[1]!);
}

/** action kind -> the widget kinds Rust allows it on, parsed from action_allowed_on. */
function rustAllowedOn(): Map<string, string[]> {
  const body = RUST.match(/fn action_allowed_on\([^)]*\) -> bool \{([\s\S]*?)\n\}/);
  if (!body) throw new Error('briefing.rs: action_allowed_on not found');
  const arms = new Map<string, string[]>();
  for (const line of body[1]!.split('\n')) {
    const arm = line.match(/^\s*([^=]+?)\s*=>\s*(.+?),?\s*$/);
    if (!arm || arm[1]!.trim() === '_') continue;
    const widgets = quoted(arm[2]!);
    for (const action of quoted(arm[1]!)) arms.set(action, widgets);
  }
  return arms;
}

describe('actionTypes parity with briefing.rs', () => {
  const actionKinds = rustList('ACTION_KINDS');
  const widgetKinds = [...rustList('BRIEFING_WIDGET_KINDS'), 'metric_spark', 'council_media', 'decisions_panel'];
  const allowed = rustAllowedOn();

  it('parses the Rust rule (a parse that finds nothing is a broken test, not a pass)', () => {
    expect(actionKinds.length).toBeGreaterThanOrEqual(4);
    expect(allowed.size).toBe(actionKinds.length);
  });

  it('allows each action on exactly the widget kinds Rust allows', () => {
    for (const action of actionKinds) {
      for (const widget of widgetKinds) {
        expect(
          actionAllowedOn(widget, action as CockpitWidgetActionKind),
          `${action} on ${widget}`,
        ).toBe(allowed.get(action)!.includes(widget));
      }
    }
  });

  it('caps actions per widget at the Rust MAX_ACTIONS', () => {
    const cap = RUST.match(/const MAX_ACTIONS: usize = (\d+);/);
    expect(cap).not.toBeNull();
    expect(MAX_WIDGET_ACTIONS).toBe(Number(cap![1]));
  });
});
