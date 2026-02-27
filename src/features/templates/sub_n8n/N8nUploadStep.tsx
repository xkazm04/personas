import { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, FileJson, AlertCircle } from 'lucide-react';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type FilePreview =
  | { kind: 'valid'; fileName: string; fileSize: string; workflowName: string; nodeCount: number }
  | { kind: 'error'; fileName: string; message: string };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop?: (file: File) => void;
}

export function N8nUploadStep({ fileInputRef, onFileDrop }: N8nUploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const proceedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
      if (!file.name.endsWith('.json')) {
        setPreview({ kind: 'error', fileName: file.name, message: 'Not a JSON file. Please upload a .json file exported from n8n.' });
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setPreview({ kind: 'error', fileName: file.name, message: `File is too large (${formatFileSize(file.size)}). Maximum size is 5 MB.` });
        return;
      }

      // Read file content for deeper validation
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (!content || content.length === 0) {
          setPreview({ kind: 'error', fileName: file.name, message: 'File is empty.' });
          return;
        }

        let json: Record<string, unknown>;
        try {
          json = JSON.parse(content) as Record<string, unknown>;
        } catch {
          setPreview({ kind: 'error', fileName: file.name, message: 'Invalid JSON — could not parse file contents.' });
          return;
        }

        const nodes = json.nodes;
        if (!Array.isArray(nodes)) {
          setPreview({ kind: 'error', fileName: file.name, message: 'No nodes array found. This does not appear to be an n8n workflow export.' });
          return;
        }

        const workflowName = typeof json.name === 'string' && json.name ? json.name : 'Untitled Workflow';

        setPreview({
          kind: 'valid',
          fileName: file.name,
          fileSize: formatFileSize(file.size),
          workflowName,
          nodeCount: nodes.length,
        });

        // Auto-proceed after a brief recognition moment
        proceedTimerRef.current = setTimeout(() => {
          proceed();
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
            {isDragging ? 'Drop your workflow file here' : 'Select your n8n workflow JSON'}
          </p>
          <p className="text-sm text-muted-foreground/90 mt-1">
            Click to browse or drag and drop your exported workflow
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
          <FileJson className="w-4 h-4" />
          <span>Accepts .json files exported from n8n</span>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
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
            className={`mt-3 h-12 flex items-center gap-3 px-4 rounded-lg border ${
              preview.kind === 'valid'
                ? 'border-primary/10 bg-zinc-900/50'
                : 'border-red-400/40 bg-red-500/5'
            }`}
          >
            {preview.kind === 'valid' ? (
              <>
                <FileJson className="w-4 h-4 text-violet-400 flex-shrink-0" data-testid="file-preview-icon" />
                <span className="text-sm font-medium text-foreground/90 truncate" data-testid="file-preview-name">
                  {preview.workflowName}
                </span>
                <span className="text-sm text-muted-foreground/60 flex-shrink-0" data-testid="file-preview-stats">
                  {preview.nodeCount} node{preview.nodeCount !== 1 ? 's' : ''} · {preview.fileSize}
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
