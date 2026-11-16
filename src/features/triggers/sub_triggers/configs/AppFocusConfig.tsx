import { Plus, X } from 'lucide-react';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import Button from '@/features/shared/components/buttons/Button';

export interface AppFocusConfigProps {
  appNames: string[];
  setAppNames: (v: string[]) => void;
  titlePattern: string;
  setTitlePattern: (v: string) => void;
  appFocusInterval: string;
  setAppFocusInterval: (v: string) => void;
}

export function AppFocusConfig({
  appNames, setAppNames, titlePattern, setTitlePattern,
  appFocusInterval, setAppFocusInterval,
}: AppFocusConfigProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <TriggerFieldGroup
        label={t.triggers.app_focus.app_names_label}
        optional
        helpText={t.triggers.app_names_help}
      >
        {appNames.map((name, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => {
                const updated = [...appNames];
                updated[i] = e.target.value;
                setAppNames(updated);
              }}
              placeholder={t.triggers.app_focus_process_placeholder}
              className="flex-1 px-3 py-2 bg-background/50 border border-hair rounded-modal text-ink-1 typo-code placeholder-ink-3 focus-ring transition-all"
            />
            {appNames.length > 1 && (
              <Button
                type="button"
                onClick={() => setAppNames(appNames.filter((_, j) => j !== i))}
                variant="ghost"
                size="icon-sm"
                icon={<X className="w-3.5 h-3.5" />}
              />
            )}
          </div>
        ))}
        <Button
          type="button"
          onClick={() => setAppNames([...appNames, ''])}
          variant="ghost"
          size="sm"
          icon={<Plus className="w-3.5 h-3.5" />}
        >{t.triggers.app_focus.add_app}</Button>
      </TriggerFieldGroup>
      <TriggerFieldGroup
        label={<>{t.triggers.window_title_pattern_label} <span className="text-ink-1">{t.triggers.optional_regex_label}</span></>}
      >
        <input
          type="text"
          value={titlePattern}
          onChange={(e) => setTitlePattern(e.target.value)}
          placeholder={t.triggers.app_focus_window_placeholder}
          className="w-full px-3 py-2 bg-background/50 border border-hair rounded-modal text-ink-1 typo-code placeholder-ink-3 focus-ring transition-all"
        />
      </TriggerFieldGroup>
      <TriggerFieldGroup label={t.triggers.poll_interval_label}>
        <NumberStepper
          value={appFocusInterval.trim() === '' ? null : Number(appFocusInterval)}
          onChange={(v) => setAppFocusInterval(v == null ? '' : String(v))}
          min={2}
          allowEmpty
          ariaLabel={t.triggers.poll_interval_label}
          className="w-24"
        />
      </TriggerFieldGroup>
    </div>
  );
}
