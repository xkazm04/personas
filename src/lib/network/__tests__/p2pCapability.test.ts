import { describe, it, expect, vi, beforeEach } from 'vitest';

const getNetworkStatus = vi.fn();
vi.mock('@/api/network/discovery', () => ({ getNetworkStatus: () => getNetworkStatus() }));

import { InvokeTimeoutError } from '@/lib/tauriInvoke';
import {
  classifyProbeRejection,
  isP2pRuntimeError,
  p2pSupportVerdict,
  probeP2pSupport,
  resetP2pProbeForTests,
} from '../p2pCapability';

const appError = (error: string, kind = 'not_found') => ({ error, kind });

beforeEach(() => {
  resetP2pProbeForTests();
  getNetworkStatus.mockReset();
});

describe('classifyProbeRejection', () => {
  it('reads a structured AppError as proof the command exists', () => {
    // This is the exact false positive the old string sniff produced: a
    // legitimate NotFound whose message contains "not found" used to latch
    // p2pUnavailable for the whole session.
    expect(classifyProbeRejection(appError('No pairing request pending from abc'))).toBe('supported');
  });

  it('reads an unstructured rejection as a missing command', () => {
    expect(classifyProbeRejection('Command get_network_status not found')).toBe('unsupported');
    expect(classifyProbeRejection(new Error('not allowed by the scope'))).toBe('unsupported');
  });

  it('refuses to decide on a timeout', () => {
    expect(classifyProbeRejection(new InvokeTimeoutError('get_network_status', 90_000))).toBe(
      'indeterminate',
    );
  });
});

describe('isP2pRuntimeError', () => {
  it('is true for errors from a command that actually ran', () => {
    expect(isP2pRuntimeError(appError('boom', 'internal'))).toBe(true);
  });
  it('is false when the command was never dispatched', () => {
    expect(isP2pRuntimeError('Command x not found')).toBe(false);
  });
});

describe('probeP2pSupport', () => {
  it('reports support when the probe command resolves', async () => {
    getNetworkStatus.mockResolvedValue({ is_running: true });
    await expect(probeP2pSupport()).resolves.toBe(true);
    expect(p2pSupportVerdict()).toBe(true);
  });

  it('reports no support when the command is not registered', async () => {
    getNetworkStatus.mockRejectedValue('Command get_network_status not found');
    await expect(probeP2pSupport()).resolves.toBe(false);
    expect(p2pSupportVerdict()).toBe(false);
  });

  it('does NOT latch on a genuine runtime error', async () => {
    getNetworkStatus.mockRejectedValue(appError('Network service not initialized', 'internal'));
    await expect(probeP2pSupport()).resolves.toBe(true);
    expect(p2pSupportVerdict()).toBe(true);
  });

  it('does NOT cache an indeterminate timeout, so the next caller re-probes', async () => {
    getNetworkStatus.mockRejectedValueOnce(new InvokeTimeoutError('get_network_status', 10));
    await expect(probeP2pSupport()).resolves.toBe(true);
    expect(p2pSupportVerdict()).toBeNull();

    getNetworkStatus.mockRejectedValue('Command get_network_status not found');
    await expect(probeP2pSupport()).resolves.toBe(false);
  });

  it('issues exactly one IPC call for concurrent callers', async () => {
    getNetworkStatus.mockResolvedValue({ is_running: true });
    await Promise.all([probeP2pSupport(), probeP2pSupport(), probeP2pSupport()]);
    expect(getNetworkStatus).toHaveBeenCalledTimes(1);
  });

  it('does not re-probe once the verdict is settled', async () => {
    getNetworkStatus.mockResolvedValue({ is_running: true });
    await probeP2pSupport();
    await probeP2pSupport();
    expect(getNetworkStatus).toHaveBeenCalledTimes(1);
  });
});
