/**
 * Combined capability + trigger composition step.
 *
 * Neon is the committed styling. While the messaging-picker prototypes
 * (A / B / C) are under evaluation, this wrapper adds a top-of-step tab
 * switcher so the user can compare Production vs. each prototype inline
 * during adoption. When one variant wins:
 *   1. Delete the MessagingPicker* files + this switcher.
 *   2. Merge the winner's body into UseCasePickerStepNeon.
 *   3. Restore this file to the minimal passthrough shape.
 */
import { useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { UseCasePickerStepNeon } from './UseCasePickerStepNeon';
import { MessagingPickerVariantA } from './MessagingPickerVariantA';
import { MessagingPickerVariantB } from './MessagingPickerVariantB';
import { MessagingPickerVariantC } from './MessagingPickerVariantC';
import type { UseCaseOption, UseCasePickerVariantProps } from './useCasePickerShared';

export type { UseCaseOption };

type ViewId = 'prod' | 'a' | 'b' | 'c';

const VIEWS: Array<{ id: ViewId; label: string; sub: string }> = [
  { id: 'prod', label: 'Production',       sub: 'current neon picker' },
  { id: 'a',    label: 'A · Chip Rail',    sub: 'inline, compact'     },
  { id: 'b',    label: 'B · Drawer Tabs',  sub: 'progressive'         },
  { id: 'c',    label: 'C · Pipeline',     sub: 'runtime dataflow'    },
];

export function UseCasePickerStep(props: UseCasePickerVariantProps) {
  const [view, setView] = useState<ViewId>('prod');
  const selectedCount = props.useCases.filter((u) => props.selectedIds.has(u.id)).length;
  const canContinue = selectedCount > 0;
  const isPrototype = view !== 'prod';

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Prototype switcher — TEMPORARY. Remove once a winner ships. */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-5 py-2 border-b border-border bg-brand-purple/5">
        <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-purple mr-1">
          <Sparkles className="w-3 h-3" /> Prototype
        </span>
        {VIEWS.map((v) => {
          const on = view === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-1.5 rounded-modal border cursor-pointer transition-all ${
                on
                  ? 'bg-primary/15 border-primary/30 text-foreground'
                  : 'bg-card-bg/50 border-card-border text-foreground/70 hover:bg-primary/5 hover:border-primary/20'
              }`}
            >
              <span className="text-[11px] font-semibold leading-none">{v.label}</span>
              <span className="text-[9px] uppercase tracking-wider opacity-70 leading-none">{v.sub}</span>
            </button>
          );
        })}
        {isPrototype && (
          <span className="ml-auto text-[10px] text-foreground/55 italic">
            Mocked vault credentials &amp; sample messages — click Continue when done reviewing
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {view === 'prod' && <UseCasePickerStepNeon {...props} />}
        {view === 'a' && <MessagingPickerVariantA />}
        {view === 'b' && <MessagingPickerVariantB />}
        {view === 'c' && <MessagingPickerVariantC />}
      </div>

      {/* Continue button is always present so the user can exit prototype
       *  mode back to the questionnaire. Production picker has its own
       *  Continue baked in; when previewing a prototype we surface this
       *  shared Continue at the bottom. */}
      {isPrototype && (
        <div className="flex-shrink-0 flex items-center justify-end gap-3 px-6 py-3 border-t border-border bg-background">
          <span className="text-xs text-foreground/55">
            {selectedCount} of {props.useCases.length} capabilit{props.useCases.length === 1 ? 'y' : 'ies'} enabled
          </span>
          <button
            type="button"
            onClick={props.onContinue}
            disabled={!canContinue}
            className="inline-flex items-center gap-2 px-5 py-2 rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckCircle2 className="w-4 h-4" /> Continue
          </button>
        </div>
      )}
    </div>
  );
}
