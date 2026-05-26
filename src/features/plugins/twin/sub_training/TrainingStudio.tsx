import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Bookmark, BookmarkCheck, Bot, Check, GraduationCap, Loader2, Plus, Save, Sparkles, Trash2, Wand2, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import * as twinApi from '@/api/twin/twin';
import type { TwinStudioSeed } from '@/lib/bindings/TwinStudioSeed';

/* ------------------------------------------------------------------ *
 *  Training Studio (D2 + D4)
 *  A board of Q&A pairs the user authors with AI help on BOTH sides:
 *   - questions are batch-generated (user simulation) and curated inline
 *   - answers are drafted AS the twin (twin simulation), reviewed & edited
 *  Both generation passes run as background jobs (sidebar dot + OS
 *  notification), so the user can gather a large batch and walk away.
 * ------------------------------------------------------------------ */

interface StudioRow {
  id: string;
  question: string;
  answer: string;
  aiDrafted: boolean;
  include: boolean;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

let rowSeq = 0;
function newRow(question = '', answer = ''): StudioRow {
  rowSeq += 1;
  return { id: `studio-${Date.now()}-${rowSeq}`, question, answer, aiDrafted: false, include: answer.trim().length > 0 };
}

export default function TrainingStudio({ onExit }: { onExit: () => void }) {
  const { t: tFull, tx } = useTranslation();
  const t = tFull.twin;
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const savedDirectives = activeTwin?.training_directives ?? '';
  const recordTwinInteraction = useSystemStore((s) => s.recordTwinInteraction);
  const updateTwinProfile = useSystemStore((s) => s.updateTwinProfile);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const addToast = useToastStore((s) => s.addToast);

  // Background-job state (shared with the sidebar dots).
  const studioJobActive = useSystemStore((s) => s.studioJobActive);
  const studioPhase = useSystemStore((s) => s.studioPhase);
  const studioCompleted = useSystemStore((s) => s.studioCompleted);
  const studioTotal = useSystemStore((s) => s.studioTotal);
  const studioBatch = useSystemStore((s) => s.studioBatch);
  const studioJustCompleted = useSystemStore((s) => s.studioJustCompleted);
  const startStudioQuestions = useSystemStore((s) => s.startStudioQuestions);
  const startStudioAnswers = useSystemStore((s) => s.startStudioAnswers);
  const cancelStudio = useSystemStore((s) => s.cancelStudio);
  const clearStudioCompletion = useSystemStore((s) => s.clearStudioCompletion);

  const [directions, setDirections] = useState('');
  const [topic, setTopic] = useState('');
  const [rows, setRows] = useState<StudioRow[]>([]);
  const [savingPairs, setSavingPairs] = useState(false);
  const [savingDirections, setSavingDirections] = useState(false);
  const [draftingRowId, setDraftingRowId] = useState<string | null>(null);
  const lastAbsorbed = useRef<number | null>(null);
  const seededTwinRef = useRef<string | null>(null);

  // Seed the Directions box from the twin's persisted training style guide
  // (D5) the first time this twin is seen — so the studio opens already
  // carrying the directions the user saved last time, not a blank box.
  useEffect(() => {
    if (!activeTwinId || seededTwinRef.current === activeTwinId) return;
    seededTwinRef.current = activeTwinId;
    setDirections(savedDirectives);
  }, [activeTwinId, savedDirectives]);

  const directionsDirty = directions.trim() !== savedDirectives.trim();

  const handleSaveDirections = async () => {
    if (!activeTwinId || !directionsDirty) return;
    setSavingDirections(true);
    try {
      await updateTwinProfile(activeTwinId, { trainingDirectives: directions.trim() || null });
      addToast(t.training.studioDirectionsSavedToast, 'success');
    } catch (e) {
      toastCatch('features/plugins/twin/sub_training/TrainingStudio:handleSaveDirections')(e);
    } finally {
      setSavingDirections(false);
    }
  };

  // Absorb a finished background batch into the board. Keyed on the
  // completion timestamp so re-mounting (route flip) doesn't re-absorb.
  useEffect(() => {
    if (!studioJustCompleted || !studioBatch) return;
    if (lastAbsorbed.current === studioJustCompleted.ts) return;
    lastAbsorbed.current = studioJustCompleted.ts;

    if (studioJustCompleted.phase === 'questions') {
      setRows(studioBatch.items.map((it) => newRow(it.question, '')));
    } else if (studioJustCompleted.phase === 'answers') {
      setRows((prev) => {
        const byId = new Map(studioBatch.items.map((it) => [it.id, it]));
        return prev.map((r) => {
          const got = byId.get(r.id);
          if (!got || !got.answer) return r;
          return { ...r, answer: got.answer, aiDrafted: true, include: true };
        });
      });
    }
    clearStudioCompletion();
  }, [studioJustCompleted, studioBatch, clearStudioCompletion]);

  const updateRow = useCallback((id: string, patch: Partial<StudioRow>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const handleGenerateQuestions = () => {
    if (!activeTwinId || studioJobActive) return;
    void startStudioQuestions(activeTwinId, topic.trim() || 'their background, work, and opinions', directions.trim() || undefined);
  };

  const handleDraftAll = () => {
    if (!activeTwinId || studioJobActive) return;
    const seeds: TwinStudioSeed[] = rows
      .filter((r) => r.question.trim())
      .map((r) => ({ id: r.id, question: r.question.trim() }));
    if (seeds.length === 0) return;
    void startStudioAnswers(activeTwinId, seeds, directions.trim() || undefined);
  };

  // Single-row draft (synchronous — immediate feedback for one question).
  const handleDraftRow = async (row: StudioRow) => {
    if (!activeTwinId || !row.question.trim()) return;
    setDraftingRowId(row.id);
    try {
      const draft = await twinApi.simulateAnswer(activeTwinId, row.question.trim(), directions.trim() || undefined);
      const clean = draft.trim();
      if (clean) updateRow(row.id, { answer: clean, aiDrafted: true, include: true });
    } catch (e) {
      toastCatch('features/plugins/twin/sub_training/TrainingStudio:handleDraftRow')(e);
    } finally {
      setDraftingRowId(null);
    }
  };

  const includedCount = rows.filter((r) => r.include && r.answer.trim()).length;

  const handleSave = async () => {
    if (!activeTwinId || includedCount === 0) return;
    setSavingPairs(true);
    let saved = 0;
    try {
      for (const r of rows) {
        if (!r.include || !r.answer.trim()) continue;
        await recordTwinInteraction(
          activeTwinId, 'training', 'out', r.answer.trim(), undefined,
          `Training Q&A: ${r.question.trim()}`,
          JSON.stringify([{ q: r.question.trim(), a: r.answer.trim() }]), true,
        );
        saved += 1;
      }
      addToast(tx(t.training.studioSavedToast, { count: saved }), 'success');
      // Keep the board so the user can continue; drop saved rows.
      setRows((prev) => prev.filter((r) => !(r.include && r.answer.trim())));
    } catch (e) {
      toastCatch('features/plugins/twin/sub_training/TrainingStudio:handleSave')(e);
    } finally {
      setSavingPairs(false);
    }
  };

  const busy = studioJobActive;

  return (
    <div className="h-full flex flex-col">
      {/* Control strip */}
      <div className="flex-shrink-0 border-b border-primary/10 px-4 md:px-6 py-3 space-y-2.5">
        <div className="flex items-center gap-2">
          <button onClick={onExit} className="typo-caption text-foreground hover:text-violet-300 transition-colors inline-flex items-center gap-1 focus-ring rounded-interactive px-1.5 py-0.5">
            <GraduationCap className="w-3.5 h-3.5" /> {t.training.studioBack}
          </button>
          <span className="w-px h-3.5 bg-primary/15" aria-hidden />
          <span className="typo-caption text-violet-300 font-medium inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> {t.training.studioOpen}</span>
        </div>

        <div className="flex flex-col lg:flex-row gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={t.training.studioTopicPlaceholder}
            disabled={busy}
            className={`${INPUT_FIELD} lg:max-w-xs`}
          />
          <div className="flex-1 flex gap-1.5 min-w-0">
            <input
              type="text"
              value={directions}
              onChange={(e) => setDirections(e.target.value)}
              placeholder={t.training.studioDirectionsPlaceholder}
              disabled={busy}
              className={`${INPUT_FIELD} flex-1`}
              aria-label={t.training.studioDirectionsLabel}
            />
            <button
              type="button"
              onClick={() => void handleSaveDirections()}
              disabled={busy || savingDirections || (!directionsDirty && !savedDirectives)}
              title={directionsDirty ? t.training.studioSaveDirections : t.training.studioDirectionsSaved}
              aria-label={t.training.studioSaveDirections}
              className={`flex-shrink-0 inline-flex items-center justify-center w-9 rounded-card border transition-colors focus-ring disabled:opacity-40 ${
                directionsDirty
                  ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
                  : 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
              }`}
            >
              {savingDirections ? <Loader2 className="w-4 h-4 animate-spin" /> : directionsDirty ? <Bookmark className="w-4 h-4" /> : <BookmarkCheck className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerateQuestions} disabled={busy} size="sm" variant="accent" accentColor="violet">
            {busy && studioPhase === 'questions' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1.5" />}
            {t.training.studioGenerateQuestions}
          </Button>
          <Button onClick={handleDraftAll} disabled={busy || rows.every((r) => !r.question.trim())} size="sm" variant="secondary">
            {busy && studioPhase === 'answers' ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Bot className="w-4 h-4 mr-1.5" />}
            {t.training.studioDraftAll}
          </Button>
          {busy && (
            <button onClick={() => void cancelStudio()} className="typo-caption text-foreground hover:text-red-400 transition-colors inline-flex items-center gap-1 focus-ring rounded-interactive px-1.5 py-0.5">
              <X className="w-3.5 h-3.5" /> {t.training.studioCancel}
            </button>
          )}
          <div className="flex-1" />
          <Button onClick={() => void handleSave()} disabled={includedCount === 0 || savingPairs || busy} size="sm" variant="accent" accentColor="emerald">
            {savingPairs ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
            {tx(t.training.studioSaveApproved, { count: includedCount })}
          </Button>
        </div>

        {busy ? (
          <div className="space-y-1.5">
            <p className="typo-caption text-violet-300 inline-flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" />
              {studioPhase === 'answers'
                ? tx(t.training.studioRunningAnswers, { completed: studioCompleted, total: studioTotal })
                : t.training.studioRunningQuestions}
            </p>
            {studioPhase === 'answers' && studioTotal > 0 && (
              <div className="h-1 rounded-full bg-secondary/40 overflow-hidden max-w-md">
                <motion.div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                  animate={{ width: `${Math.round((studioCompleted / studioTotal) * 100)}%` }} transition={{ duration: 0.3 }} />
              </div>
            )}
            <p className="text-[10px] text-foreground">{t.training.studioBackgroundNote}</p>
          </div>
        ) : (
          <p className="text-[10px] text-foreground">{t.training.studioTagline}</p>
        )}
      </div>

      {/* Board */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-4">
        <div className="max-w-5xl mx-auto space-y-3">
          {rows.length === 0 ? (
            <div className="text-center py-16">
              <Sparkles className="w-8 h-8 text-violet-300/60 mx-auto mb-3" />
              <p className="typo-card-label text-foreground mb-1">{t.training.studioEmptyTitle}</p>
              <p className="typo-caption text-foreground">{t.training.studioEmptyHint}</p>
            </div>
          ) : (
            rows.map((row, idx) => {
              const words = wordCount(row.answer);
              const tier = words === 0 ? 'empty' : words < 15 ? 'thin' : words < 60 ? 'ok' : 'rich';
              const tierClass = tier === 'rich' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
                : tier === 'ok' ? 'text-amber-300 bg-amber-500/10 border-amber-500/25'
                : tier === 'thin' ? 'text-rose-300 bg-rose-500/10 border-rose-500/25'
                : 'text-foreground bg-secondary/40 border-primary/10';
              const isDrafting = draftingRowId === row.id;
              return (
                <div key={row.id} className="rounded-card border border-primary/10 bg-card/40 p-3 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr_auto] gap-3">
                  {/* Question (D2) */}
                  <div className="flex gap-2 min-w-0">
                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-bold flex items-center justify-center mt-0.5 tabular-nums">{idx + 1}</span>
                    <textarea
                      value={row.question}
                      onChange={(e) => updateRow(row.id, { question: e.target.value })}
                      rows={2}
                      className="flex-1 resize-none rounded-interactive border border-primary/10 bg-background px-2.5 py-1.5 typo-caption text-foreground focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/15 min-h-[3rem]"
                    />
                  </div>

                  {/* Answer (D4 — twin simulation) */}
                  <div className="min-w-0">
                    <textarea
                      value={row.answer}
                      onChange={(e) => updateRow(row.id, { answer: e.target.value, aiDrafted: false })}
                      rows={2}
                      placeholder={t.training.studioAnswerPlaceholder}
                      className="w-full resize-none rounded-interactive border border-primary/10 bg-background px-2.5 py-1.5 typo-caption text-foreground placeholder:text-foreground/40 focus:border-violet-500/40 focus:outline-none focus:ring-1 focus:ring-violet-500/15 min-h-[3rem]"
                    />
                    <div className="flex items-center gap-2 mt-1">
                      {row.aiDrafted && <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider text-violet-300"><Bot className="w-2.5 h-2.5" /> twin</span>}
                      {row.answer.trim() && <span className={`px-1.5 py-0.5 rounded-full text-[9px] border tabular-nums ${tierClass}`}>{tx(t.training.studioWordCount, { count: words })}</span>}
                    </div>
                  </div>

                  {/* Per-row controls */}
                  <div className="flex lg:flex-col items-center justify-end gap-1.5">
                    <button
                      onClick={() => void handleDraftRow(row)}
                      disabled={!row.question.trim() || isDrafting || busy}
                      title={t.training.studioDraftOne}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/15 focus-ring transition-colors disabled:opacity-30 typo-caption"
                    >
                      {isDrafting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : row.aiDrafted ? <Wand2 className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => updateRow(row.id, { include: !row.include })}
                      title={t.training.studioSaveApproved.replace('{count}', '')}
                      aria-pressed={row.include}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-interactive border transition-colors focus-ring ${
                        row.include ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' : 'bg-secondary/40 border-primary/10 text-foreground hover:text-emerald-300'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                      title={t.training.studioRemoveRow}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-interactive text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors focus-ring"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}

          <button
            onClick={() => setRows((prev) => [...prev, newRow()])}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-card border border-dashed border-primary/15 text-foreground hover:text-violet-300 hover:border-violet-500/30 transition-colors typo-caption focus-ring disabled:opacity-40"
          >
            <Plus className="w-4 h-4" /> {t.training.studioAddQuestion}
          </button>

          {rows.some((r) => r.include && r.answer.trim()) && (
            <div className="flex justify-end pt-1">
              <button onClick={() => setTwinTab('knowledge')} className="typo-caption text-foreground hover:text-violet-300 transition-colors">
                {t.training.reviewMemories}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
