import { useState, useMemo } from 'react';
import { Lightbulb, Sparkles, Loader2, Check, X as XIcon, RotateCcw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { ResearchLabFormModal } from '../_shared/ResearchLabFormModal';
import { SelectField, TextAreaField } from '../_shared/FormField';
import { runPersonaAndWait } from '../_shared/runPersona';
import { parseHypothesesOutput } from './parseHypotheses';
import type { ResearchProject } from '@/api/researchLab/researchLab';

interface Props {
  project: ResearchProject;
  onClose: () => void;
}

interface Candidate {
  text: string;
  selected: boolean;
}

function buildPrompt(project: ResearchProject, sourceTitles: string[], instructions: string): string {
  const lines: string[] = [
    `You are a research assistant helping a scientist generate testable hypotheses.`,
    `Project: ${project.name}`,
    project.domain ? `Domain: ${project.domain}` : '',
    project.thesis ? `Central question: ${project.thesis}` : '',
    project.description ? `Context: ${project.description}` : '',
    '',
    `Available sources (${sourceTitles.length}):`,
    sourceTitles.slice(0, 50).map((t) => `- ${t}`).join('\n') || '_No sources indexed yet._',
    '',
    instructions || 'Generate 5 distinct, testable hypotheses that would advance this research. Each hypothesis should be a single declarative sentence that can be falsified.',
    '',
    'Return ONLY a numbered list, one hypothesis per line, no commentary.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

export default function GenerateHypothesesModal({ project, onClose }: Props) {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const sources = useSystemStore((s) => s.researchSources);
  const createHypothesis = useSystemStore((s) => s.createResearchHypothesis);
  const addToast = useToastStore((s) => s.addToast);

  const [personaId, setPersonaId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const personaOptions = useMemo(() => {
    const sorted = [...personas].sort((a, b) => a.name.localeCompare(b.name));
    return [
      { value: '', label: '—' },
      ...sorted.map((p) => ({ value: p.id, label: p.name })),
    ];
  }, [personas]);

  const projectSources = useMemo(
    () => sources.filter((s) => s.projectId === project.id),
    [sources, project.id],
  );

  const persona = personas.find((p) => p.id === personaId);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personaId) return;
    setBusy(true);
    setStatus('running');
    try {
      const prompt = buildPrompt(project, projectSources.map((s) => s.title), instructions);
      const { output, passed } = await runPersonaAndWait({
        personaId,
        input: prompt,
        onStatus: (s) => setStatus(s),
      });
      if (!passed || !output) {
        addToast('Generation did not complete', 'error');
        return;
      }
      const statements = parseHypothesesOutput(output);
      if (statements.length === 0) {
        addToast('No hypotheses parsed from output', 'error');
        return;
      }
      setCandidates(statements.slice(0, 20).map((text) => ({ text, selected: true })));
    } catch (err) {
      toastCatch("GenerateHypotheses:run")(err);
    } finally {
      setBusy(false);
      setStatus('');
    }
  };

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!candidates) return;
    const picks = candidates.filter((c) => c.selected && c.text.trim().length > 0);
    if (picks.length === 0) return;

    setBusy(true);
    let created = 0;
    try {
      for (const c of picks) {
        try {
          await createHypothesis({
            projectId: project.id,
            statement: c.text.trim(),
            generatedBy: persona?.name ?? 'agent',
          });
          created += 1;
        } catch (err) {
          toastCatch("GenerateHypotheses:createOne")(err);
        }
      }
      addToast(`Created ${created} hypotheses`, 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const toggleAll = () => {
    if (!candidates) return;
    const anyDeselected = candidates.some((c) => !c.selected);
    setCandidates(candidates.map((c) => ({ ...c, selected: anyDeselected })));
  };

  const selectedCount = candidates?.filter((c) => c.selected).length ?? 0;

  // ---------- Step 2: preview ----------
  if (candidates) {
    return (
      <ResearchLabFormModal
        title={`${t.research_lab.generate_hypotheses} — ${candidates.length} candidates`}
        onClose={onClose}
        onSubmit={handleAccept}
        submitLabel={`Accept ${selectedCount}`}
        submitDisabled={selectedCount === 0}
        saving={busy}
      >
        <div className="flex items-center justify-between">
          <p className="typo-caption text-foreground">
            Review before saving. Uncheck any you don't want; edit text in place.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleAll}
              className="typo-caption text-primary hover:text-primary"
            >
              {candidates.every((c) => c.selected) ? 'Deselect all' : 'Select all'}
            </button>
            <button
              type="button"
              onClick={() => setCandidates(null)}
              className="flex items-center gap-1 typo-caption text-foreground hover:text-foreground"
            >
              <RotateCcw className="w-3 h-3" /> Re-run
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {candidates.map((c, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 p-3 rounded-card border transition-colors ${
                c.selected ? 'bg-primary/8 border-primary/40' : 'bg-secondary/40 border-border/30'
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  setCandidates((prev) =>
                    prev ? prev.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)) : prev,
                  )
                }
                className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                  c.selected ? 'bg-primary/40 text-background' : 'border border-border/40 text-transparent'
                }`}
                aria-label={c.selected ? 'Deselect' : 'Select'}
              >
                {c.selected ? <Check className="w-3 h-3" /> : null}
              </button>
              <textarea
                value={c.text}
                onChange={(e) =>
                  setCandidates((prev) =>
                    prev ? prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) : prev,
                  )
                }
                rows={Math.min(4, Math.max(1, Math.ceil(c.text.length / 60)))}
                className="flex-1 bg-transparent typo-caption text-foreground resize-none focus:outline-none"
              />
              <button
                type="button"
                onClick={() =>
                  setCandidates((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))
                }
                className="p-1 rounded text-foreground hover:text-red-400 flex-shrink-0"
                aria-label="Remove"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </ResearchLabFormModal>
    );
  }

  // ---------- Step 1: setup + run ----------
  return (
    <ResearchLabFormModal
      title={t.research_lab.generate_hypotheses}
      onClose={onClose}
      onSubmit={handleGenerate}
      submitLabel={t.research_lab.generate_hypotheses}
      submitDisabled={!personaId}
      saving={busy}
    >
      <div className="flex items-start gap-3 p-3 rounded-card bg-primary/5 border border-primary/15">
        <Sparkles className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
        <div>
          <p className="typo-card-label">{project.name}</p>
          <p className="typo-caption text-foreground mt-0.5">
            {projectSources.length} {t.research_lab.sources_count}
            {project.thesis ? ` · ${project.thesis.slice(0, 80)}${project.thesis.length > 80 ? '…' : ''}` : ''}
          </p>
        </div>
      </div>

      <SelectField
        label={t.research_lab.linked_persona}
        value={personaId}
        onChange={setPersonaId}
        options={personaOptions}
      />

      <TextAreaField
        label="Custom instructions (optional)"
        value={instructions}
        onChange={setInstructions}
        placeholder="e.g. Focus on prompt-engineering hypotheses, 7 total."
        rows={3}
      />

      {busy && (
        <div className="flex items-center gap-2 typo-caption text-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <Lightbulb className="w-3.5 h-3.5" />
          <span>{status || 'running'}…</span>
        </div>
      )}
    </ResearchLabFormModal>
  );
}
