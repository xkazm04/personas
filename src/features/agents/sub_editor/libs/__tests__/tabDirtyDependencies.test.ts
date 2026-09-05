/**
 * THE CROSS-TAB DIRTY MAP IS PINNED TO THE IDS THAT EXIST.
 *
 * `TAB_DIRTY_DEPENDENCIES` is hand-maintained, and nothing compared it with
 * the tab bar or with the save groups that actually register. At the time
 * this test was written every entry in it was dead: the dependent tab
 * `use-cases` no longer rendered, and the sources `prompt` / `connectors`
 * were registered by nobody, so no dependency could ever light a badge.
 *
 * Ground truth is derived from the source, not from the map: rendered tab
 * ids come from EditorTabBar's `tabDefs`, registered group ids from every
 * `useTabSection({ tab: … })` / `useEditorDirty('…')` call under the agents
 * feature.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TAB_DIRTY_DEPENDENCIES } from '../editorTabConstants';

const ROOT = resolve(process.cwd(), 'src/features/agents');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function renderedTabIds(): Set<string> {
  const src = readFileSync(join(ROOT, 'sub_editor/components/EditorTabBar.tsx'), 'utf8');
  const block = src.slice(src.indexOf('const tabDefs'), src.indexOf('];', src.indexOf('const tabDefs')));
  return new Set([...block.matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1]!));
}

function registeredGroupIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of walk(ROOT)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/useTabSection\(\{[\s\S]{0,120}?tab:\s*'([\w-]+)'/g)) ids.add(m[1]!);
    for (const m of src.matchAll(/useEditorDirty\(\s*'([\w-]+)'/g)) ids.add(m[1]!);
  }
  return ids;
}

describe('TAB_DIRTY_DEPENDENCIES', () => {
  const rendered = renderedTabIds();
  const registered = registeredGroupIds();

  it('reads real ids from the tree (self-check on the scanners)', () => {
    expect(rendered.has('settings')).toBe(true);
    expect(registered.has('settings')).toBe(true);
  });

  it('only names dependent tabs the tab bar renders', () => {
    for (const tab of Object.keys(TAB_DIRTY_DEPENDENCIES)) {
      expect(rendered, `dependent tab "${tab}" is not rendered by EditorTabBar`).toContain(tab);
    }
  });

  it('only names source groups that some surface registers', () => {
    for (const [tab, sources] of Object.entries(TAB_DIRTY_DEPENDENCIES)) {
      for (const source of sources ?? []) {
        expect(registered, `source "${source}" (for tab "${tab}") is registered by nothing`).toContain(source);
      }
    }
  });
});
