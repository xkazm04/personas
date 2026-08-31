import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaCore } from '@/lib/bindings/PersonaCore';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

interface CoreProseFieldsProps {
  core: PersonaCore;
  onChange: (patch: Partial<PersonaCore>) => void;
}

interface ProseFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testId: string;
  rows?: number;
}

function ProseField({ label, value, onChange, testId, rows = 2 }: ProseFieldProps) {
  return (
    <FormField label={label}>
      {(inputProps) => (
        <textarea
          {...inputProps}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          className={`${INPUT_FIELD} resize-y min-h-[2.5rem]`}
          data-testid={testId}
        />
      )}
    </FormField>
  );
}

/** The five authored-prose fields of the Core (who / why / how it speaks). */
export function CoreProseFields({ core, onChange }: CoreProseFieldsProps) {
  const { t } = useTranslation();
  const life = t.agents.life;
  return (
    <div className="space-y-3">
      <ProseField
        label={life.core_motivation}
        value={core.motivation}
        onChange={(v) => onChange({ motivation: v })}
        testId="life-core-motivation"
      />
      <ProseField
        label={life.core_stance}
        value={core.stance}
        onChange={(v) => onChange({ stance: v })}
        testId="life-core-stance"
      />
      <ProseField
        label={life.core_north_star}
        value={core.northStarCommitment}
        onChange={(v) => onChange({ northStarCommitment: v })}
        testId="life-core-north-star"
      />
      <ProseField
        label={life.core_identity}
        value={core.identity ?? ''}
        onChange={(v) => onChange({ identity: v })}
        testId="life-core-identity"
        rows={3}
      />
      <ProseField
        label={life.core_voice}
        value={core.voice ?? ''}
        onChange={(v) => onChange({ voice: v })}
        testId="life-core-voice"
      />
    </div>
  );
}
