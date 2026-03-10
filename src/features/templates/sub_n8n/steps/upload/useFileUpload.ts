import { useState, useCallback, useRef, useEffect } from 'react';
import {
  isSupportedFile,
  countElements,
  detectPlatformLabel,
} from '@/lib/personas/parsers/workflowDetector';
import type { FilePreview } from './n8nUploadTypes';
import { MAX_FILE_SIZE, formatFileSize, extractYamlName } from './n8nUploadTypes';

export function useFileUpload(onContentPaste?: (content: string, sourceName: string) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const mountedRef = useRef(true);
  const validatedFileRef = useRef<File | null>(null);
  const validationGenerationRef = useRef(0);
  const activeReaderRef = useRef<FileReader | null>(null);
  const validatedContentRef = useRef<string | null>(null);

  // Keep callback in a ref so setTimeout closures always call the latest version
  const onContentPasteRef = useRef(onContentPaste);
  useEffect(() => { onContentPasteRef.current = onContentPaste; });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeReaderRef.current?.readyState === FileReader.LOADING) {
        activeReaderRef.current.abort();
      }
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  /** Forward validated content to the parent via the ref-stored callback. */
  const forwardContent = useCallback(() => {
    const content = validatedContentRef.current;
    const file = validatedFileRef.current;
    if (!content || !file) {
      console.warn('[n8n-import] forwardContent: no validated content/file');
      return;
    }
    const cb = onContentPasteRef.current;
    if (!cb) {
      console.warn('[n8n-import] forwardContent: onContentPaste callback is undefined');
      return;
    }
    console.log('[n8n-import] forwarding content for:', file.name, `(${content.length} bytes)`);
    cb(content, file.name);
  }, []);

  const validateAndPreview = useCallback(
    (file: File) => {
      const generation = ++validationGenerationRef.current;
      if (activeReaderRef.current?.readyState === FileReader.LOADING) {
        activeReaderRef.current.abort();
      }
      activeReaderRef.current = null;
      validatedFileRef.current = null;
      validatedContentRef.current = null;

      if (!isSupportedFile(file.name)) {
        setPreview({ kind: 'error', fileName: file.name, message: 'Unsupported file type. Accepts .json (n8n, Zapier, Make) or .yml/.yaml (GitHub Actions).' });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setPreview({ kind: 'error', fileName: file.name, message: `File is too large (${formatFileSize(file.size)}). Maximum size is 5 MB.` });
        return;
      }

      console.log('[n8n-import] reading file:', file.name, formatFileSize(file.size));

      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const reader = new FileReader();
      activeReaderRef.current = reader;
      reader.onload = (e) => {
        if (!mountedRef.current || generation !== validationGenerationRef.current) return;
        const content = e.target?.result as string;
        if (!content || content.length === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: 'File is empty.' });
          return;
        }

        console.log('[n8n-import] file read OK:', content.length, 'bytes');

        if (ext === '.yml' || ext === '.yaml') {
          if (!content.includes('jobs:') && !content.includes('jobs :')) {
            setPreview({ kind: 'error', fileName: file.name, message: 'No "jobs" key found. This does not appear to be a GitHub Actions workflow.' });
            return;
          }
          const workflowName = extractYamlName(content);
          validatedFileRef.current = file;
          validatedContentRef.current = content;
          setPreview({
            kind: 'valid', fileName: file.name, fileSize: formatFileSize(file.size),
            workflowName: workflowName || 'GitHub Actions Workflow', nodeCount: 0, platform: 'GitHub Actions',
          });
          return;
        }

        let json: Record<string, unknown>;
        try { json = JSON.parse(content) as Record<string, unknown>; }
        catch { setPreview({ kind: 'error', fileName: file.name, message: 'Invalid JSON \u2014 could not parse file contents.' }); return; }

        const { count } = countElements(json);
        if (count === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: 'No recognized workflow structure found. Supports n8n, Zapier, Make, and GitHub Actions exports.' });
          return;
        }

        const platform = detectPlatformLabel(json);
        const workflowName = typeof json.name === 'string' && json.name ? json.name
          : typeof json.title === 'string' && json.title ? json.title : 'Untitled Workflow';

        console.log('[n8n-import] validation OK:', platform, workflowName, count, 'elements');

        validatedFileRef.current = file;
        validatedContentRef.current = content;
        setPreview({ kind: 'valid', fileName: file.name, fileSize: formatFileSize(file.size), workflowName, nodeCount: count, platform });
      };
      reader.onerror = () => {
        if (!mountedRef.current || generation !== validationGenerationRef.current) return;
        console.warn('[n8n-import] FileReader error for:', file.name);
        setPreview({ kind: 'error', fileName: file.name, message: 'Failed to read the file.' });
      };
      reader.readAsText(file);
    },
    [forwardContent],
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndPreview(file);
  }, [validateAndPreview]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('[n8n-import] file input change:', file?.name ?? 'no file');
    if (file) validateAndPreview(file);
  }, [validateAndPreview]);

  const handleManualProceed = useCallback(() => {
    if (validatedContentRef.current && validatedFileRef.current && preview?.kind === 'valid') {
      forwardContent();
    }
  }, [preview, forwardContent]);

  return {
    isDragging,
    preview,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handleFileInputChange,
    handleManualProceed,
    mountedRef,
  };
}
