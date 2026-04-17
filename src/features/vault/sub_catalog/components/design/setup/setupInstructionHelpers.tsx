// -- Helpers -----------------------------------------------------

/** Split markdown into logical step blocks by numbered list items or headings. */
export function parseSteps(markdown: string): { preamble: string; steps: string[] } {
  const lines = markdown.split('\n');
  const steps: string[] = [];
  let preamble = '';
  let currentStep = '';
  let inSteps = false;

  for (const line of lines) {
    // Match numbered list items: "1. ", "2. ", "1) ", etc.
    const isNumberedItem = /^\s*\d+[.)]\s+/.test(line);

    if (isNumberedItem) {
      if (currentStep) {
        steps.push(currentStep.trim());
      }
      currentStep = line;
      inSteps = true;
    } else if (inSteps) {
      // Continuation of current step (indented lines, blank lines within step)
      if (line.trim() === '' && currentStep.trim() === '') {
        continue;
      }
      currentStep += '\n' + line;
    } else {
      preamble += line + '\n';
    }
  }

  if (currentStep.trim()) {
    steps.push(currentStep.trim());
  }

  return { preamble: preamble.trim(), steps };
}

// -- Persistence helpers ------------------------------------------

/** Fast string hash for localStorage keys. */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}

export function readPersistedSteps(key: string): number[] {
  try {
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved) as number[];
  } catch { /* intentional: non-critical -- localStorage fallback */ }
  return [];
}

// -- Progress ring + badge ----------------------------------------

export function ProgressRingBadge({
  gradientId,
  completedCount,
  totalSteps,
}: {
  gradientId: string;
  completedCount: number;
  totalSteps: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        className="shrink-0 -rotate-90"
        data-testid="setup-progress-ring"
      >
        {/* Background track */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-secondary/40"
        />
        {/* Progress arc */}
        <circle
          cx="12"
          cy="12"
          r="9"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          stroke={`url(#${gradientId})`}
          strokeDasharray={2 * Math.PI * 9}
          strokeDashoffset={totalSteps > 0 ? 2 * Math.PI * 9 * (1 - completedCount / totalSteps) : 2 * Math.PI * 9}
          style={{ transition: 'stroke-dashoffset 0.3s ease-out' }}
        />
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--color-primary)', stopOpacity: 0.6 }} />
            <stop offset="100%" style={{ stopColor: 'var(--status-success)', stopOpacity: 0.6 }} />
          </linearGradient>
        </defs>
      </svg>
      <span className={`typo-body font-medium px-1.5 py-0.5 rounded ${
        completedCount === totalSteps && totalSteps > 0
          ? 'bg-emerald-500/15 text-emerald-400'
          : completedCount > 0
            ? 'bg-primary/10 text-primary/70'
            : 'bg-secondary/50 text-foreground'
      }`}>
        {completedCount}/{totalSteps}
      </span>
    </span>
  );
}
