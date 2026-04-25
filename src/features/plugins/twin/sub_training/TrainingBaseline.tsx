import { useState, useRef, useEffect, useCallback } from 'react';
import { GraduationCap, Send, Sparkles, Save, RotateCcw, BookOpen, ArrowRight } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import * as twinApi from '@/api/twin/twin';
import { TwinEmptyState } from '../TwinEmptyState';
import { useTwinTranslation } from '../i18n/useTwinTranslation';
import { CoachMark } from '../CoachMark';

interface QAPair { id: string; question: string; answer: string; saved: boolean; isFollowup?: boolean; }
const MIN_RICH_WORDS = 15;
const GROUNDING_LIMIT = 12;

const TOPIC_PRESETS = [
  { id: 'background', labelKey: 'topicBackground', prompt: 'Ask me about my professional background, career history, and current role.' },
  { id: 'opinions', labelKey: 'topicOpinions', prompt: 'Ask me about my opinions on technology, tools, and frameworks I use or recommend.' },
  { id: 'communication', labelKey: 'topicCommunication', prompt: 'Ask me how I prefer to communicate — formality, humor, directness, and what I avoid.' },
  { id: 'values', labelKey: 'topicValues', prompt: 'Ask me about my core values, principles, and what matters most to me professionally.' },
  { id: 'expertise', labelKey: 'topicExpertise', prompt: 'Ask me deep questions about my areas of expertise and specialized knowledge.' },
  { id: 'personal', labelKey: 'topicPersonal', prompt: 'Ask me about my interests, hobbies, and things I enjoy outside of work.' },
] as const;

function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }

