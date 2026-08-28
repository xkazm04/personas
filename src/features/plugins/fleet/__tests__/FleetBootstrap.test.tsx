/**
 * FleetBootstrap — the fleet's app-wide startup effect.
 *
 * Two things are pinned here, and the second is the whole point of the file.
 *
 * 1. BEHAVIOUR — it attaches the session listeners and pulls one snapshot,
 *    exactly once, and renders nothing.
 *
 * 2. THE GATE — that `App.tsx` mounts it *unconditionally*. This regressed
 *    once already: the bootstrap lived inside `FleetGridLayer`, whose mount is
 *    `{import.meta.env.DEV && …}`, so Rollup folded the branch to `false` and
 *    eliminated the bootstrap from every production build. Vitest runs with
 *    `import.meta.env.DEV === true`, so no runtime assertion can catch that —
 *    the condition is resolved at build time and the test would pass in exactly
 *    the configuration that ships broken. Reading the source is therefore not
 *    laziness, it is the only place the defect is observable. (Same technique as
 *    `src/__tests__/structural/*`.)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const fleetRefresh = vi.fn(() => Promise.resolve());
const fleetStartSessionListeners = vi.fn();

const state = { fleetRefresh, fleetStartSessionListeners };

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

import FleetBootstrap from '../FleetBootstrap';

describe('FleetBootstrap — behaviour', () => {
  beforeEach(() => {
    fleetRefresh.mockClear();
    fleetStartSessionListeners.mockClear();
  });

  it('attaches the session listeners and pulls a snapshot on mount', () => {
    render(<FleetBootstrap />);
    expect(fleetStartSessionListeners).toHaveBeenCalledTimes(1);
    expect(fleetRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders nothing — it is an effect host, not a surface', () => {
    const { container } = render(<FleetBootstrap />);
    expect(container).toBeEmptyDOMElement();
  });

  it('boots once per mount, not once per render', () => {
    const { rerender } = render(<FleetBootstrap />);
    rerender(<FleetBootstrap />);
    rerender(<FleetBootstrap />);
    expect(fleetStartSessionListeners).toHaveBeenCalledTimes(1);
    expect(fleetRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('FleetBootstrap — the mount in App.tsx is not DEV-gated', () => {
  const appSource = readFileSync(
    resolve(__dirname, '../../../../App.tsx'),
    'utf8',
  );

  /** Every JSX mount of `Name`, with the source line it sits on. */
  const mountLines = (name: string): string[] =>
    appSource
      .split('\n')
      .filter((line) => new RegExp(`<${name}\\s*/>`).test(line));

  it('mounts FleetBootstrap exactly once', () => {
    expect(mountLines('FleetBootstrap')).toHaveLength(1);
  });

  it('does not put FleetBootstrap behind import.meta.env.DEV', () => {
    const [line] = mountLines('FleetBootstrap');
    // A prod build replaces `import.meta.env.DEV` with `false` and Rollup drops
    // the whole branch — including the effect. Nothing else on this line either.
    expect(line).not.toContain('import.meta.env.DEV');
    // Since the per-overlay error boundaries (OverlayIsland) the mount is
    // wrapped, but the wrapper is the ONLY thing on the line — no gate.
    expect(line.trim()).toBe('<OverlayIsland name="fleet-bootstrap"><FleetBootstrap /></OverlayIsland>');
  });

  it('keeps the FleetGridLayer overlay DEV-gated', () => {
    // The other half of the split: un-gating the overlay would ship xterm and a
    // dev surface. If this ever fails, the two concerns were re-fused.
    const [line] = mountLines('FleetGridLayer');
    expect(line).toContain('import.meta.env.DEV');
  });
});

describe('FleetGridLayer no longer owns the bootstrap', () => {
  it('does not call the fleet startup actions', () => {
    const source = readFileSync(resolve(__dirname, '../FleetGridLayer.tsx'), 'utf8');
    // Comments may (and do) name them; code must not call them.
    const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code).not.toContain('fleetStartSessionListeners');
    expect(code).not.toContain('fleetRefresh');
  });
});
