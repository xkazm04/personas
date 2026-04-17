import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { X, Tag as TagIcon } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

interface TagEditorModalProps {
  assetLabel: string;
  initialTags: string;
  onSave: (tags: string) => void;
  onClose: () => void;
}

function parseTags(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

export default function TagEditorModal({
  assetLabel,
  initialTags,
  onSave,
  onClose,
}: TagEditorModalProps) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<string[]>(() => parseTags(initialTags));
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const commit = (value: string) => {
    const next = value.trim();
    if (!next) return;
    if (tags.includes(next)) return;
    setTags((prev) => [...prev, next]);
    setDraft('');
  };

  const handleInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      e.preventDefault();
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const remove = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const save = () => {
    const trailing = draft.trim();
    const final = trailing && !tags.includes(trailing) ? [...tags, trailing] : tags;
    onSave(final.join(', '));
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-background border border-primary/10 rounded-2xl p-6 w-full max-w-md shadow-elevation-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TagIcon className="w-4 h-4 text-rose-400" />
            <h3 className="typo-section-title">{t.plugins.artist.edit_tags}</h3>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <p className="text-md text-foreground truncate mb-3 font-mono">
          {assetLabel}
        </p>

        <div
          className="flex flex-wrap items-center gap-1.5 min-h-[52px] p-2 rounded-xl bg-secondary/30 border border-primary/10 focus-within:border-rose-500/30 transition-colors cursor-text"
          onClick={() => inputRef.current?.focus()}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-rose-500/15 text-rose-400 text-md"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                className="rounded hover:bg-rose-500/25 p-0.5 transition-colors"
                aria-label={`remove ${tag}`}
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleInputKey}
            onBlur={() => { if (draft.trim()) commit(draft); }}
            placeholder={tags.length === 0 ? t.plugins.artist.tag_editor_placeholder : ''}
            className="flex-1 min-w-[80px] bg-transparent outline-none text-md text-foreground placeholder:text-foreground"
          />
        </div>

        <p className="text-md text-foreground mt-2">
          {t.plugins.artist.tag_editor_hint}
        </p>

        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="accent" accentColor="rose" size="sm" onClick={save}>
            {t.common.save}
          </Button>
        </div>
      </div>
    </div>
  );
}
