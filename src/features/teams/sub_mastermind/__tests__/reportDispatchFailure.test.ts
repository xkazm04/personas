import { describe, it, expect, beforeEach } from 'vitest';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { reportDispatchFailure } from '../lib/reportDispatchFailure';

const errorToasts = () => useToastStore.getState().toasts.filter((x) => x.type === 'error');

describe('failed Fleet dispatch reporting', () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));

  it('raises exactly one error toast, with the localized message', () => {
    reportDispatchFailure(new Error('spawn failed'), 'Could not dispatch');
    expect(errorToasts()).toHaveLength(1);
    expect(errorToasts()[0]!.message).toBe('Could not dispatch');
  });

  it('the old pairing (addToast + toastCatch) raised two', () => {
    useToastStore.getState().addToast('Could not dispatch', 'error');
    toastCatch('mastermind dispatch fleet')(new Error('spawn failed'));
    expect(errorToasts()).toHaveLength(2);
  });
});
