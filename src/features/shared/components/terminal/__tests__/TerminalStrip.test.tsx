import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { TerminalStrip } from '../TerminalStrip';

const SRC = readFileSync(path.resolve(process.cwd(), 'src/features/shared/components/terminal/TerminalStrip.tsx'), 'utf8')
  // strip comments so prose cannot satisfy or trip the assertions below
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('TerminalStrip', () => {
  it('names its icon-only controls for assistive tech', () => {
    render(
      <TerminalStrip lastLine="done" lines={['a', 'done']} isRunning={false} isExpanded={false} onToggle={vi.fn()} onClear={vi.fn()} />,
    );
    // Expand + dismiss are icon-only. Their name came from a native title=
    // that doubled the <Tooltip>; with title gone, aria-label must carry it.
    const named = screen.getAllByRole('button').filter((b) => (b.getAttribute('aria-label') ?? '').trim().length > 0);
    expect(named.length).toBeGreaterThanOrEqual(2);
  });

  it('carries no hardcoded English tooltip and no native title beside a <Tooltip>', () => {
    expect(SRC).not.toMatch(/content=\{?["'`][A-Z]/);
    expect(SRC).not.toMatch(/tooltip=["'`]/);
    expect(SRC).not.toMatch(/\btitle=\{/);
    expect(SRC).not.toMatch(/'(Expand|Collapse) log'/);
  });
});
