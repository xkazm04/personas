import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Check, X, AlignLeft } from 'lucide-react';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/** Tokenize a JSON string into typed spans for syntax highlighting. */
function tokenizeJson(text: string): { type: 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'text'; value: string }[] {
  const tokens: { type: 'key' | 'string' | 'number' | 'bool' | 'null' | 'punct' | 'text'; value: string }[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;

    // Whitespace
    if (/\s/.test(ch)) {
      let ws = '';
      while (i < text.length && /\s/.test(text[i]!)) {
        ws += text[i]!;
        i++;
      }
      tokens.push({ type: 'text', value: ws });
      continue;
    }

    // Strings — need to detect if this is a key or value
    if (ch === '"') {
      let str = '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') {
          str += text[i]!;
          i++;
          if (i < text.length) {
            str += text[i]!;
            i++;
          }
          continue;
        }
        str += text[i]!;
        i++;
      }
      if (i < text.length) {
        str += '"';
        i++;
      }

      // Look ahead for colon to determine if this is a key
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      const isKey = j < text.length && text[j] === ':';

      tokens.push({ type: isKey ? 'key' : 'string', value: str });
      continue;
    }

    // Numbers
    if (/[-\d]/.test(ch)) {
      let num = '';
      while (i < text.length && /[-\d.eE+]/.test(text[i]!)) {
        num += text[i]!;
        i++;
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Booleans and null
    if (text.slice(i, i + 4) === 'true') {
      tokens.push({ type: 'bool', value: 'true' });
      i += 4;
      continue;
    }
    if (text.slice(i, i + 5) === 'false') {
      tokens.push({ type: 'bool', value: 'false' });
      i += 5;
      continue;
    }
    if (text.slice(i, i + 4) === 'null') {
      tokens.push({ type: 'null', value: 'null' });
      i += 4;
      continue;
    }

    // Punctuation
    if ('{}[],:'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i++;
      continue;
    }

    // Fallback
    tokens.push({ type: 'text', value: ch });
    i++;
  }

  return tokens;
}

const TOKEN_CLASSES: Record<string, string> = {
  key: 'text-cyan-400',
  string: 'text-amber-400',
  number: 'text-emerald-400',
  bool: 'text-violet-400',
  null: 'text-muted-foreground/60',
  punct: 'text-muted-foreground/70',
  text: 'text-foreground/90',
};

export function JsonEditor({ value, onChange, placeholder }: JsonEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  const validationState = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return 'empty' as const;
    try {
      JSON.parse(trimmed);
      return 'valid' as const;
    } catch (e) {
      return { error: e instanceof SyntaxError ? e.message : 'Invalid JSON' };
    }
  }, [value]);

  const isValid = validationState === 'valid';
  const isError = typeof validationState === 'object';
  const isEmpty = validationState === 'empty';

  const highlighted = useMemo(() => {
    if (!value) return null;
    const tokens = tokenizeJson(value);
    return tokens.map((t, i) => (
      <span key={i} className={TOKEN_CLASSES[t.type]}>
        {t.value}
      </span>
    ));
  }, [value]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
    } catch {
      // Can't format invalid JSON
    }
  }, [value, onChange]);

  // Sync scroll between textarea and pre
  const handleScroll = useCallback(() => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  // Auto-resize height to content
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollH = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.max(128, Math.min(scrollH, 320))}px`;
    }
  }, [value]);

  return (
    <div className="space-y-1">
      {/* Editor header with validation badge + format button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {!isEmpty && (
            isValid ? (
              <span className="flex items-center gap-1 text-xs text-emerald-400/80">
                <Check className="w-3 h-3" />
                Valid JSON
              </span>
            ) : isError ? (
              <span className="flex items-center gap-1 text-xs text-red-400/80 truncate max-w-[280px]">
                <X className="w-3 h-3 flex-shrink-0" />
                {validationState.error}
              </span>
            ) : null
          )}
        </div>
        <button
          type="button"
          onClick={handleFormat}
          disabled={!isValid}
          className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Format JSON"
        >
          <AlignLeft className="w-3 h-3" />
          Format
        </button>
      </div>

      {/* Editor with overlay */}
      <div
        className={`relative rounded-xl border bg-background/50 transition-all overflow-hidden ${
          isError && !isEmpty
            ? 'border-red-500/30 ring-1 ring-red-500/30'
            : isFocused
              ? 'border-primary/40 ring-2 ring-primary/40'
              : 'border-primary/15'
        }`}
      >
        {/* Syntax-highlighted layer (behind) */}
        <pre
          ref={preRef}
          aria-hidden
          className="absolute inset-0 px-4 py-3 font-mono text-sm leading-[1.625] whitespace-pre-wrap break-all overflow-hidden pointer-events-none m-0"
        >
          {highlighted || (
            <span className="text-muted-foreground/30">{placeholder}</span>
          )}
        </pre>

        {/* Transparent textarea (on top, captures input) */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleScroll}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder=""
          className="relative w-full px-4 py-3 font-mono text-sm leading-[1.625] bg-transparent text-transparent caret-foreground resize-none focus:outline-none"
          style={{ minHeight: 128 }}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
        />
      </div>
    </div>
  );
}
