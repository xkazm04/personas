import { useCallback } from 'react';
import {
  Bot, FolderKanban, GitBranch, Download, CheckCircle2,
  AlertCircle, Sparkles,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useDevCloneAdoption } from '../useDevCloneAdoption';

interface DevCloneAdoptionCardProps {
  onAdopted: () => void;
  activeProjectName: string | null;
  activeProjectHasGithub: boolean;
  activeProjectRootPath: string | null;
}

export function DevCloneAdoptionCard({
  onAdopted,
  activeProjectName,
  activeProjectHasGithub,
  activeProjectRootPath,
}: DevCloneAdoptionCardProps) {
  const { adoptDevClone, adopting } = useDevCloneAdoption();

  const handleAdopt = useCallback(async () => {
    const persona = await adoptDevClone();
    if (persona) onAdopted();
  }, [adoptDevClone, onAdopted]);

  return (
    <div className="rounded-card border border-primary/15 bg-gradient-to-br from-violet-500/8 via-primary/5 to-transparent p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-card bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
          <Bot className="w-6 h-6 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-section-title">
            Adopt Dev Clone
          </h3>
          <p className="typo-body text-foreground mt-1">
            Dev Clone is an autonomous developer persona bundled with Personas.
            It scans your codebase every hour, proposes tasks for review, and builds
            on approval. Adopting creates the persona, registers tools, and wires triggers.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-5">
        <PrereqRow icon={FolderKanban} ok={Boolean(activeProjectName)}
          title="Dev project" value={activeProjectName ?? 'none selected'}
          hint={activeProjectRootPath ?? undefined} />
        <PrereqRow icon={GitBranch} ok={activeProjectHasGithub}
          title="GitHub repo" value={activeProjectHasGithub ? 'linked' : 'not linked'}
          hint={activeProjectHasGithub ? undefined : 'Needed for PR workflows'} />
        <PrereqRow icon={Download} ok title="Dev Clone template" value="bundled" />
      </div>

      <div className="flex items-center gap-3">
        <Button variant="accent" accentColor="violet" size="md"
          icon={<Sparkles className="w-4 h-4" />} loading={adopting}
          disabled={!activeProjectName}
          disabledReason={!activeProjectName ? 'Select a project first' : undefined}
          onClick={handleAdopt}
        >
          Adopt Dev Clone
        </Button>
        {!activeProjectHasGithub && activeProjectName && (
          <p className="typo-caption text-foreground">
            You can still adopt now — add GitHub URL later.
          </p>
        )}
      </div>
    </div>
  );
}

function PrereqRow({ icon: Icon, ok, title, value, hint }: {
  icon: typeof FolderKanban; ok: boolean; title: string; value: string; hint?: string;
}) {
  return (
    <div className={`rounded-interactive border p-3 ${
      ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/25 bg-amber-500/5'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${ok ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className="typo-caption text-foreground">{title}</span>
        {ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
             : <AlertCircle className="w-3.5 h-3.5 text-amber-400 ml-auto" />}
      </div>
      <p className="typo-body text-foreground truncate">{value}</p>
      {hint && <p className="typo-caption text-foreground truncate mt-0.5">{hint}</p>}
    </div>
  );
}
