import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Send, Hand, Pause, Map } from 'lucide-react';
import { MOCK_BEATS, MOCK_C_REPLIES, type MockBeat } from './mockData';
import { MockAvatar, speakerName, speakerColor, agoLabel, BEAT_TONE, BEAT_BADGE, MockBanner } from './collabShared';

/**
 * VARIANT C — "Dialogue-native orchestration" end-game (the severe redesign).
 *
 * What chat-FIRST orchestration would feel like: personas negotiate in
 * threads, the user is a peer in the conversation, a working persona can be
 * INTERRUPTED mid-execution (pauses at a checkpoint and answers), and your
 * messages get immediate in-thread replies that change the plan. The pinned
 * "negotiated plan" updates as the dialogue moves — the DAG dissolved into
 * conversation. (The trade-off this mock can't show: giving up deterministic
 * step ordering — the source of the bounce storms the campaign fixed.)
 */
export function CollabVariantC() {
  const [beats, setBeats] = useState<MockBeat[]>(MOCK_BEATS);
  const [interrupted, setInterrupted] = useState(false);
  const [planVersion, setPlanVersion] = useState(1);
  const [draft, setDraft] = useState('');
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const appendSequence = (seq: MockBeat[], baseDelay = 700) => {
    seq.forEach((b, i) => {
      timers.current.push(
        window.setTimeout(
          () => setBeats((prev) => [...prev, { ...b, id: `${b.id}-${prev.length}` }]),
          baseDelay * (i + 1),
        ),
      );
    });
  };

  const interrupt = () => {
    if (interrupted) return;
    setInterrupted(true);
    appendSequence(MOCK_C_REPLIES.interrupt ?? []);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setBeats((prev) => [...prev, { id: `u-${prev.length}`, kind: 'directive', memberId: 'user', minutesAgo: 0, text }]);
    setDraft('');
    appendSequence(MOCK_C_REPLIES.directive ?? []);
    timers.current.push(window.setTimeout(() => setPlanVersion(2), 2400));
  };

  return (
    <div className="h-full flex flex-col min-h-0 gap-2" data-testid="collab-c">
      <MockBanner>Design C · dialogue IS the orchestration · mid-execution interrupts · plan renegotiated in-thread</MockBanner>

      {/* Pinned negotiated plan — replaces the step DAG */}
      <div className="flex-shrink-0 rounded-card border border-violet-500/25 bg-violet-500/5 px-3 py-2">
        <div className="flex items-center gap-2">
          <Map className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
          <span className="typo-caption uppercase tracking-wider text-violet-300">negotiated plan · v{planVersion}</span>
        </div>
        <p className="mt-0.5 typo-body text-foreground/80">
          {planVersion === 1
            ? 'Ship amount validation (done) → extract bill-export module → CSV writer → QA pass → release.'
            : 'Ship amount validation (done) → extract bill-export module (done) → CSV writer with ISO dates, XLSX deferred → QA asserts ISO format → release.'}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-1">
        {beats.map((b) => {
          const threaded = !!b.replyTo || b.kind === 'reply';
          const isUser = b.memberId === 'user';
          const isLiveWork = b.interruptible && !interrupted;
          return (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`flex gap-2.5 ${threaded ? 'ml-8' : ''} ${isUser ? 'flex-row-reverse' : ''}`}
            >
              <MockAvatar memberId={b.memberId} size="w-6 h-6" />
              <div className={`max-w-[78%] rounded-card border px-3 py-2 ${
                isUser
                  ? 'border-emerald-500/25 bg-emerald-500/10'
                  : b.kind === 'question'
                    ? 'border-red-500/30 bg-red-500/5'
                    : isLiveWork
                      ? 'border-blue-500/30 bg-blue-500/5'
                      : 'border-primary/10 bg-secondary/20'
              }`}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="typo-caption font-medium" style={{ color: speakerColor(b.memberId) }}>{speakerName(b.memberId)}</span>
                  <span className={`typo-caption uppercase tracking-wider ${BEAT_TONE[b.kind]}`}>{BEAT_BADGE[b.kind]}</span>
                  <span className="typo-caption text-foreground/35">{agoLabel(b.minutesAgo)}</span>
                </div>
                <p className="mt-0.5 typo-body text-foreground/85">
                  {isLiveWork && !interrupted ? b.text : b.interruptible && interrupted ? 'Paused at checkpoint — bill-export module extracted, awaiting your direction.' : b.text}
                </p>
                {b.artifact && (
                  <a href={b.artifact.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-blue-300 hover:bg-secondary/60 transition-colors">
                    <ExternalLink className="w-3 h-3" /> {b.artifact.label}
                  </a>
                )}
                {isLiveWork && (
                  <button
                    type="button"
                    onClick={interrupt}
                    className="mt-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive border border-blue-500/30 bg-blue-500/10 typo-caption text-blue-300 hover:bg-blue-500/20 transition-colors"
                  >
                    <Hand className="w-3 h-3" /> Interrupt — pause at checkpoint
                  </button>
                )}
                {b.interruptible && interrupted && (
                  <p className="mt-1 inline-flex items-center gap-1 typo-caption text-amber-300">
                    <Pause className="w-3 h-3" /> execution paused by you
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Speak as a peer — replies arrive in-thread and renegotiate the plan…"
          className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-primary/15 typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button type="button" onClick={send} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-emerald-500/30 bg-emerald-500/10 typo-body text-emerald-200 hover:bg-emerald-500/20 transition-colors">
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

export default CollabVariantC;
