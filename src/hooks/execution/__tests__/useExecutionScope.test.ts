/**
 * CLOSING AN INSPECTOR MUST NOT UNTAG THE RUN STILL ON SCREEN.
 *
 * The Sentry scope is one slot per tag key. The mini-player tags the running
 * execution for the whole run; the execution detail and the monitor drawer tag
 * whatever they open on top of it. Each view used to clear the slot on unmount,
 * so closing any inspector left the still-running execution's errors with no
 * `execution_id` at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { tags } = vi.hoisted(() => ({ tags: new Map<string, string | undefined>() }));
vi.mock('@sentry/react', () => ({
  setTag: (key: string, value: string | undefined) => { tags.set(key, value); },
}));

import { useExecutionScope } from '../useExecutionScope';

beforeEach(() => {
  tags.clear();
});

describe('useExecutionScope', () => {
  it('restores the running execution when an inspector on top of it closes', () => {
    const player = renderHook(() => useExecutionScope('exec-live', 'p-live'));
    expect(tags.get('execution_id')).toBe('exec-live');

    const detail = renderHook(() => useExecutionScope('exec-old', 'p-old'));
    expect(tags.get('execution_id')).toBe('exec-old');
    expect(tags.get('persona_id')).toBe('p-old');

    detail.unmount();
    expect(tags.get('execution_id')).toBe('exec-live');
    expect(tags.get('persona_id')).toBe('p-live');

    player.unmount();
    expect(tags.get('execution_id')).toBeUndefined();
    expect(tags.get('persona_id')).toBeUndefined();
  });

  it('an older view closing first leaves the newer one tagged', () => {
    const older = renderHook(() => useExecutionScope('exec-a', 'p-a'));
    const newer = renderHook(() => useExecutionScope('exec-b', 'p-b'));

    older.unmount();
    expect(tags.get('execution_id')).toBe('exec-b');

    newer.unmount();
    expect(tags.get('execution_id')).toBeUndefined();
  });

  it('a view with nothing to tag does not touch the slot', () => {
    renderHook(() => useExecutionScope('exec-a', 'p-a'));
    const idle = renderHook(() => useExecutionScope(null, null));
    idle.unmount();
    expect(tags.get('execution_id')).toBe('exec-a');
  });
});
