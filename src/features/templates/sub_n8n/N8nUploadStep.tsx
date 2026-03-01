import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileJson, FileCode2, AlertCircle } from 'lucide-react';
import { isSupportedFile, getAcceptedExtensions } from '@/lib/personas/workflowDetector';
import { WorkflowThumbnail } from './WorkflowThumbnail';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type FilePreview =
  | { kind: 'valid'; fileName: string; fileSize: string; workflowName: string; nodeCount: number; platform?: string; rawJson?: string }
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

/** Count workflow elements for the preview card. */
function countElements(json: Record<string, unknown>): { count: number; label: string } {
  // n8n
  if (Array.isArray(json.nodes)) {
    return { count: json.nodes.length, label: 'node' };
  }
  // Zapier
  if (Array.isArray(json.steps)) {
    return { count: json.steps.length, label: 'step' };
  }
  if (json.trigger && Array.isArray(json.actions)) {
    return { count: (json.actions as unknown[]).length + 1, label: 'step' };
  }
  // Make
  if (json.blueprint && typeof json.blueprint === 'object') {
    const bp = json.blueprint as Record<string, unknown>;
    if (Array.isArray(bp.flow)) return { count: bp.flow.length, label: 'module' };
  }
  if (Array.isArray(json.flow)) {
    return { count: json.flow.length, label: 'module' };
  }
  if (Array.isArray(json.modules)) {
    return { count: json.modules.length, label: 'module' };
  }
  // GitHub Actions
  if (json.jobs && typeof json.jobs === 'object') {
    return { count: Object.keys(json.jobs).length, label: 'job' };
  }
  return { count: 0, label: 'element' };
}

function detectPlatformLabel(json: Record<string, unknown>): string {
  if (Array.isArray(json.nodes)) return 'n8n';
  if (Array.isArray(json.steps) || (json.trigger && Array.isArray(json.actions))) return 'Zapier';
  if (json.blueprint || Array.isArray(json.flow) || Array.isArray(json.modules)) return 'Make';
  if (json.jobs && typeof json.jobs === 'object') return 'GitHub Actions';
  return 'Workflow';
}

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop?: (file: File) => void;
}

