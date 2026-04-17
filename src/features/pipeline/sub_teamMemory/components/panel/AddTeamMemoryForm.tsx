import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { CreateTeamMemoryInput } from '@/lib/bindings/CreateTeamMemoryInput';
import { IMPORTANCE_MIN, IMPORTANCE_MAX, IMPORTANCE_DEFAULT } from '../../libs/memoryConstants';
import { useTranslation } from '@/i18n/useTranslation';

const CATEGORIES = ['observation', 'decision', 'context', 'learning'] as const;

interface AddTeamMemoryFormProps {
  teamId: string;
  onSubmit: (input: CreateTeamMemoryInput) => void;
}

export default function AddTeamMemoryForm({ teamId, onSubmit }: AddTeamMemoryFormProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<string>('observation');
  const [importance, setImportance] = useState(IMPORTANCE_DEFAULT);

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    onSubmit({
      team_id: teamId,
      run_id: null,
      member_id: null,
      persona_id: null,
      title: title.trim(),
      content: content.trim(),
      category,
      importance,
      tags: 'manual',
    });
    setTitle('');
    setContent('');
    setCategory('observation');
    setImportance(IMPORTANCE_DEFAULT);
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        className="w-full flex items-center justify-center gap-1.5 py-1.5 typo-body text-foreground hover:text-foreground/80 border border-dashed border-primary/10 hover:border-primary/20 rounded-card transition-colors"
        onClick={() => setExpanded(true)}
      >
        <Plus className="w-3 h-3" />
        {t.pipeline.add_memory}
      </button>
    );
  }

  return (
    <div className="border border-primary/15 rounded-card p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="typo-body font-medium text-foreground">{t.pipeline.new_memory}</span>
        <button
          className="p-0.5 rounded hover:bg-primary/10 text-foreground"
          onClick={() => setExpanded(false)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        className="w-full typo-body bg-secondary/60 border border-primary/10 rounded-card px-2 py-1.5 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30"
        placeholder={t.pipeline.title_placeholder}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <textarea
        className="w-full typo-body bg-secondary/60 border border-primary/10 rounded-card px-2 py-1.5 text-foreground/90 placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30 resize-none"
        placeholder={t.pipeline.content_placeholder}
        rows={3}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />

      <div className="flex items-center gap-2">
        <select
          className="typo-body bg-secondary/60 border border-primary/10 rounded-card px-1.5 py-1 text-foreground focus-visible:outline-none"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <span className="typo-body text-foreground">{t.pipeline.importance_label}</span>
          <input
            type="range"
            min={IMPORTANCE_MIN}
            max={IMPORTANCE_MAX}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="w-14 h-1 accent-amber-500"
          />
          <span className="typo-body text-foreground w-3 text-right">{importance}</span>
        </div>
      </div>

      <button
        className="w-full typo-body py-1.5 rounded-card bg-indigo-500/15 text-indigo-400 hover:bg-indigo-500/25 transition-colors disabled:opacity-40"
        disabled={!title.trim() || !content.trim()}
        onClick={handleSubmit}
      >
        {t.pipeline.save_memory}
      </button>
    </div>
  );
}
