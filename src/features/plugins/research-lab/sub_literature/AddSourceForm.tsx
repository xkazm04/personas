import { useState } from 'react';
import { X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

const SOURCE_TYPES = ['arxiv', 'scholar', 'pubmed', 'web', 'pdf', 'manual'];

interface Props {
  projectId: string;
  onClose: () => void;
}

export default function AddSourceForm({ projectId, onClose }: Props) {
  const { t } = useTranslation();
  const createSource = useSystemStore((s) => s.createResearchSource);

  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState('web');
  const [authors, setAuthors] = useState('');
  const [year, setYear] = useState('');
  const [abstractText, setAbstractText] = useState('');
  const [url, setUrl] = useState('');
  const [doi, setDoi] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      await createSource({
        projectId,
        sourceType,
        title: title.trim(),
        authors: authors.trim() || undefined,
        year: year ? parseInt(year, 10) : undefined,
        abstractText: abstractText.trim() || undefined,
        url: url.trim() || undefined,
        doi: doi.trim() || undefined,
      });
      onClose();
    } catch (err) {
      toastCatch("AddSourceForm:create")(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-card bg-background border border-border/50 shadow-2xl p-6 space-y-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="typo-heading text-foreground">{t.research_lab.search_sources}</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary/50 text-foreground/50">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="typo-caption text-foreground/60 block mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Paper title"
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="typo-caption text-foreground/60 block mb-1">Source type</label>
              <select
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body focus:outline-none focus:border-primary/40"
              >
                {SOURCE_TYPES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="typo-caption text-foreground/60 block mb-1">Year</label>
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="2026"
                className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
              />
            </div>
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">Authors</label>
            <input
              type="text"
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
              placeholder="Author 1, Author 2, ..."
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://arxiv.org/abs/..."
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">DOI</label>
            <input
              type="text"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
              placeholder="10.xxxx/..."
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40"
            />
          </div>

          <div>
            <label className="typo-caption text-foreground/60 block mb-1">Abstract</label>
            <textarea
              value={abstractText}
              onChange={(e) => setAbstractText(e.target.value)}
              placeholder="Paper abstract..."
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 text-foreground typo-body placeholder:text-foreground/30 focus:outline-none focus:border-primary/40 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg typo-body text-foreground/60 hover:bg-secondary/50 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={!title.trim() || saving}
              className="px-4 py-2 rounded-lg typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
            >
              {saving ? t.common.loading : t.common.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
