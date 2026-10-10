// The page header's action on the selected council: "Open council" when a
// round exists to read, "Run full council" (the shipped consent door,
// DispatchChooser) when only lite rounds or none do. Hidden while a council
// is open: the verdict page carries its own way back.
import { useState } from 'react';
import { BookOpen, Play } from 'lucide-react';

import { getProject } from '@/api/devTools/devTools';
import Button from '@/features/shared/components/buttons/Button';
import { DispatchChooserModal, type DispatchRequest } from '@/features/shared/dispatch/DispatchChooser';
import { buildCouncilDispatch } from '@/features/plugins/dev-tools/sub_context/councilDispatch';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

import { useCouncilStore } from '../councilStore';

export function CouncilCta() {
  const { t } = useTranslation();
  const w = t.council.cta;
  const selectedId = useCouncilStore((s) => s.selectedId);
  const openId = useCouncilStore((s) => s.openId);
  const openCouncil = useCouncilStore((s) => s.openCouncil);
  const subject = useCouncilStore((s) => s.subjects.find((x) => x.id === selectedId) ?? null);
  const fixtureOn = useCouncilStore((s) => s.fixtureOn);
  const [request, setRequest] = useState<DispatchRequest | null>(null);
  if (!subject || openId) return null;

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
          onClick={() => openCouncil(subject.id)}
          data-testid="council-cta-open"
        >
          {w.open}
        </Button>
      ) : null}
      {!hasFull ? (
        <Button
          variant="primary"
          size="sm"
          icon={<Play className="h-4 w-4" />}
          disabled={fixtureOn}
          onClick={() => void runFull().catch(toastCatch('council:run-full'))}
          data-testid="council-cta-run-full"
        >
          {w.run_full}
        </Button>
      ) : null}
      {request ? <DispatchChooserModal request={request} onClose={() => setRequest(null)} /> : null}
    </>
  );
}

export default CouncilCta;
