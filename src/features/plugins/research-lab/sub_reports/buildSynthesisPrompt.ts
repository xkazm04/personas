import type {
  ResearchProject, ResearchHypothesis,
  ResearchExperiment, ResearchFinding,
} from '@/api/researchLab/researchLab';

export interface SynthesisPromptArgs {
  project: ResearchProject;
  hypotheses: ResearchHypothesis[];
  experiments: ResearchExperiment[];
  findings: ResearchFinding[];
}

/**
 * Build the input prompt for the AI report-synthesis persona.
 *
 * Mirrors `GenerateHypothesesModal.buildPrompt`: it grounds the persona in the
 * project's actual findings / hypotheses / experiments and asks for a small,
 * strictly-shaped JSON object so the output can be parsed defensively.
 */
export function buildSynthesisPrompt(args: SynthesisPromptArgs): string {
  const { project, hypotheses, experiments, findings } = args;

  const lines: string[] = [
    'You are a senior research scientist writing the analytical sections of a research paper.',
    `Project: ${project.name}`,
    project.domain ? `Domain: ${project.domain}` : '',
    project.thesis ? `Central question: ${project.thesis}` : '',
    project.description ? `Context: ${project.description}` : '',
    '',
    `Hypotheses (${hypotheses.length}):`,
    hypotheses.length > 0
      ? hypotheses.slice(0, 40).map((h, i) => {
          const conf = Math.round(h.confidence * 100);
          return `${i + 1}. [${h.status}, confidence ${conf}%] ${h.statement}`;
        }).join('\n')
      : '_No hypotheses recorded._',
    '',
    `Experiments (${experiments.length}):`,
    experiments.length > 0
      ? experiments.slice(0, 40).map((e) => {
          const method = e.methodology ? ` — methodology: ${truncate(e.methodology, 240)}` : '';
          return `- [${e.status}] ${e.name}${method}`;
        }).join('\n')
      : '_No experiments recorded._',
    '',
    `Findings (${findings.length}):`,
    findings.length > 0
      ? findings.slice(0, 60).map((f) => {
          const conf = Math.round(f.confidence * 100);
          const cat = f.category ? ` (${f.category})` : '';
          const desc = f.description ? ` — ${truncate(f.description, 300)}` : '';
          return `- [confidence ${conf}%]${cat} ${f.title}${desc}`;
        }).join('\n')
      : '_No findings recorded._',
    '',
    'Tasks:',
    '1. Write an "abstract": a concise structured abstract (background, approach, key results, implications) of 120-220 words.',
    '2. Write a "discussion": a narrative Discussion section that interprets the findings against the hypotheses, notes agreements/contradictions, limitations, and future work. Use markdown prose (paragraphs, optional sub-bullets).',
    '',
    'Ground every claim ONLY in the data above. Do not invent findings, citations, or numbers that are not present.',
    '',
    'Return ONLY a single JSON object, no commentary, no code fences, of exactly this shape:',
    '{ "abstract": "...", "discussion": "..." }',
  ];

  return lines.filter((l) => l !== '').join('\n');
}

function truncate(s: string, max: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
