import type { ReactNode } from 'react';
import { useAppSetting } from '@/hooks/utility/useAppSetting';
import { SaveConfigButton } from './SaveConfigButton';

export interface ProviderFieldConfig {
  settingKey: string;
  placeholder: string;
  type?: 'text' | 'password';
}

interface ProviderCredentialFieldProps {
  label: string;
  sublabel?: string;
  field1: ProviderFieldConfig;
  /** Optional second field rendered below field1. */
  field2?: ProviderFieldConfig;
  saveLabel?: string;
  description?: ReactNode;
  /** Extra classes applied to the root container (e.g. tinted border). */
  containerClassName?: string;
}

const INPUT_CLASS =
  'px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all';

export function ProviderCredentialField({
  label,
  sublabel,
  field1,
  field2,
  saveLabel = 'Save',
  description,
  containerClassName,
}: ProviderCredentialFieldProps) {
  const f1 = useAppSetting(field1.settingKey);
  // Always call — hook is a no-op when field2 is absent (empty key returns null gracefully)
  const f2 = useAppSetting(field2?.settingKey ?? '');

  if (!f1.loaded || (field2 && !f2.loaded)) return null;

  const handleSave = async () => {
    await f1.save();
    if (field2) await f2.save();
  };

  const hasValue = f1.value.trim() || (field2 ? f2.value.trim() : '');
  const isSaved = f1.saved && (!field2 || f2.saved);

  return (
    <div className={`space-y-1.5 ${containerClassName ?? ''}`}>
      <label className="block text-sm font-medium text-foreground/80 mb-1">
        {label}
        {sublabel && (
          <span className="text-muted-foreground/80 font-normal ml-1">{sublabel}</span>
        )}
      </label>

      {field2 ? (
        <div className="space-y-2">
          <input
            type={field1.type ?? 'text'}
            value={f1.value}
            onChange={(e) => f1.setValue(e.target.value)}
            placeholder={field1.placeholder}
            className={`w-full ${INPUT_CLASS}`}
          />
          <input
            type={field2.type ?? 'text'}
            value={f2.value}
            onChange={(e) => f2.setValue(e.target.value)}
            placeholder={field2.placeholder}
            className={`w-full ${INPUT_CLASS}`}
          />
          <SaveConfigButton onClick={handleSave} disabled={!hasValue} saved={isSaved} label={saveLabel} />
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            type={field1.type ?? 'text'}
            value={f1.value}
            onChange={(e) => f1.setValue(e.target.value)}
            placeholder={field1.placeholder}
            className={`flex-1 ${INPUT_CLASS}`}
          />
          <SaveConfigButton onClick={handleSave} disabled={!f1.value.trim()} saved={isSaved} label={saveLabel} />
        </div>
      )}

      {description && (
        <p className="text-sm text-muted-foreground/80">{description}</p>
      )}
    </div>
  );
}
