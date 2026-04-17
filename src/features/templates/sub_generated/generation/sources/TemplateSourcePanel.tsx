import { PREDEFINED_TEST_CASES } from '../runner/designRunnerConstants';
import { CustomSourceView } from './CustomSourceView';
import { BatchSourceView } from './BatchSourceView';
import type { TemplateSourcePanelProps } from './TemplateSourceTypes';
import { useTranslation } from '@/i18n/useTranslation';

export type { TemplateSource } from './TemplateSourceTypes';
export type { TemplateSourcePanelProps } from './TemplateSourceTypes';

// -- Predefined variant ---------------------------------------------------

function PredefinedView() {
  const { t } = useTranslation();
  return (
    <div className="typo-body text-foreground space-y-1">
      <p>{t.templates.generation.predefined_intro.replace('{count}', String(PREDEFINED_TEST_CASES.length))}</p>
      <ul className="list-disc list-inside text-foreground space-y-0.5 ml-1">
        {PREDEFINED_TEST_CASES.map((tc) => (
          <li key={tc.id}>{tc.name}</li>
        ))}
      </ul>
    </div>
  );
}

// -- Component ------------------------------------------------------------

export function TemplateSourcePanel(props: TemplateSourcePanelProps) {
  if (props.mode === 'predefined') return <PredefinedView />;
  if (props.mode === 'custom') return <CustomSourceView {...props} />;
  return <BatchSourceView {...props} />;
}
