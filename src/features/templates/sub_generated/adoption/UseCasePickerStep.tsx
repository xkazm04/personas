/**
 * Combined capability + trigger composition step.
 *
 * Neon is the committed styling. The Pipeline-Canvas messaging prototype
 * is available alongside Production via a top-of-step switcher so the
 * two ideas can be evaluated side-by-side; they'll be combined later.
 *
 * All chrome goes through semantic tokens (`typo-caption` / `typo-body` /
 * `bg-card-bg` / `border-card-border` / `border-border` / brand colors)
 * so theme switches work without raw tailwind escapes.
 *
 * When Production and Pipeline are combined:
 *   1. Delete MessagingPicker* files + this switcher.
 *   2. Merge the chosen body into UseCasePickerStepNeon.
 *   3. Restore this file to a minimal passthrough.
 */
import { useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { UseCasePickerStepNeon } from './UseCasePickerStepNeon';
import { MessagingPickerVariantH } from './MessagingPickerVariantH';
import { MessagingPickerVariantJ } from './MessagingPickerVariantJ';
import { MessagingPickerVariantK } from './MessagingPickerVariantK';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

type ViewId = 'prod' | 'forge' | 'quickset' | 'ticket';

const VIEWS: Array<{ id: ViewId; label: string; sub: string }> = [
  { id: 'prod',     label: 'Production', sub: 'current neon picker'            },
  { id: 'forge',    label: 'Forge',      sub: 'H · baseline · gears + stamps'  },
  { id: 'quickset', label: 'Quick Set',  sub: 'J · 5-preset + unified deliver' },
  { id: 'ticket',   label: 'Ticket',     sub: 'K · postmark + address stub'    },
];

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  const [view, setView] = useState<ViewId>('prod');
  const selectedCount = props.useCases.filter((u) => props.selectedIds.has(u.id)).length;
  const canContinue = selectedCount > 0;
  const isPrototype = view !== 'prod';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Prototype switcher — TEMPORARY. Remove once Production + Pipeline merge. */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2 border-b border-border bg-brand-purple/5">
        <span className="inline-flex items-center gap-1 typo-caption font-semibold uppercase tracking-[0.2em] text-brand-purple mr-1">
          <Sparkles className="w-3 h-3" /> Prototype
        </span>
        {VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`focus-ring flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-modal border cursor-pointer transition-all ${
                on
                  ? 'bg-primary/15 border-primary/30 text-foreground'
                  : 'bg-card-bg/50 border-card-border text-foreground/70 hover:bg-primary/5 hover:border-primary/20'
              }`}
            >
              <span className="typo-caption font-semibold leading-none">{v.label}</span>
              <span className="typo-caption uppercase tracking-wider opacity-70 leading-none">{v.sub}</span>
            </button>
          );
        })}
        {isPrototype && (
          <span className="ml-auto typo-caption text-foreground/55 italic">
            Mocked vault credentials &amp; sample messages — click Continue when done reviewing
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {view === 'prod' && <UseCasePickerStepNeon {...props} />}
        {view === 'forge' && <MessagingPickerVariantH />}
        {view === 'quickset' && <MessagingPickerVariantJ />}
        {view === 'ticket' && <MessagingPickerVariantK />}
      </div>

      {/* Continue button is only surfaced while a prototype is active so
       *  the user can exit back to the questionnaire. Production has its
       *  own Continue baked in. */}
      {isPrototype && (
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-3 border-t border-border bg-background">
          <span className="typo-caption text-foreground/55">
            {selectedCount} of {props.useCases.length} capabilit{props.useCases.length === 1 ? 'y' : 'ies'} enabled
          </span>
          <button
            type="button"
            onClick={props.onContinue}
            disabled={!canContinue}
            className="focus-ring inline-flex items-center gap-2 px-5 py-2 rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" /> Continue
          </button>
        </div>
      )}
    </div>
  );
}
