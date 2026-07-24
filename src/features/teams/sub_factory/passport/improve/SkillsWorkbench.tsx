// Unified Skills Workbench — the SINGLE skills surface shared by the Passport
// wall (opened from the skills cell) and the Mastermind canvas (green Skills
// cell). Same typography, same panes, same operations from both entry points:
//   · Manage  → adopt from library / share to library  (Passport lane)
//   · Dispatch → run an installed skill via Fleet       (Mastermind lane)
// `initialMode` lets each entry point land on its natural lane. Fixed height so
// the modal never resizes as the user switches lanes or selects skills.
//
// ── PROTOTYPE SCAFFOLD (/prototype, throwaway) ──────────────────────────────
// Two directional variants behind a tab switcher — pick a winner, then this
// host renders it directly (switcher + loser deleted).
//   · Console — persistent [Manage · Dispatch] header, no landing step
//   · Atrium  — a landing chooser (Manage vs Dispatch) → workbench + breadcrumb
import { useState } from 'react';

import { BaseModal } from '@/features/shared/components/modals';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { useSkillsWorkbench, type WorkbenchMode } from './skillsWorkbenchData';
import { SkillsWorkbenchConsole } from './SkillsWorkbenchConsole';
import { SkillsWorkbenchAtrium } from './SkillsWorkbenchAtrium';

type VariantId = 'console' | 'atrium';

export function SkillsWorkbench({ slug, initialMode = 'manage', onClose }: {
  slug: string;
  /** Entry-point lane: Passport opens on 'manage', Mastermind on 'dispatch'. */
  initialMode?: WorkbenchMode;
  onClose: () => void;
}) {
  const [variant, setVariant] = useState<VariantId>('console');
  const wb = useSkillsWorkbench(slug);
  if (!wb) return null;

  return (
    <BaseModal isOpen onClose={onClose} titleId="skills-workbench-title" size="lg" portal staggerChildren={false}>
      <span id="skills-workbench-title" className="sr-only">Skills — {wb.projectName}</span>
      {/* throwaway A/B switcher */}
      <div className="flex justify-center pt-2.5 pb-1">
        <SegmentedTabs
          tabs={[{ id: 'console', label: 'Console' }, { id: 'atrium', label: 'Atrium' }]}
          activeTab={variant}
          onTabChange={setVariant}
          variant="segment"
          size="sm"
          fullWidth={false}
          ariaLabel="Workbench variant"
        />
      </div>
      {variant === 'console'
        ? <SkillsWorkbenchConsole wb={wb} initialMode={initialMode} />
        : <SkillsWorkbenchAtrium wb={wb} />}
    </BaseModal>
  );
}
