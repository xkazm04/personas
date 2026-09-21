// The dispatch dock's skill picker — the Registry heatmap (Dev Tools → Skills
// → Registry, workspace axis) hosted as a popover ABOVE the console, so a
// skill can be loaded into the composer by pointing at the cell where it is
// installed instead of typing `@project` then `/skill` from memory.
//
// Same component, same model hook, same adoption door as the tab: a filled
// cell PICKS (project + skill land as chips), an empty cell ADOPTS first and
// then picks. Skill names are not a pick — they show the skill description.
// Skills no project has installed are hidden (adopting those is the Registry
// tab's job). The registry model is only fetched while this popover is
// mounted — closed, it costs nothing.
import { useCallback, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { RegistryHeatmap } from './RegistryHeatmap';
import { useSkillAdoption } from '@/features/plugins/dev-tools/sub_skills/registry/useSkillAdoption';
import { useSkillsRegistry } from '@/features/plugins/dev-tools/sub_skills/registry/useSkillsRegistry';
import Button from '@/features/shared/components/buttons/Button';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useTranslation } from '@/i18n/useTranslation';

export interface DockSkillPickerProps {
  /** The console's current `@project` — the registry model keys off it. */
  activeProjectId: string | null;
  onPick: (projectId: string, skill: string) => void;
  onClose: () => void;
}

export function DockSkillPicker({ activeProjectId, onPick, onClose }: DockSkillPickerProps) {
  const { t } = useTranslation();
  const quickT = t.plugins.fleet_quick_dispatch;
  const [tick, setTick] = useState(0);
  const model = useSkillsRegistry(activeProjectId, tick);
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
      className="animate-fade-slide-in flex flex-col overflow-hidden rounded-card border border-primary/12 bg-background shadow-elevation-3"
      onKeyDown={(e) => {
        // Escape closes the picker, not the dock beneath it.
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="relative flex items-center gap-2 border-b border-primary/10 bg-background px-3 py-2 rounded-t-card">
        <span className="pointer-events-none absolute inset-0 bg-primary/5 rounded-t-card" />
        <span className="relative typo-heading text-foreground">{quickT.skill_picker_title}</span>
        <span className="relative min-w-0 flex-1 truncate typo-caption text-foreground">{quickT.skill_picker_hint_hover}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={quickT.skill_picker_close}
          data-testid="quick-dispatch-skill-picker-close"
          className="relative"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
      <div className="h-[min(26rem,50vh)] p-1.5">
        <RegistryHeatmap
          model={model}
          adopting={adopting}
          onAdopt={adopt}
          onUse={(skill, projectId) => pick(projectId, skill)}
          hideUnadopted
        />
      </div>
    </div>
  );
}
