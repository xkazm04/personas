// PROTOTYPE ROUND (spark council-readout). The page header's share of the
// new flow: the two dev-only direction switches, and the CTA a selected row
// arms - "Open council" when a full round exists, "Run full council" (the
// shipped consent door, DispatchChooser) when only lite rounds or none do.
import { useState } from 'react';
import { BookOpen, Play } from 'lucide-react';

import { getProject } from '@/api/devTools/devTools';
import Button from '@/features/shared/components/buttons/Button';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { buildCouncilDispatch } from '@/features/plugins/dev-tools/sub_context/councilDispatch';
import { toastCatch } from '@/lib/silentCatch';

import { useCouncilStore } from '../councilStore';
import { IS_DEV } from '../galaxy/fixture';
import { PROTO } from './protoStrings';
import { useProtoStore } from './protoStore';
import { PAGE_VARIANTS, PANEL_VARIANTS, useProtoVariant, type PageVariant, type PanelVariant } from './protoVariant';

export function ProtoSwitches() {
  const { panel, page, setPanel, setPage } = useProtoVariant();
  if (!IS_DEV) return null;
  return (
    <>
      <SegmentedTabs<PanelVariant>
        tabs={PANEL_VARIANTS.map((id) => ({ id, label: PROTO.panelVariant[id], testId: `council-proto-panel-${id}` }))}
        activeTab={panel}
        onTabChange={setPanel}
        ariaLabel={PROTO.panelSwitch}
        idPrefix="council-proto-panel"
        size="sm"
        fullWidth={false}
      />
      <SegmentedTabs<PageVariant>
        tabs={PAGE_VARIANTS.map((id) => ({ id, label: PROTO.pageVariant[id], testId: `council-proto-page-${id}` }))}
        activeTab={page}
        onTabChange={setPage}
        ariaLabel={PROTO.pageSwitch}
        idPrefix="council-proto-page"
        size="sm"
        fullWidth={false}
      />
    </>
  );
}

export function ProtoCta() {
  const selectedId = useProtoStore((s) => s.selectedId);
  const openId = useProtoStore((s) => s.openId);
  const open = useProtoStore((s) => s.open);
  const page = useProtoVariant((s) => s.page);
  const subject = useCouncilStore((s) => s.subjects.find((x) => x.id === selectedId) ?? null);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  if (!subject || openId) return null;

  const openCouncil = () => {
    if (page === 'current') {
      const s = useCouncilStore.getState();
      s.setBenchOpen(true);
      s.setTableSubject(subject.id);
      return;
    }
    open(subject.id);
  };

  const runFull = async () => {
    const project = await getProject(subject.projectId);
    setRequest(
      buildCouncilDispatch({
        target: { projectId: project.id, projectName: project.name, rootPath: project.root_path },
        slug: subject.slug,
        featureName: subject.title,
        // A lite-only subject has no FULL round on record: this asks for full round 1.
        roundNo: subject.mode === 'full' ? subject.roundNo : null,
      }),
    );
  };

  const hasFull = subject.mode === 'full' && subject.latestRunId !== null;
  return (
    <>
      {subject.latestRunId ? (
        <Button
          variant={hasFull ? 'primary' : 'ghost'}
          size="sm"
          icon={<BookOpen className="h-4 w-4" />}
          onClick={openCouncil}
          data-testid="council-proto-open"
        >
          {PROTO.openCouncil}
        </Button>
      ) : null}
      {!hasFull ? (
        <Button
          variant="primary"
          size="sm"
          icon={<Play className="h-4 w-4" />}
          disabled={fixtureOn}
          onClick={() => void runFull().catch(toastCatch('council:run-full'))}
          data-testid="council-proto-run-full"
        >
          {PROTO.runFullCouncil}
        </Button>
      ) : null}
      {request ? <DispatchChooserModal request={request} onClose={() => setRequest(null)} /> : null}
    </>
  );
}
