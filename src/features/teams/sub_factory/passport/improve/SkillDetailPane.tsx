// Shared main panel for the unified workbench. Shows the selected skill's
// description + a usage-hint block, then the ONE operation for the active lane:
//   · adopt    — "Adopt into this repo" (Claude customizes it here)
//   · share    — "Share to library" (Claude generalizes it)
//   · dispatch — an optional args field + live `/command` preview + "Dispatch"
// Presentational: the caller passes the op callbacks; this owns only the args
// draft. Empty state keeps the pane's height fixed (no layout shift on select).
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Rocket, Wand2 } from 'lucide-react';

import { skillCommand, usageHint, type LaneKind, type WorkbenchSkill } from './skillsWorkbenchData';

const OP_META: Record<LaneKind, { icon: typeof Rocket; label: string; busyLabel: string; blurb: string }> = {
  adopt: { icon: ArrowDownToLine, label: 'Adopt into this repo', busyLabel: 'Starting…', blurb: 'Claude installs this skill into .claude/skills and customizes it to this codebase.' },
  share: { icon: ArrowUpFromLine, label: 'Share to library', busyLabel: 'Starting…', blurb: 'Claude generalizes this skill and publishes it to your ~/.claude/skills library.' },
  dispatch: { icon: Rocket, label: 'Dispatch', busyLabel: 'Dispatching…', blurb: 'Runs this skill as a background Fleet session in the project root.' },
};

export function SkillDetailPane({ skill, kind, busy, onAct, emptyPrompt }: {
  skill: WorkbenchSkill | null;
  kind: LaneKind;
  busy: boolean;
  /** Perform the lane's operation. `args` is set only for dispatch. */
  onAct: (name: string, args: string) => Promise<void> | void;
  emptyPrompt: string;
}) {
  const [args, setArgs] = useState('');
  const meta = OP_META[kind];
  const hint = usageHint(skill?.description ?? null);
  const Icon = meta.icon;

  if (!skill) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-2 px-8">
        <Wand2 className="w-6 h-6 text-foreground/20" aria-hidden />
        <p className="typo-caption text-foreground/45 leading-snug">{emptyPrompt}</p>
      </div>
    );
  }

  const act = () => { void onAct(skill.name, args); };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3">
        <div>
          <div className="typo-body font-semibold text-foreground break-words">{skill.name}</div>
          {skill.sourceLabel && <div className="typo-label text-foreground/40 mt-0.5">{skill.sourceLabel}</div>}
        </div>

        {skill.description
          ? <p className="typo-caption text-foreground/65 leading-relaxed" style={{ fontWeight: 400 }}>{skill.description}</p>
          : <p className="typo-caption text-foreground/35 italic">No description provided.</p>}

        {hint && (
          <div className="px-3 py-2 rounded-input bg-background/50 border border-primary/10">
            <div className="typo-label text-foreground/40 mb-1">Usage</div>
            <code className="typo-caption font-mono text-foreground/75 break-words">{hint}</code>
          </div>
        )}

        {kind === 'dispatch' && (
          <div className="space-y-2">
            <label className="typo-label text-foreground/40 block">Arguments <span className="text-foreground/30">(optional)</span></label>
            <textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={2}
              placeholder="e.g. run --l2"
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') act(); }}
              className="w-full resize-y px-2.5 py-1.5 typo-caption font-mono rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40 placeholder:text-foreground/35"
              data-testid="skills-workbench-args"
            />
            <div className="px-2.5 py-1.5 rounded-input bg-background/80 border border-primary/10 font-mono typo-caption text-foreground/70 overflow-x-auto">
              <span className="text-foreground/30 select-none">❯ </span>
              <span className="text-primary">claude</span> "{skillCommand(skill.name, args)}"
            </div>
          </div>
        )}
      </div>

      {/* operation footer — fixed at the pane bottom so it never shifts */}
      <div className="flex-shrink-0 px-5 py-3 border-t border-primary/10 bg-secondary/[0.12]">
        <p className="typo-label text-foreground/40 leading-snug mb-2">{meta.blurb}</p>
        <button
          type="button"
          onClick={act}
          disabled={busy}
          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-interactive typo-caption font-medium text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="skills-workbench-act"
        >
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {busy ? meta.busyLabel : meta.label}
        </button>
      </div>
    </div>
  );
}
