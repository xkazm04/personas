/**
 * A URL fetch that resolves after the user has already changed the URL must
 * not paint a preview for the old address. The input is never disabled while
 * a fetch is in flight, and editing it clears the preview - then the slow
 * response landed anyway, showing workflow A's card under URL B, and Continue
 * imported A.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlImport } from '../useUrlImport';

const workflow = JSON.stringify({
  name: 'Workflow A',
  nodes: [
    { id: '1', name: 'Start', type: 'n8n-nodes-base.manualTrigger', parameters: {} },
    { id: '2', name: 'Call', type: 'n8n-nodes-base.httpRequest', parameters: {} },
  ],
  connections: {},
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useUrlImport', () => {
  it('drops a fetch that resolves after the URL was edited', async () => {
    let resolveFetch!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; })));
    const onContentPaste = vi.fn();
    const mounted = { current: true };
    const { result } = renderHook(() => useUrlImport(onContentPaste, mounted));

    act(() => result.current.setUrlValue('https://raw.githubusercontent.com/a/b/main/a.json'));
    let pending!: Promise<void>;
    act(() => { pending = result.current.handleUrlFetch(); });

    // The user edits the URL while A is still downloading.
    act(() => result.current.setUrlValue('https://raw.githubusercontent.com/a/b/main/b.json'));
    await act(async () => {
      resolveFetch(new Response(workflow, { status: 200 }));
      await pending;
    });

    expect(result.current.urlPreview).toBeNull();
    act(() => result.current.handleUrlImport());
    expect(onContentPaste).not.toHaveBeenCalled();
    expect(result.current.urlFetching).toBe(false);
  });

  it('still previews and imports an undisturbed fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(workflow, { status: 200 }))));
    const onContentPaste = vi.fn();
    const mounted = { current: true };
    const { result } = renderHook(() => useUrlImport(onContentPaste, mounted));

    act(() => result.current.setUrlValue('https://raw.githubusercontent.com/a/b/main/a.json'));
    await act(async () => { await result.current.handleUrlFetch(); });

    expect(result.current.urlPreview?.kind).toBe('valid');
    act(() => result.current.handleUrlImport());
    expect(onContentPaste).toHaveBeenCalledWith(workflow, 'a.json');
  });
});
