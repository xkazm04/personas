// P2+ — reusable skills, rendered in the deploy popover for the Reusable-skills
// row. Lists the skills installed in the user's OTHER projects (or global library)
// that this project doesn't have yet, multi-select, and copies them in via
// skill_files_install → re-derive (the passport's skills artifact reflects
// .claude/skills). The candidate list + each skill's source are precomputed in
// usePassportData and read off the improve engine — no extra fetching here.
import { useState } from 'react';
import { Puzzle } from 'lucide-react';

import { useToastStore } from '@/stores/toastStore';
import { useImprove } from './ImproveContext';

export function SkillsSection({ slug, onClose }: { slug: string; onClose: () => void }) {
  const engine = useImprove();
  const addToast = useToastStore((s) => s.addToast);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState(false);

  const available = engine?.getRaw(slug)?.skillsToAdd ?? [];
  if (!engine || available.length === 0) return null;

  const install = async () => {
    const items = available.filter((s) => selected.has(s.name)).map((s) => ({ name: s.name, source: s.source }));
    setInstalling(true);
    try {
      await engine.installSkills(slug, items);
      addToast(`Installed ${items.length} ${items.length === 1 ? 'skill' : 'skills'}`, 'success');
      onClose();
    } catch {
      addToast('Couldn’t install skills', 'error');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="rounded-interactive border border-primary/10 bg-secondary/15 p-2">
      <div className="flex items-start gap-2">
        <Puzzle className="w-3.5 h-3.5 mt-0.5 text-primary/70 flex-shrink-0" aria-hidden />
        <div className="min-w-0">
          <span className="typo-caption font-medium text-foreground block">Install reusable skills</span>
          <span className="typo-caption text-foreground/55 block leading-snug" style={{ fontWeight: 400 }}>Adopt skills your other projects already have into this one’s .claude/skills.</span>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5 max-h-44 overflow-y-auto">
        {available.map((s) => (
          <li key={s.name}>
            <label className="flex items-start gap-2 px-1 py-1 rounded-interactive hover:bg-primary/[0.04] cursor-pointer">
              <input
                type="checkbox"
                checked={selected.has(s.name)}
                onChange={() => setSelected((p) => { const n = new Set(p); if (n.has(s.name)) n.delete(s.name); else n.add(s.name); return n; })}
                className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 cursor-pointer"
                style={{ accentColor: 'var(--primary)' }}
              />
              <span className="min-w-0">
                <span className="typo-caption font-medium text-foreground block truncate">{s.name}</span>
                {s.description && <span className="typo-caption text-foreground/55 block leading-snug truncate" style={{ fontWeight: 400 }}>{s.description}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between mt-1.5">
        <button type="button" onClick={() => setSelected(new Set(available.map((s) => s.name)))} className="typo-caption text-foreground/55 hover:text-foreground transition-colors">Select all</button>
        <button
          type="button"
          onClick={install}
          disabled={selected.size === 0 || installing}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50"
        >
          <Puzzle className="w-3 h-3" /> {installing ? '…' : selected.size > 0 ? `Install ${selected.size}` : 'Install'}
        </button>
      </div>
    </div>
  );
}
