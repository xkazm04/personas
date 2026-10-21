import { useState, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/log';
import { createLatestWins } from '@/stores/util/latestWins';

const logger = createLogger('n8n-import');
import {
  isSupportedFile,
  countElements,
  detectPlatformLabel,
  detectWorkflowPlatform,
} from '@/lib/personas/parsers/workflowDetector';
import { loadWorkflowYaml } from '@/lib/personas/parsers/workflowParser';
import { useTranslation } from '@/i18n/useTranslation';
import type { FilePreview } from './n8nUploadTypes';
import { MAX_FILE_SIZE, formatFileSize, extractYamlName } from './n8nUploadTypes';

export function useFileUpload(onContentPaste?: (content: string, sourceName: string) => void) {
  const { t, tx } = useTranslation();
  // The one message this hook gained; the registry already carries it in all
  // 14 locales, so the YAML branch is not a new hardcoded English string.
  const invalidYamlMessage = t.error_registry.workflow_invalid_yaml_message;
  const n = t.templates.n8n;
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const mountedRef = useRef(true);
  const validatedFileRef = useRef<File | null>(null);
  const [latestValidation] = useState(createLatestWins);
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
      logger.warn('forwardContent: no validated content/file');
      return;
    }
    const cb = onContentPasteRef.current;
    if (!cb) {
      logger.warn('forwardContent: onContentPaste callback is undefined');
      return;
    }
    logger.debug('Forwarding content', { fileName: file.name, bytes: content.length });
    cb(content, file.name);
  }, []);

  const validateAndPreview = useCallback(
    (file: File) => {
      const generation = latestValidation.next();
      if (activeReaderRef.current?.readyState === FileReader.LOADING) {
        activeReaderRef.current.abort();
      }
      activeReaderRef.current = null;
      validatedFileRef.current = null;
      validatedContentRef.current = null;

      if (!isSupportedFile(file.name)) {
        setPreview({ kind: 'error', fileName: file.name, message: n.import_err_unsupported_type });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setPreview({ kind: 'error', fileName: file.name, message: tx(n.import_err_file_too_large, { size: formatFileSize(file.size), max: formatFileSize(MAX_FILE_SIZE) }) });
        return;
      }

      logger.debug('Reading file', { fileName: file.name, size: formatFileSize(file.size) });

      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      const reader = new FileReader();
      activeReaderRef.current = reader;
      reader.onload = (e) => {
        if (!mountedRef.current || !latestValidation.isCurrent(generation)) return;
        const content = e.target?.result as string;
        if (!content || content.length === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: n.import_err_file_empty });
          return;
        }

        logger.debug('File read OK', { bytes: content.length });

        if (ext === '.yml' || ext === '.yaml') {
          // Parse ONCE, then route through the same detection + count pair the
          // JSON branch below uses. This used to be a substring scan for
          // `jobs:` with a hardcoded `nodeCount: 0`, so the card promised a
          // workflow with no steps (and the literal text `jobs:` inside a
          // comment was enough to pass it).
          let yamlDoc: Record<string, unknown>;
          try {
            yamlDoc = loadWorkflowYaml(content);
          } catch (err) {
            logger.warn('YAML preview parse failed', { fileName: file.name, error: String(err) });
            setPreview({ kind: 'error', fileName: file.name, message: invalidYamlMessage });
            return;
          }

          const detection = detectWorkflowPlatform(yamlDoc, ext);
          if (detection.platform === 'unknown') {
            setPreview({ kind: 'error', fileName: file.name, message: n.import_err_no_jobs });
            return;
          }

          const { count } = countElements(yamlDoc);
          const parsedName = typeof yamlDoc.name === 'string' ? yamlDoc.name.trim() : '';
          const workflowName = parsedName || extractYamlName(content) || n.import_name_github;
          validatedFileRef.current = file;
          validatedContentRef.current = content;

          logger.debug('Validation OK', { platform: detection.label, workflowName, elementCount: count });

          setPreview({
            kind: 'valid', fileName: file.name, fileSize: formatFileSize(file.size),
            workflowName, nodeCount: count, platform: detection.label,
          });
          return;
        }

        let json: Record<string, unknown>;
        try { json = JSON.parse(content) as Record<string, unknown>; }
        catch { setPreview({ kind: 'error', fileName: file.name, message: n.import_err_invalid_json_file }); return; }

        const { count } = countElements(json);
        if (count === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: n.import_err_no_structure_file });
          return;
        }

        const platform = detectPlatformLabel(json);
        const workflowName = typeof json.name === 'string' && json.name ? json.name
          : typeof json.title === 'string' && json.title ? json.title : n.import_name_untitled;

        logger.debug('Validation OK', { platform, workflowName, elementCount: count });

        validatedFileRef.current = file;
        validatedContentRef.current = content;
        setPreview({ kind: 'valid', fileName: file.name, fileSize: formatFileSize(file.size), workflowName, nodeCount: count, platform });
      };
      reader.onerror = () => {
        if (!mountedRef.current || !latestValidation.isCurrent(generation)) return;
        logger.warn('FileReader error', { fileName: file.name });
        setPreview({ kind: 'error', fileName: file.name, message: n.import_err_read_failed });
      };
      reader.readAsText(file);
    },
    [invalidYamlMessage, latestValidation, n, tx],
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
    logger.debug('File input change', { fileName: file?.name ?? 'no file' });
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
