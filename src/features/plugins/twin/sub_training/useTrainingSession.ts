import { useState, useRef, useEffect, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
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

export const TRAINING_TOPIC_PRESETS = [
  { id: 'background', labelKey: 'topicBackground', prompt: 'Ask me about my professional background, career history, and current role.' },
  { id: 'opinions', labelKey: 'topicOpinions', prompt: 'Ask me about my opinions on technology, tools, and frameworks I use or recommend.' },
  { id: 'communication', labelKey: 'topicCommunication', prompt: 'Ask me how I prefer to communicate — formality, humor, directness, and what I avoid.' },
  { id: 'values', labelKey: 'topicValues', prompt: 'Ask me about my core values, principles, and what matters most to me professionally.' },
  { id: 'expertise', labelKey: 'topicExpertise', prompt: 'Ask me deep questions about my areas of expertise and specialized knowledge.' },
  { id: 'personal', labelKey: 'topicPersonal', prompt: 'Ask me about my interests, hobbies, and things I enjoy outside of work.' },
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
  groundingFacts: string[];
  sessionSummary: string | null;
  savedCount: number;
  generateQuestions: (topicPrompt: string) => Promise<void>;
  handleSubmitAnswer: () => Promise<void>;
  handleSkipFollowup: () => Promise<void>;
  handleReset: () => void;
  jumpTo: (idx: number) => void;
  answerRef: React.RefObject<HTMLTextAreaElement | null>;
}

/** Shared training state machine used by all training variants. */
export function useTrainingSession(): TrainingSession {
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

  const savedCount = questions.filter((q) => q.saved).length;

  useEffect(() => {
    if (!activeTwinId) { setGroundingFacts([]); return; }
    twinApi.listPendingMemories(activeTwinId, 'approved').then((mems) => {
      const facts = mems.slice(0, TRAINING_GROUNDING_LIMIT).map((m) => m.title ? `${m.title}: ${m.content}` : m.content);
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
    setQuestions(next); setAnswerDraft('');
    if (next.length === 0) { await advanceOrComplete(questions.filter((_, i) => i !== currentIdx), questions.length - 1); return; }
    if (currentIdx >= next.length) await advanceOrComplete(next, next.length);
    else { setCurrentIdx(currentIdx); setTimeout(() => answerRef.current?.focus(), 100); }
  };

  const handleReset = () => {
    setPhase('topic'); setQuestions([]); setCurrentIdx(0); setAnswerDraft('');
    setCustomTopic(''); setSessionSummary(null); followupSpawnedFor.current = new Set();
  };

  const jumpTo = (idx: number) => { if (idx >= 0 && idx < questions.length) setCurrentIdx(idx); };

  return {
    phase, questions, currentIdx, answerDraft, setAnswerDraft,
    customTopic, setCustomTopic,
    generating, followupLoading, summarizing, saving,
    groundingFacts, sessionSummary, savedCount,
    generateQuestions, handleSubmitAnswer, handleSkipFollowup, handleReset, jumpTo,
    answerRef,
  };
}
