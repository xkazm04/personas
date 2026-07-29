// Confirmation modal for a Skills-Manager row action (Adopt / Share / Use).
// Shows the skill's description so the operator confirms an informed choice
// before an LLM Dev-runner task (adopt/share) or a Fleet dispatch (use) fires.
// The Use variant adds an optional args field + a live `/skill args` preview,
// mirroring the SkillsWorkbench dispatch lane.
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Play } from 'lucide-react';

import { BaseModal } from '@/features/shared/components/modals';
import { skillCommand, usageHint } from '@/features/teams/sub_factory/passport/improve/skillsWorkbenchData';
import { useTranslation } from '@/i18n/useTranslation';

export type SkillActionKind = 'adopt' | 'share' | 'use';

const ICON: Record<SkillActionKind, typeof Play> = {
  adopt: ArrowDownToLine,
  share: ArrowUpFromLine,
  use: Play,
};

export function SkillActionConfirm({ kind, skill, projectName, busy, preset = false, onConfirm, onClose }: {
  kind: SkillActionKind;
  skill: { name: string; description: string | null };
  projectName: string;
  busy: boolean;
  /** App-owned preset: adopt is an instant bundle install, not an LLM
   *  customization run — the blurb must not promise one. */
  preset?: boolean;
  onConfirm: (args: string) => void;
  onClose: () => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const [args, setArgs] = useState('');
  const Icon = ICON[kind];

  const kindLabel = kind === 'adopt' ? d.skills_kind_adopt : kind === 'share' ? d.skills_kind_share : d.skills_kind_use;
  const cta = kind === 'adopt'
    ? tx(d.skills_confirm_adopt_cta, { name: projectName })
    : kind === 'share' ? d.skills_confirm_share_cta : d.skills_confirm_use_cta;
  const blurb = kind === 'adopt'
    ? (preset ? tx(d.skills_adopt_preset_hint, { name: projectName }) : tx(d.skills_adopt_hint, { name: projectName }))
    : kind === 'share' ? d.skills_share_hint : tx(d.skills_use_hint, { name: projectName });

  const hint = kind === 'use' ? usageHint(skill.description) : null;

  return (
    <BaseModal isOpen onClose={onClose} titleId="skill-action-confirm-title" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid={`skill-action-confirm-${kind}`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Icon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          <span id="skill-action-confirm-title" className="typo-title truncate">{skill.name}</span>
          <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">{kindLabel}</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          {skill.description
            ? <p className="typo-caption text-foreground/70 leading-relaxed" style={{ fontWeight: 400 }}>{skill.description}</p>
            : <p className="typo-caption text-foreground/35 italic">{d.skills_confirm_no_desc}</p>}

          {kind === 'use' && (
            <div className="space-y-2">
              {hint && (
                <div className="px-2.5 py-2 rounded-input bg-background/50 border border-primary/10">
                  <div className="typo-label text-foreground/40 mb-1">{d.skills_args_label}</div>
                  <code className="typo-caption font-mono text-foreground/75 break-words">{hint}</code>
                </div>
              )}
              <label className="typo-label text-foreground/45 block">
                {d.skills_args_label} <span className="text-foreground/30">({d.skills_args_optional})</span>
              </label>
              <textarea
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                rows={2}
                placeholder={d.skills_args_placeholder}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onConfirm(args); }}
                className="w-full resize-y px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
                data-testid="skill-action-confirm-args"
              />
              <div className="px-2.5 py-1.5 rounded-input bg-background/80 border border-primary/10 font-mono typo-caption text-foreground/70 overflow-x-auto">
                <span className="text-foreground/30 select-none">❯ </span>
                <span className="text-primary">claude</span> "{skillCommand(skill.name, args)}"
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-primary/10 bg-secondary/10">
          <span className="typo-label text-foreground/40 leading-snug min-w-0 truncate">{blurb}</span>
          <span className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-interactive typo-caption text-foreground/60 hover:text-foreground hover:bg-primary/10 transition-colors"
            >
              {t.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => onConfirm(args)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="skill-action-confirm-cta"
            >
              <Icon className="w-3 h-3" aria-hidden />
              {cta}
            </button>
          </span>
        </div>
      </div>
    </BaseModal>
  );
}
