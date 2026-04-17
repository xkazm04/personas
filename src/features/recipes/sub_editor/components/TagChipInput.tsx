import { useState, useCallback, useRef, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
interface TagChipInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagChipInput({ tags, onChange }: TagChipInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = useCallback((value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setInput('');
  }, [tags, onChange]);

  const removeTag = useCallback((index: number) => {
    onChange(tags.filter((_, i) => i !== index));
  }, [tags, onChange]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && tags.length > 0) {
      removeTag(tags.length - 1);
    }
  }, [input, tags, addTag, removeTag]);

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 min-h-[38px] w-full rounded-modal border border-border/60 bg-background/50 px-3 py-1.5 cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {tags.map((tag, i) => (
          <span
            key={tag}
            className="animate-fade-slide-in inline-flex items-center gap-1 rounded-card bg-primary/10 text-primary px-2 py-0.5 typo-caption font-medium"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              className="inline-flex items-center justify-center rounded-full hover:bg-primary/20 transition-colors p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (input.trim()) addTag(input); }}
        placeholder={tags.length === 0 ? 'Type tag and press Enter...' : ''}
        className="flex-1 min-w-[80px] bg-transparent typo-body text-foreground placeholder:text-foreground focus-visible:outline-none py-0.5"
      />
    </div>
  );
}
