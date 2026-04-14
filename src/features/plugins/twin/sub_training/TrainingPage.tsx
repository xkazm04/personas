import { useState, useRef, useEffect, useCallback } from 'react';
import { GraduationCap, Send, Sparkles, Save, RotateCcw, BookOpen } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { TwinEmptyState } from '../TwinEmptyState';

/**
 * Training Room — teach the twin through conversation.
 *
 * Flow:
 * 1. User picks a topic area (e.g. "my work background", "tech opinions",
 *    "communication preferences") or enters a custom prompt.
 * 2. The AI generates a set of interview questions tailored to that topic,
 *    using the twin's existing memory + web context if needed.
 * 3. The user answers each question in their own voice/tone.
 * 4. Each Q&A pair is saved as a pending memory for review, building the
 *    twin's knowledge base over time.
 *
 * Powered by Claude Code CLI (same pattern as the Chat module).
 */

interface QAPair {
  id: string;
  question: string;
  answer: string;
  saved: boolean;
}

const TOPIC_PRESETS = [
  { id: 'background', label: 'Work & Background', prompt: 'Ask me about my professional background, career history, and current role.' },
  { id: 'opinions', label: 'Tech Opinions', prompt: 'Ask me about my opinions on technology, tools, and frameworks I use or recommend.' },
  { id: 'communication', label: 'Communication Style', prompt: 'Ask me how I prefer to communicate — formality, humor, directness, and what I avoid.' },
  { id: 'values', label: 'Values & Principles', prompt: 'Ask me about my core values, principles, and what matters most to me professionally.' },
  { id: 'expertise', label: 'Domain Expertise', prompt: 'Ask me deep questions about my areas of expertise and specialized knowledge.' },
  { id: 'personal', label: 'Personal Interests', prompt: 'Ask me about my interests, hobbies, and things I enjoy outside of work.' },
];

