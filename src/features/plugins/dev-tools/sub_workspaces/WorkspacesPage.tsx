// Workspaces module — Workspace Knowledge Center
// (docs/plans/workspace-knowledge-center.md).
//
// /prototype ROUND A — module shell. Three directional variants behind a
// throwaway switcher; the winner (or fusion) consolidates and the switcher is
// removed. Strings hardcoded-EN until consolidation.
//
//   Rail    — navigator master-detail: workspace rail left, full record right
//   Atlas   — portfolio map: card grid of workspace crests, detail unfolds below
//   Cockpit — single active org: chip strip + identity band, app-wide scope
import { useState } from 'react';
import { Landmark } from 'lucide-react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import WorkspacesRail from './WorkspacesRail';
import WorkspacesAtlas from './WorkspacesAtlas';
import WorkspacesCockpit from './WorkspacesCockpit';

type ShellVariant = 'rail' | 'atlas' | 'cockpit';

const VARIANT_TABS: { id: ShellVariant; label: string }[] = [
  { id: 'rail', label: 'Rail' },
  { id: 'atlas', label: 'Atlas' },
  { id: 'cockpit', label: 'Cockpit' },
];

export default function WorkspacesPage() {
  const [variant, setVariant] = useState<ShellVariant>('rail');

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Landmark className="w-5 h-5 text-primary" />
          <h1 className="typo-heading text-foreground">Workspaces</h1>
        </div>
        <SegmentedTabs
          tabs={VARIANT_TABS}
          activeTab={variant}
          onTabChange={setVariant}
          variant="segment"
          size="sm"
          ariaLabel="Shell variant"
        />
      </div>
      {variant === 'rail' && <WorkspacesRail />}
      {variant === 'atlas' && <WorkspacesAtlas />}
      {variant === 'cockpit' && <WorkspacesCockpit />}
    </div>
  );
}
