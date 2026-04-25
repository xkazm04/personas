import { useEffect, useMemo } from 'react';
import { GraduationCap, Send, Sparkles, Save, RotateCcw, BookOpen, ArrowRight, Terminal, Hash } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { useTrainingSession, TRAINING_TOPIC_PRESETS } from './useTrainingSession';

/* ------------------------------------------------------------------ *
 *  Console — "Interview Console"
 *  Topic grid with stats. Interview as a split-pane: left questions
 *  index with numeric hotkeys, right active answer. Dense KPI tiles.
 * ------------------------------------------------------------------ */

function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }

export default function TrainingConsole() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const session = useTrainingSession();

  const stats = useMemo(() => {
    const followups = session.questions.filter((q) => q.isFollowup).length;
    const totalWords = session.questions.reduce((s2, q) => s2 + wordCount(q.answer), 0);
    return { total: session.questions.length, saved: session.savedCount, followups, totalWords };
  }, [session.questions, session.savedCount]);

  // Numeric jump hotkeys (1-9) when interviewing
  useEffect(() => {
    if (session.phase !== 'interview') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (session.answerDraft.trim() && !session.saving) void session.handleSubmitAnswer();
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < session.questions.length) session.jumpTo(idx);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [session]);

  if (!activeTwinId || !activeTwin) return <TwinEmptyState icon={GraduationCap} title={t.training.title} />;

  const currentQ = session.questions[session.currentIdx];
  const isOnFollowup = !!currentQ?.isFollowup;
  const progressPct = session.questions.length === 0 ? 0
    : (session.savedCount / session.questions.length) * 100;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Strip header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/10 bg-card/40">
        <div className="w-8 h-8 rounded-interactive bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
          <Terminal className="w-4 h-4 text-violet-300" />
        </div>
        <div className="flex flex-col leading-tight min-w-0">
          <h1 className="typo-card-label">interview / {activeTwin.name}</h1>
          <span className="typo-caption text-foreground/55 truncate">{t.training.subtitle}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-stretch gap-2 mr-2">
          <Tile label="grounding" value={session.groundingFacts.length} accent={session.groundingFacts.length >= 20 ? 'emerald' : session.groundingFacts.length >= 5 ? 'amber' : 'violet'} />
          {session.phase !== 'topic' && (<>
            <Tile label="answered" value={`${stats.saved}/${stats.total}`} accent={stats.saved === stats.total && stats.total > 0 ? 'emerald' : 'violet'} />
            <Tile label="follow-ups" value={stats.followups} />
            <Tile label="words" value={stats.totalWords} />
          </>)}
        </div>
        {session.phase !== 'topic' && (
          <Button onClick={session.handleReset} variant="ghost" size="sm">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />{t.training.newSession}
          </Button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* ── TOPIC PHASE — dense grid ───────────────────────────── */}
        {session.phase === 'topic' && (
          <div className="h-full overflow-y-auto px-4 md:px-6 xl:px-8 py-6">
            <div className="max-w-4xl mx-auto">
              <div className="rounded-card border border-primary/10 bg-card/40 p-4 mb-4">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-violet-300" />
                  <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/55 font-medium">select topic</p>
                  <span className="ml-auto typo-caption text-foreground/55">{TRAINING_TOPIC_PRESETS.length} presets · 1 custom</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {TRAINING_TOPIC_PRESETS.map((topic, i) => (
                    <button
                      key={topic.id}
                      onClick={() => session.generateQuestions(topic.prompt)}
                      disabled={session.generating}
                      className="group flex items-start gap-3 p-3 rounded-interactive border border-primary/10 bg-background/60 hover:border-violet-500/30 hover:bg-violet-500/5 transition-colors text-left"
                    >
                      <span className="font-mono text-[10px] text-foreground/55 mt-1">{String(i + 1).padStart(2, '0')}</span>
                      <div className="flex-1 min-w-0">
                        <p className="typo-card-label">{t.training[topic.labelKey as keyof typeof t.training] as string}</p>
                        <p className="typo-caption text-foreground/65 mt-0.5 line-clamp-2">{topic.prompt}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-foreground/40 group-hover:text-violet-300 transition-colors mt-1" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-card border border-violet-500/20 bg-violet-500/5 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Hash className="w-3.5 h-3.5 text-violet-300" />
                  <p className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-medium">custom topic</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder={t.training.customTopicPlaceholder}
                    value={session.customTopic}
                    onChange={(e) => session.setCustomTopic(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && session.customTopic.trim()) session.generateQuestions(session.customTopic.trim()); }}
                    className={INPUT_FIELD}
                  />
                  <Button onClick={() => session.customTopic.trim() && session.generateQuestions(session.customTopic.trim())} disabled={session.generating || !session.customTopic.trim()} size="sm" variant="accent" accentColor="violet">
                    {session.generating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Sparkles className="w-3.5 h-3.5 mr-1.5" />generate</>}
                  </Button>
                </div>
                {session.generating && <p className="typo-caption text-violet-300 mt-2 animate-pulse">{t.training.generatingQuestions}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── INTERVIEW PHASE — split pane ────────────────────────── */}
        {session.phase === 'interview' && (
          <div className="h-full grid grid-cols-1 md:grid-cols-[280px_1fr] overflow-hidden">

            {/* LEFT — questions index */}
            <aside className="border-r border-primary/10 overflow-y-auto bg-card/20">
              <div className="px-3 py-3 sticky top-0 bg-card/40 backdrop-blur border-b border-primary/5 z-[1]">
                <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-medium">questions</p>
                <div className="mt-2 h-1 rounded-full bg-secondary/40 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-[10px] tabular-nums text-foreground/55">{stats.saved}/{stats.total} saved</span>
                  <span className="text-[10px] uppercase tracking-wider text-foreground/40">press 1-9 to jump</span>
                </div>
              </div>
              <ol className="p-2 space-y-1">
                {session.questions.map((qa, idx) => {
                  const isCurrent = idx === session.currentIdx;
                  return (
                    <li key={qa.id}>
                      <button
                        onClick={() => session.jumpTo(idx)}
                        className={`w-full text-left flex items-start gap-2 px-2.5 py-2 rounded-interactive border transition-colors ${
                          isCurrent
                            ? 'bg-violet-500/10 border-violet-500/30 text-foreground'
                            : qa.saved
                            ? 'bg-card/40 border-emerald-500/20 hover:border-emerald-500/40'
                            : 'border-transparent hover:bg-secondary/30'
                        }`}
                      >
                        <kbd className={`flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono ${
                          isCurrent ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40'
                          : qa.saved ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-primary/10 text-foreground/55 border border-primary/15'
                        }`}>
                          {idx < 9 ? idx + 1 : '·'}
                        </kbd>
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs leading-tight line-clamp-2 ${isCurrent ? 'text-foreground' : 'text-foreground/75'}`}>{qa.question}</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            {qa.isFollowup && <span className="text-[9px] uppercase tracking-wider text-amber-300">follow-up</span>}
                            {qa.saved && <span className="text-[9px] uppercase tracking-wider text-emerald-300">· saved</span>}
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </aside>

            {/* RIGHT — active answer */}
            <div className="flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5">
                {currentQ && (
                  <>
                    <div className="flex items-start gap-3 mb-4">
                      <div className={`flex-shrink-0 w-9 h-9 rounded-card bg-card/60 border ${isOnFollowup ? 'border-amber-500/40' : 'border-violet-500/40'} flex items-center justify-center`}>
                        {isOnFollowup ? <ArrowRight className="w-4 h-4 text-amber-300" /> : <GraduationCap className="w-4 h-4 text-violet-300" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/55 font-mono">Q{session.currentIdx + 1}/{session.questions.length}</span>
                          {isOnFollowup && (
                            <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
                              {t.training.followupBadge}
                            </span>
                          )}
                        </div>
                        <p className="text-base font-medium text-foreground leading-relaxed">{currentQ.question}</p>
                      </div>
                    </div>

                    {currentQ.answer && currentQ.saved && (
                      <div className="mt-4 rounded-card border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Save className="w-3 h-3 text-emerald-300" />
                          <span className="text-[10px] uppercase tracking-[0.18em] text-emerald-300 font-medium">{t.training.savedToMemory}</span>
                        </div>
                        <p className="typo-body text-foreground/85 leading-relaxed">{currentQ.answer}</p>
                      </div>
                    )}

                    {session.followupLoading && (
                      <p className="flex items-center gap-2 typo-caption text-amber-300 animate-pulse mt-3"><Sparkles className="w-3 h-3" /> {t.training.generatingFollowup}</p>
                    )}
                    {session.summarizing && (
                      <p className="flex items-center gap-2 typo-caption text-violet-300 animate-pulse mt-3"><Sparkles className="w-3 h-3" /> {t.training.summarizingSession}</p>
                    )}
                  </>
                )}
              </div>

              {/* Answer dock */}
              <div className="flex-shrink-0 border-t border-primary/10 bg-card/40 px-4 md:px-6 py-3">
                <div className="flex gap-2 items-end">
                  <textarea
                    ref={session.answerRef}
                    value={session.answerDraft}
                    onChange={(e) => session.setAnswerDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void session.handleSubmitAnswer(); } }}
                    placeholder={t.training.answerPlaceholder}
                    disabled={session.saving || session.followupLoading || session.summarizing}
                    rows={1}
                    autoFocus
                    className="flex-1 resize-none rounded-card border border-primary/15 bg-background px-3 py-2.5 typo-body text-foreground placeholder:text-foreground/45 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/15 disabled:opacity-50 min-h-[44px] max-h-[200px] transition-colors"
                    onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }}
                  />
                  {isOnFollowup && (
                    <button onClick={() => void session.handleSkipFollowup()} disabled={session.saving || session.followupLoading}
                      className="flex-shrink-0 h-11 px-3 rounded-card border border-primary/15 text-xs text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-30">
                      {t.training.skipFollowup}
                    </button>
                  )}
                  <button onClick={() => void session.handleSubmitAnswer()} disabled={!session.answerDraft.trim() || session.saving || session.followupLoading || session.summarizing}
                    className="flex-shrink-0 w-11 h-11 rounded-card bg-violet-500 text-white flex items-center justify-center hover:bg-violet-500/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    {session.saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px] text-foreground/55">
                  <Kbd>↵</Kbd> submit
                  <Kbd>shift ↵</Kbd> newline
                  <Kbd>1-9</Kbd> jump
                  <span className="ml-auto tabular-nums">{wordCount(session.answerDraft)}w</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── COMPLETE ──────────────────────────────────────────── */}
        {session.phase === 'complete' && (
          <div className="h-full overflow-y-auto px-4 md:px-6 py-6">
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="rounded-card border border-emerald-500/25 bg-emerald-500/5 p-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-card bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-emerald-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-300 font-medium">session.complete</p>
                    <h2 className="typo-section-title">{t.training.sessionComplete}</h2>
                    <p className="typo-caption text-foreground/65 mt-0.5">
                      {t.training.sessionCompleteDetail.replace('{saved}', String(session.savedCount)).replace('{total}', String(session.questions.length))}
                    </p>
                  </div>
                  <div className="flex items-stretch gap-2">
                    <Tile label="saved" value={stats.saved} accent="emerald" />
                    <Tile label="words" value={stats.totalWords} />
                  </div>
                </div>
              </div>

              {session.sessionSummary && (
                <div className="rounded-card border border-violet-500/20 bg-card/40 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-500/15 bg-violet-500/8">
                    <Sparkles className="w-3.5 h-3.5 text-violet-300" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-medium">{t.training.sessionSummaryHeading}</span>
                  </div>
                  <div className="p-5">
                    <p className="typo-body text-foreground leading-relaxed whitespace-pre-wrap">{session.sessionSummary}</p>
                    <p className="typo-caption text-foreground/55 italic mt-4 pt-4 border-t border-primary/5">{t.training.summarySaved}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3">
                <Button onClick={session.handleReset} variant="accent" accentColor="violet" size="sm">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />{t.training.trainMore}
                </Button>
                <Button onClick={() => setTwinTab('knowledge')} variant="ghost" size="sm">
                  <BookOpen className="w-3.5 h-3.5 mr-1.5" />{t.training.reviewMemories}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300 border-emerald-500/25' : accent === 'amber' ? 'text-amber-300 border-amber-500/25' : 'text-violet-300 border-violet-500/25';
  return (
    <div className={`rounded-interactive border ${tone} bg-card/40 px-2.5 py-1 flex flex-col items-center min-w-[64px]`}>
      <span className="typo-data-lg tabular-nums leading-none">{value}</span>
      <span className="text-[9px] uppercase tracking-[0.16em] text-foreground/55 mt-0.5">{label}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/15 text-[10px] font-mono text-foreground/75">{children}</kbd>;
}
