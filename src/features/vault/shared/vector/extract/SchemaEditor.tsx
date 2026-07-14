import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { KbExtractionSchema } from '@/api/vault/database/vectorKb';

interface SchemaEditorProps {
  schema: KbExtractionSchema;
  onChange: (next: KbExtractionSchema) => void;
}

/**
 * The review gate between the two extraction passes: an editable view of the
 * inferred schema. The user removes entity types they don't want and tweaks
 * fields before the expensive extraction runs — the whole reason the schema is
 * inferred rather than applied blindly.
 */
export function SchemaEditor({ schema, onChange }: SchemaEditorProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;

  const setEntities = (entities: KbExtractionSchema['entities']) => onChange({ entities });

  return (
    <div className="space-y-3">
      {schema.entities.map((entity, ei) => (
        <div key={ei} className="rounded-card border border-border/40 bg-secondary/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={entity.entityType}
              onChange={(e) => {
                const next = [...schema.entities];
                next[ei] = { ...entity, entityType: e.target.value };
                setEntities(next);
              }}
              placeholder={sh.extract_entity_type_ph}
              className="font-mono typo-code text-violet-400/90 bg-background/50 border border-primary/15 rounded-input px-2 py-1 w-48 focus-visible:outline-none focus-visible:border-primary/40"
            />
            <input
              value={entity.description}
              onChange={(e) => {
                const next = [...schema.entities];
                next[ei] = { ...entity, description: e.target.value };
                setEntities(next);
              }}
              placeholder={sh.extract_entity_desc_ph}
              className="flex-1 typo-body text-foreground bg-background/50 border border-primary/15 rounded-input px-2 py-1 focus-visible:outline-none focus-visible:border-primary/40"
            />
            <button
              onClick={() => setEntities(schema.entities.filter((_, i) => i !== ei))}
              className="p-1.5 rounded-card text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title={sh.extract_remove}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="pl-4 space-y-1.5">
            {entity.fields.map((field, fi) => (
              <div key={fi} className="flex items-center gap-2">
                <input
                  value={field.name}
                  onChange={(e) => {
                    const next = [...schema.entities];
                    const fields = [...entity.fields];
                    fields[fi] = { ...field, name: e.target.value };
                    next[ei] = { ...entity, fields };
                    setEntities(next);
                  }}
                  placeholder={sh.extract_field_name_ph}
                  className="font-mono typo-code text-foreground bg-background/50 border border-primary/15 rounded-input px-2 py-0.5 w-40 focus-visible:outline-none focus-visible:border-primary/40"
                />
                <input
                  value={field.description}
                  onChange={(e) => {
                    const next = [...schema.entities];
                    const fields = [...entity.fields];
                    fields[fi] = { ...field, description: e.target.value };
                    next[ei] = { ...entity, fields };
                    setEntities(next);
                  }}
                  placeholder={sh.extract_field_desc_ph}
                  className="flex-1 typo-caption text-foreground bg-background/50 border border-primary/15 rounded-input px-2 py-0.5 focus-visible:outline-none focus-visible:border-primary/40"
                />
                <button
                  onClick={() => {
                    const next = [...schema.entities];
                    next[ei] = { ...entity, fields: entity.fields.filter((_, i) => i !== fi) };
                    setEntities(next);
                  }}
                  className="p-1 rounded-card text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title={sh.extract_remove}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const next = [...schema.entities];
                next[ei] = { ...entity, fields: [...entity.fields, { name: '', description: '' }] };
                setEntities(next);
              }}
              className="inline-flex items-center gap-1 typo-caption text-violet-400/70 hover:text-violet-400 transition-colors"
            >
              <Plus className="w-3 h-3" /> {sh.extract_add_field}
            </button>
          </div>
        </div>
      ))}

      <button
        onClick={() => setEntities([...schema.entities, { entityType: '', description: '', fields: [] }])}
        className="inline-flex items-center gap-1.5 typo-body text-violet-400/80 hover:text-violet-400 transition-colors"
      >
        <Plus className="w-4 h-4" /> {sh.extract_add_entity}
      </button>
    </div>
  );
}
