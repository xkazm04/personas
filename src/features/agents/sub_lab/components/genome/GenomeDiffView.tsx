import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronDown, ChevronRight, GitCompare, Layers, Wrench,
  Cpu, Settings2, Plus, Minus as MinusIcon, ArrowLeftRight,
} from 'lucide-react';
import type { PersonaGenome } from '@/lib/bindings/PersonaGenome';

type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

interface DiffEntry {
  label: string;
  kind: DiffKind;
  parentValue?: string;
  offspringValue?: string;
}

function diffGenomes(parent: PersonaGenome, offspring: PersonaGenome): {
  prompt: DiffEntry[];
  tools: DiffEntry[];
  model: DiffEntry[];
  config: DiffEntry[];
} {
  // Prompt segment diff
  const parentTexts = new Set(parent.promptSegments.map((s) => s.text));
  const childTexts = new Set(offspring.promptSegments.map((s) => s.text));

  const prompt: DiffEntry[] = [];
  for (const seg of parent.promptSegments) {
    if (!childTexts.has(seg.text)) {
      prompt.push({ label: seg.text.slice(0, 80), kind: 'removed', parentValue: seg.text });
    }
  }
  for (const seg of offspring.promptSegments) {
    if (!parentTexts.has(seg.text)) {
      prompt.push({ label: seg.text.slice(0, 80), kind: 'added', offspringValue: seg.text });
    }
  }
  if (prompt.length === 0 && parent.promptSegments.length === offspring.promptSegments.length) {
    prompt.push({ label: `${parent.promptSegments.length} segments (unchanged)`, kind: 'unchanged' });
  }

  // Tool diff
  const parentTools = new Set(parent.tools.toolIds);
  const childTools = new Set(offspring.tools.toolIds);
  const tools: DiffEntry[] = [];
  for (const t of parent.tools.toolIds) {
    if (!childTools.has(t)) tools.push({ label: t, kind: 'removed' });
  }
  for (const t of offspring.tools.toolIds) {
    if (!parentTools.has(t)) tools.push({ label: t, kind: 'added' });
  }
  const keptTools = parent.tools.toolIds.filter((t) => childTools.has(t));
  if (keptTools.length > 0) {
    tools.push({ label: `${keptTools.length} shared tools`, kind: 'unchanged' });
  }
  // Check reordering
  const parentOrder = parent.tools.toolIds.filter((t) => childTools.has(t));
  const childOrder = offspring.tools.toolIds.filter((t) => parentTools.has(t));
  if (parentOrder.join(',') !== childOrder.join(',') && parentOrder.length > 1) {
    tools.push({ label: 'Tool ordering changed', kind: 'changed' });
  }

  // Model diff
  const model: DiffEntry[] = [];
  if (parent.model.modelProfile !== offspring.model.modelProfile) {
    model.push({
      label: 'Model profile',
      kind: 'changed',
      parentValue: parent.model.modelProfile ?? 'none',
      offspringValue: offspring.model.modelProfile ?? 'none',
    });
  }
  if (parent.model.timeoutMs !== offspring.model.timeoutMs) {
    model.push({
      label: 'Timeout',
      kind: 'changed',
      parentValue: `${parent.model.timeoutMs}ms`,
      offspringValue: `${offspring.model.timeoutMs}ms`,
    });
  }
  if (parent.model.maxBudgetUsd !== offspring.model.maxBudgetUsd) {
    model.push({
      label: 'Budget',
      kind: 'changed',
      parentValue: parent.model.maxBudgetUsd != null ? `$${parent.model.maxBudgetUsd}` : 'none',
      offspringValue: offspring.model.maxBudgetUsd != null ? `$${offspring.model.maxBudgetUsd}` : 'none',
    });
  }
  if (parent.model.maxTurns !== offspring.model.maxTurns) {
    model.push({
      label: 'Max turns',
      kind: 'changed',
      parentValue: String(parent.model.maxTurns ?? 'none'),
      offspringValue: String(offspring.model.maxTurns ?? 'none'),
    });
  }
  if (model.length === 0) {
    model.push({ label: 'No changes', kind: 'unchanged' });
  }

  // Config diff
  const config: DiffEntry[] = [];
  if (parent.config.maxConcurrent !== offspring.config.maxConcurrent) {
    config.push({
      label: 'Max concurrent',
      kind: 'changed',
      parentValue: String(parent.config.maxConcurrent),
      offspringValue: String(offspring.config.maxConcurrent),
    });
  }
  if (parent.config.sensitive !== offspring.config.sensitive) {
    config.push({
      label: 'Sensitive',
      kind: 'changed',
      parentValue: String(parent.config.sensitive),
      offspringValue: String(offspring.config.sensitive),
    });
  }
  if (parent.config.headless !== offspring.config.headless) {
    config.push({
      label: 'Headless',
      kind: 'changed',
      parentValue: String(parent.config.headless),
      offspringValue: String(offspring.config.headless),
    });
  }
  if (config.length === 0) {
    config.push({ label: 'No changes', kind: 'unchanged' });
  }

  return { prompt, tools, model, config };
}

