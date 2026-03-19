import { useState, useRef, useCallback } from 'react';
import { Paperclip, Link } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { DesignFileType, DesignFile, DesignContext } from '@/lib/types/frontendTypes';
import { ACCEPTED_EXTENSIONS, detectFileType } from './designInputHelpers';
import { TypeSelectorModal, AttachedFilesRow, ReferencesTextarea } from './DesignInputAttachments';

interface DesignInputProps {
  instruction: string;
  onInstructionChange: (value: string) => void;
  designContext: DesignContext;
  onDesignContextChange: (ctx: DesignContext) => void;
  disabled?: boolean;
  onSubmit?: () => void;
}

export function DesignInput({
  instruction,
  onInstructionChange,
  designContext,
  onDesignContextChange,
  disabled = false,
  onSubmit,
}: DesignInputProps) {
  const [showReferences, setShowReferences] = useState((designContext?.references?.length ?? 0) > 0);
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  const [pendingFile, setPendingFile] = useState<{ name: string; content: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const designContextRef = useRef(designContext);
  designContextRef.current = designContext;
  const onDesignContextChangeRef = useRef(onDesignContextChange);
  onDesignContextChangeRef.current = onDesignContextChange;

  const handleTextareaInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInstructionChange(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.max(200, el.scrollHeight)}px`;
  }, [onInstructionChange]);

  const acceptedSet = useRef(new Set(ACCEPTED_EXTENSIONS.split(',').map((e) => e.trim())));

  const processFile = useCallback((file: globalThis.File) => {
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!acceptedSet.current.has(ext)) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      const autoType = detectFileType(file.name, content);

      if (autoType !== 'other') {
        const ctx = designContextRef.current;
        onDesignContextChangeRef.current({
          ...ctx,
          files: [...(ctx?.files ?? []), { name: file.name, content, type: autoType }],
        });
      } else {
        setPendingFile({ name: file.name, content });
        setShowTypeSelector(true);
      }
    };
    reader.onerror = () => {
      console.error('Failed to read file:', file.name, reader.error);
    };
    reader.readAsText(file);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleTypeConfirm = useCallback((type: DesignFileType) => {
    if (!pendingFile) return;
    const newFile: DesignFile = { name: pendingFile.name, content: pendingFile.content, type };
    onDesignContextChange({
      ...designContext,
      files: [...(designContext?.files ?? []), newFile],
    });
    setPendingFile(null);
    setShowTypeSelector(false);
  }, [pendingFile, designContext, onDesignContextChange]);

  const handleRemoveFile = useCallback((index: number) => {
    onDesignContextChange({
      ...designContext,
      files: (designContext?.files ?? []).filter((_, i) => i !== index),
    });
  }, [designContext, onDesignContextChange]);

  const handleReferencesChange = useCallback((value: string) => {
    const refs = value.split('\n').filter((line) => line.trim());
    onDesignContextChange({
      ...designContext,
      references: refs,
    });
  }, [designContext, onDesignContextChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      processFile(file);
    }
  }, [processFile]);

  return (
    <div className={`space-y-2 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Main textarea */}
      <div
        className="relative"
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary/40 bg-primary/5 rounded-xl pointer-events-none">
            <span className="typo-heading text-primary/50">Drop file here</span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={instruction}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={`Describe what this persona should do...\n\nExamples:\n  - Monitor my Gmail for invoices and extract amounts into a spreadsheet\n  - Watch GitHub webhooks and post summaries to Slack\n  - Analyze our API logs daily and flag anomalies`}
          className="w-full min-h-[200px] bg-background/50 border border-primary/15 rounded-xl p-4 pb-12 typo-body text-foreground resize-none focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30"
          spellCheck
          style={{ overflow: 'hidden' }}
        />

        {/* Action bar */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5 px-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            icon={<Paperclip className="w-3.5 h-3.5" />}
            className="text-muted-foreground/80 hover:text-foreground/95"
            title="Attach file (API spec, schema, MCP config)"
          >
            Attach
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleFileSelect}
            className="hidden"
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowReferences(!showReferences)}
            disabled={disabled}
            icon={<Link className="w-3.5 h-3.5" />}
            className={showReferences
              ? 'text-indigo-400 bg-indigo-500/10'
              : 'text-muted-foreground/80 hover:text-foreground/95'
            }
            title="Add reference URLs or connection strings"
          >
            References
          </Button>

          {(designContext?.files?.length ?? 0) > 0 && (
            <span className="ml-auto typo-body text-muted-foreground/80">
              {designContext.files.length} file{designContext.files.length !== 1 ? 's' : ''} attached
            </span>
          )}
        </div>
      </div>
      <p className="typo-body text-muted-foreground/60 px-1">Press Enter to submit, Shift+Enter for new line.</p>

      {/* Type selector modal */}
      {showTypeSelector && pendingFile && (
        <TypeSelectorModal
          pendingFile={pendingFile}
          onConfirm={handleTypeConfirm}
          onCancel={() => { setPendingFile(null); setShowTypeSelector(false); }}
        />
      )}

      {/* Attached files row */}
      <AttachedFilesRow
        files={designContext?.files ?? []}
        onRemove={handleRemoveFile}
      />

      {/* References textarea */}
      {showReferences && (
        <ReferencesTextarea
          references={designContext?.references ?? []}
          onChange={handleReferencesChange}
          disabled={disabled}
        />
      )}
    </div>
  );
}