export function N8nUploadStep({ fileInputRef, onFileDrop }: N8nUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const proceedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (proceedTimerRef.current) clearTimeout(proceedTimerRef.current);
    };
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
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

  const validateAndPreview = useCallback(
    (file: File, proceed: () => void) => {
      // Clear any pending proceed timer
      if (proceedTimerRef.current) clearTimeout(proceedTimerRef.current);

      // Synchronous pre-checks
      if (!isSupportedFile(file.name)) {
        setPreview({ kind: 'error', fileName: file.name, message: 'Unsupported file type. Accepts .json (n8n, Zapier, Make) or .yml/.yaml (GitHub Actions).' });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setPreview({ kind: 'error', fileName: file.name, message: `File is too large (${formatFileSize(file.size)}). Maximum size is 5 MB.` });
        return;
      }

      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();

      // Read file content for deeper validation
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (!content || content.length === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: 'File is empty.' });
          return;
        }

        // For YAML files, do a basic structure check
        if (ext === '.yml' || ext === '.yaml') {
          // Basic YAML validity check — full parsing happens in processFile
          if (!content.includes('jobs:') && !content.includes('jobs :')) {
            setPreview({ kind: 'error', fileName: file.name, message: 'No "jobs" key found. This does not appear to be a GitHub Actions workflow.' });
            return;
          }

          const workflowName = extractYamlName(content);
          setPreview({
            kind: 'valid',
            fileName: file.name,
            fileSize: formatFileSize(file.size),
            workflowName: workflowName || 'GitHub Actions Workflow',
            nodeCount: 0, // We'll count properly after full parse
            platform: 'GitHub Actions',
          });

          proceedTimerRef.current = setTimeout(() => {
            if (mountedRef.current) proceed();
          }, 600);
          return;
        }

        // JSON files
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(content) as Record<string, unknown>;
        } catch {
          setPreview({ kind: 'error', fileName: file.name, message: 'Invalid JSON — could not parse file contents.' });
          return;
        }

        const { count } = countElements(json);
        if (count === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: 'No recognized workflow structure found. Supports n8n, Zapier, Make, and GitHub Actions exports.' });
          return;
        }

        const platform = detectPlatformLabel(json);
        const workflowName = typeof json.name === 'string' && json.name
          ? json.name
          : typeof json.title === 'string' && json.title
            ? json.title
            : 'Untitled Workflow';

        setPreview({
          kind: 'valid',
          fileName: file.name,
          fileSize: formatFileSize(file.size),
          workflowName,
          nodeCount: count,
          platform,
          rawJson: content,
        });

        // Auto-proceed after a brief recognition moment
        proceedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) proceed();
        }, 600);
      };
      reader.onerror = () => {
        setPreview({ kind: 'error', fileName: file.name, message: 'Failed to read the file.' });
      };
      reader.readAsText(file);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        validateAndPreview(file, () => onFileDrop?.(file));
      }
    },
    [onFileDrop, validateAndPreview],
  );

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        // Route through onFileDrop to avoid stale React event after timer
        validateAndPreview(file, () => onFileDrop?.(file));
      }
    },
    [onFileDrop, validateAndPreview],
  );

  const FileIcon = preview?.kind === 'valid' ? getFileIcon(preview.fileName) : FileJson;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-testid="n8n-upload-dropzone"
        className={`relative flex flex-col items-center justify-center gap-4 p-12 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-violet-400/60 bg-violet-500/10 scale-[1.01]'
            : 'border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30'
        }`}
      >
        <motion.div
          animate={isDragging ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className={`w-16 h-16 rounded-2xl border flex items-center justify-center transition-colors duration-200 ${
            isDragging
              ? 'bg-violet-500/25 border-violet-400/40'
              : 'bg-violet-500/15 border-violet-500/25'
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
        <div className="flex items-center gap-4 text-sm text-muted-foreground/80">
          <span className="flex items-center gap-1.5">
            <FileJson className="w-3.5 h-3.5" />
            n8n
          </span>
          <span className="text-primary/20">|</span>
          <span className="flex items-center gap-1.5">
            <FileJson className="w-3.5 h-3.5" />
            Zapier
          </span>
          <span className="text-primary/20">|</span>
          <span className="flex items-center gap-1.5">
            <FileJson className="w-3.5 h-3.5" />
            Make
          </span>
          <span className="text-primary/20">|</span>
          <span className="flex items-center gap-1.5">
            <FileCode2 className="w-3.5 h-3.5" />
            GitHub Actions
          </span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={getAcceptedExtensions()}
          onChange={handleFileInputChange}
          className="hidden"
          data-testid="n8n-file-input"
        />
      </motion.div>

      {/* Validation preview card */}
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
            className={`mt-3 flex items-center gap-3 px-4 rounded-lg border ${
              preview.kind === 'valid'
                ? 'border-primary/10 bg-zinc-900/50 py-2'
                : 'border-red-400/40 bg-red-500/5 h-12'
            }`}
          >
            {preview.kind === 'valid' ? (
              <>
                {preview.rawJson ? (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', damping: 14, stiffness: 260, delay: 0.05 }}
                    className="flex-shrink-0"
                    data-testid="file-preview-thumbnail"
                  >
                    <WorkflowThumbnail rawWorkflowJson={preview.rawJson} />
                  </motion.div>
                ) : (
                  <FileIcon className="w-4 h-4 text-violet-400 flex-shrink-0" data-testid="file-preview-icon" />
                )}
                {preview.platform && (
                  <span className="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400/80 border border-violet-500/20 flex-shrink-0">
                    {preview.platform}
                  </span>
                )}
                <span className="text-sm font-medium text-foreground/90 truncate" data-testid="file-preview-name">
                  {preview.workflowName}
                </span>
                <span className="text-sm text-muted-foreground/60 flex-shrink-0" data-testid="file-preview-stats">
                  {preview.nodeCount > 0 && <>{preview.nodeCount} element{preview.nodeCount !== 1 ? 's' : ''} · </>}
                  {preview.fileSize}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" data-testid="file-error-icon" />
                <span className="text-sm text-red-400 truncate" data-testid="file-error-message">
                  {preview.message}
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Quick extraction of `name:` from YAML content without full parsing */
function extractYamlName(content: string): string | null {
  const match = content.match(/^name:\s*['"]?(.+?)['"]?\s*$/m);
  return match?.[1] ?? null;
}
