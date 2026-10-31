/**
 * MorningDeck - the Monitor's Morning tab (spark roadmap S6, G6): bp's Morning deck, read-only, in the picker's bp dress.
 * bp builds the deck (every live product's night, the decisions waiting, each with its decision brief); Personas reads it
 * through its Rust (`bp_morning`) and shows the cards in bp's order.
 *
 *   Approve (A)        a decision card, through Personas' own `lens_scan_decide` into the store bp reads: bp's deck
 *                      drops the card on its next read, and this tab re-reads at once
 *   Decline (X)        only on a repeat of a declined idea (the brief recommends it), writing the brief's note
 *   Enter              the recommended answer (owner decision D14): Decline on a repeat, else Approve
 *   Open (O)           the card's place in the product's drawing (the same sheet a tile opens)
 *   Defer / Hold       stay in bp, which writes them to its steering log: a link opens the card in bp
 *
 * A product bp names that Personas has not got (no project at the same root) shows its cards but cannot decide them.
 * It is a Blueprint surface for bp's shared focus, like the Blueprint tab: Follow works from here too.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { readBpMorning, type BpMorningRead } from '@/api/bpLink';
import { decideLensScan, type DecideResult } from '@/api/lensScan';
import { openExternalUrl } from '@/api/system/system';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch, silentCatchNull } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import '../../blueprint/theme/fonts';
import '../picker/picker.css';
import './morning.css';
import { Press } from '../../blueprint/ui/Press';
import type { FocusPlace } from '../../blueprint/model/focus';
import type { BpFollower } from '../bpFollower';
import { liveFollower } from '../bpFollowLive';
import { openLensSheet } from '../lensSheetStore';
import { FollowLine } from '../picker/FollowLine';
import { useBpFollowSurface } from '../useBpFollow';
import { bpCardUrl, decidable, declinable, readMorningDeck, recommended, type MorningCardView, type MorningDeckView } from './deck';

/** Everything the tab reads and writes; the live doors by default, a fake in tests. */
export interface MorningSource {
  read(opened?: string): Promise<BpMorningRead>;
  decide(projectId: string, ids: string[], decision: 'approve' | 'decline', note?: string): Promise<DecideResult>;
  open(projectId: string, place: FocusPlace): void;
  openExternal(url: string): Promise<unknown>;
}

const LIVE: MorningSource = {
  read: readBpMorning,
  decide: decideLensScan,
  open: (projectId, place) => openLensSheet({ kind: 'build', projectId, place }),
  openExternal: openExternalUrl,
};

/** While the tab is on screen the deck is re-read this often (a decision taken in bp shows here too). */
export const MORNING_REREAD_MS = 30_000;

type Said = { tone: 'good' | 'warn'; text: string } | null;

