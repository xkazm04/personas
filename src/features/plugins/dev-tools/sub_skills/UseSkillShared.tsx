// Shared sub-parts for the Use-skill dialog variants — description, args
// field, live command preview, and the confirm/cancel footer. The variants
// differ only in HOW the dispatch-target + context CHOICES are laid out; these
// non-directional pieces are shared so a tweak lands once.
import { Play, TerminalSquare } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import type { DispatchTarget } from './UseSkillDialog';
import Button from '@/features/shared/components/buttons/Button';

export function SkillDescription({ description }: { description: string | null }) {
  const { t } = useTranslation();
  if (!description) return <p className="typo-caption text-ink-3 italic">{t.plugins.dev_tools.skills_confirm_no_desc}</p>;
  return <p className="typo-caption text-ink-2" style={{ fontWeight: 400 }}>{description}</p>;
}

export function ArgsField({ value, onChange, onSubmit }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  return (
    <div className="space-y-1.5">
      <label className="typo-label text-ink-3 block">
        {d.skills_args_label} <span className="text-ink-3">({d.skills_args_optional})</span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder={d.skills_args_placeholder}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit(); }}
        className="w-full resize-y px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-hair text-foreground outline-none focus:border-primary/40 placeholder:text-ink-3"
        data-testid="use-skill-args"
      />
    </div>
  );
}

/** Live `❯ claude "/skill …"` preview. `extra` shows the batch count for the
 *  "all contexts" mode. */
export function PreviewLine({ preview, extra }: { preview: string; extra?: string }) {
  return (
    <div className="px-2.5 py-1.5 rounded-input bg-background/80 border border-hair font-mono typo-caption text-ink-2 overflow-x-auto">
      <span className="text-ink-3 select-none">❯ </span>
      <span className="text-primary">claude</span> "{preview}"
      {extra && <span className="ml-1 text-ink-3">· {extra}</span>}
    </div>
  );
}

export function DialogFooter({ target, busy, onConfirm, onClose }: {
  target: DispatchTarget; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const { t } = useTranslation();
  const Icon = target === 'cmd' ? TerminalSquare : Play;
  return (
    <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-hair bg-surface-1">
      <Button variant="ghost" size="sm"
        type="button"
        onClick={onClose}
      >
        {t.common.cancel}
      </Button>
      <Button variant="secondary" size="sm"
        type="button"
        onClick={onConfirm}
        disabled={busy}
        data-testid="use-skill-confirm"
      >
        <Icon className="w-3 h-3" aria-hidden />
        {target === 'cmd' ? t.plugins.dev_tools.skills_use_launch_cta : t.plugins.dev_tools.skills_confirm_use_cta}
      </Button>
    </div>
  );
}
