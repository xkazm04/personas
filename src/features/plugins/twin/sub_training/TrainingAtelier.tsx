import { motion, AnimatePresence } from 'framer-motion';
import { GraduationCap, Send, Sparkles, Save, RotateCcw, BookOpen, ArrowRight, Briefcase, Lightbulb, MessageSquare, Compass, Rocket, Heart, Quote } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { useTrainingSession, TRAINING_TOPIC_PRESETS } from './useTrainingSession';

/* ------------------------------------------------------------------ *
 *  Atelier — "Studio Interview"
 *  Topic deck of richly illustrated cards, hero question on a stage with
 *  a rotating progress halo, trail of past Q&A as story cards, and a
 *  certificate-style complete screen.
 * ------------------------------------------------------------------ */

const TOPIC_ICONS: Record<string, typeof Briefcase> = {
  background: Briefcase, opinions: Lightbulb, communication: MessageSquare,
  values: Compass, expertise: Rocket, personal: Heart,
};
const TOPIC_TINTS: Record<string, string> = {
  background: 'from-violet-500/20 to-fuchsia-500/15',
  opinions: 'from-amber-500/20 to-orange-500/10',
  communication: 'from-cyan-500/20 to-sky-500/10',
  values: 'from-emerald-500/20 to-teal-500/10',
  expertise: 'from-indigo-500/20 to-violet-500/10',
  personal: 'from-rose-500/20 to-pink-500/10',
};

