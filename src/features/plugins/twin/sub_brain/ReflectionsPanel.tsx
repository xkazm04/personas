import { useEffect, useState } from 'react';
import { ArrowRightCircle, BookHeart, Loader2, Sparkles, Trash2 } from 'lucide-react';
import * as twinApi from '@/api/twin/twin';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { Button } from '@/features/shared/components/buttons';
import type { TwinReflection } from '@/lib/bindings/TwinReflection';

/**
 * Cycle 15 Stage 1 — operator-audit journal. The user types a seed question
 * ("What's been moving in this twin's voice this week?"), the backend builds
 * a Claude prompt from the twin profile + recent communications + that seed,
 * and the resulting prose is persisted append-only as a TwinReflection row.
 *
 * Frozen-at-write design: the user can delete a reflection but not edit it.
 * That's the audit value — reflections show what the model was inclined to
 * say at a specific moment given the data at hand.
 */

const SUGGESTED_SEEDS = [
  'voiceChange',
  'commsCadence',
  'contactSurprises',
] as const;

interface Props {
  twinId: string;
}

export function ReflectionsPanel({ twinId }: Props) {
  const { t: tFull } = useTranslation();
  const t = tFull.twin;
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === twinId);
  const addToast = useToastStore((s) => s.addToast);
  const [reflections, setReflections] = useState<TwinReflection[] | null>(null);
  const [seed, setSeed] = useState('');
  const [generating, setGenerating] = useState(false);
  const [digDeeperId, setDigDeeperId] = useState<string | null>(null);

  useEffect(() => {
    if (!twinId) return;
    twinApi
      .listTwinReflections(twinId)
      .then(setReflections)
      .catch(() => setReflections([]));
  }, [twinId]);

  const handleGenerate = async () => {
    if (!seed.trim() || generating) return;
    setGenerating(true);
    try {
      const created = await twinApi.reflectOnTwin(twinId, seed.trim());
      setReflections((prev) => (prev ? [created, ...prev] : [created]));
      setSeed('');
    } catch (e) {
      toastCatch('twin:reflect')(e);
    } finally {
      setGenerating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await twinApi.deleteTwinReflection(id);
      setReflections((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    } catch (e) {
      toastCatch('twin:delete-reflection')(e);
    }
  };

  // Generate 1-2 follow-up training questions seeded by this reflection and
  // hand them off to the Training tab via the shared store slot. We reuse the
  // generateBio LLM wrapper because every twin AI surface uses it — keeps the
  // single Claude credential + retry/timeout policy in one place.
  const handleDigDeeper = async (reflection: TwinReflection) => {
    if (!activeTwin || digDeeperId) return;
    setDigDeeperId(reflection.id);
    try {
      const prompt = `Below is a saved reflection about ${activeTwin.name}${activeTwin.role ? ` (${activeTwin.role})` : ''}, written by an observer. Your job: generate exactly 2 specific, conversational interview questions that would help ${activeTwin.name} elaborate on the angles surfaced in this reflection. The questions should be ones a thoughtful interviewer would ask next — not generic, not re-asking what's already known.

Output ONLY the 2 questions, one per line, numbered 1-2. No preamble.

Reflection seed: "${reflection.prompt_seed}"
Reflection: ${reflection.content}`;
      const result = await twinApi.generateBio(activeTwin.name, activeTwin.role ?? null, prompt);
      const questions = result
        .split('\n')
        .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
        .filter((l) => l.length > 8)
        .slice(0, 2);
      if (questions.length === 0) {
        addToast(t.reflections.digDeeperError, 'error');
        return;
      }
      setPendingTrainingQuestions(questions);
      addToast(t.reflections.digDeeperToast, 'success');
      setTwinTab('training');
    } catch (e) {
      addToast(e instanceof Error ? e.message : t.reflections.digDeeperError, 'error');
    } finally {
      setDigDeeperId(null);
    }
  };

  return (
    <div className="p-4 rounded-card border border-primary/10 bg-card/40">
      <div className="flex items-center gap-2 mb-1">
        <BookHeart className="w-4 h-4 text-violet-400" />
        <span className="typo-section-title">{t.reflections.title}</span>
        {reflections && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-secondary/40 text-foreground">
            {reflections.length}
          </span>
        )}
      </div>
      <p className="typo-caption text-foreground mb-3">{t.reflections.subtitle}</p>

      <div className="space-y-2 mb-3">
        <textarea
          rows={2}
          placeholder={t.reflections.seedPlaceholder}
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          disabled={generating}
          className={`${INPUT_FIELD} resize-y`}
        />
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {SUGGESTED_SEEDS.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setSeed(t.reflections.suggestedSeeds[key])}
                disabled={generating}
                className="px-2 py-1 text-[10px] rounded-full bg-secondary/40 text-foreground hover:bg-violet-500/10 hover:text-violet-300 transition-colors disabled:opacity-50"
              >
                {t.reflections.suggestedSeedLabels[key]}
              </button>
            ))}
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || !seed.trim()}
            size="sm"
            variant="accent"
            accentColor="violet"
          >
            {generating ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            )}
            {generating ? t.reflections.generating : t.reflections.reflectCta}
          </Button>
        </div>
      </div>

      {reflections === null ? (
        <p className="typo-caption text-foreground py-2">{t.reflections.loading}</p>
      ) : reflections.length === 0 ? (
        <div className="py-6 text-center">
          <BookHeart className="w-7 h-7 text-foreground mx-auto mb-2" />
          <p className="typo-body text-foreground">{t.reflections.emptyTitle}</p>
          <p className="typo-caption text-foreground mt-1">{t.reflections.emptyBody}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {reflections.map((r) => {
            const isDigging = digDeeperId === r.id;
            return (
              <li key={r.id} className="p-3 rounded-card border border-primary/10 bg-background/40">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-foreground mb-1">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                    <p className="typo-caption text-violet-300 italic mb-1.5">&ldquo;{r.prompt_seed}&rdquo;</p>
                    <p className="typo-body text-foreground whitespace-pre-wrap leading-relaxed">{r.content}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(r.id)}
                    aria-label={t.reflections.deleteAria}
                    className="p-1.5 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="mt-2 pt-2 border-t border-primary/5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => void handleDigDeeper(r)}
                    disabled={isDigging || digDeeperId !== null}
                    title={t.reflections.digDeeperTooltip}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-interactive text-[11px] font-medium text-violet-300 bg-violet-500/10 border border-violet-500/20 hover:bg-violet-500/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isDigging
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <ArrowRightCircle className="w-3 h-3" />}
                    {isDigging ? t.reflections.digDeeperGenerating : t.reflections.digDeeperCta}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
