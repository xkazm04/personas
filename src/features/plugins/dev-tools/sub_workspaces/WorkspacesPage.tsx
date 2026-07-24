// Workspaces module — Workspace Knowledge Center
// (docs/plans/workspace-knowledge-center.md).
//
// Shell: ATLAS (round-A winner — portfolio map, detail band unfolds under the
// selected crest). Round B (knowledge library presentation) is live inside
// the detail band behind its own variant switcher. Strings hardcoded-EN until
// consolidation.
import { Landmark } from 'lucide-react';

import WorkspacesAtlas from './WorkspacesAtlas';

export default function WorkspacesPage() {
  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-6 pt-5 pb-3 border-b border-primary/10">
        <Landmark className="w-5 h-5 text-primary" />
        <h1 className="typo-heading text-foreground">Workspaces</h1>
      </div>
      <WorkspacesAtlas />
    </div>
  );
}
