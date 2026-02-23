import { PREDEFINED_TEST_CASES } from './designRunnerConstants';

export function PredefinedModePanel() {
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
