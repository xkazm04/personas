// "Run a skill" modal — opens from a GREEN Skills cell on the Mastermind
// canvas. Lists the project's installed skills and dispatches one as a
// background Fleet run (`/skill args` via spawnSession), staying on the canvas.
//
// ── PROTOTYPE SCAFFOLD (/prototype, throwaway) ──────────────────────────────
// Two directional variants behind a tab switcher — pick a winner, then this
// host collapses to render it directly (switcher + loser deleted).
//   · Launcher — command-palette: filterable single-column list + inline strip
//   · Composer — two-pane: skill deck + terminal-styled compose panel
import { useState } from 'react';

import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { useProjectSkills } from './skillRun';
import { SkillRunModalLauncher } from './SkillRunModalLauncher';
import { SkillRunModalComposer } from './SkillRunModalComposer';

type VariantId = 'launcher' | 'composer';

export function SkillRunModal({ slug, name, onRun, onClose }: {
  slug: string;
  name: string;
  onRun: (skill: string, args: string) => Promise<void>;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<VariantId>('launcher');
  // Fetched once at the host so switching variants doesn't refetch.
  const state = useProjectSkills(slug);
  const Body = variant === 'launcher' ? SkillRunModalLauncher : SkillRunModalComposer;

  return (
    <BaseModal isOpen onClose={onClose} titleId="mm-skillrun-title" size="lg" portal staggerChildren={false}>
      <span id="mm-skillrun-title" className="sr-only">Run a skill</span>
      {/* throwaway A/B switcher */}
      <div className="flex justify-center px-4 pt-3 pb-1">
        <SegmentedTabs
          tabs={[{ id: 'launcher', label: 'Launcher' }, { id: 'composer', label: 'Composer' }]}
          activeTab={variant}
          onTabChange={setVariant}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Run-a-skill variant"
        />
      </div>
      <Body name={name} state={state} onRun={onRun} onClose={onClose} />
    </BaseModal>
  );
}
