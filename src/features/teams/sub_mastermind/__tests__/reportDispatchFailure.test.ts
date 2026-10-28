// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from '@/stores/toastStore';
import { reportDispatchFailure } from '../lib/reportDispatchFailure';

const errorToasts = () => useToastStore.getState().toasts.filter((x) => x.type === 'error');

describe('failed Fleet dispatch reporting', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('raises exactly one error toast, with the localized message', () => {
    reportDispatchFailure(new Error('spawn failed'), 'Could not dispatch');
    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0]!.message).toBe('Could not dispatch');
  });
});