export default function TrainingBaseline() {
  const { t } = useTwinTranslation();
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((tp) => tp.id === activeTwinId);
  const recordTwinInteraction = useSystemStore((s) => s.recordTwinInteraction);

  const [phase, setPhase] = useState<'topic' | 'interview' | 'complete'>('topic');
  const [customTopic, setCustomTopic] = useState('');
  const [questions, setQuestions] = useState<QAPair[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerDraft, setAnswerDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [followupLoading, setFollowupLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const followupSpawnedFor = useRef<Set<string>>(new Set());
  const [groundingFacts, setGroundingFacts] = useState<string[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const savedCount = questions.filter((q) => q.saved).length;
  useEffect(() => { scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [currentIdx]);
  useEffect(() => {
    if (!activeTwinId) { setGroundingFacts([]); return; }
    twinApi.listPendingMemories(activeTwinId, 'approved').then((mems) => {
      const facts = mems.slice(0, GROUNDING_LIMIT).map((m) => m.title ? `${m.title}: ${m.content}` : m.content);
      setGroundingFacts(facts);
    }).catch(() => setGroundingFacts([]));
  }, [activeTwinId]);

  const callAi = async (prompt: string): Promise<string> => {
    if (!activeTwin) throw new Error('no active twin');
    return invoke<string>('twin_generate_bio', { name: activeTwin.name, role: activeTwin.role ?? null, keywords: prompt });
  };

  const generateQuestions = useCallback(async (topicPrompt: string) => {
    if (!activeTwin) return;
    setGenerating(true); setSessionSummary(null); followupSpawnedFor.current = new Set();
    const groundingBlock = groundingFacts.length > 0 ? `\n\nAlready known about ${activeTwin.name} (do NOT re-ask these — build on or around them):\n${groundingFacts.map((f) => `- ${f.slice(0, 200)}${f.length > 200 ? '…' : ''}`).join('\n')}` : '';
    try {
      const prompt = `You are interviewing someone to build a digital twin profile. Their name is "${activeTwin.name}"${activeTwin.role ? `, role: ${activeTwin.role}` : ''}${activeTwin.bio ? `. Bio: ${activeTwin.bio}` : ''}.\n\nTopic: ${topicPrompt}${groundingBlock}\n\nGenerate exactly 5 interview questions. Each question should:\n- Be specific and conversational (not generic)\n- Help capture their unique perspective, tone, and knowledge\n- Build on existing facts where possible — never duplicate them\n\nOutput ONLY the questions, one per line, numbered 1-5. No other text.`;
      const result = await callAi(prompt);
      const lines = result.split('\n').map((l) => l.replace(/^\d+[.)]\s*/, '').trim()).filter((l) => l.length > 10);
      const qaPairs: QAPair[] = lines.slice(0, 5).map((q, i) => ({ id: `q-${Date.now()}-${i}`, question: q, answer: '', saved: false }));
      if (qaPairs.length === 0) qaPairs.push({ id: `q-${Date.now()}-0`, question: `Tell me about ${topicPrompt.toLowerCase()}`, answer: '', saved: false });
      setQuestions(qaPairs); setCurrentIdx(0); setAnswerDraft(''); setPhase('interview');
    } catch {
      const fallback: QAPair[] = [
        { id: 'f1', question: `What's your background in ${topicPrompt.toLowerCase()}?`, answer: '', saved: false },
        { id: 'f2', question: `What's your strongest opinion about this topic?`, answer: '', saved: false },
        { id: 'f3', question: `How would you explain this to someone new?`, answer: '', saved: false },
      ];
      setQuestions(fallback); setCurrentIdx(0); setPhase('interview');
    } finally { setGenerating(false); }
  }, [activeTwin, groundingFacts]);

  const generateFollowup = async (parent: QAPair, parentAnswer: string): Promise<string | null> => {
    if (!activeTwin) return null;
    try {
      const followupPrompt = `Original question: "${parent.question}"\nTheir (terse) answer: "${parentAnswer}"\n\nAsk ONE concise follow-up question that gets them to elaborate — pick the most interesting unexplored angle. Output the question only, no preamble.`;
      const raw = await callAi(followupPrompt);
      return raw.split('\n').map((l) => l.replace(/^\d+[.)]\s*/, '').trim()).find((l) => l.length > 5) ?? null;
    } catch { return null; }
  };

  const summarizeSession = async (qaPairs: QAPair[]): Promise<string | null> => {
    if (!activeTwin) return null;
    const transcript = qaPairs.filter((q) => q.answer.trim()).map((q, i) => `Q${i + 1}: ${q.question}\nA: ${q.answer}`).join('\n\n');
    if (!transcript) return null;
    try {
      const prompt = `Below is a training interview with ${activeTwin.name}. Write a 3-5 sentence summary capturing the most distinctive, persona-shaping facts and patterns from these answers — what someone would need to know to speak as ${activeTwin.name}. No preamble, no headings, just the summary paragraph.\n\n${transcript}`;
      return (await callAi(prompt)).trim() || null;
    } catch { return null; }
  };

  const advanceOrComplete = async (qaPairs: QAPair[], nextIdx: number) => {
    if (nextIdx < qaPairs.length) { setCurrentIdx(nextIdx); setTimeout(() => answerRef.current?.focus(), 100); return; }
    setSummarizing(true);
    try {
      const summary = await summarizeSession(qaPairs);
      if (summary && activeTwinId) {
        setSessionSummary(summary);
        await recordTwinInteraction(activeTwinId, 'training', 'out', summary, undefined, `Training session summary — ${new Date().toLocaleDateString()}`, JSON.stringify({ kind: 'session_summary', qa_count: qaPairs.length }), true);
      }
    } finally { setSummarizing(false); setPhase('complete'); }
  };

  const handleSubmitAnswer = async () => {
    if (!answerDraft.trim() || !activeTwinId) return;
    const q = questions[currentIdx]; if (!q) return;
    const trimmedAnswer = answerDraft.trim();
    const updated = [...questions]; updated[currentIdx] = { ...q, answer: trimmedAnswer }; setQuestions(updated);
    setSaving(true);
    try {
      await recordTwinInteraction(activeTwinId, 'training', 'out', trimmedAnswer, undefined, `Training Q&A: ${q.question}`, JSON.stringify([{ q: q.question, a: trimmedAnswer }]), true);
      updated[currentIdx] = { ...updated[currentIdx]!, answer: trimmedAnswer, saved: true }; setQuestions([...updated]);
    } finally { setSaving(false); }
    setAnswerDraft('');
    const isTerse = wordCount(trimmedAnswer) < MIN_RICH_WORDS;
    if (isTerse && !followupSpawnedFor.current.has(q.id)) {
      followupSpawnedFor.current.add(q.id);
      setFollowupLoading(true);
      const followupQ = await generateFollowup(q, trimmedAnswer);
      setFollowupLoading(false);
      if (followupQ) {
        const next = [...updated.slice(0, currentIdx + 1), { id: `fu-${Date.now()}`, question: followupQ, answer: '', saved: false, isFollowup: true }, ...updated.slice(currentIdx + 1)];
        setQuestions(next); await advanceOrComplete(next, currentIdx + 1); return;
      }
    }
    await advanceOrComplete(updated, currentIdx + 1);
  };

  const handleSkipFollowup = async () => {
    const next = [...questions.slice(0, currentIdx), ...questions.slice(currentIdx + 1)];
    setQuestions(next); setAnswerDraft('');
    if (next.length === 0) { await advanceOrComplete(questions.filter((_, i) => i !== currentIdx), questions.length - 1); return; }
    if (currentIdx >= next.length) await advanceOrComplete(next, next.length);
    else { setCurrentIdx(currentIdx); setTimeout(() => answerRef.current?.focus(), 100); }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmitAnswer(); } };
  const handleReset = () => {
    setPhase('topic'); setQuestions([]); setCurrentIdx(0); setAnswerDraft(''); setCustomTopic(''); setSessionSummary(null); followupSpawnedFor.current = new Set();
  };

  if (!activeTwinId || !activeTwin) return <TwinEmptyState icon={GraduationCap} title={t.training.title} />;
  const currentQ = questions[currentIdx];
  const isOnFollowup = !!currentQ?.isFollowup;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GraduationCap className="w-5 h-5 text-violet-400" />} iconColor="violet"
        title={`${t.training.title} — ${activeTwin.name}`} subtitle={t.training.subtitle}
        actions={phase !== 'topic' ? <Button onClick={handleReset} variant="ghost" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1.5" />{t.training.newSession}</Button> : undefined}
      />

      <ContentBody>
        <div className="h-full flex flex-col">
          {phase === 'topic' && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto px-4 py-8">
              <div className="w-full mb-6"><CoachMark id="training" title={t.coach.trainingTitle} body={t.coach.trainingBody} /></div>
              <GraduationCap className="w-12 h-12 text-violet-400/40 mb-4" />
              <h2 className="typo-section-title mb-1">{t.training.whatToTrain}</h2>
              <p className="typo-caption text-foreground mb-2 text-center">{t.training.topicHint}</p>
              {groundingFacts.length > 0 && (
                <div className="flex items-center gap-2 mb-4 text-center">
                  <span className="typo-caption text-foreground">{t.nudges.trainingStat}:</span>
                  <span className={`typo-caption font-medium ${groundingFacts.length >= 20 ? 'text-emerald-400' : groundingFacts.length >= 5 ? 'text-amber-400' : 'text-violet-400'}`}>
                    {groundingFacts.length >= 20 ? t.nudges.trainingStatStrong : groundingFacts.length >= 5 ? t.nudges.trainingStatMedium : t.nudges.trainingStatLight}
                  </span>
                  <span className="typo-caption text-foreground">· {groundingFacts.length} {t.brain.documents}</span>
                </div>
              )}
              {groundingFacts.length > 0 && <p className="typo-caption text-violet-400/80 mb-4 text-center">{t.training.groundingHint.replace('{count}', String(groundingFacts.length))}</p>}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full mb-6 mt-2">
                {TOPIC_PRESETS.map((topic) => (
                  <button key={topic.id} onClick={() => generateQuestions(topic.prompt)} disabled={generating}
                    className="p-3 rounded-card border border-primary/10 bg-card/40 hover:border-violet-500/20 hover:bg-violet-500/5 transition-colors text-left">
                    <p className="typo-body text-foreground font-medium">{t.training[topic.labelKey as keyof typeof t.training]}</p>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 w-full">
                <input type="text" placeholder={t.training.customTopicPlaceholder} value={customTopic} onChange={(e) => setCustomTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customTopic.trim()) generateQuestions(customTopic.trim()); }}
                  className={INPUT_FIELD} />
                <Button onClick={() => customTopic.trim() && generateQuestions(customTopic.trim())} disabled={generating || !customTopic.trim()} size="sm">
                  {generating ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Sparkles className="w-4 h-4" />}
                </Button>
              </div>
              {generating && <p className="typo-caption text-violet-400 mt-4 animate-pulse">{t.training.generatingQuestions}</p>}
            </div>
          )}

          {phase === 'interview' && (
            <>
              <div className="px-4 py-3 border-b border-primary/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="typo-caption text-foreground">{t.training.questionProgress.replace('{current}', String(currentIdx + 1)).replace('{total}', String(questions.length))}</span>
                  <span className="typo-caption text-foreground">{t.training.savedCount.replace('{count}', String(savedCount))}</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                  <div className="h-full rounded-full bg-violet-400 transition-all duration-300"
                    style={{ width: `${((currentIdx + (answerDraft ? 0.5 : 0)) / Math.max(questions.length, 1)) * 100}%` }} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="max-w-2xl mx-auto space-y-4">
                  {questions.map((qa, idx) => (
                    <div key={qa.id} ref={idx === currentIdx ? scrollRef : undefined}>
                      <div className="flex gap-3 mb-2">
                        <div className={`w-7 h-7 rounded-interactive flex items-center justify-center flex-shrink-0 mt-0.5 ${qa.isFollowup ? 'bg-amber-500/10' : 'bg-violet-500/10'}`}>
                          {qa.isFollowup ? <ArrowRight className="w-3.5 h-3.5 text-amber-400" /> : <GraduationCap className="w-3.5 h-3.5 text-violet-400" />}
                        </div>
                        <div className="flex-1">
                          {qa.isFollowup && <span className="inline-block px-1.5 py-0.5 text-[9px] font-medium rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25 mb-1">{t.training.followupBadge}</span>}
                          <p className="typo-body text-foreground">{qa.question}</p>
                        </div>
                      </div>
                      {qa.answer && (
                        <div className="flex gap-3 ml-10">
                          <div className="flex-1 p-3 rounded-card bg-violet-500/5 border border-violet-500/10">
                            <p className="typo-body text-foreground">{qa.answer}</p>
                            {qa.saved && <div className="flex items-center gap-1 mt-2"><Save className="w-3 h-3 text-emerald-400" /><span className="text-md text-emerald-400">{t.training.savedToMemory}</span></div>}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                  {followupLoading && <p className="typo-caption text-amber-400 animate-pulse pl-10">{t.training.generatingFollowup}</p>}
                  {summarizing && <p className="typo-caption text-violet-400 animate-pulse pl-10">{t.training.summarizingSession}</p>}
                </div>
              </div>
              <div className="border-t border-primary/5 bg-secondary/[0.03] px-4 py-3">
                <div className="max-w-2xl mx-auto flex gap-2 items-end">
                  <textarea ref={answerRef} value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder={t.training.answerPlaceholder} disabled={saving || followupLoading || summarizing} rows={1} autoFocus
                    className="flex-1 resize-none rounded-card border border-primary/10 bg-background px-4 py-3 typo-body text-foreground placeholder:text-foreground focus-ring disabled:opacity-50 min-h-[44px] max-h-[160px] transition-colors"
                    onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 160) + 'px'; }} />
                  {isOnFollowup && (
                    <button onClick={() => void handleSkipFollowup()} disabled={saving || followupLoading}
                      className="flex-shrink-0 h-10 px-3 rounded-card border border-primary/10 text-md text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-30">
                      {t.training.skipFollowup}
                    </button>
                  )}
                  <button onClick={() => void handleSubmitAnswer()} disabled={!answerDraft.trim() || saving || followupLoading || summarizing}
                    className="flex-shrink-0 w-10 h-10 rounded-card bg-violet-500 text-white flex items-center justify-center hover:bg-violet-500/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                    {saving ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-md text-foreground mt-1.5 text-center select-none max-w-2xl mx-auto">{t.training.enterToSubmit}</p>
              </div>
            </>
          )}

          {phase === 'complete' && (
            <div className="flex-1 flex flex-col items-center max-w-2xl mx-auto px-4 py-8 overflow-y-auto">
              <div className="w-16 h-16 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <BookOpen className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="typo-section-title mb-1">{t.training.sessionComplete}</h2>
              <p className="typo-caption text-foreground mb-4 text-center">{t.training.sessionCompleteDetail.replace('{saved}', String(savedCount)).replace('{total}', String(questions.length))}</p>
              {sessionSummary && (
                <div className="w-full p-4 rounded-card border border-violet-500/20 bg-violet-500/5 mb-4">
                  <p className="typo-caption text-violet-400 font-medium mb-2">{t.training.sessionSummaryHeading}</p>
                  <p className="typo-body text-foreground whitespace-pre-wrap leading-relaxed">{sessionSummary}</p>
                  <p className="typo-caption text-foreground mt-3 italic">{t.training.summarySaved}</p>
                </div>
              )}
              <div className="flex items-center gap-3 mt-2">
                <Button onClick={handleReset} variant="accent" accentColor="violet" size="sm"><RotateCcw className="w-3.5 h-3.5 mr-1.5" />{t.training.trainMore}</Button>
                <Button onClick={() => useSystemStore.getState().setTwinTab('knowledge')} variant="ghost" size="sm"><BookOpen className="w-3.5 h-3.5 mr-1.5" />{t.training.reviewMemories}</Button>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
