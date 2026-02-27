import { useMemo } from 'react';
import {
  parseStructuredPrompt,
  STANDARD_SECTION_KEYS,
  SECTION_LABELS,
} from '@/lib/personas/promptMigration';
import { diffStrings } from './labUtils';

interface Props {
  currentPromptJson: string | null;
  draftPromptJson: string | null;
  changeSummary?: string | null;
}

export function DraftDiffViewer({ currentPromptJson, draftPromptJson, changeSummary }: Props) {
  const { diffs, hasChanges } = useMemo(() => {
    const current = currentPromptJson ? parseStructuredPrompt(currentPromptJson) : null;
    const draft = draftPromptJson ? parseStructuredPrompt(draftPromptJson) : null;

    if (!current || !draft) return { diffs: [], hasChanges: false };

    const diffs = STANDARD_SECTION_KEYS.map((key) => {
      const a = (current as unknown as Record<string, string>)[key] ?? '';
      const b = (draft as unknown as Record<string, string>)[key] ?? '';
      const changed = a !== b;
      return {
        key,
        label: SECTION_LABELS[key] ?? key,
        changed,
        diff: changed ? diffStrings(a, b) : [],
      };
    });

    return { diffs, hasChanges: diffs.some((d) => d.changed) };
  }, [currentPromptJson, draftPromptJson]);

  return (
    <div className="space-y-3">
      {changeSummary && (
        <div className="px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-sm text-violet-300">
          {changeSummary}
        </div>
      )}

      {!hasChanges ? (
        <p className="text-sm text-muted-foreground/60 text-center py-4">No structural differences detected</p>
      ) : (
        diffs.map((d) => (
          <div key={d.key} className="rounded-lg border border-primary/10 bg-secondary/20 p-3">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wider">{d.label}</h4>
              {!d.changed && (
                <span className="text-xs text-muted-foreground/40">No changes</span>
              )}
            </div>
            {d.changed && (
              <div className="text-sm leading-relaxed">
                {d.diff.map((seg, i) => (
                  <span
                    key={i}
                    className={
                      seg.type === 'added'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : seg.type === 'removed'
                          ? 'bg-red-500/20 text-red-300 line-through'
                          : 'text-foreground/70'
                    }
                  >
                    {seg.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
