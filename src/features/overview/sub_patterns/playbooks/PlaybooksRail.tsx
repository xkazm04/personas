// Playbooks rail host — owns the playbook data plane (rows, memberships,
// pattern edges, consult telemetry) and the create modal. Extracted from the
// retired topic-graph host so the rail survives the graph: playbooks are a
// live backend feature and need a curator surface regardless of which sky
// renders the library. Mounted by KnowledgeLibrary as an overlay next to the
// tree; every missing backend command degrades to an empty rail, never an
// interruption.
import { useEffect, useMemo, useState } from 'react';

import {
  deletePlaybook,
  getConsultStats,
  listPatternEdges,
  listPlaybookPatterns,
  listPlaybooks,
  setPlaybookPatterns,
  setPlaybookStatus,
  type ConsultStats,
} from '@/api/devTools/workspaces';
import type { WorkspacePatternEdge } from '@/lib/bindings/WorkspacePatternEdge';
import type { WorkspacePlaybook } from '@/lib/bindings/WorkspacePlaybook';
import type { WorkspacePlaybookPattern } from '@/lib/bindings/WorkspacePlaybookPattern';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import type { KnowledgeItemView } from '../libraryModel';
import { CreatePlaybookModal } from './CreatePlaybookModal';
import { PlaybooksPanel } from './PlaybooksPanel';

export function PlaybooksRail({
  workspaceId,
  items,
  onOpenItem,
  onClose,
}: {
  workspaceId: string;
  items: readonly KnowledgeItemView[];
  onOpenItem?: (item: KnowledgeItemView) => void;
  onClose: () => void;
}) {
  // Playbooks (fabric S3). Missing commands degrade to an empty rail.
  const [playbooks, setPlaybooks] = useState<WorkspacePlaybook[]>([]);
  const [playbookMembers, setPlaybookMembers] = useState<WorkspacePlaybookPattern[]>([]);
  const [playbooksGen, setPlaybooksGen] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let live = true;
    void playbooksGen;
    Promise.all([listPlaybooks(workspaceId), listPlaybookPatterns(workspaceId)])
      .then(([pbs, mems]) => {
        if (live) {
          setPlaybooks(pbs);
          setPlaybookMembers(mems);
        }
      })
      .catch((err) => {
        silentCatch('patterns:playbooks')(err);
        if (live) {
          setPlaybooks([]);
          setPlaybookMembers([]);
        }
      });
    return () => { live = false; };
  }, [workspaceId, playbooksGen]);

  // Pattern connections (fabric S2) — the source of replacement/addition
  // suggestions. Missing command (pre-rebuild binary) degrades to none.
  const [edges, setEdges] = useState<WorkspacePatternEdge[]>([]);
  useEffect(() => {
    let live = true;
    listPatternEdges(workspaceId)
      .then((rows) => { if (live) setEdges(rows); })
      .catch((err) => {
        silentCatch('patterns:edges')(err);
        if (live) setEdges([]);
      });
    return () => { live = false; };
  }, [workspaceId, items]);

  // Consult telemetry (how often the CLI reached each playbook, and what it
  // could not match). A binary without the command degrades to no counts.
  const [consultStats, setConsultStats] = useState<ConsultStats | null>(null);
  useEffect(() => {
    let live = true;
    getConsultStats(workspaceId)
      .then((s) => { if (live) setConsultStats(s); })
      .catch((err) => {
        silentCatch('patterns:consultStats')(err);
        if (live) setConsultStats(null);
      });
    return () => { live = false; };
  }, [workspaceId, playbooksGen]);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const edgeLikes = useMemo(
    () => edges.map((e) => ({ fromId: e.fromId, toId: e.toId, rel: e.rel, note: e.note })),
    [edges],
  );
  // Only adopted patterns are live doctrine — the create picker offers canon.
  const candidates = useMemo(() => items.filter((i) => i.status === 'adopted'), [items]);

  return (
    <>
      <PlaybooksPanel
        playbooks={playbooks}
        members={playbookMembers}
        itemById={itemById}
        edges={edgeLikes}
        consultStats={consultStats}
        onCreate={() => setCreating(true)}
        onSetStatus={(id, status) => {
          setPlaybookStatus(id, status)
            .then(() => setPlaybooksGen((g) => g + 1))
            .catch(toastCatch('workspaces:playbookStatus'));
        }}
        onDelete={(id) => {
          deletePlaybook(id)
            .then(() => setPlaybooksGen((g) => g + 1))
            .catch(toastCatch('workspaces:playbookDelete'));
        }}
        onPrune={(id, survivors) => {
          setPlaybookPatterns(id, survivors)
            .then(() => setPlaybooksGen((g) => g + 1))
            .catch(toastCatch('workspaces:playbookPrune'));
        }}
        onOpenItem={onOpenItem}
        onClose={onClose}
      />

      {creating && (
        <CreatePlaybookModal
          workspaceId={workspaceId}
          candidates={candidates}
          onCreated={() => setPlaybooksGen((g) => g + 1)}
          onClose={() => setCreating(false)}
        />
      )}
    </>
  );
}
