import { useTranslation } from '@/i18n/useTranslation';
import { useCallback, useEffect, useState } from 'react';
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
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const addField = useCallback(() => {
    onChange([...fields, { key: '', type: 'text', label: '', default: '' }]);
  }, [fields, onChange]);

  const updateField = useCallback((index: number, patch: Partial<SchemaField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }, [fields, onChange]);

  const removeField = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  const isReordering = draggingIndex !== null;

  useEffect(() => {
    if (isReordering) {
      document.body.dataset.dragActive = 'true';
      return () => { delete document.body.dataset.dragActive; };
    }
    return undefined;
  }, [isReordering]);

  return (
    <div
      className="space-y-2 drop-zone-illuminated rounded-card p-1 -m-1"
      data-dragging={isReordering ? 'true' : undefined}
    >
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
              onDragStart={() => setDraggingIndex(index)}
              onDragEnd={() => setDraggingIndex(null)}
              className="relative flex items-center gap-2"
            >
              {isReordering && index !== draggingIndex && (
                <motion.div
                  aria-hidden
                  initial={{ opacity: 0, scaleX: 0.6 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  exit={{ opacity: 0, scaleX: 0.6, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.18 }}
                  className="pointer-events-none absolute -top-[5px] left-6 right-6 h-[2px] rounded-full bg-primary/40"
                  style={{ transformOrigin: 'center' }}
                />
              )}
              <div className="cursor-grab active:cursor-grabbing text-foreground hover:text-muted-foreground transition-colors">
                <GripVertical className="w-4 h-4" />
              </div>

              <div className="flex-1 grid grid-cols-[1fr_100px_1fr] gap-2">
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder="key"
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2.5 py-1.5 typo-code text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 font-mono"
                />

                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value })}
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2 py-1.5 typo-body text-foreground focus-visible:outline-none focus-visible:border-primary/50"
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
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2.5 py-1.5 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50"
                />
              </div>

              <button
                type="button"
                onClick={() => removeField(index)}
                className="p-1 rounded-card text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
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
        className="flex items-center gap-1.5 typo-body text-foreground hover:text-foreground transition-colors px-1 py-1"
      >
        <Plus className="w-3.5 h-3.5" />
        {rt.add_field}
      </motion.button>
    </div>
  );
}
