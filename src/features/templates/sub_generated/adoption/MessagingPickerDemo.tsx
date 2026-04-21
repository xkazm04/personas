// @ts-nocheck — visual-review prototype; see MessagingPickerShared.tsx for
// the cleanup checklist that fires when one variant wins.
//
// Tab switcher parent for the three UC-picker-with-messaging prototypes.
// Mount this anywhere (e.g. from a dev route or a debug menu) to compare
// the variants against the same mock persona fixture.
//
//   Variant A — Chip Rail       (dense, inline)
//   Variant B — Drawer Tabs     (progressive disclosure)
//   Variant C — Pipeline Canvas (visualises the runtime dataflow)
//
// All three render against DEV_CLONE_FIXTURE_USE_CASES with shared
// MOCK_MESSAGING_CHANNELS + SAMPLE_MESSAGE_BY_UC so the user can see
// identical content through each lens.
//
// When one variant wins:
//   1. Delete the two losing variant files + this Demo parent.
//   2. Follow the cleanup checklist at the top of MessagingPickerShared.tsx.
//   3. Insert the winning variant's body into UseCasePickerStepNeon.tsx,
//      keeping the TriggerSelection / UseCaseOption prop shape intact.

import { useState } from 'react';
import { MessagingPickerVariantA } from './MessagingPickerVariantA';
import { MessagingPickerVariantB } from './MessagingPickerVariantB';
import { MessagingPickerVariantC } from './MessagingPickerVariantC';

type VariantId = 'a' | 'b' | 'c';

const VARIANTS: Array<{ id: VariantId; label: string; sub: string; render: () => JSX.Element }> = [
  { id: 'a', label: 'A · Chip Rail',       sub: 'compact, inline',            render: () => <MessagingPickerVariantA /> },
  { id: 'b', label: 'B · Drawer Tabs',     sub: 'progressive disclosure',     render: () => <MessagingPickerVariantB /> },
  { id: 'c', label: 'C · Pipeline Canvas', sub: 'visual runtime dataflow',    render: () => <MessagingPickerVariantC /> },
];

export function MessagingPickerDemo() {
  const [active, setActive] = useState<VariantId>('a');
  const current = VARIANTS.find((v) => v.id === active) ?? VARIANTS[0];

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      {/* Tab switcher — matches the TriggerCompositionDemo.tsx convention */}
      <div className="flex items-center gap-1.5 flex-shrink-0 px-5 py-2 border-b border-border bg-foreground/[0.015]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/50 mr-1">
          Prototype
        </span>
        {VARIANTS.map((v) => {
          const on = active === v.id;
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setActive(v.id)}
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
      </div>

      <div className="flex-1 min-h-0">{current.render()}</div>
    </div>
  );
}
