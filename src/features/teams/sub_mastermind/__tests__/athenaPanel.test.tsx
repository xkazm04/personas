// Athena's composed panel (WP3): it persists per project, restores when that
// project is focused, degrades to no-panel on a spec version this build does
// not understand, and resets ONE project without touching the others.
import { describe, it, expect, beforeEach, vi } from 'vitest';
// eslint-disable-next-line no-restricted-imports
import { invoke } from '@tauri-apps/api/core';
import { render, renderHook, screen, act } from '@testing-library/react';
import { resetInvokeMocks } from '@/test/tauriMock';

import {
  hydrateLayout,
  loadAthenaPanels,
  saveAthenaPanel,
  removeAthenaPanel,
  __resetLayoutStoreForTests,
} from '../lib/layoutStore';
import { useAthenaPanels } from '../lib/useLayout';
import {
  clearCanvasFocus,
  focusCanvasProject,
  useFocusedProjectSlug,
  __resetCanvasFocusForTests,
} from '../lib/focusStore';
import { AthenaPanel } from '../lib/AthenaPanel';

const mocked = vi.mocked(invoke);
let dbValue: string | null = null;

function installIpc(): void {
  mocked.mockImplementation(async (cmd: string, args?: unknown) => {
    if (cmd === 'get_app_setting') return dbValue;
    if (cmd === 'set_app_setting') {
      dbValue = (args as { key: string; value: string }).value;
      return undefined;
    }
    return undefined;
  });
}

const spec = (title: string) => ({
  surface: 'v1',
  title,
  blocks: [{ type: 'markdown', content: 'Coverage is 41%.' }],
});

const panel = (title: string, specVersion = 1) => ({
  specVersion,
  spec: spec(title),
  composedAt: '2026-08-04T10:00:00Z',
});

describe('Athena canvas panels', () => {
  beforeEach(() => {
    resetInvokeMocks();
    dbValue = null;
    installIpc();
    __resetLayoutStoreForTests();
    __resetCanvasFocusForTests();
  });

  it('persists per project and restores across a remount', async () => {
    await hydrateLayout();
    act(() => {
      saveAthenaPanel('proj_1', panel('Tests'));
      saveAthenaPanel('proj_2', panel('Ideas'));
    });
    expect(Object.keys(loadAthenaPanels()).sort()).toEqual(['proj_1', 'proj_2']);

    // The store's write-through is debounced; let it land in the DB row.
    await new Promise((r) => { setTimeout(r, 700); });
    expect(dbValue).toBeTruthy();

    // Simulate an app restart against the same DB row.
    __resetLayoutStoreForTests();
    resetInvokeMocks();
    installIpc();
    await hydrateLayout();

    const { result } = renderHook(() => useAthenaPanels());
    expect(result.current.proj_1?.spec).toEqual(spec('Tests'));
    expect(result.current.proj_2?.spec).toEqual(spec('Ideas'));
  });

  it('shows the panel of whichever project is focused', async () => {
    await hydrateLayout();
    act(() => { saveAthenaPanel('proj_1', panel('Tests')); });

    const { result } = renderHook(() => useFocusedProjectSlug());
    expect(result.current).toBeNull();
    act(() => { focusCanvasProject('proj_1'); });
    expect(result.current).toBe('proj_1');
    act(() => { focusCanvasProject('proj_2'); });
    expect(result.current).toBe('proj_2');
    act(() => { clearCanvasFocus(); });
    expect(result.current).toBeNull();
  });

  it('degrades an unsupported specVersion to NO panel, not an error box', async () => {
    await hydrateLayout();
    act(() => { saveAthenaPanel('proj_1', panel('From the future', 99)); });
    // Refused at the door: never written, so nothing to render and nothing to
    // defend against later.
    expect(loadAthenaPanels().proj_1).toBeUndefined();

    // Same for a doc that already carries one (a downgrade): dropped on parse.
    dbValue = JSON.stringify({
      version: 2,
      positions: {},
      groups: [],
      links: [],
      notes: [],
      hidden: [],
      athenaPanels: { proj_1: panel('From the future', 99), proj_2: panel('Fine') },
    });
    __resetLayoutStoreForTests();
    resetInvokeMocks();
    installIpc();
    await hydrateLayout();
    expect(loadAthenaPanels().proj_1).toBeUndefined();
    expect(loadAthenaPanels().proj_2).toBeDefined();
  });

  it('reset removes ONE project\'s panel and leaves the others alone', async () => {
    await hydrateLayout();
    act(() => {
      saveAthenaPanel('proj_1', panel('Tests'));
      saveAthenaPanel('proj_2', panel('Ideas'));
    });
    act(() => { removeAthenaPanel('proj_1'); });
    expect(loadAthenaPanels().proj_1).toBeUndefined();
    expect(loadAthenaPanels().proj_2).toBeDefined();
    // Idempotent — resetting a project with no panel is a no-op, not a throw.
    expect(() => removeAthenaPanel('proj_1')).not.toThrow();
  });

  it('renders the composed surface, and the reset control clears just it', async () => {
    await hydrateLayout();
    act(() => {
      saveAthenaPanel('proj_1', panel('Tests'));
      saveAthenaPanel('proj_2', panel('Ideas'));
    });
    const onClose = vi.fn();
    render(
      <AthenaPanel
        target={{ kind: 'project', slug: 'proj_1' }}
        panel={loadAthenaPanels().proj_1!}
        projectName="Personas"
        onClose={onClose}
      />,
    );
    expect(screen.getByTestId('mm-athena-panel')).toBeInTheDocument();
    expect(screen.getByTestId('surface-renderer')).toBeInTheDocument();
    expect(screen.queryByTestId('mm-athena-panel-empty')).toBeNull();

    act(() => { screen.getByTestId('mm-athena-panel-reset').click(); });
    // Confirm gate first — a persisted surface is not thrown away on one click.
    expect(loadAthenaPanels().proj_1).toBeDefined();
    const confirm = screen.getByText('Reset panel');
    await act(async () => { confirm.click(); });
    expect(loadAthenaPanels().proj_1).toBeUndefined();
    expect(loadAthenaPanels().proj_2).toBeDefined();
    expect(onClose).toHaveBeenCalled();
  });

  it('an unrenderable spec becomes a resettable note, never a permanent error', async () => {
    await hydrateLayout();
    act(() => {
      saveAthenaPanel('proj_1', {
        specVersion: 1,
        // Right envelope version, unusable content (every block invalid).
        spec: { surface: 'v1', blocks: [{ type: 'not_a_block' }] },
        composedAt: '2026-08-04T10:00:00Z',
      });
    });
    render(
      <AthenaPanel
        target={{ kind: 'project', slug: 'proj_1' }}
        panel={loadAthenaPanels().proj_1!}
        projectName="Personas"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId('mm-athena-panel-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('surface-renderer')).toBeNull();
    // The way out is still on screen.
    expect(screen.getByTestId('mm-athena-panel-reset')).toBeInTheDocument();
  });
});
