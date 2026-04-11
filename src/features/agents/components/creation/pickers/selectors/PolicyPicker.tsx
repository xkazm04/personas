import { ShieldAlert, UserCheck } from 'lucide-react';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import { useTranslation } from '@/i18n/useTranslation';
import { ERROR_STRATEGIES, REVIEW_POLICIES } from '../../steps/builder/types';

interface PolicyPickerProps {
  errorStrategy: string;
  reviewPolicy: string;
  onErrorStrategyChange: (value: string) => void;
  onReviewPolicyChange: (value: string) => void;
}

function RadioCardGroup({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: string; label: string; description: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.description}
            className={`px-2.5 py-1.5 text-sm font-medium rounded-xl border transition-all ${
              active
                ? 'bg-primary/12 border-primary/30 text-primary ring-1 ring-primary/20'
                : 'bg-secondary/30 border-primary/20 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/90'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function PolicyPicker({ errorStrategy, reviewPolicy, onErrorStrategyChange, onReviewPolicyChange }: PolicyPickerProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionHeader
          icon={<ShieldAlert className="w-3.5 h-3.5" />}
          label={t.agents.policy_picker.error_handling}
        />
        <RadioCardGroup
          options={ERROR_STRATEGIES}
          value={errorStrategy}
          onChange={onErrorStrategyChange}
        />
      </div>

      <div className="space-y-2">
        <SectionHeader
          icon={<UserCheck className="w-3.5 h-3.5" />}
          label={t.agents.policy_picker.manual_review}
        />
        <RadioCardGroup
          options={REVIEW_POLICIES}
          value={reviewPolicy}
          onChange={onReviewPolicyChange}
        />
      </div>
    </div>
  );
}
