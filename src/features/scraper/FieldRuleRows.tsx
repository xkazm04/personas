import { Plus, X } from 'lucide-react';

import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { RuleField, RuleType } from './useScrapeForm';

/**
 * Structured per-field rule editor (Phase 1b-2) — one row per extracted field,
 * so every step of the extraction pipeline is directly under control (vs an
 * opaque JSON blob). Shared by all edit-modal variants; also the surface the
 * LLM builder populates.
 */
interface FieldRuleRowsProps {
  fields: RuleField[];
  updateField: (id: string, patch: Partial<RuleField>) => void;
  removeField: (id: string) => void;
  addField: () => void;
  emptyHint?: string;
}

const SMALL_INPUT = `${INPUT_FIELD} !py-1.5 text-sm`;

export function FieldRuleRows({ fields, updateField, removeField, addField, emptyHint }: FieldRuleRowsProps) {
  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && (
        <p className="rounded-interactive border border-dashed border-primary/15 px-3 py-4 text-center typo-caption text-muted-foreground">
          {emptyHint ?? 'No fields yet — add one, or describe them for Claude to build.'}
        </p>
      )}

      {fields.map((f) => (
        <div key={f.id} className="rounded-interactive border border-primary/10 bg-background/40 p-2.5">
          <div className="flex items-center gap-2">
            <input
              className={`${SMALL_INPUT} w-40 font-mono`}
              value={f.name}
              onChange={(e) => updateField(f.id, { name: e.target.value })}
              placeholder="field_name"
            />
            <ThemedSelect
              wrapperClassName="w-28"
              value={f.type}
              onValueChange={(v) => updateField(f.id, { type: v as RuleType })}
            >
              <option value="css">CSS</option>
              <option value="regex">Regex</option>
              <option value="json">JSON</option>
            </ThemedSelect>
            <div className="flex-1" />
            <button
              onClick={() => removeField(f.id)}
              className="rounded-interactive p-1 text-muted-foreground hover:bg-status-error/10 hover:text-status-error transition-colors"
              aria-label="Remove field"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* type-specific controls */}
          <div className="mt-2 flex items-center gap-2">
            {f.type === 'css' && (
              <>
                <input
                  className={`${SMALL_INPUT} flex-1 font-mono`}
                  value={f.selector}
                  onChange={(e) => updateField(f.id, { selector: e.target.value })}
                  placeholder=".price, h1, a.title"
                />
                <input
                  className={`${SMALL_INPUT} w-24 font-mono`}
                  value={f.attr}
                  onChange={(e) => updateField(f.id, { attr: e.target.value })}
                  placeholder="attr"
                  title="Attribute to read (e.g. href); blank = text"
                />
                <label className="flex shrink-0 items-center gap-1.5 typo-caption text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={f.all}
                    onChange={(e) => updateField(f.id, { all: e.target.checked })}
                  />
                  all
                </label>
              </>
            )}
            {f.type === 'regex' && (
              <>
                <input
                  className={`${SMALL_INPUT} flex-1 font-mono`}
                  value={f.pattern}
                  onChange={(e) => updateField(f.id, { pattern: e.target.value })}
                  placeholder="\\$([0-9.]+)"
                />
                <input
                  type="number"
                  className={`${SMALL_INPUT} w-20`}
                  value={f.group}
                  onChange={(e) => updateField(f.id, { group: Number(e.target.value) || 0 })}
                  title="Capture group"
                />
              </>
            )}
            {f.type === 'json' && (
              <input
                className={`${SMALL_INPUT} flex-1 font-mono`}
                value={f.pointer}
                onChange={(e) => updateField(f.id, { pointer: e.target.value })}
                placeholder="/data/0/name"
              />
            )}
          </div>
        </div>
      ))}

      <button
        onClick={addField}
        className="flex items-center justify-center gap-1 rounded-interactive border border-dashed border-primary/20 py-2 typo-caption text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
      >
        <Plus className="size-3.5" /> Add field
      </button>
    </div>
  );
}
