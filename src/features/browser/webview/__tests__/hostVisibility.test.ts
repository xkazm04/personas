import { afterEach, describe, expect, it } from 'vitest';
import { _resetHostSuspend, hostSuspendCount, resumeHost, shouldShowHost, suspendHost } from '../hostVisibility';

describe('shouldShowHost', () => {
  afterEach(() => _resetHostSuspend());

  it('shows the host only on Teams > Webview with nothing suspended', () => {
    expect(shouldShowHost({ sidebarSection: 'teams', teamsTab: 'webview', suspended: 0 })).toBe(true);
    expect(shouldShowHost({ sidebarSection: 'teams', teamsTab: 'whitelist', suspended: 0 })).toBe(false);
    expect(shouldShowHost({ sidebarSection: 'home', teamsTab: 'webview', suspended: 0 })).toBe(false);
    expect(shouldShowHost({ sidebarSection: 'agents', teamsTab: 'webview', suspended: 0 })).toBe(false);
  });

  it('a suspended host is hidden even on the route', () => {
    expect(shouldShowHost({ sidebarSection: 'teams', teamsTab: 'webview', suspended: 1 })).toBe(false);
  });

  it('suspend and resume are a refcount that never goes negative', () => {
    suspendHost();
    suspendHost();
    resumeHost();
    expect(hostSuspendCount()).toBe(1);
    expect(shouldShowHost({ sidebarSection: 'teams', teamsTab: 'webview', suspended: hostSuspendCount() })).toBe(false);
    resumeHost();
    resumeHost(); // an extra release is harmless
    expect(hostSuspendCount()).toBe(0);
    expect(shouldShowHost({ sidebarSection: 'teams', teamsTab: 'webview', suspended: hostSuspendCount() })).toBe(true);
  });
});
