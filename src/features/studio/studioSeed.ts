// The first build turn's message, built from what the parallel sketch lane and
// the owner produced while setup ran (webbuild::sketch). Pure, so the exact
// words the seed turn receives are pinned by a test. Instructions to the model
// stay English, like every other Studio prompt.
import type { SiteSketch } from '@/lib/bindings/SiteSketch';

export interface SeedInput {
  vision: string;
  sketch: SiteSketch | null;
  /** Question index -> the owner's answer, for the sketch's questions. */
  answers: Record<number, string>;
}

export function buildSeed({ vision, sketch, answers }: SeedInput): string {
  const lines = [`Here's the project vision:`, '', vision.trim(), ''];
  if (sketch) {
    lines.push(
      'While the project was being created, you already drew a first sketch for the owner (it is on their screen now):',
      sketch.summary ? `- Understood as: ${sketch.summary}` : '',
      ...sketch.pages.map(
        (p) => `- Page "${p.title}"${p.route ? ` (${p.route})` : ''}: ${p.regions.map((r) => r.title).join(', ')}`,
      ),
      sketch.goals.length ? `- Draft goals: ${sketch.goals.map((g) => g.title).join(' → ')}` : '',
    );
    const answered = sketch.questions
      .map((q, i) => (answers[i] ? `- ${q.question} → ${answers[i]}` : null))
      .filter(Boolean) as string[];
    const open = sketch.questions.filter((_, i) => !answers[i]).map((q) => `- ${q.question}`);
    if (answered.length) lines.push('', 'The owner already answered:', ...answered);
    if (open.length) {
      lines.push(
        '',
        'These are still open with the owner. Do NOT ask them again; assume a sensible default, say which, and their answers will arrive as notes:',
        ...open,
      );
    }
    lines.push('', 'Refine the sketch into your real plan rather than starting over.');
  }
  lines.push(
    '',
    'Plan it out (emit your BUILD_PLAN), then start building: the foundation first, then the most important section. Keep me posted in a sentence or two.',
    'The dev server may still be starting while you plan and research; do not wait for it and never start it yourself.',
  );
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** A sketch answer given after the seed turn started: delivered as a note. */
export function answerNote(question: string, answer: string): string {
  return `Answer to your early question "${question}": ${answer}`;
}

/** The turn the queue pump sends when notes waited out a turn. */
export const QUEUED_NOTES_TURN = 'Here are the notes I left while you were working. Take them into account and carry on.';