export default function TrainingPage() {
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const activeTwin = useSystemStore((s) => s.twinProfiles).find((t) => t.id === activeTwinId);
  const recordTwinInteraction = useSystemStore((s) => s.recordTwinInteraction);

  const [phase, setPhase] = useState<'topic' | 'interview' | 'complete'>('topic');
  const [customTopic, setCustomTopic] = useState('');
  const [questions, setQuestions] = useState<QAPair[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answerDraft, setAnswerDraft] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const savedCount = questions.filter((q) => q.saved).length;

  // Auto-scroll to current question
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIdx]);

  const generateQuestions = useCallback(async (topicPrompt: string) => {
    if (!activeTwin) return;
    setGenerating(true);
    try {
      const prompt = `You are interviewing someone to build a digital twin profile. Their name is "${activeTwin.name}"${activeTwin.role ? `, role: ${activeTwin.role}` : ''}${activeTwin.bio ? `. Bio: ${activeTwin.bio}` : ''}.

Topic: ${topicPrompt}

Generate exactly 5 interview questions. Each question should:
- Be specific and conversational (not generic)
- Help capture their unique perspective, tone, and knowledge
- Build on their existing profile where possible

Output ONLY the questions, one per line, numbered 1-5. No other text.`;

      const result = await invoke<string>("twin_generate_bio", {
        name: activeTwin.name,
        role: activeTwin.role ?? null,
        keywords: prompt,
      });

      const lines = result.split('\n')
        .map((l) => l.replace(/^\d+[\.\)]\s*/, '').trim())
        .filter((l) => l.length > 10);

      const qaPairs: QAPair[] = lines.slice(0, 5).map((q, i) => ({
        id: `q-${Date.now()}-${i}`,
        question: q,
        answer: '',
        saved: false,
      }));

      if (qaPairs.length === 0) {
        qaPairs.push({
          id: `q-${Date.now()}-0`,
          question: `Tell me about ${topicPrompt.toLowerCase()}`,
          answer: '',
          saved: false,
        });
      }

      setQuestions(qaPairs);
      setCurrentIdx(0);
      setAnswerDraft('');
      setPhase('interview');
    } catch {
      // Fallback: generate simple questions from the topic
      const fallback: QAPair[] = [
        { id: 'f1', question: `What's your background in ${topicPrompt.toLowerCase()}?`, answer: '', saved: false },
        { id: 'f2', question: `What's your strongest opinion about this topic?`, answer: '', saved: false },
        { id: 'f3', question: `How would you explain this to someone new?`, answer: '', saved: false },
      ];
      setQuestions(fallback);
      setCurrentIdx(0);
      setPhase('interview');
    } finally {
      setGenerating(false);
    }
  }, [activeTwin]);

  const handleSubmitAnswer = async () => {
    if (!answerDraft.trim() || !activeTwinId) return;
    const q = questions[currentIdx];
    if (!q) return;

    // Save answer into the Q&A pair
    const updated = [...questions];
    updated[currentIdx] = { ...q, answer: answerDraft.trim() };
    setQuestions(updated);

    // Record as a twin interaction + pending memory
    setSaving(true);
    try {
      await recordTwinInteraction(
        activeTwinId,
        'training',
        'out',
        answerDraft.trim(),
        undefined,
        `Training Q&A: ${q.question}`,
        JSON.stringify([{ q: q.question, a: answerDraft.trim() }]),
        true,
      );
      updated[currentIdx] = { ...updated[currentIdx]!, saved: true };
      setQuestions([...updated]);
    } finally {
      setSaving(false);
    }

    // Move to next question or complete
    setAnswerDraft('');
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
      setTimeout(() => answerRef.current?.focus(), 100);
    } else {
      setPhase('complete');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSubmitAnswer(); }
  };

  const handleReset = () => {
    setPhase('topic');
    setQuestions([]);
    setCurrentIdx(0);
    setAnswerDraft('');
    setCustomTopic('');
  };

  if (!activeTwinId || !activeTwin) return <TwinEmptyState icon={GraduationCap} title="Training Room" />;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GraduationCap className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={`Training Room — ${activeTwin.name}`}
        subtitle="Teach the twin by answering questions in your own voice. Each answer becomes a memory."
        actions={phase !== 'topic' ? (
          <Button onClick={handleReset} variant="ghost" size="sm">
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />New Session
          </Button>
        ) : undefined}
      />

      <ContentBody>
        <div className="h-full flex flex-col">

          {/* ── Topic Selection ─────────────────────────────────────── */}
          {phase === 'topic' && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto px-4 py-8">
              <GraduationCap className="w-12 h-12 text-violet-400/40 mb-4" />
              <h2 className="typo-heading text-foreground mb-1">What should we train on?</h2>
              <p className="typo-caption text-muted-foreground mb-6 text-center">
                Pick a topic area or describe your own. AI will generate tailored questions for you to answer.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 w-full mb-6">
                {TOPIC_PRESETS.map((topic) => (
                  <button
                    key={topic.id}
                    onClick={() => generateQuestions(topic.prompt)}
                    disabled={generating}
                    className="p-3 rounded-card border border-primary/10 bg-card/40 hover:border-violet-500/20 hover:bg-violet-500/5 transition-colors text-left"
                  >
                    <p className="typo-body text-foreground font-medium">{topic.label}</p>
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 w-full">
                <input
                  type="text"
                  placeholder="Or describe a custom topic..."
                  value={customTopic}
                  onChange={(e) => setCustomTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && customTopic.trim()) generateQuestions(customTopic.trim()); }}
                  className={INPUT_FIELD}
                />
                <Button
                  onClick={() => customTopic.trim() && generateQuestions(customTopic.trim())}
                  disabled={generating || !customTopic.trim()}
                  size="sm"
                >
                  {generating ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {generating && (
                <p className="typo-caption text-violet-400 mt-4 animate-pulse">Generating questions...</p>
              )}
            </div>
          )}

          {/* ── Interview Phase ─────────────────────────────────────── */}
          {phase === 'interview' && (
            <>
              {/* Progress bar */}
              <div className="px-4 py-3 border-b border-primary/5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="typo-caption text-foreground">Question {currentIdx + 1} of {questions.length}</span>
                  <span className="typo-caption text-muted-foreground">{savedCount} saved</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-violet-400 transition-all duration-300"
                    style={{ width: `${((currentIdx + (answerDraft ? 0.5 : 0)) / questions.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Q&A scroll area */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <div className="max-w-2xl mx-auto space-y-4">
                  {questions.map((qa, idx) => (
                    <div key={qa.id} ref={idx === currentIdx ? scrollRef : undefined}>
                      {/* Question bubble */}
                      <div className="flex gap-3 mb-2">
                        <div className="w-7 h-7 rounded-interactive bg-violet-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <GraduationCap className="w-3.5 h-3.5 text-violet-400" />
                        </div>
                        <div className="flex-1">
                          <p className={`typo-body ${idx <= currentIdx ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                            {qa.question}
                          </p>
                        </div>
                      </div>

                      {/* Answer bubble (if answered) */}
                      {qa.answer && (
                        <div className="flex gap-3 ml-10">
                          <div className="flex-1 p-3 rounded-card bg-violet-500/5 border border-violet-500/10">
                            <p className="typo-body text-foreground">{qa.answer}</p>
                            {qa.saved && (
                              <div className="flex items-center gap-1 mt-2">
                                <Save className="w-3 h-3 text-emerald-400" />
                                <span className="text-[10px] text-emerald-400">Saved to memory</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Answer input */}
              <div className="border-t border-primary/5 bg-secondary/[0.03] px-4 py-3">
                <div className="max-w-2xl mx-auto flex gap-2 items-end">
                  <textarea
                    ref={answerRef}
                    value={answerDraft}
                    onChange={(e) => setAnswerDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Answer in your own voice..."
                    disabled={saving}
                    rows={1}
                    autoFocus
                    className="flex-1 resize-none rounded-card border border-primary/10 bg-background px-4 py-3 typo-body text-foreground placeholder:text-muted-foreground/40 focus-ring disabled:opacity-50 min-h-[44px] max-h-[160px] transition-colors"
                    style={{ height: 'auto', overflow: 'auto' }}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = 'auto';
                      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                    }}
                  />
                  <button
                    onClick={() => void handleSubmitAnswer()}
                    disabled={!answerDraft.trim() || saving}
                    className="flex-shrink-0 w-10 h-10 rounded-card bg-violet-500 text-white flex items-center justify-center hover:bg-violet-500/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {saving ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground/30 mt-1.5 text-center select-none max-w-2xl mx-auto">
                  Enter to submit, Shift+Enter for new line
                </p>
              </div>
            </>
          )}

          {/* ── Complete Phase ──────────────────────────────────────── */}
          {phase === 'complete' && (
            <div className="flex-1 flex flex-col items-center justify-center max-w-2xl mx-auto px-4 py-8">
              <div className="w-16 h-16 rounded-card bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-4">
                <BookOpen className="w-8 h-8 text-emerald-400" />
              </div>
              <h2 className="typo-heading text-foreground mb-1">Training session complete</h2>
              <p className="typo-caption text-muted-foreground mb-2 text-center">
                {savedCount} of {questions.length} answers saved as pending memories.
                Review them in the Knowledge tab.
              </p>
              <div className="flex items-center gap-3 mt-4">
                <Button onClick={handleReset} variant="accent" accentColor="violet" size="sm">
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" />Train More
                </Button>
                <Button onClick={() => useSystemStore.getState().setTwinTab('knowledge')} variant="ghost" size="sm">
                  <BookOpen className="w-3.5 h-3.5 mr-1.5" />Review Memories
                </Button>
              </div>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
