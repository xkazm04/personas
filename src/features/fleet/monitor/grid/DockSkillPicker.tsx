// The dispatch dock's skill picker — the Registry heatmap (Dev Tools → Skills
// → Registry, workspace axis) hosted as a popover ABOVE the console, so a
// skill can be loaded into the composer by pointing at the cell where it is
// installed instead of typing `@project` then `/skill` from memory.
//
// Same component, same model hook, same adoption door as the tab: a filled
// cell PICKS (project + skill land as chips), an empty cell ADOPTS first and
// then picks. Two differences from the tab, both deliberate:
//
//   · Only skills installed SOMEWHERE are rows. The tab lists the whole library
//     because adopting into a fresh project is its job; here a row nobody has
//     installed is a row with nothing to pick.
//   · The skill name is a label, not a pick. It explains itself (the shared
//     tooltip carries the description) and nothing more — it used to load the
//     skill into "the most sensible project", which put a project in the
//     composer that the operator never pointed at.
//
// The registry model is only fetched while this popover is mounted — closed,
// it costs nothing.
import { useCallback, useMemo, useRef, useState } from 'react';
import { LayoutGrid, X } from 'lucide-react';

import { RegistryHeatmap } from '@/features/plugins/dev-tools/sub_skills/registry/RegistryHeatmap';
import { useSkillAdoption } from '@/features/plugins/dev-tools/sub_skills/registry/useSkillAdoption';
import { useSkillsRegistry } from '@/features/plugins/dev-tools/sub_skills/registry/useSkillsRegistry';
import Button from '@/features/shared/components/buttons/Button';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';

export interface DockSkillPickerProps {
  /** The console's current `@project`, if any — resolves which workspace is shown. */
  activeProjectId: string | null;
  onPick: (projectId: string, skill: string) => void;
  onClose: () => void;
}

export function DockSkillPicker({ activeProjectId, onPick, onClose }: DockSkillPickerProps) {
  const { t } = useTranslation();
  const quickT = t.plugins.fleet_quick_dispatch;
  const [tick, setTick] = useState(0);
  const registry = useSkillsRegistry(activeProjectId, tick);
  // Installed-somewhere only (see the header). The count is the model's own,
  // so a skill adopted from inside the picker keeps its row. Memoized on the
  // hook's own memoized list: the dock re-renders on every keystroke.
  const installed = useMemo(() => registry.skills.filter((s) => s.adoptedCount > 0), [registry.skills]);
  const model = { ...registry, skills: installed };
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, true, onClose);

  const pick = useCallback((projectId: string, skill: string) => {
    onPick(projectId, skill);
    onClose();
  }, [onPick, onClose]);

  const onAdopted = useCallback((skill: string, projectId: string) => {
    setTick((n) => n + 1);
    pick(projectId, skill);
  }, [pick]);
  const { adopting, adopt } = useSkillAdoption(onAdopted);
  const use = useCallback((skill: string, projectId: string) => pick(projectId, skill), [pick]);

  return (
    // An anchored popover, not a modal: no scrim, no focus trap, the console
    // under it stays live (tooltip golden path P7 — a surface the user acts
    // inside is a dialog). BaseModal is deliberately not used here, which the
    // enforce-base-modal lint flags at warn level for every anchored popover.
    <div
      ref={ref}
      // eslint-disable-next-line custom/enforce-base-modal
      role="dialog"
      aria-label={quickT.skill_picker_title}
      data-testid="quick-dispatch-skill-picker"
      className="animate-fade-slide-in flex max-h-[min(34rem,62vh)] flex-col overflow-hidden rounded-card border border-border bg-background shadow-elevation-3"
      onKeyDown={(e) => {
        // Escape closes the picker, not the dock beneath it.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      {/* Title band — the app's panel-header language (DevToolsPageHeader,
          AthenaPanel): primary glyph + typo-heading title, the workspace the
          columns come from, the how-to as a caption under it (it used to be
          squeezed onto the title line and truncated mid-sentence), one
          primary/10 hairline. */}
      <div className="flex flex-shrink-0 items-start gap-2.5 border-b border-primary/10 py-2.5 pl-3 pr-1.5">
        <LayoutGrid className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="typo-heading flex-shrink-0 text-foreground">{quickT.skill_picker_title}</h2>
            {registry.header && (
              <span className="typo-label inline-flex min-w-0 items-center gap-1.5 rounded-pill border border-primary/15 bg-secondary/40 px-2 py-0.5 text-foreground">
                <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: registry.header.color }} aria-hidden />
                <span className="truncate">{registry.header.name}</span>
              </span>
            )}
          </div>
          <p className="typo-caption mt-0.5 text-foreground">{quickT.skill_picker_hint}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={quickT.skill_picker_close}
          data-testid="quick-dispatch-skill-picker-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <RegistryHeatmap
          bare
          model={model}
          adopting={adopting}
          onAdopt={adopt}
          onUse={use}
          emptyHint={quickT.skill_picker_empty}
        />
      </div>
    </div>
  );
}