export default function TrainingAtelier() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const setTwinTab = useSystemStore((s) => s.setTwinTab);
  const session = useTrainingSession();

  if (!activeTwinId || !activeTwin) return <TwinEmptyState icon={GraduationCap} title={t.training.title} />;

  const currentQ = session.questions[session.currentIdx];
  const isOnFollowup = !!currentQ?.isFollowup;
  const progressPct = session.questions.length === 0 ? 0
    : ((session.currentIdx + (session.answerDraft ? 0.5 : 0)) / session.questions.length) * 100;
  const groundingTier = session.groundingFacts.length >= 20 ? 'strong' : session.groundingFacts.length >= 5 ? 'medium' : 'light';

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* ── Header band ──────────────────────────────────────────── */}
      <div className="flex-shrink-0 relative overflow-hidden border-b border-primary/10">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-500/20 via-fuchsia-500/12 to-amber-500/8" />
        <div className="absolute inset-0 opacity-25 pointer-events-none">
          <svg className="w-full h-full" viewBox="0 0 800 200" preserveAspectRatio="xMaxYMid slice">
            <g stroke="#a78bfa" strokeWidth="0.6" fill="none">
              {[...Array(8)].map((_, i) => (
                <circle key={i} cx="700" cy="100" r={20 + i * 15} opacity={0.4 - i * 0.04} />
              ))}
            </g>
          </svg>
        </div>
        <div className="relative px-4 md:px-6 xl:px-8 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-card bg-violet-500/15 border border-violet-400/40 flex items-center justify-center">
            <GraduationCap className="w-5 h-5 text-violet-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-[0.22em] text-violet-300/80 font-medium">Studio Interview</p>
            <h1 className="typo-heading-lg text-foreground/95">{t.training.title} — {activeTwin.name}</h1>
            <p className="typo-caption text-foreground/65 mt-0.5">{t.training.subtitle}</p>
          </div>
          <div className="hidden md:flex items-center gap-3 px-3 py-2 rounded-full border border-primary/15 bg-card/40">
            <Stat label="grounding" value={session.groundingFacts.length} accent={groundingTier === 'strong' ? 'emerald' : groundingTier === 'medium' ? 'amber' : 'violet'} />
            {session.phase !== 'topic' && (<>
              <span className="w-px h-6 bg-primary/15" />
              <Stat label="answered" value={`${session.savedCount}/${session.questions.length}`} accent="emerald" />
            </>)}
          </div>
          {session.phase !== 'topic' && (
            <Button onClick={session.handleReset} variant="ghost" size="sm">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />{t.training.newSession}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* ── TOPIC PHASE ────────────────────────────────────────── */}
        {session.phase === 'topic' && (
          <div className="h-full overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 md:px-6 xl:px-8 py-10">
              <div className="text-center mb-8">
                <h2 className="text-2xl font-semibold text-foreground mb-2">{t.training.whatToTrain}</h2>
                <p className="typo-body text-foreground/65">{t.training.topicHint}</p>
                {session.groundingFacts.length > 0 && (
                  <p className="typo-caption text-violet-300 mt-2">{t.training.groundingHint.replace('{count}', String(session.groundingFacts.length))}</p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {TRAINING_TOPIC_PRESETS.map((topic) => {
                  const Icon = TOPIC_ICONS[topic.id] ?? Sparkles;
                  const tint = TOPIC_TINTS[topic.id] ?? 'from-violet-500/15 to-fuchsia-500/10';
                  return (
                    <motion.button
                      key={topic.id}
                      onClick={() => session.generateQuestions(topic.prompt)}
                      disabled={session.generating}
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.99 }}
                      className={`group relative p-5 rounded-card border border-primary/10 bg-gradient-to-br ${tint} hover:border-violet-500/30 hover:shadow-elevation-2 transition-all text-left overflow-hidden`}
                    >
                      <div className="absolute -top-6 -right-6 w-20 h-20 rounded-full bg-violet-500/10 blur-2xl opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="relative flex items-start gap-3">
                        <div className="w-10 h-10 rounded-card bg-card/60 border border-primary/15 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5 text-violet-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="typo-card-label">{t.training[topic.labelKey as keyof typeof t.training] as string}</p>
                          <p className="typo-caption text-foreground/65 mt-1.5 line-clamp-2 leading-relaxed">{topic.prompt}</p>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <div className="rounded-card border border-violet-500/20 bg-violet-500/5 p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-violet-300 font-medium mb-2">custom topic</p>
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
                    {session.generating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  </Button>
                </div>
                {session.generating && <p className="typo-caption text-violet-300 mt-3 animate-pulse">{t.training.generatingQuestions}</p>}
              </div>
            </div>
          </div>
        )}

        {/* ── INTERVIEW PHASE ─────────────────────────────────────── */}
        {session.phase === 'interview' && (
          <div className="h-full flex flex-col">
            {/* Progress halo strip */}
            <div className="flex-shrink-0 px-4 md:px-6 xl:px-8 py-3 border-b border-primary/5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="typo-caption text-foreground/65">{t.training.questionProgress.replace('{current}', String(session.currentIdx + 1)).replace('{total}', String(session.questions.length))}</span>
                <span className="typo-caption text-emerald-300">{t.training.savedCount.replace('{count}', String(session.savedCount))}</span>
              </div>
              <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-violet-400"
                  animate={{ width: `${progressPct}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 md:px-6 py-6">
              <div className="max-w-3xl mx-auto">
                {/* Past Q&A trail */}
                {session.questions.slice(0, session.currentIdx).map((qa) => (
                  <div key={qa.id} className="mb-4 opacity-75 hover:opacity-100 transition-opacity">
                    <div className="flex gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${qa.isFollowup ? 'bg-amber-500/15' : 'bg-violet-500/15'} border border-primary/15`}>
                        {qa.isFollowup ? <ArrowRight className="w-3 h-3 text-amber-300" /> : <GraduationCap className="w-3 h-3 text-violet-300" />}
                      </div>
                      <div className="flex-1">
                        <p className="typo-caption text-foreground/65 leading-relaxed">{qa.question}</p>
                        {qa.answer && (
                          <div className="mt-2 ml-1 pl-3 border-l-2 border-violet-500/20">
                            <p className="typo-body text-foreground/85 leading-relaxed line-clamp-3">{qa.answer}</p>
                            {qa.saved && (
                              <div className="flex items-center gap-1 mt-1">
                                <Save className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] uppercase tracking-wider text-emerald-300">{t.training.savedToMemory}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Current Q — hero stage */}
                {currentQ && (
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentQ.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="my-6"
                    >
                      <div className="relative rounded-card border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-card/40 to-fuchsia-500/8 p-6 md:p-8 shadow-elevation-2 overflow-hidden">
                        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-violet-500/15 blur-3xl pointer-events-none" />
                        <div className="relative flex items-start gap-4">
                          <div className={`relative w-12 h-12 rounded-card bg-card/60 border-2 ${isOnFollowup ? 'border-amber-500/50' : 'border-violet-500/50'} flex items-center justify-center flex-shrink-0`}>
                            {isOnFollowup ? <ArrowRight className="w-5 h-5 text-amber-300" /> : <GraduationCap className="w-5 h-5 text-violet-300" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            {isOnFollowup && (
                              <span className="inline-block px-2 py-0.5 text-[10px] uppercase tracking-wider font-medium rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25 mb-2">
                                {t.training.followupBadge}
                              </span>
                            )}
                            <p className="text-lg font-medium text-foreground leading-relaxed">{currentQ.question}</p>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/45 mt-3 font-medium">your turn</p>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                )}

                {session.followupLoading && (
                  <div className="flex items-center gap-2 ml-10 mt-2 typo-caption text-amber-300 animate-pulse">
                    <Sparkles className="w-3 h-3" /> {t.training.generatingFollowup}
                  </div>
                )}
                {session.summarizing && (
                  <div className="flex items-center gap-2 ml-10 mt-2 typo-caption text-violet-300 animate-pulse">
                    <Sparkles className="w-3 h-3" /> {t.training.summarizingSession}
                  </div>
                )}
              </div>
            </div>

            {/* Answer dock */}
            <div className="flex-shrink-0 border-t border-primary/10 bg-gradient-to-t from-violet-500/5 to-transparent px-4 md:px-6 py-3">
              <div className="max-w-3xl mx-auto flex gap-2 items-end">
                <textarea
                  ref={session.answerRef}
                  value={session.answerDraft}
                  onChange={(e) => session.setAnswerDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void session.handleSubmitAnswer(); } }}
                  placeholder={t.training.answerPlaceholder}
                  disabled={session.saving || session.followupLoading || session.summarizing}
                  rows={1}
                  autoFocus
                  className="flex-1 resize-none rounded-card border border-violet-500/20 bg-background px-4 py-3 typo-body text-foreground placeholder:text-foreground/45 focus:border-violet-500/50 focus:outline-none focus:ring-2 focus:ring-violet-500/15 disabled:opacity-50 min-h-[48px] max-h-[200px] transition-colors"
                  onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 200) + 'px'; }}
                />
                {isOnFollowup && (
                  <button onClick={() => void session.handleSkipFollowup()} disabled={session.saving || session.followupLoading}
                    className="flex-shrink-0 h-12 px-3 rounded-card border border-primary/15 text-xs text-foreground/65 hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-30">
                    {t.training.skipFollowup}
                  </button>
                )}
                <button onClick={() => void session.handleSubmitAnswer()} disabled={!session.answerDraft.trim() || session.saving || session.followupLoading || session.summarizing}
                  className="flex-shrink-0 w-12 h-12 rounded-card bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white flex items-center justify-center hover:shadow-elevation-2 transition-shadow disabled:opacity-30 disabled:cursor-not-allowed">
                  {session.saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-foreground/55 mt-1.5 text-center select-none uppercase tracking-wider max-w-3xl mx-auto">
                {t.training.enterToSubmit}
              </p>
            </div>
          </div>
        )}

        {/* ── COMPLETE PHASE — certificate ─────────────────────────── */}
        {session.phase === 'complete' && (
          <div className="h-full overflow-y-auto">
            <div className="max-w-2xl mx-auto px-4 md:px-6 py-10">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-center">
                <div className="relative w-24 h-24 mx-auto mb-6">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-500/30 to-violet-500/20 blur-2xl" />
                  <div className="relative w-24 h-24 rounded-full bg-card/60 border-2 border-emerald-500/40 flex items-center justify-center">
                    <BookOpen className="w-10 h-10 text-emerald-300" />
                  </div>
                </div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-300 font-medium mb-2">session complete</p>
                <h2 className="text-2xl font-semibold text-foreground mb-2">{t.training.sessionComplete}</h2>
                <p className="typo-body text-foreground/65">
                  {t.training.sessionCompleteDetail.replace('{saved}', String(session.savedCount)).replace('{total}', String(session.questions.length))}
                </p>
              </motion.div>

              {session.sessionSummary && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
                  className="mt-8 rounded-card border border-violet-500/25 bg-gradient-to-br from-violet-500/8 via-card/40 to-fuchsia-500/5 shadow-elevation-2 overflow-hidden">
                  <div className="px-5 py-3 border-b border-violet-500/15 bg-violet-500/10 flex items-center gap-2">
                    <Quote className="w-4 h-4 text-violet-300" />
                    <span className="text-[10px] uppercase tracking-[0.2em] text-violet-300 font-medium">{t.training.sessionSummaryHeading}</span>
                  </div>
                  <div className="p-5 md:p-6">
                    <p className="typo-body text-foreground leading-relaxed whitespace-pre-wrap">{session.sessionSummary}</p>
                    <p className="typo-caption text-foreground/55 italic mt-4 pt-4 border-t border-violet-500/10">{t.training.summarySaved}</p>
                  </div>
                </motion.div>
              )}

              <div className="flex items-center justify-center gap-3 mt-8">
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

function Stat({ label, value, accent = 'violet' }: { label: string; value: number | string; accent?: 'violet' | 'emerald' | 'amber' }) {
  const tone = accent === 'emerald' ? 'text-emerald-300' : accent === 'amber' ? 'text-amber-300' : 'text-violet-300';
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className={`typo-data-lg tabular-nums ${tone}`}>{value}</span>
      <span className="text-[9px] uppercase tracking-[0.18em] text-foreground/55">{label}</span>
    </div>
  );
}
