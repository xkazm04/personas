import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ExternalLink, Send, Play, Check, CheckCheck } from 'lucide-react';
import { MOCK_BEATS, MOCK_LIVE_BEATS, MOCK_MEMBERS, type MockBeat } from './mockData';
import { MockAvatar, speakerName, speakerColor, agoLabel, BEAT_TONE, BEAT_BADGE, MockBanner } from './collabShared';

/**
 * VARIANT B — "Read-model + acknowledged directives" end-game.
 *
 * What shipping design B would feel like: the same channel but ALIVE —
 * presence header (who's working right now), server-pushed messages arriving
 * with a typing indicator ("Simulate live" plays a scripted burst), and
 * directives with a real feedback loop: sending → ✓ delivered → ✓✓ seen by
 * Dev Clone at step 3. History pages server-side (cursor hint in the footer).
 */
export function CollabVariantB() {
  const [beats, setBeats] = useState<MockBeat[]>(MOCK_BEATS);
  const [typing, setTyping] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [draft, setDraft] = useState('');
  const [receipts, setReceipts] = useState<Record<string, 'sent' | 'delivered' | 'seen'>>({});
  const timers = useRef<number[]>([]);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const playLive = () => {
    if (playing) return;
    setPlaying(true);
    let delay = 400;
    MOCK_LIVE_BEATS.forEach((b, i) => {
      timers.current.push(window.setTimeout(() => setTyping(b.memberId), delay));
      delay += 1100;
      timers.current.push(window.setTimeout(() => {
        setTyping(null);
        setBeats((prev) => [...prev, { ...b, id: `live-${i}-${prev.length}` }]);
      }, delay));
      delay += 500;
    });
    timers.current.push(window.setTimeout(() => setPlaying(false), delay));
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const id = `u-${beats.length}`;
    setBeats((prev) => [...prev, { id, kind: 'directive', memberId: 'user', minutesAgo: 0, text }]);
    setDraft('');
    setReceipts((r) => ({ ...r, [id]: 'sent' }));
    timers.current.push(window.setTimeout(() => setReceipts((r) => ({ ...r, [id]: 'delivered' })), 900));
    timers.current.push(window.setTimeout(() => setReceipts((r) => ({ ...r, [id]: 'seen' })), 2200));
  };

  return (
    <div className="h-full flex flex-col min-h-0 gap-2" data-testid="collab-b">
      <MockBanner>Design B · server read-model + push + step-boundary delivery · directives carry read-receipts</MockBanner>

      {/* Presence header */}
      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
        {MOCK_MEMBERS.map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive bg-secondary/25 border border-primary/10">
            <MockAvatar memberId={m.id} size="w-5 h-5" />
            <span className="typo-caption text-foreground/75">{m.callsign}</span>
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                m.presence === 'working' ? 'bg-blue-400' : m.presence === 'waiting' ? 'bg-amber-400' : 'bg-foreground/25'
              }`}
              title={m.presence}
            />
          </span>
        ))}
        <button
          type="button"
          onClick={playLive}
          disabled={playing}
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive border border-blue-500/30 bg-blue-500/10 typo-caption text-blue-300 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
        >
          <Play className="w-3 h-3" /> {playing ? 'streaming…' : 'Simulate live'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {/* caught-up divider — the cursor read-model concept */}
        <div className="flex items-center gap-3 py-1">
          <span className="flex-1 h-px bg-primary/10" />
          <span className="typo-caption text-foreground/40">earlier history loads server-side · cursor #84</span>
          <span className="flex-1 h-px bg-primary/10" />
        </div>

        {beats.map((b) => {
          const receipt = receipts[b.id];
          return (
            <motion.div key={b.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex gap-2.5">
              <MockAvatar memberId={b.memberId} size="w-6 h-6" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="typo-body font-medium" style={{ color: speakerColor(b.memberId) }}>{speakerName(b.memberId)}</span>
                  <span className={`typo-caption uppercase tracking-wider ${BEAT_TONE[b.kind]}`}>{BEAT_BADGE[b.kind]}</span>
                  <span className="typo-caption text-foreground/40">{agoLabel(b.minutesAgo)}</span>
                </div>
                <p className={`typo-body ${b.kind === 'question' ? 'text-red-200' : b.kind === 'directive' ? 'text-emerald-100' : 'text-foreground/80'}`}>{b.text}</p>
                {b.artifact && (
                  <a href={b.artifact.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-blue-300 hover:bg-secondary/60 transition-colors">
                    <ExternalLink className="w-3 h-3" /> {b.artifact.label}
                  </a>
                )}
                {b.kind === 'directive' && (
                  <p className="mt-0.5 inline-flex items-center gap-1 typo-caption text-foreground/55">
                    {receipt === 'seen' ? (
                      <><CheckCheck className="w-3.5 h-3.5 text-emerald-300" /> seen by Dev Clone · injected at step 3</>
                    ) : receipt === 'delivered' ? (
                      <><Check className="w-3.5 h-3.5 text-foreground/60" /> delivered — lands at the next step boundary</>
                    ) : (
                      <>sending…</>
                    )}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}

        {typing && (
          <div className="flex gap-2.5 items-center">
            <MockAvatar memberId={typing} size="w-6 h-6" />
            <span className="typo-caption text-foreground/50 italic">{speakerName(typing)} is transmitting…</span>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Message the team… (delivered at the next step boundary, with receipts)"
          className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-primary/15 typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button type="button" onClick={send} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-emerald-500/30 bg-emerald-500/10 typo-body text-emerald-200 hover:bg-emerald-500/20 transition-colors">
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

export default CollabVariantB;
