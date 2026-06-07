import { useState, useRef, useEffect, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { toastCatch } from '@/lib/silentCatch';
import { useAnnounce } from '@/features/shared/components/feedback/AriaLiveProvider';
import * as twinApi from '@/api/twin/twin';

export interface QAPair {
  id: string;
  question: string;
  answer: string;
  saved: boolean;
  isFollowup?: boolean;
}

export const TRAINING_MIN_RICH_WORDS = 15;
export const TRAINING_GROUNDING_LIMIT = 12;

/**
 * The prompt strings shape the LLM's question-generation output, so
 * non-English locales need translated prompts to get questions in the
 * user's language. `promptKey` indexes into `t.twin.training.*` —
 * resolve at call time, not at module init.
 */
export const TRAINING_TOPIC_PRESETS = [
  { id: 'background', labelKey: 'topicBackground', promptKey: 'topicPromptBackground' },
  { id: 'opinions', labelKey: 'topicOpinions', promptKey: 'topicPromptOpinions' },
  { id: 'communication', labelKey: 'topicCommunication', promptKey: 'topicPromptCommunication' },
  { id: 'values', labelKey: 'topicValues', promptKey: 'topicPromptValues' },
  { id: 'expertise', labelKey: 'topicExpertise', promptKey: 'topicPromptExpertise' },
  { id: 'personal', labelKey: 'topicPersonal', promptKey: 'topicPromptPersonal' },
] as const;

function wordCount(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length; }

export interface TrainingSession {
  phase: 'topic' | 'interview' | 'complete';
  questions: QAPair[];
  currentIdx: number;
  answerDraft: string;
  setAnswerDraft: (s: string) => void;
  customTopic: string;
  setCustomTopic: (s: string) => void;
  generating: boolean;
  followupLoading: boolean;
  summarizing: boolean;
  saving: boolean;
  /** A twin-simulated answer draft is being generated for the current question. */
  drafting: boolean;
  /** The current answerDraft was produced by "Draft as twin" (and not yet submitted). */
  aiDrafted: boolean;
  groundingFacts: string[];
  sessionSummary: string | null;
  savedCount: number;
  generateQuestions: (topicPrompt: string) => Promise<void>;
  /** Draft the current question's answer AS the twin; `directions` steers a regenerate. */
  draftAnswer: (directions?: string) => Promise<void>;
  handleSubmitAnswer: () => Promise<void>;
  handleSkipFollowup: () => Promise<void>;
  handleReset: () => void;
  jumpTo: (idx: number) => void;
  answerRef: React.RefObject<HTMLTextAreaElement | null>;
}

/** Shared training state machine used by all training variants. */
export function useTrainingSession(): TrainingSession {
  const announce = useAnnounce();
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
  const [drafting, setDrafting] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);
  const followupSpawnedFor = useRef<Set<string>>(new Set());
  const [groundingFacts, setGroundingFacts] = useState<string[]>([]);
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement>(null);

  const savedCount = questions.filter((q) => q.saved).length;

  useEffect(() => {
    if (!activeTwinId) { setGroundingFacts([]); return; }
    twinApi.listPendingMemories(activeTwinId, 'approved').then((mems) => {
      const facts = mems.slice(0, TRAINING_GROUNDING_LIMIT).map((m) => m.title ? `${m.title}: ${m.content}` : m.content);
      setGroundingFacts(facts);
    }).catch(() => setGroundingFacts([]));
  }, [activeTwinId]);

  // Cross-tab handoff: Reflections panel populates pendingTrainingQuestions
  // when the user clicks "Dig deeper", then routes here. Consume on mount and
  // clear immediately so a tab-switch back doesn't replay the same prefill.
  const pendingTrainingQuestions = useSystemStore((s) => s.pendingTrainingQuestions);
  const setPendingTrainingQuestions = useSystemStore((s) => s.setPendingTrainingQuestions);
  useEffect(() => {
    if (!pendingTrainingQuestions || pendingTrainingQuestions.length === 0) return;
    const qaPairs: QAPair[] = pendingTrainingQuestions.slice(0, 5).map((q, i) => ({
      id: `dd-${Date.now()}-${i}`,
      question: q,
      answer: '',
      saved: false,
    }));
    followupSpawnedFor.current = new Set();
    setQuestions(qaPairs);
    setCurrentIdx(0);
    setAnswerDraft('');
    setSessionSummary(null);
    setPhase('interview');
    setPendingTrainingQuestions(null);
  }, [pendingTrainingQuestions, setPendingTrainingQuestions]);

  const callAi = useCallback(async (prompt: string): Promise<string> => {
    if (!activeTwin) throw new Error('no active twin');
    return twinApi.generateBio(activeTwin.name, activeTwin.role ?? null, prompt);
  }, [activeTwin]);

  const generateQuestions = useCallback(async (topicPrompt: string) => {
    if (!activeTwin) return;
    setGenerating(true); setSessionSummary(null); followupSpawnedFor.current = new Set();
    // Start cue — generation runs with only a spinner and no toast.
    announce('Generating interview questions…', 'polite');
    const groundingBlock = groundingFacts.length > 0
      ? `\n\nAlready known about ${activeTwin.name} (do NOT re-ask these — build on or around them):\n${groundingFacts.map((f) => `- ${f.slice(0, 200)}${f.length > 200 ? '…' : ''}`).join('\n')}`
      : '';
    try {
      const prompt = `You are interviewing someone to build a digital twin profile. Their name is "${activeTwin.name}"${activeTwin.role ? `, role: ${activeTwin.role}` : ''}${activeTwin.bio ? `. Bio: ${activeTwin.bio}` : ''}.\n\nTopic: ${topicPrompt}${groundingBlock}\n\nGenerate exactly 5 interview questions. Each question should:\n- Be specific and conversational (not generic)\n- Help capture their unique perspective, tone, and knowledge\n- Build on existing facts where possible — never duplicate them\n\nOutput ONLY the questions, one per line, numbered 1-5. No other text.`;
      const result = await callAi(prompt);
      const lines = result.split('\n').map((l) => l.replace(/^\d+[.)]\s*/, '').trim()).filter((l) => l.length > 10);
      const qaPairs: QAPair[] = lines.slice(0, 5).map((q, i) => ({ id: `q-${Date.now()}-${i}`, question: q, answer: '', saved: false }));
      if (qaPairs.length === 0) qaPairs.push({ id: `q-${Date.now()}-0`, question: `Tell me about ${topicPrompt.toLowerCase()}`, answer: '', saved: false });
      setQuestions(qaPairs); setCurrentIdx(0); setAnswerDraft(''); setPhase('interview');
      announce(`${qaPairs.length} interview questions ready`, 'polite');
    } catch {
      const fallback: QAPair[] = [
        { id: 'f1', question: `What's your background in ${topicPrompt.toLowerCase()}?`, answer: '', saved: false },
        { id: 'f2', question: `What's your strongest opinion about this topic?`, answer: '', saved: false },
        { id: 'f3', question: `How would you explain this to someone new?`, answer: '', saved: false },
      ];
      setQuestions(fallback); setCurrentIdx(0); setPhase('interview');
      announce('Question generation failed — using fallback questions', 'assertive');
    } finally { setGenerating(false); }
  }, [activeTwin, callAi, groundingFacts, announce]);

  // Twin-simulation: draft the current question's answer AS the twin, grounded
  // in the twin's bio + tone + distilled facts (server-side). `directions`
  // carries the user's critique on a regenerate ("shorter", "add the 2019
  // story"). The draft lands in answerDraft so the user reviews/edits it before
  // submitting — the human always has the last word on what becomes a memory.
  const draftAnswer = useCallback(async (directions?: string) => {
    if (!activeTwinId) return;
    const q = questions[currentIdx];
    if (!q) return;
    setDrafting(true);
    try {
      const draft = await twinApi.simulateAnswer(activeTwinId, q.question, directions?.trim() || undefined);
      const clean = draft.trim();
      if (clean) {
        setAnswerDraft(clean);
        setAiDrafted(true);
        // Programmatic set doesn't fire the textarea's onInput autosize, so a
        // multi-line draft would land collapsed. Focus + size it to fit so the
        // user can actually read what they're reviewing.
        setTimeout(() => {
          const el = answerRef.current;
          if (!el) return;
          el.focus();
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        }, 50);
      }
    } catch (e) {
      toastCatch('features/plugins/twin/sub_training/useTrainingSession:draftAnswer')(e);
    } finally {
      setDrafting(false);
    }
  }, [activeTwinId, questions, currentIdx]);

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
        await recordTwinInteraction(activeTwinId, 'training', 'out', summary, undefined,
          `Training session summary — ${new Date().toLocaleDateString()}`,
          JSON.stringify({ kind: 'session_summary', qa_count: qaPairs.length }), true);
      }
    } finally { setSummarizing(false); setPhase('complete'); }
  };

  const handleSubmitAnswer = async () => {
    if (!answerDraft.trim() || !activeTwinId) return;
    const q = questions[currentIdx]; if (!q) return;
    const trimmedAnswer = answerDraft.trim();
    setAiDrafted(false);
    const updated = [...questions]; updated[currentIdx] = { ...q, answer: trimmedAnswer }; setQuestions(updated);
    setSaving(true);
    try {
      await recordTwinInteraction(activeTwinId, 'training', 'out', trimmedAnswer, undefined,
        `Training Q&A: ${q.question}`,
        JSON.stringify([{ q: q.question, a: trimmedAnswer }]), true);
      updated[currentIdx] = { ...updated[currentIdx]!, answer: trimmedAnswer, saved: true };
      setQuestions([...updated]);
    } finally { setSaving(false); }
    setAnswerDraft('');
    const isTerse = wordCount(trimmedAnswer) < TRAINING_MIN_RICH_WORDS;
    if (isTerse && !followupSpawnedFor.current.has(q.id)) {
      followupSpawnedFor.current.add(q.id);
      setFollowupLoading(true);
      const followupQ = await generateFollowup(q, trimmedAnswer);
      setFollowupLoading(false);
      if (followupQ) {
        const next = [...updated.slice(0, currentIdx + 1),
          { id: `fu-${Date.now()}`, question: followupQ, answer: '', saved: false, isFollowup: true },
          ...updated.slice(currentIdx + 1)];
        setQuestions(next); await advanceOrComplete(next, currentIdx + 1); return;
      }
    }
    await advanceOrComplete(updated, currentIdx + 1);
  };

  const handleSkipFollowup = async () => {
    const next = [...questions.slice(0, currentIdx), ...questions.slice(currentIdx + 1)];
    setQuestions(next); setAnswerDraft(''); setAiDrafted(false);
    if (next.length === 0) { await advanceOrComplete(questions.filter((_, i) => i !== currentIdx), questions.length - 1); return; }
    if (currentIdx >= next.length) await advanceOrComplete(next, next.length);
    else { setCurrentIdx(currentIdx); setTimeout(() => answerRef.current?.focus(), 100); }
  };

  const handleReset = () => {
    setPhase('topic'); setQuestions([]); setCurrentIdx(0); setAnswerDraft('');
    setCustomTopic(''); setSessionSummary(null); setAiDrafted(false); followupSpawnedFor.current = new Set();
  };

  const jumpTo = (idx: number) => { if (idx >= 0 && idx < questions.length) setCurrentIdx(idx); };

  return {
    phase, questions, currentIdx, answerDraft, setAnswerDraft,
    customTopic, setCustomTopic,
    generating, followupLoading, summarizing, saving, drafting, aiDrafted,
    groundingFacts, sessionSummary, savedCount,
    generateQuestions, draftAnswer, handleSubmitAnswer, handleSkipFollowup, handleReset, jumpTo,
    answerRef,
  };
}
