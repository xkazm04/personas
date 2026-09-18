/**
 * One channel of the preview: tick box, the stored tone (voice + its first
 * example) beside the proposed one (voice, examples, constraints, length).
 * The two columns stack on narrow widths, current first.
 */

import { safeJsonParse } from '@/lib/utils/parseJson';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinTone } from '@/lib/bindings/TwinTone';
import type { StyleToneDraft } from './styleContract';

interface DraftChannelRowProps {
  draft: StyleToneDraft;
  current: TwinTone | null;
  checked: boolean;
  onToggle: (channel: string) => void;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** The stored examples column is a JSON array of strings; anything else shows nothing. */
function firstExample(raw: string | null | undefined): string | null {
  const [list] = safeJsonParse(raw, isStringArray);
  return list?.find((e) => e.trim().length > 0) ?? null;
}

function Part({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="typo-caption uppercase tracking-[0.14em]">{label}</p>
      {children}
    </div>
  );
}

export function DraftChannelRow({ draft, current, checked, onToggle }: DraftChannelRowProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style.preview;
  const example = firstExample(current?.examples_json);

  return (
    <section
      className={`rounded-card border p-3 space-y-3 transition-colors ${checked ? 'border-primary/30 bg-background/40' : 'border-primary/10 opacity-70'}`}
      data-testid={`style-preview-channel-${draft.channel}`}
    >
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(draft.channel)}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-primary/30 bg-secondary/30 accent-primary"
        />
        <span className="typo-title">{tx(ts.applyTo, { channel: draft.channel })}</span>
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <Part label={ts.current}>
          {current?.voice_directives.trim() ? (
            <>
              <p className="typo-body text-foreground whitespace-pre-line">{current.voice_directives}</p>
              {example && <p className="typo-body text-foreground italic whitespace-pre-line">{example}</p>}
            </>
          ) : (
            <p className="typo-caption">{ts.noCurrent}</p>
          )}
        </Part>

        <div className="space-y-3">
          <Part label={ts.proposed}>
            <p className="typo-body text-foreground whitespace-pre-line">{draft.voiceDirectives}</p>
          </Part>
          {draft.examples.length > 0 && (
            <Part label={ts.examples}>
              <ul className="space-y-1.5">
                {draft.examples.slice(0, 3).map((ex, i) => (
                  <li key={i} className="typo-body text-foreground italic rounded-input bg-secondary/30 px-2 py-1 whitespace-pre-line">{ex}</li>
                ))}
              </ul>
            </Part>
          )}
          {draft.constraints.length > 0 && (
            <Part label={ts.constraints}>
              <ul className="list-disc pl-5 space-y-0.5">
                {draft.constraints.map((c, i) => (
                  <li key={i} className="typo-body text-foreground">{c}</li>
                ))}
              </ul>
            </Part>
          )}
          {draft.lengthHint.trim() && (
            <Part label={ts.length}>
              <p className="typo-body text-foreground">{draft.lengthHint}</p>
            </Part>
          )}
        </div>
      </div>
    </section>
  );
}

export default DraftChannelRow;
