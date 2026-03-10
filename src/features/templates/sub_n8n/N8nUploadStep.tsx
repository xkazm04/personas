import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileJson, FileCode2, AlertCircle, ChevronRight,
  ClipboardPaste, Link2, Loader2,
} from 'lucide-react';
import {
  isSupportedFile,
  getAcceptedExtensions,
  countElements,
  detectPlatformLabel,
} from '@/lib/personas/workflowDetector';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_PASTE_LENGTH = 5 * 1024 * 1024; // 5MB text

type ImportMode = 'file' | 'paste' | 'url';

type FilePreview =
  | { kind: 'valid'; fileName: string; fileSize: string; workflowName: string; nodeCount: number; platform?: string }
  | { kind: 'error'; fileName: string; message: string };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return FileCode2;
  }
  return FileJson;
}

/** Derive a filename hint from a URL for parseWorkflowFile extension detection. */
function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    if (/\.(json|ya?ml)$/i.test(lastSegment)) return lastSegment;
  } catch { /* intentional: non-critical â€” JSON parse fallback */ }
  return 'imported.json';
}

/** Resolve share/gist URLs to raw content URLs. */
function resolveRawUrl(url: string): string {
  // GitHub Gist: gist.github.com/<user>/<id> â†’ raw
  const gistMatch = url.match(/^https?:\/\/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/i);
  if (gistMatch) return `https://gist.githubusercontent.com/raw/${gistMatch[1]}`;

  // GitHub blob â†’ raw
  if (/github\.com\/.*\/blob\//.test(url)) {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  return url;
}

const URL_PATTERN = /^https?:\/\/.+/i;

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop?: (file: File) => void;
  onContentPaste?: (content: string, sourceName: string) => void;
}

