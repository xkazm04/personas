// DockPanels — every volatile panel the dock can open, and the single reason
// they are all in one file: NONE OF THEM IS IN DOCUMENT FLOW.
//
// The dock sits at the bottom of a live board. A panel that pushed the dock
// taller would push the board up under the operator's eyes, so the skill
// picker and the typeahead listbox both render absolutely at `bottom-full`,
// opening UPWARD, out of flow. That is the other half of the anti-shake
// contract (the first half is the reserved row heights), and hosting it once
// is what keeps all three variants honest about it: a variant renders this
// component and cannot accidentally put a panel in its own column.

import { QuickDispatchSuggestions } from '@/features/plugins/fleet/quick-dispatch/QuickDispatchSuggestions';

import { DockSkillPicker } from '../DockSkillPicker';
import type { DockConsole } from './useDockConsole';

export function DockPanels({ console: d }: { console: DockConsole }) {
  const { c, showPicker, showSuggestions, typeahead, closePicker } = d;
  return (
    <>
      {showPicker && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1 px-3">
          <DockSkillPicker
            activeProjectId={c.projectChip?.id ?? null}
            onPick={c.pickFromRegistry}
            onClose={closePicker}
          />
        </div>
      )}
      {showSuggestions && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1 px-3">
          <div className="animate-fade-slide-in overflow-hidden rounded-card border border-border bg-background shadow-elevation-3">
            <div className="max-h-[38vh] overflow-y-auto p-1.5">
              <QuickDispatchSuggestions
                listboxId={c.listboxId}
                items={typeahead.items}
                activeIndex={c.activeIndex}
                hint={typeahead.hint}
                onPick={c.pickSuggestion}
                onHoverIndex={c.setActiveIndex}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
