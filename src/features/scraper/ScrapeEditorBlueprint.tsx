import { useState } from 'react';
import { Check } from 'lucide-react';

import { EditorFooter } from './ScrapeEditorComposer';
import { ExtractStep, OutputStep, ScheduleStep, SourceStep, STEPS, stepComplete } from './EditorSteps';
import type { EditorVariantProps } from './useScrapeForm';

/**
 * Editor variant C — "Blueprint". Mental model: the pipeline as a wired node
 * diagram. A vertical chain of nodes (Source ▸ Extract ▸ Output ▸ Schedule) on
 * the left, connected by a flow line and ticked as they're configured; the
 * selected node's controls fill the right pane. Best for grasping the shape of
 * the pipeline and jumping straight to any stage.
 */
const STEP_BODY = {
  source: SourceStep,
  extract: ExtractStep,
  output: OutputStep,
  schedule: ScheduleStep,
} as const;

export function ScrapeEditorBlueprint({ form, isEdit, saving, onCancel, onSave }: EditorVariantProps) {
  const [activeId, setActiveId] = useState<(typeof STEPS)[number]['id']>('source');
  const active = STEPS.find((s) => s.id === activeId)!;
  const Body = STEP_BODY[activeId];

  return (
    <div className="flex max-h-[80vh] flex-col">
      <div className="border-b border-primary/10 px-6 py-4">
        <h2 className="typo-section-title text-foreground">{isEdit ? 'Edit scrape' : 'New scrape'}</h2>
        <p className="typo-caption text-muted-foreground mt-0.5">Click a node to configure that stage.</p>
      </div>

      <div className="flex min-h-[440px] flex-1 overflow-hidden">
        {/* node chain */}
        <div className="w-56 shrink-0 border-r border-primary/10 bg-secondary/20 p-4">
          <div className="relative">
            {/* flow line */}
            <div className="absolute left-[19px] top-3 bottom-3 w-px bg-primary/15" />
            <div className="space-y-2">
              {STEPS.map((s) => {
                const done = stepComplete(form, s.id);
                const isActive = s.id === activeId;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={`relative flex w-full items-center gap-3 rounded-interactive border p-2.5 text-left transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/10 shadow-elevation-1'
                        : 'border-primary/10 bg-background/40 hover:border-primary/20'
                    }`}
                  >
                    <span
                      className={`z-10 flex size-8 shrink-0 items-center justify-center rounded-full border ${
                        done
                          ? 'border-status-success/40 bg-status-success/15 text-status-success'
                          : isActive
                            ? 'border-primary/40 bg-card text-foreground'
                            : 'border-primary/15 bg-card text-muted-foreground'
                      }`}
                    >
                      {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-foreground">{s.label}</span>
                      <span className="block truncate typo-caption text-muted-foreground">{s.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* focused node editor */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-3 flex items-center gap-2">
            <active.icon className="size-4 text-status-info" />
            <span className="text-foreground">{active.label}</span>
          </div>
          <Body form={form} />
        </div>
      </div>

      <EditorFooter form={form} saving={saving} isEdit={isEdit} onCancel={onCancel} onSave={onSave} />
    </div>
  );
}
