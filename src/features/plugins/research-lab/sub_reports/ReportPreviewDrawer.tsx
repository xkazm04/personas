import { useEffect, useMemo, useState } from 'react';
import { X, Copy, Download, Check, Sparkles, Loader2 } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { compileReport, type ReportSynthesis } from './compileReport';
import { buildSynthesisPrompt } from './buildSynthesisPrompt';
import { parseSynthesisOutput } from './parseSynthesis';
import { runPersonaAndWait } from '../shared/runPersona';
import { downloadStringAsFile, copyToClipboard } from '../shared/downloadFile';
import type { ResearchReport } from '@/api/researchLab/researchLab';
import { DebtText } from '@/i18n/DebtText';


interface Props {
  report: ResearchReport;
  onClose: () => void;
}

type View = 'preview' | 'source';

export default function ReportPreviewDrawer({ report, onClose }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const projects = useSystemStore((s) => s.researchProjects);
  const sources = useSystemStore((s) => s.researchSources);
  const hypotheses = useSystemStore((s) => s.researchHypotheses);
  const experiments = useSystemStore((s) => s.researchExperiments);
  const findings = useSystemStore((s) => s.researchFindings);

  const personas = useAgentStore((s) => s.personas);

  const fetchSources = useSystemStore((s) => s.fetchResearchSources);
  const fetchHypotheses = useSystemStore((s) => s.fetchResearchHypotheses);
  const fetchExperiments = useSystemStore((s) => s.fetchResearchExperiments);
  const fetchFindings = useSystemStore((s) => s.fetchResearchFindings);

  const [view, setView] = useState<View>('preview');
  const [justCopied, setJustCopied] = useState(false);

  // ---- AI synthesis (Abstract + Discussion) ----
  const [personaId, setPersonaId] = useState('');
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthStatus, setSynthStatus] = useState('');
  const [synthesis, setSynthesis] = useState<ReportSynthesis | null>(null);

  const project = useMemo(
    () => projects.find((p) => p.id === report.projectId) ?? null,
    [projects, report.projectId],
  );

  const personaOptions = useMemo(() => {
    const sorted = [...personas].sort((a, b) => a.name.localeCompare(b.name));
    return [{ value: '', label: '—' }, ...sorted.map((p) => ({ value: p.id, label: p.name }))];
  }, [personas]);

  useEffect(() => {
    fetchSources(report.projectId);
    fetchHypotheses(report.projectId);
    fetchExperiments(report.projectId);
    fetchFindings(report.projectId);
  }, [report.projectId, fetchSources, fetchHypotheses, fetchExperiments, fetchFindings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const projectHypotheses = useMemo(
    () => hypotheses.filter((h) => h.projectId === report.projectId),
    [hypotheses, report.projectId],
  );
  const projectExperiments = useMemo(
    () => experiments.filter((e) => e.projectId === report.projectId),
    [experiments, report.projectId],
  );
  const projectFindings = useMemo(
    () => findings.filter((f) => f.projectId === report.projectId),
    [findings, report.projectId],
  );

  const markdown = useMemo(() => {
    if (!project) return '';
    return compileReport({
      report,
      project,
      sources: sources.filter((s) => s.projectId === report.projectId),
      hypotheses: projectHypotheses,
      experiments: projectExperiments,
      findings: projectFindings,
      synthesis: synthesis ?? undefined,
    });
  }, [project, report, sources, projectHypotheses, projectExperiments, projectFindings, synthesis]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(markdown);
    if (ok) {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 1500);
      addToast('Copied to clipboard', 'success');
    } else {
      addToast('Copy failed', 'error');
    }
  };

  const handleDownload = () => {
    const slug = report.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    downloadStringAsFile(`${slug || 'report'}.md`, markdown);
    addToast('Downloaded', 'success');
  };

  const handleSynthesize = async () => {
    if (!project || !personaId || synthesizing) return;
    setSynthesizing(true);
    setSynthStatus('running');
    try {
      const prompt = buildSynthesisPrompt({
        project,
        hypotheses: projectHypotheses,
        experiments: projectExperiments,
        findings: projectFindings,
      });
      const { output, passed } = await runPersonaAndWait({
        personaId,
        input: prompt,
        onStatus: setSynthStatus,
      });
      if (!passed || !output) {
        addToast('AI synthesis did not complete', 'error');
        return;
      }
      const parsed = parseSynthesisOutput(output);
      if (!parsed || (!parsed.abstract && !parsed.discussion)) {
        addToast('Could not parse AI synthesis output', 'error');
        return;
      }
      setSynthesis(parsed);
      addToast('Abstract & Discussion synthesized', 'success');
    } catch (err) {
      toastCatch('ReportPreviewDrawer:synthesize')(err);
    } finally {
      setSynthesizing(false);
      setSynthStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <aside className="w-full max-w-3xl bg-background border-l border-border/40 shadow-elevation-4 flex flex-col animate-fade-slide-in">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border/20">
          <div className="min-w-0">
            <h2 className="typo-section-title truncate">{report.title}</h2>
            {project && <p className="typo-caption text-foreground truncate">{project.name}</p>}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={personaId}
              onChange={(e) => setPersonaId(e.target.value)}
              disabled={synthesizing}
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              aria-label="AI synthesis persona"
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              title="Persona to author the Abstract & Discussion"
              className="px-2 py-1.5 rounded-card border border-border/30 bg-secondary/50 text-foreground typo-caption focus:outline-none focus:border-primary/40 disabled:opacity-50 max-w-[10rem]"
            >
              {personaOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={handleSynthesize}
              disabled={!personaId || synthesizing}
              // eslint-disable-next-line custom/no-hardcoded-jsx-text
              title="Run a persona to draft the Abstract & Discussion from this project's findings"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-primary/15 hover:bg-primary/25 text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {synthesizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {synthesizing ? (synthStatus || 'Synthesizing') + '…' : 'AI synthesis'}
            </button>
            <div className="flex items-center rounded-card border border-border/30 overflow-hidden">
              <button
                onClick={() => setView('preview')}
                className={`px-3 py-1.5 typo-caption transition-colors ${view === 'preview' ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-secondary/50'}`}
              >
                Preview
              </button>
              <button
                onClick={() => setView('source')}
                className={`px-3 py-1.5 typo-caption transition-colors ${view === 'source' ? 'bg-primary/20 text-primary' : 'text-foreground hover:bg-secondary/50'}`}
              >
                Markdown
              </button>
            </div>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-secondary/50 hover:bg-secondary text-foreground transition-colors"
            >
              {justCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {t.common.copy}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-primary/20 hover:bg-primary/30 text-primary transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <DebtText k="auto_md_a2c73572" />
            </button>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary/50 text-foreground" aria-label={t.common.cancel}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {view === 'preview' ? (
            <MarkdownRenderer content={markdown} />
          ) : (
            <pre className="typo-code text-foreground whitespace-pre-wrap break-words bg-secondary/30 rounded-card p-4 border border-border/20">
              {markdown}
            </pre>
          )}
        </div>
      </aside>
    </div>
  );
}
