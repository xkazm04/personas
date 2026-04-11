import { useState, useCallback, useEffect, useMemo } from 'react';
import { Plus, Trash2, Code, List } from 'lucide-react';
import { JsonEditor } from '../editors/JsonEditor';
import { useTranslation } from '@/i18n/useTranslation';

interface KeyValuePair {
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  /** JSON string -- component keeps this in sync */
  value: string;
  onChange: (json: string) => void;
  placeholder?: string;
}

/** Parse a JSON string into key-value rows. Returns null if the JSON is not a flat object. */
function jsonToRows(json: string): KeyValuePair[] | null {
  const trimmed = json.trim();
  if (!trimmed || trimmed === '{}') return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    // Only support flat string/number/bool values
    const rows: KeyValuePair[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (v !== null && typeof v === 'object') return null; // nested -- bail to advanced
      rows.push({ key: k, value: v == null ? '' : String(v) });
    }
    return rows;
  } catch {
    return null;
  }
}

function rowsToJson(rows: KeyValuePair[]): string {
  const obj: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) obj[k] = r.value;
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj, null, 2) : '{}';
}

export function KeyValueEditor({ value, onChange, placeholder }: KeyValueEditorProps) {
  const { t } = useTranslation();
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [rows, setRows] = useState<KeyValuePair[]>(() => jsonToRows(value) ?? [{ key: '', value: '' }]);

  // If external value changes (e.g. rerun), sync rows
  useEffect(() => {
    if (isAdvanced) return;
    const parsed = jsonToRows(value);
    if (parsed !== null) {
      setRows(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
    } else {
      // Can't represent as key-value -- flip to advanced
      setIsAdvanced(true);
    }
  }, [value]);

  const syncToJson = useCallback((updated: KeyValuePair[]) => {
    setRows(updated);
    onChange(rowsToJson(updated));
  }, [onChange]);

  const updateRow = useCallback((index: number, field: 'key' | 'value', val: string) => {
    const updated = rows.map((r, i) => i === index ? { ...r, [field]: val } : r);
    syncToJson(updated);
  }, [rows, syncToJson]);

  const addRow = useCallback(() => {
    syncToJson([...rows, { key: '', value: '' }]);
  }, [rows, syncToJson]);

  const removeRow = useCallback((index: number) => {
    const updated = rows.filter((_, i) => i !== index);
    syncToJson(updated.length > 0 ? updated : [{ key: '', value: '' }]);
  }, [rows, syncToJson]);

  const switchToAdvanced = useCallback(() => {
    setIsAdvanced(true);
  }, []);

  const switchToSimple = useCallback(() => {
    const parsed = jsonToRows(value);
    if (parsed !== null) {
      setRows(parsed.length > 0 ? parsed : [{ key: '', value: '' }]);
      setIsAdvanced(false);
    }
  }, [value]);

  const canSwitchToSimple = jsonToRows(value) !== null;

  /** Set of row indices whose trimmed key duplicates another row's key */
  const duplicateIndices = useMemo(() => {
    const dupes = new Set<number>();
    const keyPositions = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const k = rows[i]!.key.trim();
      if (!k) continue;
      const positions = keyPositions.get(k);
      if (positions) {
        positions.push(i);
      } else {
        keyPositions.set(k, [i]);
      }
    }
    for (const positions of keyPositions.values()) {
      if (positions.length > 1) {
        for (const idx of positions) dupes.add(idx);
      }
    }
    return dupes;
  }, [rows]);

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center justify-end">
        {isAdvanced ? (
          <button
            type="button"
            onClick={switchToSimple}
            disabled={!canSwitchToSimple}
            className="flex items-center gap-1.5 px-2 py-0.5 typo-caption text-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <List className="w-3 h-3" />
            {t.common.simple_mode}
          </button>
        ) : (
          <button
            type="button"
            onClick={switchToAdvanced}
            className="flex items-center gap-1.5 px-2 py-0.5 typo-caption text-foreground hover:text-foreground transition-colors"
          >
            <Code className="w-3 h-3" />
            {t.common.advanced_json}
          </button>
        )}
      </div>

      {isAdvanced ? (
        <JsonEditor value={value} onChange={onChange} placeholder={placeholder} />
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const isDupe = duplicateIndices.has(i);
            return (
              <div key={i} className="space-y-0.5">
                <div className={`flex items-center gap-2 rounded-lg ${isDupe ? 'ring-1 ring-amber-500/40 p-0.5' : ''}`}>
                  <input
                    type="text"
                    value={row.key}
                    onChange={(e) => updateRow(i, 'key', e.target.value)}
                    placeholder={t.common.label_placeholder}
                    className={`flex-1 px-3 py-2 typo-body rounded-lg border bg-background/50 text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-1 transition-all ${
                      isDupe
                        ? 'border-amber-500/40 focus-visible:border-amber-500/60 focus-visible:ring-amber-500/30'
                        : 'border-primary/15 focus-visible:border-primary/40 focus-visible:ring-primary/30'
                    }`}
                  />
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => updateRow(i, 'value', e.target.value)}
                    placeholder={t.common.value_placeholder}
                    className="flex-1 px-3 py-2 typo-body rounded-lg border border-primary/15 bg-background/50 text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="p-1.5 rounded-lg text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isDupe && (
                  <p className="text-amber-500/80 typo-caption pl-1">{t.common.duplicate_key}</p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 typo-caption text-foreground hover:text-foreground border border-dashed border-primary/15 hover:border-primary/30 rounded-lg transition-colors w-full justify-center"
          >
            <Plus className="w-3 h-3" />
            {t.common.add_field}
          </button>
        </div>
      )}
    </div>
  );
}
