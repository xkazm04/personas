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

export function useApiExplorerState(credentialId: string, catalogEndpoints?: ApiEndpoint[]) {
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);

  // Selection + testing state
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const [response, setResponse] = useState<ApiProxyResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

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

  // ── Load saved definition on mount ─────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadApiDefinition(credentialId);
        if (!cancelled && saved) {
          setEndpoints((prev) => mergeEndpoints(prev, saved));
        }
      } catch {
        // intentional: non-critical — no saved API definition to restore
      }
      // Merge catalog endpoints
      if (!cancelled && catalogEndpoints?.length) {
        setEndpoints((prev) => mergeEndpoints(prev, catalogEndpoints));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [credentialId, catalogEndpoints]);

  // ── File upload handler ────────────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const text = await file.text();
      const parsed = await parseApiDefinition(text);
      setEndpoints((prev) => mergeEndpoints(prev, parsed));
      await saveApiDefinition(credentialId, text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse API definition');
    } finally {
      setIsParsing(false);
    }
  }, [credentialId]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }, [handleFileUpload]);

  // ── Paste spec handler ─────────────────────────────────────────

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
      setParseError(err instanceof Error ? err.message : 'Failed to parse API definition');
    } finally {
      setIsParsing(false);
    }
  }, [credentialId, pasteContent]);

  // ── Send request ───────────────────────────────────────────────

  const handleSend = useCallback(async (method: string, path: string, headers: Record<string, string>, body?: string) => {
    setIsSending(true);
    setSendError(null);
    setResponse(null);
    try {
      const res = await executeApiRequest(credentialId, method, path, headers, body);
      setResponse(res);
    } catch (err) {
      const raw = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err, null, 2) : String(err);
      setSendError(raw);
    } finally {
      setIsSending(false);
    }
  }, [credentialId]);

  // ── Filtered endpoints ─────────────────────────────────────────

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

  // ── Close request panel helper ─────────────────────────────────

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
    endpoints,
    loading,
    parseError,
    setParseError,
    expandedIdx,
    setExpandedIdx,
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
