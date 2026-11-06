import { useRef, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { Plus, X, ChevronDown } from 'lucide-react';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import { IMPORTANCE_MIN, IMPORTANCE_MAX, IMPORTANCE_DEFAULT } from '../../libs/memoryConstants';
import { Slider } from '@/features/shared/components/forms/Slider';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { Listbox } from '@/features/shared/components/forms/Listbox';

const CATEGORIES = ['observation', 'decision', 'context', 'learning'] as const;

interface AddTeamMemoryFormProps {
  teamId: string;
  /** Resolves `false` when the write failed; the form then keeps the draft. */
  onSubmit: (input: CreateTeamMemoryInput) => Promise<boolean> | void;
}

export default function AddTeamMemoryForm({ teamId, onSubmit }: AddTeamMemoryFormProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string>('observation');
  const [importance, setImportance] = useState(IMPORTANCE_DEFAULT);

  // One write per draft: the form now stays open until the write answers.
  const submittingRef = useRef(false);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim() || submittingRef.current) return;
    submittingRef.current = true;
    // Cleared only once the write LANDED: clearing first discarded a typed
    // memory whenever the save failed, leaving a toast and an empty form.
    const ok = await Promise.resolve(onSubmit({
      team_id: teamId,
      run_id: null,
      member_id: null,
      persona_id: null,
      title: title.trim(),
      content: content.trim(),
      category,
      importance,
      tags: 'manual',
    })).finally(() => { submittingRef.current = false; });
    if (ok === false) return;
    setTitle('');
    setContent('');
    setCategory('observation');
    setImportance(IMPORTANCE_DEFAULT);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <Button variant="secondary" size="sm" className="w-full" onClick={() => setExpanded(true)} icon={<Plus className="w-3 h-3" />}>
{t.pipeline.add_memory}
</Button>
    );
  }

  return (
    <div className="border border-hair rounded-card p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="typo-body text-foreground">{t.pipeline.new_memory}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => setExpanded(false)} aria-label={t.common.cancel}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      <input
        className="w-full typo-body bg-secondary/60 border border-hair rounded-card px-2 py-1.5 text-ink-2 placeholder:text-foreground focus-visible:outline-none focus-visible:border-hair"
        placeholder={t.pipeline.title_placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="w-full typo-body bg-secondary/60 border border-hair rounded-card px-2 py-1.5 text-ink-2 placeholder:text-foreground focus-visible:outline-none focus-visible:border-hair resize-none"
        placeholder={t.pipeline.content_placeholder}
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />

      <div className="flex items-center gap-2">
        <Listbox
          ariaLabel={t.pipeline.category_label}
          className="flex-shrink-0"
          itemCount={CATEGORIES.length}
          onSelectFocused={(idx) => {
            const picked = CATEGORIES[idx];
            if (picked) setCategory(picked);
          }}
          renderTrigger={({ isOpen, toggle }) => (
            <Button variant="secondary" size="xs" onClick={toggle} aria-label={t.pipeline.category_label} iconRight={<ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}>
{tokenLabel(t, 'memory_category', category)}
</Button>
          )}
        >
          {({ close, focusIndex }) => (
            <div className="py-1 bg-secondary/95">
              {CATEGORIES.map((c, idx) => (
                <button
                  key={c}
                  type="button"
                  role="option"
                  aria-selected={category === c}
                  onClick={() => { setCategory(c); close(); }}
                  className={`w-full text-left px-2 py-1 typo-body transition-colors ${
                    idx === focusIndex || category === c
                      ? 'bg-primary/10 text-foreground'
                      : 'text-ink-2 hover:bg-surface-2'
                  }`}
                >
                  {tokenLabel(t, 'memory_category', c)}
                </button>
              ))}
            </div>
          )}
        </Listbox>

        <div className="flex items-center gap-1">
          <span className="typo-body text-foreground">{t.pipeline.importance_label}</span>
          <Slider
            min={IMPORTANCE_MIN}
            max={IMPORTANCE_MAX}
            value={importance}
            onChange={(v) => setImportance(v)}
            ariaLabel={t.pipeline.importance_label}
            showBubble={false}
            className="w-14"
          />
          <span className="typo-body text-foreground w-3 text-right">{importance}</span>
        </div>
      </div>

      <button
        type="button"
        className="w-full typo-body py-1.5 rounded-card bg-role-agent/15 text-role-agent hover:bg-role-agent/25 transition-colors disabled:is-disabled"
        disabled={!title.trim() || !content.trim()}
        onClick={() => { void handleSubmit(); }}
      >
        {t.pipeline.save_memory}
      </button>
    </div>
  );
}
