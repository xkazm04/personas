import { useTranslation } from '@/i18n/useTranslation';
import { useCallback } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';

export interface SchemaField {
  key: string;
  type: string;
  label: string;
  default?: string;
}

const FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'textarea', 'json'];

interface SchemaFieldBuilderProps {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
}

export function SchemaFieldBuilder({ fields, onChange }: SchemaFieldBuilderProps) {
  const { t } = useTranslation();
  const rt = t.recipes;
  const addField = useCallback(() => {
    onChange([...fields, { key: '', type: 'text', label: '', default: '' }]);
  }, [fields, onChange]);

  const updateField = useCallback((index: number, patch: Partial<SchemaField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }, [fields, onChange]);

  const removeField = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  return (
    <div className="space-y-2">
      <Reorder.Group
        axis="y"
        values={fields}
        onReorder={onChange}
        className="space-y-2"
      >
        <AnimatePresence initial={false}>
          {fields.map((field, index) => (
            <Reorder.Item
              key={`${index}-${field.key || 'new'}`}
              value={field}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-2"
            >
              <div className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground transition-colors">
                <GripVertical className="w-4 h-4" />
              </div>

              <div className="flex-1 grid grid-cols-[1fr_100px_1fr] gap-2">
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder="key"
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/50 font-mono"
                />

                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value })}
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-2 py-1.5 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary/50"
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder="Label"
                  className="w-full rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-primary/50"
                />
              </div>

              <button
                type="button"
                onClick={() => removeField(index)}
                className="p-1 rounded-lg text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>

      <motion.button
        type="button"
        onClick={addField}
        whileTap={{ scale: 0.97 }}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-1 py-1"
      >
        <Plus className="w-3.5 h-3.5" />
        {rt.add_field}
      </motion.button>
    </div>
  );
}
