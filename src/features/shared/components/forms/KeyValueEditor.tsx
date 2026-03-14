import { useState, useCallback, useEffect } from 'react';
import { Plus, Trash2, Code, List } from 'lucide-react';
import { JsonEditor } from '../editors/JsonEditor';

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

  return (
    <div className="space-y-2">
      {/* Mode toggle */}
      <div className="flex items-center justify-end">
        {isAdvanced ? (
          <button
            type="button"
            onClick={switchToSimple}
            disabled={!canSwitchToSimple}
            className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <List className="w-3 h-3" />
            Simple mode
          </button>
        ) : (
          <button
            type="button"
            onClick={switchToAdvanced}
            className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground/70 hover:text-foreground/80 transition-colors"
          >
            <Code className="w-3 h-3" />
            Advanced (JSON)
          </button>
        )}
      </div>

      {isAdvanced ? (
        <JsonEditor value={value} onChange={onChange} placeholder={placeholder} />
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => updateRow(i, 'key', e.target.value)}
                placeholder="Label"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/50 text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => updateRow(i, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-primary/15 bg-background/50 text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/40 focus-visible:ring-1 focus-visible:ring-primary/30 transition-all"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                className="p-1.5 rounded-lg text-muted-foreground/50 hover:text-red-400/80 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRow}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/70 hover:text-foreground/80 border border-dashed border-primary/15 hover:border-primary/30 rounded-lg transition-colors w-full justify-center"
          >
            <Plus className="w-3 h-3" />
            Add field
          </button>
        </div>
      )}
    </div>
  );
}
