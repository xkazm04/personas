import { useState } from 'react';
import { ExternalLink, SkipForward, Ban, Pencil, UserCog, Send, Pin } from 'lucide-react';
import { MOCK_BEATS, type MockBeat } from './mockData';
import { MockAvatar, speakerName, speakerColor, agoLabel, BEAT_TONE, BEAT_BADGE, MockBanner } from './collabShared';

/**
 * VARIANT A — "Composed Channel" end-game (wire-only design).
 *
 * What shipping design A would feel like: a chronological channel composed
 * from the authoritative step layer. Review gates render as QUESTION CARDS
 * with the full existing intervention row (skip / abort / edit / reassign).
 * The composer writes a directive that lands AT THE NEXT EXECUTION START
 * (memory injection) — honest about the delivery latency: no read-receipts,
 * a "queued for next run" acknowledgment is all the loop offers.
 */
export function CollabVariantA() {
  const [beats, setBeats] = useState<MockBeat[]>(MOCK_BEATS);
  const [resolved, setResolved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setBeats((prev) => [
      ...prev,
      { id: `u-${prev.length}`, kind: 'directive', memberId: 'user', minutesAgo: 0, text },
    ]);
    setDraft('');
  };

  return (
    <div className="h-full flex flex-col min-h-0 gap-2" data-testid="collab-a">
      <MockBanner>Design A · composed from existing step events + reviews + memories · delivery: next execution start</MockBanner>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {beats.map((b) => {
          if (b.kind === 'question') {
            const done = resolved === b.id;
            return (
              <div key={b.id} className="rounded-card border border-red-500/30 bg-red-500/5 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <MockAvatar memberId={b.memberId} size="w-6 h-6" />
                  <span className="typo-body font-medium" style={{ color: speakerColor(b.memberId) }}>{speakerName(b.memberId)}</span>
                  <span className="typo-caption uppercase tracking-wider text-red-300">needs you</span>
                  <span className="ml-auto typo-caption text-foreground/40">{agoLabel(b.minutesAgo)}</span>
                </div>
                <p className="mt-1.5 typo-body text-foreground/90">{b.text}</p>
                {done ? (
                  <p className="mt-2 typo-caption text-emerald-300">✓ Resolved — pipeline resumed (mock)</p>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => setResolved(b.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/15 bg-secondary/40 typo-caption text-foreground/85 hover:bg-secondary/60 transition-colors"><SkipForward className="w-3 h-3" /> Skip</button>
                    <button type="button" onClick={() => setResolved(b.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-red-500/25 bg-red-500/10 typo-caption text-red-300 hover:bg-red-500/20 transition-colors"><Ban className="w-3 h-3" /> Abort</button>
                    <button type="button" onClick={() => setResolved(b.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/15 bg-secondary/40 typo-caption text-foreground/85 hover:bg-secondary/60 transition-colors"><Pencil className="w-3 h-3" /> Edit requirement</button>
                    <button type="button" onClick={() => setResolved(b.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded-interactive border border-primary/15 bg-secondary/40 typo-caption text-foreground/85 hover:bg-secondary/60 transition-colors"><UserCog className="w-3 h-3" /> Reassign</button>
                  </div>
                )}
              </div>
            );
          }
          if (b.kind === 'directive') {
            return (
              <div key={b.id} className="rounded-card border border-emerald-500/25 bg-emerald-500/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <Pin className="w-3.5 h-3.5 text-emerald-300 flex-shrink-0" />
                  <span className="typo-body font-medium text-emerald-200">Your directive</span>
                  <span className="ml-auto typo-caption text-foreground/40">{agoLabel(b.minutesAgo)}</span>
                </div>
                <p className="mt-1 typo-body text-foreground/90">{b.text}</p>
                <p className="mt-1 typo-caption text-foreground/50">Queued — injected when the next execution starts. No delivery receipt in design A.</p>
              </div>
            );
          }
          return (
            <div key={b.id} className="flex gap-2.5">
              <MockAvatar memberId={b.memberId} size="w-6 h-6" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="typo-body font-medium" style={{ color: speakerColor(b.memberId) }}>{speakerName(b.memberId)}</span>
                  <span className={`typo-caption uppercase tracking-wider ${BEAT_TONE[b.kind]}`}>{BEAT_BADGE[b.kind]}</span>
                  <span className="typo-caption text-foreground/40">{agoLabel(b.minutesAgo)}</span>
                </div>
                <p className={`typo-body ${b.kind === 'memory' ? 'text-amber-200/90' : 'text-foreground/80'}`}>{b.text}</p>
                {b.artifact && (
                  <a href={b.artifact.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/15 typo-caption text-blue-300 hover:bg-secondary/60 transition-colors">
                    <ExternalLink className="w-3 h-3" /> {b.artifact.label}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer — honest about A's delivery semantics */}
      <div className="flex-shrink-0 flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder="Post a directive to the team… (delivered at next execution start)"
          className="flex-1 px-3 py-2 rounded-input bg-secondary/30 border border-primary/15 typo-body text-foreground placeholder:text-foreground/35 focus:outline-none focus:border-primary/40"
        />
        <button type="button" onClick={send} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-interactive border border-emerald-500/30 bg-emerald-500/10 typo-body text-emerald-200 hover:bg-emerald-500/20 transition-colors">
          <Send className="w-4 h-4" /> Send
        </button>
      </div>
    </div>
  );
}

export default CollabVariantA;
