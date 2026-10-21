import { useState, useCallback, useRef } from 'react';
import { createLatestWins } from '@/stores/util/latestWins';
import { useTranslation } from '@/i18n/useTranslation';
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
  const { t, tx } = useTranslation();
  const n = t.templates.n8n;
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
      setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_url_invalid });
      return;
    }

    let parsed: URL;
    try { parsed = new URL(trimmed); }
    catch { setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_url_malformed }); return; }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_url_protocol });
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
        setUrlPreview({ kind: 'error', fileName: 'url', message: tx(n.import_err_fetch_status, { status: resp.status, statusText: resp.statusText }) });
        return;
      }
      const text = await resp.text();
      if (!latestFetch.isCurrent(token)) return;
      if (!text.trim()) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_url_empty });
        return;
      }
      if (text.length > MAX_PASTE_LENGTH) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: tx(n.import_err_content_too_large, { size: formatFileSize(text.length), max: formatFileSize(MAX_PASTE_LENGTH) }) });
        return;
      }

      let json: Record<string, unknown>;
      try { json = JSON.parse(text.trim()) as Record<string, unknown>; }
      catch {
        setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_url_not_json });
        return;
      }

      const { count } = countElements(json);
      if (count === 0) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: n.import_err_no_structure_url });
        return;
      }

      const sourceName = fileNameFromUrl(trimmed);
      const platform = detectPlatformLabel(json);
      const workflowName = typeof json.name === 'string' && json.name ? json.name
        : typeof json.title === 'string' && json.title ? json.title : n.import_name_imported;

      setUrlPreview({
        kind: 'valid', fileName: sourceName, fileSize: formatFileSize(text.length),
        workflowName, nodeCount: count, platform,
      });
      validatedUrlRef.current = { content: text.trim(), sourceName };
    } catch (err) {
      if (!latestFetch.isCurrent(token)) return;
      const msg = err instanceof Error ? err.message : n.import_err_fetch_unknown;
      setUrlPreview({ kind: 'error', fileName: 'url', message: msg.includes('timeout') ? n.import_err_timeout : tx(n.import_err_fetch_failed, { message: msg }) });
    } finally {
      // A superseded fetch must not end a newer one's busy state.
      if (mountedRef.current && latestFetch.isCurrent(token)) setUrlFetching(false);
    }
  }, [urlValue, mountedRef, latestFetch, n, tx]);

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
