import { useRef, useCallback, useMemo } from 'react';
import { tokenize, TOKEN_CLASSES } from './sqlTokenizers';

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  placeholder?: string;
  onExecute?: () => void;
  minHeight?: string;
}

export function SqlEditor({ value, onChange, language = 'sql', placeholder, onExecute, minHeight = '120px' }: SqlEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);

  const tokens = useMemo(() => tokenize(value, language), [value, language]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = e.currentTarget;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const newVal = value.substring(0, start) + '  ' + value.substring(end);
        onChange(newVal);
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + 2;
        });
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        onExecute?.();
      }
    },
    [value, onChange, onExecute],
  );

  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  return (
    <div className="relative rounded-lg border border-primary/10 bg-secondary/20 overflow-hidden" style={{ minHeight }}>
      {/* Syntax-highlighted layer */}
      <pre
        ref={preRef}
        className="absolute inset-0 p-3 text-sm font-mono whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
        aria-hidden
      >
        {tokens.map((token, i) => (
          <span key={i} className={TOKEN_CLASSES[token.type]}>
            {token.value}
          </span>
        ))}
        {'\n'}
      </pre>

      {/* Textarea (transparent text, handles input) */}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative w-full h-full p-3 text-sm font-mono bg-transparent text-transparent caret-foreground/80 resize-none focus-visible:outline-none placeholder:text-muted-foreground/60"
        style={{ minHeight }}
      />
    </div>
  );
}