const kindColors: Record<DiffKind, string> = {
  added: 'text-emerald-400',
  removed: 'text-red-400',
  changed: 'text-amber-400',
  unchanged: 'text-muted-foreground/50',
};

const kindIcons: Record<DiffKind, React.ReactNode> = {
  added: <Plus className="w-3 h-3" />,
  removed: <MinusIcon className="w-3 h-3" />,
  changed: <ArrowLeftRight className="w-3 h-3" />,
  unchanged: null,
};

function DiffSection({
  title,
  icon,
  entries,
  defaultOpen,
}: {
  title: string;
  icon: React.ReactNode;
  entries: DiffEntry[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const changeCount = entries.filter((e) => e.kind !== 'unchanged').length;

  return (
    <div className="border border-primary/8 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-primary/5 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {icon}
        <span>{title}</span>
        {changeCount > 0 && (
          <span className="ml-auto text-amber-400/80 text-[10px]">
            {changeCount} change{changeCount !== 1 ? 's' : ''}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2 space-y-1">
              {entries.map((entry, i) => (
                <div key={i} className={`flex items-start gap-2 text-xs ${kindColors[entry.kind]}`}>
                  <span className="mt-0.5 flex-shrink-0">{kindIcons[entry.kind]}</span>
                  <div className="min-w-0">
                    <span className="break-words">{entry.label}</span>
                    {entry.kind === 'changed' && entry.parentValue && entry.offspringValue && (
                      <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                        <span className="text-red-400/70 line-through">{entry.parentValue}</span>
                        <span className="text-muted-foreground/30">&rarr;</span>
                        <span className="text-emerald-400/70">{entry.offspringValue}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function GenomeDiffView({
  parent,
  offspring,
}: {
  parent: PersonaGenome;
  offspring: PersonaGenome;
}) {
  const diff = useMemo(() => diffGenomes(parent, offspring), [parent, offspring]);

  const totalChanges =
    diff.prompt.filter((e) => e.kind !== 'unchanged').length +
    diff.tools.filter((e) => e.kind !== 'unchanged').length +
    diff.model.filter((e) => e.kind !== 'unchanged').length +
    diff.config.filter((e) => e.kind !== 'unchanged').length;

  return (
    <div className="space-y-2" role="region" aria-label="Genome comparison">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitCompare className="w-3.5 h-3.5 text-violet-400" />
        <span className="font-medium">Genome Diff</span>
        <span className="text-muted-foreground/50">
          {totalChanges} mutation{totalChanges !== 1 ? 's' : ''}
        </span>
      </div>

      <DiffSection
        title="Prompt Segments"
        icon={<Layers className="w-3 h-3" />}
        entries={diff.prompt}
        defaultOpen={diff.prompt.some((e) => e.kind !== 'unchanged')}
      />
      <DiffSection
        title="Tools"
        icon={<Wrench className="w-3 h-3" />}
        entries={diff.tools}
      />
      <DiffSection
        title="Model"
        icon={<Cpu className="w-3 h-3" />}
        entries={diff.model}
      />
      <DiffSection
        title="Config"
        icon={<Settings2 className="w-3 h-3" />}
        entries={diff.config}
      />
    </div>
  );
}
