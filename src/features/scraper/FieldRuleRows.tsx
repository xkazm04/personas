import { Plus, X } from 'lucide-react';

import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { RuleField, RuleType } from './useScrapeForm';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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

const SMALL_INPUT = `${INPUT_FIELD} !py-1.5 typo-body`;

export function FieldRuleRows({ fields, updateField, removeField, addField, emptyHint }: FieldRuleRowsProps) {
  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 && (
        <p className="rounded-interactive border border-dashed border-hair px-3 py-4 text-center typo-caption text-ink-3">
          {emptyHint ?? 'No fields yet — add one, or describe them for Claude to build.'}
        </p>
      )}

      {fields.map((f) => (
        <div key={f.id} className="rounded-interactive border border-hair bg-background/40 p-2.5">
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
            <Button
              type="button"
              onClick={() => removeField(f.id)}
              aria-label="Remove field"
              variant="ghost"
              size="icon-sm"
              icon={<X className="size-4" />}
            />
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
                <Tooltip content={"Attribute to read (e.g. href); blank = text"}><input aria-label="Attribute to read (e.g. href); blank = text"
                  className={`${SMALL_INPUT} w-24 font-mono`}
                  value={f.attr}
                  onChange={(e) => updateField(f.id, { attr: e.target.value })}
                  placeholder="attr" /></Tooltip>
                <label className="flex shrink-0 items-center gap-1.5 typo-caption text-ink-3">
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
                <Tooltip content={"Capture group"}><input aria-label="Capture group"
                  type="number"
                  className={`${SMALL_INPUT} w-20`}
                  value={f.group}
                  onChange={(e) => updateField(f.id, { group: Number(e.target.value) || 0 })} /></Tooltip>
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

      <Button variant="secondary" size="sm" onClick={addField} className="justify-center">
        <Plus className="size-3.5" /> Add field
      </Button>
    </div>
  );
}