export function N8nUploadStep({ fileInputRef, onContentPaste }: N8nUploadStepProps) {
  const [mode, setMode] = useState<ImportMode>('file');
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const mountedRef = useRef(true);
  const validatedFileRef = useRef<File | null>(null);
  const validationGenerationRef = useRef(0);
  const activeReaderRef = useRef<FileReader | null>(null);
  const validatedContentRef = useRef<string | null>(null);
  const validatedUrlRef = useRef<{ content: string; sourceName: string } | null>(null);

  const pasteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep callback in a ref so setTimeout closures always call the latest version
  const onContentPasteRef = useRef(onContentPaste);
  useEffect(() => { onContentPasteRef.current = onContentPaste; });

  // Paste JSON state
  const [pasteText, setPasteText] = useState('');
  const [pastePreview, setPastePreview] = useState<FilePreview | null>(null);

  // URL state
  const [urlValue, setUrlValue] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlPreview, setUrlPreview] = useState<FilePreview | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeReaderRef.current?.readyState === FileReader.LOADING) {
        activeReaderRef.current.abort();
      }
      if (pasteDebounceRef.current) clearTimeout(pasteDebounceRef.current);
    };
  }, []);

  // â”€â”€ File Upload handlers (existing) â”€â”€

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
        catch { setPreview({ kind: 'error', fileName: file.name, message: 'Invalid JSON â€” could not parse file contents.' }); return; }

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

  // â”€â”€ Paste JSON handlers â”€â”€

  const validatePastedContentImmediate = useCallback((text: string) => {
    if (!text.trim()) { setPastePreview(null); return; }
    if (text.length > MAX_PASTE_LENGTH) {
      setPastePreview({ kind: 'error', fileName: 'pasted', message: `Content too large (${formatFileSize(text.length)}). Maximum 5 MB.` });
      return;
    }

    let json: Record<string, unknown>;
    try { json = JSON.parse(text.trim()) as Record<string, unknown>; }
    catch { setPastePreview({ kind: 'error', fileName: 'pasted', message: 'Invalid JSON â€” could not parse pasted content.' }); return; }

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

  // â”€â”€ URL Fetch handlers â”€â”€

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

    setUrlFetching(true);
    setUrlPreview(null);
    validatedUrlRef.current = null;

    try {
      const rawUrl = resolveRawUrl(trimmed);
      const resp = await fetch(rawUrl, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        setUrlPreview({ kind: 'error', fileName: 'url', message: `Fetch failed: ${resp.status} ${resp.statusText}` });
        return;
      }
      const text = await resp.text();
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
      const msg = err instanceof Error ? err.message : 'Unknown fetch error';
      setUrlPreview({ kind: 'error', fileName: 'url', message: msg.includes('timeout') ? 'Request timed out (15s).' : `Fetch failed: ${msg}` });
    } finally {
      if (mountedRef.current) setUrlFetching(false);
    }
  }, [urlValue, onContentPaste]);

  const handleUrlImport = useCallback(() => {
    const validated = validatedUrlRef.current;
    if (!validated) return;
    onContentPaste?.(validated.content, validated.sourceName);
  }, [onContentPaste]);

  // â”€â”€ Render â”€â”€

  const FileIcon = preview?.kind === 'valid' ? getFileIcon(preview.fileName) : FileJson;

  const modes: { id: ImportMode; label: string; icon: React.ReactNode }[] = [
    { id: 'file', label: 'Upload File', icon: <Upload className="w-3.5 h-3.5" /> },
    { id: 'paste', label: 'Paste JSON', icon: <ClipboardPaste className="w-3.5 h-3.5" /> },
    { id: 'url', label: 'From URL', icon: <Link2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div>
      {/* Mode tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-secondary/30 border border-primary/8">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all ${
              mode === m.id
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 shadow-sm'
                : 'text-muted-foreground/70 hover:text-foreground/80 hover:bg-secondary/40 border border-transparent'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {/* â”€â”€ File Upload tab â”€â”€ */}
        {mode === 'file' && (
          <motion.div
            key="file"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <motion.div
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              onDragOver={handleDragOver}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Drop workflow file or click to browse"
              data-testid="n8n-upload-dropzone"
              className={`relative flex flex-col items-center justify-center gap-4 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
                isDragging
                  ? 'border-violet-400/60 bg-violet-500/10 scale-[1.01]'
                  : 'border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30'
              } focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
            >
              <motion.div
                animate={isDragging ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`w-16 h-16 rounded-xl border flex items-center justify-center transition-colors duration-200 ${
                  isDragging ? 'bg-violet-500/25 border-violet-400/40' : 'bg-violet-500/15 border-violet-500/25'
                }`}
              >
                <Upload className={`w-8 h-8 transition-colors duration-200 ${isDragging ? 'text-violet-300' : 'text-violet-400'}`} />
              </motion.div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground/80">
                  {isDragging ? 'Drop your workflow file here' : 'Import a workflow from any platform'}
                </p>
                <p className="text-sm text-muted-foreground/90 mt-1">
                  Click to browse or drag and drop your exported workflow
                </p>
              </div>
              <PlatformLabels />
              <input
                ref={fileInputRef}
                type="file"
                accept={getAcceptedExtensions()}
                onChange={handleFileInputChange}
                className="hidden"
                data-testid="n8n-file-input"
              />
            </motion.div>
            <PreviewCard preview={preview} FileIcon={FileIcon} onClick={preview?.kind === 'valid' ? handleManualProceed : undefined} />
            {preview?.kind === 'valid' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-col items-start gap-1.5">
                <button
                  onClick={handleManualProceed}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-violet-500 text-white hover:bg-violet-400 transition-colors"
                >
                  Continue
                </button>
                <p className="text-sm text-muted-foreground/60">Press Enter or click to continue</p>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* â”€â”€ Paste JSON tab â”€â”€ */}
        {mode === 'paste' && (
          <motion.div
            key="paste"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="rounded-xl border border-primary/15 bg-secondary/20 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-primary/8 flex items-center gap-2">
                <ClipboardPaste className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-foreground/80">Paste workflow JSON</span>
                <span className="text-sm text-muted-foreground/60 ml-auto">
                  {pasteText.length > 0 && formatFileSize(pasteText.length)}
                </span>
              </div>
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  validatePastedContent(e.target.value);
                }}
                aria-label="Workflow JSON content"
                placeholder='Paste your exported workflow JSON here...\n\nExample: {"nodes": [...], "connections": {...}}'
                className="w-full h-48 px-4 py-3 bg-transparent text-sm font-mono text-foreground/80 placeholder:text-muted-foreground/40 resize-none outline-none"
                spellCheck={false}
                data-testid="paste-json-textarea"
              />
              <div className="px-4 py-2.5 border-t border-primary/8 flex items-center justify-between">
                <PlatformLabels />
                <button
                  onClick={handlePasteImport}
                  disabled={pastePreview?.kind !== 'valid'}
                  className={`flex items-center gap-2 px-4 py-1.5 rounded-xl text-sm font-medium transition-all ${
                    pastePreview?.kind === 'valid'
                      ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30'
                      : 'bg-secondary/40 text-muted-foreground/40 border border-primary/10 cursor-not-allowed'
                  }`}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  Import
                </button>
              </div>
            </div>
            <PreviewCard
              preview={pastePreview}
              FileIcon={FileJson}
              onClick={pastePreview?.kind === 'valid' ? handlePasteImport : undefined}
            />
          </motion.div>
        )}

        {/* â”€â”€ URL Import tab â”€â”€ */}
        {mode === 'url' && (
          <motion.div
            key="url"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            <div className="rounded-xl border border-primary/15 bg-secondary/20 p-4 space-y-4">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
                <span className="text-sm font-medium text-foreground/80">Import from URL</span>
              </div>
              <p className="text-sm text-muted-foreground/70">
                Paste a URL to a raw workflow JSON file. Supports GitHub raw URLs, Gist links, and direct JSON endpoints.
              </p>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={urlValue}
                  onChange={(e) => { setUrlValue(e.target.value); setUrlPreview(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !urlFetching) void handleUrlFetch(); }}
                  aria-label="Workflow URL"
                  placeholder="https://raw.githubusercontent.com/.../workflow.json"
                  className="flex-1 px-3 py-2 rounded-xl bg-background/50 border border-primary/15 text-sm text-foreground/80 placeholder:text-muted-foreground/40 outline-none focus:border-violet-500/40 transition-colors"
                  data-testid="url-input"
                />
                <button
                  onClick={() => void handleUrlFetch()}
                  disabled={urlFetching || !urlValue.trim()}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    urlFetching || !urlValue.trim()
                      ? 'bg-secondary/40 text-muted-foreground/40 border border-primary/10 cursor-not-allowed'
                      : 'bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30'
                  }`}
                >
                  {urlFetching ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Fetching</>
                  ) : (
                    <><ChevronRight className="w-3.5 h-3.5" /> Fetch</>
                  )}
                </button>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                <span>Accepts:</span>
                <span className="font-mono text-sm">github.com/*/blob/*</span>
                <span className="text-primary/20">|</span>
                <span className="font-mono text-sm">gist.github.com/*</span>
                <span className="text-primary/20">|</span>
                <span className="font-mono text-sm">raw JSON endpoint</span>
              </div>
            </div>
            <PreviewCard
              preview={urlPreview}
              FileIcon={FileJson}
              onClick={urlPreview?.kind === 'valid' ? handleUrlImport : undefined}
            />
            {urlPreview?.kind === 'valid' && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-col items-start gap-1.5">
                <button
                  onClick={handleUrlImport}
                  className="px-4 py-2.5 text-sm font-semibold rounded-xl bg-violet-500 text-white hover:bg-violet-400 transition-colors"
                >
                  Continue
                </button>
                <p className="text-sm text-muted-foreground/60">Press Enter or click to continue</p>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// â”€â”€ Sub-components â”€â”€

function PlatformLabels() {
  return (
    <div className="flex items-center gap-4 text-sm text-muted-foreground/80">
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> n8n</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> Zapier</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      <span className="flex items-center gap-1.5"><FileJson className="w-3.5 h-3.5" /> Make</span>
      <span className="text-primary/20" aria-hidden="true">|</span>
      <span className="flex items-center gap-1.5"><FileCode2 className="w-3.5 h-3.5" /> GitHub Actions</span>
    </div>
  );
}

function PreviewCard({
  preview,
  FileIcon,
  onClick,
}: {
  preview: FilePreview | null;
  FileIcon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  return (
    <AnimatePresence>
      {preview && (
        <motion.div
          key={preview.kind}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.2 }}
          data-testid="file-validation-preview"
          data-status={preview.kind}
          onClick={onClick}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && onClick) {
              e.preventDefault();
              onClick();
            }
          }}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : -1}
          className={`mt-3 flex items-center gap-3 px-4 rounded-xl border ${
            preview.kind === 'valid'
              ? 'border-primary/10 bg-zinc-900/50 py-2 cursor-pointer hover:bg-zinc-800/60 transition-colors'
              : 'border-red-400/40 bg-red-500/5 h-12'
          }`}
        >
          {preview.kind === 'valid' ? (
            <>
              <FileIcon className="w-4 h-4 text-violet-400 flex-shrink-0" />
              {preview.platform && (
                <span className="text-sm font-mono uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400/80 border border-violet-500/20 flex-shrink-0">
                  {preview.platform}
                </span>
              )}
              <span className="text-sm font-medium text-foreground/90 truncate">{preview.workflowName}</span>
              <span className="text-sm text-muted-foreground/60 flex-shrink-0">
                {preview.nodeCount > 0 && <>{preview.nodeCount} element{preview.nodeCount !== 1 ? 's' : ''} Â· </>}
                {preview.fileSize}
              </span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/60 flex-shrink-0 ml-auto" />
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="text-sm text-red-400 truncate">{preview.message}</span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Quick extraction of `name:` from YAML content without full parsing */
function extractYamlName(content: string): string | null {
  // Supports both top-level and indented/nested `name:` fields.
  const topLevelMatch = content.match(/^\s*name\s*:\s*['"]?(.+?)['"]?\s*$/m);
  if (topLevelMatch?.[1]) return topLevelMatch[1];

  // Common nested form in workflow metadata blocks.
  const metadataBlock = content.match(/^[ \t]*metadata\s*:\s*([\s\S]*?)(?:^\S|$)/m)?.[1] ?? '';
  const metadataName = metadataBlock.match(/^[ \t]+name\s*:\s*['"]?(.+?)['"]?\s*$/m);
  return metadataName?.[1] ?? null;
}
