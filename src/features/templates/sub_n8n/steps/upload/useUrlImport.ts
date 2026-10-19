import { useState, useCallback, useRef } from 'react';
import { createLatestWins } from '@/stores/util/latestWins';
import {
  countElements,
  detectPlatformLabel,
} from '@/lib/personas/parsers/workflowDetector';
import type { FilePreview } from './n8nUploadTypes';
import {
  MAX_PASTE_LENGTH,
  formatFileSize,
  fileNameFromUrl,
  resolveRawUrl,
  URL_PATTERN,
} from './n8nUploadTypes';

export function useUrlImport(
  onContentPaste: ((content: string, sourceName: string) => void) | undefined,
  mountedRef: React.RefObject<boolean>,
) {
  const [urlValue, setUrlValueState] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlPreview, setUrlPreview] = useState<FilePreview | null>(null);
  const validatedUrlRef = useRef<{ content: string; sourceName: string } | null>(null);
  // One token per fetch; editing the URL mints a new one too, so a response
  // for the address the user already replaced is dropped instead of painting
  // its workflow under the new URL (and being imported by Continue).
  const [latestFetch] = useState(createLatestWins);

  const setUrlValue = useCallback((value: string) => {
    latestFetch.next();
    validatedUrlRef.current = null;
    setUrlFetching(false); // the in-flight fetch, if any, is abandoned
    setUrlValueState(value);
  }, [latestFetch]);

  const handleUrlFetch = useCallback(async () => {
    const trimmed = urlValue.trim();
    if (!trimmed || !URL_PATTERN.test(trimmed)) {
      setUrlPreview({ kind: 'error', fileName: 'url', message: 'Enter a valid HTTP/HTTPS URL.' });
      return;
    }

    let parsed: URL;
    try { parsed = new URL(trimmed); }
    catch { setUrlPreview({ kind: 'error', fileName: 'url', message: 'URL appears invalid.' }); return; }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setUrlPreview({ kind: 'error', fileName: 'url', message: 'Only HTTP/HTTPS URLs are supported.' });
      return;
    }

    const token = latestFetch.next();
    setUrlFetching(true);
    setUrlPreview(null);
    validatedUrlRef.current = null;

    try {
      const rawUrl = resolveRawUrl(trimmed);
      const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
      if (!latestFetch.isCurrent(token)) return;
      if (!resp.ok) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: `Fetch failed: ${resp.status} ${resp.statusText}` });
        return;
      }
      const text = await resp.text();
      if (!latestFetch.isCurrent(token)) return;
      if (!text.trim()) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: 'URL returned empty content.' });
        return;
      }
      if (text.length > MAX_PASTE_LENGTH) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: `Content too large (${formatFileSize(text.length)}). Maximum 5 MB.` });
        return;
      }

      let json: Record<string, unknown>;
      try { json = JSON.parse(text.trim()) as Record<string, unknown>; }
      catch {
        setUrlPreview({ kind: 'error', fileName: 'url', message: 'URL content is not valid JSON.' });
        return;
      }

      const { count } = countElements(json);
      if (count === 0) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: 'No recognized workflow structure in fetched content.' });
        return;
      }

      const sourceName = fileNameFromUrl(trimmed);
      const platform = detectPlatformLabel(json);
      const workflowName = typeof json.name === 'string' && json.name ? json.name
        : typeof json.title === 'string' && json.title ? json.title : 'Imported Workflow';

      setUrlPreview({
        kind: 'valid', fileName: sourceName, fileSize: formatFileSize(text.length),
        workflowName, nodeCount: count, platform,
      });
      validatedUrlRef.current = { content: text.trim(), sourceName };
    } catch (err) {
      if (!latestFetch.isCurrent(token)) return;
      const msg = err instanceof Error ? err.message : 'Unknown fetch error';
      setUrlPreview({ kind: 'error', fileName: 'url', message: msg.includes('timeout') ? 'Request timed out (15s).' : `Fetch failed: ${msg}` });
    } finally {
      // A superseded fetch must not end a newer one's busy state.
      if (mountedRef.current && latestFetch.isCurrent(token)) setUrlFetching(false);
    }
  }, [urlValue, mountedRef, latestFetch]);

  const handleUrlImport = useCallback(() => {
    const validated = validatedUrlRef.current;
    if (!validated) return;
    onContentPaste?.(validated.content, validated.sourceName);
  }, [onContentPaste]);

  return {
    urlValue,
    setUrlValue,
    urlFetching,
    urlPreview,
    setUrlPreview,
    handleUrlFetch,
    handleUrlImport,
  };
}
