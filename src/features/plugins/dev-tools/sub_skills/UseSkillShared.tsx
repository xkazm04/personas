// Shared sub-parts for the Use-skill dialog variants — description, args
// field, live command preview, and the confirm/cancel footer. The variants
// differ only in HOW the dispatch-target + context CHOICES are laid out; these
// non-directional pieces are shared so a tweak lands once.
import { Play, TerminalSquare } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { DispatchTarget } from './UseSkillDialog';

export function SkillDescription({ description }: { description: string | null }) {
  const { t } = useTranslation();
  if (!description) return <p className="typo-caption text-foreground/35 italic">{t.plugins.dev_tools.skills_confirm_no_desc}</p>;
  return <p className="typo-caption text-foreground/70 leading-relaxed" style={{ fontWeight: 400 }}>{description}</p>;
}

export function ArgsField({ value, onChange, onSubmit }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <div className="space-y-1">
      <label className="typo-label text-foreground/45 block">
        {d.skills_args_label} <span className="text-foreground/30">({d.skills_args_optional})</span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={d.skills_args_placeholder}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit(); }}
        className="w-full resize-y px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
        data-testid="use-skill-args"
      />
    </div>
  );
}

/** Live `❯ claude "/skill …"` preview. `extra` shows the batch count for the
 *  "all contexts" mode. */
export function PreviewLine({ preview, extra }: { preview: string; extra?: string }) {
  return (
    <div className="px-2.5 py-1.5 rounded-input bg-background/80 border border-primary/10 font-mono typo-caption text-foreground/70 overflow-x-auto">
      <span className="text-foreground/30 select-none">❯ </span>
      <span className="text-primary">claude</span> "{preview}"
      {extra && <span className="ml-1 text-foreground/35">· {extra}</span>}
    </div>
  );
}

export function DialogFooter({ target, busy, onConfirm, onClose }: {
  target: DispatchTarget; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = target === 'cmd' ? TerminalSquare : Play;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-primary/10 bg-secondary/10">
      <button
        type="button"
        onClick={onClose}
        className="px-2.5 py-1 rounded-interactive typo-caption text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
      >
        {t.common.cancel}
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="use-skill-confirm"
      >
        <Icon className="w-3 h-3" aria-hidden />
        {target === 'cmd' ? t.plugins.dev_tools.skills_use_copy_cta : t.plugins.dev_tools.skills_confirm_use_cta}
      </button>
    </div>
  );
}
