/**
 * EVERY EDITOR TAB THE BAR RENDERS HAS A BREADCRUMB LABEL.
 *
 * The breadcrumb labels the open editor tab with `TAB_LABELS[editorTab] ??
 * editorTab` (src/hooks/navigation/useBreadcrumbTrail.ts). TAB_LABELS still
 * named retired ids (use-cases, prompt, connectors, assertions) and had no
 * entry for `activity` or `design`, two of the four tabs the bar renders, so
 * the breadcrumb printed the raw lowercase id. Ground truth is EditorTabBar's
 * `tabDefs`, read from source, not the label table.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TAB_LABELS } from '../editorTabConstants';

function renderedTabIds(): string[] {
  const src = readFileSync(resolve(process.cwd(), 'src/features/agents/sub_editor/components/EditorTabBar.tsx'), 'utf8');
  const start = src.indexOf('const tabDefs');
  const block = src.slice(start, src.indexOf('];', start));
  return [...block.matchAll(/id:\s*'([\w-]+)'/g)].map((m) => m[1]!);
}

describe('TAB_LABELS', () => {
  it('reads the rendered tab ids from the tab bar (self-check on the scanner)', () => {
    expect(renderedTabIds().length).toBeGreaterThanOrEqual(3);
  });

  it('labels every tab the editor tab bar renders', () => {
    const missing = renderedTabIds().filter((id) => !(id in TAB_LABELS));
    expect(missing).toEqual([]);
  });
});
