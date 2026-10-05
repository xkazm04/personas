import { describe, expect, it, vi } from 'vitest';

import type { DevServerState } from '@/lib/bindings/DevServerState';
import type { DevServerView } from '@/lib/bindings/DevServerView';

import { sectionMenuItems } from '../sectionMenuItems';

const LABELS = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  open: 'Open',
  hostGuard: 'host guard',
  edit: 'Edit',
  rescan: 'Rescan',
  remove: 'Remove',
  removeLive: 'stop first',
};

function server(state: DevServerState, devPort = 3000): DevServerView {
  return {
    projectId: 'p',
    projectName: 'p',
    rootPath: 'C:\\dev\\p',
    workspaceId: null,
    techStack: null,
    devCommand: 'npm run dev',
    devPort,
    state,
    pid: null,
    externalPid: null,
    startedAt: null,
    url: `http://localhost:${devPort}`,
    error: null,
  };
}

function items(s: DevServerView, hostPort: number | null = null) {
  const handlers = { onEdit: vi.fn(), onRescan: vi.fn(), onRemove: vi.fn() };
  const list = sectionMenuItems(s, { hostPort, labels: LABELS, ...handlers });
  return { byId: new Map(list.map((i) => [i.id, i])), list, handlers };
}

describe('sectionMenuItems', () => {
  it('carries the contract testids in order', () => {
    expect(items(server('running')).list.map((i) => i.testId)).toEqual([
      'server-menu-stop',
      'server-menu-restart',
      'server-menu-open',
      'server-menu-edit',
      'server-menu-rescan',
      'server-menu-remove',
    ]);
    expect(items(server('stopped')).list[0]?.testId).toBe('server-menu-start');
  });

  it('host guard: the server serving Personas cannot be stopped or restarted', () => {
    const { byId } = items(server('running', 1420), 1420);
    expect(byId.get('stop')?.disabled).toBe(true);
    expect(byId.get('stop')?.hint).toBe('host guard');
    expect(byId.get('restart')?.disabled).toBe(true);
    expect(byId.get('restart')?.hint).toBe('host guard');
    // It can still be opened.
    expect(byId.get('open')?.disabled).toBe(false);
  });

  it('the guard holds for an external host server too, and spares every other port', () => {
    expect(items(server('external', 1420), 1420).byId.get('stop')?.disabled).toBe(true);
    const other = items(server('running', 3000), 1420).byId;
    expect(other.get('stop')?.disabled).toBe(false);
    expect(other.get('restart')?.disabled).toBe(false);
  });

  it.each<DevServerState>(['running', 'starting', 'external'])('Remove is disabled while %s, with the reason', (state) => {
    const remove = items(server(state)).byId.get('remove');
    expect(remove?.disabled).toBe(true);
    expect(remove?.hint).toBe('stop first');
    expect(remove?.danger).toBe(true);
  });

  it.each<DevServerState>(['stopped', 'failed', 'unconfigured', 'scanning', 'stopping'])('Remove is allowed while %s', (state) => {
    const remove = items(server(state)).byId.get('remove');
    expect(remove?.disabled).toBe(false);
    expect(remove?.hint).toBeUndefined();
  });

  it('Start is offered only to a server that can start', () => {
    expect(items(server('stopped')).byId.get('start')?.disabled).toBe(false);
    expect(items(server('failed')).byId.get('start')?.disabled).toBe(false);
    expect(items(server('unconfigured')).byId.get('start')?.disabled).toBe(true);
    expect(items(server('scanning')).byId.get('start')?.disabled).toBe(true);
  });

  it('a scan in flight disables Edit and Rescan', () => {
    const { byId } = items(server('scanning'));
    expect(byId.get('edit')?.disabled).toBe(true);
    expect(byId.get('rescan')?.disabled).toBe(true);
  });

  it('routes Edit, Rescan and Remove to the handlers with the server', () => {
    const s = server('stopped');
    const { byId, handlers } = items(s);
    byId.get('edit')?.onSelect();
    byId.get('rescan')?.onSelect();
    byId.get('remove')?.onSelect();
    expect(handlers.onEdit).toHaveBeenCalledWith(s);
    expect(handlers.onRescan).toHaveBeenCalledWith(s);
    expect(handlers.onRemove).toHaveBeenCalledWith(s);
  });
});
