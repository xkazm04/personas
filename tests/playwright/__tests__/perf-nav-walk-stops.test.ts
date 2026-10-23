import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * perf-nav-walk's stops name surfaces by string (sidebar section, settings
 * tab, plugin tab, twin tab, bridge method). The live run cannot tell a stop
 * that reached its surface from one that silently did not: `openSettingsTab`
 * casts any string into the store, so `settings/config` (no such tab) rendered
 * SettingsPage with an undefined tab component for months, and
 * `triggerTestFlow` (no such bridge method) left the burst stop measuring a
 * quiet Events tab. This pins every name to the source that defines it.
 */

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const SPEC = strip(read('tests/playwright/perf-nav-walk.spec.ts'));
const TYPES = read('src/lib/types/types.ts');
const BRIDGE = strip(read('src/test/automation/bridge.ts'));

function unionMembers(typeName: string): string[] {
  const m = TYPES.match(new RegExp(`export type ${typeName} =([^;]+);`));
  if (!m) throw new Error(`union ${typeName} not found in types.ts`);
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
}

function constList(name: string): string[] {
  const m = BRIDGE.match(new RegExp(`const ${name} = \\[([^\\]]+)\\]`));
  if (!m) throw new Error(`${name} not found in bridge.ts`);
  return [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
}

function used(re: RegExp): string[] {
  return [...new Set([...SPEC.matchAll(re)].map((x) => x[1]!))];
}

describe('perf-nav-walk stops name real surfaces', () => {
  it('every navigate() section is a SidebarSection', () => {
    const valid = unionMembers('SidebarSection');
    const sections = used(/navigate\('([^']+)'\)/g);
    expect(sections.length).toBeGreaterThan(5);
    expect(sections.filter((s) => !valid.includes(s))).toEqual([]);
  });

  it('every openSettingsTab tab is a SettingsTab', () => {
    const valid = unionMembers('SettingsTab');
    const tabs = used(/'openSettingsTab', \{ tab: '([^']+)' \}/g);
    expect(tabs.length).toBeGreaterThan(5);
    expect(tabs.filter((t) => !valid.includes(t))).toEqual([]);
  });

  it('every plugin and twin tab is one the bridge accepts', () => {
    const plugin = used(/'setPluginTab', \{ tab: '([^']+)' \}/g);
    const twin = used(/'setTwinTab', \{ tab: '([^']+)' \}/g);
    expect(plugin.length + twin.length).toBeGreaterThan(3);
    expect(plugin.filter((t) => !constList('VALID_PLUGIN_TABS').includes(t))).toEqual([]);
    expect(twin.filter((t) => !constList('VALID_TWIN_TABS').includes(t))).toEqual([]);
  });

  it('every bridgeExec method exists on window.__TEST__, except the known-missing burst', () => {
    const methods = used(/bridgeExec\('([A-Za-z_]+)'/g);
    const missing = methods.filter((m) => !new RegExp(`^\\s+(async\\s+)?${m}\\s*\\(`, 'm').test(BRIDGE));
    // triggerTestFlow is absent from the bridge; the stop now fails loudly
    // instead of measuring nothing. Delete this entry when a burst method lands.
    expect(missing).toEqual(['triggerTestFlow']);
  });
});
