import { useState, useCallback, useRef, useEffect } from 'react';
import {
  countElements,
  detectPlatformLabel,
} from '@/lib/personas/parsers/workflowDetector';
import type { FilePreview } from './n8nUploadTypes';
import { MAX_PASTE_LENGTH, formatFileSize } from './n8nUploadTypes';

export function usePasteImport(onContentPaste?: (content: string, sourceName: string) => void) {
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<FilePreview | null>(null);
  const pasteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pasteDebounceRef.current) clearTimeout(pasteDebounceRef.current);
    };
  }, []);

  const validatePastedContentImmediate = useCallback((text: string) => {
    if (!text.trim()) { setPastePreview(null); return; }
    if (text.length > MAX_PASTE_LENGTH) {
      setPastePreview({ kind: 'error', fileName: 'pasted', message: `Content too large (${formatFileSize(text.length)}). Maximum 5 MB.` });
      return;
    }

    let json: Record<string, unknown>;
    try { json = JSON.parse(text.trim()) as Record<string, unknown>; }
    catch { setPastePreview({ kind: 'error', fileName: 'pasted', message: 'Invalid JSON \u2014 could not parse pasted content.' }); return; }

    const { count } = countElements(json);
    if (count === 0) {
      setPastePreview({ kind: 'error', fileName: 'pasted', message: 'No recognized workflow structure. Supports n8n, Zapier, Make, and GitHub Actions JSON.' });
      return;
    }

    const platform = detectPlatformLabel(json);
    const workflowName = typeof json.name === 'string' && json.name ? json.name
      : typeof json.title === 'string' && json.title ? json.title : 'Pasted Workflow';

    setPastePreview({
      kind: 'valid', fileName: 'pasted.json', fileSize: formatFileSize(text.length),
      workflowName, nodeCount: count, platform,
    });
  }, []);

  // Debounce paste validation so JSON.parse doesn't fire on every keystroke
  // for large content.  For small pastes (<50KB) validate immediately.
  const validatePastedContent = useCallback((text: string) => {
    if (pasteDebounceRef.current) clearTimeout(pasteDebounceRef.current);
    // Immediate for empty/small or over-limit (cheap checks)
    if (!text.trim() || text.length > MAX_PASTE_LENGTH || text.length < 50_000) {
      validatePastedContentImmediate(text);
      return;
    }
    pasteDebounceRef.current = setTimeout(() => validatePastedContentImmediate(text), 300);
  }, [validatePastedContentImmediate]);

  const handlePasteImport = useCallback(() => {
    if (pastePreview?.kind !== 'valid' || !pasteText.trim()) return;
    onContentPaste?.(pasteText.trim(), 'pasted.json');
  }, [pasteText, pastePreview, onContentPaste]);

  return {
    pasteText,
    setPasteText,
    pastePreview,
    validatePastedContent,
    handlePasteImport,
  };
}
