import { PREDEFINED_TEST_CASES } from '../runner/designRunnerConstants';
import { CustomSourceView } from './CustomSourceView';
import { BatchSourceView } from './BatchSourceView';
import type { TemplateSourcePanelProps } from './TemplateSourceTypes';

export type { TemplateSource } from './TemplateSourceTypes';
export type { TemplateSourcePanelProps } from './TemplateSourceTypes';

// ── Predefined variant ───────────────────────────────────────────────────

function PredefinedView() {
  return (
    <div className="text-sm text-muted-foreground/90 space-y-1">
      <p>Runs {PREDEFINED_TEST_CASES.length} predefined use cases through the design engine:</p>
      <ul className="list-disc list-inside text-muted-foreground/80 space-y-0.5 ml-1">
        {PREDEFINED_TEST_CASES.map((tc) => (
          <li key={tc.id}>{tc.name}</li>
        ))}
      </ul>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────

export function TemplateSourcePanel(props: TemplateSourcePanelProps) {
  if (props.mode === 'predefined') return <PredefinedView />;
  if (props.mode === 'custom') return <CustomSourceView {...props} />;
  return <BatchSourceView {...props} />;
}
