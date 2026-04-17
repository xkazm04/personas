import { ArrowLeft } from 'lucide-react';
import type { SchemaFormConfig, SchemaSubType } from './schemaFormTypes';

interface SchemaFormHeaderProps {
  config: SchemaFormConfig;
  onBack: () => void;
}

export function SchemaFormHeader({ config, onBack }: SchemaFormHeaderProps) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onBack}
        className="p-1.5 rounded-card hover:bg-secondary/60 text-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      {config.headerIcon}
      <div>
        <h3 className="typo-heading font-semibold text-foreground">{config.title}</h3>
        <p className="typo-body text-foreground">{config.subtitle}</p>
      </div>
    </div>
  );
}

interface SchemaNameFieldProps {
  name: string;
  onNameChange: (name: string) => void;
  nameLabel: string;
  namePlaceholder: string;
  error: string | null;
}

export function SchemaNameField({ name, onNameChange, nameLabel, namePlaceholder, error }: SchemaNameFieldProps) {
  return (
    <div>
      <label className="block typo-body font-medium text-foreground mb-1.5">
        {nameLabel} <span className="text-red-400 ml-1">*</span>
      </label>
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={namePlaceholder}
        aria-invalid={!!error}
        aria-describedby={error ? 'schema-form-error' : undefined}
        data-testid="vault-schema-name"
        className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-modal text-foreground typo-body focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30"
      />
    </div>
  );
}

interface SchemaSubTypeSelectorProps {
  config: SchemaFormConfig;
  subTypeId: string;
  activeSubType: SchemaSubType;
  onSubTypeChange: (id: string) => void;
}

export function SchemaSubTypeSelector({ config, subTypeId, activeSubType, onSubTypeChange }: SchemaSubTypeSelectorProps) {
  if (config.subTypes.length <= 1) return null;

  return (
    <div data-testid="vault-schema-subtype">
      <label className="block typo-heading font-semibold uppercase tracking-wider text-foreground mb-3">
        {config.subTypeLabel}
      </label>

      {config.subTypeLayout === 'flex' ? (
        <>
          <div className="flex gap-2">
            {config.subTypes.map((st) => (
              <button
                key={st.id}
                onClick={() => onSubTypeChange(st.id)}
                className={`flex-1 px-4 py-2.5 rounded-modal typo-body font-medium border transition-all ${
                  subTypeId === st.id
                    ? config.subTypeActiveClass
                    : 'bg-secondary/25 border-primary/15 text-foreground hover:bg-secondary/40'
                }`}
              >
                {st.displayLabel ?? st.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 typo-body text-foreground">{activeSubType.description}</p>
        </>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {config.subTypes.map((st) => (
            <button
              key={st.id}
              onClick={() => onSubTypeChange(st.id)}
              className={`text-left px-3 py-2.5 rounded-modal typo-body border transition-all ${
                subTypeId === st.id
                  ? config.subTypeActiveClass
                  : 'bg-secondary/25 border-primary/15 text-foreground hover:bg-secondary/40'
              }`}
            >
              <div className="font-medium typo-body flex items-center gap-2">
                {st.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />}
                {st.label}
              </div>
              <div className="typo-body text-foreground mt-0.5">{st.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
