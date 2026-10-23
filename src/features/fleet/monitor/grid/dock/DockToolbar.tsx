// DockToolbar — the one strip that carries every parameter and every toggle.
//
// The operator's shape rule: "toolbar on top for toggles and param setup
// (model, effort, athena, background, ...)". So the command row below holds
// NOTHING but the objective and the launch, and everything that configures the
// dispatch lives here, in one line, in one visual family.
//
// Two properties this file is responsible for:
//
//   · NO CONTROL SPLITS ITS ICON AND ITS LABEL ACROSS TWO LINES. Every item is
//     a `flex items-center` pill; the one icon-only control (the skill
//     registry door) carries its name in `aria-label` and a tooltip, which is
//     not a split, it is a label that is not drawn.
//   · IT CANNOT CHANGE HEIGHT. The strip scrolls horizontally inside its
//     reserved row rather than wrapping — a wrapped toolbar would be a second
//     line, and a second line at the bottom of a live board moves the board.
//
// `DockPresetSelect` and `RunOnSelect` keep their own triggers: both are
// listbox doors with menus that must open UPWARD out of flow, and both are
// already the dock's shared pill chrome at the same 24px height.

import { Ghost, LayoutGrid } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RunOnSelect } from '@/features/shared/dispatch/RunOnSelect';
import {
  EFFORT_PRESETS,
  MODEL_PRESETS,
} from '@/features/plugins/fleet/quick-dispatch/quickDispatchController';

import { DockAthenaToggle } from '../DockAthenaToggle';
import { DockPresetSelect } from '../DockPresetSelect';
import { DOCK_CHIP, DOCK_CHIP_ON } from './dockChrome';
import type { DockConsole } from './useDockConsole';

export function DockToolbar({ console: d, className = '' }: { console: DockConsole; className?: string }) {
  const { c, pickerOpen, togglePicker, athenaArmed, toggleAthena } = d;

  const formatModel = (m: string | null) =>
    m ? c.tx(c.quickT.model_chip, { model: m }) : c.quickT.model_chip_unset;
  const formatEffort = (e: string | null) =>
    e ? c.tx(c.quickT.effort_chip, { effort: e }) : c.quickT.effort_chip_unset;

  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 overflow-x-auto ${className}`}
      data-testid="quick-dispatch-toolbar"
    >
      <Tooltip content={c.quickT.skill_picker_open} placement="top">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={togglePicker}
          aria-label={c.quickT.skill_picker_open}
          aria-pressed={pickerOpen}
          aria-haspopup="dialog"
          data-testid="quick-dispatch-skill-picker-toggle"
          className={`${DOCK_CHIP} w-7 !px-0 ${pickerOpen ? DOCK_CHIP_ON : ''}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </Tooltip>

      <DockPresetSelect
        presets={MODEL_PRESETS}
        value={c.model}
        onChange={c.setModel}
        format={formatModel}
        ariaLabel={c.quickT.model_chip_unset}
        testId="quick-dispatch-model-chip"
      />
      <DockPresetSelect
        presets={EFFORT_PRESETS}
        value={c.effort}
        onChange={c.setEffort}
        format={formatEffort}
        ariaLabel={c.quickT.effort_chip_unset}
        testId="quick-dispatch-effort-chip"
      />
      {/* Run on another device: renders nothing unless p2p is in this build and
          a device is paired. Opens upward, like the preset menus. */}
      <RunOnSelect value={c.runOn} onChange={c.setRunOn} githubUrl={c.projectRemote} placement="up" />

      <DockAthenaToggle
        armed={athenaArmed}
        onToggle={toggleAthena}
        disabled={c.sending}
        remote={c.runOn !== null}
      />

      <DockHeadlessToggle console={d} />
    </div>
  );
}

/**
 * Where the WORK happens. A switch with a visible track rather than a tinted
 * icon: it was the one control that changed where the work ran, and an icon
 * differing only by tint read as decoration. The shared `Button`, the dock's
 * chip, with track, glyph and label on ONE line. The track and the glyph ride
 * in the Button's `icon` slot as one inline-flex unit: as children they
 * stacked (the primitive wraps children in one inline span, and an inline
 * span cannot hold the track's size, which drew it as a dot).
 */
function DockHeadlessToggle({ console: d }: { console: DockConsole }) {
  const { c } = d;
  return (
    <Tooltip content={c.headless ? c.quickT.headless_toggle_on : c.quickT.headless_toggle_off} placement="top">
      <Button
        variant="ghost"
        size="xs"
        onClick={c.toggleHeadless}
        aria-label={c.quickT.headless_label}
        aria-pressed={c.headless}
        data-testid="quick-dispatch-headless-toggle"
        className={`${DOCK_CHIP} pl-1.5 ${c.headless ? DOCK_CHIP_ON : ''}`}
        icon={
          <span className="inline-flex items-center gap-1.5" aria-hidden>
            <span className={`relative block h-3.5 w-6 rounded-pill transition-colors ${c.headless ? 'bg-primary' : 'bg-foreground/15'}`}>
              <span className={`absolute left-0.5 top-0.5 block h-2.5 w-2.5 rounded-full transition-transform ${
                c.headless ? 'translate-x-2.5 bg-btn-primary-fg' : 'bg-foreground'}`} />
            </span>
            <Ghost className="h-3.5 w-3.5" />
          </span>
        }
      >
        {c.quickT.headless_label}
      </Button>
    </Tooltip>
  );
}