export function MorningDeck({ source = LIVE, follower = liveFollower() }: { source?: MorningSource; follower?: BpFollower }) {
  const { t, tx } = useTranslation();
  const M = t.decisionCenter.lens;
  const visible = useSystemStore((s) => s.headerOverlay === 'monitor');
  useBpFollowSurface(follower, visible);

  const [deck, setDeck] = useState<MorningDeckView | null>(null);
  const [base, setBase] = useState<string>('');
  const [offline, setOffline] = useState(false);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said>(null);
  const [projects, setProjects] = useState<Record<string, string | null>>({});
  const opened = useRef<string | undefined>(undefined);

  const reread = useCallback(async () => {
    try {
      const r = await source.read(opened.current);
      setBase(r.base);
      setOffline(!r.online);
      const d = r.online ? readMorningDeck(r.deck) : null;
      if (d) { opened.current ??= d.until; setDeck(d); }
    } catch (err) {
      silentCatch('decisionCenter.morning:read')(err);
      setOffline(true);
    }
  }, [source]);

  useEffect(() => {
    if (!visible) return;
    void reread();
    const id = setInterval(() => void reread(), MORNING_REREAD_MS);
    return () => clearInterval(id);
  }, [visible, reread]);

  // bp's slug -> the Personas project at the same root (bp's product table), once per product on the deck
  const slugs = deck ? [...new Set(deck.cards.flatMap((c) => (c.product ? [c.product] : [])))] : [];
  const slugKey = slugs.join(',');
  useEffect(() => {
    if (!slugKey) return;
    let live = true;
    void (async () => {
      // one product at a time: the follower reads bp's table once and answers the rest from it
      const found: Record<string, string | null> = {};
      for (const slug of slugKey.split(',')) found[slug] = (await follower.projectOf(slug).catch(silentCatchNull('decisionCenter.morning:products'))) ?? null;
      if (live) setProjects(found);
    })();
    return () => { live = false; };
  }, [slugKey, follower]);

  const cards = deck?.cards ?? [];
  const card = cards[Math.min(at, Math.max(0, cards.length - 1))] ?? null;
  /** The Personas project of a card's product: its id, null when Personas has none, undefined while the table reads. */
  const projectOf = (c: MorningCardView | null): string | null | undefined => (c?.product ? projects[c.product] : null);

  const decide = useCallback(async (c: MorningCardView, decision: 'approve' | 'decline') => {
    const projectId = c.product ? projects[c.product] : null;
    if (!c.decision || !decidable(c) || busy) return;
    if (!projectId) { setSaid({ tone: 'warn', text: tx(M.morning_not_here, { product: c.product ?? '' }) }); return; }
    if (decision === 'decline' && !declinable(c)) { setSaid({ tone: 'warn', text: M.morning_decline_repeat_only }); return; }
    setBusy(true);
    try {
      const note = decision === 'decline' ? c.decision.brief?.note : undefined;
      const r = await source.decide(projectId, [c.decision.proposal], decision, note);
      const done = r.decided.includes(c.decision.proposal);
      const skip = r.skipped.find((s) => s.id === c.decision?.proposal);
      setSaid(done
        ? { tone: 'good', text: tx(decision === 'approve' ? M.morning_approved : M.morning_declined, { id: c.decision.proposal }) }
        : { tone: 'warn', text: tx(M.morning_skipped, { id: c.decision.proposal, status: skip?.reason ?? skip?.status ?? '' }) });
      await reread();
    } catch (err) {
      silentCatch('decisionCenter.morning:decide')(err);
      setSaid({ tone: 'warn', text: tx(M.morning_failed, { message: err instanceof Error ? err.message : String(err) }) });
    } finally {
      setBusy(false);
    }
  }, [projects, busy, source, reread, tx, M]);

  const openAt = (c: MorningCardView) => {
    const projectId = projectOf(c);
    if (c.place && projectId) source.open(projectId, c.place);
    else if (c.product) setSaid({ tone: 'warn', text: tx(M.morning_not_here, { product: c.product }) });
  };

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !card) return;
    // a tabbed-to control owns Enter and Space
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    let used = true;
    if (k === 'ArrowDown' || k === 'j') setAt((i) => Math.min(i + 1, cards.length - 1));
    else if (k === 'ArrowUp' || k === 'k') setAt((i) => Math.max(i - 1, 0));
    else if (k === 'a' && decidable(card)) void decide(card, 'approve');
    else if (k === 'x' && declinable(card)) void decide(card, 'decline');
    else if (k === 'Enter' && decidable(card)) void decide(card, recommended(card));
    else if (k === 'o' && card.place) openAt(card);
    else used = false;
    if (used) e.preventDefault();
  };

  return (
    <section className="bp-scope bp-picker bp-morning" data-testid="monitor-morning" aria-labelledby="bp-morning-title" tabIndex={0} onKeyDown={onKey}>
      <div className="bp-paper" />
      <div className="bp-vig" />
      <div className="bp-dframe" />
      <div className="pj-page">
        <header className="pj-head">
          <h2 id="bp-morning-title">{M.morning_title}</h2>
          {deck && <span className="pj-n">{tx(M.morning_window, { cards: deck.cards.length, news: deck.news })}</span>}
        </header>
        <p className="pj-note">{M.morning_hint}</p>
        <FollowLine follower={follower} />
        {offline && <Banner severity="warning" compact message={M.morning_offline} onRetry={() => void reread()} />}
        {/* the live region is always mounted; only its text changes, so each answer is announced */}
        <p className={said ? `mw-said ${said.tone}` : 'sr-only'} role="status" data-testid="morning-said">{said?.text ?? ''}</p>
        {deck && deck.skipped.length > 0 && <p className="pj-hint">{tx(M.morning_skipped_products, { products: deck.skipped.map((s) => s.product).join(', ') })}</p>}
        {deck && (
          <ol className="mw-list" aria-label={M.morning_title}>
            {cards.map((c, i) => (
              <MorningCardRow key={c.id} c={c} current={i === at} project={projectOf(c)} busy={busy}
                onDecide={(d) => { setAt(i); void decide(c, d); }} onOpen={() => openAt(c)}
                onBp={() => { if (c.product) source.openExternal(bpCardUrl(base, c.product, c.id)).catch(silentCatch('decisionCenter.morning:bp')); }} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function MorningCardRow({ c, current, project, busy, onDecide, onOpen, onBp }: {
  c: MorningCardView; current: boolean; project: string | null | undefined; busy: boolean;
  onDecide: (d: 'approve' | 'decline') => void; onOpen: () => void; onBp: () => void;
}) {
  const { t, tx } = useTranslation();
  const M = t.decisionCenter.lens;
  const open = decidable(c), repeat = declinable(c), brief = c.decision?.brief, here = !!project;
  return (
    <li className={`mw-card mw-${c.kind} mw-tone-${c.tone}`} aria-current={current ? 'true' : undefined} data-card={c.id} data-kind={c.kind}>
      <div className="mw-top">
        <span className="mw-eye">{c.productName ?? c.product ?? M.morning_portfolio}{c.news ? <b className="mw-news">{M.morning_news}</b> : null}</span>
        {c.decision ? <code>{c.decision.proposal}</code> : null}
      </div>
      <h3 className="mw-h">{c.headline}</h3>
      {c.lines.length > 0 && <ul className="mw-lines">{c.lines.map((l, i) => <li key={i} className={l.tone ? `mw-tone-${l.tone}` : undefined}>{l.text}</li>)}</ul>}
      {brief && (
        <div className={`mw-brief${repeat ? ' rep' : ''}`} data-testid={`morning-brief-${c.id}`}>
          {repeat ? <b className="mw-chip">{M.morning_repeat}</b> : null}
          <span>{brief.short}</span>
        </div>
      )}
      {c.decision?.steered ? <p className="pj-hint">{tx(M.morning_steered, { verdict: c.decision.steered })}</p> : null}
      {(open || c.place || c.product) && (
        <div className="pj-acts">
          {open && repeat && <Press tone="pj-bt go" disabled={busy || !here} onClick={() => onDecide('decline')} data-testid={`morning-decline-${c.id}`} title={brief?.note}><kbd>Enter</kbd>{M.morning_decline_repeat}</Press>}
          {open && <Press tone={`pj-bt${repeat ? '' : ' go'}`} disabled={busy || !here} onClick={() => onDecide('approve')} data-testid={`morning-approve-${c.id}`}>{repeat ? null : <kbd>Enter</kbd>}{repeat ? M.morning_approve_anyway : M.approve}</Press>}
          {c.place && <Press tone="pj-bt" disabled={!here} onClick={onOpen} data-testid={`morning-open-${c.id}`}>{M.open_blueprint}</Press>}
          {open && c.product && <Press tone="pj-bt" onClick={onBp} data-testid={`morning-bp-${c.id}`}>{M.morning_defer_in_bp}</Press>}
          {project === null && c.product ? <span className="pj-fnote">{tx(M.morning_not_here, { product: c.product })}</span> : null}
        </div>
      )}
    </li>
  );
}

export default MorningDeck;
