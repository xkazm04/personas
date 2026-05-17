import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Briefcase, Compass, Heart, Lightbulb, MessageSquare, Rocket, Sparkles } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { TRAINING_TOPIC_PRESETS } from './useTrainingSession';
import type { LucideIcon } from 'lucide-react';
import type { TwinPendingMemory } from '@/lib/bindings/TwinPendingMemory';

/**
 * "Where to go next" panel rendered on the training completion screen.
 *
 * Stage 1 (this commit): score each preset by how many approved memories
 * on the active twin look like they cover that topic (rough keyword
 * match on the memory title + content). Surface the two presets with
 * the THINNEST coverage — that's where the next session would yield the
 * most new grounding. "Train this next" sends the user back to the topic
 * picker (handleReset). Stage 2 will skip the picker and auto-start the
 * recommended preset directly.
 */

const TOPIC_KEYWORDS: Record<string, string[]> = {
  background: ['background', 'history', 'experience', 'started', 'began', 'career', 'grew up', 'where you', 'how did you', 'first job'],
  opinions: ['opinion', 'think', 'believe', 'view', 'stance', 'agree', 'disagree', 'should', 'controversial', 'unpopular'],
  communication: ['communication', 'voice', 'tone', 'style', 'write', 'speak', 'audience', 'phrase', 'word'],
  values: ['value', 'principle', 'matter', 'important', 'priority', 'won\'t', 'never', 'always', 'integrity'],
  expertise: ['expert', 'specialty', 'skill', 'domain', 'knowledge', 'deep', 'unique', 'advice'],
  personal: ['personal', 'hobby', 'interest', 'enjoy', 'favorite', 'love', 'weekend', 'family', 'home'],
};

const TOPIC_ICONS: Record<string, LucideIcon> = {
  background: Briefcase,
  opinions: Lightbulb,
  communication: MessageSquare,
  values: Compass,
  expertise: Rocket,
  personal: Heart,
};

const TOPIC_TINTS: Record<string, string> = {
  background: 'border-violet-500/25 bg-violet-500/10 text-violet-300',
  opinions: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  communication: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-300',
  values: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  expertise: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  personal: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
};

interface Scored {
  id: typeof TRAINING_TOPIC_PRESETS[number]['id'];
  labelKey: typeof TRAINING_TOPIC_PRESETS[number]['labelKey'];
  count: number;
  icon: LucideIcon;
  tint: string;
}

function scorePresetCoverage(memories: TwinPendingMemory[]): Scored[] {
  return TRAINING_TOPIC_PRESETS.map((preset) => {
    const kws = TOPIC_KEYWORDS[preset.id] ?? [];
    let count = 0;
    for (const m of memories) {
      const hay = `${m.title ?? ''} ${m.content}`.toLowerCase();
      if (kws.some((kw) => hay.includes(kw))) count += 1;
    }
    return {
      id: preset.id,
      labelKey: preset.labelKey,
      count,
      icon: TOPIC_ICONS[preset.id] ?? Sparkles,
      tint: TOPIC_TINTS[preset.id] ?? 'border-primary/15 bg-card/40 text-foreground',
    };
  });
}

type PresetId = (typeof TRAINING_TOPIC_PRESETS)[number]['id'];

interface Props {
  /** Auto-start the chosen preset: reset session state and immediately
   *  fire generateQuestions for the matching prompt. Cycle 4 routed back
   *  to the topic picker; Stage 2 closes the loop to one click. */
  onPick: (presetId: PresetId) => void;
}

export function NextMovesPanel({ onPick }: Props) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const [memories, setMemories] = useState<TwinPendingMemory[] | null>(null);

  useEffect(() => {
    if (!activeTwinId) return;
    twinApi
      .listPendingMemories(activeTwinId, 'approved')
      .then(setMemories)
      .catch(() => setMemories([]));
  }, [activeTwinId]);

  const scored = useMemo(() => scorePresetCoverage(memories ?? []), [memories]);
  const recommendations = useMemo(() => {
    // Lowest coverage first; tie-break alphabetically by id for stability.
    return [...scored].sort((a, b) => a.count - b.count || a.id.localeCompare(b.id)).slice(0, 2);
  }, [scored]);

  if (memories === null) return null; // loading — keep the certificate clean
  if (recommendations.length === 0) return null;

  return (
    <section className="mt-8 rounded-card border border-primary/15 bg-card/40 overflow-hidden">
      <div className="px-5 py-3 border-b border-primary/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-violet-300" />
        <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-medium">
          {t.training.nextMovesHeading}
        </span>
      </div>
      <div className="p-4 md:p-5">
        <p className="typo-caption text-foreground mb-3">{t.training.nextMovesSubtitle}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {recommendations.map((r) => {
            const Icon = r.icon;
            const label = t.training[r.labelKey];
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onPick(r.id)}
                className={`group flex items-center gap-3 p-3 rounded-card border transition-all hover:shadow-elevation-1 text-left ${r.tint}`}
              >
                <span className="w-9 h-9 rounded-interactive bg-card/60 border border-primary/15 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block typo-card-label text-foreground truncate">{label}</span>
                  <span className="block text-[11px] text-foreground/65 mt-0.5">
                    {tx(t.training.nextMovesCoverage, { count: r.count })}
                  </span>
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-foreground/55 group-hover:text-foreground transition-colors flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
