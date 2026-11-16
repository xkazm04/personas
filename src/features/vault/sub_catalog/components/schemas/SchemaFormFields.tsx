import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { useId } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SchemaFormConfig, SchemaSubType } from './schemaFormTypes';
import Button from '@/features/shared/components/buttons/Button';

interface SchemaFormHeaderProps {
  config: SchemaFormConfig;
  onBack: () => void;
}

export function SchemaFormHeader({ config, onBack }: SchemaFormHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <Button
        type="button"
        onClick={onBack}
        aria-label={t.common.back}
        variant="ghost"
        size="icon-sm"
      >
        <ArrowLeft className="w-4 h-4" />
      </Button>
      {config.headerIcon}
      <div>
        <h3 className="typo-heading text-foreground">{config.title}</h3>
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
  const inputId = useId();
  return (
    <div>
      <label htmlFor={inputId} className="block typo-body text-foreground mb-1.5">
        {nameLabel} <span className="text-status-error ml-1">*</span>
      </label>
      <input
        id={inputId}
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={namePlaceholder}
        aria-invalid={!!error}
        aria-describedby={error ? 'schema-form-error' : undefined}
        data-testid="vault-schema-name"
        className="w-full px-3 py-2 bg-background/50 border border-border/50 rounded-modal text-foreground typo-body focus-ring focus-visible:border-primary/40 transition-all placeholder:text-ink-3"
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
      <label className="block typo-eyebrow text-foreground mb-3">
        {config.subTypeLabel}
      </label>

      {config.subTypeLayout === 'flex' ? (
        <>
          <div className="flex gap-2">
            {config.subTypes.map((st) => (
              <Button
                key={st.id}
                type="button"
                pressed={subTypeId === st.id}
                onClick={() => onSubTypeChange(st.id)}
                variant={subTypeId === st.id ? 'accent' : 'secondary'}
                tone={subTypeId === st.id ? 'highlight' : undefined}
                size="md"
                className="flex-1"
              >
                {st.displayLabel ?? st.label}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 typo-body text-foreground">{activeSubType.description}</p>
        </>
      ) : (
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {config.subTypes.map((st) => (
            <PressSurface key={st.id} selected={subTypeId === st.id} onPress={() => onSubTypeChange(st.id)} className={`px-3 py-2.5 rounded-modal typo-body text-foreground border ${subTypeId === st.id ? 'border-hair-2' : 'border-hair'}`}>
              <div className="typo-body flex items-center gap-2">
                {st.color && <div className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }} />}
                {st.label}
              </div>
              <div className="typo-body text-foreground mt-0.5">{st.description}</div>
            </PressSurface>
          ))}
        </div>
      )}
    </div>
  );
}
