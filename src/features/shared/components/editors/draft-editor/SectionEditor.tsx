import { useState, useRef, useCallback } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

interface SectionEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

/** Classify a line of markdown source and return a Tailwind class string. */
function lineClass(raw: string): string {
  const t = raw.trimStart();
  if (t.startsWith('#### ')) return 'text-accent/80 font-medium';
  if (t.startsWith('### '))  return 'text-accent font-semibold';
  if (t.startsWith('## '))   return 'text-primary/90 font-semibold';
  if (t.startsWith('# '))    return 'text-primary font-bold';
  if (t.startsWith('> '))    return 'text-violet-400/80 italic';
  if (t.startsWith('```'))   return 'text-emerald-400/70';
  if (t.startsWith('- ') || t.startsWith('* ')) return 'text-foreground/60';
  return 'text-foreground/70';
}

/**
 * Render markdown source with syntax-highlighted headings.
 * Each line becomes a <div> so line heights match the textarea exactly.
 */
function HighlightedSource({ value }: { value: string }) {
  const lines = value.split('\n');
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || '\u00A0'}
        </div>
      ))}
    </>
  );
}

export function SectionEditor({ value, onChange, label, placeholder, disabled }: SectionEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('preview');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header with label and toggle */}
      <div className="flex items-center justify-between px-1 pb-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground/80">{label}</span>
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-secondary/30 border border-primary/10">
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1 px-2 py-1 text-sm rounded-lg transition-colors ${
              mode === 'edit'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/90 hover:text-muted-foreground'
            }`}
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`flex items-center gap-1 px-2 py-1 text-sm rounded-lg transition-colors ${
              mode === 'preview'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/90 hover:text-muted-foreground'
            }`}
          >
            <Eye className="w-3 h-3" />
            Preview
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 rounded-xl border border-primary/15 overflow-hidden">
        {mode === 'edit' ? (
          <div className="relative w-full h-full">
            {/* Syntax-highlighted underlay -- must mirror textarea padding/font exactly */}
            <div
              ref={highlightRef}
              aria-hidden="true"
              className="absolute inset-0 px-4 py-3 text-sm font-mono leading-relaxed whitespace-pre-wrap break-words pointer-events-none"
              style={{ overflow: 'auto', background: 'var(--color-background, #0a0a12)', opacity: 0.5 }}
            >
              {value ? (
                <HighlightedSource value={value} />
              ) : (
                <span className="text-muted-foreground/30">{placeholder}</span>
              )}
            </div>
            {/* Transparent textarea on top for actual editing */}
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onScroll={syncScroll}
              disabled={disabled}
              placeholder={placeholder}
              spellCheck={false}
              className="relative z-10 w-full h-full px-4 py-3 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              style={{
                background: 'transparent',
                color: 'transparent',
                caretColor: 'var(--color-foreground, #f0f0f5)',
                WebkitTextFillColor: 'transparent',
              }}
            />
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-4 py-3 bg-background/30">
            {value.trim() ? (
              <MarkdownRenderer content={value} />
            ) : (
              <p className="text-sm text-muted-foreground/80 italic">No content to preview</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
