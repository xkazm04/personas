/** The other inner layers the camera can push into: reference context before
 *  launch, the refine composer, and the capability review (the existing
 *  GlyphCapabilityPreview with its Remove / Split affordances). */
import Button from "@/features/shared/components/buttons/Button";
import { GlyphRefineComposer } from "@/features/agents/sub_glyph/GlyphRefineComposer";
import { GlyphCapabilityPreview } from "@/features/agents/sub_glyph/GlyphCapabilityPreview";
import { COPY } from "./copy";

function LayerHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1 pr-10">
      <h2 className="typo-heading-lg font-semibold text-foreground">{title}</h2>
      {hint && <p className="typo-body text-foreground">{hint}</p>}
    </div>
  );
}

export function ContextLayer({ value, onChange, onDone }: { value: string; onChange?: (v: string) => void; onDone: () => void }) {
  return (
    <div className="flex-1 flex flex-col gap-4 max-w-[580px] w-full mx-auto">
      <LayerHead title={COPY.context} hint={COPY.contextHint} />
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={COPY.contextPlaceholder}
        aria-label={COPY.context}
        className="flex-1 min-h-[160px] w-full rounded-input border border-card-border bg-card-bg p-3.5 typo-body text-foreground leading-relaxed outline-none resize-none focus:border-foreground/30"
      />
      <div className="flex justify-end">
        <Button variant="primary" size="md" onClick={onDone}>{COPY.done}</Button>
      </div>
    </div>
  );
}

export function RefineLayer({ prefill, onSubmit, onCancel }: { prefill: string | null; onSubmit: (v: string) => void; onCancel: () => void }) {
  return (
    <div className="flex-1 flex flex-col justify-center gap-4 max-w-[580px] w-full mx-auto">
      <LayerHead title={COPY.refine} hint={COPY.refineHint} />
      <GlyphRefineComposer initialText={prefill ?? undefined} onSubmit={onSubmit} onCancel={onCancel} />
    </div>
  );
}

export function CapsLayer({ onRequestSplit }: { onRequestSplit: (title: string, prompt: string) => void }) {
  return (
    <div className="flex flex-col gap-4 max-w-[600px] w-full mx-auto">
      <LayerHead title={COPY.capabilities} />
      <GlyphCapabilityPreview onRequestSplit={onRequestSplit} />
    </div>
  );
}
