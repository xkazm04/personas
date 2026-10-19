import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useApiTestRunner } from '../useApiTestRunner';
import {
  executeApiRequest,
  parseApiDefinition,
  saveApiDefinition,
  loadApiDefinition,
} from '@/api/system/apiProxy';
import type { ApiEndpoint, ApiProxyResponse } from '@/api/system/apiProxy';
import { mergeEndpoints } from './apiExplorerHelpers';
import { silentCatch } from '@/lib/silentCatch';


export function useApiExplorerState(credentialId: string, catalogEndpoints?: ApiEndpoint[]) {
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>(() => catalogEndpoints ?? []);
  const [loading, setLoading] = useState(() => !(catalogEndpoints && catalogEndpoints.length > 0));
  // Rejections are kept whole and resolved at render (inlineErrorCopy): an IPC
  // rejection is an AppError object, so the old `err instanceof Error` ladders
  // dropped every parser reason for a generic English line, and the send slot
  // printed the raw `{ "error": ..., "kind": ... }` JSON.
  const [parseError, setParseError] = useState<{ raw: unknown } | null>(null);

  // Selection + testing state
  // Keyed by METHOD:path, not by row index: the index pointed into the
  // FILTERED list, so typing in the filter re-pointed the open row at
  // whichever endpoint slid into that slot.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const [response, setResponse] = useState<ApiProxyResponse | null>(null);
  const [sendError, setSendError] = useState<{ raw: unknown } | null>(null);
  const [isSending, setIsSending] = useState(false);
  /**
   * The request the response on screen came from. Kept so a 2xx can be turned
   * into a recipe without the user retyping what they just ran -- the builder
   * owns the draft path/params and they are gone by the time the response
   * lands.
   */
  const [lastRequest, setLastRequest] = useState<{ method: string; path: string } | null>(null);

  // Search / filter
  const [search, setSearch] = useState('');

  // Paste modal
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch test runner
  const testRunner = useApiTestRunner();
  const [showLogPanel, setShowLogPanel] = useState(false);

  // -- Load saved definition on mount -----------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadApiDefinition(credentialId);
        if (!cancelled && saved) {
          setEndpoints((prev) => mergeEndpoints(prev, saved));
        }
      } catch (err) { silentCatch("features/vault/shared/playground/tabs/useApiExplorerState:catch1")(err); }
      // Merge catalog endpoints
      if (!cancelled && catalogEndpoints?.length) {
        setEndpoints((prev) => mergeEndpoints(prev, catalogEndpoints));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [credentialId, catalogEndpoints]);

  // -- File upload handler ----------------------------------------

  const handleFileUpload = useCallback(async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const text = await file.text();
      const parsed = await parseApiDefinition(text);
      setEndpoints((prev) => mergeEndpoints(prev, parsed));
      await saveApiDefinition(credentialId, text);
    } catch (err) {
      setParseError({ raw: err });
    } finally {
      setIsParsing(false);
    }
  }, [credentialId]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }, [handleFileUpload]);

  // -- Paste spec handler -----------------------------------------

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteContent.trim()) return;
    setParseError(null);
    setIsParsing(true);
    try {
      const parsed = await parseApiDefinition(pasteContent);
      setEndpoints((prev) => mergeEndpoints(prev, parsed));
      await saveApiDefinition(credentialId, pasteContent);
      setShowPasteModal(false);
      setPasteContent('');
    } catch (err) {
      setParseError({ raw: err });
    } finally {
      setIsParsing(false);
    }
  }, [credentialId, pasteContent]);

  // -- Send request -----------------------------------------------

  const handleSend = useCallback(async (method: string, path: string, headers: Record<string, string>, body?: string) => {
    setIsSending(true);
    setSendError(null);
    setResponse(null);
    setLastRequest(null);
    try {
      const res = await executeApiRequest(credentialId, method, path, headers, body);
      setResponse(res);
      setLastRequest({ method, path });
    } catch (err) {
      setSendError({ raw: err });
    } finally {
      setIsSending(false);
    }
  }, [credentialId]);

  // -- Filtered endpoints -----------------------------------------

  const filtered = useMemo(() => {
    if (!search.trim()) return endpoints;
    const q = search.toLowerCase();
    return endpoints.filter((ep) =>
      ep.path.toLowerCase().includes(q) ||
      ep.method.toLowerCase().includes(q) ||
      ep.summary?.toLowerCase().includes(q) ||
      ep.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [endpoints, search]);

  // -- Close request panel helper ---------------------------------

  const closeRequestPanel = useCallback(() => {
    setSelectedEndpoint(null);
    setResponse(null);
    setSendError(null);
  }, []);

  const selectEndpointForTry = useCallback((ep: ApiEndpoint) => {
    setSelectedEndpoint(ep);
    setResponse(null);
    setSendError(null);
  }, []);

  return {
    lastRequest,
    endpoints,
    loading,
    parseError,
    setParseError,
    expandedKey,
    setExpandedKey,
    selectedEndpoint,
    response,
    sendError,
    isSending,
    search,
    setSearch,
    showPasteModal,
    setShowPasteModal,
    pasteContent,
    setPasteContent,
    isParsing,
    fileInputRef,
    testRunner,
    showLogPanel,
    setShowLogPanel,
    handleFileInputChange,
    handlePasteSubmit,
    handleSend,
    filtered,
    closeRequestPanel,
    selectEndpointForTry,
  };
}
