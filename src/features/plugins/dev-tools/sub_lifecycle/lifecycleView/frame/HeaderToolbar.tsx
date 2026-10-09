// The header's ONE action cluster, on its own row under the title (the app's
// header-toolbar recipe): scope first (the project picker), then what you can
// do to the practice - Measure, the Overseer hand-off, Ask Athena - and last
// the one conditional control, Install, so appearing moves nothing.
//
// Every always-present control renders from first paint at its final size,
// disabled until the snapshot is in; what a control says (a result, a refusal,
// the install running) is a note line that wraps BELOW the row
// (`NOTE_LINE`), so a message never moves a control.
import { memo } from 'react';
import { Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';

import { LifecycleProjectPicker } from '../../LifecycleProjectPicker';
import { InstallControl } from '../blocks/InstallControl';
import { MeasureControl } from '../blocks/MeasureControl';
import { OverseerControls } from '../blocks/OverseerControls';
import { useLifecycleViewModel } from '../context';
import { LC_RULE } from '../system/lcSurface';
import { GLYPH } from '../system/scales';

/** Memoised (no props): it re-renders on the view model, never because the page's shell did. */
export const HeaderToolbar = memo(function HeaderToolbar() {
  const { dl, projectId, projectName, snapshot, askAthena } = useLifecycleViewModel();
  return (
    <div className={`flex flex-wrap items-center gap-2 border-t px-5 py-2.5 ${LC_RULE}`} data-testid="lc-header-cluster">
      <LifecycleProjectPicker />
      <span aria-hidden className="mx-1 h-6 w-px bg-primary/15" />
      <MeasureControl />
      <OverseerControls
        projectId={projectId}
        watched={snapshot?.watched ?? false}
        goal={snapshot?.goal ?? null}
        disabled={!snapshot}
      />
      <Button
        variant="accent"
        tone="agent"
        size="sm"
        icon={<Sparkles className={GLYPH.sm} />}
        onClick={askAthena}
        disabled={!projectName}
        data-testid="lc-ask-athena"
      >
        {dl.lc_ask_athena}
      </Button>
      <InstallControl />
    </div>
  );
});
