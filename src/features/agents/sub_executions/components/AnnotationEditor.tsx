import { useEffect, useMemo, useState } from 'react';
import { Star, Trash2, Plus, X } from 'lucide-react';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

interface AnnotationEditorProps {
  executionId: string;
  personaId: string;
  annotation: ExecutionAnnotation | null;
  knownTags?: string[];
  onSave: (
    executionId: string,
    personaId: string,
    tags: string[],
    note: string | null,
    starred: boolean,
  ) => Promise<ExecutionAnnotation>;
  onDelete?: (id: string) => Promise<void>;
}

export function AnnotationEditor({
  executionId,
  personaId,
  annotation,
  knownTags = [],
  onSave,
  onDelete,
}: AnnotationEditorProps) {
  const { t } = useTranslation();
  const a = t.agents.activity;

  const [tags, setTags] = useState<string[]>(annotation?.tags ?? []);
  const [note, setNote] = useState(annotation?.note ?? '');
  const [starred, setStarred] = useState(annotation?.starred ?? false);
  const [draftTag, setDraftTag] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTags(annotation?.tags ?? []);
    setNote(annotation?.note ?? '');
    setStarred(annotation?.starred ?? false);
  }, [annotation?.id, annotation?.execution_id]);

  const tagSuggestions = useMemo(
    () =>
      knownTags.filter(
        (k) => !tags.includes(k) && k.toLowerCase().includes(draftTag.toLowerCase()),
      ).slice(0, 6),
    [knownTags, tags, draftTag],
  );

  const dirty =
    tags.length !== (annotation?.tags?.length ?? 0) ||
    tags.some((tag, i) => tag !== annotation?.tags?.[i]) ||
    (note || '') !== (annotation?.note ?? '') ||
    starred !== (annotation?.starred ?? false);

  const commitTag = (raw: string) => {
    const value = raw.trim().toLowerCase();
    if (!value) return;
    setTags((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setDraftTag('');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(executionId, personaId, tags, note.trim() ? note.trim() : null, starred);
    } catch (err) {
      toastCatch('annotation.save')(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!annotation || !onDelete) return;
    setSaving(true);
    try {
      await onDelete(annotation.id);
      setTags([]);
      setNote('');
      setStarred(false);
    } catch (err) {
      toastCatch('annotation.delete')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="typo-heading text-foreground uppercase tracking-wider">
          {a.annotation_section_title}
        </span>
        <button
          type="button"
          onClick={() => setStarred((s) => !s)}
          aria-label={a.annotation_starred_aria}
          aria-pressed={starred}
          className={`p-1 rounded-interactive transition-colors ${
            starred ? 'text-amber-400 hover:text-amber-300' : 'text-foreground/40 hover:text-foreground/70'
          }`}
        >
          <Star className="w-4 h-4" fill={starred ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="space-y-1.5">
        <span className="typo-code text-foreground/60 uppercase tracking-wider">
          {a.annotation_tags_label}
        </span>
        <div className="flex flex-wrap gap-1.5 items-center">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-0.5 typo-body rounded-card bg-primary/10 text-primary/90 border border-primary/20"
            >
              {tag}
              <button
                type="button"
                onClick={() => setTags((prev) => prev.filter((tt) => tt !== tag))}
                className="text-primary/60 hover:text-primary"
                aria-label={`Remove ${tag}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={draftTag}
            onChange={(e) => setDraftTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                commitTag(draftTag);
              } else if (e.key === 'Backspace' && !draftTag && tags.length > 0) {
                setTags((prev) => prev.slice(0, -1));
              }
            }}
            placeholder={a.annotation_tag_placeholder}
            className="flex-1 min-w-[100px] px-2 py-0.5 typo-body bg-secondary/30 border border-primary/15 rounded-card text-foreground outline-none focus:border-primary/30"
          />
          <button
            type="button"
            onClick={() => commitTag(draftTag)}
            disabled={!draftTag.trim()}
            className="p-1 rounded-interactive text-foreground/60 hover:text-foreground disabled:opacity-30"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        {tagSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tagSuggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => commitTag(s)}
                className="px-2 py-0.5 typo-code rounded-card bg-secondary/40 text-foreground/70 hover:text-foreground hover:bg-secondary/60 border border-primary/10"
              >
                + {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <span className="typo-code text-foreground/60 uppercase tracking-wider">
          {a.annotation_note_label}
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={a.annotation_note_placeholder}
          rows={3}
          className="w-full px-2 py-1.5 typo-body bg-secondary/30 border border-primary/15 rounded-card text-foreground outline-none focus:border-primary/30 resize-y"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty}
          className="px-3 py-1 typo-body rounded-interactive bg-primary/15 text-primary/90 border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? a.annotation_saved : a.annotation_save}
        </button>
        {annotation && onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving}
            aria-label={a.annotation_delete}
            className="p-1 text-foreground/40 hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
